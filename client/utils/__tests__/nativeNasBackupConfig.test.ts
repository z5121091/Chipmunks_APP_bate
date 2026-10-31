jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///private/',
  readAsStringAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  moveAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { syncNativeNasBackupConfiguration } from '../nativeNasBackupConfig';

const fs = jest.mocked(FileSystem);
const target = 'file:///private/auto-db-backup/server-config.json';
const oldServer = 'https://old-user:old-pass@nas.invalid/AppUpdate';
let files: Map<string, string>;
let sequence = 0;
const nextServer = () => `https://user:p%2Bass@nas.invalid/config-${++sequence}`;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  files = new Map([[target, JSON.stringify({ version: 1, serverUrl: oldServer })]]);
  fs.readAsStringAsync.mockImplementation(async path => {
    const value = files.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  });
  fs.makeDirectoryAsync.mockResolvedValue();
  fs.writeAsStringAsync.mockImplementation(async (path, text) => { files.set(path, text); });
  fs.moveAsync.mockImplementation(async ({ from, to }) => {
    const value = files.get(from);
    if (value === undefined) throw new Error('missing temporary');
    files.set(to, value);
    files.delete(from);
  });
  fs.deleteAsync.mockImplementation(async path => { files.delete(path); });
});

it('publishes full credentials in app-private storage only after the temporary write completes', async () => {
  const server = nextServer();
  fs.writeAsStringAsync.mockImplementation(async (path, text) => {
    expect(JSON.parse(files.get(target)!)).toMatchObject({ serverUrl: oldServer });
    expect(path).toMatch(/^file:\/\/\/private\/auto-db-backup\/\.server-config-.*\.tmp$/);
    files.set(path, text);
  });
  await syncNativeNasBackupConfiguration(server);
  expect(JSON.parse(files.get(target)!)).toMatchObject({ version: 1, serverUrl: server });
  expect(files.size).toBe(1);
  expect(fs.moveAsync).toHaveBeenCalledTimes(1);
});

it('skips rewriting an identical complete configuration after startup', async () => {
  await syncNativeNasBackupConfiguration(oldServer);
  expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
});

it.each(['write', 'replace'])('preserves the old complete configuration on %s failure and hides credentials', async phase => {
  const server = nextServer();
  if (phase === 'write') fs.writeAsStringAsync.mockRejectedValue(new Error(`failure ${server}`));
  else fs.moveAsync.mockRejectedValue(new Error(`failure ${server}`));
  await expect(syncNativeNasBackupConfiguration(server)).rejects.toThrow('NAS 后台配置同步失败');
  expect(JSON.parse(files.get(target)!)).toMatchObject({ serverUrl: oldServer });
  expect(files.size).toBe(1);
});

it('serializes concurrent publications and does not retain a failed queue lock', async () => {
  fs.writeAsStringAsync.mockRejectedValueOnce(new Error('first failed'));
  const first = syncNativeNasBackupConfiguration(nextServer());
  const server = nextServer();
  const second = syncNativeNasBackupConfiguration(server);
  await expect(first).rejects.toThrow('NAS 后台配置同步失败');
  await second;
  expect(JSON.parse(files.get(target)!)).toMatchObject({ serverUrl: server });
  expect(files.size).toBe(1);
});

it('repairs an unreadable old configuration from the effective foreground setting', async () => {
  files.set(target, '{interrupted');
  const server = nextServer();
  await syncNativeNasBackupConfiguration(server);
  expect(JSON.parse(files.get(target)!)).toMatchObject({ serverUrl: server });
});

it('rejects an invalid destination without deleting or changing the old configuration', async () => {
  await expect(syncNativeNasBackupConfiguration('file:///secret')).rejects.toThrow('NAS 服务器地址无效');
  expect(fs.moveAsync).not.toHaveBeenCalled();
  expect(JSON.parse(files.get(target)!)).toMatchObject({ serverUrl: oldServer });
});

it('does not read or write native files on Web or iOS', async () => {
  for (const platform of ['web', 'ios'] as const) {
    Platform.OS = platform;
    await syncNativeNasBackupConfiguration(nextServer());
  }
  expect(fs.readAsStringAsync).not.toHaveBeenCalled();
  expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
});
