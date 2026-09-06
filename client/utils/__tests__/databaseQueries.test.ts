jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { Platform } from 'react-native';

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
