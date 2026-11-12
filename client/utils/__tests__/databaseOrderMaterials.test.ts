import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { GEEHY_SCAN_SAMPLES } from '@/utils/testFixtures/geehyScans';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));

const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');
const sqlite = new DatabaseSync(':memory:');
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
type BindValue = string | number | null;
const mockReads: { sql: string; params: BindValue[] }[] = [];
const mockAdapter = {
  closeAsync: async () => undefined,
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: BindValue[] = []) => {
    mockReads.push({ sql, params });
    return sqlite.prepare(sql).all(...params) as T[];
  },
  getFirstAsync: async <T,>(sql: string, params: BindValue[] = []) =>
    (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: BindValue[] = []) => {
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

// Previous native query is an independent result oracle, not used by the new implementation.
const legacySql = `SELECT m.*,
  COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
  FROM [出库明细] m LEFT JOIN (
    SELECT TRIM(scan_model) AS scan_model, COALESCE(TRIM(version), '') AS version,
      CASE WHEN COUNT(DISTINCT NULLIF(UPPER(TRIM(inventory_code)), '')) = 1
        THEN MIN(NULLIF(TRIM(inventory_code), '')) ELSE NULL END AS inventory_code,
      CASE WHEN COUNT(DISTINCT NULLIF(TRIM(supplier), '') COLLATE NOCASE) = 1
        THEN MIN(NULLIF(TRIM(supplier), '')) ELSE NULL END AS supplier
    FROM [物料绑定]
    GROUP BY TRIM(scan_model) COLLATE NOCASE, COALESCE(TRIM(version), '') COLLATE NOCASE
  ) ib ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(m.model) COLLATE NOCASE
    AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE = COALESCE(TRIM(m.version), '') COLLATE NOCASE
  WHERE m.order_no = ?`;
const previousRows = (warehouse?: string) => sqlite.prepare(
  `${legacySql}${warehouse ? ' AND m.warehouse_id = ?' : ''} ORDER BY m.scanned_at DESC, m.id DESC`
).all(...(warehouse ? ['ORDER', warehouse] : ['ORDER'])).map(row => ({
  ...row, customFields: row.customFields ? JSON.parse(String(row.customFields)) : undefined,
  isUnpacked: row.isUnpacked === 1,
}));
const addBinding = (id: string, model: string, version: string | null, code: string, supplier = 'Supplier A') =>
  sqlite.prepare('INSERT INTO [物料绑定] (id, scan_model, version, inventory_code, supplier, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, model, version, code, supplier, '2026-11-03');
const addScan = (id: string, model: string, version: string | null, code: string | null,
  warehouse = 'W1', date = '2026-11-03T10:00:00Z', order = 'ORDER') =>
  sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, model, version, inventory_code, warehouse_id, scanned_at, quantity, customFields, isUnpacked)
    VALUES (?, ?, ?, ?, ?, ?, ?, 40, '{"fixture":"kept"}', 1)`)
    .run(id, order, model, version, code, warehouse, date);

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  database = require('../database');
  await database.initDatabase();
});
beforeEach(() => {
  sqlite.exec('DELETE FROM [出库明细]; DELETE FROM [物料绑定]');
  mockReads.length = 0;
});
afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('preserves complete legacy results, ambiguity protection, exact versions, and physical scan ordering', async () => {
  addBinding('same1', 'Same', 'V1', 'Code-A');
  addBinding('same2', ' same ', ' v1 ', 'code-a', 'Supplier B');
  addBinding('version', 'Same', 'V2', 'Code-V2');
  addBinding('amb1', 'Ambiguous', '', 'Amb-A');
  addBinding('amb2', ' ambiguous ', ' ', 'Amb-B');
  addBinding('empty', 'NoVersion', null, 'Empty-Version');
  addBinding('upper', 'Ä-MODEL', '', 'Unicode-Upper');
  addBinding('lower', 'ä-MODEL', '', 'Unicode-Lower');
  addBinding('tabs', '\tModel\t', '\tV\t', 'Tabs-Preserved');
  addBinding('newline', 'Line \n', '', 'Newline-Preserved');
  addBinding('blank', 'BlankCode', '', ' ');
  addScan('persisted', 'Ambiguous', '', ' PERSISTED ', 'W1', '2026-11-03T12:00:00Z');
  addScan('same1', ' SAME ', 'v1', '');
  addScan('same2', 'same', ' V1 ', null);
  addScan('version', 'Same', 'V2', '');
  addScan('version-missing', 'Same', 'V3', '');
  addScan('ambiguous', 'Ambiguous', '', '');
  addScan('empty', ' noversion ', ' ', '');
  addScan('unicode-upper', 'Ä-model', '', '');
  addScan('unicode-lower', 'ä-model', '', '');
  addScan('tabs', '\tModel\t', '\tV\t', '');
  addScan('newline', 'Line \n', '', '');
  addScan('tabs-distinct', 'Model', 'V', '');
  addScan('unbound', 'Missing', '', '');
  addScan('blank-code', 'BlankCode', '', '');
  addScan('other-warehouse', 'Same', 'V1', '', 'W2');
  addScan('other-order', 'Same', 'V1', '', 'W1', undefined, 'OTHER');
  const expected = previousRows('W1');
  expect(await database.getMaterialsByOrder(' ORDER ', ' W1 ')).toEqual(expected);
  expect(await database.getMaterialsByOrder('ORDER')).toEqual(previousRows());
  const byId = new Map((await database.getMaterialsByOrder('ORDER', 'W1')).map(row => [row.id, row]));
  expect(byId.size).toBe(14);
  expect(byId.get('persisted')?.inventory_code).toBe('PERSISTED');
  expect(byId.get('same1')?.inventory_code).toBe('Code-A');
  expect(byId.get('same2')?.inventory_code).toBe('Code-A');
  expect(byId.get('version')?.inventory_code).toBe('Code-V2');
  expect(byId.get('ambiguous')?.inventory_code).toBeNull();
  expect(byId.get('version-missing')?.inventory_code).toBeNull();
  expect(byId.get('unicode-upper')?.inventory_code).toBe('Unicode-Upper');
  expect(byId.get('unicode-lower')?.inventory_code).toBe('Unicode-Lower');
  expect(byId.get('tabs')?.inventory_code).toBe('Tabs-Preserved');
  expect(byId.get('newline')?.inventory_code).toBe('Newline-Preserved');
  expect(byId.get('tabs-distinct')?.inventory_code).toBeNull();
});

it('queries only distinct missing model/version keys and batches below SQLite bind limits', async () => {
  for (let i = 0; i < 205; i++) {
    addBinding(`B${i}`, `M${i}`, 'V', `CODE${i}`);
    addScan(`R${i}`, `M${i}`, 'V', '');
  }
  addScan('duplicate-physical-scan', ' m0 ', ' v ', '');
  addScan('coded', 'Already', '', 'KEEP');
  const expected = previousRows('W1');
  expect(await database.getMaterialsByOrder('ORDER', 'W1')).toEqual(expected);
  const bindingReads = mockReads.filter(read => read.sql.includes('FROM [物料绑定]'));
  expect(bindingReads).toHaveLength(3);
  expect(bindingReads.map(read => read.params.length)).toEqual([200, 200, 10]);
  expect(bindingReads.flatMap(read => read.params)).not.toContain('Already');
  expect(bindingReads.every(read => read.sql.includes('IN (VALUES'))).toBe(true);
});

it('does no binding query for coded or empty orders and preserves invalid-input behavior', async () => {
  addScan('R', 'Bound', '', ' CODE ');
  expect(await database.getMaterialsByOrder('ORDER', 'W1')).toEqual(previousRows('W1'));
  expect(mockReads).toHaveLength(1);
  expect(mockReads[0].sql).not.toMatch(/JOIN|GROUP BY|物料绑定/);
  mockReads.length = 0;
  expect(await database.getMaterialsByOrder('ORDER', 'W2')).toEqual([]);
  expect(mockReads).toHaveLength(1);
  mockReads.length = 0;
  expect(await database.getMaterialsByOrder('   ')).toEqual([]);
  expect(mockReads).toHaveLength(0);
});

it('reads return sources only once during a normal traced outbound commit', async () => {
  const sample = GEEHY_SCAN_SAMPLES[0];
  await database.addMaterialWithOrder({
    id: 'burst-normal-outbound', order_no: 'IO-2026-11-03-08', customer_name: 'Fixture customer',
    model: sample.model, batch: 'NYORY', quantity: sample.quantity, traceNo: sample.traceNo,
    raw_content: sample.raw, inventory_code: 'C0', warehouse_id: 'W1', warehouse_name: 'Fixture warehouse',
  });
  const sourceReads = mockReads.filter(read => read.sql.includes('FROM [销售退货记录]') || read.sql.includes('FROM [拆包记录]'));
  expect(sourceReads).toHaveLength(2);
  expect(sourceReads.filter(read => read.sql.includes('FROM [销售退货记录]'))).toHaveLength(1);
  expect(sourceReads.filter(read => read.sql.includes('FROM [拆包记录]'))).toHaveLength(1);
});

it('uses indexed trace lookups for legacy padded return and unpack identifiers', () => {
  const queries = [
    ['SELECT * FROM [销售退货记录] WHERE TRIM(traceNo) = ?', ['TRACE']],
    ["SELECT * FROM [拆包记录] WHERE label_type = 'remaining' AND (TRIM(traceNo) = ? OR TRIM(new_traceNo) = ?)", ['TRACE', 'TRACE']],
    ["SELECT m.* FROM [拆包记录] u JOIN [出库明细] m ON m.id = u.original_material_id WHERE (TRIM(u.traceNo) = ? OR TRIM(u.new_traceNo) = ?) AND (u.warehouse_id = ? OR u.warehouse_id IS NULL OR u.warehouse_id = '') ORDER BY CASE WHEN u.label_type = 'shipped' THEN 0 ELSE 1 END,u.unpacked_at DESC,u.id DESC LIMIT 1", ['TRACE', 'TRACE', 'W1']],
  ] as const;
  for (const [sql, params] of queries) {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => String(row.detail)).join('\n');
    expect(plan).not.toMatch(/SCAN (?:u\b|拆包记录|销售退货记录)/);
    expect(plan).toMatch(/USING INDEX/);
  }
});

it('indexes model/version binding lookups while preserving exact-version and generic fallback results', async () => {
  addBinding('bind-generic', ' APM32F103RBT6 ', '', 'GENERIC');
  addBinding('bind-v1', 'apm32f103rbt6', ' V1 ', 'VERSION-1');
  addBinding('bind-v2', 'APM32F103RBT6', 'V2', 'VERSION-2');
  expect(await database.getInventoryCodeByModel(' APM32F103RBT6 ', 'v1')).toBe('VERSION-1');
  expect(await database.getInventoryCodeByModel('apm32f103rbt6', 'V2')).toBe('VERSION-2');
  expect(await database.getInventoryCodeByModel('APM32F103RBT6', 'V3')).toBe('GENERIC');
  expect(await database.getInventoryCodeByModel('apm32f103rbt6')).toBe('GENERIC');
  expect(await database.getInventoryCodeByModel('UNKNOWN', 'V1')).toBeNull();
  for (const [query, params] of [
    ["SELECT inventory_code FROM [物料绑定] WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE", ['APM32F103RBT6', 'V1']],
    ["SELECT inventory_code FROM [物料绑定] WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ''", ['APM32F103RBT6']],
  ] as const) {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all(...params)
      .map(row => String(row.detail)).join('\n');
    expect(plan).not.toMatch(/SCAN 物料绑定/);
    expect(plan).toMatch(/USING INDEX/);
  }
});

it('compares real desktop SQLite query plans and timings for 10,000 bindings and 100 already-coded scans', async () => {
  sqlite.exec('BEGIN');
  for (let i = 0; i < 10_000; i++) addBinding(`B${i}`, `M${i}`, 'V', `C${i}`);
  for (let i = 0; i < 100; i++) addScan(`R${i}`, `M${i}`, 'V', `C${i}`);
  sqlite.exec('COMMIT');
  const expected = previousRows('W1');
  // Warm both paths, then alternate repeated samples; never assert device speed
  // from a synthetic desktop run or fail CI because another process uses CPU.
  expect(await database.getMaterialsByOrder('ORDER', 'W1')).toEqual(expected);
  const samples: { legacyMs: number; currentMs: number }[] = [];
  for (let sample = 0; sample < 3; sample++) {
    let started = performance.now();
    previousRows('W1');
    const legacyMs = performance.now() - started;
    mockReads.length = 0;
    started = performance.now();
    const actual = await database.getMaterialsByOrder('ORDER', 'W1');
    const currentMs = performance.now() - started;
    expect(actual).toEqual(expected);
    samples.push({ legacyMs: Number(legacyMs.toFixed(2)), currentMs: Number(currentMs.toFixed(2)) });
  }
  expect(mockReads).toHaveLength(1);
  const oldPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${legacySql} AND m.warehouse_id = ? ORDER BY m.scanned_at DESC, m.id DESC`)
    .all('ORDER', 'W1').map(row => row.detail);
  const newPlan = sqlite.prepare(`EXPLAIN QUERY PLAN ${mockReads[0].sql}`)
    .all(...mockReads[0].params).map(row => row.detail);
  expect(oldPlan.join(' ')).toMatch(/MATERIALIZE ib/);
  expect(newPlan.join(' ')).toContain('idx_materials_order_warehouse');
  expect(newPlan.join(' ')).not.toMatch(/MATERIALIZE|物料绑定|GROUP BY/);
  console.log('[desktop synthetic SQLite, not PDA]', JSON.stringify({ bindings: 10_000, scans: 100,
    samples, oldPlan, newPlan }));
});
