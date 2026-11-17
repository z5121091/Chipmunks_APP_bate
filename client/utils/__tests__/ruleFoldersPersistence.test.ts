import { createRequire } from 'node:module';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');
const sqlite = new DatabaseSync(':memory:');
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
type BindValues = Array<string | number | null>;
let mockFailure: ((sql: string, values: BindValues) => boolean) | undefined;
const mockAdapter = {
  closeAsync: async () => { /* Keep this disposable fixture alive over simulated restarts. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, values: BindValues = []) => sqlite.prepare(sql).all(...values) as T[],
  getFirstAsync: async <T,>(sql: string, values: BindValues = []) => (sqlite.prepare(sql).get(...values) || null) as T | null,
  runAsync: async (sql: string, values: BindValues = []) => {
    if (mockFailure?.(sql, values)) throw new Error('Simulated folder write failure');
    const result = sqlite.prepare(sql).run(...values);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  withExclusiveTransactionAsync: async (task: (database: SQLiteDatabase) => Promise<void>) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { await task(mockAdapter as unknown as SQLiteDatabase); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
let database: typeof import('../database');
let legacyRule: Awaited<ReturnType<typeof import('../database')['getRuleById']>>;
const makeRule = (name: string, folderId?: string) => database.addRule({
  name, description: '', separator: '|', fieldOrder: ['model', 'quantity'],
  isActive: true, supplierName: 'Historical supplier note', folderId,
});
const organization = async () => ({ rules: await database.getAllRules(), folders: await database.getAllRuleFolders() });

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  sqlite.exec(`CREATE TABLE [扫码解析规则] (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, separator TEXT NOT NULL,
    field_order TEXT NOT NULL, custom_field_ids TEXT, is_active INTEGER DEFAULT 1,
    supplier_name TEXT, match_conditions TEXT, field_prefixes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  sqlite.prepare(`INSERT INTO [扫码解析规则] (id,name,description,separator,field_order,is_active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('legacy', 'Legacy preserved', 'Old description', '|', '["model","quantity"]', 1, 'old-created', 'old-updated');
  database = require('../database');
  await database.initDatabase();
  legacyRule = await database.getRuleById('legacy');
});

beforeEach(() => {
  mockFailure = undefined;
  sqlite.exec('DELETE FROM [扫码解析规则]; DELETE FROM [解析规则文件夹]');
});

afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('adds optional folder storage to old databases without changing existing rule contents', async () => {
  expect(legacyRule).toMatchObject({ id: 'legacy', name: 'Legacy preserved', description: 'Old description',
    separator: '|', fieldOrder: ['model', 'quantity'], isActive: true, created_at: 'old-created', updated_at: 'old-updated' });
  expect(legacyRule?.folderId).toBeUndefined();
  expect(sqlite.prepare('PRAGMA table_info([扫码解析规则])').all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'folder_id' })]));
  expect(await database.getAllRuleFolders()).toEqual([]);
});

it('validates folder names, rejects normalized duplicates and serializes competing creates', async () => {
  const id = await database.addRuleFolder('  Supplier A  ');
  await expect(database.addRuleFolder('ＳＵＰＰＬＩＥＲ　Ａ')).rejects.toThrow('已存在');
  await expect(database.addRuleFolder(' \t ')).rejects.toThrow('请输入');
  await expect(database.addRuleFolder('A'.repeat(61))).rejects.toThrow('60');
  const results = await Promise.allSettled([database.addRuleFolder('Concurrent'), database.addRuleFolder('concurrent')]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await database.getAllRuleFolders()).find(folder => folder.id === id)).toMatchObject({ name: 'Supplier A' });
});

it('persists folder membership across add, editing, renaming and restart without changing supplier or parsing fields', async () => {
  const folderId = await database.addRuleFolder('Original folder');
  const id = await makeRule('Member', folderId);
  const before = (await database.getRuleById(id))!;
  await database.renameRuleFolder(folderId, 'Renamed folder');
  await database.reinitializeDatabase();
  expect(await database.getRuleById(id)).toEqual(before);
  expect((await database.getAllRuleFolders())[0]).toMatchObject({ id: folderId, name: 'Renamed folder' });
  await database.updateRule(id, { folderId: '' });
  expect((await database.getRuleById(id))?.folderId).toBeUndefined();
  await database.updateRule(id, { folderId });
  expect((await database.getRuleById(id))?.folderId).toBe(folderId);
  const stable = await organization();
  await expect(database.updateRule(id, { folderId: 'missing' })).rejects.toThrow('不存在');
  await expect(makeRule('Invalid folder member', 'missing')).rejects.toThrow('不存在');
  expect(await organization()).toEqual(stable);
});

it('reserves the ungrouped destination name across create, rename and restore without changing local data', async () => {
  const folderId = await database.addRuleFolder('Keep this name');
  await makeRule('Keep this member', folderId);
  const before = await organization();
  await expect(database.addRuleFolder('　未分组　')).rejects.toThrow('保留名称');
  await expect(database.renameRuleFolder(folderId, '未分组')).rejects.toThrow('保留名称');
  expect(await organization()).toEqual(before);
  const backup = await database.exportBackupData();
  const result = await database.importBackupData({ ...backup,
    ruleFolders: backup.ruleFolders!.map(folder => ({ ...folder, name: '未分组' })),
  });
  expect(result).toMatchObject({ success: false, message: expect.stringContaining('保留名称') });
  expect(await organization()).toEqual(before);
});

it('moves batches atomically and rejects deleted rules or missing destinations before making changes', async () => {
  const folderId = await database.addRuleFolder('Destination');
  const first = await makeRule('First');
  const second = await makeRule('Second');
  const before = await organization();
  await expect(database.moveRulesToFolder([first, 'deleted'], folderId)).rejects.toThrow('已变化');
  await expect(database.moveRulesToFolder([first], 'missing')).rejects.toThrow('不存在');
  expect(await organization()).toEqual(before);
  mockFailure = (sql, values) => sql.startsWith('UPDATE [扫码解析规则] SET folder_id') && values.at(-1) === second;
  await expect(database.moveRulesToFolder([first, second], folderId)).rejects.toThrow('Simulated');
  expect(await organization()).toEqual(before);
  mockFailure = undefined;
  await database.moveRulesToFolder([first, second], folderId);
  expect((await database.getAllRules()).every(rule => rule.folderId === folderId)).toBe(true);
  await database.moveRulesToFolder([first], null);
  expect((await database.getRuleById(first))?.folderId).toBeUndefined();
});

it('dissolves folders without deleting rules and rolls back the unfiling if deletion fails', async () => {
  const folderId = await database.addRuleFolder('Dissolve me');
  const first = await makeRule('First', folderId);
  await makeRule('Second', folderId);
  const before = await organization();
  mockFailure = sql => sql.startsWith('DELETE FROM [解析规则文件夹]');
  await expect(database.deleteRuleFolder(folderId)).rejects.toThrow('Simulated');
  expect(await organization()).toEqual(before);
  mockFailure = undefined;
  await database.deleteRuleFolder(folderId);
  expect(await database.getAllRuleFolders()).toEqual([]);
  const { folderId: _folderId, ...original } = before.rules.find(rule => rule.id === first)!;
  expect(await database.getRuleById(first)).toEqual(original);
  expect(await database.getAllRules()).toHaveLength(2);
});

it('keeps folder ordering and membership completely outside matching priority and conflict detection', async () => {
  const firstFolder = await database.addRuleFolder('Folder one');
  const secondFolder = await database.addRuleFolder('Folder two');
  const generic = await makeRule('Generic', firstFolder);
  const specific = await database.addRule({ name: 'Specific', description: '', separator: '|',
    fieldOrder: ['model', 'quantity'], isActive: true, fieldPrefixes: { model: 'PN:' }, folderId: secondFolder });
  await expect(database.detectRule('PN:MODEL|10')).resolves.toMatchObject({ id: specific });
  await database.moveRulesToFolder([specific], firstFolder);
  await database.setRuleFoldersDisplayOrder([secondFolder, firstFolder]);
  await database.setRulesDisplayOrder([generic, specific]);
  await expect(database.detectRule('PN:MODEL|10')).resolves.toMatchObject({ id: specific });
  expect((await database.getAllRuleFolders()).map(folder => folder.id)).toEqual([secondFolder, firstFolder]);
  const before = await database.getAllRuleFolders();
  await expect(database.setRuleFoldersDisplayOrder([firstFolder])).rejects.toThrow('已变化');
  expect(await database.getAllRuleFolders()).toEqual(before);
  const ambiguous = (await database.getAllRules()).map(rule => ({ ...rule, fieldPrefixes: {} }));
  expect(database.analyzeQRCodeRuleDetection('MODEL|10', ambiguous).conflictingRules).toHaveLength(2);
});

it('round-trips folder names, membership and ordering in configuration backup', async () => {
  const first = await database.addRuleFolder('First folder');
  const second = await database.addRuleFolder('Second folder');
  await makeRule('First member', first);
  await makeRule('Second member', second);
  await database.setRuleFoldersDisplayOrder([second, first]);
  const before = await organization();
  const backup = await database.exportBackupData();
  expect(backup.ruleFolders).toEqual(before.folders);
  await database.deleteRuleFolder(first);
  await database.renameRuleFolder(second, 'Changed');
  expect(await database.importBackupData(backup)).toMatchObject({ success: true });
  expect(await organization()).toEqual(before);
});

it('restores old configuration as ungrouped and rejects broken new folder references without replacing local data', async () => {
  const folderId = await database.addRuleFolder('Local');
  await makeRule('Member', folderId);
  const backup = await database.exportBackupData();
  const before = await organization();
  expect(await database.importBackupData({ ...backup, ruleFolders: [] })).toMatchObject({ success: false });
  expect(await organization()).toEqual(before);
  expect(await database.importBackupData({ ...backup, ruleFolders: [...backup.ruleFolders!, ...backup.ruleFolders!] })).toMatchObject({ success: false });
  expect(await organization()).toEqual(before);
  const { ruleFolders: _folders, ...oldBackup } = backup;
  oldBackup.rules = oldBackup.rules.map(({ folderId: _folderId, ...rule }) => rule);
  expect(await database.importBackupData(oldBackup)).toMatchObject({ success: true });
  expect(await database.getAllRuleFolders()).toEqual([]);
  expect((await database.getAllRules()).every(rule => !rule.folderId)).toBe(true);
});

it('rolls back configuration replacement when restoring folder definitions fails', async () => {
  const folderId = await database.addRuleFolder('Preserve local');
  await makeRule('Preserve member', folderId);
  const before = await organization();
  const backup = await database.exportBackupData();
  mockFailure = sql => sql.startsWith('INSERT INTO [解析规则文件夹]');
  expect(await database.importBackupData(backup)).toMatchObject({ success: false });
  expect(await organization()).toEqual(before);
  mockFailure = undefined;
});

it('accepts old full databases without folder tables and rejects incomplete new definitions or references', async () => {
  const folderId = await database.addRuleFolder('Referenced');
  const id = await makeRule('Old compatible', folderId);
  sqlite.exec('DROP TABLE [解析规则文件夹]');
  await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).rejects.toThrow('缺少文件夹定义');
  sqlite.prepare('UPDATE [扫码解析规则] SET folder_id = NULL WHERE id = ?').run(id);
  await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).resolves.toBeUndefined();
  await database.reinitializeDatabase();
  expect(await database.getRuleById(id)).toMatchObject({ id, name: 'Old compatible' });
  expect(await database.getAllRuleFolders()).toEqual([]);
  await database.addRuleFolder('Other definition');
  sqlite.prepare('UPDATE [扫码解析规则] SET folder_id = ? WHERE id = ?').run('missing-definition', id);
  await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).rejects.toThrow('不存在的文件夹');
  sqlite.prepare('UPDATE [扫码解析规则] SET folder_id = NULL WHERE id = ?').run(id);
  sqlite.exec('DROP TABLE [解析规则文件夹]; CREATE TABLE [解析规则文件夹] (id TEXT, name TEXT)');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).rejects.toThrow('缺少字段');
  } finally {
    sqlite.exec('DROP TABLE [解析规则文件夹]');
    await database.reinitializeDatabase();
  }
});
