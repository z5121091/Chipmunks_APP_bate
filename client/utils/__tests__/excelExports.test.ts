import { getErpAccountByOutboundOrderNo } from '../erpAccounts';
import * as XLSX from 'xlsx';
import { generateExcelBase64 } from '../excel';
import { EXCEL_HEADERS } from '../excelSchema';
import { buildInboundSheets } from '../inboundExport';
import { buildInventorySheets } from '../inventoryExport';
import { buildUnpackLabelSheet } from '../labelExport';
import { buildOutboundSheets } from '../outboundExport';

jest.mock('../syncConnection', () => ({ reportSyncConnectionResult: jest.fn() }));

const getCell = (
  headers: string[],
  row: Array<string | number | boolean | Date | null | undefined>,
  header: string
) => row[headers.indexOf(header)];

describe('business Excel schemas', () => {
  it('keeps the full internal label specification in fixed-width model cells', () => {
    const specification = '川土微,CA-IS2062VW,集成隔离电源,CAN隔离器,独立逻辑电源,封装:SOIC16-WB';
    const inventoryCode = 'IC.00000226.00';
    const [outbound] = buildOutboundSheets([{ inventory_code: inventoryCode, model: specification, quantity: 4 }]);
    const [summary, detail] = buildInventorySheets([
      { inventory_code: inventoryCode, scan_model: '普通型号', check_type: 'whole', quantity: 2 },
      { inventory_code: inventoryCode, scan_model: '隔离芯片', internalSpecification: specification, check_type: 'whole', quantity: 4 },
    ]);
    expect(summary.rows).toHaveLength(1);
    expect(getCell(summary.headers, summary.rows[0], EXCEL_HEADERS.actualQuantity)).toBe(6);
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.model)).toBe('普通型号');

    const workbook = XLSX.read(generateExcelBase64([outbound, summary, detail]), { type: 'base64', cellStyles: true });
    for (const [sheet, row] of [[outbound, 1], [summary, 1], [detail, 2]] as const) {
      const modelColumn = sheet.headers.indexOf(EXCEL_HEADERS.model);
      const worksheet = workbook.Sheets[sheet.name];
      expect(worksheet[XLSX.utils.encode_cell({ r: row, c: modelColumn })].v).toBe(specification);
      expect(worksheet['!cols']?.[modelColumn]?.wch).toBe(24);
    }
  });

  it('exports only actual scanned versions from all three document types', () => {
    const record = {
      inventory_code: 'CODE', scan_model: 'MODEL', model: 'MODEL', warehouse_name: '仓库A',
      version: 'V2', versions: ['V1', 'V2', 'V3'], quantity: 4,
    };
    const [, inbound] = buildInboundSheets([record]);
    const [outbound] = buildOutboundSheets([{ ...record, quantity: '4' }]);
    const [, inventory] = buildInventorySheets([{ ...record, check_type: 'whole' }]);
    for (const sheet of [inbound, outbound, inventory]) {
      expect(sheet.headers.filter(header => header.startsWith('版本号'))).toEqual(['版本号']);
      expect(getCell(sheet.headers, sheet.rows[0], EXCEL_HEADERS.version)).toBe('V2');
    }
  });

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

    expect(sheets.map(sheet => sheet.name)).toEqual(['型号汇总', '入库明细']);
    const [summary, detail] = sheets;
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.inboundNo)).toBe(
      'II-2026-07-26-001'
    );
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.inventoryCode)).toBe(
      'IC.00000537.01'
    );
    expect(summary.rows).toHaveLength(1);
    expect(getCell(summary.headers, summary.rows[0], EXCEL_HEADERS.totalQuantity)).toBe(500);
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

    expect(sheets.map((sheet) => sheet.name)).toEqual(['盘点差异', '盘点明细']);
    const [summary, detail] = sheets;
    expect(detail.rows).toHaveLength(2);
    expect(getCell(detail.headers, detail.rows[0], EXCEL_HEADERS.account)).toBe(
      '无锡笃能'
    );
    expect(summary.rows).toHaveLength(1);
    expect(getCell(summary.headers, summary.rows[0], EXCEL_HEADERS.actualQuantity)).toBe(
      4800
    );
    expect(getCell(summary.headers, summary.rows[0], EXCEL_HEADERS.erpQuantity)).toBe(
      4500
    );
    expect(
      getCell(summary.headers, summary.rows[0], EXCEL_HEADERS.differenceQuantity)
    ).toBe(300);
  });
});
