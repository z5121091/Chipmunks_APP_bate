import { fetchCurrentStockByInventoryCode } from '../erpCurrentStock';
import { queryInternalLabelStock } from '../internalLabels';
import { ERP_ACCOUNTS } from '../erpAccounts';
import { recoverConfirmedScannerContent, shouldWaitForQRCodeContinuation } from '../qrcodeParser';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../database', () => ({ inspectQRCodeRule: jest.fn() }));
jest.mock('../erpCurrentStock', () => ({ fetchCurrentStockByInventoryCode: jest.fn() }));

const code = 'RES.01120042.00';
const first = `HLS~#~${code}~#~200~#~P6Z9H8J4K3R2~#~1`;
const second = `HLS~#~${code}~#~200~#~A6Z9H8J4K3R2~#~1`;
beforeEach(() => jest.mocked(fetchCurrentStockByInventoryCode).mockReset());

const stockRow = (warehouseName: string, warehouseCode = '001', quantity = '477') => ({
  inventoryCode: code, inventoryName: '贴片电阻', specification: '12KΩ,±1%,0402', warehouseCode,
  warehouseName, quantity: Number(quantity), availableQuantity: 999, raw: { ExistingQuantity: quantity },
});

it.each(ERP_ACCOUNTS)('uses only the current account main warehouse for internal labels: $key', async account => {
  const other = ERP_ACCOUNTS.find(item => item.key !== account.key)!;
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue({
    accountKey: account.key, accountName: account.name, inventoryCode: code,
    rows: [stockRow('苏州仓', '002', '888'), stockRow(other.expectedWarehouseName, '099', '666'), stockRow(account.expectedWarehouseName)],
  });
  await expect(queryInternalLabelStock(account.key, code)).resolves.toEqual([expect.objectContaining({
    accountKey: account.key, warehouseName: account.expectedWarehouseName, warehouseCode: '001', quantity: 477,
  })]);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledWith(account, code, { forceRefresh: true });
});

it('does not fall back to another warehouse when the main warehouse has no result or zero stock', async () => {
  const account = ERP_ACCOUNTS[0];
  const result = { accountKey: account.key, accountName: account.name, inventoryCode: code, rows: [stockRow('翰哲仓', '101', '999')] };
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue(result);
  await expect(queryInternalLabelStock(account.key, code)).rejects.toThrow('无锡总仓');
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue({ ...result, rows: [...result.rows, stockRow(account.expectedWarehouseName, '001', '0')] });
  await expect(queryInternalLabelStock(account.key, code)).resolves.toEqual([expect.objectContaining({ quantity: 0, warehouseName: account.expectedWarehouseName })]);
});

it('rejects mismatched accounts and ambiguous main-warehouse records', async () => {
  const account = ERP_ACCOUNTS[0];
  const result = { accountKey: account.key, accountName: account.name, inventoryCode: code, rows: [stockRow(account.expectedWarehouseName)] };
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue({ ...result, accountKey: 'wuxi-duneng' });
  await expect(queryInternalLabelStock(account.key, code)).rejects.toThrow('账套不匹配');
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue({ ...result, rows: [...result.rows, stockRow(account.expectedWarehouseName, '001-DUPLICATE')] });
  await expect(queryInternalLabelStock(account.key, code)).rejects.toThrow('多条现存量');
});

it('takes only the ERP ExistingQuantity, preserving the exact matched warehouse and inventory name', async () => {
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValue({
    accountKey: 'shanghai-chipmunk', accountName: '上海花栗鼠', inventoryCode: code,
    rows: [{ inventoryCode: code, inventoryName: '贴片电阻', specification: '12KΩ,±1%,0402',
      warehouseCode: '001', warehouseName: '无锡总仓', quantity: 999, availableQuantity: 30,
      raw: { ExistingQuantity: '477.00000000000000' } }],
  });
  await expect(queryInternalLabelStock('shanghai-chipmunk', code)).resolves.toEqual([{
    accountKey: 'shanghai-chipmunk', warehouseCode: '001', warehouseName: '无锡总仓',
    inventoryCode: code, inventoryName: '贴片电阻', specification: '12KΩ,±1%,0402', quantity: 477,
  }]);
});

it('waits for a complete internal label and recovers a following valid label from native cumulative text', () => {
  expect(shouldWaitForQRCodeContinuation(first.slice(0, -1), [])).toBe(true);
  expect(shouldWaitForQRCodeContinuation(first, [])).toBe(false);
  expect(recoverConfirmedScannerContent(first + second, first, [])).toBe(second);
  expect(recoverConfirmedScannerContent(first + '2', first, [])).toBe(first + '2');
});
