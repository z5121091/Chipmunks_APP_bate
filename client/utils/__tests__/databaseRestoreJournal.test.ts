jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///private/app/',
  getInfoAsync: jest.fn(), copyAsync: jest.fn(), deleteAsync: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  DATABASE_RESTORE_JOURNAL_KEY, beginDatabaseRestoreJournal, completeDatabaseRestoreJournal,
  recoverInterruptedDatabaseRestore, releaseDatabaseRestoreJournal,
} from '../databaseRestoreJournal';

const fs = jest.mocked(FileSystem);
const databasePath = 'file:///private/app/SQLite/palm_warehouse_v2.db';
const backupPath = `${databasePath}.backup`;
let files: Map<string, string>;
const begin = () => beginDatabaseRestoreJournal({ databasePath, backupPath, hadOriginal: true });
const journal = async () => JSON.parse((await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY))!);

beforeEach(async () => {
  releaseDatabaseRestoreJournal();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  files = new Map([[databasePath, 'original-database'], [backupPath, 'original-database']]);
  fs.getInfoAsync.mockImplementation(async uri => files.has(uri)
    ? { uri, exists: true, isDirectory: false, size: files.get(uri)!.length, modificationTime: 1 }
    : { uri, exists: false, isDirectory: false });
  fs.deleteAsync.mockImplementation(async uri => { files.delete(uri); });
  fs.copyAsync.mockImplementation(async ({ from, to }) => {
    const value = files.get(from);
    if (value === undefined) throw new Error('missing file');
    files.set(to, value);
  });
});

it('does nothing on an ordinary startup without a journal', async () => {
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('none');
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});

it('persists pending protection without deleting the original and skips recovery in the active restore', async () => {
  await begin();
  expect(await journal()).toMatchObject({ phase: 'pending', databasePath, backupPath, hadOriginal: true });
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('live');
  expect(files.get(databasePath)).toBe('original-database');
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});

it('rolls back an interrupted partial replacement and all sidecars before opening SQLite', async () => {
  await begin();
  files.set(databasePath, 'partial-import');
  files.set(`${databasePath}-wal`, 'new-wal');
  files.set(`${databasePath}-shm`, 'new-shm');
  releaseDatabaseRestoreJournal(); // Simulates the next JS process.
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('rolled-back');
  expect(files.get(databasePath)).toBe('original-database');
  expect(files.has(`${databasePath}-wal`)).toBe(false);
  expect(files.has(`${databasePath}-shm`)).toBe(false);
  expect(files.has(backupPath)).toBe(false);
  expect(await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY)).toBeNull();
});

it.each(['missing', 'empty'])('blocks startup and leaves current files untouched when the original backup is %s', async kind => {
  await begin();
  files.set(databasePath, 'partial-import');
  if (kind === 'missing') files.delete(backupPath); else files.set(backupPath, '');
  releaseDatabaseRestoreJournal();
  await expect(recoverInterruptedDatabaseRestore()).rejects.toThrow('已停止启动');
  expect(files.get(databasePath)).toBe('partial-import');
  expect(fs.deleteAsync).not.toHaveBeenCalled();
  expect((await journal()).phase).toBe('pending');
});

it('retains the rollback copy and pending journal if copying back is interrupted', async () => {
  await begin();
  releaseDatabaseRestoreJournal();
  fs.copyAsync.mockImplementationOnce(async ({ to }) => { files.set(to, 'partial'); throw new Error('process interrupted'); });
  await expect(recoverInterruptedDatabaseRestore()).rejects.toThrow('process interrupted');
  expect(files.get(backupPath)).toBe('original-database');
  expect((await journal()).phase).toBe('pending');
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('rolled-back');
  expect(files.get(databasePath)).toBe('original-database');
});

it('marks validated before deleting the rollback copy after a successful restore', async () => {
  await begin();
  files.set(databasePath, 'validated-new-database');
  fs.deleteAsync.mockImplementation(async uri => {
    if (uri === backupPath) expect((await journal()).phase).toBe('validated');
    files.delete(uri);
  });
  await completeDatabaseRestoreJournal();
  expect(files.get(databasePath)).toBe('validated-new-database');
  expect(files.has(backupPath)).toBe(false);
  expect(await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY)).toBeNull();
});

it('keeps the validated new database across interrupted cleanup and resumes only cleanup next startup', async () => {
  await begin();
  files.set(databasePath, 'validated-new-database');
  fs.deleteAsync.mockRejectedValueOnce(new Error('cleanup interrupted'));
  await completeDatabaseRestoreJournal();
  expect((await journal()).phase).toBe('validated');
  expect(files.has(backupPath)).toBe(true);
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('validated-cleanup');
  expect(files.get(databasePath)).toBe('validated-new-database');
  expect(fs.copyAsync).not.toHaveBeenCalled();
});

it('retains validated protection if backup was deleted but journal cleanup was interrupted', async () => {
  await begin();
  files.set(databasePath, 'validated-new-database');
  jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('storage interrupted'));
  await completeDatabaseRestoreJournal();
  expect(files.has(backupPath)).toBe(false);
  expect((await journal()).phase).toBe('validated');
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('validated-cleanup');
  expect(files.get(databasePath)).toBe('validated-new-database');
});

it('does not delete the backup if the durable validated transition fails', async () => {
  await begin();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  await expect(completeDatabaseRestoreJournal()).rejects.toThrow('storage full');
  expect(files.get(backupPath)).toBe('original-database');
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});

it('removes an interrupted new import when no database existed before the restore', async () => {
  files.clear();
  await beginDatabaseRestoreJournal({ databasePath, backupPath, hadOriginal: false });
  files.set(databasePath, 'partial-first-import');
  releaseDatabaseRestoreJournal();
  await expect(recoverInterruptedDatabaseRestore()).resolves.toBe('rolled-back');
  expect(files.size).toBe(0);
  expect(fs.copyAsync).not.toHaveBeenCalled();
});

it('refuses to begin without the promised complete original backup', async () => {
  files.delete(backupPath);
  await expect(begin()).rejects.toThrow('备份缺失或为空');
  expect(await AsyncStorage.getItem(DATABASE_RESTORE_JOURNAL_KEY)).toBeNull();
  expect(files.get(databasePath)).toBe('original-database');
});

it('does not overwrite an older pending recovery attempt', async () => {
  await begin();
  releaseDatabaseRestoreJournal();
  const previous = await journal();
  await expect(begin()).rejects.toThrow('已有未完成');
  expect(await journal()).toEqual(previous);
});

it.each([
  { databasePath: 'file:///outside/palm_warehouse_v2.db' },
  { databasePath: 'file:///private/app/SQLite/../palm_warehouse_v2.db' },
  { backupPath: 'file:///outside/important.db' },
  { databasePath: 'file:///private/app/SQLite/other.db' },
])('rejects unsafe persisted paths before any file operation: %j', async override => {
  await AsyncStorage.setItem(DATABASE_RESTORE_JOURNAL_KEY, JSON.stringify({
    version: 1, phase: 'pending', startedAtMs: 1, databasePath, backupPath, hadOriginal: true, ...override,
  }));
  await expect(recoverInterruptedDatabaseRestore()).rejects.toThrow('路径无效');
  expect(fs.getInfoAsync).not.toHaveBeenCalled();
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});

it.each(['{broken', '{"version":2}', 'null'])('blocks corrupted/unsupported journals rather than silently creating an empty database', async raw => {
  await AsyncStorage.setItem(DATABASE_RESTORE_JOURNAL_KEY, raw);
  await expect(recoverInterruptedDatabaseRestore()).rejects.toThrow('已停止启动');
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});
