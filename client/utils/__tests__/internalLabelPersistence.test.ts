import { createRequire } from 'node:module';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import type { InternalLabelStock } from '../internalLabelCode';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockAdapter }));

const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');
const sqlite = new DatabaseSync(':memory:');
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
let mockFailJobInsert = false;
const mockAdapter = {
  closeAsync: async () => { /* Keep the fixture alive across initialization. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) =>
    (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: string[] = []) => {
    if (mockFailJobInsert && sql.includes('INSERT INTO [内部标签打印任务]')) throw new Error('fixture job insert failure');
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
let labels: typeof import('../internalLabels');
let printing: typeof import('../labelReprint');
const stock = (inventoryCode: string): InternalLabelStock => ({
  accountKey: 'shanghai-chipmunk', warehouseName: '无锡总仓', warehouseCode: '001',
  inventoryCode, inventoryName: '贴片电阻', specification: '12KΩ,±1%,0402', quantity: 100,
});

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  database = require('../database');
  labels = require('../internalLabels');
  printing = require('../labelReprint');
  await database.initDatabase();
});
afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('atomically rejects a competing registration while allowing multiple packs in one allocation', async () => {
  const item = stock('RES.CONCURRENT');
  const results = await Promise.allSettled([
    labels.createInternalLabelTasks(item, [40, 60]), labels.createInternalLabelTasks(item, [100]),
  ]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason.message).toContain('已有内部包装');
  const successful = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof labels.createInternalLabelTasks>>>;
  const rows = sqlite.prepare('SELECT id FROM [内部标签包装] WHERE inventory_code = ?').all(item.inventoryCode);
  expect(rows).toHaveLength(successful.value.length);
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
});

it('requires explicit confirmation for another allocation and keeps account/warehouse scopes independent', async () => {
  const item = stock('RES.EXPLICIT');
  await labels.createInternalLabelTasks(item, [40, 60]);
  await expect(labels.createInternalLabelTasks({ ...item, inventoryCode: 'res.explicit' }, [100]))
    .rejects.toThrow('已有内部包装');
  await expect(labels.createInternalLabelTasks(item, [100], { allowExistingStock: true })).resolves.toHaveLength(1);
  await expect(labels.createInternalLabelTasks({ ...item, warehouseCode: '002', warehouseName: '苏州仓' }, [100]))
    .resolves.toHaveLength(1);
  await expect(labels.createInternalLabelTasks({ ...item, accountKey: 'wuxi-duneng' }, [100])).resolves.toHaveLength(1);
});

it('rolls back package registration when its print job cannot be saved, allowing a clean retry', async () => {
  const item = stock('RES.ROLLBACK');
  mockFailJobInsert = true;
  try { await expect(labels.createInternalLabelTasks(item, [40, 60])).rejects.toThrow('fixture job insert failure'); }
  finally { mockFailJobInsert = false; }
  expect(await labels.findExistingInternalLabelPackage(item)).toBe(false);
  await expect(labels.createInternalLabelTasks(item, [40, 60])).resolves.toHaveLength(2);
});

it('blocks both newly scanned and previously prepared old-label reprints during replacement', async () => {
  const [created] = await labels.createInternalLabelTasks(stock('RES.PENDING'), [100]);
  const prepared = await printing.prepareLabelReprint(created.sourceQr);
  const correction = await printing.applyLabelQuantityCorrection(prepared, 90);
  // Existing warehouse work retains the physical label until explicit replacement.
  await expect(database.requireActiveInternalLabel(created.sourceQr)).resolves.toMatchObject({ quantity: 100 });
  await expect(printing.prepareLabelReprint(created.sourceQr)).rejects.toThrow('待换贴');
  await expect(database.checkInternalLabelPrint(prepared)).rejects.toThrow('待换贴');
  await expect(database.checkInternalLabelPrint(correction)).resolves.toBeUndefined();
  await database.storeInternalLabelPrintTask({ ...correction, status: 'submitted' });
  await expect(database.checkInternalLabelPrint(prepared)).rejects.toThrow('待换贴');
  await database.finishInternalLabelCorrection(correction.id, true);
  await expect(printing.prepareLabelReprint(created.sourceQr)).rejects.toThrow('版本已失效');
  await expect(printing.prepareLabelReprint(correction.sourceQr)).resolves.toMatchObject({ quantity: 90 });
});

it('restores old-label reprint eligibility when replacement is cancelled without reusing an issued revision', async () => {
  const [created] = await labels.createInternalLabelTasks(stock('RES.CANCEL'), [100]);
  const prepared = await printing.prepareLabelReprint(created.sourceQr);
  const correction = await printing.applyLabelQuantityCorrection(prepared, 90);
  await database.finishInternalLabelCorrection(correction.id, false);
  await expect(printing.prepareLabelReprint(created.sourceQr)).resolves.toMatchObject({ quantity: 100 });
  const next = await printing.applyLabelQuantityCorrection(await printing.prepareLabelReprint(created.sourceQr), 80);
  expect(next.sourceQr.endsWith('~#~3')).toBe(true);
  await expect(database.checkInternalLabelPrint(correction)).rejects.toThrow('已失效');
});

it('rejects a backup containing only HLS inbound references without its package registry', async () => {
  sqlite.exec('SAVEPOINT missing_internal_registry');
  try {
    sqlite.exec('ALTER TABLE [内部标签打印任务] RENAME TO [fixture_internal_jobs]');
    sqlite.exec('ALTER TABLE [内部标签包装] RENAME TO [fixture_internal_packages]');
    sqlite.exec(`INSERT INTO [入库记录]
      (id, inbound_no, warehouse_id, warehouse_name, scan_model, quantity, in_date, created_at, package_key)
      VALUES ('HLS-INBOUND', 'II-HLS', '001', '无锡总仓', '测试物料', 100, '2026-11-12', '2026-11-12', 'HLS:INBOUNDONLY1')`);
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .rejects.toThrow('备份含内部标签作业记录');
  } finally { sqlite.exec('ROLLBACK TO missing_internal_registry; RELEASE missing_internal_registry'); }
});

