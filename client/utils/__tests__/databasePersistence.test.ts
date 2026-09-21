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
let mockMigrationFailureId = '';
const mockAdapter = {
  closeAsync: async () => { /* Keep the in-memory fixture alive across simulated app restarts. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) => (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: string[] = []) => {
    if (mockMigrationFailureId && sql.includes('SET field_order =') && params.at(-1) === mockMigrationFailureId) {
      throw new Error('Simulated migration failure');
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
const account = 'shanghai-chipmunk';
const warehouse = { id: 'BATCH-W', name: '无锡总仓' };
const common = { warehouse_id: warehouse.id, warehouse_name: warehouse.name, erp_account_key: account,
  inventory_code: 'TEST-BATCH', batch: 'LOT-A', quantity: 2500 };
const receipt = { ...common, id: 'RECEIPT', inbound_no: 'II-TEST', scan_model: 'DEMO', in_date: '2026-09-10', traceNo: 'T-ORIGINAL' };
const material = { ...common, id: 'OUT', order_no: 'IO-2026-09-10-01', model: 'DEMO', traceNo: 'T-ORIGINAL',
  operation_type: 'outbound' as const, raw_content: 'DEMO/LOT-A/2500/T-ORIGINAL', scanned_at: '2026-09-10T01:00:00Z' };

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  database = require('../database');
  await database.initDatabase();
});
afterAll(() => {
  sqlite.close();
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('persists and updates a custom rule terminator in native SQLite and configuration backup', async () => {
  const ruleId = await database.addRule({
    name: '结束符持久化', description: '', separator: '&', terminator: ';',
    fieldOrder: ['model', 'productionDate'], isActive: true,
  });
  expect((await database.getAllRules()).find(item => item.id === ruleId)?.terminator).toBe(';');
  await database.updateRule(ruleId, { terminator: '\r\n' });
  expect((await database.exportBackupData()).rules.find(item => item.id === ruleId)?.terminator).toBe('\r\n');
});

it('keeps parsing-rule names unique after trimming and normalizing', async () => {
  const id = await database.addRule({
    name: 'Unique Rule Name', description: '', separator: '|', fieldOrder: ['model', 'quantity'], isActive: true,
  });
  await expect(database.addRule({
    name: '  ＵＮＩＱＵＥ　ＲＵＬＥ　ＮＡＭＥ  ', description: '', separator: ';', fieldOrder: ['model', 'quantity'], isActive: true,
  })).rejects.toThrow('解析规则名称“ＵＮＩＱＵＥ　ＲＵＬＥ　ＮＡＭＥ”已存在');
  await database.updateRule(id, { name: ' Unique Rule Name ' });
  expect((await database.getRuleById(id))?.name).toBe('Unique Rule Name');
});

it('round-trips local ignored fields and condition operators through SQLite and backup restore', async () => {
  const id = await database.addRule({
    name: '规则编辑优化', description: '', separator: '/', fieldOrder: ['ignore:1', 'model', 'quantity'],
    matchConditions: [{ fieldIndex: 0, keyword: 'PO-', operator: 'startsWith' }], isActive: true,
  });
  const read = () => database.getRuleById(id);
  expect((await read())?.matchConditions?.[0].operator).toBe('startsWith');
  await database.updateRule(id, { matchConditions: [{ fieldIndex: 0, keyword: 'PO-1', operator: 'equals' }] });
  const backup = await database.exportBackupData();
  await database.deleteRule(id);
  expect((await database.importBackupData(backup)).success).toBe(true);
  const restored = await read();
  expect(restored?.fieldOrder).toEqual(['ignore:1', 'model', 'quantity']);
  expect(restored?.matchConditions).toEqual([{ fieldIndex: 0, keyword: 'PO-1', operator: 'equals' }]);
  await expect(database.detectRule('PO-12/A/100', [restored!])).resolves.toBeNull();
  await expect(database.detectRule('PO-1/A/100', [restored!])).resolves.toEqual(restored);
  await expect(database.updateRule(id, { matchConditions: [{ fieldIndex: 0, keyword: 'PO', operator: 'bad' as never }] })).rejects.toThrow('识别条件类型无效');
});

it('migrates stored legacy rules atomically, keeps metadata and is idempotent on restart', async () => {
  const insert = sqlite.prepare(`INSERT INTO [扫码解析规则]
    (id,name,separator,field_order,custom_field_ids,field_prefixes,match_conditions,is_active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insert.run('legacy-inline', 'Inline', ';', JSON.stringify(['model', 'custom:old', 'quantity']),
    '["old"]', '{"custom:old":"PO:"}', '[{"fieldIndex":1,"keyword":"PO:PO-","operator":"startsWith"}]', 1, 'created', 'updated');
  insert.run('legacy-appended', 'Appended', ';', '["model","quantity"]', '["missing-definition"]',
    '{"custom:missing-definition":"DATE:"}', '[]', 0, 'created', 'updated');
  const raw = () => sqlite.prepare("SELECT * FROM [扫码解析规则] WHERE id LIKE 'legacy-%' ORDER BY id").all();
  const before = raw();
  mockMigrationFailureId = 'legacy-appended';
  try {
    await expect(database.reinitializeDatabase()).rejects.toThrow('Simulated migration failure');
    expect(raw()).toEqual(before);
  } finally {
    mockMigrationFailureId = '';
    await database.reinitializeDatabase();
  }
  const inline = (await database.getRuleById('legacy-inline'))!;
  expect(inline).toMatchObject({
    name: 'Inline', fieldOrder: ['model', 'ignore:1', 'quantity'], customFieldIds: [],
    fieldPrefixes: { 'ignore:1': 'PO:' }, isActive: true, created_at: 'created', updated_at: 'updated',
    matchConditions: [{ fieldIndex: 1, keyword: 'PO:PO-', operator: 'startsWith' }],
  });
  await expect(database.detectRule('A;PO:PO-123;100', [inline])).resolves.toEqual(inline);
  await expect(database.detectRule('A;OTHER:PO-123;100', [inline])).resolves.toBeNull();
  expect(database.parseWithRule('A;PO:PO-123;100', inline)).toEqual({ standardFields: { model: 'A', quantity: '100' }, customFields: {} });
  expect(await database.getRuleById('legacy-appended')).toMatchObject({
    fieldOrder: ['model', 'quantity', 'ignore:1'], fieldPrefixes: { 'ignore:1': 'DATE:' }, isActive: false,
  });
  const migrated = raw();
  expect(migrated.every(row => row.custom_field_ids === '[]' && !String(row.field_order).includes('custom:'))).toBe(true);
  await database.reinitializeDatabase();
  expect(raw()).toEqual(migrated);
});

it('restores old backups and legacy add/update inputs as ignored segments without global definitions', async () => {
  const backup = await database.exportBackupData();
  const base = { name: 'Old backup', description: '', separator: ';', isActive: true, created_at: 'old', updated_at: 'old' };
  backup.rules = [
    { ...base, id: 'restore-inline', fieldOrder: ['model', 'custom:slot', 'quantity'], customFieldIds: ['slot'],
      fieldPrefixes: { 'custom:slot': 'X:' }, matchConditions: [{ fieldIndex: 1, keyword: 'X:KEEP', operator: 'equals' }] },
    { ...base, id: 'restore-appended', fieldOrder: ['model', 'quantity'], customFieldIds: ['slot'], fieldPrefixes: { 'custom:slot': 'X:' } },
  ];
  backup.customFields = [{ id: 'slot', name: 'Old placeholder', type: 'text', required: false, sort_order: 1, created_at: 'old', updated_at: 'old' }];
  expect(await database.importBackupData(backup)).toMatchObject({ success: true });
  expect((await database.getRuleById('restore-inline'))?.fieldOrder).toEqual(['model', 'ignore:1', 'quantity']);
  expect(await database.getRuleById('restore-appended')).toMatchObject({
    name: 'Old backup (2)', fieldOrder: ['model', 'quantity', 'ignore:1'], fieldPrefixes: { 'ignore:1': 'X:' },
  });
  const inline = (await database.getRuleById('restore-inline'))!;
  await expect(database.detectRule('A;X:KEEP;100', [inline])).resolves.toEqual(inline);
  await expect(database.detectRule('A;X:KEEP-OTHER;100', [inline])).resolves.toBeNull();
  const exported = await database.exportBackupData();
  expect(exported.customFields).toEqual([]);
  expect(exported.rules.every(rule => !rule.fieldOrder.some(field => field.startsWith('custom:')))).toBe(true);
  const id = await database.addRule({ ...base, name: 'Legacy add input', fieldOrder: ['model', 'custom:absent', 'quantity'] });
  expect((await database.getRuleById(id))?.fieldOrder).toEqual(['model', 'ignore:1', 'quantity']);
  await database.updateRule(id, { fieldOrder: ['model', 'quantity'], customFieldIds: ['absent'] });
  expect((await database.getRuleById(id))?.fieldOrder).toEqual(['model', 'quantity', 'ignore:1']);
});

it('removes only retired ledger tables on upgrade and preserves scanned business fields', async () => {
  await database.addInboundRecordsBatch([receipt]);
  await database.addMaterialWithOrder({ ...material, quantity: 900, traceNo: 'INNER-BOX', productionDate: '2629' }, undefined, warehouse);
  const before = ['入库记录', '出库明细'].map(table => sqlite.prepare(`SELECT * FROM [${table}]`).all());
  sqlite.exec('CREATE TABLE [批次库存流水] (id TEXT); INSERT INTO [批次库存流水] VALUES (\'old\'); CREATE TABLE batch_stock_events (id TEXT);');
  await database.reinitializeDatabase();
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('批次库存流水', 'batch_stock_events')").all()).toEqual([]);
  expect(['入库记录', '出库明细'].map(table => sqlite.prepare(`SELECT * FROM [${table}]`).all())).toEqual(before);
  expect((await database.getMaterial(material.id))).toMatchObject({ batch: 'LOT-A', productionDate: '2629', quantity: 900, traceNo: 'INNER-BOX' });
  await database.reinitializeDatabase();
  expect(await database.hasAnyBusinessData()).toBe(true);
});

it('saves outer-box receipts, inner-box dispatch and counts without local batch-balance constraints', async () => {
  const scope = { ...common, inventory_code: 'OUTER-INNER', batch: 'SAME-BATCH', productionDate: '2629' };
  const inbound = { ...receipt, ...scope, id: 'OUTER-IN', quantity: 1800, traceNo: 'OUTER' };
  const outgoing = { ...material, ...scope, id: 'INNER-OUT', quantity: 900, traceNo: 'INNER' };
  await database.addInboundRecordsBatch([inbound]);
  await database.addInboundRecordsBatch([inbound]);
  await database.addMaterialWithOrder(outgoing, undefined, warehouse);
  await database.updateMaterial(outgoing.id, { quantity: 901 });
  expect((await database.getMaterial(outgoing.id))?.quantity).toBe(901);
  await database.addInventoryCheckRecordsBatch([{ ...scope, id: 'PARTIAL-COUNT', check_no: 'PARTIAL',
    scan_model: 'DEMO', check_type: 'whole', actual_quantity: 450, quantity: 450,
    check_date: '2026-09-17', erp_quantity: 900, traceNo: 'COUNTED-INNER' }]);
  expect(sqlite.prepare("SELECT batch, productionDate, actual_quantity FROM [盘点记录] WHERE id = 'PARTIAL-COUNT'").get())
    .toMatchObject({ batch: 'SAME-BATCH', productionDate: '2629', actual_quantity: 450 });
  await database.deleteInboundDocument(inbound.inbound_no, warehouse.id);
  expect(await database.getMaterial(outgoing.id)).not.toBeNull();
  await database.deleteInventoryCheckDocument('PARTIAL', warehouse.id);
  await database.deleteMaterial(outgoing.id);
  expect(await database.getMaterial(outgoing.id)).toBeNull();
});

it.each(['material', 'label', 'labels'] as const)('allows deleting via %s and re-splitting an original package', async entry => {
  const id = `RESPLIT-${entry}`;
  const scope = { inventory_code: id, traceNo: `${id}-ORIGINAL` };
  const outgoing = { ...material, ...scope, id, order_no: `IO-${id}` };
  await database.addInboundRecordsBatch([{ ...receipt, ...scope, id: `${id}-IN` }]);
  const split = () => database.saveUnpackOperation({
    material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: `${scope.traceNo}-1`,
  });
  const first = await split();
  expect((await database.checkMaterialExists(outgoing.order_no, outgoing.model, outgoing.batch,
    undefined, scope.traceNo, 2500, warehouse.id)).material).not.toBeNull();
  if (entry === 'material') await database.deleteMaterial(id);
  else if (entry === 'label') await database.deleteUnpackRecord(first.shippedRecord.id);
  else await database.deleteUnpackRecords([first.shippedRecord.id, first.remainingRecord.id]);
  expect(await database.getMaterialsByOrder(outgoing.order_no, warehouse.id)).toEqual([]);
  expect(await database.getUnpackHistoryByMaterialId(id)).toEqual([]);
  expect((await database.checkMaterialExists(outgoing.order_no, outgoing.model, outgoing.batch,
    undefined, scope.traceNo, 2500, warehouse.id)).material).toBeNull();
  await split();
  expect((await database.getMaterialsByOrder(outgoing.order_no, warehouse.id))[0].quantity).toBe(1500);
});

it('does not undo an unpack whose remainder is already used in another order without a local stock ledger', async () => {
  const outgoing = { ...material, id: 'USED-UNPACK', inventory_code: 'UNREGISTERED', order_no: 'IO-USED', traceNo: 'USED-ORIGINAL' };
  const split = await database.saveUnpackOperation({
    material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: 'USED-ORIGINAL-1',
  });
  await database.addMaterialWithOrder({ ...outgoing, id: 'USED-REST', order_no: 'IO-USED-REST',
    quantity: 1000, traceNo: split.remainingRecord.new_traceNo }, undefined, warehouse);
  await expect(database.deleteMaterial(outgoing.id)).rejects.toThrow('后续');
  await expect(database.deleteUnpackRecords([split.shippedRecord.id, split.remainingRecord.id])).rejects.toThrow('后续');
  await expect(database.deleteOrder(outgoing.order_no, warehouse.id)).rejects.toThrow('后续');
  expect(await database.getMaterial(outgoing.id)).not.toBeNull();
  expect(await database.getUnpackHistoryByMaterialId(outgoing.id)).toHaveLength(1);
  await database.deleteMaterial('USED-REST');
  await database.deleteMaterial(outgoing.id);
  expect(await database.getMaterial(outgoing.id)).toBeNull();
});
