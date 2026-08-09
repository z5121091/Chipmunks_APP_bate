import type { ExcelSheet } from './excel';
import {
  buildExcelSheet,
  buildExportFileNameWithSequence,
  buildMaterialDetailColumns,
  EXCEL_HEADERS,
} from './excelSchema';
import { getErpAccountByOutboundOrderNo } from './erpAccounts';
import { parseQuantity } from './quantity';
import { formatTime } from './time';

export interface OutboundExportRecord {
  account_name?: string;
  order_no?: string;
  customer_name?: string;
  warehouse_name?: string;
  inventory_code?: string;
  model?: string;
  version?: string;
  package?: string;
  batch?: string;
  quantity?: number | string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  scanned_at?: string;
}

export const buildOutboundExportFileName = (
  warehouseName: string,
  sequence: number,
  date = new Date()
): string => {
  return buildExportFileNameWithSequence('出库单', [warehouseName || '未命名仓库'], sequence, date);
};

const OUTBOUND_COLUMNS = [
  {
    header: EXCEL_HEADERS.account,
    value: (record: OutboundExportRecord) =>
      record.account_name || getErpAccountByOutboundOrderNo(record.order_no || '')?.name || '',
  },
  { header: EXCEL_HEADERS.outboundNo, value: (record: OutboundExportRecord) => record.order_no || '' },
  { header: EXCEL_HEADERS.customer, value: (record: OutboundExportRecord) => record.customer_name || '' },
  ...buildMaterialDetailColumns<OutboundExportRecord>({
    quantityColumns: [
      {
        header: EXCEL_HEADERS.quantity,
        value: (record) => parseQuantity(record.quantity, { min: 0 }) ?? 0,
      },
    ],
  }),
  { header: EXCEL_HEADERS.scanTime, value: (record: OutboundExportRecord) => formatTime(record.scanned_at) },
];

const getOutboundMonthSheetName = (scannedAt?: string): string => {
  const match = String(scannedAt || '').trim().match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?(?:[ T]|$)/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}月` : '未识别月份';
};

export const buildOutboundSheets = (records: OutboundExportRecord[]): ExcelSheet[] => {
  const monthlyRecords = new Map<string, OutboundExportRecord[]>();

  records.forEach((record) => {
    const sheetName = getOutboundMonthSheetName(record.scanned_at);
    const list = monthlyRecords.get(sheetName) || [];
    list.push(record);
    monthlyRecords.set(sheetName, list);
  });

  return Array.from(monthlyRecords.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sheetName, sheetRecords]) =>
      buildExcelSheet(sheetName, OUTBOUND_COLUMNS, sheetRecords)
    );
};
