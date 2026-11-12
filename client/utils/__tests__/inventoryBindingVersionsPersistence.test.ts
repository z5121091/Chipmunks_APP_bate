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
  closeAsync: async () => { /* Simulate reopening the same persisted database. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) =>
    (sqlite.prepare(sql).get(...params) || null) as T | null,
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
  // An actual pre-feature table exercises upgrading without exporting/reimporting bindings.
  sqlite.exec(`CREATE TABLE [物料绑定] (
    id TEXT PRIMARY KEY, scan_model TEXT NOT NULL, version TEXT DEFAULT '',
    inventory_code TEXT NOT NULL UNIQUE, supplier TEXT, description TEXT,
    created_at TEXT NOT NULL, UNIQUE(scan_model, version));
    INSERT INTO [物料绑定] VALUES
      ('LEGACY', 'LEGACY-MODEL', 'R/8', 'LEGACY-CODE', '旧供应商', NULL, '2026-09-01');`);
  database = require('../database');
  await database.initDatabase();
});

afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('upgrades an old single-version database without changing punctuation or existing identity', async () => {
  expect(await database.getInventoryBindingByCode('LEGACY-CODE')).toMatchObject({
    id: 'LEGACY', version: 'R/8', versions: ['R/8'], supplier: '旧供应商',
  });
  expect(await database.getExactInventoryCodeByModelVersion('legacy-model', 'r/8')).toBe('LEGACY-CODE');
  expect(await database.getExactInventoryCodeByModelVersion('LEGACY-MODEL', 'R')).toBeNull();
});

it('matches any whole configured version and keeps exact matches ahead of a generic binding', async () => {
  const id = await database.addInventoryBinding({
    scan_model: 'OR-MODEL', inventory_code: 'OR-CODE',
    versions: [' V1 ', 'v1', '', ' V2 ', 'V2'], supplier: '两个版本的供应商',
  });
  await database.addInventoryBinding({ scan_model: 'OR-MODEL', inventory_code: 'OR-GENERIC' });
  expect(await database.getInventoryBindingByCode('OR-CODE')).toMatchObject({
    id, version: 'V1', versions: ['V1', 'V2'],
  });
  for (const version of ['V1', ' v2 ']) {
    expect(await database.getInventoryBindingMatchByModel(' or-model ', version))
      .toEqual({ inventoryCode: 'OR-CODE', matchKind: 'exact' });
    expect(await database.getExactInventoryCodeByModelVersion('or-model', version)).toBe('OR-CODE');
  }
  expect(await database.getExactInventoryCodeByModelVersion('OR-MODEL', 'V10')).toBeNull();
  expect(await database.getInventoryBindingMatchByModel('OR-MODEL', 'V10'))
    .toEqual({ inventoryCode: 'OR-GENERIC', matchKind: 'generic' });
  expect(await database.getInventoryCodeByModel('OR-MODEL')).toBe('OR-GENERIC');
  expect(await database.getSupplierForInventoryBinding({ scanModel: 'OR-MODEL', version: 'V2' }))
    .toBe('两个版本的供应商');
});

it('hydrates all versions in lists, pagination, and searches for a non-primary version', async () => {
  const id = await database.addInventoryBinding({
    scan_model: 'SEARCH-MULTI', inventory_code: 'SEARCH-CODE', versions: ['FIRST', 'find-this-version'],
  });
  expect((await database.getAllInventoryBindings()).find(row => row.id === id)?.versions)
    .toEqual(['FIRST', 'find-this-version']);
  const page = await database.getInventoryBindingsPage({ keyword: 'find-this-version', pageSize: 10 });
  expect(page.total).toBe(1);
  expect(page.items).toEqual([expect.objectContaining({ id, versions: ['FIRST', 'find-this-version'] })]);
});

it('rejects overlapping secondary versions without partially saving a binding or supplier', async () => {
  await database.addInventoryBinding({
    scan_model: 'CONFLICT-MODEL', inventory_code: 'CONFLICT-A', versions: ['A', 'B'],
  });
  await expect(database.addInventoryBinding({
    scan_model: 'conflict-model', inventory_code: 'CONFLICT-B',
    versions: ['C', ' b '], supplier: '不能保存的供应商',
  })).rejects.toThrow();
  expect(await database.getInventoryBindingByCode('CONFLICT-B')).toBeNull();
  expect(await database.getExactInventoryCodeByModelVersion('CONFLICT-MODEL', 'C')).toBeNull();
  expect((await database.getInventorySuppliers()).some(row => row.name === '不能保存的供应商')).toBe(false);
  // The same version is valid for another model.
  await expect(database.addInventoryBinding({
    scan_model: 'ANOTHER-MODEL', inventory_code: 'CONFLICT-C', versions: ['B'],
  })).resolves.toEqual(expect.any(String));
});

it('replaces configured versions on edit while preserving the original binding ID', async () => {
  const id = await database.addInventoryBinding({
    scan_model: 'EDIT-MODEL', inventory_code: 'EDIT-CODE', versions: ['V1', 'V2'],
  });
  await database.updateInventoryBinding(id, { versions: ['V2', 'V3'] });
  expect(await database.getInventoryBindingByCode('EDIT-CODE')).toMatchObject({ id, version: 'V2', versions: ['V2', 'V3'] });
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-MODEL', 'V1')).toBeNull();
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-MODEL', 'V2')).toBe('EDIT-CODE');
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-MODEL', 'V3')).toBe('EDIT-CODE');
  await database.updateInventoryBinding(id, { supplier: '只修改供应商' });
  expect((await database.getInventoryBindingByCode('EDIT-CODE'))?.versions).toEqual(['V2', 'V3']);
  await database.updateInventoryBinding(id, { versions: [] });
  expect(await database.getInventoryBindingByCode('EDIT-CODE')).toMatchObject({ version: '', versions: [] });
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-MODEL', 'V3')).toBeNull();
  expect(await database.getInventoryCodeByModel('EDIT-MODEL', 'OTHER')).toBe('EDIT-CODE');
});

it('rolls back a model edit when an added version would overlap another binding', async () => {
  await database.addInventoryBinding({ scan_model: 'EDIT-TARGET', inventory_code: 'EDIT-TARGET-CODE', versions: ['A', 'B'] });
  const id = await database.addInventoryBinding({ scan_model: 'EDIT-SOURCE', inventory_code: 'EDIT-SOURCE-CODE', versions: ['B', 'C'] });
  await expect(database.updateInventoryBinding(id, { scan_model: 'EDIT-TARGET', description: '不应保存' })).rejects.toThrow();
  expect(await database.getInventoryBindingByCode('EDIT-SOURCE-CODE')).toMatchObject({ scan_model: 'EDIT-SOURCE', versions: ['B', 'C'] });
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-SOURCE', 'C')).toBe('EDIT-SOURCE-CODE');
  expect(await database.getExactInventoryCodeByModelVersion('EDIT-TARGET', 'C')).toBeNull();
});

it('saves metadata through the editor and import without rewriting aliases or scan history', async () => {
  const binding = { scan_model: 'METADATA-MODEL', inventory_code: 'METADATA-CODE', versions: ['V1', 'V2', 'V3'] };
  const id = await database.addInventoryBinding(binding);
  sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, model, version, quantity, inventory_code, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('METADATA-SCAN', 'METADATA-ORDER', binding.scan_model, 'V2', 10, binding.inventory_code, '2026-11-05');
  sqlite.exec(`
    CREATE TEMP TRIGGER forbid_metadata_alias_rewrite BEFORE DELETE ON [物料绑定版本]
    BEGIN SELECT RAISE(ABORT, 'metadata save rewrote aliases'); END;
    CREATE TEMP TRIGGER forbid_metadata_history_rewrite BEFORE UPDATE OF inventory_code ON [出库明细]
    WHEN OLD.id = 'METADATA-SCAN'
    BEGIN SELECT RAISE(ABORT, 'metadata save rewrote scan history'); END;
  `);
  try {
    await database.updateInventoryBinding(id, { ...binding, supplier: '编辑供应商' });
    expect(await database.importInventoryBindings([{ ...binding, description: '导入备注' }]))
      .toMatchObject({ updated: 1, conflicts: [] });
    expect(await database.getInventoryBindingByCode(binding.inventory_code)).toMatchObject({
      id, versions: binding.versions, supplier: '编辑供应商', description: '导入备注',
    });
  } finally {
    sqlite.exec('DROP TRIGGER forbid_metadata_alias_rewrite; DROP TRIGGER forbid_metadata_history_rewrite;');
  }
});

it('adds imported versions to the existing same-model/code binding and preserves old versions', async () => {
  const id = await database.addInventoryBinding({ scan_model: 'IMPORT-MODEL', inventory_code: 'IMPORT-CODE', version: 'R/8' });
  const result = await database.importInventoryBindings([{
    scan_model: 'import-model', inventory_code: 'import-code', versions: ['R/8', 'R,16'], supplier: '导入供应商',
  }]);
  expect(result).toMatchObject({ inserted: 0, updated: 1, conflicts: [] });
  expect(await database.getInventoryBindingByCode('IMPORT-CODE')).toMatchObject({ id, versions: ['R/8', 'R,16'] });
  expect(await database.getExactInventoryCodeByModelVersion('IMPORT-MODEL', 'R,16')).toBe('IMPORT-CODE');
  const second = await database.importInventoryBindings([{
    scan_model: 'IMPORT-MODEL', inventory_code: 'IMPORT-CODE', versions: ['R,16', 'R/32'],
  }]);
  expect(second.conflicts).toEqual([]);
  expect((await database.getInventoryBindingByCode('IMPORT-CODE'))?.versions).toEqual(['R/8', 'R,16', 'R/32']);
});

it('skips a whole conflicting import row without adopting its other free versions', async () => {
  await database.addInventoryBinding({ scan_model: 'IMPORT-CONFLICT', inventory_code: 'IMPORT-OWNER', versions: ['OWNED'] });
  const id = await database.addInventoryBinding({ scan_model: 'IMPORT-CONFLICT', inventory_code: 'IMPORT-OTHER', versions: ['ORIGINAL'] });
  const result = await database.importInventoryBindings([{
    scan_model: 'IMPORT-CONFLICT', inventory_code: 'IMPORT-OTHER', versions: ['NEW', 'OWNED'], description: '不应保存',
  }]);
  expect(result.conflicts).toHaveLength(1);
  expect(result.updated).toBe(0);
  expect(await database.getInventoryBindingByCode('IMPORT-OTHER')).toMatchObject({ id, versions: ['ORIGINAL'] });
  expect(await database.getExactInventoryCodeByModelVersion('IMPORT-CONFLICT', 'NEW')).toBeNull();
});

it('does not silently switch generic and explicit-version bindings during import', async () => {
  await database.addInventoryBinding({ scan_model: 'IMPORT-GENERIC', inventory_code: 'IMPORT-GENERIC-CODE' });
  await database.addInventoryBinding({ scan_model: 'IMPORT-EXPLICIT', inventory_code: 'IMPORT-EXPLICIT-CODE', versions: ['V1', 'V2'] });
  const result = await database.importInventoryBindings([
    { scan_model: 'IMPORT-GENERIC', inventory_code: 'IMPORT-GENERIC-CODE', versions: ['V1'] },
    { scan_model: 'IMPORT-EXPLICIT', inventory_code: 'IMPORT-EXPLICIT-CODE', versions: [] },
  ]);
  expect(result.conflicts).toHaveLength(2);
  expect((await database.getInventoryBindingByCode('IMPORT-GENERIC-CODE'))?.versions).toEqual([]);
  expect((await database.getInventoryBindingByCode('IMPORT-EXPLICIT-CODE'))?.versions).toEqual(['V1', 'V2']);
});

it('fills historical codes for every accepted version without rewriting the scanned version', async () => {
  const insert = sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, model, version, quantity, inventory_code, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const version of ['V1', 'V2', 'V10']) {
    insert.run(`HISTORY-${version}`, 'HISTORY-ORDER', 'HISTORY-MODEL', version, 10, '', '2026-11-05');
  }
  await database.addInventoryBinding({ scan_model: 'HISTORY-MODEL', inventory_code: 'HISTORY-CODE', versions: ['V1', 'V2'] });
  const rows = sqlite.prepare('SELECT version, inventory_code FROM [出库明细] WHERE model = ? ORDER BY version').all('HISTORY-MODEL');
  expect(rows).toEqual([
    { version: 'V1', inventory_code: 'HISTORY-CODE' },
    { version: 'V10', inventory_code: '' },
    { version: 'V2', inventory_code: 'HISTORY-CODE' },
  ]);
});

it('resolves secondary versions for uncoded legacy history without duplicating physical scans', async () => {
  await database.addInventoryBinding({ scan_model: 'JOIN-MULTI', inventory_code: 'JOIN-CODE', versions: ['PRIMARY', 'SECONDARY'] });
  const insert = sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, warehouse_id, model, version, quantity, inventory_code, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const id of ['JOIN-SCAN-1', 'JOIN-SCAN-2']) {
    insert.run(id, 'JOIN-ORDER', 'JOIN-W', 'JOIN-MULTI', 'SECONDARY', 10, '', '2026-11-05');
  }
  const rows = await database.getMaterialsByOrder('JOIN-ORDER', 'JOIN-W');
  expect(rows).toHaveLength(2);
  expect(rows.map(row => [row.inventory_code, row.version])).toEqual([
    ['JOIN-CODE', 'SECONDARY'], ['JOIN-CODE', 'SECONDARY'],
  ]);
  const exported = (await database.getOutboundExportRows('JOIN-W')).filter(row => row.order_no === 'JOIN-ORDER');
  expect(exported).toHaveLength(2);
  expect(exported.map(row => row.inventory_code)).toEqual(['JOIN-CODE', 'JOIN-CODE']);
});

it('keeps return-linked history protected when the protected version is a secondary version', async () => {
  const warehouse = { id: 'MULTI-RETURN-W', name: '多版本退货仓' };
  const id = await database.addInventoryBinding({ scan_model: 'RETURN-MULTI', inventory_code: 'RETURN-MULTI-A', versions: ['V1', 'V2'] });
  const source = {
    id: 'MULTI-RETURN-SOURCE', order_no: 'MULTI-RETURN-OUT', customer_name: '客户 A',
    model: 'RETURN-MULTI', version: 'V2', batch: 'LOT', quantity: 100,
    inventory_code: 'RETURN-MULTI-A', traceNo: 'MULTI-RETURN-TRACE',
    warehouse_id: warehouse.id, warehouse_name: warehouse.name, erp_account_key: 'shanghai-chipmunk',
    operation_type: 'outbound' as const, raw_content: 'RETURN-MULTI/V2/100', scanned_at: '2026-11-05T01:00:00Z',
  };
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  await database.saveSalesReturnWithOrder({ material: { ...source, id: 'MULTI-RETURN-IN', order_no: 'MULTI-RETURN-IN' }, requiredQuantity: 100 });
  await expect(database.updateInventoryBinding(id, { inventory_code: 'RETURN-MULTI-B', versions: ['V1', 'V2', 'V3'] }))
    .rejects.toThrow('已关联销售退货');
  expect(await database.getInventoryBindingByCode('RETURN-MULTI-A')).toMatchObject({ id, versions: ['V1', 'V2'] });
  expect(await database.getInventoryBindingByCode('RETURN-MULTI-B')).toBeNull();
  expect(await database.getExactInventoryCodeByModelVersion('RETURN-MULTI', 'V3')).toBeNull();
});

it('reopens multiple versions and removes their aliases when the binding is deleted', async () => {
  const id = await database.addInventoryBinding({ scan_model: 'REOPEN-MODEL', inventory_code: 'REOPEN-CODE', versions: ['A', 'B', 'C'] });
  await database.reinitializeDatabase();
  expect(await database.getInventoryBindingByCode('REOPEN-CODE')).toMatchObject({ id, versions: ['A', 'B', 'C'] });
  expect(await database.getInventoryCodeByModel('REOPEN-MODEL', 'C')).toBe('REOPEN-CODE');
  await database.deleteInventoryBinding(id);
  expect(await database.getInventoryBindingByCode('REOPEN-CODE')).toBeNull();
  expect(await database.getExactInventoryCodeByModelVersion('REOPEN-MODEL', 'B')).toBeNull();
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM [物料绑定版本] WHERE binding_id = ?').get(id)).toEqual({ count: 0 });
});

it('accepts a complete older backup lacking the new optional alias table', async () => {
  sqlite.exec('ALTER TABLE [物料绑定版本] RENAME TO [测试保留的物料绑定版本]');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).resolves.toBeUndefined();
  } finally {
    sqlite.exec('ALTER TABLE [测试保留的物料绑定版本] RENAME TO [物料绑定版本]');
  }
});

it('rejects an incomplete alias table when it is present in a restored database', async () => {
  sqlite.exec('ALTER TABLE [物料绑定版本] RENAME TO [测试保留的物料绑定版本]');
  sqlite.exec('CREATE TABLE [物料绑定版本] (binding_id TEXT)');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .rejects.toThrow('数据库表 物料绑定版本 缺少字段');
  } finally {
    sqlite.exec('DROP TABLE [物料绑定版本]');
    sqlite.exec('ALTER TABLE [测试保留的物料绑定版本] RENAME TO [物料绑定版本]');
  }
});
