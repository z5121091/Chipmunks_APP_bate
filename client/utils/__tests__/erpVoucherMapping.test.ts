jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import type { ErpAccountConfig } from '../erpAccounts';
import {
  isPurchaseReceiveWarehouseAllowed,
  mapPurchaseReceiveVoucher,
} from '../erpPurchaseReceive';
import { mapSaleDispatchVoucher } from '../erpSaleDispatch';

const account: ErpAccountConfig = {
  backendBaseUrl: 'http://example.test',
  erpEnabled: true,
  expectedWarehouseName: '无锡仓库',
  key: 'wuxi-duneng',
  name: '无锡笃能',
  sequenceLength: 3,
};

describe('ERP voucher payload mapping', () => {
  it('maps a sales dispatch voucher and preserves its inventory code casing', () => {
    const voucher = mapSaleDispatchVoucher(account, {
      Clerk: { Name: '仓管员' },
      Code: 'IO-2026-07-26-001',
      ID: 123,
      Partner: { Name: '测试客户' },
      RDRecordDetails: [
        {
          Inventory: {
            Code: 'ic.00000537.01',
            Name: '微控制器',
            Specification: '32F030C8T6',
          },
          Quantity: '2,500',
          Unit: { Name: 'PCS' },
        },
      ],
      VoucherDate: '2026-07-26',
      VoucherState: { Name: '未审' },
      Warehouse: { Name: '无锡仓库' },
    });

    expect(voucher.code).toBe('IO-2026-07-26-001');
    expect(voucher.customerName).toBe('测试客户');
    expect(voucher.warehouseName).toBe('无锡仓库');
    expect(voucher.lines).toHaveLength(1);
    expect(voucher.lines[0]).toMatchObject({
      inventoryCode: 'ic.00000537.01',
      inventoryName: '微控制器',
      quantity: 2500,
      specification: '32F030C8T6',
      unitName: 'PCS',
    });
  });

  it('only allows the Shanghai account to show purchase receipts from 无锡总仓', () => {
    const shanghaiAccount: ErpAccountConfig = {
      ...account,
      expectedWarehouseName: '无锡总仓',
      key: 'shanghai-chipmunk',
      name: '上海花栗鼠',
      sequenceLength: 2,
    };

    expect(isPurchaseReceiveWarehouseAllowed(shanghaiAccount, ' 无锡总仓 ')).toBe(true);
    expect(isPurchaseReceiveWarehouseAllowed(shanghaiAccount, '苏州材料库')).toBe(false);
    expect(isPurchaseReceiveWarehouseAllowed(account, '苏州材料库')).toBe(true);
  });

  it('maps a purchase receipt voucher and numeric quantities with separators', () => {
    const voucher = mapPurchaseReceiveVoucher(account, {
      Code: 'II-2026-07-26-001',
      ID: 'receive-1',
      Partner: { Code: 'SUP-1', Name: '测试供应商' },
      RDRecordDetails: [
        {
          ID: 'line-1',
          Inventory: {
            Code: 'ic.00000453.00',
            Name: '测试物料',
            Specification: 'TEST-MODEL',
          },
          PurchaseOrderCode: 'PO-001',
          Quantity: '1,250',
          Unit: { Name: 'PCS' },
        },
      ],
      VoucherDate: '2026-07-26',
      VoucherState: { Code: '0', Name: '未审' },
      Warehouse: { Code: 'WH-1', Name: '无锡仓库' },
    });

    expect(voucher.partnerName).toBe('测试供应商');
    expect(voucher.stateName).toBe('未审');
    expect(voucher.lines[0]).toMatchObject({
      inventoryCode: 'ic.00000453.00',
      purchaseOrderCode: 'PO-001',
      quantity: 1250,
      specification: 'TEST-MODEL',
    });
  });
});
