import { Platform } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const originalPlatform = Object.getOwnPropertyDescriptor(Platform, 'OS');
let database: typeof import('../database');
beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  database = require('../database');
  await database.initDatabase();
});
afterAll(() => { if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform); });

it('keeps web preview filtering, pagination and secondary-version search consistent with native', async () => {
  const prefix = 'WEB-UNASSIGNED-';
  const one = await database.addInventoryBinding({ scan_model: `${prefix}ONE`, inventory_code: `${prefix}CODE-ONE`,
    versions: ['V1', 'WEB-SECONDARY-ALIAS'] });
  const two = await database.addInventoryBinding({ scan_model: `${prefix}TWO`, inventory_code: `${prefix}CODE-TWO`, supplier: '  ' });
  await database.addInventoryBinding({ scan_model: `${prefix}BOUND`, inventory_code: `${prefix}CODE-BOUND`, supplier: 'Web existing supplier' });
  const first = await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: prefix, pageSize: 1 });
  const second = await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: prefix, pageSize: 1, page: 20 });
  expect(first).toMatchObject({ total: 2, page: 1, pageSize: 1 });
  expect(second).toMatchObject({ total: 2, page: 2 });
  expect(new Set([...first.items, ...second.items].map(item => item.id))).toEqual(new Set([one, two]));
  expect((await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: 'web-secondary-alias' })).items)
    .toEqual([expect.objectContaining({ id: one, versions: ['V1', 'WEB-SECONDARY-ALIAS'] })]);
  expect((await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: `${prefix}CODE-TWO` })).items)
    .toEqual([expect.objectContaining({ id: two })]);
  expect((await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: `${prefix}CODE-BOUND` })).total).toBe(0);
  expect((await database.getInventoryBindingsPage({ keyword: prefix })).total).toBe(3);
});

it('assigns only the supplier in web preview and serializes duplicate saves without silent overwrites', async () => {
  const code = 'WEB-ASSIGN-IDENTITY';
  const id = await database.addInventoryBinding({ scan_model: 'WEB-ASSIGN-MODEL', inventory_code: code,
    versions: ['V1', 'V2'], description: 'Keep web note' });
  const supplierId = await database.addInventorySupplier('Web selected supplier');
  const before = await database.getInventoryBindingByCode(code);
  await expect(database.assignInventoryBindingSupplier(id, 'MISSING')).rejects.toThrow('已不存在');
  expect(await database.getInventoryBindingByCode(code)).toEqual(before);
  const results = await Promise.allSettled([
    database.assignInventoryBindingSupplier(id, supplierId), database.assignInventoryBindingSupplier(id, supplierId),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(await database.getInventoryBindingByCode(code)).toEqual({ ...before, supplier: 'Web selected supplier' });
  expect((await database.getInventoryBindingsPage({ supplierStatus: 'unassigned', keyword: code })).total).toBe(0);
  expect((await database.getInventorySuppliers()).find(supplier => supplier.id === supplierId)?.binding_count).toBe(1);
  await database.deleteInventoryBinding(id);
  await expect(database.assignInventoryBindingSupplier(id, supplierId)).rejects.toThrow('已不存在');
});
