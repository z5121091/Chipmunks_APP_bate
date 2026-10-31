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
const mockAdapter = {
  closeAsync: async () => { /* Keep this temporary fixture for restart checks. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) => (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: string[] = []) => {
    const result = sqlite.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  withExclusiveTransactionAsync: async (task: (db: SQLiteDatabase) => Promise<void>) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { await task(mockAdapter as unknown as SQLiteDatabase); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
let database: typeof import('../database');

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  // Actual pre-change schema, deliberately missing condition_mode.
  sqlite.exec(`CREATE TABLE [扫码解析规则] (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, separator TEXT NOT NULL,
    field_order TEXT NOT NULL, custom_field_ids TEXT, is_active INTEGER DEFAULT 1,
    supplier_name TEXT, match_conditions TEXT, field_prefixes TEXT,
    terminator TEXT NOT NULL DEFAULT '', display_order INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  sqlite.prepare(`INSERT INTO [扫码解析规则]
    (id,name,separator,field_order,match_conditions,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run('legacy', 'Legacy AND', '/', '["model","quantity"]',
    '[{"fieldIndex":0,"keyword":"SF"},{"fieldIndex":1,"keyword":"100"}]', 'created', 'updated');
  database = require('../database');
  await database.initDatabase();
});
afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('adds the mode column to an existing database without changing old rules or timestamps', async () => {
  const old = await database.getRuleById('legacy');
  expect(old?.conditionMode ?? 'all').toBe('all');
  expect(old).toMatchObject({ created_at: 'created', updated_at: 'updated' });
  expect(sqlite.prepare('SELECT condition_mode FROM [扫码解析规则] WHERE id = ?').get('legacy'))
    .toEqual({ condition_mode: 'all' });
  await expect(database.detectRule('XSF1234/100', [old!])).resolves.toEqual(old);
  await expect(database.detectRule('XSF1234/200', [old!])).resolves.toBeNull();
  await database.reinitializeDatabase();
  expect(await database.getRuleById('legacy')).toEqual(old);
});

it('round-trips mixed groups and mode through SQLite, restart and configuration restore', async () => {
  const conditions: import('../database').MatchCondition[] = [
    { fieldIndex: 1, keyword: 'LOT', operator: 'equals' },
    { fieldIndex: 0, keyword: 'SF', operator: 'startsWith', group: 'any' },
    { fieldIndex: 0, keyword: 'OS', operator: 'startsWith', group: 'any' },
  ];
  const id = await database.addRule({ name: 'Mixed persisted', description: '', separator: '/',
    fieldOrder: ['model', 'batch', 'quantity'], isActive: true, conditionMode: 'mixed', matchConditions: conditions });
  const original = await database.getRuleById(id);
  expect(original).toMatchObject({ conditionMode: 'mixed', matchConditions: conditions });
  await database.reinitializeDatabase();
  expect(await database.getRuleById(id)).toEqual(original);
  const backup = await database.exportBackupData();
  expect(backup.rules.find(rule => rule.id === id)).toMatchObject({ conditionMode: 'mixed', matchConditions: conditions });
  await database.updateRule(id, { conditionMode: 'any' });
  expect((await database.getRuleById(id))?.conditionMode).toBe('any');
  expect((await database.importBackupData(backup)).success).toBe(true);
  const restored = (await database.getRuleById(id))!;
  expect(restored).toMatchObject({ conditionMode: 'mixed', matchConditions: conditions });
  await expect(database.detectRule('SF1234/LOT/100', [restored])).resolves.toEqual(restored);
  await expect(database.detectRule('OS5678/LOT/100', [restored])).resolves.toEqual(restored);
  await expect(database.detectRule('SF1234/OTHER/100', [restored])).resolves.toBeNull();
});

it('restores an old backup with missing mode and missing operator as AND/contains', async () => {
  const backup = await database.exportBackupData();
  const old = backup.rules.find(rule => rule.id === 'legacy')!;
  delete old.conditionMode;
  expect((await database.importBackupData(backup)).success).toBe(true);
  const restored = (await database.getRuleById('legacy'))!;
  expect(restored.conditionMode ?? 'all').toBe('all');
  await expect(database.detectRule('XSF1234/200', [restored])).resolves.toBeNull();
});

it('rejects invalid updates and backups before changing existing rule data', async () => {
  const before = (await database.getRuleById('legacy'))!;
  await expect(database.updateRule('legacy', { conditionMode: 'invalid' as never })).rejects.toThrow('逻辑无效');
  await expect(database.updateRule('legacy', { matchConditions: [{ fieldIndex: 0, keyword: 'SF', group: 'invalid' as never }] }))
    .rejects.toThrow('分组无效');
  expect(await database.getRuleById('legacy')).toEqual(before);
  for (const invalid of [
    { conditionMode: 'invalid' },
    { matchConditions: [{ fieldIndex: 0, keyword: 'SF', group: 'invalid' }] },
    { matchConditions: [{ fieldIndex: 99, keyword: 'SF', group: 'any' }] },
  ]) {
    const backup = await database.exportBackupData();
    Object.assign(backup.rules.find(rule => rule.id === 'legacy')!, invalid);
    expect((await database.importBackupData(backup)).success).toBe(false);
    expect(await database.getRuleById('legacy')).toEqual(before);
  }
});

it.each([
  ['{"broken":', 'all'],
  ['{}', 'all'],
  ['[{"fieldIndex":0,"keyword":"SF","group":"invalid"}]', 'mixed'],
  ['[{"fieldIndex":0,"keyword":"SF","operator":"invalid"}]', 'any'],
  ['[{"fieldIndex":100,"keyword":"SF"}]', 'any'],
  ['[{"fieldIndex":0,"keyword":""}]', 'any'],
  ['[{"fieldIndex":0,"keyword":"SF"}]', 'invalid'],
])('does not turn damaged stored conditions into an unrestricted rule: %s / %s', async (conditions, mode) => {
  const saved = sqlite.prepare('SELECT match_conditions, condition_mode FROM [扫码解析规则] WHERE id = ?').get('legacy')!;
  sqlite.prepare('UPDATE [扫码解析规则] SET match_conditions = ?, condition_mode = ? WHERE id = ?').run(conditions, mode, 'legacy');
  try {
    await expect(database.getRuleById('legacy')).rejects.toThrow('识别条件');
    await expect(database.getActiveRules()).rejects.toThrow('识别条件');
  } finally {
    sqlite.prepare('UPDATE [扫码解析规则] SET match_conditions = ?, condition_mode = ? WHERE id = ?')
      .run(saved.match_conditions, saved.condition_mode, 'legacy');
  }
});
