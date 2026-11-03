import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { claimOtaNotice, downloadOtaUpdate, getPendingOtaUpdate, recordRunningUpdate, updateNotes } from '../otaUpdate';
import { beginOtaSensitiveOperation, lockForOtaApply } from '../otaSafety';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-updates', () => ({
  isEnabled: true, isEmbeddedLaunch: false, updateId: 'release-1', manifest: { extra: { warehouseUpdate: { notes: 'fix' } } },
  checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn(),
}));

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });

test('only a running update is recorded and notified once', async () => {
  expect(await recordRunningUpdate()).toMatchObject({ id: 'release-1', notes: 'fix' });
  expect(await recordRunningUpdate()).toBeNull();
});
test('corrupt display history does not prevent recording actual runtime', async () => {
  await AsyncStorage.setItem('warehouse.ota.applied.v1', 'invalid');
  expect(await recordRunningUpdate()).toMatchObject({ id: 'release-1' });
});
test('downloading never reloads app or claims update has been applied', async () => {
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({ isAvailable: true } as never);
  await downloadOtaUpdate();
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('warehouse.ota.applied.v1')).toBeNull();
});
test('no update does not download', async () => {
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({ isAvailable: false } as never);
  await downloadOtaUpdate();
  expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
});
test('failed downloads can be retried', async () => {
  jest.mocked(Updates.checkForUpdateAsync).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ isAvailable: true } as never);
  await expect(downloadOtaUpdate()).rejects.toThrow('offline');
  await downloadOtaUpdate();
  expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
});
test('active saves or print submissions block applying until finished', () => {
  const finish = beginOtaSensitiveOperation();
  expect(() => lockForOtaApply()).toThrow('正在保存或同步');
  finish(); finish();
  const unlock = lockForOtaApply();
  expect(() => beginOtaSensitiveOperation()).toThrow('正在应用更新');
  const checkpointDone = beginOtaSensitiveOperation(true);
  checkpointDone(); unlock();
  beginOtaSensitiveOperation()();
});

test('native pending flag does not make the running update pending again', () => {
  expect(getPendingOtaUpdate({ isUpdatePending: true, downloadedUpdate: { updateId: 'release-1' } })).toBeNull();
});
test('only a different downloaded update can be applied', () => {
  expect(getPendingOtaUpdate({ isUpdatePending: true, downloadedUpdate: { updateId: 'release-2' } })?.updateId).toBe('release-2');
  expect(getPendingOtaUpdate({ isUpdatePending: false, downloadedUpdate: { updateId: 'release-2' } })).toBeNull();
});
test('older cached update is not offered for application', () => {
  expect(getPendingOtaUpdate({ isUpdatePending: true, currentlyRunning: { updateId: 'newer', createdAt: new Date('2026-11-02') }, downloadedUpdate: { updateId: 'older', createdAt: new Date('2026-11-01') } })).toBeNull();
});
test('same update returned by server is not fetched again', async () => {
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({ isAvailable: true, manifest: { id: 'release-1' } } as never);
  expect(await downloadOtaUpdate()).toBe('latest');
  expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
});
test('reminders are claimed once per version, including concurrent checks', async () => {
  expect(await Promise.all([claimOtaNotice('ready', 'id-1'), claimOtaNotice('ready', 'id-1')])).toEqual([true, false]);
  expect(await claimOtaNotice('ready', 'id-1')).toBe(false);
  expect(await claimOtaNotice('ready', 'id-2')).toBe(true);
  expect(await claimOtaNotice('applied', 'id-2')).toBe(true);
});
test('downloaded UpdateInfo wrapper displays manifest release notes', () => {
  expect(updateNotes({ manifest: { extra: { warehouseUpdate: { notes: 'downloaded notes' } } } })).toBe('downloaded notes');
});
