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
afterAll(() => {
  if (originalPlatform) Object.defineProperty(Platform, 'OS', originalPlatform);
});

it('matches either configured version in the web preview without substring matches', async () => {
  const id = await database.addInventoryBinding({
    scan_model: 'WEB-MULTI', inventory_code: 'WEB-MULTI-CODE', versions: [' V1 ', '', 'v1', 'V2'], supplier: '网页供应商',
  });
  expect(await database.getInventoryBindingByCode('web-multi-code')).toMatchObject({ id, version: 'V1', versions: ['V1', 'V2'] });
  expect(await database.getInventoryCodeByModel('web-multi', ' v2 ')).toBe('WEB-MULTI-CODE');
  expect(await database.getInventoryBindingMatchByModel('WEB-MULTI', 'V2')).toEqual({ inventoryCode: 'WEB-MULTI-CODE', matchKind: 'exact' });
  expect(await database.getExactInventoryCodeByModelVersion('WEB-MULTI', 'V10')).toBeNull();
  expect(await database.getInventoryCodeByModel('WEB-MULTI', 'V10')).toBeNull();
  expect(await database.getSupplierForInventoryBinding({ scanModel: 'WEB-MULTI', version: 'V2' })).toBe('网页供应商');
});

it('searches and edits secondary versions while preserving generic fallback behavior', async () => {
  const id = await database.addInventoryBinding({ scan_model: 'WEB-EDIT', inventory_code: 'WEB-EDIT-CODE', versions: ['FIRST', 'web-find-alias'] });
  await database.addInventoryBinding({ scan_model: 'WEB-EDIT', inventory_code: 'WEB-EDIT-GENERIC' });
  expect((await database.getInventoryBindingsPage({ keyword: 'web-find-alias' })).items)
    .toEqual([expect.objectContaining({ id, versions: ['FIRST', 'web-find-alias'] })]);
  await database.updateInventoryBinding(id, { versions: ['SECOND', 'THIRD'] });
  expect(await database.getExactInventoryCodeByModelVersion('WEB-EDIT', 'web-find-alias')).toBeNull();
  expect(await database.getInventoryCodeByModel('WEB-EDIT', 'FIRST')).toBe('WEB-EDIT-GENERIC');
  expect(await database.getInventoryCodeByModel('WEB-EDIT', 'THIRD')).toBe('WEB-EDIT-CODE');
});

it('rejects conflicts and removes aliases after deletion in the web preview', async () => {
  const id = await database.addInventoryBinding({ scan_model: 'WEB-CONFLICT', inventory_code: 'WEB-OWNER', versions: ['A', 'B'] });
  await expect(database.addInventoryBinding({ scan_model: 'web-conflict', inventory_code: 'WEB-DUPLICATE', versions: ['C', 'b'] })).rejects.toThrow();
  expect(await database.getInventoryBindingByCode('WEB-DUPLICATE')).toBeNull();
  expect(await database.getExactInventoryCodeByModelVersion('WEB-CONFLICT', 'C')).toBeNull();
  await database.deleteInventoryBinding(id);
  expect(await database.getExactInventoryCodeByModelVersion('WEB-CONFLICT', 'B')).toBeNull();
  await expect(database.addInventoryBinding({ scan_model: 'WEB-CONFLICT', inventory_code: 'WEB-REUSE', versions: ['B'] })).resolves.toEqual(expect.any(String));
});

it('imports multiple versions as a safe union and skips conflicting rows in the web preview', async () => {
  await database.addInventoryBinding({ scan_model: 'WEB-IMPORT', inventory_code: 'WEB-IMPORT-CODE', version: 'OLD' });
  await database.addInventoryBinding({ scan_model: 'WEB-IMPORT', inventory_code: 'WEB-IMPORT-OWNER', version: 'OWNED' });
  expect(await database.importInventoryBindings([{ scan_model: 'WEB-IMPORT', inventory_code: 'WEB-IMPORT-CODE', versions: ['OLD', 'NEW'] }]))
    .toMatchObject({ updated: 1, conflicts: [] });
  const conflict = await database.importInventoryBindings([{ scan_model: 'WEB-IMPORT', inventory_code: 'WEB-IMPORT-CODE', versions: ['FREE', 'OWNED'] }]);
  expect(conflict.conflicts).toHaveLength(1);
  expect((await database.getInventoryBindingByCode('WEB-IMPORT-CODE'))?.versions).toEqual(['OLD', 'NEW']);
  expect(await database.getExactInventoryCodeByModelVersion('WEB-IMPORT', 'FREE')).toBeNull();
});
