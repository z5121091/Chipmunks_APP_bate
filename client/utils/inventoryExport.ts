import type { ExcelSheet } from './excel';
import { formatDateTimeExport } from './time';

export type InventoryExportMode = 'whole' | 'partial' | 'complete';

export interface InventoryExportRecord {
  check_no?: string;
  warehouse_name?: string;
  inventory_code?: string;
  scan_model?: string;
  batch?: string;
  quantity?: number;
  check_type: 'whole' | 'partial';
  actual_quantity?: number;
  check_date?: string;
  created_at?: string;
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  notes?: string;
}

export const getInventoryExportModeLabel = (mode: InventoryExportMode): string => {
  if (mode === 'whole') return '整包';
  if (mode === 'partial') return '拆包';
  return '完整数据';
};

const getCompactDate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const sanitizeFileSegment = (value: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || '未命名';
};

const getExportInfoFromCheckNo = (checkNo: string): { date: Date; sequence: number } => {
  const match = /^PD-(\d{4})-(\d{2})-(\d{2})-(\d+)$/.exec(checkNo.trim());
  if (!match) {
    return { date: new Date(), sequence: 1 };
  }

  const [, year, month, day, sequence] = match;
  const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
  const parsedSequence = Number.parseInt(sequence, 10);

  if (Number.isNaN(parsedDate.getTime()) || Number.isNaN(parsedSequence) || parsedSequence <= 0) {
    return { date: new Date(), sequence: 1 };
  }

  return { date: parsedDate, sequence: parsedSequence };
};

const getEffectiveQuantity = (record: InventoryExportRecord): number => {
  if (record.check_type === 'partial') {
    return Number(record.actual_quantity ?? record.quantity ?? 0);
  }
  return Number(record.quantity ?? 0);
};

export const buildInventoryExportFileName = (
  warehouseName: string,
  mode: InventoryExportMode,
  sequence: number,
  date = new Date()
): string => {
  const warehouse = sanitizeFileSegment(warehouseName || '未命名仓库');
  const modeLabel = getInventoryExportModeLabel(mode);
  const seqNo = String(Math.max(sequence, 1)).padStart(2, '0');
  return `盘点单_${warehouse}_${modeLabel}_${getCompactDate(date)}_${seqNo}.xlsx`;
};

export const buildInventoryExportFileNameFromNo = (
  warehouseName: string,
  mode: InventoryExportMode,
  checkNo: string
): string => {
  const { date, sequence } = getExportInfoFromCheckNo(checkNo);
  return buildInventoryExportFileName(warehouseName, mode, sequence, date);
};

export const buildInventorySheets = (records: InventoryExportRecord[]): ExcelSheet[] => {
  const detailHeaders = [
    '盘点单号',
    '仓库名称',
    '存货编码',
    '扫描型号',
    '批次',
    '数量',
    '实盘数量',
    '盘点类型',
    '版本',
    '封装',
    '生产日期',
    '追溯码',
    '箱号',
    '盘点日期',
    '创建时间',
  ];

  const detailRows = records.map((record) => [
    record.check_no || '',
    record.warehouse_name || '',
    record.inventory_code || '',
    record.scan_model || '',
    record.batch || '',
    Number(record.quantity || 0),
    getEffectiveQuantity(record),
    record.check_type === 'whole' ? '整包' : '拆包',
    record.version || '',
    record.package || '',
    record.productionDate || '',
    record.traceNo || '',
    record.sourceNo || '',
    record.check_date || '',
    formatDateTimeExport(record.created_at),
  ]);

  const summaryMap = new Map<
    string,
    {
      warehouse: string;
      inventoryCode: string;
      model: string;
      version: string;
      package: string;
      quantity: number;
      date: string;
    }
  >();

  records.forEach((record) => {
    const key = [
      record.warehouse_name || '',
      record.inventory_code || '',
      record.scan_model || '',
      record.version || '',
      record.package || '',
      record.check_date || '',
    ].join('|');

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        warehouse: record.warehouse_name || '',
        inventoryCode: record.inventory_code || '',
        model: record.scan_model || '',
        version: record.version || '',
        package: record.package || '',
        quantity: 0,
        date: record.check_date || '',
      });
    }

    summaryMap.get(key)!.quantity += getEffectiveQuantity(record);
  });

  const summaryHeaders = ['仓库名称', '存货编码', '扫描型号', '版本', '封装', '盘点数量', '盘点日期'];
  const summaryRows = Array.from(summaryMap.values())
    .sort((a, b) => {
      if (a.warehouse !== b.warehouse) return a.warehouse.localeCompare(b.warehouse);
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.inventoryCode !== b.inventoryCode) return a.inventoryCode.localeCompare(b.inventoryCode);
      if (a.model !== b.model) return a.model.localeCompare(b.model);
      return a.version.localeCompare(b.version);
    })
    .map((item) => [
      item.warehouse,
      item.inventoryCode,
      item.model,
      item.version,
      item.package,
      item.quantity,
      item.date,
    ]);

  return [
    { name: '盘点明细', headers: detailHeaders, rows: detailRows },
    { name: '型号汇总', headers: summaryHeaders, rows: summaryRows },
  ];
};
