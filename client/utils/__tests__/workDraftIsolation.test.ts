import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginWorkDraftIsolation, completeWorkDraftIsolation, isWorkDraftStorageKey,
  listIsolatedWorkDrafts, recoverInterruptedWorkDraftIsolation,
  restoreIsolatedWorkDraft, rollbackWorkDraftIsolation,
  workDraftStorage,
} from '../workDraftIsolation';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => { jest.restoreAllMocks(); await AsyncStorage.clear(); });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

it('does not serialize ordinary order writes behind a blocked ERP cache read', async () => {
  const cache = deferred<string | null>();
  const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!readStorage) throw new Error('Missing storage fixture');
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(key =>
    key === '@outbound_erp_voucher_cache' ? cache.promise : readStorage(key));
  const read = workDraftStorage.getItem('@outbound_erp_voucher_cache');
  let written = false;
  const write = workDraftStorage.multiSet([['@outbound_order_no', 'NEW'], ['@outbound_work_draft', 'NEW-DRAFT']])
    .then(() => { written = true; });
  try {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(written).toBe(true);
    expect(await AsyncStorage.getItem('@outbound_order_no')).toBe('NEW');
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
    cache.resolve(null);
    await Promise.all([read, write]);
  }
});

it('drains pre-barrier writes before archiving and redirects writes started after the restore barrier', async () => {
  const gate = deferred<void>();
  const writeStorage = jest.mocked(AsyncStorage.setItem).getMockImplementation();
  if (!writeStorage) throw new Error('Missing storage fixture');
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === '@outbound_work_draft') await gate.promise;
    return writeStorage(key, value);
  });
  const write = workDraftStorage.setItem('@outbound_work_draft', 'before-barrier');
  let captured = false;
  const isolation = beginWorkDraftIsolation('old.db').then(id => { captured = true; return id; });
  const lateWrite = workDraftStorage.setItem('@outbound_order_no', 'after-barrier');
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  expect(captured).toBe(false);
  gate.resolve();
  await write;
  const id = await isolation;
  await lateWrite;
  await completeWorkDraftIsolation(id);
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  expect(await AsyncStorage.getItem('@outbound_order_no')).toBeNull();
  const [archive] = await listIsolatedWorkDrafts();
  expect(archive.entries).toEqual([['@outbound_work_draft', 'before-barrier']]);
  expect(archive.lateEntries).toEqual([['@outbound_order_no', 'after-barrier']]);
  await rollbackWorkDraftIsolation(id);
  jest.mocked(AsyncStorage.setItem).mockImplementation(writeStorage);
});

it('isolates current and legacy scoped jobs while preserving configuration', async () => {
  await AsyncStorage.multiSet([
    ['@outbound_work_draft', '{"orderNo":"A"}'], ['@outbound_order_no', 'A'],
    ['inbound_scan_records:account:warehouse:II', '[{"id":"IN"}]'],
    ['inventory_check_records_by_erp_account_v1', '{"A":[{"id":"C"}]}'],
    ['@outbound_scan_queue_v1', '[{"id":"Q"}]'], ['@sync_config', '{"ip":"test"}'],
  ]);
  const id = await beginWorkDraftIsolation('old.db');
  await completeWorkDraftIsolation(id);
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  expect(await AsyncStorage.getItem('@sync_config')).toBe('{"ip":"test"}');
  const [archive] = await listIsolatedWorkDrafts();
  expect(archive.entries).toHaveLength(5);
  await restoreIsolatedWorkDraft(id);
  expect(await AsyncStorage.getItem('@outbound_order_no')).toBe('A');
  expect(await listIsolatedWorkDrafts()).toEqual([]);
});

it('does not remove active jobs if saving their recovery copy fails', async () => {
  await AsyncStorage.setItem('@outbound_work_draft', 'original');
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(beginWorkDraftIsolation('old.db')).rejects.toThrow('disk full');
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBe('original');
});

it('preserves late writes before completing a database restore', async () => {
  await AsyncStorage.setItem('@outbound_work_draft', 'original');
  const id = await beginWorkDraftIsolation('old.db');
  await AsyncStorage.setItem('@outbound_work_draft', 'last pending save');
  await completeWorkDraftIsolation(id);
  const [archive] = await listIsolatedWorkDrafts();
  expect(archive.entries[0][1]).toBe('original');
  expect(archive.lateEntries[0][1]).toBe('last pending save');
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  await restoreIsolatedWorkDraft(id);
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBe('last pending save');
});

it('restores original jobs when the database replacement is rolled back', async () => {
  await AsyncStorage.setItem('inbound_pending_data:account:W:II', 'original');
  const id = await beginWorkDraftIsolation('bad.db');
  await rollbackWorkDraftIsolation(id);
  expect(await AsyncStorage.getItem('inbound_pending_data:account:W:II')).toBe('original');
  expect(await listIsolatedWorkDrafts()).toEqual([]);
});

it('refuses to overwrite another active job and retains the archived copy', async () => {
  await AsyncStorage.setItem('@outbound_work_draft', 'A');
  const id = await beginWorkDraftIsolation('old.db');
  await completeWorkDraftIsolation(id);
  await AsyncStorage.setItem('@outbound_work_draft', 'B');
  await expect(restoreIsolatedWorkDraft(id)).rejects.toThrow('已有其他未完成作业');
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBe('B');
  expect(await listIsolatedWorkDrafts()).toHaveLength(1);
});

it('recovers a persisted journal before reopening the restored database', async () => {
  const id = 'interrupted';
  await AsyncStorage.multiSet([
    ['@database_restore_work_copy_pending_v1', id],
    [`@database_restore_work_copy_v1:${id}`, JSON.stringify({ id, createdAt: '2026-10-15',
      databaseFileName: 'old.db', state: 'isolated', entries: [['@outbound_order_no', 'A']], lateEntries: [] })],
    ['@outbound_work_draft', 'late A'],
  ]);
  await recoverInterruptedWorkDraftIsolation();
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  expect(await AsyncStorage.getItem('@database_restore_work_copy_pending_v1')).toBeNull();
  expect((await listIsolatedWorkDrafts())[0].lateEntries).toEqual([['@outbound_work_draft', 'late A']]);
});

it('stops recovery on a corrupt archive without clearing active work', async () => {
  await AsyncStorage.multiSet([['@database_restore_work_copy_pending_v1', 'bad'],
    ['@database_restore_work_copy_v1:bad', '{broken'], ['@outbound_order_no', 'A']]);
  await expect(recoverInterruptedWorkDraftIsolation()).rejects.toThrow();
  expect(await AsyncStorage.getItem('@outbound_order_no')).toBe('A');
});

it('only recognizes exact known draft names and their scoped forms', () => {
  expect(isWorkDraftStorageKey('inbound_scan_records:account:W:II')).toBe(true);
  expect(isWorkDraftStorageKey('inbound_scan_records_other')).toBe(false);
  expect(isWorkDraftStorageKey('@sync_config')).toBe(false);
  expect(isWorkDraftStorageKey('@database_restore_work_copy_v1:1')).toBe(false);
});

it('does not isolate restored work again if a rollback journal cleanup was interrupted', async () => {
  const id = 'rollback-complete';
  await AsyncStorage.multiSet([
    ['@database_restore_work_copy_pending_v1', id],
    [`@database_restore_work_copy_v1:${id}`, JSON.stringify({ id, createdAt: '2026-10-15',
      databaseFileName: 'bad.db', state: 'rolled-back', entries: [['@outbound_order_no', 'A']], lateEntries: [] })],
    ['@outbound_order_no', 'A'],
  ]);
  await recoverInterruptedWorkDraftIsolation();
  expect(await AsyncStorage.getItem('@outbound_order_no')).toBe('A');
  expect(await AsyncStorage.getItem('@database_restore_work_copy_pending_v1')).toBeNull();
});

it('routes page saves during and after isolation into the copy until process restart', async () => {
  await AsyncStorage.setItem('@outbound_work_draft', 'A');
  const id = await beginWorkDraftIsolation('old.db');
  await workDraftStorage.setItem('@outbound_work_draft', 'A-late');
  await completeWorkDraftIsolation(id);
  await workDraftStorage.multiSet([['@outbound_work_draft', 'A-later'], ['@sync_config', 'unchanged-config']]);
  await workDraftStorage.removeItem('@outbound_work_draft');
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  expect(await AsyncStorage.getItem('@sync_config')).toBe('unchanged-config');
  const [archive] = await listIsolatedWorkDrafts();
  expect(archive.lateEntries).toEqual([['@outbound_work_draft', 'A-late'], ['@outbound_work_draft', 'A-later']]);
  await restoreIsolatedWorkDraft(id);
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBe('A-later');
});

it('does not let an unrelated ERP cache prevent or contaminate a manual recovery', async () => {
  await AsyncStorage.multiSet([['@outbound_order_no', 'A'], ['@outbound_erp_voucher_cache', 'old-cache']]);
  const id = await beginWorkDraftIsolation('old.db');
  await completeWorkDraftIsolation(id);
  await AsyncStorage.setItem('@outbound_erp_voucher_cache', 'new-cache');
  await restoreIsolatedWorkDraft(id);
  expect(await AsyncStorage.getItem('@outbound_order_no')).toBe('A');
  expect(await AsyncStorage.getItem('@outbound_erp_voucher_cache')).toBe('new-cache');
});

it('retains the recovery copy and rolls back a partial manual restoration failure', async () => {
  await AsyncStorage.setItem('@outbound_work_draft', 'A');
  const id = await beginWorkDraftIsolation('old.db');
  await completeWorkDraftIsolation(id);
  jest.spyOn(AsyncStorage, 'multiSet').mockImplementationOnce(async values => {
    await AsyncStorage.setItem(values[0][0], values[0][1]);
    throw new Error('disk full during restore');
  });
  await expect(restoreIsolatedWorkDraft(id)).rejects.toThrow('disk full');
  expect(await AsyncStorage.getItem('@outbound_work_draft')).toBeNull();
  expect(await listIsolatedWorkDrafts()).toHaveLength(1);
});

it('late read-modify-write preserves other inventory accounts in the isolated shadow', async () => {
  const key = 'inventory_check_records_by_erp_account_v1';
  await AsyncStorage.setItem(key, JSON.stringify({ A: ['A-1'], B: ['B-1'] }));
  const id = await beginWorkDraftIsolation('old.db');
  const store = JSON.parse((await workDraftStorage.getItem(key)) || '{}') as Record<string, string[]>;
  store.A.push('A-2');
  await workDraftStorage.setItem(key, JSON.stringify(store));
  await completeWorkDraftIsolation(id);
  await restoreIsolatedWorkDraft(id);
  expect(JSON.parse((await AsyncStorage.getItem(key))!)).toEqual({ A: ['A-1', 'A-2'], B: ['B-1'] });
});
