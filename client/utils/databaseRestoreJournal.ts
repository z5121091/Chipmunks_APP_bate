import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

export const DATABASE_RESTORE_JOURNAL_KEY = '@database_restore_journal_v1';
const DATABASE_FILE_NAME = 'palm_warehouse_v2.db';
type RestorePaths = { databasePath: string; backupPath: string; hadOriginal: boolean };
type RestoreJournal = RestorePaths & { version: 1; phase: 'pending' | 'validated'; startedAtMs: number };
export type DatabaseRestoreRecovery = 'none' | 'live' | 'rolled-back' | 'validated-cleanup';

let liveRestore = false;
let pendingOperation: Promise<unknown> = Promise.resolve();
const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pendingOperation.catch(() => undefined).then(operation);
  pendingOperation = result;
  return result;
};

const validatePaths = (value: RestorePaths): void => {
  const directory = FileSystem.documentDirectory;
  if (!directory) throw new Error('数据库恢复保护失败：应用私有目录不可用');
  try {
    const uri = new URL(directory);
    if (uri.protocol !== 'file:' || uri.host || !directory.endsWith('/')) throw new Error();
  } catch {
    throw new Error('数据库恢复保护失败：应用私有目录无效');
  }
  const expected = `${directory}SQLite/${DATABASE_FILE_NAME}`;
  // Exact paths, not a string prefix: traversal, alternate basenames and external files are rejected.
  if (value.databasePath !== expected || value.backupPath !== `${expected}.backup` ||
      typeof value.hadOriginal !== 'boolean') {
    throw new Error('数据库恢复保护记录的路径无效，已停止启动以保护现有数据');
  }
};

const readJournal = async (): Promise<RestoreJournal | null> => {
  const raw = await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY);
  if (raw === null) return null;
  let record: unknown;
  try {
    if (raw.length > 16 * 1024) throw new Error();
    record = JSON.parse(raw);
  } catch {
    throw new Error('数据库恢复保护记录损坏，已停止启动，请保留本机数据后检查');
  }
  if (!record || typeof record !== 'object' || !('version' in record) || record.version !== 1 ||
      !('databasePath' in record) || typeof record.databasePath !== 'string' ||
      !('backupPath' in record) || typeof record.backupPath !== 'string' ||
      !('hadOriginal' in record) || typeof record.hadOriginal !== 'boolean' ||
      !('phase' in record) || !['pending', 'validated'].includes(String(record.phase)) ||
      !('startedAtMs' in record) || typeof record.startedAtMs !== 'number' || !Number.isFinite(record.startedAtMs)) {
    throw new Error('数据库恢复保护记录无效，已停止启动，请保留本机数据后检查');
  }
  const journal = record as RestoreJournal;
  validatePaths(journal);
  return journal;
};

const requireCompleteBackup = async (backupPath: string): Promise<void> => {
  const backup = await FileSystem.getInfoAsync(backupPath);
  if (!backup.exists || backup.isDirectory || backup.size <= 0) {
    throw new Error('上次数据库恢复尚未完成，原库备份缺失或为空；已停止启动，避免创建空库覆盖数据');
  }
};

const markValidated = async (journal: RestoreJournal): Promise<void> => {
  await AsyncStorage.setItem(DATABASE_RESTORE_JOURNAL_KEY, JSON.stringify({ ...journal, phase: 'validated' }));
};

const cleanupValidated = async (journal: RestoreJournal): Promise<void> => {
  // Never remove the only rollback copy before the durable phase transition above succeeds.
  await FileSystem.deleteAsync(journal.backupPath, { idempotent: true });
  await AsyncStorage.removeItem(DATABASE_RESTORE_JOURNAL_KEY);
};

/** Call after the original DB snapshot is complete and before deleting/replacing the active DB. */
export const beginDatabaseRestoreJournal = (paths: RestorePaths): Promise<void> => serialize(async () => {
  validatePaths(paths);
  if (liveRestore || await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY) !== null) {
    throw new Error('已有未完成的数据库恢复，请重启完成恢复检查后再试');
  }
  if (paths.hadOriginal) await requireCompleteBackup(paths.backupPath);
  const journal: RestoreJournal = { ...paths, version: 1, phase: 'pending', startedAtMs: Date.now() };
  await AsyncStorage.setItem(DATABASE_RESTORE_JOURNAL_KEY, JSON.stringify(journal));
  liveRestore = true;
});

/** Call only after the selected database is initialized and work-draft isolation is committed. */
export const completeDatabaseRestoreJournal = (): Promise<void> => serialize(async () => {
  const journal = await readJournal();
  if (!journal) { liveRestore = false; return; }
  await markValidated(journal);
  // Cleanup can be resumed on next startup without undoing an already validated database.
  try { await cleanupValidated(journal); } catch { /* Leave the durable validated journal for startup. */ }
  liveRestore = false;
});

/** A failed/interrupted restore must leave its persistent pending record for the next startup. */
export const releaseDatabaseRestoreJournal = (): void => { liveRestore = false; };

/** Run before SQLite is opened. Never permit schema initialization to mask an incomplete restore. */
export const recoverInterruptedDatabaseRestore = (): Promise<DatabaseRestoreRecovery> => serialize(async () => {
  if (liveRestore) return 'live';
  const journal = await readJournal();
  if (!journal) return 'none';
  if (journal.phase === 'validated') {
    await cleanupValidated(journal);
    return 'validated-cleanup';
  }

  // Check before touching any current file. A missing original backup must block an empty DB startup.
  if (journal.hadOriginal) await requireCompleteBackup(journal.backupPath);
  await FileSystem.deleteAsync(journal.databasePath, { idempotent: true });
  await FileSystem.deleteAsync(`${journal.databasePath}-wal`, { idempotent: true });
  await FileSystem.deleteAsync(`${journal.databasePath}-shm`, { idempotent: true });
  if (journal.hadOriginal) {
    await FileSystem.copyAsync({ from: journal.backupPath, to: journal.databasePath });
    await requireCompleteBackup(journal.databasePath);
  }
  await markValidated(journal);
  await cleanupValidated(journal);
  return 'rolled-back';
});
