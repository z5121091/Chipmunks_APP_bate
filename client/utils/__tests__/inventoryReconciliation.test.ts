import type { CurrentStockBatchResult, CurrentStockRow } from '../erpCurrentStock';
import type { ErpAccountConfig } from '../erpAccounts';
import {
  getErpStockQuantityForAccount,
  reconcileInventoryRecords,
} from '../inventoryReconciliation';

const account: ErpAccountConfig = {
  backendBaseUrl: 'https://erp.example.test',
  erpEnabled: true,
  expectedWarehouseName: '无锡仓库',
  key: 'wuxi-duneng',
  name: '无锡笃能',
  sequenceLength: 3,
};

const stockRow = (warehouseName: string, quantity: number | null): CurrentStockRow => ({
  availableQuantity: quantity,
  inventoryCode: 'IC.00000537.01',
  inventoryName: '测试物料',
  quantity,
  raw: {},
  specification: '32F030C8T6',
  warehouseCode: '',
  warehouseName,
});

describe('inventory ERP reconciliation', () => {
  it('uses only the warehouse configured for the selected ERP account', () => {
    expect(
      getErpStockQuantityForAccount(account, 'IC.00000537.01', [
        stockRow('无锡仓库', 1200),
        stockRow('无锡仓库', 300),
        stockRow('无锡总仓', 9000),
      ])
    ).toBe(1500);
  });

  it('queries each inventory code once and compares the summed physical quantity', async () => {
    const fetchCurrentStock = jest.fn(
      async (_account: ErpAccountConfig, _codes: string[]): Promise<CurrentStockBatchResult> => ({
        accountKey: account.key,
        requestCount: 1,
        rows: [stockRow('无锡仓库', 4500)],
      })
    );

    const result = await reconcileInventoryRecords(
      account,
      [
        {
          actualQuantity: 2300,
          inventoryCode: 'IC.00000537.01',
          model: '32F030C8T6',
          quantity: 2500,
        },
        {
          actualQuantity: 2500,
          inventoryCode: 'ic.00000537.01',
          model: '32F030C8T6',
          quantity: 2500,
        },
      ],
      { fetchCurrentStock }
    );

    expect(fetchCurrentStock).toHaveBeenCalledTimes(1);
    expect(fetchCurrentStock).toHaveBeenCalledWith(
      account,
      ['IC.00000537.01']
    );
    expect(result.queryCount).toBe(1);
    expect(result.differenceRows).toEqual([
      {
        differenceQuantity: 300,
        erpQuantity: 4500,
        inventoryCode: 'IC.00000537.01',
        model: '32F030C8T6',
        physicalQuantity: 4800,
      },
    ]);
  });

  it('rejects missing warehouse information rather than guessing the warehouse', async () => {
    await expect(
      reconcileInventoryRecords(
        account,
        [
          {
            inventoryCode: 'IC.00000537.01',
            model: '32F030C8T6',
            quantity: 100,
          },
        ],
        {
          fetchCurrentStock: async () => ({
            accountKey: account.key,
            requestCount: 1,
            rows: [stockRow('', 100)],
          }),
        }
      )
    ).rejects.toThrow('无法核对盘点范围');
  });

  it('uses zero when stock exists only in another warehouse', () => {
    expect(getErpStockQuantityForAccount(account, 'IC.00000537.01', [
      stockRow('其他仓库', 9000),
    ])).toBe(0);
  });

  it('ignores unassigned zero stock alongside real warehouse stock', () => {
    expect(getErpStockQuantityForAccount(account, 'IC.00000537.01', [
      { ...stockRow('', 0), availableQuantity: -0.6 }, stockRow('无锡仓库', 1285),
    ])).toBe(1285);
  });

  it.each([100, 300, 368])('automatically batches %i codes and aggregates A, B, A before querying', async (count) => {
    let active = 0;
    let peak = 0;
    const onProgress = jest.fn();
    const fetchCurrentStock = jest.fn(async (selected: ErpAccountConfig, codes: string[]) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, codes[0] === 'IC.000' ? 5 : 0));
      active -= 1;
      return {
        accountKey: selected.key,
        requestCount: 1,
        rows: codes.slice().reverse().map((inventoryCode) => ({
          ...stockRow(selected.expectedWarehouseName, 100), inventoryCode,
        })),
      };
    });
    const records = Array.from({ length: count }, (_, index) => ({
      inventoryCode: `IC.${String(index).padStart(3, '0')}`, model: '演示物料', quantity: 1,
    }));
    const result = await reconcileInventoryRecords(account, [
      ...records,
      { ...records[0], inventoryCode: ' ic.000 ', quantity: 10, actualQuantity: 9 },
    ], { fetchCurrentStock, onProgress });
    expect(fetchCurrentStock.mock.calls.map((call) => call[1].length)).toEqual(
      Array.from({ length: Math.ceil(count / 100) }, (_, index) => Math.min(100, count - index * 100))
    );
    expect(fetchCurrentStock.mock.calls.every(([selected]) => selected === account)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.queryCount).toBe(Math.ceil(count / 100));
    expect(result.differenceRows).toHaveLength(count);
    expect(result.differenceRows[0]).toMatchObject({ physicalQuantity: 10, erpQuantity: 100, differenceQuantity: -90 });
    expect(onProgress).toHaveBeenLastCalledWith(count, count);
  });

  it('keeps identical codes in the two accounts separate, including empty stock', async () => {
    const shanghai: ErpAccountConfig = { ...account, key: 'shanghai-chipmunk', expectedWarehouseName: '无锡总仓' };
    const records = [{ inventoryCode: 'IC.00000537.01', model: '演示', quantity: 20 }];
    const fetchCurrentStock = jest.fn(async (selected: ErpAccountConfig) => ({
      accountKey: selected.key,
      requestCount: 1,
      rows: selected.key === account.key ? [] : [stockRow('无锡总仓', 15)],
    }));
    const [wuxiResult, shanghaiResult] = await Promise.all([
      reconcileInventoryRecords(account, records, { fetchCurrentStock }),
      reconcileInventoryRecords(shanghai, records, { fetchCurrentStock }),
    ]);
    expect(wuxiResult.differenceRows[0].differenceQuantity).toBe(20);
    expect(shanghaiResult.differenceRows[0].differenceQuantity).toBe(5);
    await expect(reconcileInventoryRecords(account, records, {
      fetchCurrentStock: async () => ({ accountKey: shanghai.key, rows: [], requestCount: 1 }),
    })).rejects.toThrow('账套与当前选择不一致');
  });

  it('waits for in-flight work, stops new batches and rejects instead of producing partial differences', async () => {
    let finishPending!: () => void;
    const pending = new Promise<void>((resolve) => { finishPending = resolve; });
    const fetchCurrentStock = jest.fn(async (_account: ErpAccountConfig, codes: string[]) => {
      if (codes[0] === '000') throw new Error('请求失败');
      await pending;
      return { accountKey: account.key, rows: [], requestCount: 1 };
    });
    const records = Array.from({ length: 350 }, (_, index) => ({
      inventoryCode: String(index).padStart(3, '0'), model: '演示', quantity: 1,
    }));
    let settled = false;
    const result = reconcileInventoryRecords(account, records, { fetchCurrentStock });
    const check = expect(result).rejects.toThrow('请求失败');
    void result.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishPending();
    await check;
    expect(fetchCurrentStock).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(350);
  });

  it('rejects partially missing quantities rather than silently undercounting', () => {
    expect(() => getErpStockQuantityForAccount(account, 'IC.00000537.01', [
      stockRow('无锡仓库', 10), stockRow('无锡仓库', null),
    ])).toThrow('库存数量字段');
  });
});
