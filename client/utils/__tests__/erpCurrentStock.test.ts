import { parseCurrentStockRows } from '../erpCurrentStock';

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
