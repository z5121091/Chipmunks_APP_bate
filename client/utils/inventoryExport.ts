import type { ExcelSheet } from './excel';
import {
  buildExcelSheet,
  buildExportFileNameWithSequence,
  buildMaterialDetailColumns,
  EXCEL_HEADERS,
  getExportInfoFromDocumentNo,
} from './excelSchema';
import { formatDateTimeExport } from './time';

export type InventoryExportMode = 'whole' | 'partial' | 'complete';

export interface InventoryExportRecord {
  check_no?: string;
  account_name?: string;
  warehouse_name?: string;
  inventory_code?: string;
  scan_model?: string;
  batch?: string;
  quantity?: number;
  check_type: 'whole' | 'partial';
  actual_quantity?: number;
  created_at?: string;
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  erp_quantity?: number;
}

type InventorySummaryItem = {
  inventoryCode: string;
  model: string;
  physicalQuantity: number;
  erpQuantity: number | null;
};

export const getInventoryExportModeLabel = (mode: InventoryExportMode): string => {
  if (mode === 'whole') return '整包';
  if (mode === 'partial') return '拆包';
  return '完整数据';
};

const toCellText = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
};

// ERP库存以存货编码为核对单位；同一编码即使历史型号文本有差异，也只生成一条差异记录。
const getInventorySummaryKey = (record: InventoryExportRecord): string =>
  toCellText(record.inventory_code).trim().toLocaleLowerCase();

const createInventorySummaryItem = (
  record: InventoryExportRecord
): InventorySummaryItem => ({
  inventoryCode: toCellText(record.inventory_code),
  model: toCellText(record.scan_model),
  physicalQuantity: 0,
  erpQuantity:
    record.erp_quantity !== undefined && Number.isFinite(Number(record.erp_quantity))
      ? Number(record.erp_quantity)
      : null,
});

const buildInventorySummaryRows = (
  items: Iterable<InventorySummaryItem>
) =>
  Array.from(items)
    .sort((a, b) => {
      if (a.inventoryCode !== b.inventoryCode) return a.inventoryCode.localeCompare(b.inventoryCode);
      return a.model.localeCompare(b.model);
    })
    .map((item) => [
      item.inventoryCode,
      item.model,
      item.physicalQuantity,
      item.erpQuantity ?? '',
      item.erpQuantity === null ? '' : item.physicalQuantity - item.erpQuantity,
    ]);

const getEffectiveQuantity = (record: InventoryExportRecord): number => {
  return Number(record.actual_quantity ?? record.quantity ?? 0);
};

export const buildInventoryExportFileName = (
  warehouseName: string,
  mode: InventoryExportMode,
  sequence: number,
  date = new Date()
): string => {
  const modeLabel = getInventoryExportModeLabel(mode);
  return buildExportFileNameWithSequence(
    '盘点单',
    [warehouseName || '未命名仓库', modeLabel],
    sequence,
    date
  );
};

export const buildInventoryExportFileNameFromNo = (
  warehouseName: string,
  mode: InventoryExportMode,
  checkNo: string
): string => {
  const { date, sequence } = getExportInfoFromDocumentNo(checkNo, 'PD');
  return buildInventoryExportFileName(warehouseName, mode, sequence, date);
};

export const buildInventorySheets = (records: InventoryExportRecord[]): ExcelSheet[] => {
  const summaryMap = new Map<string, InventorySummaryItem>();

  records.forEach((record) => {
    const key = getInventorySummaryKey(record);

    if (!summaryMap.has(key)) {
      summaryMap.set(key, createInventorySummaryItem(record));
    }

    const summary = summaryMap.get(key)!;
    summary.physicalQuantity += getEffectiveQuantity(record);
    if (
      summary.erpQuantity === null &&
      record.erp_quantity !== undefined &&
      Number.isFinite(Number(record.erp_quantity))
    ) {
      summary.erpQuantity = Number(record.erp_quantity);
    }
  });

  return [
    buildExcelSheet(
      '盘点明细',
      [
        { header: EXCEL_HEADERS.inventoryNo, value: (record) => record.check_no || '' },
        { header: EXCEL_HEADERS.account, value: (record) => record.account_name || '' },
        ...buildMaterialDetailColumns<InventoryExportRecord>({
          quantityColumns: [
            { header: EXCEL_HEADERS.quantity, value: (record) => Number(record.quantity || 0) },
            { header: EXCEL_HEADERS.actualQuantity, value: (record) => getEffectiveQuantity(record) },
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
      name: '盘点差异',
      headers: [
        EXCEL_HEADERS.inventoryCode,
        EXCEL_HEADERS.model,
        EXCEL_HEADERS.actualQuantity,
        EXCEL_HEADERS.erpQuantity,
        EXCEL_HEADERS.differenceQuantity,
      ],
      rows: buildInventorySummaryRows(summaryMap.values()),
    },
  ];
};
