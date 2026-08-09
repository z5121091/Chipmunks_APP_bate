import type { ExcelSheet } from './excel';
import {
  buildExcelSheet,
  buildMaterialDetailColumns,
  buildMaterialWarehouseColumn,
  EXCEL_HEADERS,
} from './excelSchema';
import { parseQuantity } from './quantity';
import { formatTime } from './time';

export interface UnpackLabelExportRecord {
  warehouse_name?: string;
  label_type?: 'shipped' | 'remaining';
  order_no?: string;
  customer_name?: string;
  supplier?: string;
  inventory_code?: string;
  model?: string;
  version?: string;
  package?: string;
  batch?: string;
  original_quantity?: string | number;
  new_quantity?: string | number;
  productionDate?: string;
  traceNo?: string;
  new_traceNo?: string;
  sourceNo?: string;
  unpacked_at?: string;
}

const getLabelTraceNo = (record: UnpackLabelExportRecord): string => {
  return record.new_traceNo || record.traceNo || '';
};

export const buildUnpackLabelSheet = (
  records: UnpackLabelExportRecord[],
  sheetName = '标签明细'
): ExcelSheet =>
  buildExcelSheet(
    sheetName,
    [
      buildMaterialWarehouseColumn<UnpackLabelExportRecord>(),
      {
        header: EXCEL_HEADERS.labelType,
        value: (record) => (record.label_type === 'shipped' ? '发货标签' : '剩余标签'),
      },
      { header: EXCEL_HEADERS.outboundNo, value: (record) => record.order_no || '' },
      { header: EXCEL_HEADERS.customer, value: (record) => record.customer_name || '' },
      { header: EXCEL_HEADERS.supplier, value: (record) => record.supplier || '' },
      ...buildMaterialDetailColumns<UnpackLabelExportRecord>({
        includeWarehouse: false,
        quantityColumns: [
          {
            header: EXCEL_HEADERS.originalQuantity,
            value: (record) => parseQuantity(record.original_quantity, { min: 0 }) ?? 0,
          },
          {
            header: EXCEL_HEADERS.labelQuantity,
            value: (record) => parseQuantity(record.new_quantity, { min: 0 }) ?? 0,
          },
        ],
        traceNoValue: getLabelTraceNo,
      }),
      { header: EXCEL_HEADERS.unpackTime, value: (record) => formatTime(record.unpacked_at) },
    ],
    records
  );
