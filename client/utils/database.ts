import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Base64 } from 'js-base64';
import { STORAGE_KEYS, ExportType, SyncConfig } from '@/constants/config';
import { getISODateTime, getTodayLocal } from './time';
import { parseQuantity } from './quantity';
import { safeJsonParseNullable } from './json';
import { logger } from './logger';
import {
  isOutboundOrderRuleConfig,
  loadOutboundWarehouseOrderRules,
  type OutboundWarehouseSampleRuleMap,
} from './outboundOrderRule';

// 使用 any 绕过类型检查
const FS = FileSystem as any;

// 重新导出 STORAGE_KEYS，供其他模块使用
export { STORAGE_KEYS };

const INSTALL_ID_DB_KEY = 'install_id';
const INSTALL_ID_PREFIX = 'install_';

let db: SQLite.SQLiteDatabase | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;
let idCounter = 0;

// 检测是否为 Web 平台
const isWebPlatform = Platform.OS === 'web';

// 数据版本
const CURRENT_DATA_VERSION = 12;

// 匹配条件接口（简化版：指定位置字段包含指定关键字）
export interface MatchCondition {
  fieldIndex: number; // 字段位置（从0开始）
  keyword: string; // 匹配关键字（字段值包含此关键字即匹配）
}

export type FieldPrefixes = Record<string, string>;

// 二维码解析规则接口
export interface QRCodeRule {
  id: string;
  name: string; // 厂家/规则名称，如"极海半导体"
  description: string; // 规则描述
  separator: string; // 分隔符，如 "/"、","、"*"等
  fieldOrder: string[]; // 字段顺序，标准字段用原名称（如"model"），自定义字段用"custom:字段ID"格式
  customFieldIds?: string[]; // 关联的自定义字段ID列表（已弃用，保留兼容性）
  fieldPrefixes?: FieldPrefixes; // 字段前缀配置，key 与 fieldOrder 保持一致
  isActive: boolean; // 是否启用
  supplierName?: string; // 供应商名称（可选）
  matchConditions?: MatchCondition[]; // 识别条件（可选，用于区分相同分隔符和字段数的规则）
  created_at: string;
  updated_at: string;
}

// 字段定义（用于显示）
export const FIELD_LABELS: Record<string, string> = {
  model: '型号',
  batch: '批次',
  package: '封装',
  version: '版本号',
  quantity: '数量',
  productionDate: '生产日期',
  traceNo: '追踪码',
  sourceNo: '箱号',
};

// 固定字段顺序（极海半导体标准格式：型号/批次/封装/版本/数量/生产日期/追踪码/箱号）
// 这个顺序是固定的，无论用户用什么分隔符，都会按这个顺序提取值
export const STANDARD_FIELD_ORDER = [
  'model', // 0: 型号
  'batch', // 1: 批次
  'package', // 2: 封装
  'version', // 3: 版本号
  'quantity', // 4: 数量
  'productionDate', // 5: 生产日期
  'traceNo', // 6: 追踪码
  'sourceNo', // 7: 箱号
];

// 可用字段列表
export const AVAILABLE_FIELDS = [
  'model',
  'batch',
  'package',
  'version',
  'quantity',
  'productionDate',
  'traceNo',
  'sourceNo',
];

// 判断是否为自定义字段
export const isCustomField = (field: string): boolean => {
  return field.startsWith('custom:');
};

// 获取自定义字段ID
export const getCustomFieldId = (field: string): string => {
  return field.replace('custom:', '');
};

// 创建自定义字段标识
export const createCustomFieldKey = (fieldId: string): string => {
  return `custom:${fieldId}`;
};

// 自定义字段定义接口
export type CustomFieldType = 'text' | 'select';

export interface CustomField {
  id: string;
  name: string; // 字段名称（显示名称）
  type: CustomFieldType; // 字段类型
  required: boolean; // 是否必填
  options?: string[]; // 选择类型的选项
  sortOrder: number; // 排序顺序
  created_at: string;
  updated_at: string;
}

const CUSTOM_FIELD_TYPES = ['text', 'select'] as const;

const isCustomFieldType = (value: unknown): value is CustomFieldType => {
  return typeof value === 'string' && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
};

type CustomFieldRow = {
  id: string;
  name: string;
  type?: string | null;
  required: number | boolean;
  options?: string | null;
  sort_order?: number | string | null;
  sortOrder?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const normalizeCustomFieldRecord = (row: CustomFieldRow): CustomField => {
  const normalizedType: CustomFieldType = row.type === 'select' ? 'select' : 'text';
  const normalizedSortOrder = getBackupSortOrder(row as Record<string, unknown>);
  const parsedOptions = stringToJson<string[]>(row.options ?? null) || undefined;

  return {
    id: row.id,
    name: row.name,
    type: normalizedType,
    required: row.required === 1 || row.required === true,
    options: normalizedType === 'select' ? parsedOptions : undefined,
    sortOrder:
      Number.isFinite(Number(normalizedSortOrder)) && Number(normalizedSortOrder) > 0
        ? Number(normalizedSortOrder)
        : 1,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? row.created_at ?? '',
  };
};

// 物料记录接口（完整版，包含极海半导体所有字段）
export interface MaterialRecord {
  id: string;
  order_no: string;
  customer_name: string;
  operation_type: 'inbound' | 'outbound' | 'inventory';
  rule_id?: string; // 使用的规则ID
  rule_name?: string; // 使用的规则名称
  // 核心字段
  model: string; // 型号
  batch: string; // 批次
  quantity: number; // 未拆包时为原始数量，拆包后为累计发货数量（数据库是 INTEGER）
  // 扩展字段
  package: string; // 封装
  version: string; // 版本号
  productionDate: string; // 生产日期年周
  traceNo: string; // 追踪码
  sourceNo: string; // 箱号
  // 系统字段
  scanned_at: string;
  raw_content: string;
  separator?: string; // 扫码时使用的分隔符（用于显示拆分结果）
  // 自定义字段
  customFields?: Record<string, string>; // 自定义字段值，key为字段ID
  // 拆包相关
  isUnpacked?: boolean; // 是否已拆包
  unpackCount?: number; // 拆包次数
  original_quantity?: string; // 原始数量（第一次拆包时记录）
  remaining_quantity?: string; // 剩余数量（用于下次扫码拆包）
  // V3.0 新增字段
  warehouse_id?: string; // 仓库ID
  warehouse_name?: string; // 仓库名称（冗余存储）
  inventory_code?: string; // 存货编码
}

export interface OutboundExportRow {
  order_no: string;
  customer_name: string;
  warehouse_name: string;
  inventory_code: string;
  model: string;
  batch: string;
  quantity: number;
  package: string;
  version: string;
  productionDate: string;
  traceNo: string;
  sourceNo: string;
  scanned_at: string;
}

// 订单接口
export interface Order {
  id: string;
  order_no: string;
  customer_name: string;
  created_at: string;
  // V3.0 新增字段
  warehouse_id?: string; // 仓库ID
  warehouse_name?: string; // 仓库名称（冗余存储，方便显示）
}

// ============== V3.0 新增接口 ==============

// 仓库接口
export interface Warehouse {
  id: string;
  name: string; // 仓库名称
  description?: string; // 仓库描述
  is_default?: boolean; // 是否默认仓库
  sort_order?: number; // 排序值，越小越靠前
  created_at?: string; // 创建时间
}

// 物料管理接口（型号-存货编码绑定）
export interface InventoryBinding {
  id: string;
  scan_model: string; // 扫描型号
  inventory_code: string; // 存货编码
  supplier?: string; // 供应商
  description?: string; // 描述备注
  created_at: string;
}

export interface InventoryBindingPageResult {
  items: InventoryBinding[];
  total: number;
  page: number;
  pageSize: number;
}

// 入库记录接口
export interface InboundRecord {
  id: string;
  inbound_no: string; // 入库单号（RK+日期+序号）
  warehouse_id: string; // 仓库ID
  warehouse_name: string; // 仓库名称（冗余存储）
  inventory_code: string; // 存货编码
  scan_model: string; // 扫描型号
  batch: string; // 批次
  quantity: number; // 数量（数值类型，便于Excel求和）
  in_date: string; // 入库日期
  notes?: string; // 备注
  rawContent?: string; // 原始二维码内容（新增）
  created_at: string;
  // 扩展字段
  package?: string; // 封装
  version?: string; // 版本号
  productionDate?: string; // 生产日期
  traceNo?: string; // 追踪码
  sourceNo?: string; // 箱号
  customFields?: Record<string, string>; // 自定义字段
  sync_status?: DocumentSyncStatus;
  sync_file_name?: string;
  synced_at?: string;
  sync_message?: string;
}

export type DocumentSyncStatus = 'pending' | 'success' | 'failed';

export interface InboundDocumentSummary {
  inbound_no: string;
  warehouse_id: string;
  warehouse_name: string;
  in_date: string;
  created_at: string;
  record_count: number;
  model_count: number;
  total_quantity: number;
  sync_status: DocumentSyncStatus;
  sync_file_name?: string;
  synced_at?: string;
  sync_message?: string;
}

export interface InboundExportSummaryRow {
  warehouse_name: string;
  inventory_code: string;
  scan_model: string;
  version: string;
  package: string;
  total_quantity: number;
  in_date: string;
}

// 盘点记录接口
export interface InventoryCheckRecord {
  id: string;
  check_no: string; // 盘点单号（PD+日期+序号）
  warehouse_id: string; // 仓库ID
  warehouse_name: string; // 仓库名称（冗余存储）
  inventory_code: string; // 存货编码
  scan_model: string; // 扫描型号
  batch: string; // 批次
  quantity: number; // 数量（数值类型）
  check_type: 'whole' | 'partial'; // 整包/拆包
  actual_quantity?: number; // 实际数量（拆包时填写）
  check_date: string; // 盘点日期
  notes?: string; // 备注
  created_at: string;
  // 扩展字段
  package?: string; // 封装
  version?: string; // 版本号
  productionDate?: string; // 生产日期
  traceNo?: string; // 追踪码
  sourceNo?: string; // 箱号
  customFields?: Record<string, string>; // 自定义字段
  sync_status?: DocumentSyncStatus;
  sync_file_name?: string;
  synced_at?: string;
  sync_message?: string;
}

export interface InventoryCheckDocumentSummary {
  check_no: string;
  warehouse_id: string;
  warehouse_name: string;
  check_date: string;
  created_at: string;
  record_count: number;
  model_count: number;
  total_quantity: number;
  whole_count: number;
  partial_count: number;
  sync_status: DocumentSyncStatus;
  sync_file_name?: string;
  synced_at?: string;
  sync_message?: string;
}

export interface InventoryCheckExportSummaryRow {
  warehouse_name: string;
  inventory_code: string;
  scan_model: string;
  version: string;
  package: string;
  total_quantity: number;
  check_date: string;
}

const normalizeDocumentSyncStatus = (value?: string | null): DocumentSyncStatus => {
  if (value === 'success' || value === 'failed') {
    return value;
  }
  return 'pending';
};

// ============== 拆包记录相关接口 ==============

// 拆包记录接口
export interface UnpackRecord {
  id: string;
  // 关联原物料
  original_material_id: string;
  // 物料信息（冗余存储，方便查询）
  order_no: string;
  customer_name: string;
  model: string;
  batch: string;
  package: string;
  version: string;
  // V3.0 新增：仓库信息
  warehouse_id?: string;
  warehouse_name?: string;
  // V3.0 新增：存货编码
  inventory_code?: string;
  // 数量信息
  original_quantity: string; // 原数量（拆包前的总数）
  new_quantity: string; // 当前标签数量
  // 溯源信息
  productionDate: string;
  traceNo: string; // 原追踪码
  new_traceNo: string; // 新追踪码（拆包生成）
  sourceNo: string; // 箱号（不变）
  // 标签类型：shipped=发货标签（拆出的部分），remaining=剩余标签（剩余的部分）
  label_type: 'shipped' | 'remaining';
  // 关联ID：发货标签和剩余标签是一对，通过这个字段关联
  pair_id: string;
  // 状态
  status: 'pending' | 'printed'; // pending(待打印) / printed(已打印)
  // 备注
  notes: string;
  // 操作信息
  unpacked_at: string; // 拆包时间
  printed_at: string | null; // 打印时间
  created_at: string;
  updated_at: string;
}

// 打印历史接口
export interface PrintHistory {
  id: string;
  // 关联拆包记录
  unpack_record_ids: string[]; // 支持批量
  // 导出信息
  export_format: 'csv' | 'excel' | 'json';
  export_file_path: string | null;
  // 打印信息
  printed_at: string;
  print_count: number; // 打印份数
  created_at: string;
}

// 备份数据接口
export interface BackupData {
  version: number;
  timestamp: string;
  backupTime?: string;
  // 只包含配置数据，不包含业务数据
  rules: QRCodeRule[];
  customFields: CustomField[];
  // V3.0 新增
  inventoryBindings: InventoryBinding[];
  warehouses: Warehouse[];
  outboundWarehouseOrderRules?: OutboundWarehouseSampleRuleMap;
  syncConfig?: SyncConfig | null;
  stats?: {
    rules: number;
    customFields: number;
    inventoryBindings: number;
    warehouses: number;
    outboundWarehouseOrderRules?: number;
    hasSyncConfig?: boolean;
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === 'string');
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
};

const isOptionalStringLike = (value: unknown): value is string | null | undefined => {
  return value === undefined || value === null || typeof value === 'string';
};

const getBackupSortOrder = (value: Record<string, unknown>): number | null => {
  const sortOrder = value.sortOrder;
  if (typeof sortOrder === 'number' && Number.isInteger(sortOrder)) {
    return sortOrder;
  }
  if (typeof sortOrder === 'string') {
    const parsedSortOrder = Number(sortOrder);
    if (Number.isInteger(parsedSortOrder)) {
      return parsedSortOrder;
    }
  }

  const legacySortOrder = value.sort_order;
  if (typeof legacySortOrder === 'number' && Number.isInteger(legacySortOrder)) {
    return legacySortOrder;
  }
  if (typeof legacySortOrder === 'string') {
    const parsedLegacySortOrder = Number(legacySortOrder);
    if (Number.isInteger(parsedLegacySortOrder)) {
      return parsedLegacySortOrder;
    }
  }

  return null;
};

const isSyncConfigShape = (value: unknown): value is SyncConfig => {
  return (
    isPlainObject(value) &&
    typeof value.ip === 'string' &&
    typeof value.port === 'string'
  );
};

const isMatchConditionShape = (value: unknown): value is MatchCondition => {
  return (
    isPlainObject(value) &&
    typeof value.fieldIndex === 'number' &&
    Number.isInteger(value.fieldIndex) &&
    typeof value.keyword === 'string'
  );
};

const isQRCodeRuleShape = (value: unknown): value is QRCodeRule => {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.separator === 'string' &&
    isStringArray(value.fieldOrder) &&
    typeof value.isActive === 'boolean' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    (value.customFieldIds === undefined || isStringArray(value.customFieldIds)) &&
    (value.fieldPrefixes === undefined || isStringRecord(value.fieldPrefixes)) &&
    (value.supplierName === undefined || typeof value.supplierName === 'string') &&
    (value.matchConditions === undefined ||
      (Array.isArray(value.matchConditions) &&
        value.matchConditions.every((item) => isMatchConditionShape(item))))
  );
};

const isCustomFieldShape = (value: unknown): value is CustomField => {
  if (!isPlainObject(value)) {
    return false;
  }

  const sortOrder = getBackupSortOrder(value);
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.type === 'text' || value.type === 'select') &&
    typeof value.required === 'boolean' &&
    sortOrder !== null &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string' &&
    (value.options === undefined || value.options === null || isStringArray(value.options))
  );
};

const isInventoryBindingShape = (value: unknown): value is InventoryBinding => {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.scan_model === 'string' &&
    typeof value.inventory_code === 'string' &&
    typeof value.created_at === 'string' &&
    isOptionalStringLike(value.supplier) &&
    isOptionalStringLike(value.description)
  );
};

const isWarehouseShape = (value: unknown): value is Warehouse => {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isOptionalStringLike(value.description) &&
    (value.is_default === undefined || typeof value.is_default === 'boolean') &&
    ((value.sort_order === undefined && value.sortOrder === undefined) ||
      getBackupSortOrder(value) !== null) &&
    isOptionalStringLike(value.created_at)
  );
};

const isOutboundWarehouseOrderRulesShape = (
  value: unknown
): value is OutboundWarehouseSampleRuleMap => {
  return (
    isPlainObject(value) &&
    Object.entries(value).every(
      ([warehouseId, rule]) =>
        typeof warehouseId === 'string' && isOutboundOrderRuleConfig(rule)
    )
  );
};

const isBackupStatsShape = (
  value: unknown
): value is NonNullable<BackupData['stats']> => {
  return (
    isPlainObject(value) &&
    typeof value.rules === 'number' &&
    typeof value.customFields === 'number' &&
    typeof value.inventoryBindings === 'number' &&
    typeof value.warehouses === 'number' &&
    (value.outboundWarehouseOrderRules === undefined ||
      typeof value.outboundWarehouseOrderRules === 'number') &&
    (value.hasSyncConfig === undefined || typeof value.hasSyncConfig === 'boolean')
  );
};

export const isBackupDataShape = (value: unknown): value is BackupData => {
  return (
    isPlainObject(value) &&
    typeof value.version === 'number' &&
    typeof value.timestamp === 'string' &&
    (value.backupTime === undefined || typeof value.backupTime === 'string') &&
    Array.isArray(value.rules) &&
    value.rules.every((item) => isQRCodeRuleShape(item)) &&
    Array.isArray(value.customFields) &&
    value.customFields.every((item) => isCustomFieldShape(item)) &&
    Array.isArray(value.inventoryBindings) &&
    value.inventoryBindings.every((item) => isInventoryBindingShape(item)) &&
    Array.isArray(value.warehouses) &&
    value.warehouses.every((item) => isWarehouseShape(item)) &&
    (value.outboundWarehouseOrderRules === undefined ||
      isOutboundWarehouseOrderRulesShape(value.outboundWarehouseOrderRules)) &&
    (value.syncConfig === undefined ||
      value.syncConfig === null ||
      isSyncConfigShape(value.syncConfig)) &&
    (value.stats === undefined || isBackupStatsShape(value.stats))
  );
};

// 生成唯一ID
export const generateId = (): string => {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  const timestamp = Date.now().toString(36);
  const counter = idCounter.toString(36).padStart(4, '0');
  const performancePart =
    typeof globalThis.performance?.now === 'function'
      ? Math.floor(globalThis.performance.now() * 1000).toString(36)
      : '';
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${timestamp}${counter}${performancePart}${randomPart}`;
};

// 辅助函数：JSON 字符串化/解析
const jsonToString = (obj: unknown): string => {
  return JSON.stringify(obj);
};

const stringToJson = <T>(str: string | null): T | null => {
  return safeJsonParseNullable<T>(str, 'database.stringToJson');
};

const parseStoredDateTimeToMillis = (value?: string | null): number => {
  if (!value) return 0;

  const normalizedValue = normalizeStoredDateTimeString(value) || value;
  const localMatch = normalizedValue.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/
  );
  if (localMatch) {
    const [, year, month, day, hours = '0', minutes = '0'] = localMatch;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes)
    ).getTime();
  }

  const fallback = new Date(normalizedValue).getTime();
  return Number.isNaN(fallback) ? 0 : fallback;
};

type RuleRecordRow = {
  id: string;
  name: string;
  description?: string | null;
  separator: string;
  model_index: number | string;
  batch_index: number | string;
  quantity_index: number | string;
  trace_no_index?: number | string | null;
  package_index?: number | string | null;
  version_index?: number | string | null;
  production_date_index?: number | string | null;
  source_no_index?: number | string | null;
  field_order?: string | null;
  custom_field_ids?: string | null;
  field_prefixes?: string | null;
  is_active: number | boolean;
  supplier_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  match_conditions?: string | null;
};

const normalizeRuleRecord = (record: RuleRecordRow): QRCodeRule => {
  const fieldOrder = stringToJson<string[]>(record.field_order ?? null) || [];
  const customFieldIds = stringToJson<string[]>(record.custom_field_ids ?? null) || [];
  const rawFieldPrefixes = stringToJson<FieldPrefixes>(record.field_prefixes ?? null) || {};
  const fieldPrefixes = fieldOrder.reduce<FieldPrefixes>((acc, fieldName) => {
    const prefix = rawFieldPrefixes[fieldName];
    if (typeof prefix === 'string') {
      acc[fieldName] = prefix;
    }
    return acc;
  }, {});
  const rawMatchConditions = stringToJson<MatchCondition[]>(record.match_conditions ?? null) || [];
  const matchConditions = rawMatchConditions
    .filter(
      (condition) =>
        condition &&
        Number.isInteger(condition.fieldIndex) &&
        typeof condition.keyword === 'string' &&
        condition.keyword.trim().length > 0
    )
    .map((condition) => ({
      fieldIndex: condition.fieldIndex,
      keyword: condition.keyword.trim(),
    }));

  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    separator: record.separator,
    fieldOrder,
    customFieldIds,
    fieldPrefixes,
    isActive: record.is_active === 1,
    supplierName: record.supplier_name || undefined,
    matchConditions,
    created_at: record.created_at || '',
    updated_at: record.updated_at || record.created_at || '',
  };
};

const sortRulesByPriority = (rules: QRCodeRule[]): QRCodeRule[] => {
  return rules.slice().sort((a, b) => {
    const updatedDiff =
      parseStoredDateTimeToMillis(b.updated_at) - parseStoredDateTimeToMillis(a.updated_at);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff =
      parseStoredDateTimeToMillis(b.created_at) - parseStoredDateTimeToMillis(a.created_at);
    if (createdDiff !== 0) return createdDiff;

    return a.name.localeCompare(b.name, 'zh-CN');
  });
};

const rollbackTransaction = async (database: SQLite.SQLiteDatabase, context: string) => {
  try {
    await database.execAsync('ROLLBACK');
  } catch (rollbackError) {
    logger.error(`[${context}] 回滚失败:`, rollbackError);
  }
};

type OrderWarehouseInfo = {
  id: string;
  name: string;
};

const normalizeTraceNo = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertUniqueTraceNosInBatch = (
  records: Array<{ traceNo?: string | null; warehouse_id?: string | null }>,
  context: string
) => {
  const seen = new Set<string>();

  for (const record of records) {
    const traceNo = normalizeTraceNo(record.traceNo);
    if (!traceNo) {
      continue;
    }

    if (seen.has(traceNo)) {
      throw new Error(`${context}存在重复追踪码：${traceNo}`);
    }

    seen.add(traceNo);
  }
};

const assertInboundTraceNosNotAlreadySaved = async (
  database: SQLite.SQLiteDatabase,
  records: Array<{ traceNo?: string | null; warehouse_id?: string | null }>
) => {
  const checked = new Set<string>();

  for (const record of records) {
    const traceNo = normalizeTraceNo(record.traceNo);
    if (!traceNo) {
      continue;
    }

    if (checked.has(traceNo)) {
      continue;
    }

    const existing = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM inbound_records WHERE traceNo = ? LIMIT 1',
      [traceNo]
    );
    if (existing) {
      throw new Error(`追踪码已入库，不能重复保存：${traceNo}`);
    }

    checked.add(traceNo);
  }
};

const assertInventoryTraceNosNotAlreadySaved = async (
  database: SQLite.SQLiteDatabase,
  records: Array<{ traceNo?: string | null }>
) => {
  const checked = new Set<string>();

  for (const record of records) {
    const traceNo = normalizeTraceNo(record.traceNo);
    if (!traceNo || checked.has(traceNo)) {
      continue;
    }

    const existing = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM inventory_check_records WHERE traceNo = ? LIMIT 1',
      [traceNo]
    );
    if (existing) {
      throw new Error(`追踪码已盘点，不能重复保存：${traceNo}`);
    }

    checked.add(traceNo);
  }
};

const assertUnpackTraceNoAvailable = async (
  database: SQLite.SQLiteDatabase,
  newTraceNo: string,
  materialId: string
) => {
  const trimmedNewTraceNo = newTraceNo.trim();
  if (!trimmedNewTraceNo) {
    return;
  }

  const existingMaterial = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM materials WHERE traceNo = ? AND id != ? LIMIT 1',
    [trimmedNewTraceNo, materialId]
  );
  if (existingMaterial) {
    throw new Error(`新追踪码已被其他物料使用：${trimmedNewTraceNo}`);
  }

  const existingUnpack = await database.getFirstAsync<{ pair_id: string }>(
    'SELECT pair_id FROM unpack_records WHERE new_traceNo = ? LIMIT 1',
    [trimmedNewTraceNo]
  );
  if (existingUnpack) {
    throw new Error(`新追踪码已存在拆包记录：${trimmedNewTraceNo}`);
  }
};

const canUseRemainingUnpackTraceNo = async (
  database: SQLite.SQLiteDatabase,
  traceNo: string,
  currentOrderNo: string,
  warehouseId?: string
): Promise<boolean> => {
  const trimmedTraceNo = traceNo.trim();
  const trimmedWarehouseId = warehouseId?.trim();
  if (!trimmedTraceNo || !trimmedWarehouseId) {
    return false;
  }

  const remainingLabel = await database.getFirstAsync<{ pair_id: string }>(
    'SELECT pair_id FROM unpack_records WHERE label_type = ? AND new_traceNo = ? AND warehouse_id = ? LIMIT 1',
    ['remaining', trimmedTraceNo, trimmedWarehouseId]
  );
  if (!remainingLabel) {
    return false;
  }

  const consumedByUnpack = await database.getFirstAsync<{ pair_id: string }>(
    'SELECT pair_id FROM unpack_records WHERE traceNo = ? AND warehouse_id = ? LIMIT 1',
    [trimmedTraceNo, trimmedWarehouseId]
  );
  if (consumedByUnpack) {
    return false;
  }

  const matchingMaterials = await database.getAllAsync<any>(
    'SELECT * FROM materials WHERE traceNo = ? AND warehouse_id = ?',
    [trimmedTraceNo, trimmedWarehouseId]
  );
  if (matchingMaterials.length !== 1) {
    return false;
  }

  return !matchingMaterials.some((material) => {
    const sameOrder = material.order_no === currentOrderNo;
    const remainingQuantity = parseQuantity(material.remaining_quantity, { min: 0 }) ?? 0;
    const sourceRemainingMaterial = material.isUnpacked === 1 && remainingQuantity > 0;

    return sameOrder || !sourceRemainingMaterial;
  });
};

const padDatePart = (value: string | number): string => String(value).padStart(2, '0');

const normalizeStoredDateTimeString = (value?: string | null): string | null => {
  if (!value) {
    return value ?? null;
  }

  const normalizedValue = value.trim();
  const match = normalizedValue.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );

  if (!match) {
    return normalizedValue;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const normalizedDate = `${year}/${padDatePart(month)}/${padDatePart(day)}`;

  if (hours === undefined || minutes === undefined) {
    return normalizedDate;
  }

  const normalizedTime = `${padDatePart(hours)}:${padDatePart(minutes)}`;
  return seconds !== undefined
    ? `${normalizedDate} ${normalizedTime}:${padDatePart(seconds)}`
    : `${normalizedDate} ${normalizedTime}`;
};

// 获取数据库实例
const getDb = (): SQLite.SQLiteDatabase => {
  if (isWebPlatform) {
    // Web 平台返回 mock 对象
    logger.log('[Web Platform] Using mock database');
    return createMockDatabase();
  }

  if (!db) {
    // 如果数据库未初始化，尝试自动初始化
    logger.warn('[getDb] 数据库未初始化，尝试自动初始化...');
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
};

// 创建 mock 数据库（用于 Web 预览）
// 使用内存存储模拟数据库功能，尽可能模拟 SQLite 行为
const mockTables: Record<string, any[]> = {
  warehouses: [],
  orders: [],
  materials: [],
  inventory_bindings: [],
  qr_code_rules: [],
  inbound_records: [],
  inventory_check_records: [],
  unpack_records: [],
  print_history: [],
  custom_fields: [],
  system_config: [],
};

// 调试函数：打印所有表的状态
const debugDumpTables = () => {
  logger.log('[MockDB] ===== Database State Dump =====');
  Object.entries(mockTables).forEach(([tableName, rows]) => {
    logger.log(`[MockDB] Table: ${tableName} (${rows.length} rows)`);
    if (rows.length > 0) {
      logger.log(`[MockDB]   First row:`, rows[0]);
    }
  });
  logger.log('[MockDB] ===== End Dump =====');
};

// 全局暴露调试函数（在控制台可以调用）
if (typeof globalThis !== 'undefined') {
  (globalThis as typeof globalThis & { debugDumpTables?: typeof debugDumpTables }).debugDumpTables =
    debugDumpTables;
}

const normalizeSqlText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractWhereClause = (sql: string): string | null => {
  const match = sql.match(/\bWHERE\b\s+(.+?)(?:\s+GROUP\s+BY\b|\s+ORDER\s+BY\b|\s+LIMIT\b|$)/is);
  return match ? match[1].trim() : null;
};

const stripWrappingParentheses = (value: string): string => {
  let result = value.trim();
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let i = 0; i < result.length; i += 1) {
      const char = result[i];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0 && i < result.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression) break;
    result = result.slice(1, -1).trim();
  }
  return result;
};

const splitSqlLogical = (value: string, operator: 'AND' | 'OR'): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const normalizedOperator = operator.toUpperCase();

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }

    const segment = value.slice(i, i + normalizedOperator.length);
    const before = i === 0 ? ' ' : value[i - 1];
    const after = value[i + normalizedOperator.length] || ' ';
    if (
      segment.toUpperCase() === normalizedOperator &&
      /\s/.test(before) &&
      /\s/.test(after)
    ) {
      parts.push(value.slice(start, i).trim());
      start = i + normalizedOperator.length;
      i = start - 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const getSqlExpressionFallback = (expression: string): unknown => {
  const fallbackMatch = expression.match(/,\s*('([^']*)'|"([^"]*)"|\d+)\s*\)?$/);
  if (!fallbackMatch) {
    return '';
  }
  return fallbackMatch[2] ?? fallbackMatch[3] ?? Number(fallbackMatch[1]);
};

const getMockColumnName = (expression: string): string | null => {
  let expr = stripWrappingParentheses(expression);
  const coalesceMatch = expr.match(/^COALESCE\((.+?),.+\)$/i);
  if (coalesceMatch) {
    expr = coalesceMatch[1].trim();
  }

  const nullIfMatch = expr.match(/^NULLIF\((.+?),.+\)$/i);
  if (nullIfMatch) {
    expr = nullIfMatch[1].trim();
  }

  const trimMatch = expr.match(/^TRIM\((.+)\)$/i);
  if (trimMatch) {
    expr = trimMatch[1].trim();
  }

  const castMatch = expr.match(/^CAST\((.+?)\s+AS\s+.+\)$/i);
  if (castMatch) {
    expr = castMatch[1].trim();
  }

  const columnMatch = expr.match(/(?:\w+\.)?([A-Za-z_]\w*)$/);
  return columnMatch ? columnMatch[1] : null;
};

const getMockExpressionValue = (row: any, expression: string): unknown => {
  const expr = stripWrappingParentheses(expression);
  const quotedMatch = expr.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (quotedMatch) {
    return quotedMatch[1] ?? quotedMatch[2] ?? '';
  }

  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return Number(expr);
  }

  const columnName = getMockColumnName(expr);
  const value = columnName ? row[columnName] : undefined;
  if (/^COALESCE\(/i.test(expr)) {
    return value ?? getSqlExpressionFallback(expr);
  }
  if (/^TRIM\(/i.test(expr)) {
    return String(value ?? '').trim();
  }
  return value;
};

const getMockRightValue = (
  row: any,
  expression: string,
  params: any[],
  cursor: { index: number }
): unknown => {
  if (expression.includes('?')) {
    const value = params[cursor.index];
    cursor.index += 1;
    return /^COALESCE\(/i.test(stripWrappingParentheses(expression))
      ? value ?? getSqlExpressionFallback(expression)
      : value;
  }
  return getMockExpressionValue(row, expression);
};

const compareMockValues = (left: unknown, right: unknown, operator: string): boolean => {
  if (operator === '=' || operator === '!=' || operator === '<>') {
    const matched = String(left ?? '') === String(right ?? '');
    return operator === '=' ? matched : !matched;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const useNumericCompare = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const a = useNumericCompare ? leftNumber : String(left ?? '');
  const b = useNumericCompare ? rightNumber : String(right ?? '');

  if (operator === '<') return a < b;
  if (operator === '<=') return a <= b;
  if (operator === '>') return a > b;
  if (operator === '>=') return a >= b;
  return false;
};

const evaluateMockCondition = (
  row: any,
  condition: string,
  params: any[],
  cursor: { index: number }
): boolean => {
  const normalized = stripWrappingParentheses(normalizeSqlText(condition));
  if (!normalized) {
    return true;
  }

  const orParts = splitSqlLogical(normalized, 'OR');
  if (orParts.length > 1) {
    let matched = false;
    for (const part of orParts) {
      matched = evaluateMockCondition(row, part, params, cursor) || matched;
    }
    return matched;
  }

  const isNullMatch = normalized.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch) {
    const value = getMockExpressionValue(row, isNullMatch[1]);
    const isNull = value === null || value === undefined || value === '';
    return isNullMatch[2] ? !isNull : isNull;
  }

  const likeMatch = normalized.match(/^(.+?)\s+LIKE\s+(.+?)(?:\s+ESCAPE\s+.+)?$/i);
  if (likeMatch) {
    const left = String(getMockExpressionValue(row, likeMatch[1]) ?? '');
    const pattern = String(getMockRightValue(row, likeMatch[2], params, cursor) ?? '');
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i').test(left);
  }

  const inMatch = normalized.match(/^(.+?)\s+IN\s*\((.+)\)$/i);
  if (inMatch) {
    const left = String(getMockExpressionValue(row, inMatch[1]) ?? '');
    const values = inMatch[2]
      .split(',')
      .map((item) => item.trim())
      .map((item) => getMockRightValue(row, item, params, cursor))
      .map((item) => String(item ?? ''));
    return values.includes(left);
  }

  const binaryMatch = normalized.match(/^(.+?)\s*(=|!=|<>|<=|>=|<|>)\s*(.+)$/);
  if (binaryMatch) {
    const left = getMockExpressionValue(row, binaryMatch[1]);
    const right = getMockRightValue(row, binaryMatch[3], params, cursor);
    return compareMockValues(left, right, binaryMatch[2]);
  }

  cursor.index += (normalized.match(/\?/g) || []).length;
  logger.warn(`[MockDB] Unsupported WHERE condition, kept for preview: ${normalized}`);
  return true;
};

// 解析 WHERE 条件并过滤数据
const filterByWhere = (rows: any[], whereClause: string, params: any[] = []): any[] => {
  logger.log(`[MockDB] filterByWhere: whereClause="${whereClause}", params=`, params);

  if (!whereClause) return rows;

  const conditions = splitSqlLogical(whereClause, 'AND');
  const result = rows.filter((row) => {
    const cursor = { index: 0 };
    return conditions.every((condition) => evaluateMockCondition(row, condition, params, cursor));
  });

  logger.log(`[MockDB] filter result: ${result.length} rows`);
  return result;
};

const splitSqlComma = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const extractGroupByClause = (sql: string): string | null => {
  const match = sql.match(/\bGROUP\s+BY\b\s+(.+?)(?:\s+ORDER\s+BY\b|\s+LIMIT\b|$)/is);
  return match ? match[1].trim() : null;
};

const getMockSelectExpressionParts = (expression: string) => {
  const trimmed = expression.trim();
  const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+([A-Za-z_]\w*)$/i);
  const valueExpression = aliasMatch ? aliasMatch[1].trim() : trimmed;
  const alias = aliasMatch?.[2] || getMockColumnName(valueExpression) || valueExpression;
  return { valueExpression, alias };
};

const getMockAggregateValue = (
  rows: any[],
  expression: string
): { handled: boolean; value: unknown } => {
  const normalized = stripWrappingParentheses(expression.trim());
  if (/^COUNT\s*\(/i.test(normalized)) {
    return { handled: true, value: rows.length };
  }

  const sumMatch = normalized.match(/^SUM\s*\((.+)\)$/i);
  if (sumMatch) {
    const value = rows.reduce((total, row) => {
      const nextValue = Number(getMockExpressionValue(row, sumMatch[1]) ?? 0);
      return total + (Number.isFinite(nextValue) ? nextValue : 0);
    }, 0);
    return { handled: true, value };
  }

  return { handled: false, value: undefined };
};

const mapMockSelectRow = (row: any, selectClause: string, groupRows?: any[]): any => {
  if (selectClause === '*') {
    return row;
  }

  const result: any = {};
  splitSqlComma(selectClause).forEach((rawExpression) => {
    const { valueExpression, alias } = getMockSelectExpressionParts(rawExpression);
    if (/^(?:\w+\.)?\*$/.test(valueExpression)) {
      Object.assign(result, row);
      return;
    }

    const aggregate = getMockAggregateValue(groupRows || [row], valueExpression);
    result[alias] = aggregate.handled
      ? aggregate.value
      : getMockExpressionValue(row, valueExpression);
  });
  return result;
};

const groupMockRows = (rows: any[], groupByClause: string): any[][] => {
  const groupExpressions = splitSqlComma(groupByClause);
  const groups = new Map<string, any[]>();
  rows.forEach((row) => {
    const key = groupExpressions
      .map((expression) => String(getMockExpressionValue(row, expression) ?? ''))
      .join('\u0001');
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });
  return Array.from(groups.values());
};

const matchesMockLike = (value: unknown, pattern: string): boolean => {
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i').test(String(value ?? ''));
};

const getMockStatisticsResult = (params: any[] = []) => {
  const [todayOrderPattern = '', todayMaterialPattern = '', todayQuantityPattern = ''] = params;
  const orders = mockTables.orders || [];
  const materials = mockTables.materials || [];
  const sumQuantity = (rows: any[]) =>
    rows.reduce((total, row) => {
      const nextValue = Number(row.quantity ?? 0);
      return total + (Number.isFinite(nextValue) ? nextValue : 0);
    }, 0);

  return {
    totalOrders: orders.length,
    todayOrders: orders.filter((row) => matchesMockLike(row.created_at, String(todayOrderPattern))).length,
    totalMaterials: materials.length,
    totalQuantity: sumQuantity(materials),
    todayMaterials: materials.filter((row) =>
      matchesMockLike(row.scanned_at, String(todayMaterialPattern))
    ).length,
    todayQuantity: sumQuantity(
      materials.filter((row) => matchesMockLike(row.scanned_at, String(todayQuantityPattern)))
    ),
  };
};

const createMockDatabase = (): SQLite.SQLiteDatabase => {
  return {
    execAsync: async (sql: string) => {
      logger.log('[MockDB] execAsync:', sql);
      // 处理 CREATE TABLE 语句
      if (sql.includes('CREATE TABLE')) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
        if (match) {
          const tableName = match[1];
          if (!mockTables[tableName]) {
            mockTables[tableName] = [];
            logger.log(`[MockDB] Created table: ${tableName}`);
          }
        }
      }
      // 处理 PRAGMA 语句
      if (sql.trim().startsWith('PRAGMA')) {
        logger.log('[MockDB] PRAGMA:', sql);
      }
    },
    runAsync: async (sql: string, params?: any[]) => {
      logger.log('[MockDB] runAsync:', sql, params);

      // 处理 INSERT 语句
      const insertMatch = sql
        .trim()
        .match(/^INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+(\w+)\s*\((.*?)\)/is);
      if (insertMatch) {
        // 提取表名和列名（使用更灵活的正则表达式）
        const tableName = insertMatch[1];
        const columns = splitSqlComma(insertMatch[2]);
        const row: any = {};
        params?.forEach((value, index) => {
          if (index < columns.length) {
            row[columns[index]] = value;
          }
        });

        // 确保表存在
        if (!mockTables[tableName]) {
          mockTables[tableName] = [];
          logger.log(`[MockDB] Auto-created table: ${tableName}`);
        }

        const shouldReplace = /^INSERT\s+OR\s+REPLACE/i.test(sql.trim());
        const replaceKey = row.id !== undefined ? 'id' : row.key !== undefined ? 'key' : null;
        const existingIndex =
          shouldReplace && replaceKey
            ? mockTables[tableName].findIndex(
                (item) => String(item[replaceKey]) === String(row[replaceKey])
              )
            : -1;
        if (existingIndex >= 0) {
          mockTables[tableName][existingIndex] = row;
        } else {
          mockTables[tableName].push(row);
        }
        logger.log(`[MockDB] Inserted into ${tableName}:`, row);
        logger.log(`[MockDB] Table now has ${mockTables[tableName].length} rows`);
        return { changes: 1, lastInsertRowId: mockTables[tableName].length };
      }

      // 处理 UPDATE 语句
      if (sql.trim().startsWith('UPDATE')) {
        const match = sql.match(/UPDATE (\w+) SET (.*?) WHERE (.*)/s);
        if (match) {
          const tableName = match[1];
          const setClause = match[2].trim();
          const whereClause = match[3].trim();
          const rows = mockTables[tableName] || [];

          // 解析 SET 子句（格式：column = ?, column = ?, ...）
          const setParts = setClause.split(',').map((p) => p.trim());
          const columnNames = setParts.map((part) => part.split('=')[0].trim());

          // 找到匹配的行
          let updatedCount = 0;
          if (whereClause && params) {
            const filtered = filterByWhere(rows, whereClause, params.slice(columnNames.length));
            filtered.forEach((row) => {
              // 更新字段值
              columnNames.forEach((col, index) => {
                row[col] = params[index];
              });
              updatedCount++;
            });
          } else {
            updatedCount = rows.length;
          }
          logger.log(`[MockDB] Updated ${updatedCount} rows in ${tableName}`);
          return { changes: updatedCount, lastInsertRowId: 0 };
        }
      }

      // 处理 DELETE 语句
      if (sql.trim().startsWith('DELETE')) {
        const match = sql.match(/DELETE FROM (\w+) WHERE (.*)/);
        if (match) {
          const tableName = match[1];
          const whereClause = match[2];
          const rows = mockTables[tableName] || [];

          if (whereClause && params) {
            const filtered = filterByWhere(rows, whereClause, params);
            // 从原数组中删除匹配的行
            filtered.forEach((row) => {
              const index = rows.indexOf(row);
              if (index > -1) {
                rows.splice(index, 1);
              }
            });
            logger.log(`[MockDB] Deleted ${filtered.length} rows from ${tableName}`);
            return { changes: filtered.length, lastInsertRowId: 0 };
          } else {
            const count = rows.length;
            mockTables[tableName] = [];
            logger.log(`[MockDB] Cleared ${tableName} (${count} rows)`);
            return { changes: count, lastInsertRowId: 0 };
          }
        }
      }

      return { changes: 0, lastInsertRowId: 0 };
    },
    getAllAsync: async <T>(sql: string, params?: any[]): Promise<T[]> => {
      logger.log('[MockDB] getAllAsync:', sql, params);

      // 处理 SELECT 语句
      if (sql.trim().startsWith('SELECT')) {
        const match = sql.match(/FROM (\w+)/);
        if (match) {
          const tableName = match[1];

          // 检查表是否存在
          if (!mockTables[tableName]) {
            logger.log(
              `[MockDB] Table "${tableName}" does not exist! Available tables:`,
              Object.keys(mockTables)
            );
            return [];
          }

          const results = mockTables[tableName] || [];

          // 提取 SELECT 指定的字段
          const selectMatch = sql.match(/SELECT (.+?) FROM/i);
          const selectClause = selectMatch ? selectMatch[1].trim() : '*';

          // 处理 WHERE 条件
          let filteredResults = [...results];
          // 改进正则表达式，更可靠地提取 WHERE 子句
          const whereClause = extractWhereClause(sql);
          if (whereClause) {
            logger.log(`[MockDB] Detected WHERE clause: "${whereClause}"`);
            filteredResults = filterByWhere(results, whereClause, params || []);
          } else {
            logger.log(`[MockDB] No WHERE clause detected or no params provided`);
          }

          // 处理 ORDER BY
          if (sql.includes('ORDER BY')) {
            const orderMatch = sql.match(/ORDER BY (\w+) (DESC|ASC)/);
            if (orderMatch) {
              const column = orderMatch[1];
              const direction = orderMatch[2];
              filteredResults.sort((a, b) => {
                const aVal = a[column] || '';
                const bVal = b[column] || '';
                if (direction === 'DESC') {
                  return aVal > bVal ? -1 : 1;
                } else {
                  return aVal < bVal ? -1 : 1;
                }
              });
              logger.log(`[MockDB] ORDER BY: ${column} ${direction}`);
            }
          }

          // 处理 LIMIT
          const limitMatch = sql.match(/LIMIT (\d+)/);
          if (limitMatch) {
            const limit = parseInt(limitMatch[1], 10);
            filteredResults = filteredResults.slice(0, limit);
            logger.log(`[MockDB] LIMIT: ${limit}`);
          }

          const groupByClause = extractGroupByClause(sql);
          if (groupByClause) {
            const mappedGroups = groupMockRows(filteredResults, groupByClause).map((groupRows) =>
              mapMockSelectRow(groupRows[0], selectClause, groupRows)
            );
            logger.log(
              `[MockDB] Selected ${mappedGroups.length} grouped rows (${selectClause}) from ${tableName}`
            );
            return mappedGroups as T[];
          }

          // 如果是 SELECT *，返回整行
          if (selectClause === '*') {
            logger.log(`[MockDB] Selected ${filteredResults.length} rows from ${tableName}`);
            return filteredResults as T[];
          }

          // 如果是 COUNT 等聚合函数，特殊处理
          if (/\b(COUNT|SUM)\s*\(/i.test(selectClause)) {
            const result = mapMockSelectRow(filteredResults[0] || {}, selectClause, filteredResults);
            logger.log(`[MockDB] Selected aggregate (${selectClause}) from ${tableName}:`, result);
            return [result] as T[];
          }

          // 否则只返回指定的字段
          const mappedResults = filteredResults.map((row) => mapMockSelectRow(row, selectClause));

          logger.log(
            `[MockDB] Selected ${mappedResults.length} rows (${selectClause}) from ${tableName}`
          );
          return mappedResults as T[];
        }
      }

      return [];
    },
    getFirstAsync: async <T>(sql: string, params?: any[]): Promise<T | null> => {
      logger.log('[MockDB] getFirstAsync:', sql, params);

      // 处理 SELECT 语句
      if (sql.trim().startsWith('SELECT')) {
        if (sql.includes('totalOrders') && sql.includes('todayQuantity')) {
          const result = getMockStatisticsResult(params || []);
          logger.log('[MockDB] statistics result:', result);
          return result as T;
        }

        const match = sql.match(/FROM (\w+)/);
        if (match) {
          const tableName = match[1];

          // 检查表是否存在
          if (!mockTables[tableName]) {
            logger.log(
              `[MockDB] Table "${tableName}" does not exist! Available tables:`,
              Object.keys(mockTables)
            );
            return null;
          }

          const results = mockTables[tableName] || [];

          // 提取 SELECT 指定的字段
          const selectMatch = sql.match(/SELECT (.+?) FROM/i);
          if (selectMatch) {
            const selectClause = selectMatch[1].trim();

            // 处理 WHERE 条件
            let filteredResults = [...results];
            // 改进正则表达式，更可靠地提取 WHERE 子句
            const whereClause = extractWhereClause(sql);
            if (whereClause) {
              logger.log(`[MockDB] Detected WHERE clause: "${whereClause}"`);
              filteredResults = filterByWhere(results, whereClause, params || []);
            } else {
              logger.log(`[MockDB] No WHERE clause detected or no params provided`);
            }

            const groupByClause = extractGroupByClause(sql);
            if (groupByClause) {
              const firstGroup = groupMockRows(filteredResults, groupByClause)[0];
              if (!firstGroup) {
                return null;
              }
              const result = mapMockSelectRow(firstGroup[0], selectClause, firstGroup);
              logger.log(`[MockDB] Found first grouped row (${selectClause}) in ${tableName}:`, result);
              return result as T;
            }

            // 如果是 COUNT(*) 等聚合函数，始终返回计数
            if (/\b(COUNT|SUM)\s*\(/i.test(selectClause)) {
              const result = mapMockSelectRow(filteredResults[0] || {}, selectClause, filteredResults);
              logger.log(`[MockDB] aggregate result (${selectClause}):`, result);
              return result as T;
            }

            // 如果有结果
            if (filteredResults.length > 0) {
              const row = filteredResults[0];

              // 如果是 SELECT *，返回整行
              if (selectClause === '*') {
                logger.log(`[MockDB] Found first row (*) in ${tableName}:`, row);
                return row as T;
              }

              // 否则只返回指定的字段
              const result = mapMockSelectRow(row, selectClause);
              logger.log(`[MockDB] Found first row (${selectClause}) in ${tableName}:`, result);
              return result as T;
            }
          }
        }
      }

      logger.log('[MockDB] No result found');
      return null;
    },
  } as unknown as SQLite.SQLiteDatabase;
};

// 数据库版本号（当表结构变化时递增）
const DB_VERSION = 4;

const migrateInboundAndInventoryRecordTables = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  const inboundTable = await database.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['inbound_records']
  );
  const inventoryTable = await database.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['inventory_check_records']
  );

  const inboundNeedsMigration =
    inboundTable?.sql?.includes('inbound_no TEXT NOT NULL UNIQUE') ?? false;
  const inventoryNeedsMigration =
    inventoryTable?.sql?.includes('check_no TEXT NOT NULL UNIQUE') ?? false;

  if (!inboundNeedsMigration && !inventoryNeedsMigration) {
    return;
  }

  logger.log('[DB Migration] 修复入库/盘点记录表的单号唯一约束...');
  await database.execAsync('BEGIN TRANSACTION');

  try {
    if (inboundNeedsMigration) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS inbound_records_new (
          id TEXT PRIMARY KEY,
          inbound_no TEXT NOT NULL,
          warehouse_id TEXT NOT NULL,
          warehouse_name TEXT NOT NULL,
          inventory_code TEXT,
          scan_model TEXT NOT NULL,
          batch TEXT,
          quantity INTEGER NOT NULL,
          in_date TEXT NOT NULL,
          notes TEXT,
          raw_content TEXT,
          created_at TEXT NOT NULL,
          package TEXT,
          version TEXT,
          productionDate TEXT,
          traceNo TEXT,
          sourceNo TEXT,
          customFields TEXT,
          sync_status TEXT DEFAULT 'pending',
          sync_file_name TEXT,
          synced_at TEXT,
          sync_message TEXT
        );
      `);
      await database.execAsync(`
        INSERT INTO inbound_records_new (
          id, inbound_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
          quantity, in_date, notes, raw_content, created_at, package, version,
          productionDate, traceNo, sourceNo, customFields
        )
        SELECT
          id, inbound_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
          quantity, in_date, notes, raw_content, created_at, package, version,
          productionDate, traceNo, sourceNo, customFields
        FROM inbound_records;
      `);
      await database.execAsync('DROP TABLE inbound_records');
      await database.execAsync('ALTER TABLE inbound_records_new RENAME TO inbound_records');
    }

    if (inventoryNeedsMigration) {
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS inventory_check_records_new (
          id TEXT PRIMARY KEY,
          check_no TEXT NOT NULL,
          warehouse_id TEXT NOT NULL,
          warehouse_name TEXT NOT NULL,
          inventory_code TEXT,
          scan_model TEXT NOT NULL,
          batch TEXT,
          quantity INTEGER,
          check_type TEXT NOT NULL,
          actual_quantity INTEGER,
          check_date TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          package TEXT,
          version TEXT,
          productionDate TEXT,
          traceNo TEXT,
          sourceNo TEXT,
          customFields TEXT,
          sync_status TEXT DEFAULT 'pending',
          sync_file_name TEXT,
          synced_at TEXT,
          sync_message TEXT
        );
      `);
      await database.execAsync(`
        INSERT INTO inventory_check_records_new (
          id, check_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
          quantity, check_type, actual_quantity, check_date, notes, created_at, package,
          version, productionDate, traceNo, sourceNo, customFields
        )
        SELECT
          id, check_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
          quantity, check_type, actual_quantity, check_date, notes, created_at, package,
          version, productionDate, traceNo, sourceNo, customFields
        FROM inventory_check_records;
      `);
      await database.execAsync('DROP TABLE inventory_check_records');
      await database.execAsync(
        'ALTER TABLE inventory_check_records_new RENAME TO inventory_check_records'
      );
    }

    await database.execAsync('COMMIT');
    logger.log('[DB Migration] 入库/盘点记录表约束修复完成');
  } catch (error) {
    await database.execAsync('ROLLBACK');
    logger.error('[DB Migration] 入库/盘点记录表约束修复失败:', error);
    throw error;
  }
};

const migrateOrdersTableWarehouseScope = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  const ordersTable = await database.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['orders']
  );

  const needsMigration =
    ordersTable?.sql?.includes('order_no TEXT NOT NULL UNIQUE') ?? false;

  if (!needsMigration) {
    return;
  }

  logger.log('[DB Migration] 修复出库订单表的订单号全局唯一约束...');
  await database.execAsync('BEGIN TRANSACTION');

  try {
    await database.execAsync('DROP TABLE IF EXISTS orders_new');
    await database.execAsync(`
      CREATE TABLE orders_new (
        id TEXT PRIMARY KEY,
        order_no TEXT NOT NULL,
        customer_name TEXT,
        warehouse_id TEXT,
        warehouse_name TEXT,
        created_at TEXT NOT NULL
      );
    `);
    await database.execAsync(`
      INSERT INTO orders_new (
        id, order_no, customer_name, warehouse_id, warehouse_name, created_at
      )
      SELECT
        id, order_no, customer_name, warehouse_id, warehouse_name, created_at
      FROM orders;
    `);
    await database.execAsync('DROP TABLE orders');
    await database.execAsync('ALTER TABLE orders_new RENAME TO orders');
    await database.execAsync('COMMIT');
    logger.log('[DB Migration] 出库订单表约束修复完成');
  } catch (error) {
    await database.execAsync('ROLLBACK');
    logger.error('[DB Migration] 出库订单表约束修复失败:', error);
    throw error;
  }
};

const ensureDeletionArchiveTablesAndTriggers = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS deleted_materials_archive (
      archive_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      id TEXT,
      order_no TEXT,
      customer_name TEXT,
      operation_type TEXT,
      model TEXT,
      batch TEXT,
      quantity INTEGER,
      package TEXT,
      version TEXT,
      productionDate TEXT,
      traceNo TEXT,
      sourceNo TEXT,
      scanned_at TEXT,
      raw_content TEXT,
      customFields TEXT,
      isUnpacked INTEGER,
      original_quantity TEXT,
      remaining_quantity TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      inventory_code TEXT,
      rule_id INTEGER,
      rule_name TEXT
    );

    CREATE TABLE IF NOT EXISTS deleted_orders_archive (
      archive_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      id TEXT,
      order_no TEXT,
      customer_name TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS deleted_warehouses_archive (
      archive_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      id TEXT,
      name TEXT,
      description TEXT,
      is_default INTEGER,
      sort_order INTEGER,
      created_at TEXT
    );

    CREATE TRIGGER IF NOT EXISTS trg_archive_deleted_materials
    AFTER DELETE ON materials
    BEGIN
      INSERT INTO deleted_materials_archive (
        archive_id, deleted_at, id, order_no, customer_name, operation_type, model, batch,
        quantity, package, version, productionDate, traceNo, sourceNo, scanned_at,
        raw_content, customFields, isUnpacked, original_quantity, remaining_quantity,
        warehouse_id, warehouse_name, inventory_code, rule_id, rule_name
      ) VALUES (
        lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        OLD.id, OLD.order_no, OLD.customer_name, OLD.operation_type, OLD.model, OLD.batch,
        OLD.quantity, OLD.package, OLD.version, OLD.productionDate, OLD.traceNo, OLD.sourceNo,
        OLD.scanned_at, OLD.raw_content, OLD.customFields, OLD.isUnpacked,
        OLD.original_quantity, OLD.remaining_quantity, OLD.warehouse_id, OLD.warehouse_name,
        OLD.inventory_code, OLD.rule_id, OLD.rule_name
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_archive_deleted_orders
    AFTER DELETE ON orders
    BEGIN
      INSERT INTO deleted_orders_archive (
        archive_id, deleted_at, id, order_no, customer_name, warehouse_id, warehouse_name, created_at
      ) VALUES (
        lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        OLD.id, OLD.order_no, OLD.customer_name, OLD.warehouse_id, OLD.warehouse_name, OLD.created_at
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_archive_deleted_warehouses
    AFTER DELETE ON warehouses
    BEGIN
      INSERT INTO deleted_warehouses_archive (
        archive_id, deleted_at, id, name, description, is_default, sort_order, created_at
      ) VALUES (
        lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        OLD.id, OLD.name, OLD.description, OLD.is_default, OLD.sort_order, OLD.created_at
      );
    END;

    CREATE INDEX IF NOT EXISTS idx_deleted_materials_archive_lookup
    ON deleted_materials_archive (operation_type, warehouse_id, order_no, deleted_at DESC);

    CREATE INDEX IF NOT EXISTS idx_deleted_orders_archive_lookup
    ON deleted_orders_archive (warehouse_id, order_no, deleted_at DESC);
  `);
};

const ensureDocumentSyncColumns = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  const ensureColumns = async (tableName: 'inbound_records' | 'inventory_check_records') => {
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const existing = new Set(columns.map((column) => column.name));
    const statements: string[] = [];

    if (!existing.has('sync_status')) {
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN sync_status TEXT DEFAULT 'pending'`);
    }
    if (!existing.has('sync_file_name')) {
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN sync_file_name TEXT`);
    }
    if (!existing.has('synced_at')) {
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN synced_at TEXT`);
    }
    if (!existing.has('sync_message')) {
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN sync_message TEXT`);
    }

    for (const statement of statements) {
      await database.execAsync(statement);
    }
  };

  await ensureColumns('inbound_records');
  await ensureColumns('inventory_check_records');
};

const ensureRuleFieldPrefixesColumn = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(qr_code_rules)');
  const hasFieldPrefixes = columns.some((column) => column.name === 'field_prefixes');

  if (hasFieldPrefixes) {
    return;
  }

  logger.log('[DB Migration] 为二维码规则表添加字段前缀配置列...');
  await database.execAsync('ALTER TABLE qr_code_rules ADD COLUMN field_prefixes TEXT');
  logger.log('[DB Migration] 字段前缀配置列添加完成');
};

const ensureWarehouseSortOrderColumn = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(warehouses)');
  const hasSortOrder = columns.some((column) => column.name === 'sort_order');

  if (hasSortOrder) {
    return;
  }

  logger.log('[DB Migration] 为仓库表添加排序列...');
  await database.execAsync('ALTER TABLE warehouses ADD COLUMN sort_order INTEGER DEFAULT 0');

  const warehouses = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM warehouses ORDER BY created_at DESC, id DESC'
  );
  for (let index = 0; index < warehouses.length; index += 1) {
    await database.runAsync('UPDATE warehouses SET sort_order = ? WHERE id = ?', [
      index,
      warehouses[index]!.id,
    ]);
  }

  logger.log('[DB Migration] 仓库排序列添加完成');
};

const normalizeDateTimeColumns = async (
  database: SQLite.SQLiteDatabase,
  tableName: string,
  idColumn: string,
  columns: string[]
) => {
  const selectColumns = [idColumn, ...columns].join(', ');
  const rows = await database.getAllAsync<Record<string, string | null>>(
    `SELECT ${selectColumns} FROM ${tableName}`
  );

  for (const row of rows) {
    const updateFields: string[] = [];
    const values: string[] = [];

    columns.forEach((column) => {
      const originalValue = row[column];
      const normalizedValue = normalizeStoredDateTimeString(originalValue);
      if (
        typeof originalValue === 'string' &&
        normalizedValue &&
        normalizedValue !== originalValue
      ) {
        updateFields.push(`${column} = ?`);
        values.push(normalizedValue);
      }
    });

    if (updateFields.length === 0) {
      continue;
    }

    values.push(String(row[idColumn]));
    await database.runAsync(
      `UPDATE ${tableName} SET ${updateFields.join(', ')} WHERE ${idColumn} = ?`,
      values
    );
  }
};

const normalizeLegacyDateTimeColumns = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  logger.log('[DB Migration] 规范化历史时间字段格式...');
  await database.execAsync('BEGIN TRANSACTION');

  try {
    await normalizeDateTimeColumns(database, 'orders', 'id', ['created_at']);
    await normalizeDateTimeColumns(database, 'materials', 'id', ['scanned_at']);
    await normalizeDateTimeColumns(database, 'unpack_records', 'id', [
      'unpacked_at',
      'printed_at',
      'created_at',
      'updated_at',
    ]);
    await normalizeDateTimeColumns(database, 'print_history', 'id', ['printed_at', 'created_at']);
    await normalizeDateTimeColumns(database, 'qr_code_rules', 'id', ['created_at', 'updated_at']);
    await normalizeDateTimeColumns(database, 'custom_fields', 'id', ['created_at', 'updated_at']);
    await normalizeDateTimeColumns(database, 'warehouses', 'id', ['created_at']);
    await normalizeDateTimeColumns(database, 'inventory_bindings', 'id', ['created_at']);
    await normalizeDateTimeColumns(database, 'inbound_records', 'id', ['created_at']);
    await normalizeDateTimeColumns(database, 'inbound_summary', 'id', ['created_at', 'updated_at']);
    await normalizeDateTimeColumns(database, 'inventory_check_records', 'id', ['created_at']);
    await database.execAsync('COMMIT');
    logger.log('[DB Migration] 历史时间字段规范化完成');
  } catch (error) {
    await rollbackTransaction(database, 'normalizeLegacyDateTimeColumns');
    logger.error('[DB Migration] 历史时间字段规范化失败:', error);
    throw error;
  }
};

const repairLegacyUnpackedMaterials = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  logger.log('[DB Migration] 修复历史拆包物料的数量口径和拆包状态...');

  const result = await database.runAsync(
    `UPDATE materials
     SET quantity = COALESCE(
           CAST(
             (
               SELECT TRIM(ur.new_quantity)
               FROM unpack_records ur
               WHERE ur.original_material_id = materials.id
                 AND ur.label_type = 'shipped'
                 AND TRIM(ur.new_quantity) != ''
                 AND TRIM(ur.new_quantity) NOT GLOB '*[^0-9]*'
               ORDER BY ur.unpacked_at DESC, ur.id DESC
               LIMIT 1
             ) AS INTEGER
           ),
           quantity
         ),
         original_quantity = COALESCE(
           NULLIF(TRIM(original_quantity), ''),
           (
             SELECT ur.original_quantity
             FROM unpack_records ur
             WHERE ur.original_material_id = materials.id
               AND TRIM(ur.original_quantity) != ''
             ORDER BY ur.unpacked_at DESC, ur.id DESC
             LIMIT 1
           )
         ),
         remaining_quantity = COALESCE(
           NULLIF(TRIM(remaining_quantity), ''),
           (
             SELECT ur.new_quantity
             FROM unpack_records ur
             WHERE ur.original_material_id = materials.id
               AND ur.label_type = 'remaining'
               AND TRIM(ur.new_quantity) != ''
             ORDER BY ur.unpacked_at DESC, ur.id DESC
             LIMIT 1
           )
         ),
         isUnpacked = 1
     WHERE EXISTS (
       SELECT 1
       FROM unpack_records ur
       WHERE ur.original_material_id = materials.id
     )`
  );

  if (result.changes > 0) {
    logger.log(`[DB Migration] 已修复 ${result.changes} 条历史拆包物料`);
  }
};

const ensureTraceNoUniqueIndex = async (
  database: SQLite.SQLiteDatabase,
  tableName: 'inbound_records' | 'inventory_check_records',
  indexName: string
): Promise<void> => {
  await database.execAsync(`
    CREATE TRIGGER IF NOT EXISTS ${indexName}_insert_guard
    BEFORE INSERT ON ${tableName}
    WHEN NEW.traceNo IS NOT NULL
      AND TRIM(NEW.traceNo) != ''
      AND EXISTS (
        SELECT 1 FROM ${tableName}
        WHERE traceNo = NEW.traceNo
        LIMIT 1
      )
    BEGIN
      SELECT RAISE(ABORT, '追踪码已存在');
    END;

    CREATE TRIGGER IF NOT EXISTS ${indexName}_update_guard
    BEFORE UPDATE OF traceNo ON ${tableName}
    WHEN NEW.traceNo IS NOT NULL
      AND TRIM(NEW.traceNo) != ''
      AND EXISTS (
        SELECT 1 FROM ${tableName}
        WHERE traceNo = NEW.traceNo
          AND id != OLD.id
        LIMIT 1
      )
    BEGIN
      SELECT RAISE(ABORT, '追踪码已存在');
    END;
  `);

  const duplicate = await database.getFirstAsync<{ traceNo: string; count: number }>(
    `SELECT traceNo, COUNT(*) as count
     FROM ${tableName}
     WHERE traceNo IS NOT NULL AND TRIM(traceNo) != ''
     GROUP BY traceNo
     HAVING COUNT(*) > 1
     LIMIT 1`
  );

  if (duplicate) {
    logger.warn(
      `[DB Migration] ${tableName} 存在历史重复追踪码，已启用触发器防止新增重复，跳过唯一索引:`,
      duplicate.traceNo,
      duplicate.count
    );
    return;
  }

  await database.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}
    ON ${tableName} (traceNo)
    WHERE traceNo IS NOT NULL AND TRIM(traceNo) != '';
  `);
};

const ensureTraceNoUniqueIndexes = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  await ensureTraceNoUniqueIndex(database, 'inbound_records', 'idx_inbound_records_trace_unique');
  await ensureTraceNoUniqueIndex(
    database,
    'inventory_check_records',
    'idx_inventory_check_records_trace_unique'
  );
};

// 初始化数据库
export const initDatabase = async (): Promise<void> => {
  logger.log('[initDatabase] 开始初始化...');
  logger.log('[initDatabase] 当前db状态', db ? '已初始化' : 'null');
  logger.log('[initDatabase] 当前isInitializing', isInitializing);

  try {
    // Web 平台跳过数据库初始化（用于预览）
    if (isWebPlatform) {
      logger.log('[Web Platform] Skipping database initialization (preview mode)');
      return;
    }

    // 防止重复初始化
    if (isInitializing) {
      logger.log('[initDatabase] 数据库正在初始化中，等待完成...');
      if (initPromise) {
        await initPromise;
      }
      return;
    }

    // 修复：立即设置并发控制标志，防止竞态条件
    isInitializing = true;
    logger.log('[initDatabase] 开始初始化数据库');

    // 检查是否已经初始化
    if (db) {
      logger.log('[initDatabase] 数据库已初始化，直接返回');
      isInitializing = false;
      return;
    }

    // 创建初始化 Promise，用于并发调用等待
    initPromise = (async () => {
      try {
        await performDatabaseInitialization();
      } catch (error) {
        logger.error('[initDatabase] 数据库初始化失败:', error);
        db = null;
        throw error;
      } finally {
        isInitializing = false;
        initPromise = null;
      }
    })();

    // 等待初始化完成
    await initPromise;
  } catch (error) {
    logger.error('[initDatabase] 数据库初始化异常:', error);
    isInitializing = false;
    throw error;
  }
};

// 执行数据库初始化的核心逻辑（提取为独立函数，便于 Promise 管理）
const performDatabaseInitialization = async (): Promise<void> => {
  logger.log('[performDatabaseInitialization] 开始执行初始化逻辑');

  // 如果已经初始化，先关闭旧连接
  if (db) {
    try {
      await db.closeAsync();
      logger.log('[initDatabase] 关闭旧数据库连接');
    } catch (error) {
      logger.warn('[initDatabase] 关闭旧数据库连接失败:', error);
    }
    db = null;
  }

  // 打开数据库（如果不存在会自动创建）
  logger.log('[performDatabaseInitialization] 准备调用 openDatabaseAsync...');
  db = await SQLite.openDatabaseAsync('warehouse.db');
  logger.log(
    '[performDatabaseInitialization] openDatabaseAsync 完成，db对象:',
    db ? '已创建' : 'null'
  );

  // 先创建 system_config 表（用于版本管理和安装ID）
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 检查安装 ID（存储在数据库中，避免 AsyncStorage 被清理导致数据丢失）
  const installIdResult = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM system_config WHERE key = ?',
    [INSTALL_ID_DB_KEY]
  );

  if (!installIdResult) {
    // 首次运行，生成并保存安装 ID
    const newInstallId = `${INSTALL_ID_PREFIX}${Date.now()}`;
    await db.runAsync('INSERT INTO system_config (key, value) VALUES (?, ?)', [
      INSTALL_ID_DB_KEY,
      newInstallId,
    ]);
    logger.log('[initDatabase] 首次运行，生成安装 ID:', newInstallId);
  } else {
    logger.log('[initDatabase] 检测到现有安装，installId:', installIdResult.value);
  }

  // 检查数据库版本
  const versionResult = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM system_config WHERE key = ?',
    ['db_version']
  );
  const currentVersion = versionResult ? parseInt(versionResult.value, 10) : 0;
  const targetDbVersion = currentVersion > DB_VERSION ? currentVersion : DB_VERSION;

  logger.log('[DB Version] 当前数据库版本:', currentVersion, '期望版本:', DB_VERSION);

  // 版本不一致时只做非破坏性迁移，绝不因版本号变化直接删库。
  if (currentVersion > DB_VERSION) {
    logger.warn('[DB Version] 检测到更高版本数据库，保留现有数据并继续初始化');
  } else if (currentVersion > 0 && currentVersion < DB_VERSION) {
    logger.log('[DB Version] 检测到旧版本数据库，将尝试执行非破坏性迁移...');
  }

  // 创建所有表
  await db.execAsync(`
      -- 性能优化配置
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      -- 保持 mmap 在低端/32 位设备也更稳，避免超大映射导致初始化失败
      PRAGMA mmap_size = 268435456;
      PRAGMA page_size = 4096;
      PRAGMA foreign_keys = ON;

      -- 订单表
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        order_no TEXT NOT NULL,
        customer_name TEXT,
        warehouse_id TEXT,
        warehouse_name TEXT,
        created_at TEXT NOT NULL
      );

      -- 物料表
      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        order_no TEXT DEFAULT '',
        customer_name TEXT,
        operation_type TEXT NOT NULL DEFAULT 'inbound',
        model TEXT NOT NULL,
        batch TEXT DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        package TEXT DEFAULT '',
        version TEXT DEFAULT '',
        productionDate TEXT DEFAULT '',
        traceNo TEXT DEFAULT '',
        sourceNo TEXT DEFAULT '',
        scanned_at TEXT NOT NULL,
        raw_content TEXT,
        customFields TEXT,
        isUnpacked INTEGER DEFAULT 0,
        original_quantity TEXT,
        remaining_quantity TEXT,
        warehouse_id TEXT,
        warehouse_name TEXT,
        inventory_code TEXT,
        rule_id INTEGER,
        rule_name TEXT
      );

      -- 拆包记录表
      CREATE TABLE IF NOT EXISTS unpack_records (
        id TEXT PRIMARY KEY,
        original_material_id TEXT NOT NULL,
        order_no TEXT NOT NULL,
        customer_name TEXT,
        model TEXT NOT NULL,
        batch TEXT,
        package TEXT,
        version TEXT,
        warehouse_id TEXT,
        warehouse_name TEXT,
        inventory_code TEXT,
        original_quantity TEXT NOT NULL,
        new_quantity TEXT NOT NULL,
        productionDate TEXT,
        traceNo TEXT,
        new_traceNo TEXT,
        sourceNo TEXT,
        label_type TEXT,
        pair_id TEXT NOT NULL,
        status TEXT,
        notes TEXT,
        unpacked_at TEXT NOT NULL,
        printed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 打印历史表
      CREATE TABLE IF NOT EXISTS print_history (
        id TEXT PRIMARY KEY,
        unpack_record_ids TEXT NOT NULL,
        export_format TEXT NOT NULL,
        export_file_path TEXT,
        printed_at TEXT NOT NULL,
        print_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      -- 二维码规则表
      CREATE TABLE IF NOT EXISTS qr_code_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        separator TEXT NOT NULL,
        field_order TEXT NOT NULL,
        custom_field_ids TEXT,
        is_active INTEGER DEFAULT 1,
        supplier_name TEXT,
        match_conditions TEXT,
        field_prefixes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 自定义字段表
      CREATE TABLE IF NOT EXISTS custom_fields (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        required INTEGER DEFAULT 0,
        options TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- 仓库表
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_default INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      -- 物料管理表（存货编码绑定）
      CREATE TABLE IF NOT EXISTS inventory_bindings (
        id TEXT PRIMARY KEY,
        scan_model TEXT NOT NULL UNIQUE,
        inventory_code TEXT NOT NULL UNIQUE,
        supplier TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      );

      -- 入库记录表
      CREATE TABLE IF NOT EXISTS inbound_records (
        id TEXT PRIMARY KEY,
        inbound_no TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT NOT NULL,
        inventory_code TEXT,
        scan_model TEXT NOT NULL,
        batch TEXT,
        quantity INTEGER NOT NULL,
        in_date TEXT NOT NULL,
        notes TEXT,
        raw_content TEXT,
        created_at TEXT NOT NULL,
        package TEXT,
        version TEXT,
        productionDate TEXT,
        traceNo TEXT,
        sourceNo TEXT,
        customFields TEXT,
        sync_status TEXT DEFAULT 'pending',
        sync_file_name TEXT,
        synced_at TEXT,
        sync_message TEXT
      );

      -- 入库汇总表（按型号+版本号+入库日期每日汇总）
      CREATE TABLE IF NOT EXISTS inbound_summary (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT NOT NULL,
        inventory_code TEXT,
        scan_model TEXT NOT NULL,
        version TEXT,
        in_date TEXT NOT NULL,
        total_quantity INTEGER NOT NULL,
        sourceNo TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(warehouse_id, scan_model, version, in_date)
      );

      -- 盘点记录表
      CREATE TABLE IF NOT EXISTS inventory_check_records (
        id TEXT PRIMARY KEY,
        check_no TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        warehouse_name TEXT NOT NULL,
        inventory_code TEXT,
        scan_model TEXT NOT NULL,
        batch TEXT,
        quantity INTEGER,
        check_type TEXT NOT NULL,
        actual_quantity INTEGER,
        check_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        package TEXT,
        version TEXT,
        productionDate TEXT,
        traceNo TEXT,
        sourceNo TEXT,
        customFields TEXT,
        sync_status TEXT DEFAULT 'pending',
        sync_file_name TEXT,
        synced_at TEXT,
        sync_message TEXT
      );
    `);

  await migrateInboundAndInventoryRecordTables(db);
  await migrateOrdersTableWarehouseScope(db);
  await ensureDocumentSyncColumns(db);
  await ensureRuleFieldPrefixesColumn(db);
  await ensureWarehouseSortOrderColumn(db);
  if (currentVersion < 3) {
    await normalizeLegacyDateTimeColumns(db);
  }
  await repairLegacyUnpackedMaterials(db);
  await ensureTraceNoUniqueIndexes(db);
  await ensureDeletionArchiveTablesAndTriggers(db);

  await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_orders_warehouse_created
      ON orders (warehouse_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_orders_warehouse_order_no
      ON orders (warehouse_id, order_no DESC);

      CREATE INDEX IF NOT EXISTS idx_materials_order_warehouse
      ON materials (order_no, warehouse_id);

      CREATE INDEX IF NOT EXISTS idx_materials_trace_warehouse
      ON materials (traceNo, warehouse_id);

      CREATE INDEX IF NOT EXISTS idx_materials_batch_warehouse
      ON materials (batch, warehouse_id);

      CREATE INDEX IF NOT EXISTS idx_materials_model_warehouse
      ON materials (model, warehouse_id);

      CREATE INDEX IF NOT EXISTS idx_materials_operation_warehouse_scanned
      ON materials (operation_type, warehouse_id, scanned_at DESC);

      CREATE INDEX IF NOT EXISTS idx_unpack_records_order_warehouse
      ON unpack_records (order_no, warehouse_id);

      CREATE INDEX IF NOT EXISTS idx_unpack_records_original_material
      ON unpack_records (original_material_id);

      CREATE INDEX IF NOT EXISTS idx_inbound_records_no
      ON inbound_records (inbound_no);

      CREATE INDEX IF NOT EXISTS idx_inbound_records_warehouse_created
      ON inbound_records (warehouse_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_inventory_check_records_no
      ON inventory_check_records (check_no);

      CREATE INDEX IF NOT EXISTS idx_inventory_check_records_warehouse_created
      ON inventory_check_records (warehouse_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_inbound_summary_warehouse_date
      ON inbound_summary (warehouse_id, in_date DESC);

      CREATE INDEX IF NOT EXISTS idx_warehouses_sort
      ON warehouses (sort_order ASC, created_at DESC);
    `);

  // 初始化默认数据
  const isoDateTime = getISODateTime();

  // 检查是否已有默认规则
  const defaultRule = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM qr_code_rules WHERE id = ?',
    ['default_jihai']
  );

  if (!defaultRule) {
    await db.runAsync(
      `INSERT INTO qr_code_rules (id, name, description, separator, field_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'default_jihai',
        '极海半导体',
        '型号/批次/封装/版本号/数量/生产日期年周/追踪码/箱号',
        '/',
        JSON.stringify([
          'model',
          'batch',
          'package',
          'version',
          'quantity',
          'productionDate',
          'traceNo',
          'sourceNo',
        ]),
        1,
        isoDateTime,
        isoDateTime,
      ]
    );
    logger.log('创建默认二维码规则');
  }

  // 设置数据库版本号
  await db.runAsync('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', [
    'db_version',
    targetDbVersion.toString(),
  ]);
  logger.log('[initDatabase] 数据库版本已设置为:', targetDbVersion);

  logger.log('[initDatabase] SQLite 数据库初始化成功');
};

// 强制重新初始化数据库（用于清除数据后）
export const reinitializeDatabase = async (): Promise<void> => {
  try {
    logger.log('[reinitializeDatabase] 强制重新初始化数据库...');

    // 关闭现有连接
    if (db) {
      try {
        await db.closeAsync();
        logger.log('[reinitializeDatabase] 关闭旧数据库连接');
      } catch (error) {
        logger.warn('[reinitializeDatabase] 关闭旧数据库连接失败:', error);
      }
      db = null;
    }

    // 重置初始化状态
    isInitializing = false;
    initPromise = null;

    // 重新初始化
    await initDatabase();
    logger.log('[reinitializeDatabase] 数据库重新初始化成功');
  } catch (error) {
    logger.error('[reinitializeDatabase] 数据库重新初始化失败:', error);
    throw error;
  }
};

// ========== 订单相关函数 ==========

const upsertOrderWithDatabase = async (
  database: SQLite.SQLiteDatabase,
  orderNo: string,
  customerName?: string,
  warehouse?: OrderWarehouseInfo
): Promise<void> => {
  type ExistingOrderRow = {
    id: string;
    customer_name: string;
    warehouse_id: string | null;
    warehouse_name: string | null;
  };

  let existingOrder: ExistingOrderRow | null = null;

  if (warehouse) {
    existingOrder = await database.getFirstAsync<ExistingOrderRow>(
      `SELECT id, customer_name, warehouse_id, warehouse_name
       FROM orders
       WHERE order_no = ?
         AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')
       ORDER BY CASE WHEN warehouse_id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      [orderNo, warehouse.id, warehouse.id]
    );

  } else {
    existingOrder = await database.getFirstAsync<ExistingOrderRow>(
      'SELECT id, customer_name, warehouse_id, warehouse_name FROM orders WHERE order_no = ? LIMIT 1',
      [orderNo]
    );
  }

  if (existingOrder) {
    // 更新现有订单
    const updates: string[] = [];
    const params: any[] = [];

    if (customerName !== undefined) {
      updates.push('customer_name = ?');
      params.push(customerName);
    }
    if (warehouse) {
      updates.push('warehouse_id = ?');
      updates.push('warehouse_name = ?');
      params.push(warehouse.id);
      params.push(warehouse.name);
    }

    if (updates.length > 0) {
      params.push(existingOrder.id);

      await database.runAsync(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);

      // 如果更新了客户名称或仓库信息，同步更新物料
      const materialUpdates: string[] = [];
      const materialParams: any[] = [];

      if (customerName !== undefined) {
        materialUpdates.push('customer_name = ?');
        materialParams.push(customerName);
      }
      if (warehouse) {
        materialUpdates.push('warehouse_id = ?');
        materialUpdates.push('warehouse_name = ?');
        materialParams.push(warehouse.id);
        materialParams.push(warehouse.name);
      }

      if (materialUpdates.length > 0) {
        const scopeParams: any[] = [orderNo];
        let scopeSql = 'order_no = ?';

        if (existingOrder.warehouse_id) {
          scopeSql += ' AND warehouse_id = ?';
          scopeParams.push(existingOrder.warehouse_id);
        } else if (warehouse) {
          scopeSql += ' AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = \'\')';
          scopeParams.push(warehouse.id);
        }

        await database.runAsync(
          `UPDATE materials SET ${materialUpdates.join(', ')} WHERE ${scopeSql}`,
          [...materialParams, ...scopeParams]
        );

        // 同步更新拆包记录
        await database.runAsync(
          `UPDATE unpack_records SET ${materialUpdates.join(', ')} WHERE ${scopeSql}`,
          [...materialParams, ...scopeParams]
        );
      }
    }
    return;
  }

  // 创建新订单
  const newOrder: Order = {
    id: generateId(),
    order_no: orderNo,
    customer_name: customerName || '',
    created_at: getISODateTime(),
    warehouse_id: warehouse?.id || undefined,
    warehouse_name: warehouse?.name || undefined,
  };

  await database.runAsync(
    'INSERT INTO orders (id, order_no, customer_name, created_at, warehouse_id, warehouse_name) VALUES (?, ?, ?, ?, ?, ?)',
    [
      newOrder.id,
      newOrder.order_no,
      newOrder.customer_name,
      newOrder.created_at,
      newOrder.warehouse_id || null,
      newOrder.warehouse_name || null,
    ]
  );
};

// 添加或更新订单
export const upsertOrder = async (
  orderNo: string,
  customerName?: string,
  warehouse?: OrderWarehouseInfo
): Promise<void> => {
  try {
    // 🔥 强制初始化保护
    if (!db) {
      logger.warn('[upsertOrder] 数据库未初始化，等待初始化...');
      await initDatabase();
      logger.log('[upsertOrder] 数据库初始化完成');
    }

    const database = getDb();
    await upsertOrderWithDatabase(database, orderNo, customerName, warehouse);
  } catch (error) {
    logger.error('保存订单失败:', error);
    throw error;
  }
};

// 获取订单信息
export const getOrder = async (orderNo: string, warehouseId?: string): Promise<Order | null> => {
  try {
    // 参数验证
    if (!orderNo || typeof orderNo !== 'string' || orderNo.trim() === '') {
      logger.warn('[getOrder] 无效的 orderNo:', orderNo);
      return null;
    }

    const database = getDb();
    const trimmedOrderNo = orderNo.trim();
    const trimmedWarehouseId =
      typeof warehouseId === 'string' && warehouseId.trim() !== '' ? warehouseId.trim() : '';

    const result = trimmedWarehouseId
      ? await database.getFirstAsync<Order>(
          `SELECT * FROM orders
           WHERE order_no = ?
             AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')
           ORDER BY CASE WHEN warehouse_id = ? THEN 0 ELSE 1 END
           LIMIT 1`,
          [trimmedOrderNo, trimmedWarehouseId, trimmedWarehouseId]
        )
      : await database.getFirstAsync<Order>('SELECT * FROM orders WHERE order_no = ?', [
          trimmedOrderNo,
        ]);
    return result || null;
  } catch (error) {
    logger.error('[getOrder] 获取订单失败:', error);
    return null;
  }
};

// 获取所有订单
export const getAllOrders = async (): Promise<Order[]> => {
  try {
    const database = getDb();
    const orders = await database.getAllAsync<Order>('SELECT * FROM orders');
    return sortOrdersByOrderNo(orders);
  } catch (error) {
    logger.error('获取订单列表失败:', error);
    return [];
  }
};

export type OrderTimeFilter = 'today' | 'all';
export type OrderSearchType = 'order' | 'customer' | 'batch';

const toDateKeys = (date: Date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());

  return {
    local: `${year}/${month}/${day}`,
    legacyLocal: `${year}/${Number(month)}/${Number(day)}`,
    order: `${year}-${month}-${day}`,
  };
};

const getDateKeysForFilter = (
  filter: OrderTimeFilter
): Array<{ local: string; legacyLocal: string; order: string }> => {
  if (filter === 'all') return [];

  return [toDateKeys(new Date())];
};

const getCreatedAtDatePrefixesForFilter = (filter: OrderTimeFilter): string[] => {
  return [
    ...new Set(
      getDateKeysForFilter(filter).flatMap((item) => [
        item.local,
        item.legacyLocal,
        item.order,
      ])
    ),
  ];
};

const ORDER_NO_SORT_PATTERN = /^IO-(\d{4})-(\d{2})-(\d{2})-(\d+)$/i;

const getOrderNoSortMeta = (orderNo?: string | null) => {
  const normalizedOrderNo = (orderNo || '').trim().toUpperCase();
  const match = normalizedOrderNo.match(ORDER_NO_SORT_PATTERN);

  if (!match) {
    return {
      dateKey: '',
      sequence: -1,
      normalizedOrderNo,
    };
  }

  return {
    dateKey: `${match[1]}-${match[2]}-${match[3]}`,
    sequence: Number.parseInt(match[4] || '0', 10) || 0,
    normalizedOrderNo,
  };
};

const compareOrdersByOrderNo = (
  a: Pick<Order, 'order_no' | 'created_at'>,
  b: Pick<Order, 'order_no' | 'created_at'>
) => {
  const orderMetaA = getOrderNoSortMeta(a.order_no);
  const orderMetaB = getOrderNoSortMeta(b.order_no);

  if (!orderMetaA.dateKey && !orderMetaB.dateKey) {
    const createdDiff =
      parseStoredDateTimeToMillis(b.created_at) - parseStoredDateTimeToMillis(a.created_at);
    if (createdDiff !== 0) {
      return createdDiff;
    }
  }

  const dateDiff = orderMetaB.dateKey.localeCompare(orderMetaA.dateKey);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const sequenceDiff = orderMetaB.sequence - orderMetaA.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }

  const orderNoDiff = orderMetaB.normalizedOrderNo.localeCompare(orderMetaA.normalizedOrderNo, undefined, {
    numeric: true,
  });
  if (orderNoDiff !== 0) {
    return orderNoDiff;
  }

  return parseStoredDateTimeToMillis(b.created_at) - parseStoredDateTimeToMillis(a.created_at);
};

const sortOrdersByOrderNo = <T extends Pick<Order, 'order_no' | 'created_at'>>(orders: T[]): T[] =>
  [...orders].sort(compareOrdersByOrderNo);

const appendCreatedAtDateWhere = (
  conditions: string[],
  params: any[],
  filter: OrderTimeFilter
) => {
  const createdAtPrefixes = getCreatedAtDatePrefixesForFilter(filter);
  if (createdAtPrefixes.length === 0) {
    return;
  }

  conditions.push(`(${createdAtPrefixes.map(() => `created_at LIKE ?`).join(' OR ')})`);
  createdAtPrefixes.forEach((prefix) => params.push(`${prefix}%`));
};

const matchesCreatedAtDateFilter = (createdAt: string | undefined, filter: OrderTimeFilter): boolean => {
  const prefixes = getCreatedAtDatePrefixesForFilter(filter);
  if (prefixes.length === 0) {
    return true;
  }

  const normalizedCreatedAt = (createdAt || '').trim();
  return prefixes.some((prefix) => normalizedCreatedAt.startsWith(prefix));
};

const filterOrdersInMemory = (
  orders: Order[],
  params: {
    searchText?: string;
    searchType?: OrderSearchType;
    warehouseId?: string;
    timeFilter?: OrderTimeFilter;
    batchOrderNos?: Set<string>;
  }
) => {
  const searchText = params.searchText?.trim().toLowerCase() || '';
  const timeFilter = params.timeFilter || 'all';

  return orders
    .filter((order) => !params.warehouseId || order.warehouse_id === params.warehouseId)
    .filter((order) => matchesCreatedAtDateFilter(order.created_at, timeFilter))
    .filter((order) => {
      if (!searchText) return true;
      if (params.searchType === 'customer') {
        return (order.customer_name || '').toLowerCase().includes(searchText);
      }
      if (params.searchType === 'batch') {
        return params.batchOrderNos?.has(order.order_no) ?? false;
      }
      return order.order_no.toLowerCase().includes(searchText);
    })
    .sort(compareOrdersByOrderNo);
};

export const getFilteredOrders = async (params: {
  searchText?: string;
  searchType?: OrderSearchType;
  warehouseId?: string;
  timeFilter?: OrderTimeFilter;
}): Promise<Order[]> => {
  try {
    const searchText = params.searchText?.trim() || '';
    const searchType = params.searchType || 'order';
    const timeFilter = params.timeFilter || 'all';

    if (isWebPlatform) {
      const allOrders = await getAllOrders();
      let batchOrderNos: Set<string> | undefined;

      if (searchText && searchType === 'batch') {
        const materials = await getAllMaterials(params.warehouseId);
        batchOrderNos = new Set(
          materials
            .filter((material) =>
              (material.batch || '').toLowerCase().includes(searchText.toLowerCase())
            )
            .map((material) => material.order_no)
        );
      }

      return filterOrdersInMemory(allOrders, {
        searchText,
        searchType,
        warehouseId: params.warehouseId,
        timeFilter,
        batchOrderNos,
      });
    }

    const database = getDb();
    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (params.warehouseId) {
      conditions.push('warehouse_id = ?');
      queryParams.push(params.warehouseId);
    }

    appendCreatedAtDateWhere(conditions, queryParams, timeFilter);

    if (searchText) {
      if (searchType === 'customer') {
        conditions.push('customer_name LIKE ?');
        queryParams.push(`%${searchText}%`);
      } else if (searchType === 'batch') {
        const materialConditions = ['batch LIKE ?'];
        const materialParams: any[] = [`%${searchText}%`];

        if (params.warehouseId) {
          materialConditions.push('warehouse_id = ?');
          materialParams.push(params.warehouseId);
        }

        conditions.push(
          `order_no IN (SELECT DISTINCT order_no FROM materials WHERE ${materialConditions.join(' AND ')})`
        );
        queryParams.push(...materialParams);
      } else {
        conditions.push('order_no LIKE ?');
        queryParams.push(`%${searchText}%`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orders = await database.getAllAsync<Order>(`SELECT * FROM orders ${whereClause}`, queryParams);
    return sortOrdersByOrderNo(orders);
  } catch (error) {
    logger.error('[getFilteredOrders] 查询订单失败:', error);
    return [];
  }
};

// 删除订单及其所有物料记录
export const deleteOrder = async (orderNo: string, warehouseId?: string | null): Promise<void> => {
  try {
    if (!orderNo || typeof orderNo !== 'string' || orderNo.trim() === '') {
      logger.warn('[deleteOrder] 无效的 orderNo:', orderNo);
      return;
    }

    const database = getDb();
    const trimmedOrderNo = orderNo.trim();
    const normalizedWarehouseId =
      warehouseId && typeof warehouseId === 'string' && warehouseId.trim() !== ''
        ? warehouseId.trim()
        : null;
    const warehouseClause = normalizedWarehouseId
      ? ' AND warehouse_id = ?'
      : " AND (warehouse_id IS NULL OR warehouse_id = '')";
    const params = normalizedWarehouseId ? [trimmedOrderNo, normalizedWarehouseId] : [trimmedOrderNo];

    await database.execAsync('BEGIN TRANSACTION');

    try {
      // 删除关联的拆包记录，避免留下孤儿数据
      await database.runAsync(`DELETE FROM unpack_records WHERE order_no = ?${warehouseClause}`, params);

      // 删除关联的物料记录
      await database.runAsync(`DELETE FROM materials WHERE order_no = ?${warehouseClause}`, params);

      // 最后删除订单
      await database.runAsync(`DELETE FROM orders WHERE order_no = ?${warehouseClause}`, params);

      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  } catch (error) {
    logger.error('删除订单失败:', error);
    throw error;
  }
};

// ========== 物料相关函数 ==========

// 🔥 新增：批量添加物料（使用事务，速度提升 10 倍）
export const addMaterialsBatch = async (
  materials: Array<{
    order_no: string;
    customer_name?: string;
    operation_type?: string;
    model: string;
    batch?: string;
    quantity?: number | string;
    package?: string;
    version?: string;
    productionDate?: string;
    traceNo?: string;
    sourceNo?: string;
    scanned_at?: string;
    raw_content: string;
    separator?: string;
    rule_id?: string;
    rule_name?: string;
    customFields?: Record<string, string>;
    warehouse_id?: string;
    warehouse_name?: string;
    inventory_code?: string;
  }>
): Promise<string[]> => {
  try {
    // 🔥 强制初始化保护
    if (!db) {
      logger.warn('[addMaterialsBatch] 数据库未初始化，等待初始化...');
      await initDatabase();
      logger.log('[addMaterialsBatch] 数据库初始化完成');
    }

    const database = getDb();
    logger.log('[addMaterialsBatch] 开始批量添加，数量:', materials.length);

    // 🔥 使用事务，速度提升 10 倍
    await database.execAsync('BEGIN TRANSACTION');

    const materialIds: string[] = [];

    for (const material of materials) {
      // 参数验证
      if (!material.order_no || typeof material.order_no !== 'string') {
        throw new Error('无效的 order_no');
      }
      if (!material.model || typeof material.model !== 'string') {
        throw new Error('无效的 model');
      }
      if (!material.raw_content || typeof material.raw_content !== 'string') {
        throw new Error('无效的 raw_content');
      }

      const newMaterialId = generateId();

      await database.runAsync(
        `INSERT INTO materials (
          id, order_no, customer_name, operation_type, model, batch, quantity,
          package, version, productionDate, traceNo, sourceNo, scanned_at, raw_content,
          customFields, isUnpacked, original_quantity, remaining_quantity,
          warehouse_id, warehouse_name, inventory_code, rule_id, rule_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newMaterialId,
          material.order_no || '',
          material.customer_name || '',
          material.operation_type || 'inbound',
          material.model || '',
          material.batch || '',
          parseQuantity(material.quantity, { min: 0 }) ?? 0,
          material.package || '',
          material.version || '',
          material.productionDate || '',
          material.traceNo || '',
          material.sourceNo || '',
          material.scanned_at || getISODateTime(),
          material.raw_content,
          material.customFields ? jsonToString(material.customFields) : null,
          0,
          null,
          null,
          material.warehouse_id || null,
          material.warehouse_name || null,
          material.inventory_code || null,
          material.rule_id || null,
          material.rule_name || null,
        ]
      );

      materialIds.push(newMaterialId);
    }

    // 🔥 提交事务
    await database.execAsync('COMMIT');

    logger.log('[addMaterialsBatch] 批量添加完成，成功:', materialIds.length);
    return materialIds;
  } catch (error) {
    logger.error('[addMaterialsBatch] 批量添加失败，执行回滚:', error);
    // 🔥 回滚事务
    try {
      if (db) {
        await db.execAsync('ROLLBACK');
      }
    } catch (rollbackError) {
      logger.error('[addMaterialsBatch] 回滚失败:', rollbackError);
    }
    throw error;
  }
};

export type MaterialWritePayload = {
  order_no: string;
  customer_name: string;
  operation_type?: 'inbound' | 'outbound' | 'inventory';
  model: string;
  batch: string;
  quantity: number;
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  scanned_at?: string;
  raw_content: string;
  separator?: string; // 扫码时使用的分隔符
  rule_id?: string;
  rule_name?: string;
  customFields?: Record<string, string>;
  isUnpacked?: boolean;
  original_quantity?: string;
  remaining_quantity?: string;
  // V3.0 新增字段
  warehouse_id?: string;
  warehouse_name?: string;
  inventory_code?: string;
};

const insertMaterialWithDatabase = async (
  database: SQLite.SQLiteDatabase,
  material: MaterialWritePayload
): Promise<string> => {
  // 参数验证
  if (!material.order_no || typeof material.order_no !== 'string') {
    throw new Error('无效的 order_no');
  }
  // 🔥 临时修复：允许 model 为空，仅做类型检查
  if (typeof material.model !== 'string') {
    throw new Error('无效的 model');
  }
  if (!material.raw_content || typeof material.raw_content !== 'string') {
    throw new Error('无效的 raw_content');
  }

  const operationType = material.operation_type || 'inbound';
  if (operationType === 'outbound') {
    if (material.model.trim() === '') {
      throw new Error('出库物料型号为空，拒绝保存');
    }
    if (!material.warehouse_id || material.warehouse_id.trim() === '') {
      throw new Error('出库物料缺少仓库ID，拒绝保存');
    }
  }

  const newMaterialId = generateId();

  await database.runAsync(
    `INSERT INTO materials (
      id, order_no, customer_name, operation_type, model, batch, quantity,
      package, version, productionDate, traceNo, sourceNo, scanned_at, raw_content,
      customFields, isUnpacked, original_quantity, remaining_quantity,
      warehouse_id, warehouse_name, inventory_code, rule_id, rule_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newMaterialId,
      material.order_no || '',
      material.customer_name || '',
      operationType,
      material.model || '',
      material.batch || '',
      parseQuantity(material.quantity, { min: 0 }) ?? 0,
      material.package || '',
      material.version || '',
      material.productionDate || '',
      material.traceNo || '',
      material.sourceNo || '',
      material.scanned_at || getISODateTime(),
      material.raw_content,
      material.customFields ? jsonToString(material.customFields) : null,
      material.isUnpacked ? 1 : 0,
      material.original_quantity || null,
      material.remaining_quantity || null,
      material.warehouse_id || null,
      material.warehouse_name || null,
      material.inventory_code || null,
      material.rule_id || null,
      material.rule_name || null,
    ]
  );

  const inserted = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM materials WHERE id = ?',
    [newMaterialId]
  );
  if (!inserted) {
    throw new Error('物料写入后校验失败');
  }

  return newMaterialId;
};

// 添加物料记录（完整版）
export const addMaterial = async (material: MaterialWritePayload): Promise<string> => {
  try {
    // 🔍 测试：打印 db 状态
    logger.log('[addMaterial] db状态', db ? '已初始化' : 'null');
    logger.log('[addMaterial] 全局isInitializing', isInitializing);

    // 🔥 强制初始化保护：如果 db 为 null，等待初始化完成
    if (!db) {
      logger.warn('[addMaterial] 数据库未初始化，等待初始化...');
      await initDatabase();
      logger.log('[addMaterial] 数据库初始化完成');
    }

    const database = getDb();
    logger.log('[addMaterial] 获取数据库连接成功');
    return await insertMaterialWithDatabase(database, material);
  } catch (error) {
    logger.error('[addMaterial] 添加物料记录失败:', error);
    throw error;
  }
};

export const addMaterialWithOrder = async (
  material: MaterialWritePayload,
  customerName?: string,
  warehouse?: OrderWarehouseInfo
): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[addMaterialWithOrder] 数据库未初始化，等待初始化...');
      await initDatabase();
      logger.log('[addMaterialWithOrder] 数据库初始化完成');
    }

    const database = getDb();
    await database.execAsync('BEGIN TRANSACTION');

    try {
      await upsertOrderWithDatabase(database, material.order_no, customerName, warehouse);
      const materialId = await insertMaterialWithDatabase(database, material);
      await database.execAsync('COMMIT');
      return materialId;
    } catch (error) {
      await rollbackTransaction(database, 'addMaterialWithOrder');
      throw error;
    }
  } catch (error) {
    logger.error('[addMaterialWithOrder] 保存出库物料失败:', error);
    throw error;
  }
};

// 获取物料记录
export const getMaterial = async (id: string): Promise<MaterialRecord | null> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[getMaterial] 无效的 id:', id);
      return null;
    }

    const database = getDb();
    const result = await database.getFirstAsync<any>('SELECT * FROM materials WHERE id = ?', [
      id.trim(),
    ]);

    if (!result) return null;

    // 转换 customFields
    return {
      ...result,
      customFields: stringToJson<Record<string, string>>(result.customFields),
      isUnpacked: result.isUnpacked === 1,
    };
  } catch (error) {
    logger.error('[getMaterial] 获取物料记录失败:', error);
    return null;
  }
};

// 获取订单下的所有物料记录
export const getMaterialsByOrder = async (
  orderNo: string,
  warehouseId?: string
): Promise<MaterialRecord[]> => {
  try {
    // 参数验证
    if (!orderNo || typeof orderNo !== 'string' || orderNo.trim() === '') {
      logger.warn('[getMaterialsByOrder] 无效的 orderNo:', orderNo);
      return [];
    }

    const database = getDb();
    let sql = `SELECT
      m.*,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM materials m
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(m.model)
    WHERE m.order_no = ?`;
    const params: any[] = [orderNo.trim()];

    if (warehouseId && typeof warehouseId === 'string' && warehouseId.trim() !== '') {
      sql += ' AND m.warehouse_id = ?';
      params.push(warehouseId.trim());
    }

    sql += ' ORDER BY m.scanned_at DESC, m.id DESC';

    const results = await database.getAllAsync<any>(sql, params);

    return results.map((r) => ({
      ...r,
      customFields: stringToJson<Record<string, string>>(r.customFields),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('[getMaterialsByOrder] 获取订单物料失败:', error);
    return [];
  }
};

// 检查物料是否已存在
export const checkMaterialExists = async (
  orderNo: string,
  model: string,
  batch: string,
  sourceNo?: string,
  traceNo?: string,
  _quantity?: string,
  warehouseId?: string
): Promise<{ material: MaterialRecord | null; isUnpacked: boolean; canRescan: boolean }> => {
  try {
    const database = getDb();

    // 参数验证
    if (!orderNo || typeof orderNo !== 'string' || orderNo.trim() === '') {
      logger.error('[checkMaterialExists] 无效的 orderNo:', orderNo);
      return { material: null, isUnpacked: false, canRescan: false };
    }

    const trimmedOrderNo = orderNo.trim();
    const duplicateIdentifier =
      traceNo && typeof traceNo === 'string' && traceNo.trim() !== ''
        ? {
            field: 'traceNo' as const,
            value: traceNo.trim(),
            label: 'traceNo',
          }
          : null;

    if (!duplicateIdentifier) {
      return { material: null, isUnpacked: false, canRescan: false };
    }

    if (!isMaterialDuplicateIdentifierField(duplicateIdentifier.field)) {
      throw new Error(`非法的重复校验字段: ${duplicateIdentifier.field}`);
    }

    const mapMaterialRecord = (record: any): MaterialRecord => ({
      ...record,
      customFields: stringToJson<Record<string, string>>(record.customFields),
      isUnpacked: record.isUnpacked === 1,
    });

    const trimmedWarehouseId =
      warehouseId && typeof warehouseId === 'string' && warehouseId.trim() !== ''
        ? warehouseId.trim()
        : null;

    let sql = `SELECT * FROM materials WHERE order_no = ? AND ${duplicateIdentifier.field} = ?`;
    const sqlParams: any[] = [trimmedOrderNo, duplicateIdentifier.value];
    if (trimmedWarehouseId) {
      sql += " AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')";
      sqlParams.push(trimmedWarehouseId);
    }

    logger.log(
      `[checkMaterialExists] SameOrder ${duplicateIdentifier.label} SQL:`,
      sql,
      'Params:',
      sqlParams
    );

    const existingInSameOrder = await database.getFirstAsync<any>(sql, sqlParams);

    if (existingInSameOrder) {
      const material = mapMaterialRecord(existingInSameOrder);

      return { material, isUnpacked: !!material.isUnpacked, canRescan: false };
    }

    let otherOrderSql = `SELECT * FROM materials WHERE order_no != ? AND ${duplicateIdentifier.field} = ?`;
    const otherOrderParams: any[] = [trimmedOrderNo, duplicateIdentifier.value];
    if (trimmedWarehouseId) {
      otherOrderSql += " AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')";
      otherOrderParams.push(trimmedWarehouseId);
    }

    logger.log(
      `[checkMaterialExists] OtherOrder ${duplicateIdentifier.label} SQL:`,
      otherOrderSql,
      'Params:',
      otherOrderParams
    );

    const existingInOtherOrder = await database.getFirstAsync<any>(otherOrderSql, otherOrderParams);

    if (existingInOtherOrder) {
      const material = mapMaterialRecord(existingInOtherOrder);
      const canUseRemainingTraceNo = await canUseRemainingUnpackTraceNo(
        database,
        duplicateIdentifier.value,
        trimmedOrderNo,
        warehouseId
      );
      return {
        material,
        isUnpacked: !!material.isUnpacked,
        canRescan: canUseRemainingTraceNo,
      };
    }

    return { material: null, isUnpacked: false, canRescan: false };
  } catch (error) {
    logger.error('[checkMaterialExists] 检查物料重复失败:', error);
    throw new Error('追溯码重复校验失败，请重试');
  }
};

// 检查是否存在任意物料记录（用于轻量级业务数据判断）
export const hasAnyMaterials = async (): Promise<boolean> => {
  try {
    const database = getDb();
    const result = await database.getFirstAsync<{ exists: number }>(
      'SELECT 1 as exists FROM materials LIMIT 1'
    );
    return result?.exists === 1;
  } catch (error) {
    logger.error('[hasAnyMaterials] 检查物料数据是否存在失败:', error);
    return false;
  }
};

// 获取所有物料记录
export const getAllMaterials = async (warehouseId?: string): Promise<MaterialRecord[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      m.*,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM materials m
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(m.model)`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE m.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY m.scanned_at DESC';

    const results = await database.getAllAsync<any>(sql, params);

    return results.map((r) => ({
      ...r,
      customFields: stringToJson<Record<string, string>>(r.customFields),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('获取物料列表失败:', error);
    return [];
  }
};

export const getOutboundExportRows = async (warehouseId?: string): Promise<OutboundExportRow[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      COALESCE(m.order_no, '') AS order_no,
      COALESCE(m.customer_name, '') AS customer_name,
      COALESCE(m.warehouse_name, '') AS warehouse_name,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code, '') AS inventory_code,
      COALESCE(m.model, '') AS model,
      COALESCE(m.batch, '') AS batch,
      COALESCE(m.quantity, 0) AS quantity,
      COALESCE(m.package, '') AS package,
      COALESCE(m.version, '') AS version,
      COALESCE(m.productionDate, '') AS productionDate,
      COALESCE(m.traceNo, '') AS traceNo,
      COALESCE(m.sourceNo, '') AS sourceNo,
      COALESCE(m.scanned_at, '') AS scanned_at
    FROM materials m
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(m.model)`;
    const params: SQLite.SQLiteBindValue[] = [];

    if (warehouseId) {
      sql += ' WHERE m.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY m.scanned_at DESC, m.id DESC';

    const rows = await database.getAllAsync<any>(sql, params);
    return rows.map((row) => ({
      order_no: row.order_no || '',
      customer_name: row.customer_name || '',
      warehouse_name: row.warehouse_name || '',
      inventory_code: row.inventory_code || '',
      model: row.model || '',
      batch: row.batch || '',
      quantity: Number(row.quantity || 0),
      package: row.package || '',
      version: row.version || '',
      productionDate: row.productionDate || '',
      traceNo: row.traceNo || '',
      sourceNo: row.sourceNo || '',
      scanned_at: row.scanned_at || '',
    }));
  } catch (error) {
    logger.error('[getOutboundExportRows] 获取出库导出数据失败:', error);
    throw error;
  }
};

// 搜索物料记录
export const searchMaterials = async (params: {
  operation_type?: 'inbound' | 'outbound' | 'inventory';
  orderNo?: string;
  exactOrderNo?: string;
  customerName?: string;
  startDate?: string;
  endDate?: string;
  model?: string;
  batch?: string;
  warehouse_id?: string; // 添加 warehouse_id 参数
}): Promise<MaterialRecord[]> => {
  try {
    const database = getDb();
    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (params.operation_type) {
      conditions.push('m.operation_type = ?');
      queryParams.push(params.operation_type);
    }

    if (params.exactOrderNo) {
      conditions.push('m.order_no = ?');
      queryParams.push(params.exactOrderNo);
    } else if (params.orderNo) {
      conditions.push('m.order_no LIKE ?');
      queryParams.push(`%${params.orderNo}%`);
    }

    if (params.customerName) {
      conditions.push('m.customer_name LIKE ?');
      queryParams.push(`%${params.customerName}%`);
    }

    if (params.warehouse_id) {
      conditions.push('m.warehouse_id = ?');
      queryParams.push(params.warehouse_id);
    }

    if (params.model) {
      conditions.push('m.model LIKE ?');
      queryParams.push(`%${params.model}%`);
    }

    if (params.batch) {
      conditions.push('m.batch LIKE ?');
      queryParams.push(`%${params.batch}%`);
    }

    if (params.startDate) {
      conditions.push('m.scanned_at >= ?');
      queryParams.push(params.startDate);
    }

    if (params.endDate) {
      const endDateTime = params.endDate + ' 23:59:59';
      conditions.push('m.scanned_at <= ?');
      queryParams.push(endDateTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT
      m.*,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM materials m
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(m.model)
    ${whereClause}
    ORDER BY m.scanned_at DESC, m.id DESC`;

    const results = await database.getAllAsync<any>(sql, queryParams);

    return results.map((r) => ({
      ...r,
      customFields: stringToJson<Record<string, string>>(r.customFields),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('搜索物料记录失败:', error);
    return [];
  }
};

// 删除物料记录
export const deleteMaterial = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteMaterial] 无效的 id:', id);
      return;
    }

    const database = getDb();
    const trimmedId = id.trim();
    await database.execAsync('BEGIN TRANSACTION');
    try {
      const materialRow = await database.getFirstAsync<{
        order_no: string | null;
        warehouse_id: string | null;
      }>('SELECT order_no, warehouse_id FROM materials WHERE id = ?', [trimmedId]);
      const unpackRows = await database.getAllAsync<{ id: string }>(
        'SELECT id FROM unpack_records WHERE original_material_id = ?',
        [trimmedId]
      );
      await prunePrintHistoryByUnpackIds(database, unpackRows.map((row) => row.id));
      await database.runAsync('DELETE FROM unpack_records WHERE original_material_id = ?', [trimmedId]);
      await database.runAsync('DELETE FROM materials WHERE id = ?', [trimmedId]);

      if (materialRow?.order_no) {
        const remainingMaterial = await database.getFirstAsync<{ count: number }>(
          materialRow.warehouse_id
            ? 'SELECT COUNT(*) as count FROM materials WHERE order_no = ? AND warehouse_id = ?'
            : 'SELECT COUNT(*) as count FROM materials WHERE order_no = ? AND warehouse_id IS NULL',
          materialRow.warehouse_id ? [materialRow.order_no, materialRow.warehouse_id] : [materialRow.order_no]
        );

        if ((remainingMaterial?.count || 0) === 0) {
          await database.runAsync(
            materialRow.warehouse_id
              ? 'DELETE FROM orders WHERE order_no = ? AND warehouse_id = ?'
              : 'DELETE FROM orders WHERE order_no = ? AND warehouse_id IS NULL',
            materialRow.warehouse_id ? [materialRow.order_no, materialRow.warehouse_id] : [materialRow.order_no]
          );
        }
      }

      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'deleteMaterial');
      throw error;
    }
  } catch (error) {
    logger.error('[deleteMaterial] 删除物料记录失败:', error);
    throw error;
  }
};

// 更新物料自定义字段
export const updateMaterialCustomFields = async (
  id: string,
  customFields: Record<string, string>
): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[updateMaterialCustomFields] 无效的 id:', id);
      return;
    }
    if (!customFields || typeof customFields !== 'object') {
      logger.warn('[updateMaterialCustomFields] 无效的 customFields:', customFields);
      return;
    }

    const database = getDb();
    await database.runAsync('UPDATE materials SET customFields = ? WHERE id = ?', [
      jsonToString(customFields),
      id.trim(),
    ]);
  } catch (error) {
    logger.error('[updateMaterialCustomFields] 更新物料自定义字段失败:', error);
    throw error;
  }
};

// 更新物料数量
export const updateMaterialQuantity = async (id: string, newQuantity: number): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[updateMaterialQuantity] 无效的 id:', id);
      return;
    }
    const parsedQuantity = parseQuantity(newQuantity, { min: 0 });
    if (parsedQuantity === null) {
      logger.warn('[updateMaterialQuantity] 无效的 newQuantity:', newQuantity);
      return;
    }

    const database = getDb();
    await database.runAsync('UPDATE materials SET quantity = ? WHERE id = ?', [
      parsedQuantity,
      id.trim(),
    ]);
  } catch (error) {
    logger.error('[updateMaterialQuantity] 更新物料数量失败:', error);
    throw error;
  }
};

type MaterialUpdatePayload = Partial<
  Pick<
    MaterialRecord,
    | 'model'
    | 'batch'
    | 'quantity'
    | 'package'
    | 'version'
    | 'productionDate'
    | 'traceNo'
    | 'sourceNo'
    | 'customer_name'
    | 'remaining_quantity'
    | 'original_quantity'
    | 'isUnpacked'
  >
>;

const MATERIAL_UPDATE_FIELDS = [
  'model',
  'batch',
  'quantity',
  'package',
  'version',
  'productionDate',
  'traceNo',
  'sourceNo',
  'customer_name',
  'remaining_quantity',
  'original_quantity',
  'isUnpacked',
] as const;

type MaterialUpdateField = (typeof MATERIAL_UPDATE_FIELDS)[number];

const isMaterialUpdateField = (key: string): key is MaterialUpdateField => {
  return (MATERIAL_UPDATE_FIELDS as readonly string[]).includes(key);
};

const MATERIAL_DUPLICATE_IDENTIFIER_FIELDS = ['traceNo'] as const;
type MaterialDuplicateIdentifierField = (typeof MATERIAL_DUPLICATE_IDENTIFIER_FIELDS)[number];

const isMaterialDuplicateIdentifierField = (
  key: string
): key is MaterialDuplicateIdentifierField => {
  return (MATERIAL_DUPLICATE_IDENTIFIER_FIELDS as readonly string[]).includes(key);
};

const DAILY_SEQUENCE_COLUMN_BY_TABLE = {
  inbound_records: 'inbound_no',
  inventory_check_records: 'check_no',
} as const;

type DailySequenceTableName = keyof typeof DAILY_SEQUENCE_COLUMN_BY_TABLE;
type DailySequenceColumnName = (typeof DAILY_SEQUENCE_COLUMN_BY_TABLE)[DailySequenceTableName];

const isDailySequenceTableName = (value: string): value is DailySequenceTableName => {
  return value in DAILY_SEQUENCE_COLUMN_BY_TABLE;
};

const updateMaterialWithDatabase = async (
  database: SQLite.SQLiteDatabase,
  id: string,
  updates: MaterialUpdatePayload
): Promise<void> => {
  const updateFields: string[] = [];
  const values: SQLite.SQLiteBindValue[] = [];

  Object.entries(updates as Record<string, unknown>).forEach(([key, value]) => {
    if (value !== undefined) {
      if (!isMaterialUpdateField(key)) {
        throw new Error(`非法的物料更新字段: ${key}`);
      }

      updateFields.push(`${key} = ?`);

      // 确保 INTEGER 类型的字段传入 number 类型
      if (key === 'quantity') {
        values.push(parseQuantity(value, { min: 0 }) ?? 0);
      } else if (key === 'isUnpacked') {
        values.push(value ? 1 : 0);
      } else if (value === null || typeof value === 'string' || typeof value === 'number') {
        values.push(value);
      } else {
        throw new Error(`非法的物料更新值类型: ${key}`);
      }
    }
  });

  if (updateFields.length === 0) {
    return;
  }

  values.push(id);
  await database.runAsync(`UPDATE materials SET ${updateFields.join(', ')} WHERE id = ?`, values);
};

// 更新物料信息
export const updateMaterial = async (id: string, updates: MaterialUpdatePayload): Promise<void> => {
  try {
    const database = getDb();
    await updateMaterialWithDatabase(database, id, updates);
  } catch (error) {
    logger.error('更新物料信息失败:', error);
    throw error;
  }
};

// ========== 统计信息 ==========

// 获取本地日期字符串 (YYYY-MM-DD)
const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 获取统计信息
export const getStatistics = async (): Promise<{
  totalOrders: number;
  totalMaterials: number;
  totalQuantity: number;
  todayOrders: number;
  todayMaterials: number;
  todayQuantity: number;
}> => {
  try {
    const database = getDb();
    const todayPattern = `${getTodayLocal()}%`;
    const stats = await database.getFirstAsync<{
      totalOrders: number;
      totalMaterials: number;
      totalQuantity: number;
      todayOrders: number;
      todayMaterials: number;
      todayQuantity: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM orders) as totalOrders,
         (SELECT COUNT(*) FROM orders WHERE created_at LIKE ?) as todayOrders,
         (SELECT COUNT(*) FROM materials) as totalMaterials,
         (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)), 0) FROM materials) as totalQuantity,
         (SELECT COUNT(*) FROM materials WHERE scanned_at LIKE ?) as todayMaterials,
         (SELECT COALESCE(SUM(CAST(quantity AS INTEGER)), 0) FROM materials WHERE scanned_at LIKE ?) as todayQuantity`,
      [todayPattern, todayPattern, todayPattern]
    );

    return {
      totalOrders: stats?.totalOrders || 0,
      totalMaterials: stats?.totalMaterials || 0,
      totalQuantity: stats?.totalQuantity || 0,
      todayOrders: stats?.todayOrders || 0,
      todayMaterials: stats?.todayMaterials || 0,
      todayQuantity: stats?.todayQuantity || 0,
    };
  } catch (error) {
    logger.error('获取统计信息失败:', error);
    return {
      totalOrders: 0,
      totalMaterials: 0,
      totalQuantity: 0,
      todayOrders: 0,
      todayMaterials: 0,
      todayQuantity: 0,
    };
  }
};

// ========== 拆包记录相关函数 ==========

// 获取所有拆包记录
export const getAllUnpackRecords = async (warehouseId?: string): Promise<UnpackRecord[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      u.*,
      COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM unpack_records u
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(u.model)`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE u.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY u.unpacked_at DESC';

    const results = await database.getAllAsync<any>(sql, params);
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取拆包记录失败:', error);
    return [];
  }
};

// 获取待打印的拆包记录
export const getPendingUnpackRecords = async (warehouseId?: string): Promise<UnpackRecord[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      u.*,
      COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM unpack_records u
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(u.model)
    WHERE u.status = 'pending'`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' AND u.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY u.unpacked_at DESC';

    const results = await database.getAllAsync<any>(sql, params);
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取待打印记录失败:', error);
    return [];
  }
};

// 获取已打印的拆包记录
export const getPrintedUnpackRecords = async (): Promise<UnpackRecord[]> => {
  try {
    const database = getDb();
    const results = await database.getAllAsync<any>(
      `SELECT
        u.*,
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(u.model)
      WHERE u.status = 'printed'
      ORDER BY u.unpacked_at DESC`
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取已打印记录失败:', error);
    return [];
  }
};

type UnpackRecordInsert = {
  original_material_id: string;
  order_no: string;
  customer_name: string;
  model: string;
  batch: string;
  package: string;
  version: string;
  warehouse_id?: string;
  warehouse_name?: string;
  inventory_code?: string;
  original_quantity: string;
  new_quantity: string;
  productionDate: string;
  traceNo: string;
  new_traceNo: string;
  sourceNo: string;
  label_type: 'shipped' | 'remaining';
  pair_id: string;
  status: 'pending' | 'printed';
  notes: string;
  unpacked_at?: string;
};

const insertUnpackRecord = async (
  database: SQLite.SQLiteDatabase,
  record: UnpackRecordInsert,
  options?: {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    unpackedAt?: string;
  }
): Promise<UnpackRecord> => {
  const id = options?.id || generateId();
  const createdAt = options?.createdAt || getISODateTime();
  const updatedAt = options?.updatedAt || createdAt;
  const unpackedAt = options?.unpackedAt || record.unpacked_at || createdAt;

  await database.runAsync(
    `INSERT INTO unpack_records (
      id, original_material_id, order_no, customer_name, model, batch, package, version,
      warehouse_id, warehouse_name, inventory_code, original_quantity, new_quantity,
      productionDate, traceNo, new_traceNo, sourceNo, label_type, pair_id, status,
      notes, unpacked_at, printed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.original_material_id,
      record.order_no,
      record.customer_name,
      record.model,
      record.batch,
      record.package,
      record.version,
      record.warehouse_id || null,
      record.warehouse_name || null,
      record.inventory_code || null,
      record.original_quantity,
      record.new_quantity,
      record.productionDate,
      record.traceNo,
      record.new_traceNo,
      record.sourceNo,
      record.label_type,
      record.pair_id,
      record.status,
      record.notes,
      unpackedAt,
      null,
      createdAt,
      updatedAt,
    ]
  );

  return {
    id,
    original_material_id: record.original_material_id,
    order_no: record.order_no,
    customer_name: record.customer_name,
    model: record.model,
    batch: record.batch,
    package: record.package,
    version: record.version,
    warehouse_id: record.warehouse_id,
    warehouse_name: record.warehouse_name,
    inventory_code: record.inventory_code,
    original_quantity: record.original_quantity,
    new_quantity: record.new_quantity,
    productionDate: record.productionDate,
    traceNo: record.traceNo,
    new_traceNo: record.new_traceNo,
    sourceNo: record.sourceNo,
    label_type: record.label_type,
    pair_id: record.pair_id,
    status: record.status,
    notes: record.notes,
    unpacked_at: unpackedAt,
    printed_at: null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

// 添加拆包记录
export const addUnpackRecord = async (record: UnpackRecordInsert): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[addUnpackRecord] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const insertedRecord = await insertUnpackRecord(database, record);
    return insertedRecord.id;
  } catch (error) {
    logger.error('添加拆包记录失败:', error);
    throw error;
  }
};

export const saveUnpackOperation = async (params: {
  material: MaterialRecord;
  shippedQuantity: number;
  remainingQuantity: number;
  newTraceNo: string;
  notes?: string;
}): Promise<{
  pairId: string;
  shippedRecord: UnpackRecord;
  remainingRecord: UnpackRecord;
}> => {
  if (!params.material.id) {
    throw new Error('原物料缺少 ID，无法拆包');
  }

  const trimmedNewTraceNo = params.newTraceNo.trim();

  if (!db) {
    logger.warn('[saveUnpackOperation] 数据库未初始化，等待初始化...');
    await initDatabase();
  }

  const database = getDb();
  const pairId = generateId();
  const notes = params.notes || '';
  const timestamp = getISODateTime();

  await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
  try {
    const currentMaterial = await database.getFirstAsync<any>(
      'SELECT * FROM materials WHERE id = ? LIMIT 1',
      [params.material.id]
    );
    if (!currentMaterial) {
      throw new Error('原物料不存在，无法拆包');
    }

    const currentAvailableValue =
      currentMaterial.remaining_quantity !== undefined &&
      currentMaterial.remaining_quantity !== null &&
      currentMaterial.remaining_quantity !== ''
        ? currentMaterial.remaining_quantity
        : currentMaterial.quantity ?? 0;
    const availableQuantity = parseQuantity(currentAvailableValue, { min: 1 });
    if (availableQuantity === null) {
      throw new Error('当前可拆数量无效，无法拆包');
    }

    const shippedQuantity = parseQuantity(params.shippedQuantity, {
      min: 1,
      max: availableQuantity,
    });
    const remainingQuantity = parseQuantity(params.remainingQuantity, {
      min: 0,
      max: availableQuantity,
    });
    if (shippedQuantity === null || remainingQuantity === null) {
      throw new Error(`拆包数量无效，当前可拆数量为 ${availableQuantity}`);
    }
    if (shippedQuantity + remainingQuantity !== availableQuantity) {
      throw new Error('拆出数量与剩余数量之和必须等于当前可拆数量');
    }

    if (trimmedNewTraceNo) {
      await assertUnpackTraceNoAvailable(
        database,
        trimmedNewTraceNo,
        params.material.id
      );
    }

    const previouslyShippedQuantity =
      currentMaterial.isUnpacked === 1
        ? parseQuantity(currentMaterial.quantity, { min: 0 }) ?? 0
        : 0;
    const updatedShippedQuantity = previouslyShippedQuantity + shippedQuantity;
    const materialOriginalQuantity =
      currentMaterial.original_quantity !== undefined &&
      currentMaterial.original_quantity !== null &&
      currentMaterial.original_quantity !== ''
        ? currentMaterial.original_quantity.toString()
        : (currentMaterial.quantity ?? availableQuantity).toString();
    const splitOriginalQuantity = availableQuantity.toString();

    const baseRecord = {
      original_material_id: params.material.id,
      order_no: currentMaterial.order_no,
      customer_name: currentMaterial.customer_name || '',
      model: currentMaterial.model,
      batch: currentMaterial.batch || '',
      package: currentMaterial.package || '',
      version: currentMaterial.version || '',
      warehouse_id: currentMaterial.warehouse_id,
      warehouse_name: currentMaterial.warehouse_name,
      inventory_code: currentMaterial.inventory_code,
      original_quantity: splitOriginalQuantity,
      productionDate: currentMaterial.productionDate || '',
      traceNo: currentMaterial.traceNo || '',
      new_traceNo: trimmedNewTraceNo,
      sourceNo: currentMaterial.sourceNo || '',
      pair_id: pairId,
      status: 'pending' as const,
      notes,
      unpacked_at: timestamp,
    };

    const shippedRecord = await insertUnpackRecord(
      database,
      {
        ...baseRecord,
        new_quantity: shippedQuantity.toString(),
        label_type: 'shipped',
      },
      {
        createdAt: timestamp,
        updatedAt: timestamp,
        unpackedAt: timestamp,
      }
    );

    const remainingRecord = await insertUnpackRecord(
      database,
      {
        ...baseRecord,
        new_quantity: remainingQuantity.toString(),
        label_type: 'remaining',
      },
      {
        createdAt: timestamp,
        updatedAt: timestamp,
        unpackedAt: timestamp,
      }
    );

    await updateMaterialWithDatabase(database, params.material.id, {
      traceNo: trimmedNewTraceNo || currentMaterial.traceNo || '',
      quantity: updatedShippedQuantity,
      original_quantity: materialOriginalQuantity,
      remaining_quantity: remainingQuantity.toString(),
      isUnpacked: true,
    });

    await database.execAsync('COMMIT');
    return { pairId, shippedRecord, remainingRecord };
  } catch (error) {
    await rollbackTransaction(database, 'saveUnpackOperation');
    logger.error('保存拆包操作失败:', error);
    throw error;
  }
};

// 标记拆包记录为已打印
export const markUnpackRecordsAsPrinted = async (ids: string[]): Promise<void> => {
  try {
    const database = getDb();
    const placeholders = ids.map(() => '?').join(',');
    await database.runAsync(
      `UPDATE unpack_records SET status = 'printed', printed_at = ? WHERE id IN (${placeholders})`,
      [getISODateTime(), ...ids]
    );
  } catch (error) {
    logger.error('标记拆包记录失败:', error);
    throw error;
  }
};

// 删除拆包记录
export const deleteUnpackRecord = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteUnpackRecord] 无效的 id:', id);
      return;
    }

    const database = getDb();
    const trimmedId = id.trim();
    await database.execAsync('BEGIN TRANSACTION');
    try {
      await prunePrintHistoryByUnpackIds(database, [trimmedId]);
      await database.runAsync('DELETE FROM unpack_records WHERE id = ?', [trimmedId]);
      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'deleteUnpackRecord');
      throw error;
    }
  } catch (error) {
    logger.error('[deleteUnpackRecord] 删除拆包记录失败:', error);
    throw error;
  }
};

// 删除多个拆包记录
export const deleteUnpackRecords = async (ids: string[]): Promise<void> => {
  try {
    const database = getDb();
    const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
      return;
    }

    const placeholders = normalizedIds.map(() => '?').join(',');
    await database.execAsync('BEGIN TRANSACTION');
    try {
      await prunePrintHistoryByUnpackIds(database, normalizedIds);
      await database.runAsync(
        `DELETE FROM unpack_records WHERE id IN (${placeholders})`,
        normalizedIds
      );
      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'deleteUnpackRecords');
      throw error;
    }
  } catch (error) {
    logger.error('删除拆包记录失败:', error);
    throw error;
  }
};

// 获取物料的拆包历史记录
export const getUnpackHistoryByMaterialId = async (materialId: string): Promise<UnpackRecord[]> => {
  try {
    const database = getDb();
    const results = await database.getAllAsync<any>(
      `SELECT
        u.*,
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(u.model)
      WHERE u.original_material_id = ? AND u.label_type = 'shipped'
      ORDER BY u.unpacked_at DESC`,
      [materialId]
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取拆包历史失败:', error);
    return [];
  }
};

// 获取追踪码的拆包历史记录
export const getUnpackHistoryByTraceNo = async (traceNo: string): Promise<UnpackRecord[]> => {
  try {
    // 参数验证
    if (!traceNo || typeof traceNo !== 'string' || traceNo.trim() === '') {
      logger.warn('[getUnpackHistoryByTraceNo] 无效的 traceNo:', traceNo);
      return [];
    }

    const database = getDb();
    const results = await database.getAllAsync<any>(
      `SELECT
        u.*,
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(u.model)
      WHERE u.traceNo = ? AND u.label_type = 'shipped'
      ORDER BY u.unpacked_at DESC`,
      [traceNo.trim()]
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('[getUnpackHistoryByTraceNo] 获取拆包历史失败:', error);
    return [];
  }
};

// 获取下一个拆包序号
export const getNextUnpackIndex = async (traceNo: string): Promise<number> => {
  try {
    // 参数验证
    if (!traceNo || typeof traceNo !== 'string' || traceNo.trim() === '') {
      logger.warn('[getNextUnpackIndex] 无效的 traceNo:', traceNo);
      return 1;
    }

    const database = getDb();
    const trimmedTraceNo = traceNo.trim();
    const baseTraceNo = trimmedTraceNo.replace(/-\d+$/, '');
    const prefix = `${baseTraceNo}-`;
    const likePrefix = prefix.replace(/[\\%_]/g, (char) => `\\${char}`);

    const rows = await database.getAllAsync<{ traceNo: string }>(
      `SELECT traceNo FROM materials WHERE traceNo LIKE ? ESCAPE '\\'
       UNION ALL
       SELECT new_traceNo AS traceNo FROM unpack_records WHERE new_traceNo LIKE ? ESCAPE '\\'`,
      [`${likePrefix}%`, `${likePrefix}%`]
    );

    const maxExistingIndex = rows.reduce((maxIndex, row) => {
      const value = row.traceNo?.trim();
      if (!value?.startsWith(prefix)) {
        return maxIndex;
      }

      const suffix = value.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) {
        return maxIndex;
      }

      return Math.max(maxIndex, parseInt(suffix, 10));
    }, 0);

    if (maxExistingIndex > 0) {
      return maxExistingIndex + 1;
    }

    const match = trimmedTraceNo.match(/^(.+)-(\d+)$/);
    if (match) {
      return parseInt(match[2], 10) + 1;
    }

    return 1;
  } catch (error) {
    logger.error('[getNextUnpackIndex] 获取拆包序号失败:', error);
    return 1;
  }
};

// ========== 打印历史相关函数 ==========

// 获取所有打印历史
export const getAllPrintHistory = async (): Promise<PrintHistory[]> => {
  try {
    const database = getDb();
    const results = await database.getAllAsync<any>(
      'SELECT * FROM print_history ORDER BY printed_at DESC'
    );

    return results.map((r) => ({
      ...r,
      unpack_record_ids: stringToJson<string[]>(r.unpack_record_ids) || [],
    })) as PrintHistory[];
  } catch (error) {
    logger.error('获取打印历史失败:', error);
    return [];
  }
};

// 添加打印历史
export const addPrintHistory = async (history: {
  unpack_record_ids: string[];
  export_format: 'csv' | 'excel' | 'json';
  export_file_path: string | null;
  printed_at?: string;
  print_count?: number;
}): Promise<string> => {
  try {
    const database = getDb();
    const id = generateId();

    await database.runAsync(
      `INSERT INTO print_history (
        id, unpack_record_ids, export_format, export_file_path, printed_at, print_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        jsonToString(history.unpack_record_ids),
        history.export_format,
        history.export_file_path,
        history.printed_at || getISODateTime(),
        history.print_count || 1,
        getISODateTime(),
      ]
    );

    return id;
  } catch (error) {
    logger.error('添加打印历史失败:', error);
    throw error;
  }
};

async function prunePrintHistoryByUnpackIds(
  database: ReturnType<typeof getDb>,
  unpackIds: string[]
): Promise<void> {
  const normalizedIds = Array.from(new Set(unpackIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return;
  }

  const unpackIdSet = new Set(normalizedIds);
  const printHistoryRows = await database.getAllAsync<{
    id: string;
    unpack_record_ids: string;
  }>('SELECT id, unpack_record_ids FROM print_history');

  for (const row of printHistoryRows) {
    const unpackRecordIds = stringToJson<string[]>(row.unpack_record_ids) || [];
    const remainingIds = unpackRecordIds.filter((recordId) => !unpackIdSet.has(recordId));

    if (remainingIds.length === unpackRecordIds.length) {
      continue;
    }

    if (remainingIds.length === 0) {
      await database.runAsync('DELETE FROM print_history WHERE id = ?', [row.id]);
      continue;
    }

    await database.runAsync('UPDATE print_history SET unpack_record_ids = ? WHERE id = ?', [
      jsonToString(remainingIds),
      row.id,
    ]);
  }
}

// ========== 仓库相关函数 ==========

// 获取所有仓库
export const getAllWarehouses = async (): Promise<Warehouse[]> => {
  try {
    logger.log('[getAllWarehouses] 开始获取仓库列表');
    const database = getDb();
    const results = await database.getAllAsync<any>(
      'SELECT * FROM warehouses ORDER BY sort_order ASC, created_at DESC, id DESC'
    );

    logger.log(`[getAllWarehouses] 查询完成，返回 ${results.length} 条记录`);

    const mappedResults = results.map((r) => ({
      ...r,
      description: typeof r.description === 'string' ? r.description : undefined,
      is_default: r.is_default === 1,
      sort_order: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
      created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
    })) as Warehouse[];

    logger.log(
      '[getAllWarehouses] 返回数据:',
      JSON.stringify(
        mappedResults.map((w) => ({ id: w.id, name: w.name, is_default: w.is_default }))
      )
    );

    return mappedResults;
  } catch (error) {
    logger.error('[getAllWarehouses] 获取仓库列表失败:', error);
    return [];
  }
};

// 获取默认仓库
export const getDefaultWarehouse = async (): Promise<Warehouse | null> => {
  try {
    const database = getDb();
    const result = await database.getFirstAsync<any>(
      'SELECT * FROM warehouses WHERE is_default = 1 ORDER BY created_at ASC, id ASC LIMIT 1'
    );

    if (!result) return null;

    return {
      ...result,
      is_default: result.is_default === 1,
    } as Warehouse;
  } catch (error) {
    logger.error('获取默认仓库失败:', error);
    return null;
  }
};

// 添加仓库
export const addWarehouse = async (
  warehouse: Omit<Warehouse, 'id' | 'created_at'>
): Promise<string> => {
  try {
    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();
    const sortOrderResult = await database.getFirstAsync<{ max_sort_order: number | null }>(
      'SELECT MAX(sort_order) as max_sort_order FROM warehouses'
    );
    const sortOrder =
      typeof sortOrderResult?.max_sort_order === 'number' ? sortOrderResult.max_sort_order + 1 : 0;

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 如果设置为默认仓库，先取消其他仓库的默认状态
      if (warehouse.is_default) {
        await database.runAsync('UPDATE warehouses SET is_default = 0');
      }

      await database.runAsync(
        'INSERT INTO warehouses (id, name, description, is_default, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          id,
          warehouse.name,
          warehouse.description || null,
          warehouse.is_default ? 1 : 0,
          sortOrder,
          isoDateTime,
        ]
      );

      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'addWarehouse');
      throw error;
    }

    return id;
  } catch (error) {
    logger.error('添加仓库失败:', error);
    throw error;
  }
};

export const reorderWarehouses = async (warehouseIds: string[]): Promise<void> => {
  try {
    const database = getDb();
    const orderedIds = warehouseIds.map((id) => id.trim()).filter(Boolean);

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await database.runAsync('UPDATE warehouses SET sort_order = ? WHERE id = ?', [
          index,
          orderedIds[index],
        ]);
      }
      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'reorderWarehouses');
      throw error;
    }
  } catch (error) {
    logger.error('仓库排序失败:', error);
    throw error;
  }
};

// 更新仓库
export const updateWarehouse = async (id: string, updates: Partial<Warehouse>): Promise<void> => {
  try {
    const database = getDb();
    const updateFields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key === 'is_default' && value !== undefined) {
        updateFields.push('is_default = ?');
        values.push(value ? 1 : 0);
      } else if (key !== 'id' && value !== undefined) {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (updateFields.length > 0) {
      await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
      try {
        // 如果设置为默认仓库，先取消其他仓库的默认状态
        if (updates.is_default) {
          await database.runAsync('UPDATE warehouses SET is_default = 0 WHERE id != ?', [id]);
        }

        values.push(id);
        await database.runAsync(
          `UPDATE warehouses SET ${updateFields.join(', ')} WHERE id = ?`,
          values
        );
        await database.execAsync('COMMIT');
      } catch (error) {
        await rollbackTransaction(database, 'updateWarehouse');
        throw error;
      }
    }
  } catch (error) {
    logger.error('更新仓库失败:', error);
    throw error;
  }
};

// 删除仓库
export const deleteWarehouse = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteWarehouse] 无效的 id:', id);
      return;
    }

    const database = getDb();
    await database.execAsync('BEGIN TRANSACTION');

    try {
      const trimmedId = id.trim();
      const countRows = await Promise.all([
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM inbound_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM inbound_summary WHERE warehouse_id = ?',
          [trimmedId]
        ),
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM inventory_check_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM materials WHERE warehouse_id = ?',
          [trimmedId]
        ),
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM orders WHERE warehouse_id = ?',
          [trimmedId]
        ),
        database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM unpack_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
      ]);
      const referencedCount = countRows.reduce((sum, row) => sum + (row?.count || 0), 0);

      if (referencedCount > 0) {
        throw new Error('该仓库已有业务数据，不能删除。请先备份数据库；如确需清理，请使用对应业务记录页面逐项删除。');
      }

      const unpackRows = await database.getAllAsync<{ id: string }>(
        'SELECT id FROM unpack_records WHERE warehouse_id = ?',
        [trimmedId]
      );
      await prunePrintHistoryByUnpackIds(database, unpackRows.map((row) => row.id));

      // 仅允许删除无业务数据引用的空仓库，避免误删整仓历史记录。
      await database.runAsync('DELETE FROM warehouses WHERE id = ?', [trimmedId]);

      await database.execAsync('COMMIT');
      logger.log(`[deleteWarehouse] 空仓库 ${trimmedId} 已删除`);
    } catch (error) {
      await database.execAsync('ROLLBACK');
      logger.error('[deleteWarehouse] 删除仓库数据失败，已回滚:', error);
      throw error;
    }
  } catch (error) {
    logger.error('删除仓库失败:', error);
    throw error;
  }
};

// ========== 物料管理（存货编码绑定）相关函数 ==========

const normalizeInventoryBinding = (binding: InventoryBinding): InventoryBinding => ({
  ...binding,
  supplier: typeof binding.supplier === 'string' ? binding.supplier : undefined,
  description: typeof binding.description === 'string' ? binding.description : undefined,
});

const buildInventoryBindingSearchClause = (keyword?: string) => {
  const normalizedKeyword = keyword?.trim() || '';

  if (!normalizedKeyword) {
    return {
      whereClause: '',
      params: [] as (string | number)[],
    };
  }

  const likeKeyword = `%${normalizedKeyword}%`;
  return {
    whereClause:
      'WHERE scan_model LIKE ? OR inventory_code LIKE ? OR COALESCE(supplier, \'\') LIKE ?',
    params: [likeKeyword, likeKeyword, likeKeyword] as (string | number)[],
  };
};

// 获取所有物料绑定
export const getAllInventoryBindings = async (): Promise<InventoryBinding[]> => {
  try {
    const database = getDb();
    const results = await database.getAllAsync<InventoryBinding>(
      'SELECT * FROM inventory_bindings ORDER BY created_at DESC'
    );
    return results.map(normalizeInventoryBinding);
  } catch (error) {
    logger.error('获取物料绑定列表失败:', error);
    return [];
  }
};

// 分页获取物料绑定
export const getInventoryBindingsPage = async ({
  page = 1,
  pageSize = 10,
  keyword = '',
}: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}): Promise<InventoryBindingPageResult> => {
  try {
    const database = getDb();
    const normalizedPageSize = Math.max(1, Math.floor(pageSize));
    const { whereClause, params } = buildInventoryBindingSearchClause(keyword);

    const totalResult = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM inventory_bindings ${whereClause}`,
      params
    );
    const total = totalResult?.count || 0;
    const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 1;
    const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
    const offset = (safePage - 1) * normalizedPageSize;

    const items = await database.getAllAsync<InventoryBinding>(
      `SELECT * FROM inventory_bindings ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, normalizedPageSize, offset]
    );

    return {
      items: items.map(normalizeInventoryBinding),
      total,
      page: safePage,
      pageSize: normalizedPageSize,
    };
  } catch (error) {
    logger.error('分页获取物料绑定失败:', error);
    return {
      items: [],
      total: 0,
      page: 1,
      pageSize: Math.max(1, Math.floor(pageSize)),
    };
  }
};

// 根据扫描型号获取存货编码
export const getInventoryCodeByModel = async (scanModel: string): Promise<string | null> => {
  try {
    // 参数验证
    if (!scanModel || typeof scanModel !== 'string' || scanModel.trim() === '') {
      logger.warn('[getInventoryCodeByModel] 无效的 scanModel:', scanModel);
      return null;
    }

    const database = getDb();
    const result = await database.getFirstAsync<{ inventory_code: string }>(
      'SELECT inventory_code FROM inventory_bindings WHERE scan_model = ?',
      [scanModel.trim()]
    );
    return result?.inventory_code || null;
  } catch (error) {
    logger.error('[getInventoryCodeByModel] 获取存货编码失败:', error);
    return null;
  }
};

// 根据扫描型号获取供应商
export const getSupplierByModel = async (scanModel: string): Promise<string | null> => {
  try {
    const database = getDb();
    const result = await database.getFirstAsync<{ supplier: string }>(
      'SELECT supplier FROM inventory_bindings WHERE scan_model = ?',
      [scanModel]
    );
    return result?.supplier || null;
  } catch (error) {
    logger.error('获取供应商失败:', error);
    return null;
  }
};

const syncInventoryCodeToHistoricalRecords = async (
  scanModel: string,
  inventoryCode: string | null | undefined
): Promise<void> => {
  const normalizedModel = typeof scanModel === 'string' ? scanModel.trim() : '';
  if (!normalizedModel) {
    return;
  }

  const normalizedInventoryCode =
    typeof inventoryCode === 'string' && inventoryCode.trim() ? inventoryCode.trim() : null;

  const database = getDb();

  await database.runAsync('UPDATE materials SET inventory_code = ? WHERE TRIM(model) = ?', [
    normalizedInventoryCode,
    normalizedModel,
  ]);
  await database.runAsync('UPDATE unpack_records SET inventory_code = ? WHERE TRIM(model) = ?', [
    normalizedInventoryCode,
    normalizedModel,
  ]);
  await database.runAsync(
    'UPDATE inbound_records SET inventory_code = ? WHERE TRIM(scan_model) = ?',
    [
      normalizedInventoryCode,
      normalizedModel,
    ]
  );
  await database.runAsync(
    'UPDATE inventory_check_records SET inventory_code = ? WHERE TRIM(scan_model) = ?',
    [normalizedInventoryCode, normalizedModel]
  );

  const inboundWarehouses = await database.getAllAsync<{ warehouse_id: string | null }>(
    'SELECT DISTINCT warehouse_id FROM inbound_records WHERE TRIM(scan_model) = ? AND warehouse_id IS NOT NULL',
    [normalizedModel]
  );

  for (const row of inboundWarehouses) {
    if (row.warehouse_id) {
      await updateInboundSummary(row.warehouse_id);
    }
  }
};

// 添加物料绑定
export const addInventoryBinding = async (
  binding: Omit<InventoryBinding, 'id' | 'created_at'>
): Promise<string> => {
  try {
    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();

    await database.runAsync(
      'INSERT INTO inventory_bindings (id, scan_model, inventory_code, supplier, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        binding.scan_model,
        binding.inventory_code,
        binding.supplier || null,
        binding.description || null,
        isoDateTime,
      ]
    );

    await syncInventoryCodeToHistoricalRecords(binding.scan_model, binding.inventory_code);

    return id;
  } catch (error) {
    logger.error('添加物料绑定失败:', error);
    throw error;
  }
};

// 更新物料绑定
export const updateInventoryBinding = async (
  id: string,
  updates: Partial<InventoryBinding>
): Promise<void> => {
  try {
    const database = getDb();
    const existingBinding = await database.getFirstAsync<InventoryBinding>(
      'SELECT * FROM inventory_bindings WHERE id = ?',
      [id]
    );

    if (!existingBinding) {
      throw new Error('未找到要更新的物料绑定');
    }

    const updateFields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (updateFields.length > 0) {
      values.push(id);
      await database.runAsync(
        `UPDATE inventory_bindings SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );

      await syncInventoryCodeToHistoricalRecords(
        typeof updates.scan_model === 'string' ? updates.scan_model : existingBinding.scan_model,
        typeof updates.inventory_code === 'string'
          ? updates.inventory_code
          : existingBinding.inventory_code
      );
    }
  } catch (error) {
    logger.error('更新物料绑定失败:', error);
    throw error;
  }
};

// 删除物料绑定
export const deleteInventoryBinding = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteInventoryBinding] 无效的 id:', id);
      return;
    }

    const database = getDb();
    await database.runAsync('DELETE FROM inventory_bindings WHERE id = ?', [id.trim()]);
  } catch (error) {
    logger.error('[deleteInventoryBinding] 删除物料绑定失败:', error);
    throw error;
  }
};

// 批量导入物料绑定
export const importInventoryBindings = async (
  bindings: Array<{
    scan_model: string;
    inventory_code: string;
    supplier?: string;
    description?: string;
  }>
): Promise<number> => {
  try {
    const database = getDb();
    let importedCount = 0;
    const skippedCodes: string[] = [];

    for (const binding of bindings) {
      // 检查是否已存在（存货编码唯一）
      const existing = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM inventory_bindings WHERE inventory_code = ?',
        [binding.inventory_code]
      );

      if (existing) {
        skippedCodes.push(binding.inventory_code);
        continue;
      }

      // 检查扫描型号是否已存在
      const existingModel = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM inventory_bindings WHERE scan_model = ?',
        [binding.scan_model]
      );

      if (existingModel) {
        skippedCodes.push(binding.scan_model);
        continue;
      }

      // 插入新记录
      await database.runAsync(
        'INSERT INTO inventory_bindings (id, scan_model, inventory_code, supplier, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          generateId(),
          binding.scan_model,
          binding.inventory_code,
          binding.supplier || null,
          binding.description || null,
          getISODateTime(),
        ]
      );

      await syncInventoryCodeToHistoricalRecords(binding.scan_model, binding.inventory_code);

      importedCount++;
    }

    return importedCount;
  } catch (error) {
    logger.error('批量导入物料绑定失败:', error);
    throw error;
  }
};

// ========== 入库记录相关函数 ==========

const getNextDailySequence = async (
  database: SQLite.SQLiteDatabase,
  tableName: DailySequenceTableName,
  columnName: DailySequenceColumnName,
  prefix: string
): Promise<number> => {
  if (!isDailySequenceTableName(tableName)) {
    throw new Error(`非法的序列表名: ${tableName}`);
  }

  if (DAILY_SEQUENCE_COLUMN_BY_TABLE[tableName] !== columnName) {
    throw new Error(`非法的序列列名组合: ${tableName}.${columnName}`);
  }

  const rows = await database.getAllAsync<{ document_no: string }>(
    `SELECT ${columnName} as document_no
     FROM ${tableName}
     WHERE ${columnName} LIKE ?
     GROUP BY ${columnName}`,
    [`${prefix}-%`]
  );

  let maxSequence = 0;

  rows.forEach((row) => {
    const documentNo = row.document_no || '';
    const suffix = documentNo.startsWith(`${prefix}-`) ? documentNo.slice(prefix.length + 1) : '';
    const sequence = parseInt(suffix, 10);

    if (!Number.isNaN(sequence)) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  });

  return maxSequence + 1;
};

// 生成入库单号
export const generateInboundNo = async (): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[generateInboundNo] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const today = getLocalDateString();
    const todayPrefix = `RK-${today}`;

    const sequence = String(
      await getNextDailySequence(database, 'inbound_records', 'inbound_no', todayPrefix)
    ).padStart(3, '0');

    return `${todayPrefix}-${sequence}`;
  } catch (error) {
    logger.error('生成入库单号失败:', error);
    return `RK-${getLocalDateString()}-001`;
  }
};

// 获取所有入库记录
export const getAllInboundRecords = async (warehouseId?: string): Promise<InboundRecord[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      i.*,
      COALESCE(NULLIF(TRIM(i.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM inbound_records i
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(i.scan_model)`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE i.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY i.created_at DESC';

    const results = await database.getAllAsync<any>(sql, params);

    return results.map((r) => ({
      ...r,
      customFields: stringToJson<Record<string, string>>(r.customFields),
    })) as InboundRecord[];
  } catch (error) {
    logger.error('获取入库记录失败:', error);
    return [];
  }
};

export const getInboundExportSummaryRows = async (
  warehouseId?: string
): Promise<InboundExportSummaryRow[]> => {
  try {
    const database = getDb();
    const params: SQLite.SQLiteBindValue[] = [];
    const conditions: string[] = [];

    if (warehouseId) {
      conditions.push('i.warehouse_id = ?');
      params.push(warehouseId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await database.getAllAsync<any>(
      `SELECT
        COALESCE(i.warehouse_name, '') AS warehouse_name,
        COALESCE(NULLIF(TRIM(i.inventory_code), ''), ib.inventory_code, '') AS inventory_code,
        COALESCE(i.scan_model, '') AS scan_model,
        COALESCE(i.version, '') AS version,
        COALESCE(i.package, '') AS package,
        SUM(COALESCE(i.quantity, 0)) AS total_quantity,
        COALESCE(i.in_date, '') AS in_date
      FROM inbound_records i
      LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(i.scan_model)
      ${whereClause}
      GROUP BY
        COALESCE(i.warehouse_name, ''),
        COALESCE(NULLIF(TRIM(i.inventory_code), ''), ib.inventory_code, ''),
        COALESCE(i.scan_model, ''),
        COALESCE(i.version, ''),
        COALESCE(i.package, ''),
        COALESCE(i.in_date, '')
      ORDER BY warehouse_name, in_date, scan_model, version, package`,
      params
    );

    return rows.map((row) => ({
      warehouse_name: row.warehouse_name || '',
      inventory_code: row.inventory_code || '',
      scan_model: row.scan_model || '',
      version: row.version || '',
      package: row.package || '',
      total_quantity: Number(row.total_quantity || 0),
      in_date: row.in_date || '',
    }));
  } catch (error) {
    logger.error('[getInboundExportSummaryRows] 获取入库汇总失败:', error);
    return [];
  }
};

export const getInboundDocumentSummaries = async (
  warehouseId?: string
): Promise<InboundDocumentSummary[]> => {
  try {
    const database = getDb();
    let sql = `
      SELECT
        inbound_no,
        warehouse_id,
        MAX(warehouse_name) AS warehouse_name,
        MAX(in_date) AS in_date,
        MAX(created_at) AS created_at,
        COUNT(*) AS record_count,
        COUNT(DISTINCT TRIM(scan_model) || '|' || COALESCE(TRIM(version), '')) AS model_count,
        SUM(CAST(quantity AS INTEGER)) AS total_quantity,
        CASE
          WHEN SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) = COUNT(*) THEN 'success'
          WHEN SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
          ELSE 'pending'
        END AS sync_status,
        MAX(sync_file_name) AS sync_file_name,
        MAX(synced_at) AS synced_at,
        MAX(sync_message) AS sync_message
      FROM inbound_records`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += `
      GROUP BY inbound_no, warehouse_id
      ORDER BY MAX(created_at) DESC, inbound_no DESC`;

    const rows = await database.getAllAsync<any>(sql, params);

    return rows.map((row) => ({
      inbound_no: row.inbound_no,
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name,
      in_date: row.in_date,
      created_at: row.created_at,
      record_count: Number(row.record_count || 0),
      model_count: Number(row.model_count || 0),
      total_quantity: Number(row.total_quantity || 0),
      sync_status: normalizeDocumentSyncStatus(row.sync_status),
      sync_file_name: row.sync_file_name || undefined,
      synced_at: row.synced_at || undefined,
      sync_message: row.sync_message || undefined,
    }));
  } catch (error) {
    logger.error('[getInboundDocumentSummaries] 获取入库单列表失败:', error);
    return [];
  }
};

export const getInboundRecordsByNo = async (
  inboundNo: string,
  warehouseId?: string
): Promise<InboundRecord[]> => {
  try {
    const trimmedInboundNo = inboundNo.trim();
    if (!trimmedInboundNo) {
      return [];
    }

    const database = getDb();
    let sql = `SELECT
      i.id,
      i.inbound_no,
      i.warehouse_id,
      i.warehouse_name,
      COALESCE(NULLIF(TRIM(i.inventory_code), ''), ib.inventory_code) AS inventory_code,
      i.scan_model,
      i.batch,
      i.quantity,
      i.in_date,
      i.notes,
      i.raw_content AS rawContent,
      i.created_at,
      i.package,
      i.version,
      i.productionDate,
      i.traceNo,
      i.sourceNo,
      i.customFields,
      i.sync_status,
      i.sync_file_name,
      i.synced_at,
      i.sync_message
    FROM inbound_records i
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(i.scan_model)
    WHERE i.inbound_no = ?`;
    const params: any[] = [trimmedInboundNo];

    if (warehouseId) {
      sql += ' AND i.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY i.created_at DESC, i.id DESC';

    const rows = await database.getAllAsync<any>(sql, params);

    return rows.map((row) => ({
      ...row,
      customFields: stringToJson<Record<string, string>>(row.customFields),
    })) as InboundRecord[];
  } catch (error) {
    logger.error('[getInboundRecordsByNo] 获取入库单明细失败:', error);
    return [];
  }
};

/**
 * 检查入库记录中是否已存在指定的 traceNo（追踪码）
 * @param traceNo 追踪码
 * @returns 存在返回 true，否则 false
 */
export const checkInboundTraceNoExists = async (
  traceNo: string,
  _warehouseId?: string
): Promise<boolean> => {
  try {
    const trimmedTraceNo = traceNo.trim();
    if (!trimmedTraceNo) {
      return false;
    }

    const database = getDb();
    let sql = 'SELECT 1 FROM inbound_records WHERE traceNo = ?';
    const params: any[] = [trimmedTraceNo];

    sql += ' LIMIT 1';

    const row = await database.getFirstAsync<any>(sql, params);
    return !!row;
  } catch (error) {
    logger.error('[checkInboundTraceNoExists] 查询追踪码失败:', error);
    return true;
  }
};

type InboundRecordInsert = Omit<InboundRecord, 'id' | 'created_at'>;

const insertInboundRecord = async (
  database: SQLite.SQLiteDatabase,
  record: InboundRecordInsert,
  options?: {
    id?: string;
    createdAt?: string;
  }
): Promise<string> => {
  const id = options?.id || generateId();
  const createdAt = options?.createdAt || getISODateTime();
  const quantity = parseQuantity(record.quantity, { min: 1 });

  if (quantity === null) {
    throw new Error('入库数量无效，必须为大于 0 的整数');
  }

  await database.runAsync(
    `INSERT INTO inbound_records (
      id, inbound_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
      quantity, in_date, notes, raw_content, created_at, package, version,
      productionDate, traceNo, sourceNo, customFields, sync_status, sync_file_name, synced_at,
      sync_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.inbound_no,
      record.warehouse_id,
      record.warehouse_name,
      record.inventory_code || null,
      record.scan_model,
      record.batch || null,
      quantity,
      record.in_date,
      record.notes || null,
      record.rawContent || null,
      createdAt,
      record.package || null,
      record.version || null,
      record.productionDate || null,
      record.traceNo || null,
      record.sourceNo || null,
      record.customFields ? jsonToString(record.customFields) : null,
      record.sync_status || 'pending',
      record.sync_file_name || null,
      record.synced_at || null,
      record.sync_message || null,
    ]
  );

  return id;
};

// 添加入库记录
export const addInboundRecord = async (record: InboundRecordInsert): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[addInboundRecord] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    return await insertInboundRecord(database, record);
  } catch (error) {
    logger.error('添加入库记录失败:', error);
    throw error;
  }
};

export const addInboundRecordsBatch = async (records: InboundRecordInsert[]): Promise<string[]> => {
  if (records.length === 0) {
    return [];
  }

  try {
    if (!db) {
      logger.warn('[addInboundRecordsBatch] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const ids: string[] = [];
    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      assertUniqueTraceNosInBatch(records, '入库记录');
      await assertInboundTraceNosNotAlreadySaved(database, records);

      for (const record of records) {
        ids.push(await insertInboundRecord(database, record));
      }
      await database.execAsync('COMMIT');
      return ids;
    } catch (error) {
      await rollbackTransaction(database, 'addInboundRecordsBatch');
      throw error;
    }
  } catch (error) {
    logger.error('批量添加入库记录失败:', error);
    throw error;
  }
};

export const updateInboundDocumentSyncStatus = async (
  inboundNo: string,
  warehouseId: string,
  status: DocumentSyncStatus,
  fileName?: string,
  message?: string
): Promise<void> => {
  const trimmedInboundNo = inboundNo.trim();
  const trimmedWarehouseId = warehouseId.trim();
  if (!trimmedInboundNo || !trimmedWarehouseId) {
    return;
  }

  try {
    const database = getDb();
    await database.runAsync(
      `UPDATE inbound_records
       SET sync_status = ?,
           sync_file_name = ?,
           synced_at = ?,
           sync_message = ?
       WHERE inbound_no = ? AND warehouse_id = ?`,
      [
        status,
        status === 'success' ? fileName || null : null,
        status === 'success' ? getISODateTime() : null,
        status === 'failed' ? message || null : null,
        trimmedInboundNo,
        trimmedWarehouseId,
      ]
    );
  } catch (error) {
    logger.error('[updateInboundDocumentSyncStatus] 更新入库单同步状态失败:', error);
    throw error;
  }
};

const rebuildInboundSummary = async (
  database: SQLite.SQLiteDatabase,
  warehouseId: string
): Promise<void> => {
  const summaryData = await database.getAllAsync<{
    warehouse_id: string;
    warehouse_name: string;
    inventory_code: string;
    scan_model: string;
    version: string;
    in_date: string;
    total_quantity: number;
    sourceNo: string;
    notes: string;
  }>(
    `SELECT
      warehouse_id,
      warehouse_name,
      inventory_code,
      scan_model,
      version,
      in_date,
      SUM(quantity) as total_quantity,
      GROUP_CONCAT(DISTINCT NULLIF(sourceNo, '')) as sourceNo,
      GROUP_CONCAT(DISTINCT NULLIF(notes, '')) as notes
     FROM inbound_records
     WHERE warehouse_id = ?
     GROUP BY warehouse_id, warehouse_name, inventory_code, scan_model, version, in_date
     ORDER BY in_date DESC, scan_model, version, inventory_code`,
    [warehouseId]
  );

  await database.runAsync('DELETE FROM inbound_summary WHERE warehouse_id = ?', [warehouseId]);

  const now = getISODateTime();
  for (const row of summaryData) {
    const id = generateId();
    await database.runAsync(
      `INSERT INTO inbound_summary (
        id, warehouse_id, warehouse_name, inventory_code, scan_model, version,
        in_date, total_quantity, sourceNo, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        row.warehouse_id,
        row.warehouse_name,
        row.inventory_code || null,
        row.scan_model,
        row.version || null,
        row.in_date,
        row.total_quantity,
        row.sourceNo || null,
        row.notes || null,
        now,
        now,
      ]
    );
  }

  logger.log(`[updateInboundSummary] 更新仓库 ${warehouseId} 的汇总数据，共 ${summaryData.length} 条记录`);
};

// 更新入库汇总表（按型号+版本号+入库日期每日汇总）
export const updateInboundSummary = async (warehouseId: string): Promise<void> => {
  try {
    const database = getDb();
    await rebuildInboundSummary(database, warehouseId);
  } catch (error) {
    logger.error('[updateInboundSummary] 更新入库汇总表失败:', error);
    throw error;
  }
};

// 获取入库汇总数据
export const getInboundSummary = async (
  warehouseId?: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> => {
  try {
    const database = getDb();

    let sql = 'SELECT * FROM inbound_summary WHERE 1=1';
    const params: any[] = [];

    if (warehouseId) {
      sql += ' AND warehouse_id = ?';
      params.push(warehouseId);
    }

    if (startDate) {
      sql += ' AND in_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND in_date <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY in_date DESC, scan_model, version';

    const result = await database.getAllAsync(sql, params);
    return result;
  } catch (error) {
    logger.error('[getInboundSummary] 获取入库汇总数据失败:', error);
    throw error;
  }
};

// 删除入库记录
export const deleteInboundRecord = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteInboundRecord] 无效的 id:', id);
      return;
    }

    const database = getDb();
    const trimmedId = id.trim();
    const record = await database.getFirstAsync<{ warehouse_id: string }>(
      'SELECT warehouse_id FROM inbound_records WHERE id = ?',
      [trimmedId]
    );

    if (!record?.warehouse_id) {
      return;
    }

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
    try {
      await database.runAsync('DELETE FROM inbound_records WHERE id = ?', [trimmedId]);
      await rebuildInboundSummary(database, record.warehouse_id);
      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'deleteInboundRecord');
      throw error;
    }
  } catch (error) {
    logger.error('[deleteInboundRecord] 删除入库记录失败:', error);
    throw error;
  }
};

export const deleteInboundDocument = async (
  inboundNo: string,
  warehouseId: string
): Promise<void> => {
  try {
    const trimmedInboundNo = inboundNo.trim();
    const trimmedWarehouseId = warehouseId.trim();

    if (!trimmedInboundNo || !trimmedWarehouseId) {
      logger.warn('[deleteInboundDocument] 无效的入库单参数:', { inboundNo, warehouseId });
      return;
    }

    const database = getDb();
    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      await database.runAsync(
        'DELETE FROM inbound_records WHERE inbound_no = ? AND warehouse_id = ?',
        [trimmedInboundNo, trimmedWarehouseId]
      );
      await rebuildInboundSummary(database, trimmedWarehouseId);
      await database.execAsync('COMMIT');
    } catch (error) {
      await rollbackTransaction(database, 'deleteInboundDocument');
      throw error;
    }
  } catch (error) {
    logger.error('[deleteInboundDocument] 删除入库单失败:', error);
    throw error;
  }
};

// ========== 盘点记录相关函数 ==========

// 生成盘点单号
export const generateCheckNo = async (): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[generateCheckNo] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const today = getLocalDateString();
    const todayPrefix = `PD-${today}`;

    const sequence = String(
      await getNextDailySequence(database, 'inventory_check_records', 'check_no', todayPrefix)
    ).padStart(3, '0');

    return `${todayPrefix}-${sequence}`;
  } catch (error) {
    logger.error('生成盘点单号失败:', error);
    return `PD-${getLocalDateString()}-001`;
  }
};

// 获取所有盘点记录
export const getAllInventoryCheckRecords = async (
  warehouseId?: string,
  checkType?: 'whole' | 'partial'
): Promise<InventoryCheckRecord[]> => {
  try {
    const database = getDb();
    let sql = `SELECT
      c.*,
      COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM inventory_check_records c
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(c.scan_model)`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE c.warehouse_id = ?';
      params.push(warehouseId);
    }

    if (checkType) {
      sql += warehouseId ? ' AND c.check_type = ?' : ' WHERE c.check_type = ?';
      params.push(checkType);
    }

    sql += ' ORDER BY c.created_at DESC';

    const results = await database.getAllAsync<any>(sql, params);

    return results.map((r) => ({
      ...r,
      customFields: stringToJson<Record<string, string>>(r.customFields),
    })) as InventoryCheckRecord[];
  } catch (error) {
    logger.error('获取盘点记录失败:', error);
    return [];
  }
};

export const getInventoryCheckExportSummaryRows = async (
  warehouseId?: string,
  checkType?: 'whole' | 'partial'
): Promise<InventoryCheckExportSummaryRow[]> => {
  try {
    const database = getDb();
    const params: SQLite.SQLiteBindValue[] = [];
    const conditions: string[] = [];

    if (warehouseId) {
      conditions.push('c.warehouse_id = ?');
      params.push(warehouseId);
    }

    if (checkType) {
      conditions.push('c.check_type = ?');
      params.push(checkType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await database.getAllAsync<any>(
      `SELECT
        COALESCE(c.warehouse_name, '') AS warehouse_name,
        COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code, '') AS inventory_code,
        COALESCE(c.scan_model, '') AS scan_model,
        COALESCE(c.version, '') AS version,
        COALESCE(c.package, '') AS package,
        SUM(
          CASE
            WHEN c.check_type = 'partial' THEN COALESCE(c.actual_quantity, c.quantity, 0)
            ELSE COALESCE(c.quantity, 0)
          END
        ) AS total_quantity,
        COALESCE(c.check_date, '') AS check_date
      FROM inventory_check_records c
      LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(c.scan_model)
      ${whereClause}
      GROUP BY
        COALESCE(c.warehouse_name, ''),
        COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code, ''),
        COALESCE(c.scan_model, ''),
        COALESCE(c.version, ''),
        COALESCE(c.package, ''),
        COALESCE(c.check_date, '')
      ORDER BY warehouse_name, check_date, inventory_code, scan_model, version`,
      params
    );

    return rows.map((row) => ({
      warehouse_name: row.warehouse_name || '',
      inventory_code: row.inventory_code || '',
      scan_model: row.scan_model || '',
      version: row.version || '',
      package: row.package || '',
      total_quantity: Number(row.total_quantity || 0),
      check_date: row.check_date || '',
    }));
  } catch (error) {
    logger.error('[getInventoryCheckExportSummaryRows] 获取盘点汇总失败:', error);
    return [];
  }
};

export const getInventoryCheckDocumentSummaries = async (
  warehouseId?: string
): Promise<InventoryCheckDocumentSummary[]> => {
  try {
    const database = getDb();
    let sql = `
      SELECT
        check_no,
        warehouse_id,
        MAX(warehouse_name) AS warehouse_name,
        MAX(check_date) AS check_date,
        MAX(created_at) AS created_at,
        COUNT(*) AS record_count,
        COUNT(DISTINCT TRIM(scan_model) || '|' || COALESCE(TRIM(version), '')) AS model_count,
        SUM(
          CASE
            WHEN check_type = 'partial' THEN COALESCE(actual_quantity, quantity, 0)
            ELSE COALESCE(quantity, 0)
          END
        ) AS total_quantity,
        SUM(CASE WHEN check_type = 'whole' THEN 1 ELSE 0 END) AS whole_count,
        SUM(CASE WHEN check_type = 'partial' THEN 1 ELSE 0 END) AS partial_count,
        CASE
          WHEN SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) = COUNT(*) THEN 'success'
          WHEN SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
          ELSE 'pending'
        END AS sync_status,
        MAX(sync_file_name) AS sync_file_name,
        MAX(synced_at) AS synced_at,
        MAX(sync_message) AS sync_message
      FROM inventory_check_records`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += `
      GROUP BY check_no, warehouse_id
      ORDER BY MAX(created_at) DESC, check_no DESC`;

    const rows = await database.getAllAsync<any>(sql, params);

    return rows.map((row) => ({
      check_no: row.check_no,
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name,
      check_date: row.check_date,
      created_at: row.created_at,
      record_count: Number(row.record_count || 0),
      model_count: Number(row.model_count || 0),
      total_quantity: Number(row.total_quantity || 0),
      whole_count: Number(row.whole_count || 0),
      partial_count: Number(row.partial_count || 0),
      sync_status: normalizeDocumentSyncStatus(row.sync_status),
      sync_file_name: row.sync_file_name || undefined,
      synced_at: row.synced_at || undefined,
      sync_message: row.sync_message || undefined,
    }));
  } catch (error) {
    logger.error('[getInventoryCheckDocumentSummaries] 获取盘点单列表失败:', error);
    return [];
  }
};

export const getInventoryCheckRecordsByNo = async (
  checkNo: string,
  warehouseId?: string
): Promise<InventoryCheckRecord[]> => {
  try {
    const trimmedCheckNo = checkNo.trim();
    if (!trimmedCheckNo) {
      return [];
    }

    const database = getDb();
    let sql = `SELECT
      c.id,
      c.check_no,
      c.warehouse_id,
      c.warehouse_name,
      COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code) AS inventory_code,
      c.scan_model,
      c.batch,
      c.quantity,
      c.check_type,
      c.actual_quantity,
      c.check_date,
      c.notes,
      c.created_at,
      c.package,
      c.version,
      c.productionDate,
      c.traceNo,
      c.sourceNo,
      c.customFields,
      c.sync_status,
      c.sync_file_name,
      c.synced_at,
      c.sync_message
    FROM inventory_check_records c
    LEFT JOIN inventory_bindings ib ON TRIM(ib.scan_model) = TRIM(c.scan_model)
    WHERE c.check_no = ?`;
    const params: any[] = [trimmedCheckNo];

    if (warehouseId) {
      sql += ' AND c.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY c.created_at DESC, c.id DESC';

    const rows = await database.getAllAsync<any>(sql, params);

    return rows.map((row) => ({
      ...row,
      customFields: stringToJson<Record<string, string>>(row.customFields),
    })) as InventoryCheckRecord[];
  } catch (error) {
    logger.error('[getInventoryCheckRecordsByNo] 获取盘点单明细失败:', error);
    return [];
  }
};

type InventoryCheckRecordInsert = Omit<InventoryCheckRecord, 'id' | 'created_at'>;

const insertInventoryCheckRecord = async (
  database: SQLite.SQLiteDatabase,
  record: InventoryCheckRecordInsert,
  options?: {
    id?: string;
    createdAt?: string;
  }
): Promise<string> => {
  const id = options?.id || generateId();
  const createdAt = options?.createdAt || getISODateTime();
  const quantity = parseQuantity(record.quantity, { min: 1 });
  const actualQuantity =
    record.actual_quantity !== null && record.actual_quantity !== undefined
      ? parseQuantity(record.actual_quantity, { min: 0 })
      : null;

  if (quantity === null) {
    throw new Error('盘点数量无效，必须为大于 0 的整数');
  }

  if (
    record.actual_quantity !== null &&
    record.actual_quantity !== undefined &&
    actualQuantity === null
  ) {
    throw new Error('实际盘点数量无效，必须为不小于 0 的整数');
  }

  await database.runAsync(
    `INSERT INTO inventory_check_records (
      id, check_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
      quantity, check_type, actual_quantity, check_date, notes, created_at, package,
      version, productionDate, traceNo, sourceNo, customFields, sync_status, sync_file_name,
      synced_at, sync_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.check_no,
      record.warehouse_id,
      record.warehouse_name,
      record.inventory_code,
      record.scan_model,
      record.batch,
      quantity,
      record.check_type,
      actualQuantity,
      record.check_date,
      record.notes || null,
      createdAt,
      record.package || null,
      record.version || null,
      record.productionDate || null,
      record.traceNo || null,
      record.sourceNo || null,
      record.customFields ? jsonToString(record.customFields) : null,
      record.sync_status || 'pending',
      record.sync_file_name || null,
      record.synced_at || null,
      record.sync_message || null,
    ]
  );

  return id;
};

// 添加盘点记录
export const addInventoryCheckRecord = async (
  record: InventoryCheckRecordInsert
): Promise<string> => {
  try {
    if (!db) {
      logger.warn('[addInventoryCheckRecord] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    return await insertInventoryCheckRecord(database, record);
  } catch (error) {
    logger.error('添加盘点记录失败:', error);
    throw error;
  }
};

export const addInventoryCheckRecordsBatch = async (
  records: InventoryCheckRecordInsert[]
): Promise<string[]> => {
  if (records.length === 0) {
    return [];
  }

  try {
    if (!db) {
      logger.warn('[addInventoryCheckRecordsBatch] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const ids: string[] = [];
    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      assertUniqueTraceNosInBatch(records, '盘点记录');
      await assertInventoryTraceNosNotAlreadySaved(database, records);

      for (const record of records) {
        ids.push(await insertInventoryCheckRecord(database, record));
      }
      await database.execAsync('COMMIT');
      return ids;
    } catch (error) {
      await rollbackTransaction(database, 'addInventoryCheckRecordsBatch');
      throw error;
    }
  } catch (error) {
    logger.error('批量添加盘点记录失败:', error);
    throw error;
  }
};

export const updateInventoryCheckDocumentSyncStatus = async (
  checkNo: string,
  warehouseId: string,
  status: DocumentSyncStatus,
  fileName?: string,
  message?: string
): Promise<void> => {
  const trimmedCheckNo = checkNo.trim();
  const trimmedWarehouseId = warehouseId.trim();
  if (!trimmedCheckNo || !trimmedWarehouseId) {
    return;
  }

  try {
    const database = getDb();
    await database.runAsync(
      `UPDATE inventory_check_records
       SET sync_status = ?,
           sync_file_name = ?,
           synced_at = ?,
           sync_message = ?
       WHERE check_no = ? AND warehouse_id = ?`,
      [
        status,
        status === 'success' ? fileName || null : null,
        status === 'success' ? getISODateTime() : null,
        status === 'failed' ? message || null : null,
        trimmedCheckNo,
        trimmedWarehouseId,
      ]
    );
  } catch (error) {
    logger.error('[updateInventoryCheckDocumentSyncStatus] 更新盘点单同步状态失败:', error);
    throw error;
  }
};

// 删除盘点记录
export const deleteInventoryCheckRecord = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteInventoryCheckRecord] 无效的 id:', id);
      return;
    }

    const database = getDb();
    await database.runAsync('DELETE FROM inventory_check_records WHERE id = ?', [id.trim()]);
  } catch (error) {
    logger.error('[deleteInventoryCheckRecord] 删除盘点记录失败:', error);
    throw error;
  }
};

export const deleteInventoryCheckDocument = async (
  checkNo: string,
  warehouseId: string
): Promise<void> => {
  try {
    const trimmedCheckNo = checkNo.trim();
    const trimmedWarehouseId = warehouseId.trim();

    if (!trimmedCheckNo || !trimmedWarehouseId) {
      logger.warn('[deleteInventoryCheckDocument] 无效的盘点单参数:', { checkNo, warehouseId });
      return;
    }

    const database = getDb();
    await database.runAsync(
      'DELETE FROM inventory_check_records WHERE check_no = ? AND warehouse_id = ?',
      [trimmedCheckNo, trimmedWarehouseId]
    );
  } catch (error) {
    logger.error('[deleteInventoryCheckDocument] 删除盘点单失败:', error);
    throw error;
  }
};

// ========== 二维码规则相关函数 ==========

// 获取所有规则
export const getAllRules = async (): Promise<QRCodeRule[]> => {
  try {
    const database = getDb();
    const results = await database.getAllAsync<any>('SELECT * FROM qr_code_rules');

    return sortRulesByPriority(results.map(normalizeRuleRecord));
  } catch (error) {
    logger.error('获取规则列表失败:', error);
    return [];
  }
};

// 获取启用的规则
export const getActiveRules = async (): Promise<QRCodeRule[]> => {
  try {
    const rules = await getAllRules();
    return rules.filter((r) => r.isActive);
  } catch (error) {
    logger.error('获取启用规则失败:', error);
    return [];
  }
};

// 添加规则
export const addRule = async (
  rule: Omit<QRCodeRule, 'id' | 'created_at' | 'updated_at'>
): Promise<string> => {
  try {
    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();

    await database.runAsync(
      `INSERT INTO qr_code_rules (
        id, name, description, separator, field_order, custom_field_ids, is_active,
        supplier_name, match_conditions, field_prefixes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        rule.name,
        rule.description || null,
        rule.separator,
        jsonToString(rule.fieldOrder),
        rule.customFieldIds ? jsonToString(rule.customFieldIds) : null,
        rule.isActive ? 1 : 0,
        rule.supplierName || null,
        rule.matchConditions ? jsonToString(rule.matchConditions) : null,
        rule.fieldPrefixes ? jsonToString(rule.fieldPrefixes) : null,
        isoDateTime,
        isoDateTime,
      ]
    );

    return id;
  } catch (error) {
    logger.error('添加规则失败:', error);
    throw error;
  }
};

const QR_RULE_UPDATE_COLUMN_MAP: Partial<Record<keyof QRCodeRule, string>> = {
  name: 'name',
  description: 'description',
  separator: 'separator',
};

// 更新规则
export const updateRule = async (id: string, updates: Partial<QRCodeRule>): Promise<void> => {
  try {
    const database = getDb();
    const updateFields: string[] = [];
    const values: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined) {
        return;
      }

      if (key === 'isActive') {
        updateFields.push('is_active = ?');
        values.push(value ? 1 : 0);
      } else if (key === 'fieldOrder') {
        updateFields.push('field_order = ?');
        values.push(jsonToString(value));
      } else if (key === 'customFieldIds') {
        updateFields.push('custom_field_ids = ?');
        values.push(jsonToString(value));
      } else if (key === 'matchConditions') {
        updateFields.push('match_conditions = ?');
        values.push(jsonToString(value));
      } else if (key === 'fieldPrefixes') {
        updateFields.push('field_prefixes = ?');
        values.push(jsonToString(value));
      } else if (key === 'supplierName') {
        updateFields.push('supplier_name = ?');
        values.push(value || null);
      } else if (key === 'id' || key === 'created_at' || key === 'updated_at') {
        return;
      } else {
        const column = QR_RULE_UPDATE_COLUMN_MAP[key as keyof QRCodeRule];
        if (!column) {
          logger.warn('[updateRule] 忽略不支持更新的字段:', key);
          return;
        }
        updateFields.push(`${column} = ?`);
        values.push(value);
      }
    });

    if (updateFields.length > 0) {
      updateFields.push('updated_at = ?');
      values.push(getISODateTime());
      values.push(id);
      await database.runAsync(
        `UPDATE qr_code_rules SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
    }
  } catch (error) {
    logger.error('更新规则失败:', error);
    throw error;
  }
};

// 删除规则
export const deleteRule = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteRule] 无效的 id:', id);
      return;
    }

    const database = getDb();
    await database.runAsync('DELETE FROM qr_code_rules WHERE id = ?', [id.trim()]);
  } catch (error) {
    logger.error('[deleteRule] 删除规则失败:', error);
    throw error;
  }
};

// 根据ID获取规则
export const getRuleById = async (id: string): Promise<QRCodeRule | null> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[getRuleById] 无效的 id:', id);
      return null;
    }

    const database = getDb();
    const result = await database.getFirstAsync<any>('SELECT * FROM qr_code_rules WHERE id = ?', [
      id.trim(),
    ]);

    if (!result) return null;

    return normalizeRuleRecord(result);
  } catch (error) {
    logger.error('获取规则失败:', error);
    return null;
  }
};

// ========== 自定义字段相关函数 ==========

// 初始化默认自定义字段
export const initDefaultCustomFields = async (): Promise<void> => {
  // SQLite 已在 initDatabase 中创建表，无需额外初始化
};

// 获取所有自定义字段
export const getAllCustomFields = async (): Promise<CustomField[]> => {
  try {
    const database = getDb();
    await database.runAsync("UPDATE custom_fields SET type = 'text' WHERE type NOT IN ('text', 'select')");
    const results = await database.getAllAsync<CustomFieldRow>(
      'SELECT * FROM custom_fields ORDER BY sort_order ASC'
    );

    return results.map(normalizeCustomFieldRecord);
  } catch (error) {
    logger.error('获取自定义字段列表失败:', error);
    return [];
  }
};

// 添加自定义字段
export const addCustomField = async (
  field: Omit<CustomField, 'id' | 'created_at' | 'updated_at' | 'sortOrder'>
): Promise<string> => {
  try {
    if (!isCustomFieldType(field.type)) {
      throw new Error(`无效的自定义字段类型: ${String(field.type)}`);
    }

    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();
    const normalizedOptions = field.type === 'select' ? field.options : undefined;

    // 获取当前最大排序值
    const maxResult = await database.getFirstAsync<{ max: number }>(
      'SELECT MAX(sort_order) as max FROM custom_fields'
    );
    const maxSort = Number(maxResult?.max ?? 0) || 0;

    await database.runAsync(
      'INSERT INTO custom_fields (id, name, type, required, options, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        field.name,
        field.type,
        field.required ? 1 : 0,
        normalizedOptions ? jsonToString(normalizedOptions) : null,
        maxSort + 1,
        isoDateTime,
        isoDateTime,
      ]
    );

    return id;
  } catch (error) {
    logger.error('添加自定义字段失败:', error);
    throw error;
  }
};

// 更新自定义字段
export const updateCustomField = async (
  id: string,
  updates: Partial<CustomField>
): Promise<void> => {
  try {
    const database = getDb();
    const updateFields: string[] = [];
    const values: SQLite.SQLiteBindValue[] = [];

    if (typeof updates.name === 'string') {
      updateFields.push('name = ?');
      values.push(updates.name.trim());
    }

    if (updates.type !== undefined) {
      if (!isCustomFieldType(updates.type)) {
        throw new Error(`无效的自定义字段类型: ${String(updates.type)}`);
      }
      updateFields.push('type = ?');
      values.push(updates.type);

      if (updates.type !== 'select' && updates.options === undefined) {
        updateFields.push('options = ?');
        values.push(null);
      }
    }

    if (updates.required !== undefined) {
      updateFields.push('required = ?');
      values.push(updates.required ? 1 : 0);
    }

    if (updates.options !== undefined) {
      updateFields.push('options = ?');
      values.push(updates.options.length > 0 ? jsonToString(updates.options) : null);
    }

    if (updates.sortOrder !== undefined) {
      const normalizedSortOrder = Number(updates.sortOrder);
      if (!Number.isInteger(normalizedSortOrder) || normalizedSortOrder <= 0) {
        throw new Error(`无效的自定义字段排序值: ${String(updates.sortOrder)}`);
      }
      updateFields.push('sort_order = ?');
      values.push(normalizedSortOrder);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = ?');
      values.push(getISODateTime());
      values.push(id);
      await database.runAsync(
        `UPDATE custom_fields SET ${updateFields.join(', ')} WHERE id = ?`,
        values
      );
    }
  } catch (error) {
    logger.error('更新自定义字段失败:', error);
    throw error;
  }
};

// 删除自定义字段
export const deleteCustomField = async (id: string): Promise<void> => {
  try {
    // 参数验证
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteCustomField] 无效的 id:', id);
      return;
    }

    const database = getDb();
    const trimmedId = id.trim();
    const customFieldKey = createCustomFieldKey(trimmedId);
    const rules = await database.getAllAsync<any>('SELECT * FROM qr_code_rules');

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      for (const rawRule of rules) {
        const rule = normalizeRuleRecord(rawRule);
        const removedFieldIndex = rule.fieldOrder.findIndex((field) => field === customFieldKey);

        if (removedFieldIndex === -1 && !(rule.customFieldIds || []).includes(trimmedId)) {
          continue;
        }

        const nextFieldOrder = rule.fieldOrder.filter((field) => field !== customFieldKey);
        const nextCustomFieldIds = (rule.customFieldIds || []).filter(
          (fieldId) => fieldId !== trimmedId
        );
        const nextFieldPrefixes = Object.fromEntries(
          Object.entries(rule.fieldPrefixes || {}).filter(
            ([fieldKey]) => fieldKey !== customFieldKey
          )
        ) as FieldPrefixes;
        const nextMatchConditions = (rule.matchConditions || []).flatMap((condition) => {
          if (removedFieldIndex === -1) {
            return [condition];
          }

          if (condition.fieldIndex === removedFieldIndex) {
            return [];
          }

          if (condition.fieldIndex > removedFieldIndex) {
            return [{ ...condition, fieldIndex: condition.fieldIndex - 1 }];
          }

          return [condition];
        });

        await database.runAsync(
          `UPDATE qr_code_rules
           SET field_order = ?, custom_field_ids = ?, field_prefixes = ?, match_conditions = ?, updated_at = ?
           WHERE id = ?`,
          [
            jsonToString(nextFieldOrder),
            jsonToString(nextCustomFieldIds),
            jsonToString(nextFieldPrefixes),
            jsonToString(nextMatchConditions),
            getISODateTime(),
            rule.id,
          ]
        );
      }

      await database.runAsync('DELETE FROM custom_fields WHERE id = ?', [trimmedId]);
      await database.execAsync('COMMIT');
    } catch (ruleCleanupError) {
      await database.execAsync('ROLLBACK');
      throw ruleCleanupError;
    }
  } catch (error) {
    logger.error('[deleteCustomField] 删除自定义字段失败:', error);
    throw error;
  }
};

// 重新排序自定义字段
export const reorderCustomFields = async (fieldIds: string[]): Promise<void> => {
  const database = getDb();
  try {
    await database.execAsync('BEGIN TRANSACTION');

    for (let i = 0; i < fieldIds.length; i++) {
      await database.runAsync('UPDATE custom_fields SET sort_order = ? WHERE id = ?', [
        i,
        fieldIds[i],
      ]);
    }

    await database.execAsync('COMMIT');
  } catch (error) {
    await rollbackTransaction(database, 'reorderCustomFields');
    logger.error('重新排序自定义字段失败:', error);
    throw error;
  }
};

// ========== 二维码解析相关函数（逻辑部分，不涉及存储） ==========

// 支持的括号分隔符格式
const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '[': ']',
  '<': '>',
};

// 检测预设括号格式并返回左括号
const detectBracketFormat = (str: string): string | null => {
  for (const left of Object.keys(BRACKET_PAIRS)) {
    const right = BRACKET_PAIRS[left];
    if (str.startsWith(left) && str.includes(right + left)) {
      return left;
    }
  }
  return null;
};

// 解析预设括号格式
const splitByBracket = (str: string, leftBracket: string): string[] => {
  const rightBracket = BRACKET_PAIRS[leftBracket];
  let s = str.trim();
  if (s.startsWith(leftBracket)) s = s.slice(1);
  if (s.endsWith(rightBracket)) s = s.slice(0, -1);
  return s.split(rightBracket + leftBracket).map((p) => p.trim());
};

const splitBySeparator = (content: string, separator: string): string[] => {
  return content.split(separator).map((part) => part.trim());
};

const normalizeMatchText = (value: string): string => value.trim().toLowerCase();

const getConfiguredFieldPrefixMatchLength = (value: string, prefix?: string): number | null => {
  const normalizedPrefix = prefix?.replace(/\s+/g, '').toLowerCase();
  if (!normalizedPrefix) {
    return null;
  }

  let consumedLength = 0;
  let normalizedHead = '';

  while (consumedLength < value.length && normalizedHead.length < normalizedPrefix.length) {
    const char = value[consumedLength];
    consumedLength += 1;

    if (!/\s/.test(char)) {
      normalizedHead += char.toLowerCase();
    }
  }

  return normalizedHead === normalizedPrefix ? consumedLength : null;
};

const doesConfiguredFieldPrefixMatch = (value: string, prefix?: string): boolean => {
  return getConfiguredFieldPrefixMatchLength(value, prefix) !== null;
};

const getRulePrefixStats = (rule: QRCodeRule, parts: string[]) => {
  let configuredCount = 0;
  let matchedCount = 0;

  (rule.fieldOrder || []).forEach((fieldName, index) => {
    const prefix = rule.fieldPrefixes?.[fieldName];
    if (!prefix?.trim()) {
      return;
    }

    configuredCount += 1;

    if (index < parts.length && doesConfiguredFieldPrefixMatch(parts[index], prefix)) {
      matchedCount += 1;
    }
  });

  return { configuredCount, matchedCount };
};

type RuleDetectionCandidate = {
  rule: QRCodeRule;
  parts: string[];
  fieldCount: number;
  configuredPrefixCount: number;
  matchedPrefixCount: number;
};

const compareRuleDetectionCandidates = (
  a: RuleDetectionCandidate,
  b: RuleDetectionCandidate
): number => {
  if (a.matchedPrefixCount !== b.matchedPrefixCount) {
    return b.matchedPrefixCount - a.matchedPrefixCount;
  }

  if (a.matchedPrefixCount === 0 && a.configuredPrefixCount !== b.configuredPrefixCount) {
    if (a.configuredPrefixCount === 0) return -1;
    if (b.configuredPrefixCount === 0) return 1;
  }

  if (a.matchedPrefixCount > 0 && a.configuredPrefixCount !== b.configuredPrefixCount) {
    return b.configuredPrefixCount - a.configuredPrefixCount;
  }

  if (a.fieldCount !== b.fieldCount) {
    return b.fieldCount - a.fieldCount;
  }

  const updatedDiff =
    parseStoredDateTimeToMillis(b.rule.updated_at) - parseStoredDateTimeToMillis(a.rule.updated_at);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const createdDiff =
    parseStoredDateTimeToMillis(b.rule.created_at) - parseStoredDateTimeToMillis(a.rule.created_at);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return a.rule.name.localeCompare(b.rule.name, 'zh-CN');
};

// 根据二维码内容自动识别规则
export const detectRule = async (content: string): Promise<QRCodeRule | null> => {
  try {
    const rules = await getActiveRules();

    // 从规则中提取所有唯一的分隔符
    const ruleSeparators = [...new Set(rules.map((r) => r.separator))];
    const commonSeparators = ['||', '|', ',', '*', '#', ';', ':', '\t'];
    const allSeparators = [...ruleSeparators, ...commonSeparators];
    const uniqueSeparators = [...new Set(allSeparators)];

    // 检测是否是 URL
    const isURL = (str: string): boolean => {
      const lower = str.toLowerCase();
      return (
        lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('ftp://') ||
        lower.startsWith('sftp://')
      );
    };

    // 计算每种分隔符能拆分出多少字段（保留空字段，避免字段位置错位）
    const separatorPartsCount: { separator: string; count: number; parts: string[] }[] = [];

    // 优先检测预设括号格式
    const bracketLeft = detectBracketFormat(content);
    if (bracketLeft) {
      const parts = splitByBracket(content, bracketLeft);
      if (parts.length >= 2) {
        separatorPartsCount.push({
          separator: bracketLeft + BRACKET_PAIRS[bracketLeft],
          count: parts.length,
          parts,
        });
      }
    }

    // 检测其他分隔符
    for (const sep of uniqueSeparators) {
      if ((sep === '/' || sep === '//') && isURL(content)) continue;

      const parts = splitBySeparator(content, sep);
      if (parts.length >= 2) {
        separatorPartsCount.push({ separator: sep, count: parts.length, parts });
      }
    }

    const buildCandidate = (rule: QRCodeRule, parts: string[]): RuleDetectionCandidate => {
      const fieldCount = rule.fieldOrder?.length || 0;
      const prefixStats = getRulePrefixStats(rule, parts);
      return {
        rule,
        parts,
        fieldCount,
        configuredPrefixCount: prefixStats.configuredCount,
        matchedPrefixCount: prefixStats.matchedCount,
      };
    };

    const selectBestCandidate = (candidates: RuleDetectionCandidate[]): QRCodeRule | null => {
      if (candidates.length === 0) {
        return null;
      }

      return candidates.slice().sort(compareRuleDetectionCandidates)[0].rule;
    };

    const conditionedCandidates: RuleDetectionCandidate[] = [];
    const exactCandidates: RuleDetectionCandidate[] = [];

    for (const { separator, count, parts } of separatorPartsCount) {
      const matchingRules = rules.filter((rule) => rule.separator === separator);
      if (matchingRules.length === 0) {
        continue;
      }

      matchingRules
        .filter((rule) => (rule.matchConditions?.length || 0) > 0)
        .forEach((rule) => {
          const ruleFieldCount = rule.fieldOrder?.length || 0;
          if (ruleFieldCount !== count) {
            return;
          }

          const allMatch = (rule.matchConditions || []).every((condition) => {
            if (condition.fieldIndex < 0 || condition.fieldIndex >= parts.length) return false;
            return normalizeMatchText(parts[condition.fieldIndex]).includes(
              normalizeMatchText(condition.keyword)
            );
          });

          if (allMatch) {
            conditionedCandidates.push(buildCandidate(rule, parts));
          }
        });

      matchingRules
        .filter((rule) => (rule.fieldOrder?.length || 0) === count)
        .forEach((rule) => {
          exactCandidates.push(buildCandidate(rule, parts));
        });

    }

    const conditionedMatch = selectBestCandidate(conditionedCandidates);
    if (conditionedMatch) {
      return conditionedMatch;
    }

    const exactMatch = selectBestCandidate(exactCandidates);
    if (exactMatch) {
      return exactMatch;
    }

    // 没有匹配的规则，尝试自动识别
    if (separatorPartsCount.length > 0) {
      const best = separatorPartsCount
        .slice()
        .sort((a, b) => b.count - a.count || b.separator.length - a.separator.length)[0];
      return {
        id: 'auto_detect',
        name: '自动识别',
        description: `自动识别的分隔符: ${best.separator}`,
        separator: best.separator,
        fieldOrder: AVAILABLE_FIELDS.slice(0, Math.min(best.count, AVAILABLE_FIELDS.length)),
        isActive: true,
        created_at: getISODateTime(),
        updated_at: getISODateTime(),
      };
    }

    return null;
  } catch (error) {
    logger.error('识别规则失败:', error);
    return null;
  }
};

const stripConfiguredFieldPrefix = (value: string, prefix?: string): string => {
  const consumedLength = getConfiguredFieldPrefixMatchLength(value, prefix);
  if (consumedLength === null) {
    return value;
  }

  return value.slice(consumedLength).trim();
};

// 使用规则解析二维码内容
export const parseWithRule = (
  content: string,
  rule: QRCodeRule
): {
  standardFields: Record<string, string>;
  customFields: Record<string, string>;
} => {
  let parts: string[];

  // 检测是否为括号分隔符
  const bracketLeft = detectBracketFormat(content);
  if (bracketLeft) {
    parts = splitByBracket(content, bracketLeft);
  } else {
    parts = splitBySeparator(content, rule.separator);
  }

  // 提取标准字段和自定义字段
  const standardFields: Record<string, string> = {};
  const customFields: Record<string, string> = {};

  rule.fieldOrder.forEach((fieldName, index) => {
    if (index < parts.length) {
      const parsedValue = stripConfiguredFieldPrefix(parts[index], rule.fieldPrefixes?.[fieldName]);
      if (isCustomField(fieldName)) {
        customFields[getCustomFieldId(fieldName)] = parsedValue;
      } else {
        standardFields[fieldName] = parsedValue;
      }
    }
  });

  return { standardFields, customFields };
};

// ========== 备份和恢复相关函数 ==========

// 导出备份数据
export const exportBackupData = async (): Promise<BackupData> => {
  try {
    const [
      rules,
      customFields,
      inventoryBindings,
      warehouses,
      outboundWarehouseOrderRules,
      savedSyncConfig,
    ] = await Promise.all([
      getAllRules(),
      getAllCustomFields(),
      getAllInventoryBindings(),
      getAllWarehouses(),
      loadOutboundWarehouseOrderRules(),
      AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG),
    ]);

    const syncConfig = safeJsonParseNullable<SyncConfig>(
      savedSyncConfig,
      'database.backup.syncConfig',
      (value): value is SyncConfig =>
        typeof value === 'object' &&
        value !== null &&
        typeof (value as SyncConfig).ip === 'string' &&
        typeof (value as SyncConfig).port === 'string'
    );

    const backup: BackupData = {
      version: CURRENT_DATA_VERSION,
      timestamp: getISODateTime(),
      backupTime: getISODateTime(),
      // 只导出配置数据
      rules,
      customFields,
      // V3.0 新增
      inventoryBindings,
      warehouses,
      outboundWarehouseOrderRules,
      stats: {
        rules: rules.length,
        customFields: customFields.length,
        inventoryBindings: inventoryBindings.length,
        warehouses: warehouses.length,
        outboundWarehouseOrderRules: Object.keys(outboundWarehouseOrderRules).length,
        hasSyncConfig: !!savedSyncConfig,
      },
      // 同步服务器配置
      syncConfig,
    };
    return backup;
  } catch (error) {
    logger.error('导出备份数据失败:', error);
    throw error;
  }
};

// 导入备份数据
export const importBackupData = async (
  backup: BackupData
): Promise<{
  success: boolean;
  message: string;
  warnings?: string[];
  stats?: {
    rules: number;
    customFields: number;
    inventoryBindings: number;
    warehouses: number;
    outboundWarehouseOrderRules?: number;
    hasSyncConfig?: boolean;
    syncConfigRestored?: boolean;
    outboundWarehouseOrderRulesRestored?: boolean;
  };
}> => {
  try {
    if (!isBackupDataShape(backup)) {
      throw new Error('备份文件结构无效');
    }

    const database = getDb();

    // 1. 检查程序中是否有配置数据
    const currentStats = await getConfigStats();
    const hasConfigData =
      (currentStats.warehouses ?? 0) > 0 ||
      currentStats.rules > 0 ||
      currentStats.customFields > 0 ||
      (currentStats.inventoryBindings ?? 0) > 0;

    // 2. 统一在事务里替换配置，避免删旧后导入失败留下半套配置
    if (hasConfigData) {
      logger.log('程序中已有配置数据，将在事务中替换配置');
    } else {
      logger.log('程序为空，直接导入配置');
    }

    const warnings: string[] = [];
    const backupWarehouses = backup.warehouses || [];
    const backupWarehouseIds = new Set(backupWarehouses.map((warehouse) => warehouse.id));
    const backupHasDefaultWarehouse = backupWarehouses.some((warehouse) => warehouse.is_default);
    const referencedWarehouseRows = await database.getAllAsync<{ id: string }>(`
      SELECT DISTINCT warehouse_id AS id FROM orders WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM materials WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM inbound_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM inbound_summary WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM inventory_check_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM unpack_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
    `);
    const referencedWarehouseIds = referencedWarehouseRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const preservedLocalWarehouseIds = referencedWarehouseIds.filter((id) => !backupWarehouseIds.has(id));

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      await database.runAsync('DELETE FROM inventory_bindings');
      await database.runAsync('DELETE FROM qr_code_rules');
      await database.runAsync('DELETE FROM custom_fields');

      if (referencedWarehouseIds.length > 0) {
        await database.runAsync(
          `DELETE FROM warehouses WHERE id NOT IN (${referencedWarehouseIds.map(() => '?').join(',')})`,
          referencedWarehouseIds
        );
      } else {
        await database.runAsync('DELETE FROM warehouses');
      }

      if (backupHasDefaultWarehouse) {
        await database.runAsync('UPDATE warehouses SET is_default = 0');
      }

      // 3. 导入仓库（因为物料绑定依赖仓库）
      if (backupWarehouses.length > 0) {
        for (const [index, warehouse] of backupWarehouses.entries()) {
          try {
            const sortOrder =
              getBackupSortOrder(warehouse as unknown as Record<string, unknown>) ?? index;
            await database.runAsync(
              'INSERT OR REPLACE INTO warehouses (id, name, description, is_default, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [
                warehouse.id,
                warehouse.name,
                warehouse.description || null,
                warehouse.is_default ? 1 : 0,
                sortOrder,
                warehouse.created_at || getISODateTime(),
              ]
            );
          } catch (e) {
            logger.error('导入仓库失败:', warehouse, e);
            throw new Error(`导入仓库失败: ${warehouse.name} - ${e}`);
          }
        }
      }

      // 4. 导入解析规则
      if (backup.rules && backup.rules.length > 0) {
        for (const rule of backup.rules) {
          try {
            await database.runAsync(
              `INSERT INTO qr_code_rules (
                id, name, description, separator, field_order, custom_field_ids,
                is_active, supplier_name, match_conditions, field_prefixes, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                rule.id,
                rule.name,
                rule.description || '',
                rule.separator || '',
                JSON.stringify(rule.fieldOrder || []),
                JSON.stringify(rule.customFieldIds || []),
                rule.isActive ? 1 : 0,
                rule.supplierName || '',
                JSON.stringify(rule.matchConditions || []),
                JSON.stringify(rule.fieldPrefixes || {}),
                rule.created_at || getISODateTime(),
                rule.updated_at || getISODateTime(),
              ]
            );
          } catch (e) {
            logger.error('导入解析规则失败:', rule, e);
            throw new Error(`导入解析规则失败: ${rule.name} - ${e}`);
          }
        }
      }

      // 5. 导入自定义字段
      if (backup.customFields && backup.customFields.length > 0) {
        for (const field of backup.customFields) {
          try {
            const sortOrder = getBackupSortOrder(field as unknown as Record<string, unknown>) ?? 0;
            await database.runAsync(
              `INSERT INTO custom_fields (
                id, name, type, required, options, sort_order, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                field.id,
                field.name,
                field.type === 'select' ? 'select' : 'text',
                field.required ? 1 : 0,
                JSON.stringify(field.options || []),
                sortOrder,
                field.created_at || getISODateTime(),
                field.updated_at || getISODateTime(),
              ]
            );
          } catch (e) {
            logger.error('导入自定义字段失败:', field, e);
            throw new Error(`导入自定义字段失败: ${field.name} - ${e}`);
          }
        }
      }

      // 6. 导入物料绑定
      if (backup.inventoryBindings && backup.inventoryBindings.length > 0) {
        for (const binding of backup.inventoryBindings) {
          try {
            await database.runAsync(
              'INSERT INTO inventory_bindings (id, scan_model, inventory_code, supplier, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [
                binding.id,
                binding.scan_model,
                binding.inventory_code,
                binding.supplier || null,
                binding.description || null,
                binding.created_at || getISODateTime(),
              ]
            );
          } catch (e) {
            logger.error('导入物料绑定失败:', binding, e);
            throw new Error(`导入物料绑定失败: ${binding.scan_model} - ${e}`);
          }
        }
      }

      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }

    if (preservedLocalWarehouseIds.length > 0) {
      warnings.push(`已保留 ${preservedLocalWarehouseIds.length} 个仍被业务数据引用的本地仓库，避免历史记录失去仓库归属。`);
    }

    let syncConfigRestored = !backup.syncConfig;
    let outboundWarehouseOrderRulesRestored =
      backup.outboundWarehouseOrderRules === undefined;

    if (backup.outboundWarehouseOrderRules !== undefined) {
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.OUTBOUND_WAREHOUSE_ORDER_RULES,
          JSON.stringify(backup.outboundWarehouseOrderRules)
        );
        outboundWarehouseOrderRulesRestored = true;
      } catch (e) {
        logger.error('导入出库单号仓库绑定规则失败:', e);
        warnings.push('出库单号仓库绑定规则未能写入本地存储，请在设置页重新确认样例规则。');
      }
    }

    // 7. 导入同步服务器配置
    if (backup.syncConfig) {
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(backup.syncConfig));
        syncConfigRestored = true;
      } catch (e) {
        logger.error('导入同步配置失败:', e);
        warnings.push('同步服务器配置未能写入本地存储，请在设置页重新确认服务器地址和端口。');
      }
    } else {
      try {
        await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_CONFIG);
        syncConfigRestored = true;
      } catch (e) {
        logger.error('清理旧同步配置失败:', e);
        warnings.push('旧的同步服务器配置未能清理，本地可能仍保留之前的服务器地址。');
      }
    }

    return {
      success: true,
      message: warnings.length > 0 ? '配置已导入，但部分本地配置未能完成恢复' : '配置导入成功',
      warnings: warnings.length > 0 ? warnings : undefined,
      stats: {
        rules: backup.rules?.length || 0,
        customFields: backup.customFields?.length || 0,
        inventoryBindings: backup.inventoryBindings?.length || 0,
        warehouses: backup.warehouses?.length || 0,
        outboundWarehouseOrderRules: Object.keys(backup.outboundWarehouseOrderRules || {}).length,
        hasSyncConfig: !!backup.syncConfig,
        syncConfigRestored,
        outboundWarehouseOrderRulesRestored,
      },
    };
  } catch (error) {
    logger.error('导入备份数据失败:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '数据导入失败',
    };
  }
};

// ========== 配置统计相关函数 ==========

export const getConfigStats = async (): Promise<{
  rules: number;
  customFields: number;
  inventoryBindings?: number;
  warehouses?: number;
}> => {
  try {
    const database = getDb();
    const rules = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM qr_code_rules'
    );
    const customFields = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM custom_fields'
    );
    const warehouses = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM warehouses'
    );
    const inventoryBindings = await database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM inventory_bindings'
    );

    return {
      rules: rules?.count || 0,
      customFields: customFields?.count || 0,
      warehouses: warehouses?.count || 0,
      inventoryBindings: inventoryBindings?.count || 0,
    };
  } catch (error) {
    logger.error('获取配置统计失败:', error);
    return {
      rules: 0,
      customFields: 0,
      warehouses: 0,
      inventoryBindings: 0,
    };
  }
};

// ========== 导出统计相关函数 ==========

export const getTodayExportCount = async (type: ExportType): Promise<number> => {
  try {
    // SQLite 中使用 system_config 表存储统计
    const database = getDb();
    const today = getLocalDateString();
    const key = `export_count_${type}_${today}`;

    const result = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM system_config WHERE key = ?',
      [key]
    );

    return result ? parseInt(result.value, 10) : 0;
  } catch (error) {
    logger.error('获取导出统计失败:', error);
    return 0;
  }
};

export const incrementExportCount = async (type: ExportType): Promise<number> => {
  try {
    const database = getDb();
    const today = getLocalDateString();
    const key = `export_count_${type}_${today}`;

    const current = await getTodayExportCount(type);
    const nextCount = current + 1;

    await database.runAsync('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', [
      key,
      nextCount.toString(),
    ]);

    return nextCount;
  } catch (error) {
    logger.error('更新导出统计失败:', error);
    return 0;
  }
};

// ========== 数据库文件备份/恢复 ==========

const SQLITE_FILE_HEADER = 'SQLite format 3\u0000';
const RESTORE_SCHEMA_REQUIREMENTS: Record<string, string[]> = {
  system_config: ['key', 'value'],
  orders: ['id', 'order_no', 'created_at'],
  materials: ['id', 'order_no', 'quantity', 'scanned_at', 'warehouse_id'],
  qr_code_rules: ['id', 'name', 'separator', 'field_order', 'is_active', 'field_prefixes'],
  custom_fields: ['id', 'name', 'type', 'required', 'sort_order'],
  warehouses: ['id', 'name', 'is_default', 'created_at'],
  inventory_bindings: ['id', 'scan_model', 'inventory_code', 'created_at'],
  unpack_records: ['id', 'original_material_id', 'new_quantity', 'pair_id', 'unpacked_at'],
  print_history: ['id', 'unpack_record_ids', 'printed_at', 'created_at'],
  inbound_records: ['id', 'inbound_no', 'warehouse_id', 'scan_model', 'quantity', 'created_at'],
  inbound_summary: ['id', 'warehouse_id', 'scan_model', 'total_quantity', 'updated_at'],
  inventory_check_records: [
    'id',
    'check_no',
    'warehouse_id',
    'scan_model',
    'check_type',
    'created_at',
  ],
};

const getSelectedDatabaseFileName = (asset: { name?: string; uri: string }): string => {
  if (asset.name?.trim()) {
    return asset.name.trim();
  }

  const uriFileName = asset.uri.split('/').pop()?.trim() || '';
  return uriFileName.includes('.') ? uriFileName : '';
};

const hasSQLiteHeader = async (fileUri: string): Promise<boolean> => {
  try {
    const headerBase64 = await FS.readAsStringAsync(fileUri, {
      encoding: FS.EncodingType.Base64,
      position: 0,
      length: SQLITE_FILE_HEADER.length,
    });
    const headerBytes = Base64.toUint8Array(headerBase64);
    const expectedBytes = Uint8Array.from(
      Array.from(SQLITE_FILE_HEADER, (char) => char.charCodeAt(0))
    );

    if (headerBytes.length < expectedBytes.length) {
      return false;
    }

    return expectedBytes.every((byte, index) => headerBytes[index] === byte);
  } catch (error) {
    logger.error('[importDatabaseFile] 读取 SQLite 文件头失败:', error);
    return false;
  }
};

const validateRestoredDatabaseSchema = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  for (const [tableName, requiredColumns] of Object.entries(RESTORE_SCHEMA_REQUIREMENTS)) {
    const tableExists = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName]
    );

    if (!tableExists) {
      throw new Error(`数据库缺少必要数据表: ${tableName}`);
    }

    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const columnSet = new Set(columns.map((column) => column.name));
    const missingColumns = requiredColumns.filter((column) => !columnSet.has(column));

    if (missingColumns.length > 0) {
      throw new Error(`数据库表 ${tableName} 缺少字段: ${missingColumns.join(', ')}`);
    }
  }
};

// 获取数据库文件路径
const getDatabaseFilePath = (): string => {
  // Expo SQLite 将数据库文件存储在应用的文档目录下
  // 路径格式: <documentDirectory>/SQLite/warehouse.db
  const documentDirectory = FS.documentDirectory;
  return `${documentDirectory}SQLite/warehouse.db`;
};

const checkpointDatabaseForFileBackup = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  let lastCheckpoint: { busy?: number; log?: number; checkpointed?: number } | null = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const checkpoint = await database.getFirstAsync<{
      busy?: number;
      log?: number;
      checkpointed?: number;
    }>('PRAGMA wal_checkpoint(TRUNCATE)');

    if (!checkpoint) {
      throw new Error('数据库 WAL checkpoint 未返回结果，无法生成一致备份');
    }

    if (Number(checkpoint.busy || 0) === 0) {
      return;
    }

    lastCheckpoint = checkpoint;
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `数据库 WAL 正忙，无法生成一致备份（log=${lastCheckpoint?.log ?? 0}, checkpointed=${lastCheckpoint?.checkpointed ?? 0}）`
  );
};

const deleteDatabaseSidecarFiles = async (dbFilePath: string): Promise<void> => {
  await Promise.all(
    ['-wal', '-shm'].map((suffix) =>
      FS.deleteAsync(`${dbFilePath}${suffix}`, { idempotent: true })
    )
  );
};

const getNextDatedBackupFileName = async (
  directory: string,
  prefix: string,
  dateStr: string,
  extension: string
): Promise<string> => {
  try {
    const files = await FS.readDirectoryAsync(directory);
    const sequencePrefix = `${prefix}_${dateStr}_`;
    const sequenceSuffix = `.${extension}`;
    const maxSequence = files.reduce((max: number, fileName: string) => {
      if (!fileName.startsWith(sequencePrefix) || !fileName.endsWith(sequenceSuffix)) {
        return max;
      }

      const sequenceText = fileName.slice(sequencePrefix.length, -sequenceSuffix.length);
      const sequence = Number(sequenceText);
      return Number.isInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
    return `${prefix}_${dateStr}_${String(maxSequence + 1).padStart(2, '0')}.${extension}`;
  } catch (error) {
    logger.warn('读取数据库备份目录失败，使用默认序号:', error);
    return `${prefix}_${dateStr}_01.${extension}`;
  }
};

// 导出数据库文件
export const exportDatabaseFile = async (): Promise<{
  success: boolean;
  message: string;
  filePath?: string;
}> => {
  try {
    if (isWebPlatform) {
      return {
        success: false,
        message: 'Web 平台不支持数据库文件备份',
      };
    }

    // 确保所有数据已写入磁盘
    const database = getDb();
    if (!database) {
      return {
        success: false,
        message: '数据库未初始化',
      };
    }

    await checkpointDatabaseForFileBackup(database);

    // 关闭数据库连接，确保数据持久化
    await database.closeAsync();
    db = null;

    // 等待一下，确保文件写入完成
    await new Promise((resolve) => setTimeout(resolve, 500));

    const dbFilePath = getDatabaseFilePath();

    // 检查数据库文件是否存在
    const fileInfo = await FS.getInfoAsync(dbFilePath);
    if (!fileInfo.exists) {
      logger.error('数据库文件不存在:', dbFilePath);
      // 重新初始化数据库连接
      await initDatabase();
      return {
        success: false,
        message: '数据库文件不存在',
      };
    }

    // 生成按天归档并自动递增序号的备份文件名
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = `${year}${month}${day}`;
    const backupDir = `${FS.documentDirectory}backups`;

    // 确保备份目录存在
    const dirInfo = await FS.getInfoAsync(backupDir);
    if (!dirInfo.exists) {
      await FS.makeDirectoryAsync(backupDir, { intermediates: true });
    }

    const backupFileName = await getNextDatedBackupFileName(
      backupDir,
      '掌上仓库_backup',
      timestamp,
      'db'
    );
    const backupFilePath = `${backupDir}/${backupFileName}`;

    // 复制数据库文件到备份目录
    await FS.copyAsync({
      from: dbFilePath,
      to: backupFilePath,
    });

    // 重新初始化数据库连接，确保 PRAGMA、索引与保护触发器都处于当前版本。
    await initDatabase();

    return {
      success: true,
      message: '数据库文件导出成功',
      filePath: backupFilePath,
    };
  } catch (error) {
    logger.error('导出数据库文件失败:', error);

    // 尝试重新打开数据库
    try {
      if (!db) {
        await initDatabase();
      }
    } catch (e) {
      logger.error('重新打开数据库失败:', e);
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : '导出数据库文件失败',
    };
  }
};

// 恢复数据库文件
export const importDatabaseFile = async (): Promise<{
  success: boolean;
  message: string;
  needRestart?: boolean;
  stats?: {
    orders: number;
    materials: number;
    rules: number;
    warehouses: number;
  };
}> => {
  try {
    if (isWebPlatform) {
      return {
        success: false,
        message: 'Web 平台不支持数据库文件恢复',
      };
    }

    // Android 对 MIME 类型有严格限制，使用多种类型尝试
    // 优先使用通配符，确保能选择所有文件
    let documentType: string | string[] = '*/*';

    const Platform = require('react-native').Platform;
    if (Platform.OS === 'android') {
      // Android 上使用多种 MIME 类型，提高兼容性
      documentType = [
        '*/*', // 允许所有文件
        'application/x-sqlite3',
        'application/vnd.sqlite3',
        'application/octet-stream',
      ];
    } else {
      // iOS 上可以使用 SQLite 类型
      documentType = 'application/x-sqlite3';
    }

    // 使用文档选择器选择备份文件
    const result = await DocumentPicker.getDocumentAsync({
      type: documentType,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return {
        success: false,
        message: '未选择文件',
      };
    }

    const selectedAsset = result.assets[0];
    const sourceFileUri = selectedAsset.uri;
    const selectedFileName = getSelectedDatabaseFileName(selectedAsset);
    const hasDbExtension = selectedFileName.toLowerCase().endsWith('.db');
    const sqliteHeaderValid = await hasSQLiteHeader(sourceFileUri);

    if (!hasDbExtension && !sqliteHeaderValid) {
      return {
        success: false,
        message: '请选择有效的 SQLite 数据库备份文件',
      };
    }

    if (!sqliteHeaderValid) {
      return {
        success: false,
        message: '所选文件不是有效的 SQLite 数据库文件',
      };
    }

    // 关闭当前数据库连接
    const database = getDb();
    if (database) {
      await checkpointDatabaseForFileBackup(database);
      await database.closeAsync();
    }
    db = null;

    // 等待一下，确保数据库完全关闭
    await new Promise((resolve) => setTimeout(resolve, 500));

    const dbFilePath = getDatabaseFilePath();
    const dbBackupPath = `${dbFilePath}.backup`;

    try {
      // 1. 备份当前数据库文件（如果存在）
      const currentDbInfo = await FS.getInfoAsync(dbFilePath);
      if (currentDbInfo.exists) {
        await FS.copyAsync({
          from: dbFilePath,
          to: dbBackupPath,
        });
      }

      // 2. 删除当前数据库文件及 WAL/SHM 辅助文件
      await FS.deleteAsync(dbFilePath, { idempotent: true });
      await deleteDatabaseSidecarFiles(dbFilePath);

      // 3. 复制新数据库文件
      await FS.copyAsync({
        from: sourceFileUri,
        to: dbFilePath,
      });

      // 4. 重新打开数据库
      db = await SQLite.openDatabaseAsync('warehouse.db');

      // 5. 验证数据库结构是否兼容，再获取统计数据
      await validateRestoredDatabaseSchema(db);

      const orders = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM orders'
      );
      const materials = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM materials'
      );
      const rules = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM qr_code_rules'
      );
      const warehouses = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM warehouses'
      );

      // 删除备份文件
      await FS.deleteAsync(dbBackupPath, { idempotent: true });

      await db.closeAsync();
      db = null;
      await initDatabase();

      return {
        success: true,
        message: '数据库文件恢复成功',
        needRestart: true, // 标记需要重启应用
        stats: {
          orders: orders?.count || 0,
          materials: materials?.count || 0,
          rules: rules?.count || 0,
          warehouses: warehouses?.count || 0,
        },
      };
    } catch (restoreError) {
      logger.error('恢复数据库失败，尝试回滚:', restoreError);

      // 恢复失败，尝试回滚到备份
      const backupInfo = await FS.getInfoAsync(dbBackupPath);
      if (backupInfo.exists) {
        await FS.deleteAsync(dbFilePath, { idempotent: true });
        await deleteDatabaseSidecarFiles(dbFilePath);
        await FS.copyAsync({
          from: dbBackupPath,
          to: dbFilePath,
        });
        await FS.deleteAsync(dbBackupPath, { idempotent: true });
      }

      // 重新初始化数据库连接
      await initDatabase();

      return {
        success: false,
        message: `恢复失败，已回滚到原数据库: ${restoreError instanceof Error ? restoreError.message : '未知错误'}`,
      };
    }
  } catch (error) {
    logger.error('导入数据库文件失败:', error);

    // 尝试重新打开数据库
    try {
      if (!db) {
        await initDatabase();
      }
    } catch (e) {
      logger.error('重新打开数据库失败:', e);
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : '导入数据库文件失败',
    };
  }
};
