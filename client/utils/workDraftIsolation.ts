import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/config';

const ARCHIVE_PREFIX = '@database_restore_work_copy_v1:';
const PENDING_KEY = '@database_restore_work_copy_pending_v1';
let isolationActive = false;
let draftWriteArchiveId: string | null = null;
let storageOperations: Promise<void> = Promise.resolve();
const activeDraftWrites = new Set<Promise<unknown>>();

type StoredEntry = [string, string];
export interface IsolatedWorkDraft {
  id: string;
  createdAt: string;
  databaseFileName: string;
  state: 'isolated' | 'restored' | 'rolled-back';
  entries: StoredEntry[];
  lateEntries: StoredEntry[];
}

export const isWorkDraftStorageKey = (key: string): boolean =>
  [STORAGE_KEYS.OUTBOUND_WORK_DRAFT, STORAGE_KEYS.OUTBOUND_ORDER_NO,
    STORAGE_KEYS.OUTBOUND_SCAN_RECORDS, 'outbound_scan_records',
    '@outbound_scan_queue_v1', '@outbound_erp_voucher_cache',
    'inventory_check_records_by_erp_account_v1', 'inventory_check_records']
    .some(value => key === value) ||
  ['inbound_scan_records', 'inbound_pending_data']
    .some(prefix => key === prefix || key.startsWith(`${prefix}:`));

const serializeStorageOperation = <T,>(operation: () => Promise<T>): Promise<T> => {
  const result = storageOperations.then(operation, operation);
  storageOperations = result.then(() => undefined, () => undefined);
  return result;
};

// Ordinary warehouse operations must retain AsyncStorage's independent reads
// and writes. In particular, a slow ERP cache read cannot hold the order save.
// Restore establishes its barrier synchronously, then drains writes which
// started before that barrier before capturing/removing any active draft keys.
const mutateDraftStorage = <T,>(keys: readonly string[], operation: () => Promise<T>): Promise<T> => {
  if (!keys.some(isWorkDraftStorageKey)) return operation();
  if (isolationActive || draftWriteArchiveId) return serializeStorageOperation(operation);
  const result = operation();
  activeDraftWrites.add(result);
  void result.then(
    () => { activeDraftWrites.delete(result); },
    () => { activeDraftWrites.delete(result); }
  );
  return result;
};

const waitForActiveDraftWrites = async (): Promise<void> => {
  await Promise.allSettled([...activeDraftWrites]);
};

const captureActiveEntries = async (): Promise<StoredEntry[]> => {
  const keys = (await AsyncStorage.getAllKeys()).filter(isWorkDraftStorageKey);
  if (!keys.length) return [];
  return (await AsyncStorage.multiGet(keys))
    .filter((entry): entry is StoredEntry => typeof entry[1] === 'string');
};

const readArchive = async (id: string): Promise<IsolatedWorkDraft> => {
  const raw = await AsyncStorage.getItem(`${ARCHIVE_PREFIX}${id}`);
  const value: unknown = raw ? JSON.parse(raw) : null;
  const validEntries = (entries: unknown): entries is StoredEntry[] =>
    Array.isArray(entries) && entries.every(entry => Array.isArray(entry) && entry.length === 2 &&
      typeof entry[0] === 'string' && isWorkDraftStorageKey(entry[0]) && typeof entry[1] === 'string');
  if (!value || typeof value !== 'object') throw new Error('恢复前作业副本不存在或已损坏，未改变当前作业');
  const archive = value as Partial<IsolatedWorkDraft>;
  if (archive.id !== id || typeof archive.createdAt !== 'string' ||
    typeof archive.databaseFileName !== 'string' || !validEntries(archive.entries) ||
    !validEntries(archive.lateEntries) ||
    !['isolated', 'restored', 'rolled-back'].includes(archive.state || '')) {
    throw new Error('恢复前作业副本格式无效，未改变当前作业');
  }
  return archive as IsolatedWorkDraft;
};

const saveArchive = async (archive: IsolatedWorkDraft): Promise<void> => {
  await AsyncStorage.setItem(`${ARCHIVE_PREFIX}${archive.id}`, JSON.stringify(archive));
};

/** Shared by the operation pages so a late save cannot republish pre-restore work. */
export const workDraftStorage: typeof AsyncStorage = {
  ...AsyncStorage,
  getItem: key => {
    if (!isWorkDraftStorageKey(key) || (!isolationActive && !draftWriteArchiveId)) return AsyncStorage.getItem(key);
    return serializeStorageOperation(async () => {
      if (!draftWriteArchiveId) return AsyncStorage.getItem(key);
      const archive = await readArchive(draftWriteArchiveId);
      return new Map([...archive.entries, ...archive.lateEntries]).get(key) ?? null;
    });
  },
  multiGet: keys => !keys.some(isWorkDraftStorageKey) || (!isolationActive && !draftWriteArchiveId)
    ? AsyncStorage.multiGet(keys)
    : serializeStorageOperation(async () => {
    const values = new Map(await AsyncStorage.multiGet(keys));
    if (draftWriteArchiveId) {
      const archive = await readArchive(draftWriteArchiveId);
      const shadow = new Map([...archive.entries, ...archive.lateEntries]);
      for (const key of keys) if (isWorkDraftStorageKey(key)) values.set(key, shadow.get(key) ?? null);
    }
    return keys.map(key => [key, values.get(key) ?? null]);
  }),
  setItem: (key, value) => mutateDraftStorage([key], async () => {
    if (isWorkDraftStorageKey(key) && draftWriteArchiveId) {
      const archive = await readArchive(draftWriteArchiveId);
      archive.lateEntries.push([key, value]);
      await saveArchive(archive);
    } else await AsyncStorage.setItem(key, value);
  }),
  multiSet: entries => mutateDraftStorage(entries.map(([key]) => key), async () => {
    const active: StoredEntry[] = [];
    const isolated: StoredEntry[] = [];
    for (const [key, value] of entries) {
      (isWorkDraftStorageKey(key) && draftWriteArchiveId ? isolated : active).push([key, value]);
    }
    if (isolated.length && draftWriteArchiveId) {
      const archive = await readArchive(draftWriteArchiveId);
      archive.lateEntries.push(...isolated);
      await saveArchive(archive);
    }
    if (active.length) await AsyncStorage.multiSet(active);
  }),
  removeItem: key => mutateDraftStorage([key], async () => {
    if (!isWorkDraftStorageKey(key) || !draftWriteArchiveId) await AsyncStorage.removeItem(key);
  }),
  multiRemove: keys => mutateDraftStorage(keys, async () => {
    const active = keys.filter(key => !isWorkDraftStorageKey(key) || !draftWriteArchiveId);
    if (active.length) await AsyncStorage.multiRemove(active);
  }),
};

const finishPendingIsolation = async (id: string): Promise<IsolatedWorkDraft> => {
  const archive = await readArchive(id);
  if (archive.state !== 'isolated') {
    await AsyncStorage.removeItem(PENDING_KEY);
    return archive;
  }
  const lateEntries = await captureActiveEntries();
  if (lateEntries.length) {
    archive.lateEntries.push(...lateEntries);
    // Every late value is saved before its active key is removed.
    await saveArchive(archive);
    await AsyncStorage.multiRemove(lateEntries.map(([key]) => key));
  }
  await AsyncStorage.removeItem(PENDING_KEY);
  return archive;
};

/** Complete an interrupted isolation before the app exposes the restored database. */
export const recoverInterruptedWorkDraftIsolation = async (): Promise<void> => {
  if (isolationActive) return;
  isolationActive = true;
  try {
    await serializeStorageOperation(async () => {
      await waitForActiveDraftWrites();
      const id = await AsyncStorage.getItem(PENDING_KEY);
      if (id) await finishPendingIsolation(id);
    });
  } finally { isolationActive = false; }
};

/** Save the complete original values before removing active draft keys. */
export const beginWorkDraftIsolation = async (databaseFileName: string): Promise<string> => {
  if (isolationActive) throw new Error('正在恢复数据库，请等待当前操作完成');
  isolationActive = true;
  try {
    return await serializeStorageOperation(async () => {
      await waitForActiveDraftWrites();
      const pending = await AsyncStorage.getItem(PENDING_KEY);
      if (pending) await finishPendingIsolation(pending);
      const entries = await captureActiveEntries();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const archive: IsolatedWorkDraft = {
        id, createdAt: new Date().toISOString(), databaseFileName,
        state: 'isolated', entries, lateEntries: [],
      };
      await saveArchive(archive);
      await AsyncStorage.setItem(PENDING_KEY, id);
      draftWriteArchiveId = id;
      await AsyncStorage.multiRemove(entries.map(([key]) => key));
      return id;
    });
  } catch (error) {
    isolationActive = false;
    // A saved journal remains recoverable. No database replacement has begun yet.
    throw error;
  }
};

export const completeWorkDraftIsolation = async (id: string): Promise<void> => {
  try { await serializeStorageOperation(() => finishPendingIsolation(id)); }
  finally { isolationActive = false; }
};

/** Keep the durable journal for the next initialization if an unexpected failure escaped. */
export const releaseWorkDraftIsolationAttempt = (): void => { isolationActive = false; };

/** Only use after the original database has been restored successfully. */
export const rollbackWorkDraftIsolation = async (id: string): Promise<void> => {
  try {
    await serializeStorageOperation(async () => {
      const archive = await readArchive(id);
      const entries = new Map([...archive.entries, ...archive.lateEntries]);
      const current = await captureActiveEntries();
      for (const [key, value] of current) entries.set(key, value);
      if (entries.size) await AsyncStorage.multiSet([...entries]);
      await saveArchive({ ...archive, state: 'rolled-back' });
      draftWriteArchiveId = null;
      await AsyncStorage.removeItem(PENDING_KEY);
    });
  } finally { isolationActive = false; }
};

export const listIsolatedWorkDrafts = async (): Promise<IsolatedWorkDraft[]> => {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(ARCHIVE_PREFIX));
  const archives = await Promise.all(keys.map(key => readArchive(key.slice(ARCHIVE_PREFIX.length))));
  return archives.filter(archive => archive.state === 'isolated' &&
    (archive.entries.length > 0 || archive.lateEntries.length > 0))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

/** Explicit operator action; never overwrite another unfinished job. */
export const restoreIsolatedWorkDraft = async (id: string): Promise<void> => {
  if (isolationActive) throw new Error('数据库恢复尚未完成，请重启应用后再核对作业副本');
  isolationActive = true;
  try {
    await serializeStorageOperation(async () => {
      await waitForActiveDraftWrites();
      if (await AsyncStorage.getItem(PENDING_KEY)) {
        throw new Error('数据库恢复尚未完成，请重启应用后再核对作业副本');
      }
      const archive = await readArchive(id);
      if (archive.state !== 'isolated') throw new Error('这份作业副本已处理，请重新打开列表');
      const entries = new Map([...archive.entries, ...archive.lateEntries]
        .filter(([key]) => key !== '@outbound_erp_voucher_cache'));
      const current = await captureActiveEntries();
      if (current.some(([key, value]) => key !== '@outbound_erp_voucher_cache' &&
        value.trim() && !['[]', '{}', 'null'].includes(value.trim()) &&
        entries.get(key) !== value)) {
        throw new Error('当前已有其他未完成作业，请先处理后再恢复这份副本');
      }
      try {
        if (entries.size) await AsyncStorage.multiSet([...entries]);
        await saveArchive({ ...archive, state: 'restored' });
        draftWriteArchiveId = null;
      } catch (error) {
        // Retain the isolated copy and put back the pre-action active values.
        await AsyncStorage.multiRemove([...entries.keys()]);
        const previousValues = current.filter(([key]) => entries.has(key));
        if (previousValues.length) await AsyncStorage.multiSet(previousValues);
        throw error;
      }
    });
  } finally { isolationActive = false; }
};
