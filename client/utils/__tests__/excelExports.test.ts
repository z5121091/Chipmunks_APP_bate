import { getErpAccountByOutboundOrderNo } from '../erpAccounts';
import { EXCEL_HEADERS } from '../excelSchema';
import { buildInboundSheets } from '../inboundExport';
import { buildInventorySheets } from '../inventoryExport';
import { buildUnpackLabelSheet } from '../labelExport';
import { buildOutboundSheets } from '../outboundExport';

const getCell = (
  headers: string[],
  row: Array<string | number | boolean | Date | null | undefined>,
  header: string
) => row[headers.indexOf(header)];

describe('business Excel schemas', () => {
  it('keeps inbound detail fields and aggregates quantities by material identity', () => {
    const sheets = buildInboundSheets([
      {
        inbound_no: 'II-2026-07-26-001',
        inventory_code: 'IC.00000537.01',
        quantity: 100,
        scan_model: '32F030C8T6',
        version: 'B1',
        warehouse_name: '无锡仓库',
      },
      {
        inbound_no: 'II-2026-07-26-001',
        inventory_code: 'IC.00000537.01',
        quantity: 400,
        scan_model: '32F030C8T6',
        version: 'B1',
        warehouse_name: '无锡仓库',
      },
    ]);

    const detail = sheets[0];
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.inboundNo)).toBe(
      'II-2026-07-26-001'
    );
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.inventoryCode)).toBe(
      'IC.00000537.01'
    );
    expect(sheets[1].rows).toHaveLength(1);
    expect(getCell(sheets[1].headers, sheets[1].rows[0], EXCEL_HEADERS.totalQuantity)).toBe(500);
  });

  it('writes outbound account, voucher and quantity into the monthly sheet', () => {
    const orderNo = 'IO-2026-07-26-001';
    const [sheet] = buildOutboundSheets([
      {
        order_no: orderNo,
        customer_name: '测试客户',
        inventory_code: 'IC.00000537.01',
        model: '32F030C8T6',
        quantity: '2500',
        scanned_at: '2026-07-26 10:00:00',
        warehouse_name: '无锡仓库',
      },
    ]);

    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.account)).toBe(
      getErpAccountByOutboundOrderNo(orderNo)?.name
    );
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.outboundNo)).toBe(orderNo);
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.quantity)).toBe(2500);
  });

  it('uses the new trace number and split quantity for unpack labels', () => {
    const sheet = buildUnpackLabelSheet([
      {
        label_type: 'remaining',
        new_quantity: 2000,
        new_traceNo: 'TRACE-2',
        original_quantity: 2500,
        traceNo: 'TRACE',
        warehouse_name: '无锡仓库',
        supplier: '珠海领芯科技有限公司',
        model: 'DEMO',
        inventory_code: 'IC.TEST.00',
        unpacked_at: '2026/09/15 14:30',
      },
    ]);

    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.traceNo)).toBe('TRACE-2');
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.originalQuantity)).toBe(2500);
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.labelQuantity)).toBe(2000);
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.model)).toBe('DEMO');
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.inventoryCode)).toBe('IC.TEST.00');
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.unpackTime)).toBe('2026-09-15 14:30');
    expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.supplier)).toBe(
      '珠海领芯科技有限公司'
    );
  });

  it('exports one inventory workbook with detail and ERP difference worksheets', () => {
    const sheets = buildInventorySheets([
      {
        account_name: '无锡笃能',
        check_no: 'PD20260810001',
        check_type: 'whole',
        erp_quantity: 4500,
        inventory_code: 'IC.00000537.01',
        quantity: 2500,
        actual_quantity: 2300,
        scan_model: '32F030C8T6',
        warehouse_name: '无锡仓库',
      },
      {
        account_name: '无锡笃能',
        check_no: 'PD20260810001',
        check_type: 'whole',
        erp_quantity: 4500,
        inventory_code: 'ic.00000537.01',
        quantity: 2500,
        actual_quantity: 2500,
        scan_model: '32F030C8T6-历史别名',
        warehouse_name: '无锡仓库',
      },
    ]);

    expect(sheets.map((sheet) => sheet.name)).toEqual(['盘点明细', '盘点差异']);
    expect(sheets[0].rows).toHaveLength(2);
    expect(getCell(sheets[0].headers, sheets[0].rows[0], EXCEL_HEADERS.account)).toBe(
      '无锡笃能'
    );
    expect(sheets[1].rows).toHaveLength(1);
    expect(getCell(sheets[1].headers, sheets[1].rows[0], EXCEL_HEADERS.actualQuantity)).toBe(
      4800
    );
    expect(getCell(sheets[1].headers, sheets[1].rows[0], EXCEL_HEADERS.erpQuantity)).toBe(
      4500
    );
    expect(
      getCell(sheets[1].headers, sheets[1].rows[0], EXCEL_HEADERS.differenceQuantity)
    ).toBe(300);
  });
});
