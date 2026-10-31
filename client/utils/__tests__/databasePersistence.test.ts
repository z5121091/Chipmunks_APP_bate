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
let mockOrderWriteFailureId = '';
let mockOutboxWriteFailure = false;
const mockAdapter = {
  closeAsync: async () => { /* Keep the in-memory fixture alive across simulated app restarts. */ },
  execAsync: async (sql: string) => { sqlite.exec(sql); },
  getAllAsync: async <T,>(sql: string, params: string[] = []) => sqlite.prepare(sql).all(...params) as T[],
  getFirstAsync: async <T,>(sql: string, params: string[] = []) => (sqlite.prepare(sql).get(...params) || null) as T | null,
  runAsync: async (sql: string, params: string[] = []) => {
    if (mockOutboxWriteFailure && sql.includes('INSERT OR IGNORE INTO [拆包打印任务]')) {
      throw new Error('Simulated outbox write failure');
    }
    if (mockOrderWriteFailureId && sql.includes('SET display_order =') && params.at(-1) === mockOrderWriteFailureId) {
      throw new Error('Simulated order write failure');
    }
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

it('preserves manual display order across restart, editing, and configuration restore without changing detection', async () => {
  const base = { description: '', separator: '|', fieldOrder: ['model', 'quantity'], isActive: true };
  const genericId = await database.addRule({ ...base, name: 'Display generic' });
  const specificId = await database.addRule({ ...base, name: 'Display specific', fieldPrefixes: { model: 'PN:' } });
  const generic = (await database.getRuleById(genericId))!;
  const specific = (await database.getRuleById(specificId))!;
  await expect(database.detectRule('PN:MODEL|10', [generic, specific])).resolves.toEqual(specific);
  const before = await database.getAllRules();
  const ids = before.map(rule => rule.id).reverse();
  const metadata = before.map(({ id, updated_at }) => ({ id, updated_at }));
  await database.setRulesDisplayOrder(ids);
  expect((await database.getAllRules()).map(rule => rule.id)).toEqual(ids);
  expect((await database.getAllRules()).map(({ id, updated_at }) => ({ id, updated_at })))
    .toEqual(ids.map(id => metadata.find(rule => rule.id === id)));
  await database.reinitializeDatabase();
  await database.updateRule(genericId, { description: 'Edited after sorting' });
  expect((await database.getAllRules()).map(rule => rule.id)).toEqual(ids);
  const backup = await database.exportBackupData();
  const saved = backup.rules.map(({ id, displayOrder }) => ({ id, displayOrder }));
  await database.setRulesDisplayOrder(ids.slice().reverse());
  expect((await database.importBackupData(backup)).success).toBe(true);
  expect((await database.getAllRules()).map(({ id, displayOrder }) => ({ id, displayOrder }))).toEqual(saved);
  const restored = (await database.getAllRules()).filter(rule => [genericId, specificId].includes(rule.id));
  await expect(database.detectRule('PN:MODEL|10', restored)).resolves.toMatchObject({ id: specificId });
  await expect(database.detectRule('PN:MODEL|10', restored.slice().reverse())).resolves.toMatchObject({ id: specificId });
  const ambiguous = restored.map(rule => ({ ...rule, fieldPrefixes: {} }));
  const first = database.analyzeQRCodeRuleDetection('MODEL|10', ambiguous);
  const reversed = database.analyzeQRCodeRuleDetection('MODEL|10', ambiguous.slice().reverse());
  expect(first.selectedRule).toBeNull();
  expect(reversed.selectedRule).toBeNull();
  expect(first.conflictingRules.map(rule => rule.id)).toEqual(reversed.conflictingRules.map(rule => rule.id));
  expect(first.conflictingRules).toHaveLength(2);
});

it('prepends new rules above mixed manual and legacy order without moving existing rules or changing their metadata', async () => {
  const manualIds = (await database.getAllRules()).map(rule => rule.id).reverse();
  await database.setRulesDisplayOrder(manualIds);
  sqlite.prepare('UPDATE [扫码解析规则] SET display_order = NULL WHERE id = ?').run(manualIds.at(-1)!);
  const before = await database.getAllRules();
  const base = { description: '', separator: '/', fieldOrder: ['model', 'quantity'], isActive: true };
  const first = await database.addRule({ ...base, name: 'New at top first' });
  const second = await database.addRule({ ...base, name: 'New at top second' });
  const expected = [second, first, ...before.map(rule => rule.id)];
  expect((await database.getAllRules()).map(rule => rule.id)).toEqual(expected);
  for (const previous of before) {
    expect(await database.getRuleById(previous.id)).toEqual({ ...previous, displayOrder: expect.any(Number) });
  }
  await database.reinitializeDatabase();
  expect((await database.getAllRules()).map(rule => rule.id)).toEqual(expected);
  await database.updateRule(before[0].id, { description: 'Edited without moving' });
  expect((await database.getAllRules()).map(rule => rule.id)).toEqual(expected);
});

it('rolls back all existing display positions when inserting a new top rule fails', async () => {
  const before = await database.getAllRules();
  sqlite.exec(`CREATE TEMP TRIGGER reject_top_rule BEFORE INSERT ON [扫码解析规则]
    WHEN NEW.name = 'Rejected new top rule'
    BEGIN SELECT RAISE(ABORT, 'Simulated rule insert failure'); END`);
  try {
    await expect(database.addRule({
      name: 'Rejected new top rule', description: '', separator: '/', fieldOrder: ['model', 'quantity'], isActive: true,
    })).rejects.toThrow('Simulated rule insert failure');
    expect(await database.getAllRules()).toEqual(before);
  } finally {
    sqlite.exec('DROP TRIGGER reject_top_rule');
  }
});

it('rejects incomplete, duplicate and stale orders before updating and rolls back partial writes', async () => {
  const before = await database.getAllRules();
  const ids = before.map(rule => rule.id);
  for (const invalid of [ids.slice(1), [ids[0], ...ids.slice(0, -1)], ['missing', ...ids.slice(1)]]) {
    await expect(database.setRulesDisplayOrder(invalid)).rejects.toThrow('规则列表已变化');
    expect(await database.getAllRules()).toEqual(before);
  }
  const reversed = ids.slice().reverse();
  mockOrderWriteFailureId = reversed[1];
  try {
    await expect(database.setRulesDisplayOrder(reversed)).rejects.toThrow('Simulated order write failure');
    expect(await database.getAllRules()).toEqual(before);
  } finally {
    mockOrderWriteFailureId = '';
  }
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
  expect(exported.rules.every(rule => rule.displayOrder === undefined)).toBe(true);
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

it('reads complete unpack remarks by material and order without repeating paired labels or mixing scopes', async () => {
  const outgoing = { ...material, id: 'REMARK-MATERIAL', order_no: 'IO-REMARK', traceNo: 'REMARK-ORIGINAL' };
  const firstNote = '第一笔拆包说明\n第二行完整保留';
  const first = await database.saveUnpackOperation({
    material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: 'REMARK-ORIGINAL-1', notes: firstNote,
  });
  await database.saveUnpackOperation({
    material: outgoing, shippedQuantity: 400, remainingQuantity: 600,
    newTraceNo: 'REMARK-ORIGINAL-3', notes: '第二笔拆包说明',
  });
  const base = first.shippedRecord;
  await database.addUnpackRecord({ ...base, pair_id: 'REMARK-OTHER-ORDER',
    order_no: 'IO-OTHER-REMARK', notes: '别的订单备注', new_traceNo: 'REMARK-OTHER-ORDER-1' });
  await database.addUnpackRecord({ ...base, pair_id: 'REMARK-OTHER-WAREHOUSE',
    warehouse_id: 'OTHER-W', notes: '别的仓库备注', new_traceNo: 'REMARK-OTHER-WAREHOUSE-1' });
  const otherMaterial = { ...outgoing, id: 'REMARK-OTHER-MATERIAL', traceNo: 'REMARK-OTHER-ORIGINAL' };
  await database.addMaterialWithOrder(otherMaterial, undefined, warehouse);
  await database.addUnpackRecord({ ...base, original_material_id: otherMaterial.id,
    pair_id: 'REMARK-OTHER-MATERIAL-PAIR', notes: '同型号另一包备注', new_traceNo: 'REMARK-OTHER-MATERIAL-1' });
  await database.addUnpackRecord({ ...base, pair_id: 'REMARK-EMPTY', notes: '  \n  ', new_traceNo: 'REMARK-EMPTY-1' });
  await database.addUnpackRecord({ ...base, pair_id: 'REMARK-LEGACY', warehouse_id: undefined,
    notes: '旧空仓库记录备注', new_traceNo: 'REMARK-LEGACY-1' });

  const remarks = await database.getMaterialRemarks(` ${outgoing.id} `, ` ${outgoing.order_no} `, warehouse.id);
  expect(remarks).toHaveLength(3);
  expect(remarks.map(item => item.notes)).toEqual(expect.arrayContaining([
    firstNote, '第二笔拆包说明', '旧空仓库记录备注',
  ]));
  expect(remarks.every(item => item.label_type === 'shipped')).toBe(true);
  expect(new Set(remarks.map(item => item.pair_id)).size).toBe(remarks.length);
  expect(await database.getMaterialRemarks('MISSING-MATERIAL', outgoing.order_no, warehouse.id)).toEqual([]);
  const otherRemarks = await database.getMaterialRemarks(otherMaterial.id, outgoing.order_no, warehouse.id);
  expect(otherRemarks.map(item => item.notes)).toEqual(['同型号另一包备注']);
});

it('reports a remarks read failure instead of silently treating it as no saved remarks', async () => {
  const reader = jest.spyOn(mockAdapter, 'getAllAsync')
    .mockRejectedValueOnce(new Error('Simulated remarks read failure'));
  try {
    await expect(database.getMaterialRemarks('REMARK-MATERIAL', 'IO-REMARK', warehouse.id))
      .rejects.toThrow('Simulated remarks read failure');
  } finally {
    reader.mockRestore();
  }
  await expect(database.getMaterialRemarks('', 'IO-REMARK', warehouse.id)).rejects.toThrow('缺少物料或订单信息');
});

it('retries one scan event once while accepting identical no-trace physical packs with distinct IDs', async () => {
  const first = { ...material, id: 'EVENT-ONE', order_no: 'IO-EVENT', traceNo: '', quantity: 100,
    customFields: { alpha: '1', beta: '2' } };
  await database.addMaterialWithOrder(first, undefined, warehouse);
  await expect(database.addMaterialWithOrder(first, undefined, warehouse)).resolves.toBe(first.id);
  await expect(database.addMaterialWithOrder({ ...first, customFields: { beta: '2', alpha: '1' } }, undefined, warehouse))
    .resolves.toBe(first.id);
  await database.addMaterialWithOrder({ ...first, id: 'EVENT-TWO' }, undefined, warehouse);
  expect(await database.getMaterialsByOrder(first.order_no, warehouse.id)).toHaveLength(2);
  await expect(database.addMaterialWithOrder({ ...first, quantity: 101 }, undefined, warehouse))
    .rejects.toThrow('内容不同');
  await expect(database.addMaterialWithOrder({ ...first, sourceNo: 'ANOTHER-BOX' }, undefined, warehouse))
    .rejects.toThrow('内容不同');
  await expect(database.addMaterialWithOrder({ ...first, id: 'BAD-QUANTITY', quantity: 0 }, undefined, warehouse))
    .rejects.toThrow('正整数');
  await expect(database.addMaterialWithOrder({ ...first, id: 'BAD-FRACTION', quantity: 1.5 }, undefined, warehouse))
    .rejects.toThrow('正整数');
});

it('commits unpack data and its durable print task together, retains status across restart, and guards claims', async () => {
  const outgoing = { ...material, id: 'OUTBOX-ATOMIC', order_no: 'IO-OUTBOX-ATOMIC', traceNo: 'OUTBOX-T' };
  const split = await database.saveUnpackOperation({
    material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: 'OUTBOX-T-1',
  });
  await database.reinitializeDatabase();
  expect(await database.getUnpackPrintTasks(outgoing.order_no, warehouse.id)).toEqual([
    expect.objectContaining({ pair_id: split.pairId, status: 'pending', attempt_count: 0,
      shipment_record_id: split.shippedRecord.id, remainder_record_id: split.remainingRecord.id,
      model: outgoing.model, shipped_quantity: '1500', remaining_quantity: '1000',
      shipped_traceNo: split.shippedRecord.new_traceNo, remainder_traceNo: split.remainingRecord.new_traceNo }),
  ]);
  expect(await database.getUnpackPrintTask(split.pairId)).toMatchObject({ model: outgoing.model,
    shipped_quantity: '1500', remaining_quantity: '1000' });
  expect((await database.getUnpackPrintTaskRecords(split.pairId)).map(record => record.id))
    .toEqual([split.shippedRecord.id, split.remainingRecord.id]);
  expect(await Promise.all([database.claimUnpackPrintTask(split.pairId), database.claimUnpackPrintTask(split.pairId)]))
    .toEqual([true, false]);
  expect(await database.getUnpackPrintTask(split.pairId)).toMatchObject({ status: 'submitting', attempt_count: 1 });
  await database.updateUnpackPrintTask(split.pairId, { status: 'submitted', last_error: '', submitted_at: '2026-10-13T01:00:00Z' });
  expect(await database.updateUnpackPrintTask(split.pairId, { status: 'failed' }, 'submitting')).toBe(false);
  expect(await database.claimUnpackPrintTask(split.pairId)).toBe(false);
  await database.deleteMaterial(outgoing.id);
  expect(await database.getUnpackPrintTask(split.pairId)).toBeNull();
});

it('rolls back the material and both unpack labels if durable print task creation fails', async () => {
  const outgoing = { ...material, id: 'OUTBOX-ROLLBACK', order_no: 'IO-OUTBOX-ROLLBACK', traceNo: 'ROLLBACK-T' };
  mockOutboxWriteFailure = true;
  try {
    await expect(database.saveUnpackOperation({
      material: outgoing, createMaterial: { material: outgoing, warehouse },
      shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: 'ROLLBACK-T-1',
    })).rejects.toThrow('Simulated outbox write failure');
  } finally { mockOutboxWriteFailure = false; }
  expect(await database.getMaterial(outgoing.id)).toBeNull();
  expect(await database.getUnpackHistoryByMaterialId(outgoing.id)).toEqual([]);
  expect(await database.getUnpackPrintTasks(outgoing.order_no, warehouse.id)).toEqual([]);
});

it('marks historical pairs as unverified without automatically claiming them and validates label ownership', async () => {
  const outgoing = { ...material, id: 'OUTBOX-LEGACY', order_no: 'IO-OUTBOX-LEGACY', traceNo: 'LEGACY-T' };
  const split = await database.saveUnpackOperation({
    material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: 'LEGACY-T-1',
  });
  sqlite.prepare('DELETE FROM [拆包打印任务] WHERE pair_id = ?').run(split.pairId);
  const tasks = await database.getUnpackPrintTasks(outgoing.order_no, warehouse.id);
  expect(tasks).toEqual([expect.objectContaining({ pair_id: split.pairId, status: 'failed', attempt_count: 0,
    last_error: expect.stringContaining('先核对') })]);
  sqlite.prepare('UPDATE [拆包记录] SET warehouse_id = ? WHERE id = ?').run('OTHER-W', split.remainingRecord.id);
  await expect(database.getUnpackPrintTaskRecords(split.pairId)).rejects.toThrow('归属已变化');
});

it('reports exact, generic and missing inventory bindings while keeping existing fallback compatible', async () => {
  await database.addInventoryBinding({ scan_model: 'MATCH-DEMO', version: '', inventory_code: 'MATCH-GENERIC' });
  await database.addInventoryBinding({ scan_model: 'MATCH-DEMO', version: 'V1', inventory_code: 'MATCH-EXACT' });
  expect(await database.getInventoryBindingMatchByModel('match-demo', 'v1'))
    .toEqual({ inventoryCode: 'MATCH-EXACT', matchKind: 'exact' });
  expect(await database.getInventoryBindingMatchByModel('MATCH-DEMO', 'V2'))
    .toEqual({ inventoryCode: 'MATCH-GENERIC', matchKind: 'generic' });
  expect(await database.getInventoryCodeByModel('MATCH-DEMO', 'V2')).toBe('MATCH-GENERIC');
  expect(await database.getInventoryBindingMatchByModel('MATCH-MISSING', 'V2'))
    .toEqual({ inventoryCode: null, matchKind: 'none' });
});

it('accepts a valid older native backup without the optional print task table', async () => {
  sqlite.exec('ALTER TABLE [拆包打印任务] RENAME TO [测试保留的拆包打印任务]');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .resolves.toBeUndefined();
  } finally {
    sqlite.exec('ALTER TABLE [测试保留的拆包打印任务] RENAME TO [拆包打印任务]');
  }
});

it('rejects a present but incomplete optional print task table before restoring a native backup', async () => {
  sqlite.exec('ALTER TABLE [拆包打印任务] RENAME TO [测试保留的拆包打印任务]');
  sqlite.exec('CREATE TABLE [拆包打印任务] (pair_id TEXT PRIMARY KEY)');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .rejects.toThrow('数据库表 拆包打印任务 缺少字段: order_no');
  } finally {
    sqlite.exec('DROP TABLE [拆包打印任务]');
    sqlite.exec('ALTER TABLE [测试保留的拆包打印任务] RENAME TO [拆包打印任务]');
  }
  await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
    .resolves.toBeUndefined();
});

const returnMaterial = (id: string, traceNo: string, quantity = 100, customer = '客户 A') => ({
  ...material, id, order_no: `RETURN-${id}`, customer_name: customer,
  inventory_code: `RETURN-CODE-${traceNo || id}`, traceNo, quantity,
});

it('immediately makes 8000 of a 10000 return available and leaves sales exports unchanged', async () => {
  const source = returnMaterial('PARTIAL-SOURCE', 'PARTIAL-TRACE', 8000);
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  const incoming = { ...source, id: 'PARTIAL-RETURN', order_no: 'RETURN-PARTIAL-10000' };
  const before = await database.getOutboundExportRows();
  const saved = await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 10000 });
  expect(saved).toMatchObject({ quantity: 8000, operation_type: 'sales_return', source_kind: 'trace_matched' });
  expect(await database.getReturnedTraceAllowance(source.traceNo, source.inventory_code, warehouse.id))
    .toEqual({ quantity: 8000, hasHistory: true });
  expect(await database.getOutboundExportRows()).toEqual(before);
  expect(await database.getMaterialsByOrder(incoming.order_no, warehouse.id)).toEqual([]);
  expect(await database.getQueryMaterialsByOrder(incoming.order_no, warehouse.id)).toEqual([saved]);
  expect(await database.getQueryOrder(incoming.order_no, warehouse.id)).toMatchObject({ operation_type: 'sales_return' });
  expect((await database.getQueryFilteredOrders({ warehouseId: warehouse.id, searchText: incoming.order_no })))
    .toEqual([expect.objectContaining({ order_no: incoming.order_no, operation_type: 'sales_return' })]);
  expect(await database.getMaterial(saved.id)).toEqual(saved);
  await expect(database.deleteMaterial(source.id)).rejects.toThrow('已关联销售退货');
});

it('checks the whole trace history by customer and inventory while allowing unknown traces', async () => {
  const source = returnMaterial('CUSTOMER-SOURCE', 'CUSTOMER-TRACE');
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  await expect(database.saveSalesReturnWithOrder({
    material: { ...source, id: 'WRONG-CUSTOMER', order_no: 'RETURN-WRONG', customer_name: '客户 B' }, requiredQuantity: 100,
  })).rejects.toThrow('对应客户 客户 A');
  await expect(database.checkSalesReturnSource({ traceNo: source.traceNo,
    inventoryCode: 'OTHER-CODE', customerName: source.customer_name })).rejects.toThrow('其他存货编码');
  const unknown = returnMaterial('UNKNOWN-RETURN', 'UNKNOWN-TRACE', 100, '客户 B');
  const saved = await database.saveSalesReturnWithOrder({ material: unknown, requiredQuantity: 100 });
  expect(saved).toMatchObject({ source_kind: 'trace_unknown', source_material_ids: [] });
  expect(saved.notes).toContain('历史来源未知');
});

it('keeps same-event returns idempotent, rejects same-order traces and checks total received quantity', async () => {
  const incoming = { ...returnMaterial('RETURN-EVENT', 'RETURN-EVENT-TRACE', 80), separator: ',', customFields: { po: 'PO-ONE' } };
  const first = await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  expect(await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 })).toEqual(first);
  expect((await database.getSalesReturnById(incoming.id))?.separator).toBe(',');
  await expect(database.saveSalesReturnWithOrder({ material: { ...incoming, separator: '/' }, requiredQuantity: 100 }))
    .rejects.toThrow('内容不同');
  await expect(database.saveSalesReturnWithOrder({ material: { ...incoming, customFields: { po: 'PO-TWO' } }, requiredQuantity: 100 }))
    .rejects.toThrow('内容不同');
  await expect(database.saveSalesReturnWithOrder({
    material: { ...incoming, id: 'DUPLICATE-RETURN-EVENT' }, requiredQuantity: 100,
  })).rejects.toThrow('已在本退货单登记');
  await expect(database.saveSalesReturnWithOrder({
    material: { ...incoming, id: 'ANOTHER-RETURN-EVENT', traceNo: 'ANOTHER-RETURN-TRACE', quantity: 21 }, requiredQuantity: 100,
  })).rejects.toThrow('超出应退数量');
  await expect(database.saveSalesReturnWithOrder({
    material: { ...incoming, quantity: 81 }, requiredQuantity: 100,
  })).rejects.toThrow('内容不同');
  await expect(database.saveSalesReturnWithOrder({
    material: { ...incoming, id: 'DUPLICATE-ANOTHER-ORDER', order_no: 'RETURN-NEXT' }, requiredQuantity: 100,
  })).rejects.toThrow('已验收回库');
});

it('uses batch only as reference and allows separate no-trace packs with identical data', async () => {
  const source = returnMaterial('BATCH-SOURCE', '', 50, '客户 A');
  source.inventory_code = 'BATCH-RETURN-CODE';
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  const incoming = { ...source, id: 'BATCH-RETURN-ONE', order_no: 'RETURN-BATCH', customer_name: '客户 B' };
  const first = await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const second = await database.saveSalesReturnWithOrder({ material: { ...incoming, id: 'BATCH-RETURN-TWO' }, requiredQuantity: 100 });
  expect(first.source_kind).toBe('batch');
  expect(first.notes).toContain('批次不限制客户');
  expect(first.id).not.toBe(second.id);
  expect(await database.getSalesReturnsByOrder(incoming.order_no, warehouse.id)).toHaveLength(2);
});

it('records unknown evidence honestly when a received label contains neither a trace nor a batch', async () => {
  const incoming = { ...returnMaterial('NO-IDENTIFIERS-RETURN', '', 20, '客户 B'),
    order_no: 'RETURN-NO-IDENTIFIERS', batch: '' };
  const received = await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  expect(received.customer_name).toBe('客户 B');
  expect(received.notes).not.toContain('客户：');
  expect(received.notes).toContain('无追溯码及批次；历史来源未知');
  expect(received.notes).not.toContain('按批次核对');
  await database.updateSalesReturnNotes(received.id, '外包装缺失');
  expect((await database.getSalesReturnById(received.id))?.notes).toContain('外包装缺失');
  expect((await database.getSalesReturnById(received.id))?.notes).not.toContain('按批次核对');
});

it('deducts returned trace quantity atomically on normal resale, does not deduct retries and releases deletion', async () => {
  const incoming = returnMaterial('ALLOWANCE-RETURN', 'ALLOWANCE-TRACE', 100);
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const outgoing = { ...incoming, id: 'ALLOWANCE-RESALE', order_no: 'RESALE-ALLOWANCE', customer_name: '客户 B', quantity: 60 };
  await database.addMaterialWithOrder(outgoing, outgoing.customer_name, warehouse);
  await database.addMaterialWithOrder(outgoing, outgoing.customer_name, warehouse);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(40);
  await expect(database.addMaterialWithOrder({ ...outgoing, id: 'ALLOWANCE-OVER', order_no: 'RESALE-OVER', quantity: 41 }, '客户 C', warehouse))
    .rejects.toThrow('超出已验收数量');
  expect(await database.getMaterial('ALLOWANCE-OVER')).toBeNull();
  await expect(database.deleteSalesReturn(incoming.id)).rejects.toThrow('已有再次出库');
  const results = await Promise.allSettled(['ALLOWANCE-RACE-ONE', 'ALLOWANCE-RACE-TWO'].map(id =>
    database.addMaterialWithOrder({ ...outgoing, id, order_no: id, quantity: 25 }, '客户 C', warehouse)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(15);
  await database.deleteMaterial(outgoing.id);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(75);
});

it('allows historical trace resale after receipt but keeps same-order duplicate checks', async () => {
  const source = returnMaterial('RESCAN-SOURCE', 'RESCAN-TRACE');
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  await database.saveSalesReturnWithOrder({ material: { ...source, id: 'RESCAN-RETURN', order_no: 'RETURN-RESCAN' }, requiredQuantity: 100 });
  expect(await database.checkMaterialExists('RESCAN-NEXT', source.model, source.batch,
    undefined, source.traceNo, '100', warehouse.id)).toMatchObject({ canRescan: true });
  expect(await database.checkMaterialExists(source.order_no, source.model, source.batch,
    undefined, source.traceNo, '100', warehouse.id)).toMatchObject({ canRescan: false });
});

it('deducts only shipment once on unpack and follows the new remaining trace without exposing stale original labels', async () => {
  const incoming = returnMaterial('SPLIT-RETURN', 'SPLIT-RETURN-TRACE', 1000);
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 1000 });
  const outgoing = { ...incoming, id: 'SPLIT-RESALE', order_no: 'RESALE-SPLIT', customer_name: '客户 B' };
  const params = { material: outgoing, createMaterial: { material: outgoing, customerName: outgoing.customer_name, warehouse },
    shippedQuantity: 600, remainingQuantity: 400, newTraceNo: 'SPLIT-RETURN-TRACE-1', operationId: 'SPLIT-STABLE-JOB' };
  const split = await database.saveUnpackOperation(params);
  expect(await database.saveUnpackOperation(params)).toEqual(split);
  const remainder = split.remainingRecord.new_traceNo;
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(400);
  expect((await database.getReturnedTraceAllowance(remainder, incoming.inventory_code, warehouse.id)).quantity).toBe(400);
  await expect(database.saveUnpackOperation({
    material: { ...outgoing, id: 'STALE-SPLIT', order_no: 'RESALE-STALE' },
    createMaterial: { material: { ...outgoing, id: 'STALE-SPLIT', order_no: 'RESALE-STALE' }, warehouse },
    shippedQuantity: 200, remainingQuantity: 800, newTraceNo: 'SPLIT-RETURN-TRACE-3',
  })).rejects.toThrow('整包数量超过');
  const remainingSale = { ...outgoing, id: 'SPLIT-REST-SALE', order_no: 'RESALE-SPLIT-REST', traceNo: remainder, quantity: 400 };
  await database.addMaterialWithOrder(remainingSale, '客户 C', warehouse);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(0);
  await expect(database.deleteMaterial(outgoing.id)).rejects.toThrow('后续');
  await database.deleteMaterial(remainingSale.id);
  await database.deleteUnpackRecords([split.shippedRecord.id, split.remainingRecord.id]);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(1000);
});

it('keeps automatic return remarks when supplemental remarks are edited or cleared', async () => {
  const incoming = returnMaterial('NOTES-RETURN', 'NOTES-RETURN-TRACE');
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100, notes: '包装完好' });
  const oldNotes = `销售退货；客户：${incoming.customer_name}；历史来源未知；包装完好`;
  sqlite.prepare('UPDATE [销售退货记录] SET notes = ? WHERE id = ?').run(oldNotes, incoming.id);
  const restored = await database.getSalesReturnById(incoming.id);
  expect(restored).toMatchObject({ customer_name: incoming.customer_name, user_notes: '包装完好' });
  expect(restored?.notes).not.toContain('客户：');
  expect(restored?.notes).toContain('包装完好');
  expect((await database.getMaterialRemarks(incoming.id, incoming.order_no, warehouse.id))[0].notes)
    .not.toContain('客户：');
  expect(sqlite.prepare('SELECT notes FROM [销售退货记录] WHERE id = ?').get(incoming.id))
    .toMatchObject({ notes: oldNotes });
  await database.updateSalesReturnNotes(incoming.id, '客户要求复核包装；已检查，可以销售');
  expect(await database.getMaterialRemarks(incoming.id, incoming.order_no, warehouse.id)).toEqual([
    expect.objectContaining({ id: incoming.id, notes: expect.stringContaining('已检查，可以销售') }),
  ]);
  expect((await database.getSalesReturnById(incoming.id))?.notes).toContain('客户要求复核包装');
  await database.updateSalesReturnNotes(incoming.id, '');
  expect(await database.getSalesReturnById(incoming.id)).toMatchObject({ user_notes: '', notes: expect.stringContaining('历史来源未知') });
  expect(await database.getMaterialRemarks(incoming.id, 'OTHER-ORDER', warehouse.id)).toEqual([]);
  expect(await database.getMaterialRemarks(incoming.id, incoming.order_no, 'OTHER-WAREHOUSE')).toEqual([]);
  await expect(database.updateSalesReturnNotes('MISSING-RETURN', '')).rejects.toThrow('不存在');
});

it('keeps legacy native backups compatible and creates empty independent return tables on initialization', async () => {
  sqlite.exec('ALTER TABLE [销售退货记录] RENAME TO [测试保留的销售退货记录]');
  sqlite.exec('ALTER TABLE [退货再出库关联] RENAME TO [测试保留的退货再出库关联]');
  const before = sqlite.prepare('SELECT * FROM [出库明细]').all();
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).resolves.toBeUndefined();
    await database.reinitializeDatabase();
    expect(sqlite.prepare('SELECT * FROM [销售退货记录]').all()).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM [出库明细]').all()).toEqual(before);
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase)).resolves.toBeUndefined();
  } finally {
    sqlite.exec('DROP TABLE IF EXISTS [销售退货记录]; DROP TABLE IF EXISTS [退货再出库关联]');
    sqlite.exec('ALTER TABLE [测试保留的销售退货记录] RENAME TO [销售退货记录]');
    sqlite.exec('ALTER TABLE [测试保留的退货再出库关联] RENAME TO [退货再出库关联]');
  }
});

it('rejects a present but incomplete return table in a native backup', async () => {
  sqlite.exec('ALTER TABLE [销售退货记录] RENAME TO [测试保留的销售退货记录]');
  sqlite.exec('CREATE TABLE [销售退货记录] (id TEXT PRIMARY KEY)');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .rejects.toThrow('数据库表 销售退货记录 缺少字段');
  } finally {
    sqlite.exec('DROP TABLE [销售退货记录]');
    sqlite.exec('ALTER TABLE [测试保留的销售退货记录] RENAME TO [销售退货记录]');
  }
});

it('does not turn a trace from another account into unknown history', async () => {
  const source = { ...returnMaterial('ACCOUNT-SOURCE', 'ACCOUNT-TRACE'), erp_account_key: 'other-account' };
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  await expect(database.checkSalesReturnSource({ traceNo: source.traceNo, inventoryCode: source.inventory_code,
    customerName: '客户 B', accountKey: account })).rejects.toThrow('对应客户 客户 A');
  expect(await database.checkSalesReturnSource({ traceNo: source.traceNo, inventoryCode: source.inventory_code,
    customerName: '客户 A', accountKey: account })).toMatchObject({ kind: 'trace_matched' });
});

it('rejects wrong-inventory and wrong-warehouse resale even when the initial credits filter finds no rows', async () => {
  const incoming = returnMaterial('SCOPE-RETURN', 'SCOPE-TRACE');
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const outgoing = { ...incoming, id: 'SCOPE-WRONG-CODE', order_no: 'RESALE-WRONG-CODE', inventory_code: 'OTHER-CODE' };
  await expect(database.addMaterialWithOrder(outgoing, '客户 B', warehouse)).rejects.toThrow('存货编码或回库仓库');
  const otherWarehouse = { id: 'SCOPE-OTHER-W', name: '另一仓库' };
  await expect(database.addMaterialWithOrder({ ...incoming, id: 'SCOPE-WRONG-WAREHOUSE', order_no: 'RESALE-WRONG-WAREHOUSE',
    warehouse_id: otherWarehouse.id, warehouse_name: otherWarehouse.name }, '客户 B', otherWarehouse))
    .rejects.toThrow('存货编码或回库仓库');
  expect(await database.getMaterial(outgoing.id)).toBeNull();
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(100);
});

it('uses the same transactional return allocations in batch writes and rejects sales-return payload pollution', async () => {
  const incoming = returnMaterial('BATCH-ALLOWANCE-RETURN', 'BATCH-ALLOWANCE-TRACE');
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const outgoing = { ...incoming, order_no: 'RESALE-BATCH-ALLOWANCE', quantity: 60 };
  await database.addMaterialsBatch([outgoing]);
  expect((await database.getReturnedTraceAllowance(incoming.traceNo, incoming.inventory_code, warehouse.id)).quantity).toBe(40);
  await expect(database.addMaterialsBatch([{ ...outgoing, order_no: 'RESALE-BATCH-OVER', quantity: 41 }])).rejects.toThrow('超出已验收数量');
  await expect(database.addMaterialsBatch([{ ...outgoing, operation_type: 'sales_return' }])).rejects.toThrow('退货验收接口');
  expect(await database.getMaterialsByOrder('RESALE-BATCH-OVER', warehouse.id)).toEqual([]);
});

it('protects linked source/resale edits and keeps a warehouse referenced only by returns during configuration restore', async () => {
  const warehouseId = await database.addWarehouse({ name: '退货专用保留仓' });
  const returnWarehouse = { id: warehouseId, name: '退货专用保留仓' };
  const source = { ...returnMaterial('EDIT-SOURCE', 'EDIT-TRACE'), warehouse_id: warehouseId, warehouse_name: returnWarehouse.name };
  await database.addMaterialWithOrder(source, source.customer_name, returnWarehouse);
  const incoming = { ...source, id: 'EDIT-RETURN', order_no: 'RETURN-EDIT' };
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  await expect(database.updateMaterial(source.id, { customer_name: '客户 B' })).rejects.toThrow('已关联销售退货');
  await expect(database.updateMaterialQuantity(source.id, 99)).rejects.toThrow('已关联销售退货');
  await expect(database.updateMaterialQuantity(incoming.id, 99)).rejects.toThrow('退货数量及追溯信息');
  const isolated = { ...returnMaterial('WAREHOUSE-ONLY-RETURN', 'WAREHOUSE-ONLY-TRACE'), warehouse_id: warehouseId,
    warehouse_name: returnWarehouse.name };
  await database.saveSalesReturnWithOrder({ material: isolated, requiredQuantity: 100 });
  await database.deleteSalesReturn(incoming.id);
  await database.deleteMaterial(source.id);
  await expect(database.deleteWarehouse(warehouseId)).rejects.toThrow('已有业务数据');
  const backup = await database.exportBackupData();
  backup.warehouses = backup.warehouses.filter(row => row.id !== warehouseId);
  expect(await database.importBackupData(backup)).toMatchObject({ success: true });
  expect((await database.getAllWarehouses()).find(row => row.id === warehouseId)).toBeDefined();
});

it('uses return summaries instead of legacy empty outbound shells and avoids unknown-return trace collisions', async () => {
  const incoming = returnMaterial('SHELL-RETURN', 'SHELL-TRACE');
  await database.upsertOrder(incoming.order_no, '旧空壳客户', warehouse);
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  expect(await database.getQueryOrder(incoming.order_no, warehouse.id))
    .toMatchObject({ customer_name: incoming.customer_name, operation_type: 'sales_return' });
  expect(await database.getQueryFilteredOrders({ warehouseId: warehouse.id, searchText: incoming.order_no }))
    .toEqual([expect.objectContaining({ operation_type: 'sales_return', customer_name: incoming.customer_name })]);
  const collision = returnMaterial('COLLISION-RETURN', 'COLLISION-TRACE-3');
  await database.saveSalesReturnWithOrder({ material: collision, requiredQuantity: 100 });
  expect(await database.getNextUnpackIndex('COLLISION-TRACE')).toBe(4);
  const outgoing = { ...material, id: 'COLLISION-OUT', order_no: 'COLLISION-OUT', traceNo: 'COLLISION-ORIGINAL' };
  await expect(database.saveUnpackOperation({ material: outgoing, createMaterial: { material: outgoing, warehouse },
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: collision.traceNo })).rejects.toThrow('销售退货记录');
  expect(await database.getMaterial(outgoing.id)).toBeNull();
});

it('accepts a legitimate next customer return after all prior receipt quantity was resold', async () => {
  const source = returnMaterial('CYCLE-SOURCE', 'CYCLE-TRACE');
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  const firstReturn = { ...source, id: 'CYCLE-RETURN-A', order_no: 'CYCLE-RETURN-A' };
  await database.saveSalesReturnWithOrder({ material: firstReturn, requiredQuantity: 100 });
  const resale = { ...source, id: 'CYCLE-RESALE-B', order_no: 'CYCLE-RESALE-B', customer_name: '客户 B' };
  await database.addMaterialWithOrder(resale, resale.customer_name, warehouse);
  const secondReturn = { ...resale, id: 'CYCLE-RETURN-B', order_no: 'CYCLE-RETURN-B' };
  expect(await database.saveSalesReturnWithOrder({ material: secondReturn, requiredQuantity: 100 }))
    .toMatchObject({ source_kind: 'trace_matched', customer_name: '客户 B' });
  expect((await database.getReturnedTraceAllowance(source.traceNo, source.inventory_code, warehouse.id)).quantity).toBe(100);
  await expect(database.deleteMaterial(resale.id)).rejects.toThrow('已关联销售退货');
});

it('rejects return backup schemas that lost one half of the receipt-allocation pair', async () => {
  sqlite.exec('ALTER TABLE [退货再出库关联] RENAME TO [测试保留的退货再出库关联]');
  try {
    await expect(database.validateRestoredDatabaseSchema(mockAdapter as unknown as SQLiteDatabase))
      .rejects.toThrow('必须同时存在');
  } finally {
    sqlite.exec('ALTER TABLE [测试保留的退货再出库关联] RENAME TO [退货再出库关联]');
  }
});

it('protects return-linked binding codes transactionally and permits supplier-only and normalized-code edits', async () => {
  const source = { ...returnMaterial('BINDING-LINK-SOURCE', 'BINDING-LINK-TRACE'),
    model: 'BINDING-LINK-MODEL', version: 'V1', inventory_code: 'BINDING-LINK-A' };
  const bindingId = await database.addInventoryBinding({ scan_model: source.model, version: source.version,
    inventory_code: source.inventory_code, supplier: '原供应商' });
  await database.addMaterialWithOrder(source, source.customer_name, warehouse);
  const incoming = { ...source, id: 'BINDING-LINK-RETURN', order_no: 'RETURN-BINDING-LINK' };
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const resale = { ...source, id: 'BINDING-LINK-RESALE', order_no: 'RESALE-BINDING-LINK', quantity: 20 };
  await database.addMaterialWithOrder(resale, resale.customer_name, warehouse);

  await expect(database.updateInventoryBinding(bindingId, {
    inventory_code: 'BINDING-LINK-B', supplier: '不应保存的供应商',
  })).rejects.toThrow('已关联销售退货');
  expect((await database.getAllInventoryBindings()).find(row => row.id === bindingId))
    .toMatchObject({ inventory_code: source.inventory_code, supplier: '原供应商' });
  expect((await database.getMaterial(source.id))?.inventory_code).toBe(source.inventory_code);
  expect((await database.getMaterial(resale.id))?.inventory_code).toBe(source.inventory_code);
  expect((await database.getSalesReturnById(incoming.id))?.inventory_code).toBe(source.inventory_code);
  expect(await database.getReturnedTraceAllowance(source.traceNo, source.inventory_code, warehouse.id))
    .toEqual({ quantity: 80, hasHistory: true });

  await database.updateInventoryBinding(bindingId, { supplier: '新供应商' });
  await database.updateInventoryBinding(bindingId, { inventory_code: ' binding-link-a ' });
  expect((await database.getAllInventoryBindings()).find(row => row.id === bindingId))
    .toMatchObject({ inventory_code: 'binding-link-a', supplier: '新供应商' });
  await database.addMaterialWithOrder({ ...resale, id: 'BINDING-LINK-RESALE-TWO',
    order_no: 'RESALE-BINDING-LINK-TWO', inventory_code: 'binding-link-a', quantity: 80 }, resale.customer_name, warehouse);
  expect((await database.getReturnedTraceAllowance(source.traceNo, source.inventory_code, warehouse.id)).quantity).toBe(0);
});

it('protects unknown-source return codes when adding bindings and still fills missing codes for compatible and unlinked history', async () => {
  const incoming = { ...returnMaterial('BINDING-UNKNOWN-RETURN', 'BINDING-UNKNOWN-TRACE'),
    model: 'BINDING-UNKNOWN-MODEL', version: '', inventory_code: 'BINDING-UNKNOWN-A' };
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  await expect(database.addInventoryBinding({ scan_model: incoming.model, version: '',
    inventory_code: 'BINDING-UNKNOWN-B' })).rejects.toThrow('已关联销售退货');
  expect((await database.getAllInventoryBindings()).some(row => row.scan_model === incoming.model)).toBe(false);
  await database.addInventoryBinding({ scan_model: incoming.model, version: '', inventory_code: incoming.inventory_code });

  const unlinked = { ...material, id: 'BINDING-UNLINKED-SOURCE', model: 'BINDING-UNLINKED-MODEL',
    inventory_code: '', traceNo: 'BINDING-UNLINKED-TRACE', order_no: 'IO-BINDING-UNLINKED' };
  await database.addMaterialWithOrder(unlinked, '客户 A', warehouse);
  const bindingId = await database.addInventoryBinding({ scan_model: unlinked.model, version: '', inventory_code: 'BINDING-UNLINKED-A' });
  expect((await database.getMaterial(unlinked.id))?.inventory_code).toBe('BINDING-UNLINKED-A');
  await database.updateInventoryBinding(bindingId, { inventory_code: 'BINDING-UNLINKED-B' });
  expect((await database.getMaterial(unlinked.id))?.inventory_code).toBe('BINDING-UNLINKED-B');
});

it('does not duplicate persisted business rows when legacy bindings differ only by case or whitespace', async () => {
  const scan = { ...material, id: 'LEGACY-JOIN-SOURCE', order_no: 'IO-LEGACY-JOIN',
    model: 'LEGACY-JOIN-MODEL', version: 'V1', inventory_code: 'LEGACY-JOIN-A', traceNo: 'LEGACY-JOIN-TRACE', quantity: 40 };
  await database.addMaterialWithOrder(scan, '客户 A', warehouse);
  const insert = sqlite.prepare('INSERT INTO [物料绑定] (id, scan_model, version, inventory_code, supplier, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('LEGACY-JOIN-ONE', scan.model, scan.version, scan.inventory_code, '供应商 A', '2026-10-15');
  insert.run('LEGACY-JOIN-TWO', ' legacy-join-model ', ' v1 ', 'LEGACY-JOIN-B', '供应商 B', '2026-10-15');
  expect(await database.getMaterialsByOrder(scan.order_no, warehouse.id))
    .toEqual([expect.objectContaining({ id: scan.id, inventory_code: scan.inventory_code, quantity: 40 })]);
  expect((await database.getOutboundExportRows(warehouse.id)).filter(row => row.order_no === scan.order_no))
    .toEqual([expect.objectContaining({ inventory_code: scan.inventory_code, quantity: 40 })]);

  const missingCode = { ...scan, id: 'LEGACY-JOIN-MISSING', order_no: 'IO-LEGACY-JOIN-MISSING',
    inventory_code: '', traceNo: 'LEGACY-JOIN-MISSING-TRACE' };
  await database.addMaterialWithOrder(missingCode, '客户 A', warehouse);
  expect(await database.getMaterialsByOrder(missingCode.order_no, warehouse.id))
    .toEqual([expect.objectContaining({ id: missingCode.id, inventory_code: null, quantity: 40 })]);
  expect((await database.getOutboundExportRows(warehouse.id)).filter(row => row.order_no === missingCode.order_no))
    .toEqual([expect.objectContaining({ inventory_code: '', quantity: 40 })]);

  const split = await database.saveUnpackOperation({ material: scan, shippedQuantity: 20,
    remainingQuantity: 20, newTraceNo: 'LEGACY-JOIN-TRACE-1' });
  const labels = await database.getUnpackPrintTaskRecords(split.pairId);
  expect(labels).toHaveLength(2);
  expect(labels.map(row => row.supplier)).toEqual([null, null]);
  // 历史接口按一次拆包展示一条 shipped 记录，打印任务接口保留成对标签。
  expect((await database.getUnpackHistoryByMaterialId(scan.id))).toHaveLength(1);
});

it('resolves same-code normalized duplicate bindings once without losing distinct physical scans', async () => {
  const insert = sqlite.prepare('INSERT INTO [物料绑定] (id, scan_model, version, inventory_code, supplier, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('LEGACY-SAME-ONE', 'LEGACY-SAME-MODEL', '', 'LEGACY-SAME-A', '同一供应商', '2026-10-15');
  insert.run('LEGACY-SAME-TWO', ' legacy-same-model ', ' ', 'legacy-same-a', '同一供应商', '2026-10-15');
  const scan = { ...material, order_no: 'IO-LEGACY-SAME', model: 'LEGACY-SAME-MODEL',
    version: '', inventory_code: '', traceNo: '', quantity: 10 };
  await database.addMaterialWithOrder({ ...scan, id: 'LEGACY-SAME-SCAN-ONE' }, '客户 A', warehouse);
  await database.addMaterialWithOrder({ ...scan, id: 'LEGACY-SAME-SCAN-TWO' }, '客户 A', warehouse);
  const rows = await database.getMaterialsByOrder(scan.order_no, warehouse.id);
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.inventory_code?.toUpperCase())).toEqual(['LEGACY-SAME-A', 'LEGACY-SAME-A']);
  expect((await database.getOutboundExportRows(warehouse.id)).filter(row => row.order_no === scan.order_no))
    .toHaveLength(2);
});

it.each(['source', 'resale'] as const)('protects %s links even when the return label uses a different model', async kind => {
  const code = `BINDING-CROSS-${kind}-A`;
  const source = { ...returnMaterial(`BINDING-CROSS-${kind}-SOURCE`, `BINDING-CROSS-${kind}-TRACE`),
    inventory_code: code, model: `BINDING-CROSS-${kind}-SOURCE-MODEL`, version: '' };
  await database.addMaterialWithOrder(source, '客户 A', warehouse);
  const incoming = { ...source, id: `BINDING-CROSS-${kind}-RETURN`, order_no: `RETURN-CROSS-${kind}`,
    model: `BINDING-CROSS-${kind}-RETURN-MODEL` };
  await database.saveSalesReturnWithOrder({ material: incoming, requiredQuantity: 100 });
  const resale = { ...source, id: `BINDING-CROSS-${kind}-RESALE`, order_no: `RESALE-CROSS-${kind}`,
    model: `BINDING-CROSS-${kind}-RESALE-MODEL`, quantity: 20 };
  await database.addMaterialWithOrder(resale, '客户 B', warehouse);
  const target = kind === 'source' ? source : resale;
  const bindingId = await database.addInventoryBinding({ scan_model: target.model, version: '', inventory_code: code });
  await expect(database.updateInventoryBinding(bindingId, { inventory_code: `BINDING-CROSS-${kind}-B` }))
    .rejects.toThrow('已关联销售退货');
  expect((await database.getMaterial(target.id))?.inventory_code).toBe(code);
});


it('persists partial receipts across restart, appends once and locks a fully completed document', async () => {
  const first = { ...receipt, id: 'PARTIAL-FIRST', inbound_no: 'PARTIAL-RESUME', quantity: 60, traceNo: 'PARTIAL-T1' };
  const second = { ...first, id: 'PARTIAL-SECOND', quantity: 40, traceNo: 'PARTIAL-T2' };
  await database.addInboundRecordsBatch([first], { completionStatus: 'partial', expectedSavedIds: [] });
  await database.reinitializeDatabase();
  expect((await database.getInboundRecordsByNo(first.inbound_no))[0].completion_status).toBe('partial');
  expect((await database.getInboundDocumentSummaries()).find(row => row.inbound_no === first.inbound_no))
    .toMatchObject({ completion_status: 'partial', total_quantity: 60 });
  await expect(database.addInboundRecordsBatch([second], { completionStatus: 'complete', expectedSavedIds: [] }))
    .rejects.toThrow('发生变化');
  sqlite.exec("CREATE TEMP TRIGGER fail_receipt_completion BEFORE UPDATE OF completion_status ON [入库记录] WHEN NEW.inbound_no = 'PARTIAL-RESUME' AND NEW.completion_status = 'complete' BEGIN SELECT RAISE(ABORT, 'completion write failed'); END;");
  await expect(database.addInboundRecordsBatch([second], { completionStatus: 'complete', expectedSavedIds: [first.id] }))
    .rejects.toThrow('completion write failed');
  expect(await database.getInboundRecordsByNo(first.inbound_no)).toEqual([expect.objectContaining({ id: first.id, completion_status: 'partial' })]);
  sqlite.exec('DROP TRIGGER fail_receipt_completion');
  await database.addInboundRecordsBatch([second], { completionStatus: 'complete', expectedSavedIds: [first.id] });
  await database.addInboundRecordsBatch([second], { completionStatus: 'complete', expectedSavedIds: [first.id] });
  const records = await database.getInboundRecordsByNo(first.inbound_no);
  expect(records).toHaveLength(2);
  expect(records.every(row => row.completion_status === 'complete')).toBe(true);
  expect(records.reduce((sum, row) => sum + row.quantity, 0)).toBe(100);
  await expect(database.addInboundRecordsBatch([{ ...second, id: 'PARTIAL-THIRD', traceNo: 'PARTIAL-T3' }],
    { completionStatus: 'partial', expectedSavedIds: [first.id, second.id] })).rejects.toThrow('已入库完成');
});
