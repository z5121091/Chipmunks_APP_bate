import { backendJsonRequest } from '../backendApi';
import { ERP_ACCOUNTS } from '../erpAccounts';
import { fetchAllPendingPurchaseReceives, fetchPurchaseReceiveVoucher, getPurchaseReceiveBindingLines, mapPurchaseReceiveVoucher } from '../erpPurchaseReceive';
import { buildOutboundProgress } from '../outboundProgress';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backendApi', () => ({
  ...jest.requireActual('../backendApi'), backendJsonRequest: jest.fn(),
}));
const request = jest.mocked(backendJsonRequest);
const page = (rows: string[][], total = 168) => ({ success: true, data: { code: '0', data: {
  Columns: ['RDRecord.Code', 'RDRecord.Warehouse.Name', 'RDRecord.VoucherState.Code'],
  Rows: rows, TotalCount: total, TotalPageNum: Math.ceil(total / 100),
} } });
beforeEach(() => request.mockReset());

it.each(['珠海极海半导体有限公司', '珠海领芯科技有限公司'])(
  'matches Shanghai inbound aliases for %s without changing ERP data or quantities', supplier => {
    const account = ERP_ACCOUNTS.find(item => item.key === 'shanghai-chipmunk')!;
    const voucher = mapPurchaseReceiveVoucher(account, {
      Partner: { Name: supplier },
      RDRecordDetails: [
        { Inventory: { Code: 'IC.M0000255.00' }, Quantity: 100 },
        { Inventory: { Code: 'IC.M0000255.00' }, Quantity: 50 },
      ],
    });
    const original = JSON.stringify(voucher);
    const lines = getPurchaseReceiveBindingLines(voucher);
    expect(lines.map(line => line.inventoryCode)).toEqual(['IC.00000255.00', 'IC.00000255.00']);
    const records = [{ id: 'scan', model: 'Model', inventoryCode: 'IC.00000255.00', quantity: 150 }];
    expect(buildOutboundProgress(lines, records)).toEqual([expect.objectContaining({
      status: 'complete', sourceLineCount: 2, requiredQuantity: 150, scannedQuantity: 150,
    })]);
    expect(buildOutboundProgress(lines, [{ ...records[0], quantity: 151 }])[0].status).toBe('over');
    expect(JSON.stringify(voucher)).toBe(original);
    expect(lines[0].raw).toBe(voucher.lines[0].raw);
  }
);

it('does not alias other accounts, suppliers, ordinary codes or codes outside the agreed format', () => {
  for (const account of ERP_ACCOUNTS) {
    for (const supplier of ['珠海极海半导体有限公司', '珠海领芯科技有限公司', '其他供应商', '', '极海']) {
      const voucher = mapPurchaseReceiveVoucher(account, {
        Partner: { Name: supplier },
        RDRecordDetails: [{ Inventory: { Code: 'IC.M0000255.00' }, Quantity: 100 }],
      });
      const eligible = account.key === 'shanghai-chipmunk' && supplier.startsWith('珠海');
      expect(getPurchaseReceiveBindingLines(voucher)[0].inventoryCode).toBe(
        eligible ? 'IC.00000255.00' : 'IC.M0000255.00');
    }
  }
  const codes = ['IC.00000255.00', 'IC.M000255.00', 'IC.M00000255.00', 'IC.M0000255.001', 'IC.M00002A5.00', 'XM.M0000255.00'];
  const voucher = mapPurchaseReceiveVoucher(ERP_ACCOUNTS[0], {
    Partner: { Name: '珠海极海半导体有限公司' },
    RDRecordDetails: codes.map(Code => ({ Inventory: { Code }, Quantity: 1 })),
  });
  expect(getPurchaseReceiveBindingLines(voucher).map(line => line.inventoryCode)).toEqual(codes);
  voucher.lines[0].inventoryCode = 'ic.m0000255.01';
  expect(getPurchaseReceiveBindingLines(voucher)[0].inventoryCode).toBe('IC.00000255.01');
});

it.each(ERP_ACCOUNTS)('reads all 168 vouchers with account-isolated paging: $key', async account => {
  const rows = Array.from({ length: 168 }, (_, i) => [`II-${i}`, account.expectedWarehouseName, '00']);
  request.mockResolvedValueOnce(page(rows.slice(0, 100))).mockResolvedValueOnce(page(rows.slice(100)));
  const result = await fetchAllPendingPurchaseReceives(account, { bypassCache: true });
  expect(result.items).toHaveLength(168);
  expect(request).toHaveBeenCalledTimes(2);
  for (const [index, call] of request.mock.calls.entries()) {
    expect(call[1]).toMatchObject({
      baseUrl: account.backendBaseUrl, erpAccountKey: account.key, erpCacheMode: 'bypass',
      body: { pageIndex: index, pageSize: 100 },
    });
  }
});

it('keeps reading when other Shanghai warehouses occupy the entire first page', async () => {
  const account = ERP_ACCOUNTS.find(item => item.key === 'shanghai-chipmunk')!;
  request.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => [`II-${i}`, '其他仓库', '00']), 101));
  request.mockResolvedValueOnce(page([['II-target', account.expectedWarehouseName, '00']], 101));
  expect((await fetchAllPendingPurchaseReceives(account)).items.map(item => item.code)).toEqual(['II-target']);
});

it('rejects a failed later page instead of returning a partial list', async () => {
  request.mockResolvedValueOnce(page([])).mockRejectedValueOnce(new Error('page unavailable'));
  await expect(fetchAllPendingPurchaseReceives(ERP_ACCOUNTS[0])).rejects.toThrow('page unavailable');
});

it('deduplicates page overlaps and bounds abnormal page counts', async () => {
  const account = ERP_ACCOUNTS[0];
  const row = ['II-1', account.expectedWarehouseName, '00'];
  request.mockResolvedValueOnce(page([row])).mockResolvedValueOnce(page([row]));
  expect((await fetchAllPendingPurchaseReceives(account)).items).toHaveLength(1);
  request.mockResolvedValueOnce(page([], 10_001));
  await expect(fetchAllPendingPurchaseReceives(account)).rejects.toThrow('超过100页');
});

it('bypasses cached details and rejects a wrong warehouse or audited voucher', async () => {
  const account = ERP_ACCOUNTS[0];
  const dto = { Code: 'II-2026-09-06-01', VoucherState: { Code: '00' }, Warehouse: { Name: '其他仓库' } };
  request.mockResolvedValueOnce({ success: true, data: { code: '0', data: dto } });
  await expect(fetchPurchaseReceiveVoucher(account, dto.Code, { bypassCache: true })).rejects.toThrow('单据仓库应为');
  expect(request.mock.calls[0][1]).toMatchObject({ erpAccountKey: account.key, erpCacheMode: 'bypass' });
  request.mockResolvedValueOnce({ success: true, data: { code: '0', data: { ...dto, VoucherState: { Code: '01' } } } });
  await expect(fetchPurchaseReceiveVoucher(account, dto.Code)).rejects.toThrow('不再允许扫码入库');
});
