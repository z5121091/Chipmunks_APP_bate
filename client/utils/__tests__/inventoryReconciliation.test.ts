import type { CurrentStockQueryResult, CurrentStockRow } from '../erpCurrentStock';
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
      async (_account: ErpAccountConfig, inventoryCode: string): Promise<CurrentStockQueryResult> => ({
        accountKey: account.key,
        accountName: account.name,
        inventoryCode,
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
      'IC.00000537.01',
      { forceRefresh: true }
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

  it('fails instead of silently comparing a different warehouse', async () => {
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
            accountName: account.name,
            inventoryCode: 'IC.00000537.01',
            rows: [stockRow('无锡总仓', 100)],
          }),
        }
      )
    ).rejects.toThrow('未找到仓库“无锡仓库”');
  });
});
