import { BackendApiError, backendJsonRequest } from '../backendApi';
import { ERP_ACCOUNTS } from '../erpAccounts';
import { fetchCurrentStockByInventoryCode, fetchCurrentStockByInventoryCodes, parseCurrentStockRows } from '../erpCurrentStock';

jest.mock('../backendApi', () => ({
  ...jest.requireActual('../backendApi'),
  backendJsonRequest: jest.fn(),
}));

const request = jest.mocked(backendJsonRequest);
beforeEach(() => request.mockReset());

describe('single material stock requests', () => {
  it.each(ERP_ACCOUNTS)('sends one code in one request for $key, not 100 requests', async account => {
    request.mockResolvedValue({ success: true, data: [] });
    const code = 'IC.SINGLE';
    await fetchCurrentStockByInventoryCode(account, code);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      baseUrl: account.backendBaseUrl,
      erpAccountKey: account.key,
      body: { param: {
        Inventory: [{ Code: code }], PageSize: '100', PageIndex: '1',
        GroupInfo: { Warehouse: true, Inventory: true },
      } },
    }));
    await fetchCurrentStockByInventoryCode(account, code);
    expect(request).toHaveBeenCalledTimes(1);
    await fetchCurrentStockByInventoryCode(account, code, { forceRefresh: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed responses instead of treating them as a successful empty result', async () => {
    for (const response of [{ success: true }, { success: true, data: { Summary: [] } }]) {
      request.mockResolvedValue(response);
      await expect(fetchCurrentStockByInventoryCode(ERP_ACCOUNTS[0], 'IC.BAD', { forceRefresh: true }))
        .rejects.toThrow('未返回有效的库存明细');
    }
    request.mockResolvedValue({ success: true, data: [] });
    expect((await fetchCurrentStockByInventoryCode(ERP_ACCOUNTS[0], 'IC.BAD')).rows).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('current stock response parsing', () => {
  it('uses the documented row collection and filters other inventory codes', () => {
    const rows = parseCurrentStockRows(
      {
        data: {
          Rows: [
            {
              Inventory: { Code: 'ic.00000537.01', Name: '目标物料' },
              Quantity: 12,
              Warehouse: { Name: '无锡仓库' },
            },
            {
              Inventory: { Code: 'IC.OTHER.00', Name: '其他物料' },
              Quantity: 99,
              Warehouse: { Name: '无锡仓库' },
            },
          ],
          Summary: [{ Quantity: 999999 }],
        },
      },
      'IC.00000537.01'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inventoryCode: 'ic.00000537.01',
      inventoryName: '目标物料',
      quantity: 12,
    });
  });

  it('does not fall back to unrelated arrays when the row collection is empty', () => {
    const rows = parseCurrentStockRows(
      {
        data: {
          Rows: [],
          Summary: [{ Quantity: 999999 }],
        },
      },
      'IC.00000537.01'
    );

    expect(rows).toEqual([]);
  });

  it('keeps rows when ERP omits the repeated inventory code', () => {
    const rows = parseCurrentStockRows(
      {
        data: {
          Rows: [{ Quantity: 4, WarehouseName: '无锡仓库' }],
        },
      },
      'IC.00000537.01'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].inventoryCode).toBe('IC.00000537.01');
  });
});

describe('batched current stock requests', () => {
  const account = ERP_ACCOUNTS[0];
  const row = (code: string, quantity = '5') => ({
    InventoryCode: code, ExistingQuantity: quantity, AvailableQuantity: '999',
    WarehouseName: account.expectedWarehouseName,
  });

  it.each(ERP_ACCOUNTS)('sends 100 unique codes to $key with cache bypass', async (selected) => {
    request.mockResolvedValue({ success: true, data: [
      { ...row('IC.099'), TotalCount: 2 }, row('IC.000', '1,000'),
    ] });
    const codes = Array.from({ length: 100 }, (_, index) => `IC.${String(index).padStart(3, '0')}`);
    const result = await fetchCurrentStockByInventoryCodes(selected, [...codes, ' ic.000 ']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      baseUrl: selected.backendBaseUrl,
      erpAccountKey: selected.key,
      erpCacheMode: 'bypass',
      body: { param: {
        Inventory: expect.any(Array), PageSize: '1000', PageIndex: '1',
        GroupInfo: { Warehouse: true, Inventory: true },
      } },
    }));
    const body = request.mock.calls[0][1]?.body as { param: { Inventory: unknown[] } };
    expect(body.param.Inventory).toHaveLength(100);
    expect(result.rows.map((item) => item.quantity)).toEqual([5, 1000]);
    expect(result.accountKey).toBe(selected.key);
    expect(result.requestCount).toBe(1);
  });

  it('reads remaining pages instead of assuming 100 codes produce at most 100 rows', async () => {
    request.mockResolvedValueOnce({ success: true, data: Array.from({ length: 1000 }, (_, index) => ({
      ...row('IC.A'), WarehouseCode: String(index), TotalCount: 1001,
    })) }).mockResolvedValueOnce({ success: true, data: [{ ...row('IC.B'), TotalCount: 1001 }] });
    const result = await fetchCurrentStockByInventoryCodes(account, ['IC.A', 'IC.B']);
    expect(result.rows).toHaveLength(1001);
    expect(result.requestCount).toBe(2);
    expect(request.mock.calls[1][1]?.body).toMatchObject({ param: { PageIndex: '2' } });
  });

  it('accepts unassigned zero-existing-stock rows without substituting their negative available quantity', async () => {
    request.mockResolvedValue({ success: true, data: [
      { ...row('IC.A', '0'), WarehouseName: '', AvailableQuantity: '-0.6' },
      row('IC.A', '1285'),
    ] });
    const result = await fetchCurrentStockByInventoryCodes(account, ['IC.A', 'IC.B']);
    expect(result.rows.map((item) => item.quantity)).toEqual([0, 1285]);
  });

  it('accepts explicit empty collections, not missing or failed response data', async () => {
    request.mockResolvedValue({ success: true, data: [] });
    expect((await fetchCurrentStockByInventoryCodes(account, ['IC.A'])).rows).toEqual([]);
    for (const response of [
      { success: true },
      { success: false, message: '上游失败', data: [] },
      { success: true, data: { code: '500', data: [] } },
      { success: true, data: { Summary: [] } },
    ]) {
      request.mockResolvedValue(response);
      await expect(fetchCurrentStockByInventoryCodes(account, ['IC.A'])).rejects.toThrow();
    }
  });

  it.each([
    { ExistingQuantity: '1', WarehouseName: account.expectedWarehouseName },
    row('IC.UNREQUESTED'),
    { ...row('IC.A'), ExistingQuantity: null },
    { ...row('IC.A'), WarehouseName: '' },
  ])('rejects ambiguous or incomplete rows %#', async (invalid) => {
    request.mockResolvedValue({ success: true, data: [invalid] });
    await expect(fetchCurrentStockByInventoryCodes(account, ['IC.A', 'IC.B'])).rejects.toThrow();
  });

  it('rejects incomplete, repeated or inconsistent pages', async () => {
    const first = { success: true, data: [{ ...row('IC.A'), TotalCount: 2 }] };
    for (const second of [
      { success: true, data: [] }, first,
      { success: true, data: [{ ...row('IC.B'), TotalCount: 3 }] },
    ]) {
      request.mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      await expect(fetchCurrentStockByInventoryCodes(account, ['IC.A', 'IC.B'])).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(2);
    }
  });

  it('rejects oversized requests before making a network call', async () => {
    await expect(fetchCurrentStockByInventoryCodes(account, Array.from({ length: 101 }, (_, index) => String(index))))
      .rejects.toThrow('1 至 100');
    expect(request).not.toHaveBeenCalled();
  });

  it('retries a transient failure once but never retries permission errors', async () => {
    jest.useFakeTimers();
    try {
      request.mockRejectedValueOnce(new BackendApiError('稍后重试', 503, {}))
        .mockResolvedValueOnce({ success: true, data: [] });
      const result = fetchCurrentStockByInventoryCodes(account, ['IC.A']);
      await jest.advanceTimersByTimeAsync(1000);
      expect((await result).requestCount).toBe(2);
      request.mockReset().mockRejectedValue(new BackendApiError('无权限', 403, {}));
      await expect(fetchCurrentStockByInventoryCodes(account, ['IC.A'])).rejects.toThrow('无权限');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
