import { Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

it('supports supplier selection data and deletion protection in the existing web preview database', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  try {
    const database: typeof import('../database') = require('../database');
    const id = await database.addInventorySupplier('  Preview Supplier  ');
    expect(await database.addInventorySupplier('preview supplier')).toBe(id);
    const binding = await database.addInventoryBinding({
      scan_model: 'PREVIEW-MODEL', inventory_code: 'PREVIEW-CODE', supplier: 'Preview Supplier',
    });
    expect(await database.getInventorySuppliers()).toEqual([
      expect.objectContaining({ id, name: 'Preview Supplier', binding_count: 1 }),
    ]);
    const ruleId = await database.addRule({
      name: 'Preview supplier rule', description: '', separator: '/', fieldOrder: ['model', 'quantity'],
      isActive: true, supplierId: id, supplierName: 'Ignored snapshot',
    });
    expect(await database.getRuleById(ruleId)).toMatchObject({ supplierId: id, supplierName: 'Preview Supplier' });
    expect(await database.getInventorySupplierById(id)).toMatchObject({ id, name: 'Preview Supplier' });
    expect(await database.getInventoryBindingByCode(' preview-code ')).toMatchObject({ id: binding });
    await expect(database.deleteInventorySupplier(id)).rejects.toThrow('正在被 1 条物料绑定使用');
    await database.updateInventoryBinding(binding, { supplier: '' });
    expect((await database.getInventorySuppliers())[0].binding_count).toBe(0);
    expect((await database.getInventorySuppliers())[0].rule_count).toBe(1);
    await expect(database.deleteInventorySupplier(id)).rejects.toThrow('1 条解析规则');
    await database.updateRule(ruleId, { supplierId: '' });
    expect((await database.getRuleById(ruleId))?.supplierId).toBeUndefined();
    expect((await database.getInventorySuppliers())[0].rule_count).toBe(0);
    await database.deleteInventorySupplier(id);
    expect(await database.getInventorySuppliers()).toEqual([]);
    const previousRuleIds = (await database.getAllRules()).map(rule => rule.id);
    const newTopId = await database.addRule({
      name: 'Preview new top rule', description: '', separator: '|', fieldOrder: ['model', 'quantity'], isActive: true,
    });
    expect((await database.getAllRules()).map(rule => rule.id)).toEqual([newTopId, ...previousRuleIds]);
  } finally {
    if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
  }
});
