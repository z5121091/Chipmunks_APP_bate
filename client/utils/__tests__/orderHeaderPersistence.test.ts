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
let mockTransactions = 0;
let mockCheckpoints = 0;
let mockBusyCheckpoint = false;
let mockFailUnpackUpdate = false;
let mockBeforeOrderUpdate: (() => Promise<void>) | undefined;
const mockAdapter = {
  closeAsync: async () => { /* Simulate reopening this same persisted fixture. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) => {
    if (sql === 'PRAGMA wal_checkpoint(FULL)') {
      mockCheckpoints++;
      if (mockBusyCheckpoint) return { busy: 1, log: 1, checkpointed: 0 } as T;
    }
    return (sqlite.prepare(sql).get(...params) || null) as T | null;
  },
  runAsync: async (sql: string, params: string[] = []) => {
    if (sql.startsWith('UPDATE [出库单] SET ') && mockBeforeOrderUpdate) {
      const beforeUpdate = mockBeforeOrderUpdate;
      mockBeforeOrderUpdate = undefined;
      await beforeUpdate();
    }
    if (sql.startsWith('UPDATE [拆包记录] SET ') && mockFailUnpackUpdate) {
      throw new Error('fixture linked record update failed');
    }
    const result = sqlite.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  withExclusiveTransactionAsync: async (task: (db: SQLiteDatabase) => Promise<void>) => {
    mockTransactions++;
    sqlite.exec('BEGIN IMMEDIATE');
    try { await task(mockAdapter as unknown as SQLiteDatabase); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
let database: typeof import('../database');
const warehouse = { id: 'HEADER-W1', name: '无锡仓库' };
const otherWarehouse = { id: 'HEADER-W2', name: '无锡总仓' };

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  database = require('../database');
  await database.initDatabase();
});
beforeEach(() => {
  mockTransactions = mockCheckpoints = 0;
  mockBusyCheckpoint = mockFailUnpackUpdate = false;
  mockBeforeOrderUpdate = undefined;
});
afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('skips unchanged order transactions and does not advance the write checkpoint batch', async () => {
  await database.upsertOrder('HEADER-NOOP', '客户 A', warehouse);
  mockTransactions = mockCheckpoints = 0;
  for (let index = 0; index < 45; index++) {
    await database.upsertOrder('HEADER-NOOP', '客户 A', warehouse);
  }
  await database.upsertOrder('HEADER-NOOP');
  expect(mockTransactions).toBe(0);
  expect(mockCheckpoints).toBe(0);
  expect(await database.getOrder('HEADER-NOOP', warehouse.id)).toMatchObject({ customer_name: '客户 A' });
});

it('still writes changed customer and warehouse metadata and keeps other warehouses separate', async () => {
  await database.upsertOrder('HEADER-CHANGED', '客户 A', warehouse);
  await database.upsertOrder('HEADER-CHANGED', '另一仓客户', otherWarehouse);
  mockTransactions = 0;
  await database.upsertOrder('HEADER-CHANGED', '', { ...warehouse, name: '已更名仓库' });
  expect(mockTransactions).toBe(1);
  expect(await database.getOrder('HEADER-CHANGED', warehouse.id))
    .toMatchObject({ customer_name: '', warehouse_name: '已更名仓库' });
  expect(await database.getOrder('HEADER-CHANGED', otherWarehouse.id))
    .toMatchObject({ customer_name: '另一仓客户', warehouse_name: otherWarehouse.name });
});

it('adopts an old unassigned order and its material into the requested warehouse', async () => {
  await database.upsertOrder('HEADER-LEGACY', '客户 A');
  sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, customer_name, model, scanned_at) VALUES (?, ?, ?, ?, ?)`)
    .run('HEADER-LEGACY-MATERIAL', 'HEADER-LEGACY', '客户 A', 'MODEL', '2026-11-13');
  mockTransactions = 0;
  await database.upsertOrder('HEADER-LEGACY', undefined, warehouse);
  expect(mockTransactions).toBe(1);
  expect(await database.getOrder('HEADER-LEGACY', warehouse.id))
    .toMatchObject({ warehouse_id: warehouse.id, warehouse_name: warehouse.name });
  expect(sqlite.prepare('SELECT warehouse_id, warehouse_name FROM [出库明细] WHERE id = ?')
    .get('HEADER-LEGACY-MATERIAL')).toEqual({ warehouse_id: warehouse.id, warehouse_name: warehouse.name });
});

it('evaluates a queued no-op only after an earlier order change has committed', async () => {
  await database.upsertOrder('HEADER-SERIAL', '原客户', warehouse);
  let reachUpdate!: () => void;
  let releaseUpdate!: () => void;
  const reached = new Promise<void>(resolve => { reachUpdate = resolve; });
  const release = new Promise<void>(resolve => { releaseUpdate = resolve; });
  mockBeforeOrderUpdate = async () => { reachUpdate(); await release; };
  mockTransactions = 0;
  const first = database.upsertOrder('HEADER-SERIAL', '新客户', warehouse);
  await reached;
  let secondFinished = false;
  const second = database.upsertOrder('HEADER-SERIAL', '原客户', warehouse).then(() => { secondFinished = true; });
  await Promise.resolve();
  expect(secondFinished).toBe(false);
  releaseUpdate();
  await Promise.all([first, second]);
  expect(mockTransactions).toBe(2);
  expect(await database.getOrder('HEADER-SERIAL', warehouse.id)).toMatchObject({ customer_name: '原客户' });
});

it('coalesces concurrent identical saves without creating duplicate headers or empty transactions', async () => {
  await Promise.all([
    database.upsertOrder('HEADER-CONCURRENT', '客户 A', warehouse),
    database.upsertOrder('HEADER-CONCURRENT', '客户 A', warehouse),
  ]);
  expect(mockTransactions).toBe(1);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM [出库单] WHERE order_no = ?').get('HEADER-CONCURRENT'))
    .toEqual({ count: 1 });
});

it('rolls back header and linked material changes when a later linked update fails', async () => {
  await database.upsertOrder('HEADER-ROLLBACK', '客户 A', warehouse);
  sqlite.prepare(`INSERT INTO [出库明细]
    (id, order_no, customer_name, warehouse_id, warehouse_name, model, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('HEADER-ROLLBACK-MATERIAL', 'HEADER-ROLLBACK', '客户 A', warehouse.id, warehouse.name, 'MODEL', '2026-11-13');
  mockFailUnpackUpdate = true;
  try {
    await expect(database.upsertOrder('HEADER-ROLLBACK', '客户 B', warehouse))
      .rejects.toThrow('fixture linked record update failed');
  } finally { mockFailUnpackUpdate = false; }
  expect(await database.getOrder('HEADER-ROLLBACK', warehouse.id)).toMatchObject({ customer_name: '客户 A' });
  expect(sqlite.prepare('SELECT customer_name FROM [出库明细] WHERE id = ?').get('HEADER-ROLLBACK-MATERIAL'))
    .toEqual({ customer_name: '客户 A' });
});

it('retains real-write checkpoint batching and repairs a pending checkpoint even before a no-op', async () => {
  mockBusyCheckpoint = true;
  try {
    for (let index = 0; index < 20; index++) {
      await database.upsertOrder(`HEADER-CHECKPOINT-${index}`, '客户 A', warehouse);
    }
    expect(mockCheckpoints).toBeGreaterThan(0);
  } finally { mockBusyCheckpoint = false; }
  mockTransactions = mockCheckpoints = 0;
  await database.upsertOrder('HEADER-CHECKPOINT-19', '客户 A', warehouse);
  expect(mockCheckpoints).toBe(1);
  expect(mockTransactions).toBe(0);
  mockCheckpoints = 0;
  await database.upsertOrder('HEADER-CHECKPOINT-19', '客户 A', warehouse);
  expect(mockCheckpoints).toBe(0);
});
