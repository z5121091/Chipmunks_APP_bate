import { createRequire } from 'node:module';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));
const requireNode = createRequire(__filename);
const { DatabaseSync } = requireNode('node:sqlite') as typeof import('node:sqlite');
const sqlite = new DatabaseSync(':memory:');
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
let mockSupplierWriteFailure = false;
let mockRuleWriteFailure = false;
const mockAdapter = {
  closeAsync: async () => { /* Preserve this temporary fixture across simulated restarts. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) => (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: string[] = []) => {
    if (mockRuleWriteFailure && sql.startsWith('INSERT INTO [扫码解析规则]')) {
      throw new Error('Simulated rule write failure');
    }
    if (mockSupplierWriteFailure && sql.startsWith('INSERT INTO [物料供应商]')) {
      throw new Error('Simulated supplier write failure');
    }
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
const initialBindings = [
  ['old-1', 'OLD-1', 'CODE-OLD-1', '  Supplier A  '],
  ['old-2', 'OLD-2', 'CODE-OLD-2', 'supplier a'],
  ['old-3', 'OLD-3', 'CODE-OLD-3', '珠海博雅科技股份有限公司'],
  ['old-4', 'OLD-4', 'CODE-OLD-4', '   '],
  ['old-5', 'OLD-5', 'CODE-OLD-5', null],
];
const suppliers = () => database.getInventorySuppliers();
const findSupplier = async (name: string) => (await suppliers()).find(item => item.name.toUpperCase() === name.toUpperCase());
const makeBinding = (suffix: string, supplier?: string) => ({
  scan_model: `MODEL-${suffix}`, inventory_code: `CODE-${suffix}`, version: '', supplier,
});

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  // A real old database schema, with no supplier catalogue at all.
  sqlite.exec(`CREATE TABLE [物料绑定] (
    id TEXT PRIMARY KEY, scan_model TEXT NOT NULL, version TEXT DEFAULT '',
    inventory_code TEXT NOT NULL UNIQUE, supplier TEXT, description TEXT,
    created_at TEXT NOT NULL, UNIQUE(scan_model, version)
  )`);
  const insert = sqlite.prepare(`INSERT INTO [物料绑定]
    (id,scan_model,inventory_code,supplier,created_at) VALUES (?,?,?,?,?)`);
  initialBindings.forEach(row => insert.run(...row, 'legacy-created'));
  sqlite.exec(`CREATE TABLE [扫码解析规则] (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, separator TEXT NOT NULL,
    field_order TEXT NOT NULL, custom_field_ids TEXT, is_active INTEGER DEFAULT 1,
    supplier_name TEXT, match_conditions TEXT, field_prefixes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  database = require('../database');
  await database.initDatabase();
});

afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('migrates old supplier texts without changing bindings and seeds trimmed NOCASE unique names', async () => {
  expect(sqlite.prepare('SELECT id,scan_model,inventory_code,supplier FROM [物料绑定] ORDER BY id').all())
    .toEqual(initialBindings.map(([id, scan_model, inventory_code, supplier]) => ({ id, scan_model, inventory_code, supplier })));
  const list = await suppliers();
  expect(list).toHaveLength(2);
  expect(await findSupplier('Supplier A')).toMatchObject({ binding_count: 2 });
  expect(await findSupplier('珠海博雅科技股份有限公司')).toMatchObject({ binding_count: 1 });
  expect(list.every(item => item.name === item.name.trim() && item.name.length > 0)).toBe(true);
});

it('keeps catalogue ids and creation times stable across app restart', async () => {
  const before = await suppliers();
  await database.reinitializeDatabase();
  expect(await suppliers()).toEqual(before);
});

it('recreates the catalogue when restoring an old full database without that optional table', async () => {
  const bindings = await database.getAllInventoryBindings();
  sqlite.exec('DROP TABLE [物料供应商]');
  await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).resolves.toBeUndefined();
  await database.reinitializeDatabase();
  expect(await database.getAllInventoryBindings()).toEqual(bindings);
  expect(await suppliers()).toHaveLength(2);
});

it('adds unused names, deduplicates whitespace and ASCII case, and rejects blank names', async () => {
  const id = await database.addInventorySupplier('  New Supplier  ');
  expect(await database.addInventorySupplier('new supplier')).toBe(id);
  expect(await findSupplier('New Supplier')).toMatchObject({ id, name: 'New Supplier', binding_count: 0 });
  await expect(database.addInventorySupplier(' \t\n ')).rejects.toThrow('请输入供应商名称');
  expect((await suppliers()).some(item => !item.name.trim())).toBe(false);
});

it('registers names during binding add and edit while preserving optional blank supplier values', async () => {
  const id = await database.addInventoryBinding(makeBinding('ADD', '  Add Supplier '));
  expect(await findSupplier('Add Supplier')).toMatchObject({ binding_count: 1 });
  await database.updateInventoryBinding(id, { supplier: 'Edit Supplier' });
  expect(await findSupplier('Add Supplier')).toMatchObject({ binding_count: 0 });
  expect(await findSupplier('Edit Supplier')).toMatchObject({ binding_count: 1 });
  await database.updateInventoryBinding(id, { supplier: '' });
  expect((await database.getAllInventoryBindings()).find(item => item.id === id)?.supplier).toBeUndefined();
  expect(await findSupplier('Edit Supplier')).toMatchObject({ binding_count: 0 });
  const before = await suppliers();
  await database.addInventoryBinding(makeBinding('BLANK', '  '));
  expect(await suppliers()).toEqual(before);
});

it('registers successfully imported new and updated names and preserves blank Excel cells', async () => {
  const first = makeBinding('IMPORT', 'Import Supplier');
  expect(await database.importInventoryBindings([first])).toMatchObject({ inserted: 1, updated: 0 });
  expect(await findSupplier('Import Supplier')).toMatchObject({ binding_count: 1 });
  expect(await database.importInventoryBindings([{ ...first, supplier: 'Updated Import Supplier' }]))
    .toMatchObject({ inserted: 0, updated: 1 });
  expect(await findSupplier('Updated Import Supplier')).toMatchObject({ binding_count: 1 });
  expect(await database.importInventoryBindings([{ ...first, supplier: '' }]))
    .toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
  expect(await findSupplier('Updated Import Supplier')).toMatchObject({ binding_count: 1 });
});

it('does not register supplier names from duplicate adds or conflicting import rows', async () => {
  await expect(database.addInventoryBinding(makeBinding('IMPORT', 'Duplicate Supplier')))
    .rejects.toThrow('已存在');
  expect(await findSupplier('Duplicate Supplier')).toBeUndefined();
  const result = await database.importInventoryBindings([
    { ...makeBinding('CONFLICT', 'Conflict Supplier'), inventory_code: 'CODE-IMPORT' },
  ]);
  expect(result.conflicts).toHaveLength(1);
  expect(await findSupplier('Conflict Supplier')).toBeUndefined();
});

it('rolls back both the whole import and any newly registered names when a later row is invalid', async () => {
  await expect(database.importInventoryBindings([
    makeBinding('ROLLBACK', 'Rollback Supplier'),
    { ...makeBinding('INVALID', 'Invalid Supplier'), scan_model: '' },
  ])).rejects.toThrow('已取消整批导入');
  expect(await findSupplier('Rollback Supplier')).toBeUndefined();
  expect((await database.getAllInventoryBindings()).some(item => item.inventory_code === 'CODE-ROLLBACK')).toBe(false);
});

it('rolls back a binding insert if registering its supplier fails', async () => {
  mockSupplierWriteFailure = true;
  try {
    await expect(database.addInventoryBinding(makeBinding('FAIL-ADD', 'Failed Add Supplier')))
      .rejects.toThrow('Simulated supplier write failure');
  } finally { mockSupplierWriteFailure = false; }
  expect(await findSupplier('Failed Add Supplier')).toBeUndefined();
  expect((await database.getAllInventoryBindings()).some(item => item.inventory_code === 'CODE-FAIL-ADD')).toBe(false);
});

it('rolls back a supplier edit if registering the new name fails', async () => {
  const id = await database.addInventoryBinding(makeBinding('FAIL-EDIT', 'Original Supplier'));
  mockSupplierWriteFailure = true;
  try {
    await expect(database.updateInventoryBinding(id, { supplier: 'Failed Edit Supplier' }))
      .rejects.toThrow('Simulated supplier write failure');
  } finally { mockSupplierWriteFailure = false; }
  expect((await database.getAllInventoryBindings()).find(item => item.id === id)?.supplier).toBe('Original Supplier');
  expect(await findSupplier('Failed Edit Supplier')).toBeUndefined();
});

it('refuses to delete a used supplier based on all bindings and leaves those bindings untouched', async () => {
  const supplier = (await findSupplier('Supplier A'))!;
  const before = await database.getAllInventoryBindings();
  await expect(database.deleteInventorySupplier(supplier.id)).rejects.toThrow('正在被 2 条物料绑定使用');
  expect(await database.getAllInventoryBindings()).toEqual(before);
  expect(await findSupplier('Supplier A')).toEqual(supplier);
});

it('deletes unused names and permits deletion once the final binding stops using a name', async () => {
  const id = await database.addInventorySupplier('Unused Supplier');
  await database.deleteInventorySupplier(id);
  expect(await findSupplier('Unused Supplier')).toBeUndefined();
  const bindingId = await database.addInventoryBinding(makeBinding('DELETE', 'Release Supplier'));
  const used = (await findSupplier('Release Supplier'))!;
  await database.deleteInventoryBinding(bindingId);
  await database.deleteInventorySupplier(used.id);
  expect(await findSupplier('Release Supplier')).toBeUndefined();
});

it('collects previously unregistered legacy binding text when opening the supplier catalogue', async () => {
  sqlite.prepare(`INSERT INTO [物料绑定]
    (id,scan_model,inventory_code,supplier,created_at) VALUES (?,?,?,?,?)`)
    .run('late-legacy', 'LATE-LEGACY', 'LATE-LEGACY', ' Late Supplier ', 'legacy-created');
  expect(await findSupplier('Late Supplier')).toMatchObject({ name: 'Late Supplier', binding_count: 1 });
});

it('keeps suppliers outside configuration JSON and preserves them during configuration restore', async () => {
  const before = await suppliers();
  const bindings = await database.getAllInventoryBindings();
  const backup = await database.exportBackupData();
  expect(backup).not.toHaveProperty('inventorySuppliers');
  expect(backup).not.toHaveProperty('inventoryBindings');
  expect((await database.importBackupData({ ...backup, inventoryBindings: [], inventorySuppliers: [] } as typeof backup)).success)
    .toBe(true);
  expect(await suppliers()).toEqual(before);
  expect(await database.getAllInventoryBindings()).toEqual(bindings);
});

it('retains the catalogue in a real full SQLite backup', async () => {
  const fs = requireNode('node:fs') as typeof import('node:fs');
  const os = requireNode('node:os') as typeof import('node:os');
  const path = requireNode('node:path') as typeof import('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-suppliers-test-'));
  const backupPath = path.join(directory, 'backup.db');
  try {
    sqlite.prepare('VACUUM INTO ?').run(backupPath);
    const copy = new DatabaseSync(backupPath, { readOnly: true });
    try {
      expect(copy.prepare('SELECT * FROM [物料供应商] ORDER BY id').all())
        .toEqual(sqlite.prepare('SELECT * FROM [物料供应商] ORDER BY id').all());
    } finally { copy.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const makeRule = (name: string, supplierId?: string, supplierName?: string) => ({
  name, description: '', separator: '/', fieldOrder: ['model', 'quantity'], isActive: true,
  supplierId, supplierName,
});

it('migrates old rule schema with a nullable association while keeping old supplier notes unlinked', async () => {
  expect(sqlite.prepare('PRAGMA table_info([扫码解析规则])').all()).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'supplier_id', notnull: 0 })])
  );
  const id = await database.addRule(makeRule('Legacy supplier note', undefined, 'Supplier A'));
  expect(await database.getRuleById(id)).toMatchObject({ supplierName: 'Supplier A' });
  expect((await database.getRuleById(id))?.supplierId).toBeUndefined();
  expect((await findSupplier('Supplier A'))?.rule_count).toBe(0);
});

it('uses canonical supplier names, counts multiple associated rules and protects referenced suppliers', async () => {
  const supplierId = await database.addInventorySupplier('Rules Supplier');
  const first = await database.addRule(makeRule('Linked first', supplierId, 'Wrong snapshot'));
  const second = await database.addRule(makeRule('Linked second', supplierId));
  expect(await database.getRuleById(first)).toMatchObject({ supplierId, supplierName: 'Rules Supplier' });
  expect(await database.getInventorySupplierById(supplierId)).toMatchObject({ id: supplierId, name: 'Rules Supplier' });
  expect(await findSupplier('Rules Supplier')).toMatchObject({ rule_count: 2, binding_count: 0 });
  await expect(database.deleteInventorySupplier(supplierId)).rejects.toThrow('2 条解析规则');
  await database.updateRule(first, { supplierId: '' });
  expect((await database.getRuleById(first))?.supplierId).toBeUndefined();
  expect((await database.getRuleById(first))?.supplierName).toBeUndefined();
  await database.deleteRule(second);
  await database.deleteInventorySupplier(supplierId);
  expect(await database.getInventorySupplierById(supplierId)).toBeNull();
});

it('rejects stale associations and preserves an existing rule when editing to a missing supplier', async () => {
  await expect(database.addRule(makeRule('Stale add', 'missing'))).rejects.toThrow('供应商不存在');
  const id = await database.addRule(makeRule('Valid old note', undefined, 'Supplier note'));
  await expect(database.updateRule(id, { supplierId: 'missing', name: 'Should roll back' }))
    .rejects.toThrow('供应商不存在');
  expect(await database.getRuleById(id)).toMatchObject({ name: 'Valid old note', supplierName: 'Supplier note' });
  const supplierId = await database.addInventorySupplier('Edited Rule Supplier');
  await database.updateRule(id, { supplierId, supplierName: 'Stale supplied name' });
  expect(await database.getRuleById(id)).toMatchObject({ supplierId, supplierName: 'Edited Rule Supplier' });
});

it('rebuilds explicit rule suppliers by name across devices without importing a complete catalogue or materials', async () => {
  const supplierId = await database.addInventorySupplier('Portable Supplier');
  const ruleId = await database.addRule(makeRule('Portable rule', supplierId));
  const backup = await database.exportBackupData();
  const bindings = await database.getAllInventoryBindings();
  const portable = backup.rules.find(rule => rule.id === ruleId)!;
  expect(portable).toMatchObject({ supplierId, supplierName: 'Portable Supplier' });
  const restored = await database.importBackupData({ ...backup, rules: backup.rules.map(rule =>
    rule.id === ruleId ? { ...rule, supplierId: 'another-device-id', supplierName: 'portable supplier' } : rule) });
  expect(restored.success).toBe(true);
  expect(await database.getRuleById(ruleId)).toMatchObject({ supplierId, supplierName: 'Portable Supplier' });
  const newBackup = { ...backup, rules: [{ ...portable, id: 'new-device-rule', supplierId: 'foreign-id', supplierName: 'New Remote Supplier' }] };
  expect((await database.importBackupData(newBackup)).success).toBe(true);
  const created = (await findSupplier('New Remote Supplier'))!;
  expect(created.id).not.toBe('foreign-id');
  expect(await database.getRuleById('new-device-rule')).toMatchObject({ supplierId: created.id, supplierName: created.name });
  expect(await database.getAllInventoryBindings()).toEqual(bindings);
});

it('rolls back new suppliers and all replaced rules when configuration rule insertion fails', async () => {
  const backup = await database.exportBackupData();
  const beforeSuppliers = await suppliers();
  mockRuleWriteFailure = true;
  try {
    expect((await database.importBackupData({ ...backup, rules: [{
      ...backup.rules[0], id: 'failed-remote', supplierId: 'foreign-failed', supplierName: 'Failed Remote Supplier',
    }] })).success).toBe(false);
  } finally { mockRuleWriteFailure = false; }
  expect(await database.getAllRules()).toEqual(backup.rules);
  expect(await suppliers()).toEqual(beforeSuppliers);
});

it('never treats legacy name-only configuration as an association, and reads exact inventory codes without supplier fallback', async () => {
  const backup = await database.exportBackupData();
  expect((await database.importBackupData({ ...backup, rules: [{
    ...backup.rules[0], id: 'legacy-restore-rule', supplierId: undefined, supplierName: 'Unregistered legacy note',
  }] })).success).toBe(true);
  expect((await database.getRuleById('legacy-restore-rule'))?.supplierId).toBeUndefined();
  expect(await findSupplier('Unregistered legacy note')).toBeUndefined();
  const id = await database.addInventoryBinding(makeBinding('EXACT-EMPTY', ''));
  expect(await database.getInventoryBindingByCode(' code-exact-empty ')).toMatchObject({ id, inventory_code: 'CODE-EXACT-EMPTY' });
  expect((await database.getInventoryBindingByCode('CODE-EXACT-EMPTY'))?.supplier).toBeUndefined();
  expect(await database.getInventoryBindingByCode('unknown-code')).toBeNull();
});

it('rejects linked configuration missing its supplier name before replacing local data', async () => {
  const backup = await database.exportBackupData();
  const beforeSuppliers = await suppliers();
  const result = await database.importBackupData({ ...backup, rules: [{
    ...backup.rules[0], supplierId: 'nonportable-id', supplierName: '',
  }] });
  expect(result).toMatchObject({ success: false, message: expect.stringContaining('缺少关联的供应商名称') });
  expect(await database.getAllRules()).toEqual(backup.rules);
  expect(await suppliers()).toEqual(beforeSuppliers);
});

it('performs supplier and exact-code lookup while SQLite is query-only', async () => {
  const supplier = (await suppliers())[0];
  sqlite.exec('PRAGMA query_only = ON');
  try {
    expect(await database.getInventorySupplierById(supplier.id)).toMatchObject({ id: supplier.id, name: supplier.name });
    expect(await database.getInventoryBindingByCode('CODE-OLD-1')).toMatchObject({ inventory_code: 'CODE-OLD-1' });
  } finally { sqlite.exec('PRAGMA query_only = OFF'); }
});
