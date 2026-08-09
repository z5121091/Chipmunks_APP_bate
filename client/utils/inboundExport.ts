import type { ExcelSheet } from './excel';
import {
  buildExcelSheet,
  buildExportFileNameWithSequence,
  buildMaterialDetailColumns,
  buildMaterialSummaryHeaders,
  buildMaterialSummaryRows,
  createMaterialSummaryItem,
  EXCEL_HEADERS,
  getMaterialSummaryKey,
  sanitizeExportFileSegment,
  type MaterialSummaryItem,
} from './excelSchema';
import { formatDateTimeExport } from './time';

export interface InboundExportRecord {
  inbound_no?: string;
  warehouse_name?: string;
  inventory_code?: string;
  scan_model?: string;
  batch?: string;
  quantity?: number;
  created_at?: string;
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
}

export const buildInboundExportFileName = (
  warehouseName: string,
  sequence: number,
  date = new Date()
): string => {
  return buildExportFileNameWithSequence('入库单', [warehouseName || '未命名仓库'], sequence, date);
};

export const buildInboundExportFileNameFromNo = (
  warehouseName: string,
  inboundNo: string
): string => {
  return [
    sanitizeExportFileSegment('入库单'),
    sanitizeExportFileSegment(warehouseName || '未命名仓库'),
    sanitizeExportFileSegment(inboundNo || '未命名单据'),
  ].join('_') + '.xlsx';
};

export const buildInboundSheets = (records: InboundExportRecord[]): ExcelSheet[] => {
  const summaryMap = new Map<string, MaterialSummaryItem>();

  records.forEach((record) => {
    const key = getMaterialSummaryKey(record);

    if (!summaryMap.has(key)) {
      summaryMap.set(key, createMaterialSummaryItem(record));
    }

    summaryMap.get(key)!.quantity += Number(record.quantity || 0);
  });

  return [
    buildExcelSheet(
      '入库明细',
      [
        { header: EXCEL_HEADERS.inboundNo, value: (record) => record.inbound_no || '' },
        ...buildMaterialDetailColumns<InboundExportRecord>({
          quantityColumns: [
            { header: EXCEL_HEADERS.quantity, value: (record) => Number(record.quantity || 0) },
          ],
        }),
        {
          header: EXCEL_HEADERS.createdAt,
          value: (record) => formatDateTimeExport(record.created_at),
        },
      ],
      records
    ),
    {
      name: '型号汇总',
      headers: buildMaterialSummaryHeaders(EXCEL_HEADERS.totalQuantity),
      rows: buildMaterialSummaryRows(summaryMap.values()),
    },
  ];
};
