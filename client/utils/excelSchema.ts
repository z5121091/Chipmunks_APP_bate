import type { ExcelCellValue, ExcelSheet } from './excel';

export type ExcelColumn<T> = {
  header: string;
  value: (record: T) => ExcelCellValue;
};

export type MaterialExportRecord = {
  account_name?: string | null;
  warehouse_name?: string | null;
  inventory_code?: string | null;
  scan_model?: string | null;
  model?: string | null;
  version?: string | null;
  package?: string | null;
  batch?: string | null;
  productionDate?: string | null;
  traceNo?: string | null;
  sourceNo?: string | null;
};

export type MaterialSummaryItem = {
  warehouse: string;
  inventoryCode: string;
  model: string;
  version: string;
  package: string;
  quantity: number;
};

export const EXCEL_HEADERS = {
  inboundNo: '入库单号',
  outboundNo: '订单号',
  inventoryNo: '盘点单号',
  account: '账套名称',
  warehouse: '仓库名称',
  customer: '客户名称',
  supplier: '供应商',
  labelType: '标签类型',
  inventoryCode: '存货编码',
  model: '型号',
  version: '版本号',
  package: '封装',
  batch: '批次',
  quantity: '数量',
  actualQuantity: '实盘数量',
  erpQuantity: 'ERP数量',
  differenceQuantity: '差异数量',
  totalQuantity: '合计数量',
  inventoryQuantity: '盘点数量',
  originalQuantity: '原数量',
  labelQuantity: '标签数量',
  inventoryType: '盘点类型',
  productionDate: '生产日期',
  traceNo: '追溯码',
  sourceNo: '箱号',
  scanTime: '扫描时间',
  unpackTime: '拆包时间',
  createdAt: '创建时间',
} as const;

const toCellText = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
};

const getMaterialModel = (record: MaterialExportRecord): string => {
  return toCellText(record.scan_model || record.model);
};

export const buildMaterialWarehouseColumn = <
  T extends MaterialExportRecord,
>(): ExcelColumn<T> => ({
  header: EXCEL_HEADERS.warehouse,
  value: (record) => toCellText(record.warehouse_name),
});

export const buildMaterialIdentityColumns = <
  T extends MaterialExportRecord,
>(options: { includeWarehouse?: boolean } = {}): ExcelColumn<T>[] => {
  const includeWarehouse = options.includeWarehouse !== false;
  return [
    ...(includeWarehouse ? [buildMaterialWarehouseColumn<T>()] : []),
    { header: EXCEL_HEADERS.inventoryCode, value: (record) => toCellText(record.inventory_code) },
    { header: EXCEL_HEADERS.model, value: (record) => getMaterialModel(record) },
    { header: EXCEL_HEADERS.version, value: (record) => toCellText(record.version) },
    { header: EXCEL_HEADERS.package, value: (record) => toCellText(record.package) },
    { header: EXCEL_HEADERS.batch, value: (record) => toCellText(record.batch) },
  ];
};

export const buildMaterialTraceColumns = <
  T extends MaterialExportRecord,
>(options: {
  traceNoValue?: (record: T) => ExcelCellValue;
} = {}): ExcelColumn<T>[] => [
  { header: EXCEL_HEADERS.productionDate, value: (record) => toCellText(record.productionDate) },
  {
    header: EXCEL_HEADERS.traceNo,
    value: options.traceNoValue ?? ((record) => toCellText(record.traceNo)),
  },
  { header: EXCEL_HEADERS.sourceNo, value: (record) => toCellText(record.sourceNo) },
];

export const buildMaterialDetailColumns = <
  T extends MaterialExportRecord,
>(options: {
  includeWarehouse?: boolean;
  quantityColumns: ExcelColumn<T>[];
  traceNoValue?: (record: T) => ExcelCellValue;
}): ExcelColumn<T>[] => [
  ...buildMaterialIdentityColumns<T>({ includeWarehouse: options.includeWarehouse }),
  ...options.quantityColumns,
  ...buildMaterialTraceColumns<T>({ traceNoValue: options.traceNoValue }),
];

export const getMaterialSummaryKey = (record: MaterialExportRecord): string => [
  toCellText(record.warehouse_name),
  toCellText(record.inventory_code),
  getMaterialModel(record),
  toCellText(record.version),
  toCellText(record.package),
].join('|');

export const createMaterialSummaryItem = (
  record: MaterialExportRecord
): MaterialSummaryItem => ({
  warehouse: toCellText(record.warehouse_name),
  inventoryCode: toCellText(record.inventory_code),
  model: getMaterialModel(record),
  version: toCellText(record.version),
  package: toCellText(record.package),
  quantity: 0,
});

export const sortMaterialSummaryItems = (
  items: MaterialSummaryItem[]
): MaterialSummaryItem[] =>
  [...items].sort((a, b) => {
    if (a.warehouse !== b.warehouse) return a.warehouse.localeCompare(b.warehouse);
    if (a.inventoryCode !== b.inventoryCode) return a.inventoryCode.localeCompare(b.inventoryCode);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.version.localeCompare(b.version);
  });

export const buildMaterialSummaryHeaders = (quantityHeader: string): string[] => [
  EXCEL_HEADERS.warehouse,
  EXCEL_HEADERS.inventoryCode,
  EXCEL_HEADERS.model,
  EXCEL_HEADERS.version,
  EXCEL_HEADERS.package,
  quantityHeader,
];

export const buildMaterialSummaryRows = (
  items: Iterable<MaterialSummaryItem>
): ExcelCellValue[][] =>
  sortMaterialSummaryItems(Array.from(items)).map((item) => [
    item.warehouse,
    item.inventoryCode,
    item.model,
    item.version,
    item.package,
    item.quantity,
  ]);

export const buildExcelSheet = <T>(
  name: string,
  columns: ExcelColumn<T>[],
  records: T[]
): ExcelSheet => ({
  name,
  headers: columns.map((column) => column.header),
  rows: records.map((record) => columns.map((column) => column.value(record))),
});

export const getCompactExportDate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

export const sanitizeExportFileSegment = (value: string): string => {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- Export file names must reject C0 control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || '未命名';
};

export const buildExportFileName = (
  typeLabel: string,
  segments: Array<string | number | null | undefined>,
  date = new Date()
): string => {
  const normalizedSegments = segments
    .map((segment) => String(segment ?? '').trim())
    .filter(Boolean)
    .map(sanitizeExportFileSegment);

  return [
    sanitizeExportFileSegment(typeLabel),
    ...normalizedSegments,
    getCompactExportDate(date),
  ].join('_') + '.xlsx';
};

export const buildExportFileNameWithSequence = (
  typeLabel: string,
  segments: Array<string | number | null | undefined>,
  sequence: number,
  date = new Date()
): string => {
  const seqNo = String(Math.max(sequence, 1)).padStart(2, '0');
  const normalizedSegments = segments
    .map((segment) => String(segment ?? '').trim())
    .filter(Boolean)
    .map(sanitizeExportFileSegment);

  return [
    sanitizeExportFileSegment(typeLabel),
    ...normalizedSegments,
    getCompactExportDate(date),
    seqNo,
  ].join('_') + '.xlsx';
};

export const getWarehouseExportSegment = (
  warehouseNames: Array<string | null | undefined>
): string => {
  const warehouses = Array.from(
    new Set(warehouseNames.map((name) => name?.trim()).filter(Boolean))
  );

  if (warehouses.length === 1) {
    return warehouses[0] || '未命名仓库';
  }

  return warehouses.length > 1 ? '多仓库' : '未命名仓库';
};

export const buildWarehouseExportSuffix = (
  warehouseNames: Array<string | null | undefined>,
  sequence: string | number
): string => {
  const warehouseSegment = getWarehouseExportSegment(warehouseNames);
  const seqNo = typeof sequence === 'number' ? String(sequence).padStart(2, '0') : sequence;

  return warehouseSegment !== '未命名仓库'
    ? `${sanitizeExportFileSegment(warehouseSegment)}_${seqNo}`
    : String(seqNo);
};

export const getExportInfoFromDocumentNo = (
  documentNo: string,
  prefix: string
): { date: Date; sequence: number } => {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escapedPrefix}-(\\d{4})-(\\d{2})-(\\d{2})-(\\d+)$`).exec(
    documentNo.trim()
  );
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
