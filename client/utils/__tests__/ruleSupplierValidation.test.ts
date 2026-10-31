import { assertRuleSupplierForScan, RuleSupplierValidationError } from '../ruleSupplierValidation';
import { getInventoryBindingByCode, getInventorySupplierById, type QRCodeRule } from '../database';

jest.mock('../database', () => ({ getInventoryBindingByCode: jest.fn(), getInventorySupplierById: jest.fn() }));

const rule: QRCodeRule = { id: 'A', name: '极海规则', separator: '/', fieldOrder: ['model', 'quantity'], isActive: true,
  supplierId: 'supplier-A', supplierName: '历史快照', description: '', created_at: '', updated_at: '' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getInventorySupplierById).mockResolvedValue({ id: 'supplier-A', name: '极海', created_at: '' });
  jest.mocked(getInventoryBindingByCode).mockResolvedValue({ id: 'binding-A', scan_model: 'APM-1', inventory_code: 'CODE-1', supplier: '极海', created_at: '' });
});

it('preserves unlinked and historical-note rules without reading any supplier data', async () => {
  expect(await assertRuleSupplierForScan({ rule: { ...rule, supplierId: undefined }, inventoryCode: 'CODE-1' })).toBe('unlinked');
  expect(await assertRuleSupplierForScan({ rule: null })).toBe('unlinked');
  expect(getInventorySupplierById).not.toHaveBeenCalled();
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
});

it('checks the independent supplier of the resolved inventory code', async () => {
  expect(await assertRuleSupplierForScan({ rule, inventoryCode: 'CODE-1' })).toBe('consistent');
  expect(getInventoryBindingByCode).toHaveBeenCalledWith('CODE-1');
  expect(getInventorySupplierById).toHaveBeenCalledWith('supplier-A');
});

it('uses the live linked name instead of a stale supplier-name snapshot', async () => {
  await expect(assertRuleSupplierForScan({ rule, materialSupplier: ' 极海 ' })).resolves.toBe('consistent');
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
});

it('rejects a mismatch with both supplier names and never falls back to another rule', async () => {
  jest.mocked(getInventoryBindingByCode).mockResolvedValueOnce({ id: 'binding-A', scan_model: 'APM-1', inventory_code: 'CODE-1', supplier: '领芯', created_at: '' });
  const check = assertRuleSupplierForScan({ rule, inventoryCode: 'CODE-1' });
  await expect(check).rejects.toBeInstanceOf(RuleSupplierValidationError);
  await expect(check).rejects.toThrow('所属供应商：极海\n物料绑定中的供应商：领芯');
});

it('treats an unbound material or blank material supplier as unknown, not a mismatch', async () => {
  await expect(assertRuleSupplierForScan({ rule, inventoryCode: null })).resolves.toBe('unknown');
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
  jest.mocked(getInventoryBindingByCode).mockResolvedValueOnce(null);
  await expect(assertRuleSupplierForScan({ rule, inventoryCode: 'MISSING' })).resolves.toBe('unknown');
  jest.mocked(getInventoryBindingByCode).mockResolvedValueOnce({ id: 'blank', scan_model: 'APM-1', inventory_code: 'BLANK', supplier: '', created_at: '' });
  await expect(assertRuleSupplierForScan({ rule, inventoryCode: 'BLANK' })).resolves.toBe('unknown');
});

it('rejects a dangling explicit supplier link before the material lookup', async () => {
  jest.mocked(getInventorySupplierById).mockResolvedValueOnce(null);
  await expect(assertRuleSupplierForScan({ rule, inventoryCode: 'CODE-1' })).rejects.toThrow('关联的供应商已不存在');
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
});

it('checks the model-only supplier selected by label reprinting without a version lookup', async () => {
  await expect(assertRuleSupplierForScan({ rule, materialSupplier: '领芯' })).rejects.toThrow('本次未录入或打印');
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
});

it('keeps database read failures visible instead of claiming a successful check', async () => {
  jest.mocked(getInventorySupplierById).mockRejectedValueOnce(new Error('database temporarily unavailable'));
  await expect(assertRuleSupplierForScan({ rule, inventoryCode: 'CODE-1' })).rejects.toThrow('database temporarily unavailable');
});
