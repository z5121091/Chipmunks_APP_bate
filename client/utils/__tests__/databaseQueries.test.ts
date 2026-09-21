jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { Platform } from 'react-native';
import { logger } from '../logger';

it('preserves binding lookups and warehouse-scoped SQL aggregates in the web database', async () => {
  const platform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  try {
    const database: typeof import('../database') = require('../database');
    await database.initDatabase();
    await database.addInventoryBinding({ scan_model: 'Test Model', inventory_code: 'PN-BASE' });
    await database.addInventoryBinding({ scan_model: 'Test Model', version: 'V2', inventory_code: 'PN-V2' });
    expect(await database.getInventoryCodeByModel('test model', 'v2')).toBe('PN-V2');
    expect(await database.getInventoryCodeByModel('Test Model')).toBe('PN-BASE');
    expect(await database.getExactInventoryCodeByModelVersion('test model', 'v2')).toBe('PN-V2');
    expect(await database.getExactInventoryCodeByModelVersion('Test Model', 'missing')).toBeNull();
    expect(await database.getInventoryCodeByModel('Missing Model')).toBeNull();
    const bindings = await database.getInventoryBindingsPage({ keyword: 'Test Model' });
    expect(bindings.total).toBe(2);
    expect(bindings.items.map(item => item.scan_model)).toEqual(['Test Model', 'Test Model']);
    await expect(database.addInventoryBinding({
      scan_model: 'test model', version: 'v2', inventory_code: 'PN-DUPLICATE',
    })).rejects.toThrow();

    for (const [warehouse, quantity, version] of [['W1', 100, ''], ['W1', 200, 'V2'], ['W2', 900, '']] as const) {
      await database.addInboundRecord({
        inbound_no: 'TEST-IN-001', warehouse_id: warehouse, warehouse_name: warehouse,
        inventory_code: version ? 'PN-V2' : 'PN-BASE', scan_model: 'Test Model',
        batch: 'LOT-1', quantity, version, in_date: '2026-09-05',
      });
    }
    expect(await database.getInboundDocumentSummaries('W1')).toEqual([
      expect.objectContaining({ warehouse_id: 'W1', record_count: 2, model_count: 1, total_quantity: 300 }),
    ]);
    expect(await database.getInboundDocumentSummaries('W2')).toEqual([
      expect.objectContaining({ warehouse_id: 'W2', record_count: 1, model_count: 1, total_quantity: 900 }),
    ]);
    expect(await database.getInboundDocumentSummaries('UNKNOWN')).toEqual([]);
  } finally {
    if (platform) Object.defineProperty(Platform, 'OS', platform);
  }
});

it('skips unchanged order propagation while keeping real customer changes and unpack quantities consistent', async () => {
  const platform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  try {
    const database: typeof import('../database') = require('../database');
    await database.initDatabase();
    const warehouse = { id: 'OUT-W1', name: 'Outbound warehouse' };
    const material = {
      id: 'outbound-unpack-test', order_no: 'OUT-UPSERT-1', customer_name: 'Before',
      model: 'Model A', batch: 'B', quantity: 2500, inventory_code: 'A',
      package: '', version: '', productionDate: '', traceNo: '', sourceNo: '',
      warehouse_id: warehouse.id, warehouse_name: warehouse.name,
      operation_type: 'outbound' as const, raw_content: 'SAME-QR', scanned_at: new Date().toISOString(),
    };
    const unpack = await database.saveUnpackOperation({
      material, createMaterial: { material, customerName: 'Before', warehouse },
      shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: '',
    });
    expect(unpack.shippedRecord.new_quantity).toBe('1500');
    expect(unpack.remainingRecord.new_quantity).toBe('1000');
    expect(await database.checkMaterialExists(material.order_no, material.model, material.batch, undefined, '', '2500', warehouse.id))
      .toEqual({ material: null, isUnpacked: false, canRescan: false });
    log.mockClear();
    await database.upsertOrder(material.order_no, 'Before', warehouse);
    const updates = () => log.mock.calls.filter(([tag, sql]) => tag === '[MockDB] runAsync:' && typeof sql === 'string' && sql.startsWith('UPDATE '));
    expect(updates()).toHaveLength(0);
    await database.upsertOrder(material.order_no, 'After', warehouse);
    expect(updates()).toHaveLength(3);
    expect((await database.getMaterialsByOrder(material.order_no, warehouse.id))[0])
      .toMatchObject({ customer_name: 'After', quantity: 1500, remaining_quantity: '1000' });
    expect((await database.getOrder(material.order_no, warehouse.id))?.customer_name).toBe('After');
  } finally {
    log.mockRestore();
    if (platform) Object.defineProperty(Platform, 'OS', platform);
  }
});

it('enforces inbound batch trace checks and idempotency while allowing identical no-trace packages', async () => {
  const platform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  try {
    const database: typeof import('../database') = require('../database');
    await database.initDatabase();
    const record = {
      id: 'inbound-batch-1', inbound_no: 'INBOUND-BATCH', warehouse_id: 'BATCH-W1',
      warehouse_name: 'Batch warehouse', inventory_code: 'A', scan_model: 'Model A',
      batch: 'LOT', quantity: 100, in_date: '2026-09-06', traceNo: '',
    };
    const records = [record, { ...record, id: 'inbound-batch-2' }];
    expect(await database.addInboundRecordsBatch(records)).toHaveLength(2);
    expect(await database.addInboundRecordsBatch(records)).toHaveLength(2);
    expect(await database.getInboundRecordsByNo(record.inbound_no)).toHaveLength(2);
    await expect(database.addInboundRecordsBatch([{ ...record, quantity: 200 }])).rejects.toThrow('不同入库内容');
    await expect(database.addInboundRecordsBatch([
      { ...record, id: 'trace-1', traceNo: 'SAME' },
      { ...record, id: 'trace-2', traceNo: ' SAME ' },
    ])).rejects.toThrow('重复追踪码');
    await database.addInboundRecordsBatch([{ ...record, id: 'trace-1', traceNo: 'SAME' }]);
    await expect(database.addInboundRecordsBatch([{ ...record, id: 'trace-2', traceNo: 'SAME' }]))
      .rejects.toThrow('追踪码已入库');
  } finally {
    log.mockRestore();
    error.mockRestore();
    if (platform) Object.defineProperty(Platform, 'OS', platform);
  }
});
