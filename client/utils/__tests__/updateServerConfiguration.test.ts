jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../nativeNasBackupConfig', () => ({ syncNativeNasBackupConfiguration: jest.fn() }));
jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/constants/config', () => ({
  UPDATE_CONFIG: { DEFAULT_SERVER: 'https://default:current-password@nas.invalid:443/AppUpdate' },
  STORAGE_KEYS: { UPDATE_SERVER_URL: '@update-server-test' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { UPDATE_CONFIG, STORAGE_KEYS } from '@/constants/config';
import { syncNativeNasBackupConfiguration } from '../nativeNasBackupConfig';
import { extractDisplayUrl, getUpdateServer, saveUpdateServer } from '../update';

const syncNative = jest.mocked(syncNativeNasBackupConfiguration);
const customServer = 'https://custom:password@other.invalid/AppUpdate';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  syncNative.mockResolvedValue();
});

it('publishes the default destination on first access', async () => {
  await expect(getUpdateServer()).resolves.toBe(UPDATE_CONFIG.DEFAULT_SERVER);
  expect(syncNative).toHaveBeenCalledWith(UPDATE_CONFIG.DEFAULT_SERVER);
});

it('publishes a custom saved destination instead of reverting to build-time default', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.UPDATE_SERVER_URL, customServer);
  await expect(getUpdateServer()).resolves.toBe(customServer);
  expect(syncNative).toHaveBeenCalledWith(customServer);
});

it.each([
  'http://old:secret@zx5121091.pw:5005/AppUpdate',
  'https://expired:password@nas.invalid/AppUpdate/',
])('publishes the migrated effective destination rather than stale credentials', async server => {
  await AsyncStorage.setItem(STORAGE_KEYS.UPDATE_SERVER_URL, server);
  await expect(getUpdateServer()).resolves.toBe(UPDATE_CONFIG.DEFAULT_SERVER);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.UPDATE_SERVER_URL)).toBe(UPDATE_CONFIG.DEFAULT_SERVER);
  expect(syncNative).toHaveBeenCalledWith(UPDATE_CONFIG.DEFAULT_SERVER);
});

it('save and immediate read publish the same new destination', async () => {
  await saveUpdateServer(`  ${customServer}  `);
  await expect(getUpdateServer()).resolves.toBe(customServer);
  expect(syncNative.mock.calls.map(([value]) => value)).toEqual([customServer, customServer]);
});

it('an empty saved setting publishes the application default', async () => {
  await saveUpdateServer(' ');
  expect(syncNative).toHaveBeenCalledWith(UPDATE_CONFIG.DEFAULT_SERVER);
});

it.each([null, 'https://old.invalid/AppUpdate'])('rolls back the foreground setting if native publication fails', async oldServer => {
  if (oldServer) await AsyncStorage.setItem(STORAGE_KEYS.UPDATE_SERVER_URL, oldServer);
  syncNative.mockRejectedValueOnce(new Error('mirror unavailable'));
  await expect(saveUpdateServer(customServer)).rejects.toThrow('mirror unavailable');
  expect(await AsyncStorage.getItem(STORAGE_KEYS.UPDATE_SERVER_URL)).toBe(oldServer);
  await expect(getUpdateServer()).resolves.toBe(oldServer ?? UPDATE_CONFIG.DEFAULT_SERVER);
});

it('serializes concurrent access and saves so an older read cannot overwrite a new native destination', async () => {
  const olderRead = getUpdateServer();
  const newerSave = saveUpdateServer(customServer);
  const newerRead = getUpdateServer();
  await Promise.all([olderRead, newerSave, newerRead]);
  expect(syncNative.mock.calls.map(([value]) => value)).toEqual([
    UPDATE_CONFIG.DEFAULT_SERVER, customServer, customServer,
  ]);
});

it('does not expose malformed credential-bearing input in display errors', () => {
  expect(extractDisplayUrl('invalid user:private-password@')).toBe('无效的服务器地址');
  expect(extractDisplayUrl(customServer)).toBe('https://other.invalid');
});
