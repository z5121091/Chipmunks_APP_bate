import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Base64 } from 'js-base64';
import { STORAGE_KEYS, ExportType, SyncConfig } from '@/constants/config';
import { getISODateTime, getTodayLocal } from './time';
import { parseQuantity } from './quantity';
import { assertValidRuleTerminator, stripRuleTerminator } from './ruleTerminator';
import { CONDITION_OPERATORS, type ConditionOperator, isConditionOperator, isIgnoredRuleField, matchesRuleCondition } from './ruleConditions';
import { migrateLegacyRuleFields } from './legacyRuleFields';
import { safeJsonParseNullable } from './json';
import { logger } from './logger';
import { getDatabaseBackupDateString, sanitizeBackupFileName } from './backupNaming';
import {
  isOutboundOrderRuleConfig,
  loadOutboundOrderRule,
  loadOutboundWarehouseOrderRules,
  type OutboundOrderRuleConfig,
  type OutboundWarehouseSampleRuleMap,
} from './outboundOrderRule';
import { getSyncConfigError, normalizeSyncConfig } from './heartbeat';
import { APP_NAME } from '@/constants/version';
import { ERP_ACCOUNTS, getErpAccountByOutboundOrderNo } from './erpAccounts';
import {
  buildInboundModelKey,
  buildInboundModelVersionKey,
  deduplicateInboundRowsById,
  normalizeInboundModel,
  normalizeInboundVersion,
  resolveInboundInventoryCodeFromBindings,
} from './inboundRecords';

// 使用 any 绕过类型检查
const FS = FileSystem as any;

// 重新导出 STORAGE_KEYS，供其他模块使用
export { STORAGE_KEYS };

const INSTALL_ID_DB_KEY = 'install_id';
const INSTALL_ID_PREFIX = 'install_';
const DATABASE_FILE_NAME = 'palm_warehouse_v2.db';

const DATABASE_TABLE_NAMES = {
  system_config: '系统配置',
  orders: '出库单',
  materials: '出库明细',
  unpack_records: '拆包记录',
  qr_code_rules: '扫码解析规则',
  custom_fields: '规则占位字段',
  warehouses: '仓库',
  inventory_bindings: '物料绑定',
  inbound_records: '入库记录',
  inventory_check_records: '盘点记录',
  recycle_bin: '删除回收站',
} as const;

type LogicalDatabaseTableName = keyof typeof DATABASE_TABLE_NAMES;

const SQL_METHOD_NAMES = new Set(['execAsync', 'getAllAsync', 'getFirstAsync', 'runAsync']);
const translatedDatabaseCache = new WeakMap<object, SQLite.SQLiteDatabase>();

const translateDatabaseSql = (sql: string): string =>
  (Object.entries(DATABASE_TABLE_NAMES) as Array<[LogicalDatabaseTableName, string]>).reduce(
    (translatedSql, [logicalName, physicalName]) =>
      translatedSql.replace(new RegExp(`\\b${logicalName}\\b`, 'g'), `[${physicalName}]`),
    sql
  );

const getPhysicalDatabaseTableName = (logicalName: string): string =>
  DATABASE_TABLE_NAMES[logicalName as LogicalDatabaseTableName] || logicalName;

const wrapDatabaseWithChineseTableNames = (
  rawDatabase: SQLite.SQLiteDatabase
): SQLite.SQLiteDatabase => {
  const cached = translatedDatabaseCache.get(rawDatabase as object);
  if (cached) {
    return cached;
  }

  const translatedDatabase = new Proxy(rawDatabase as object, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }

      if (SQL_METHOD_NAMES.has(String(property))) {
        return (sql: string, ...args: unknown[]) =>
          Reflect.apply(value, target, [translateDatabaseSql(sql), ...args]);
      }

      if (property === 'withExclusiveTransactionAsync') {
        return (task: (transactionDatabase: SQLite.SQLiteDatabase) => Promise<unknown>) =>
          Reflect.apply(value, target, [
            (transactionDatabase: SQLite.SQLiteDatabase) =>
              task(wrapDatabaseWithChineseTableNames(transactionDatabase)),
          ]);
      }

      return value.bind(target);
    },
  }) as SQLite.SQLiteDatabase;

  translatedDatabaseCache.set(rawDatabase as object, translatedDatabase);
  return translatedDatabase;
};

let db: SQLite.SQLiteDatabase | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;
let idCounter = 0;
let pendingCriticalWriteCheckpointLabel: string | null = null;
let committedWritesSinceCheckpoint = 0;
let serializedDatabaseOperationQueue: Promise<void> = Promise.resolve();
let databaseConnectionRefreshPromise: Promise<void> | null = null;

const WRITE_CHECKPOINT_BATCH_SIZE = 20;

// 检测是否为 Web 平台
const isWebPlatform = Platform.OS === 'web';

// 数据版本
const CURRENT_DATA_VERSION = 12;

// 未指定操作符的历史条件继续使用“包含”。
export interface MatchCondition {
  fieldIndex: number; // 字段位置（从0开始）
  keyword: string; // 匹配关键字（字段值包含此关键字即匹配）
  operator?: ConditionOperator;
}

export class QRCodeRuleConflictError extends Error {
  readonly ruleNames: string[];

  constructor(ruleNames: string[]) {
    const uniqueNames = Array.from(new Set(ruleNames.filter(Boolean)));
    super(`二维码同时匹配多个解析规则：${uniqueNames.join('、')}。请补充识别条件或字段前缀`);
    this.name = 'QRCodeRuleConflictError';
    this.ruleNames = uniqueNames;
  }
}

export type FieldPrefixes = Record<string, string>;

// 二维码解析规则接口
export interface QRCodeRule {
  id: string;
  name: string; // 厂家/规则名称，如"极海半导体"
  description: string; // 规则描述
  // 仅控制“解析规则”列表的展示顺序，绝不参与扫码规则匹配优先级。
  displayOrder?: number;
  separator: string; // 分隔符，如 "/"、","、"*"等
  terminator?: string; // 整条扫码内容的可选结束符，只移除末尾完整匹配的一次
  fieldOrder: string[]; // 标准字段或 ignore:N；旧 custom:字段ID 在读取/恢复时自动转换
  customFieldIds?: string[]; // 关联的自定义字段ID列表（已弃用，保留兼容性）
  fieldPrefixes?: FieldPrefixes; // 字段前缀配置，key 与 fieldOrder 保持一致
  isActive: boolean; // 是否启用
  supplierName?: string; // 供应商名称（可选）
  matchConditions?: MatchCondition[]; // 识别条件（可选，用于区分相同分隔符和字段数的规则）
  created_at: string;
  updated_at: string;
}

export const getQRCodeRuleSegmentCount = (
  rule: Pick<QRCodeRule, 'fieldOrder' | 'customFieldIds'>
): number => {
  const fields = rule.fieldOrder || [];
  // 旧备份可能仍把占位段保留在 customFieldIds 中；结构比较时也必须计入。
  const legacyOnlyCount = (rule.customFieldIds || []).filter((id) => !fields.includes(`custom:${id}`)).length;
  return fields.length + legacyOnlyCount;
};

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
  const parsedOptions = safeJsonParseNullable<string[]>(row.options ?? null, 'database.safeJsonParseNullable') || undefined;

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
  erp_account_key?: string;
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

export type RecentDocumentType = 'outbound' | 'inbound' | 'inventory';

export interface RecentDocumentSummary {
  type: RecentDocumentType;
  document_no: string;
  warehouse_id?: string;
  warehouse_name?: string;
  subject?: string;
  created_at: string;
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
  version?: string; // 版本号（可选）
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

export interface InventoryBindingImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: string[];
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
  rule_id?: string; // 实际命中的解析规则 ID
  rule_name?: string; // 实际命中的解析规则名称（便于历史展示）
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
  erp_account_key?: string;
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
  check_type: 'whole' | 'partial'; // 旧数据兼容字段；新版统一写入 whole
  actual_quantity?: number; // 实盘数量；默认等于标签数量，可按明细修正
  check_date: string; // 盘点日期
  notes?: string; // 备注
  rule_id?: string; // 实际命中的解析规则 ID
  rule_name?: string; // 实际命中的解析规则名称（便于历史展示）
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
  erp_account_key?: string;
  erp_account_name?: string;
  erp_quantity?: number;
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
  erp_account_key?: string;
  erp_account_name?: string;
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
  // 由物料绑定查询补充，不在拆包记录表中重复存储
  supplier?: string;
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

// 备份数据接口
export interface BackupData {
  version: number;
  timestamp: string;
  backupTime?: string;
  // 只包含配置数据，不包含业务数据
  rules: QRCodeRule[];
  customFields: CustomField[];
  warehouses: Warehouse[];
  outboundOrderRule?: OutboundOrderRuleConfig;
  outboundWarehouseOrderRules?: OutboundWarehouseSampleRuleMap;
  soundEnabled?: boolean;
  syncConfig?: SyncConfig | null;
  stats?: {
    rules: number;
    customFields: number;
    warehouses: number;
    hasOutboundOrderRule?: boolean;
    outboundWarehouseOrderRules?: number;
    hasSoundSetting?: boolean;
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
    typeof value.keyword === 'string' &&
    (value.operator === undefined || isConditionOperator(value.operator))
  );
};

const isQRCodeRuleShape = (value: unknown): value is QRCodeRule => {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.separator === 'string' &&
    (value.displayOrder === undefined ||
      (typeof value.displayOrder === 'number' &&
        Number.isSafeInteger(value.displayOrder) &&
        value.displayOrder > 0)) &&
    (value.terminator === undefined || (typeof value.terminator === 'string' &&
      value.terminator.length <= 64 && !value.terminator.includes('\0'))) &&
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
    typeof value.warehouses === 'number' &&
    (value.hasOutboundOrderRule === undefined ||
      typeof value.hasOutboundOrderRule === 'boolean') &&
    (value.outboundWarehouseOrderRules === undefined ||
      typeof value.outboundWarehouseOrderRules === 'number') &&
    (value.hasSoundSetting === undefined || typeof value.hasSoundSetting === 'boolean') &&
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
    Array.isArray(value.warehouses) &&
    value.warehouses.every((item) => isWarehouseShape(item)) &&
    (value.outboundOrderRule === undefined ||
      isOutboundOrderRuleConfig(value.outboundOrderRule)) &&
    (value.outboundWarehouseOrderRules === undefined ||
      isOutboundWarehouseOrderRulesShape(value.outboundWarehouseOrderRules)) &&
    (value.soundEnabled === undefined || typeof value.soundEnabled === 'boolean') &&
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
  terminator?: string | null;
  display_order?: number | string | null;
  is_active: number | boolean;
  supplier_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  match_conditions?: string | null;
};

const getRuleDisplayOrder = (value: unknown): number | undefined => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0
    ? numericValue
    : undefined;
};

const normalizeRuleRecord = (record: RuleRecordRow): QRCodeRule => {
  const legacyOrder = safeJsonParseNullable<string[]>(record.field_order ?? null, 'database.safeJsonParseNullable') || [];
  const legacyIds = safeJsonParseNullable<string[]>(record.custom_field_ids ?? null, 'database.safeJsonParseNullable') || [];
  const rawFieldPrefixes = safeJsonParseNullable<FieldPrefixes>(record.field_prefixes ?? null, 'database.safeJsonParseNullable') || {};
  const migrated = migrateLegacyRuleFields({ fieldOrder: legacyOrder, customFieldIds: legacyIds, fieldPrefixes: rawFieldPrefixes });
  const { fieldOrder, customFieldIds } = migrated;
  const fieldPrefixes = fieldOrder.reduce<FieldPrefixes>((acc, fieldName) => {
    const prefix = migrated.fieldPrefixes[fieldName];
    if (typeof prefix === 'string') {
      acc[fieldName] = prefix;
    }
    return acc;
  }, {});
  const rawMatchConditions = safeJsonParseNullable<MatchCondition[]>(record.match_conditions ?? null, 'database.safeJsonParseNullable') || [];
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
      ...(condition.operator === undefined ? {} : { operator: condition.operator }),
    }));

  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    displayOrder: getRuleDisplayOrder(record.display_order),
    separator: record.separator,
    terminator: record.terminator || '',
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

const compareRulesByLegacyPresentation = (a: QRCodeRule, b: QRCodeRule): number => {
  const updatedDiff =
    parseStoredDateTimeToMillis(b.updated_at) - parseStoredDateTimeToMillis(a.updated_at);
  if (updatedDiff !== 0) return updatedDiff;

  const createdDiff =
    parseStoredDateTimeToMillis(b.created_at) - parseStoredDateTimeToMillis(a.created_at);
  if (createdDiff !== 0) return createdDiff;

  return a.name.localeCompare(b.name, 'zh-CN');
};

const sortRulesForDisplay = (rules: QRCodeRule[]): QRCodeRule[] => {
  return rules.slice().sort((a, b) => {
    const aOrder = getRuleDisplayOrder(a.displayOrder);
    const bOrder = getRuleDisplayOrder(b.displayOrder);
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if (aOrder !== undefined && bOrder === undefined) return -1;
    if (aOrder === undefined && bOrder !== undefined) return 1;
    return compareRulesByLegacyPresentation(a, b);
  });
};

const rollbackTransaction = async (database: SQLite.SQLiteDatabase, context: string) => {
  try {
    await database.execAsync('ROLLBACK');
  } catch (rollbackError) {
    logger.error(`[${context}] 回滚失败:`, rollbackError);
  }
};

type WalCheckpointResult = {
  busy?: number;
  log?: number;
  checkpointed?: number;
};

const runFullWalCheckpoint = async (
  database: SQLite.SQLiteDatabase,
  attempts = 3,
  delayMs = 120
): Promise<{
  completed: boolean;
  lastCheckpoint: WalCheckpointResult | null;
  error?: unknown;
}> => {
  let lastCheckpoint: WalCheckpointResult | null = null;

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const checkpoint = await database.getFirstAsync<WalCheckpointResult>(
        'PRAGMA wal_checkpoint(FULL)'
      );

      if (checkpoint && Number(checkpoint.busy || 0) === 0) {
        return {
          completed: true,
          lastCheckpoint: checkpoint,
        };
      }

      lastCheckpoint = checkpoint || null;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      completed: false,
      lastCheckpoint,
    };
  } catch (error) {
    return {
      completed: false,
      lastCheckpoint,
      error,
    };
  }
};

const waitForDatabaseRetry = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const isPermanentSqlErrorMessage = (normalizedMessage: string): boolean =>
  normalizedMessage.includes('constraint') ||
  normalizedMessage.includes('syntax error') ||
  normalizedMessage.includes('no such table') ||
  normalizedMessage.includes('no such column') ||
  normalizedMessage.includes('datatype mismatch');

const isTransientDatabaseOperationError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();

  if (isPermanentSqlErrorMessage(normalizedMessage)) {
    return false;
  }

  return (
    normalizedMessage.includes('nativedatabase.') ||
    normalizedMessage.includes('nativestatement.') ||
    normalizedMessage.includes('nativedatabase.execasync') ||
    normalizedMessage.includes('nativedatabase.getfirstasync') ||
    normalizedMessage.includes('nativedatabase.getallasync') ||
    normalizedMessage.includes('finalizeasync') ||
    normalizedMessage.includes('database is locked') ||
    normalizedMessage.includes('database locked') ||
    normalizedMessage.includes('database is busy') ||
    normalizedMessage.includes('sqlite_busy') ||
    normalizedMessage.includes('sqlite_ioerr') ||
    normalizedMessage.includes('disk i/o error') ||
    normalizedMessage.includes('disk io error') ||
    normalizedMessage.includes('cannot start a transaction') ||
    normalizedMessage.includes('database is closed') ||
    normalizedMessage.includes('database is not open') ||
    normalizedMessage.includes('数据库未初始化')
  );
};

const isPermanentSqlError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();

  return isPermanentSqlErrorMessage(normalizedMessage);
};

const shouldRefreshDatabaseConnectionAfterError = (error: unknown): boolean => {
  if (isWebPlatform || isPermanentSqlError(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes('nativedatabase.') ||
    normalizedMessage.includes('nativestatement.') ||
    normalizedMessage.includes('finalizeasync') ||
    normalizedMessage.includes('sqlite_ioerr') ||
    normalizedMessage.includes('disk i/o error') ||
    normalizedMessage.includes('disk io error') ||
    normalizedMessage.includes('database is closed') ||
    normalizedMessage.includes('database is not open') ||
    normalizedMessage.includes('数据库未初始化')
  );
};

const refreshDatabaseConnectionAfterTransientError = async (
  context: string,
  error: unknown
): Promise<void> => {
  if (!shouldRefreshDatabaseConnectionAfterError(error)) {
    return;
  }

  if (databaseConnectionRefreshPromise) {
    await databaseConnectionRefreshPromise;
    return;
  }

  logger.warn(`[${context}] 检测到 SQLite native 连接异常，准备重开数据库连接:`, error);

  databaseConnectionRefreshPromise = (async () => {
    const currentDatabase = db;
    db = null;
    isInitializing = false;
    initPromise = null;

    if (currentDatabase) {
      try {
        await currentDatabase.closeAsync();
      } catch (closeError) {
        logger.warn(`[${context}] 关闭异常数据库连接失败，继续重新打开:`, closeError);
      }
    }

    await waitForDatabaseRetry(80);
    await initDatabase();
  })();

  try {
    await databaseConnectionRefreshPromise;
  } finally {
    databaseConnectionRefreshPromise = null;
  }
};

type DatabaseRetryHandler = (
  error: unknown,
  attempt: number,
  delayMs: number
) => Promise<void>;

const runWithTransientDatabaseRetry = async <T>(
  context: string,
  task: () => Promise<T>,
  retryDelays = [120, 300, 700],
  onRetry?: DatabaseRetryHandler
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseOperationError(error) || attempt >= retryDelays.length) {
        throw error;
      }

      logger.warn(
        `[${context}] 数据库操作被占用，${retryDelays[attempt]}ms 后重试第 ${attempt + 2} 次:`,
        error
      );
      await onRetry?.(error, attempt + 1, retryDelays[attempt]);
      await waitForDatabaseRetry(retryDelays[attempt]);
    }
  }

  throw lastError;
};

const runDatabaseReadWithRetry = async <T>(
  context: string,
  task: () => Promise<T>
): Promise<T> =>
  runWithTransientDatabaseRetry(
    context,
    task,
    [80, 180, 400],
    (error) => refreshDatabaseConnectionAfterTransientError(context, error)
  );

const retryPendingCriticalWriteCheckpoint = async (
  database: SQLite.SQLiteDatabase,
  context: string
): Promise<void> => {
  if (isWebPlatform || !pendingCriticalWriteCheckpointLabel) {
    return;
  }

  const pendingLabel = pendingCriticalWriteCheckpointLabel;
  const checkpoint = await runFullWalCheckpoint(database, 2, 80);

  if (checkpoint.completed) {
    pendingCriticalWriteCheckpointLabel = null;
    logger.log(`${context} 已补做 WAL checkpoint: ${pendingLabel}`);
    return;
  }

  logger.warn(
    `${context} WAL checkpoint 补做仍未完成，继续保留待重试状态: ${pendingLabel}`,
    checkpoint.error || checkpoint.lastCheckpoint || 'no checkpoint result'
  );
};

const runSerializedDatabaseOperation = async <T>(
  context: string,
  task: () => Promise<T>
): Promise<T> => {
  const previousOperation = serializedDatabaseOperationQueue;
  let releaseCurrentOperation!: () => void;
  const currentOperation = new Promise<void>((resolve) => {
    releaseCurrentOperation = resolve;
  });

  serializedDatabaseOperationQueue = previousOperation
    .catch(() => undefined)
    .then(() => currentOperation);

  await previousOperation.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrentOperation();
  }
};

const runExclusiveWriteTransaction = async <T>(
  database: SQLite.SQLiteDatabase,
  context: string,
  task: (transactionDatabase: SQLite.SQLiteDatabase) => Promise<T>
): Promise<T> => {
  return runWithTransientDatabaseRetry(
    context,
    () =>
      runSerializedDatabaseOperation(context, async () => {
        const activeDatabase = isWebPlatform ? database : getDb();
        await retryPendingCriticalWriteCheckpoint(activeDatabase, `[${context}] 写入前`);

        let result: T;
        if (!isWebPlatform && typeof activeDatabase.withExclusiveTransactionAsync === 'function') {
          let transactionResult: T | undefined;
          await activeDatabase.withExclusiveTransactionAsync(async (transactionDatabase) => {
            transactionResult = await task(transactionDatabase as SQLite.SQLiteDatabase);
          });
          result = transactionResult as T;
        } else {
          await activeDatabase.execAsync('BEGIN IMMEDIATE TRANSACTION');
          try {
            result = await task(activeDatabase);
            await activeDatabase.execAsync('COMMIT');
          } catch (error) {
            await rollbackTransaction(activeDatabase, context);
            throw error;
          }
        }

        await checkpointAfterCriticalWrite(activeDatabase, `[${context}]`);
        return result;
      }),
    [120, 300, 700, 1200],
    (error) => refreshDatabaseConnectionAfterTransientError(context, error)
  );
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
  records: Array<{ id?: string | null; traceNo?: string | null; warehouse_id?: string | null }>
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
    if (existing && existing.id !== record.id?.trim()) {
      throw new Error(`追踪码已入库，不能重复保存：${traceNo}`);
    }

    checked.add(traceNo);
  }
};

type ExistingInboundRecordIdentity = {
  id: string;
  inbound_no: string;
  warehouse_id: string;
  inventory_code?: string | null;
  scan_model: string;
  version?: string | null;
  quantity: number;
  traceNo?: string | null;
  batch?: string | null;
  productionDate?: string | null;
  erp_account_key?: string | null;
};

const normalizeComparableText = (value: unknown): string => String(value ?? '').trim();

const isEquivalentInboundRecord = (
  existing: ExistingInboundRecordIdentity,
  record: InboundRecordInsert
): boolean =>
  normalizeComparableText(existing.inbound_no) === normalizeComparableText(record.inbound_no) &&
  normalizeComparableText(existing.warehouse_id) === normalizeComparableText(record.warehouse_id) &&
  normalizeComparableText(existing.inventory_code).toLocaleLowerCase() ===
    normalizeComparableText(record.inventory_code).toLocaleLowerCase() &&
  normalizeComparableText(existing.scan_model).toLocaleLowerCase() ===
    normalizeComparableText(record.scan_model).toLocaleLowerCase() &&
  normalizeComparableText(existing.version).toLocaleLowerCase() ===
    normalizeComparableText(record.version).toLocaleLowerCase() &&
  Number(existing.quantity) === Number(record.quantity) &&
  normalizeComparableText(existing.batch) === normalizeComparableText(record.batch) &&
  normalizeComparableText(existing.productionDate) === normalizeComparableText(record.productionDate) &&
  normalizeComparableText(existing.erp_account_key) === normalizeComparableText(record.erp_account_key) &&
  normalizeComparableText(existing.traceNo) === normalizeComparableText(record.traceNo);

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

const getBaseUnpackTraceNo = (traceNo?: string | null): string => {
  const trimmedTraceNo = traceNo?.trim() || '';
  return trimmedTraceNo.replace(/-\d+$/, '') || trimmedTraceNo;
};

const getNextUnpackTraceNoAfter = (traceNo?: string | null): string => {
  const trimmedTraceNo = traceNo?.trim() || '';
  const baseTraceNo = getBaseUnpackTraceNo(trimmedTraceNo);
  if (!baseTraceNo) {
    return '';
  }

  const match = trimmedTraceNo.match(/^(.+)-(\d+)$/);
  const currentIndex = match ? parseInt(match[2], 10) : 0;
  return `${baseTraceNo}-${currentIndex + 1}`;
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

  const matchingMaterials = await database.getAllAsync<any>(
    `SELECT *
     FROM materials
     WHERE traceNo = ? AND warehouse_id = ?
     ORDER BY scanned_at DESC, id DESC`,
    [trimmedTraceNo, trimmedWarehouseId]
  );
  const remainingMaterials = matchingMaterials.filter((material) => {
    const sameOrder = material.order_no === currentOrderNo;
    const remainingQuantity = parseQuantity(material.remaining_quantity, { min: 0 }) ?? 0;
    const isUnpacked = material.isUnpacked === 1 || material.isUnpacked === true;
    return !sameOrder && isUnpacked && remainingQuantity > 0;
  });

  if (remainingMaterials.length !== 1) {
    return false;
  }

  const remainingMaterial = remainingMaterials[0];
  const remainingQuantity = parseQuantity(remainingMaterial.remaining_quantity, { min: 0 }) ?? 0;
  const alreadyScannedByAnotherOrder = matchingMaterials.some(
    (material) => material.id !== remainingMaterial.id && material.order_no !== currentOrderNo
  );
  if (alreadyScannedByAnotherOrder) {
    return false;
  }

  const remainingLabel = await database.getFirstAsync<{ pair_id: string }>(
    `SELECT pair_id
     FROM unpack_records
     WHERE label_type = ?
       AND warehouse_id = ?
       AND (
         TRIM(traceNo) = ?
         OR (TRIM(new_traceNo) = ? AND TRIM(new_traceNo) = TRIM(traceNo))
       )
     LIMIT 1`,
    ['remaining', trimmedWarehouseId, trimmedTraceNo, trimmedTraceNo]
  );

  if (!remainingLabel) {
    const shippedLabelWithSameTraceNo = await database.getFirstAsync<{ pair_id: string }>(
      `SELECT pair_id
       FROM unpack_records
       WHERE label_type = ?
         AND warehouse_id = ?
         AND TRIM(new_traceNo) = ?
       LIMIT 1`,
      ['shipped', trimmedWarehouseId, trimmedTraceNo]
    );
    if (shippedLabelWithSameTraceNo) {
      return false;
    }

    logger.warn('[canUseRemainingUnpackTraceNo] 未找到对应拆包剩余标签，按老版本拆包剩余物料放行:', {
      traceNo: trimmedTraceNo,
      materialId: remainingMaterial.id,
      orderNo: remainingMaterial.order_no,
      remainingQuantity,
      warehouseId: trimmedWarehouseId,
    });
  }

  if (remainingLabel) {
    const consumedByLaterUnpack = await database.getFirstAsync<{ pair_id: string }>(
      `SELECT pair_id
       FROM unpack_records
       WHERE label_type = ?
         AND warehouse_id = ?
         AND TRIM(traceNo) = ?
         AND pair_id != ?
         AND new_traceNo IS NOT NULL
         AND TRIM(new_traceNo) != ''
         AND TRIM(new_traceNo) != TRIM(traceNo)
       LIMIT 1`,
      ['shipped', trimmedWarehouseId, trimmedTraceNo, remainingLabel.pair_id]
    );
    if (consumedByLaterUnpack) {
      return false;
    }
  }

  return true;
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
  const match = normalizeSqlText(sql).match(/\bWHERE (.+?)(?: GROUP BY\b| ORDER BY\b| LIMIT\b|$)/i);
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
  const coalesceMatch = expr.match(/^COALESCE\(([^,]+),.+\)$/i);
  if (coalesceMatch) {
    expr = coalesceMatch[1].trim();
  }

  const nullIfMatch = expr.match(/^NULLIF\(([^,]+),.+\)$/i);
  if (nullIfMatch) {
    expr = nullIfMatch[1].trim();
  }

  const trimMatch = expr.match(/^TRIM\((.+)\)$/i);
  if (trimMatch) {
    expr = trimMatch[1].trim();
  }

  const castMatch = normalizeSqlText(expr).match(/^CAST\((.+?) AS .+\)$/i);
  if (castMatch) {
    expr = castMatch[1].trim();
  }

  const columnMatch = expr.match(/(?:\w+\.)?([a-z_]\w*)$/i);
  return columnMatch ? columnMatch[1] : null;
};

const getMockExpressionValue = (row: any, expression: string): unknown => {
  const expr = stripWrappingParentheses(expression);
  const quotedMatch = expr.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (quotedMatch) {
    return quotedMatch[1] ?? quotedMatch[2] ?? '';
  }

  if (/^-?\d+(?:\.\d+)?$/.test(expr)) {
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

const compareMockValues = (
  left: unknown,
  right: unknown,
  operator: string,
  caseInsensitive = false
): boolean => {
  if (operator === '=' || operator === '!=' || operator === '<>') {
    const leftText = String(left ?? '');
    const rightText = String(right ?? '');
    const matched = caseInsensitive
      ? leftText.toUpperCase() === rightText.toUpperCase()
      : leftText === rightText;
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

  const andParts = splitSqlLogical(normalized, 'AND');
  if (andParts.length > 1) {
    let matched = true;
    for (const part of andParts) {
      // Consume every placeholder even if an earlier condition did not match.
      matched = evaluateMockCondition(row, part, params, cursor) && matched;
    }
    return matched;
  }

  const isNullMatch = normalized.match(/^(.+?) IS (NOT )?NULL$/i);
  if (isNullMatch) {
    const value = getMockExpressionValue(row, isNullMatch[1]);
    const isNull = value === null || value === undefined || value === '';
    return isNullMatch[2] ? !isNull : isNull;
  }

  const likeMatch = normalized.match(/^(.+?) LIKE (.+?)(?: ESCAPE .+)?$/i);
  if (likeMatch) {
    const left = String(getMockExpressionValue(row, likeMatch[1]) ?? '');
    const pattern = String(getMockRightValue(row, likeMatch[2], params, cursor) ?? '');
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i').test(left);
  }

  const inMatch = normalized.match(/^(.+?) IN ?\((.+)\)$/i);
  if (inMatch) {
    const left = String(getMockExpressionValue(row, inMatch[1]) ?? '');
    const values = inMatch[2]
      .split(',')
      .map((item) => item.trim())
      .map((item) => getMockRightValue(row, item, params, cursor))
      .map((item) => String(item ?? ''));
    return values.includes(left);
  }

  const binaryMatch = normalized.match(/!=|<>|<=|>=|[=<>]/);
  if (binaryMatch) {
    const leftExpression = normalized.slice(0, binaryMatch.index).trim();
    const rightExpression = normalized.slice((binaryMatch.index ?? 0) + binaryMatch[0].length).trim();
    const left = getMockExpressionValue(row, leftExpression);
    const right = getMockRightValue(row, rightExpression, params, cursor);
    return compareMockValues(
      left,
      right,
      binaryMatch[0],
      /\bCOLLATE\s+NOCASE\b/i.test(normalized)
    );
  }

  cursor.index += (normalized.match(/\?/g) || []).length;
  logger.warn(`[MockDB] Unsupported WHERE condition, kept for preview: ${normalized}`);
  return true;
};

// 解析 WHERE 条件并过滤数据
const filterByWhere = (rows: any[], whereClause: string, params: any[] = []): any[] => {
  logger.log(`[MockDB] filterByWhere: whereClause="${whereClause}", params=`, params);

  if (!whereClause) return rows;

  const result = rows.filter((row) => {
    const cursor = { index: 0 };
    return evaluateMockCondition(row, whereClause, params, cursor);
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
  const match = normalizeSqlText(sql).match(/\bGROUP BY (.+?)(?: ORDER BY\b| LIMIT\b|$)/i);
  return match ? match[1].trim() : null;
};

const getMockSelectExpressionParts = (expression: string) => {
  const trimmed = expression.trim();
  const aliasMatch = normalizeSqlText(trimmed).match(/^(.+?) AS ([a-z_]\w*)$/i);
  const valueExpression = aliasMatch ? aliasMatch[1].trim() : trimmed;
  const alias = aliasMatch?.[2] || getMockColumnName(valueExpression) || valueExpression;
  return { valueExpression, alias };
};

const getMockAggregateValue = (
  rows: any[],
  expression: string
): { handled: boolean; value: unknown } => {
  const normalized = stripWrappingParentheses(expression.trim());
  const countMatch = normalizeSqlText(normalized).match(/^COUNT *\((DISTINCT )?(.+)\)$/i);
  if (countMatch) {
    const valueExpression = countMatch[2].trim();
    if (countMatch[1]) {
      const values = new Set(
        rows.map((row) => String(getMockExpressionValue(row, valueExpression) ?? ''))
      );
      return { handled: true, value: values.size };
    }
    if (valueExpression === '*') {
      return { handled: true, value: rows.length };
    }
    return {
      handled: true,
      value: rows.filter((row) => getMockExpressionValue(row, valueExpression) != null).length,
    };
  }

  const maxMatch = normalized.match(/^MAX\s*\((.+)\)$/is);
  if (maxMatch) {
    const values = rows
      .map((row) => getMockExpressionValue(row, maxMatch[1]))
      .filter((value) => value !== null && value !== undefined && value !== '');
    const maxValue = values.reduce<unknown>((current, value) => {
      if (current === undefined) {
        return value;
      }
      return String(value) > String(current) ? value : current;
    }, undefined);
    return { handled: true, value: maxValue ?? null };
  }

  const sumMatch = normalized.match(/^SUM\s*\((.+)\)$/is);
  if (sumMatch) {
    const value = rows.reduce((total, row) => {
      const nextValue = Number(getMockExpressionValue(row, sumMatch[1]) ?? 0);
      return total + (Number.isFinite(nextValue) ? nextValue : 0);
    }, 0);
    return { handled: true, value };
  }

  return { handled: false, value: undefined };
};

const getMockDocumentSyncStatus = (rows: any[]): DocumentSyncStatus => {
  if (rows.length > 0 && rows.every((row) => row.sync_status === 'success')) {
    return 'success';
  }
  if (rows.some((row) => row.sync_status === 'failed')) {
    return 'failed';
  }
  return 'pending';
};

const getMockMaxValue = (rows: any[], columnName: string): string => {
  return rows.reduce((current, row) => {
    const value = String(row[columnName] ?? '');
    return value > current ? value : current;
  }, '');
};

const getMockModelCount = (rows: any[]): number => {
  return new Set(
    rows
      .map((row) => buildInboundModelKey(row.scan_model))
      .filter(Boolean)
  ).size;
};

const sortMockDocumentRows = <T extends { created_at: string }>(
  rows: T[],
  documentNoKey: keyof T
): T[] =>
  rows.sort((a, b) => {
    const createdDiff = String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (createdDiff !== 0) {
      return createdDiff;
    }
    return String(b[documentNoKey] || '').localeCompare(String(a[documentNoKey] || ''));
  });

const getMockInboundDocumentSummaries = (rows: any[]): InboundDocumentSummary[] => {
  const groups = new Map<string, any[]>();

  rows.forEach((row) => {
    const key = `${row.warehouse_id || ''}::${row.inbound_no || ''}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });

  return sortMockDocumentRows(
    Array.from(groups.values()).map((groupRows) => {
      const first = groupRows[0] || {};
      return {
        inbound_no: first.inbound_no || '',
        warehouse_id: first.warehouse_id || '',
        warehouse_name: getMockMaxValue(groupRows, 'warehouse_name'),
        in_date: getMockMaxValue(groupRows, 'in_date'),
        created_at: getMockMaxValue(groupRows, 'created_at'),
        record_count: groupRows.length,
        model_count: getMockModelCount(groupRows),
        total_quantity: groupRows.reduce((total, row) => total + Number(row.quantity || 0), 0),
        sync_status: getMockDocumentSyncStatus(groupRows),
        sync_file_name: getMockMaxValue(groupRows, 'sync_file_name') || undefined,
        synced_at: getMockMaxValue(groupRows, 'synced_at') || undefined,
        sync_message: getMockMaxValue(groupRows, 'sync_message') || undefined,
      };
    }),
    'inbound_no'
  );
};

const getMockInventoryDocumentSummaries = (rows: any[]): InventoryCheckDocumentSummary[] => {
  const groups = new Map<string, any[]>();

  rows.forEach((row) => {
    const key = `${row.warehouse_id || ''}::${row.check_no || ''}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });

  return sortMockDocumentRows(
    Array.from(groups.values()).map((groupRows) => {
      const first = groupRows[0] || {};
      return {
        check_no: first.check_no || '',
        warehouse_id: first.warehouse_id || '',
        warehouse_name: getMockMaxValue(groupRows, 'warehouse_name'),
        check_date: getMockMaxValue(groupRows, 'check_date'),
        created_at: getMockMaxValue(groupRows, 'created_at'),
        record_count: groupRows.length,
        model_count: getMockModelCount(groupRows),
        total_quantity: groupRows.reduce((total, row) => {
          const quantity = Number(row.actual_quantity ?? row.quantity ?? 0);
          return total + (Number.isFinite(quantity) ? quantity : 0);
        }, 0),
        whole_count: groupRows.filter((row) => row.check_type === 'whole').length,
        partial_count: groupRows.filter((row) => row.check_type === 'partial').length,
        sync_status: getMockDocumentSyncStatus(groupRows),
        sync_file_name: getMockMaxValue(groupRows, 'sync_file_name') || undefined,
        synced_at: getMockMaxValue(groupRows, 'synced_at') || undefined,
        sync_message: getMockMaxValue(groupRows, 'sync_message') || undefined,
        erp_account_key: getMockMaxValue(groupRows, 'erp_account_key') || undefined,
        erp_account_name: getMockMaxValue(groupRows, 'erp_account_name') || undefined,
      };
    }),
    'check_no'
  );
};

const getMockDocumentSummaryRows = (tableName: string, sql: string, rows: any[]): any[] | null => {
  const normalizedSql = normalizeSqlText(sql);
  if (
    tableName === 'inbound_records' &&
    /\bGROUP BY inbound_no, warehouse_id\b/i.test(normalizedSql)
  ) {
    return getMockInboundDocumentSummaries(rows);
  }

  if (
    tableName === 'inventory_check_records' &&
    /\bGROUP BY check_no, warehouse_id\b/i.test(normalizedSql)
  ) {
    return getMockInventoryDocumentSummaries(rows);
  }

  return null;
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
    if (alias === 'sync_status' && groupRows) {
      result[alias] = getMockDocumentSyncStatus(groupRows);
    } else {
      result[alias] = aggregate.handled
        ? aggregate.value
        : getMockExpressionValue(row, valueExpression);
    }
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
        .match(/^INSERT(?:\s+OR\s+(REPLACE|IGNORE))?\s+INTO\s+(\w+)\s*\((.*?)\)/is);
      if (insertMatch) {
        // 提取表名和列名（使用更灵活的正则表达式）
        const conflictMode = insertMatch[1]?.toUpperCase();
        const tableName = insertMatch[2];
        const columns = splitSqlComma(insertMatch[3]);
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

        const replaceKey = row.id !== undefined ? 'id' : row.key !== undefined ? 'key' : null;
        const existingIndex =
          replaceKey
            ? mockTables[tableName].findIndex(
                (item) => String(item[replaceKey]) === String(row[replaceKey])
              )
            : -1;

        if (conflictMode === 'IGNORE' && existingIndex >= 0) {
          logger.log(`[MockDB] Ignored duplicate insert into ${tableName}:`, row);
          return { changes: 0, lastInsertRowId: existingIndex + 1 };
        }

        if (conflictMode === 'REPLACE' && existingIndex >= 0) {
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
          const selectMatch = normalizeSqlText(sql).match(/SELECT (.+?) FROM/i);
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

          const summaryRows = getMockDocumentSummaryRows(tableName, sql, filteredResults);
          if (summaryRows) {
            logger.log(`[MockDB] Selected ${summaryRows.length} document summaries from ${tableName}`);
            return summaryRows as T[];
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
          if (/\b(?:COUNT|SUM)\s*\(/i.test(selectClause)) {
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
          const selectMatch = normalizeSqlText(sql).match(/SELECT (.+?) FROM/i);
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
            if (/\b(?:COUNT|SUM)\s*\(/i.test(selectClause)) {
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

// 新版独立数据库的首个结构版本
const DB_VERSION = 1;

const ensureRecycleBinTableAndTriggers = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS recycle_bin (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      original_id TEXT,
      warehouse_id TEXT,
      document_no TEXT,
      payload TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity_deleted
    ON recycle_bin (entity_type, deleted_at DESC);

    CREATE INDEX IF NOT EXISTS idx_recycle_bin_expires
    ON recycle_bin (expires_at);
  `);

  await database.execAsync(`
    DROP TRIGGER IF EXISTS trg_recycle_deleted_materials;
    DROP TRIGGER IF EXISTS trg_recycle_deleted_orders;
    DROP TRIGGER IF EXISTS trg_recycle_deleted_unpack_records;
    DROP TRIGGER IF EXISTS trg_recycle_deleted_warehouses;

    CREATE TRIGGER trg_recycle_deleted_materials
    AFTER DELETE ON materials
    BEGIN
      INSERT INTO recycle_bin (
        id, entity_type, original_id, warehouse_id, document_no, payload, deleted_at, expires_at
      ) VALUES (
        lower(hex(randomblob(16))),
        '出库明细',
        OLD.id,
        OLD.warehouse_id,
        OLD.order_no,
        json_object(
          'id', OLD.id,
          'order_no', OLD.order_no,
          'customer_name', OLD.customer_name,
          'operation_type', OLD.operation_type,
          'model', OLD.model,
          'batch', OLD.batch,
          'quantity', OLD.quantity,
          'package', OLD.package,
          'version', OLD.version,
          'productionDate', OLD.productionDate,
          'traceNo', OLD.traceNo,
          'sourceNo', OLD.sourceNo,
          'scanned_at', OLD.scanned_at,
          'raw_content', OLD.raw_content,
          'customFields', OLD.customFields,
          'isUnpacked', OLD.isUnpacked,
          'original_quantity', OLD.original_quantity,
          'remaining_quantity', OLD.remaining_quantity,
          'warehouse_id', OLD.warehouse_id,
          'warehouse_name', OLD.warehouse_name,
          'inventory_code', OLD.inventory_code,
          'rule_id', OLD.rule_id,
          'rule_name', OLD.rule_name
        ),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
      );
    END;

    CREATE TRIGGER trg_recycle_deleted_orders
    AFTER DELETE ON orders
    BEGIN
      INSERT INTO recycle_bin (
        id, entity_type, original_id, warehouse_id, document_no, payload, deleted_at, expires_at
      ) VALUES (
        lower(hex(randomblob(16))),
        '出库单',
        OLD.id,
        OLD.warehouse_id,
        OLD.order_no,
        json_object(
          'id', OLD.id,
          'order_no', OLD.order_no,
          'customer_name', OLD.customer_name,
          'warehouse_id', OLD.warehouse_id,
          'warehouse_name', OLD.warehouse_name,
          'created_at', OLD.created_at
        ),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
      );
    END;

    CREATE TRIGGER trg_recycle_deleted_unpack_records
    AFTER DELETE ON unpack_records
    BEGIN
      INSERT INTO recycle_bin (
        id, entity_type, original_id, warehouse_id, document_no, payload, deleted_at, expires_at
      ) VALUES (
        lower(hex(randomblob(16))),
        '拆包记录',
        OLD.id,
        OLD.warehouse_id,
        OLD.order_no,
        json_object(
          'id', OLD.id,
          'original_material_id', OLD.original_material_id,
          'order_no', OLD.order_no,
          'customer_name', OLD.customer_name,
          'model', OLD.model,
          'batch', OLD.batch,
          'package', OLD.package,
          'version', OLD.version,
          'warehouse_id', OLD.warehouse_id,
          'warehouse_name', OLD.warehouse_name,
          'inventory_code', OLD.inventory_code,
          'original_quantity', OLD.original_quantity,
          'new_quantity', OLD.new_quantity,
          'productionDate', OLD.productionDate,
          'traceNo', OLD.traceNo,
          'new_traceNo', OLD.new_traceNo,
          'sourceNo', OLD.sourceNo,
          'label_type', OLD.label_type,
          'pair_id', OLD.pair_id,
          'status', OLD.status,
          'notes', OLD.notes,
          'unpacked_at', OLD.unpacked_at,
          'printed_at', OLD.printed_at,
          'created_at', OLD.created_at,
          'updated_at', OLD.updated_at
        ),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
      );
    END;

    CREATE TRIGGER trg_recycle_deleted_warehouses
    AFTER DELETE ON warehouses
    BEGIN
      INSERT INTO recycle_bin (
        id, entity_type, original_id, warehouse_id, document_no, payload, deleted_at, expires_at
      ) VALUES (
        lower(hex(randomblob(16))),
        '仓库',
        OLD.id,
        OLD.id,
        NULL,
        json_object(
          'id', OLD.id,
          'name', OLD.name,
          'description', OLD.description,
          'is_default', OLD.is_default,
          'sort_order', OLD.sort_order,
          'created_at', OLD.created_at
        ),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days')
      );
    END;
  `);

  await database.runAsync(
    "DELETE FROM recycle_bin WHERE datetime(expires_at) <= datetime('now')"
  );
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
};

const ensureRollingInventoryTraceNoIndex = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  await database.execAsync(`
    DROP TRIGGER IF EXISTS idx_inventory_check_records_trace_unique_insert_guard;
    DROP TRIGGER IF EXISTS idx_inventory_check_records_trace_unique_update_guard;
    DROP INDEX IF EXISTS idx_inventory_check_records_trace_unique;

    CREATE INDEX IF NOT EXISTS idx_inventory_check_records_trace_lookup
    ON inventory_check_records (traceNo)
    WHERE traceNo IS NOT NULL AND TRIM(traceNo) != '';
  `);
};

const ensureInventoryCheckErpSnapshotColumns = async (
  database: SQLite.SQLiteDatabase
): Promise<void> => {
  const columns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(inventory_check_records)'
  );
  const columnNames = new Set(columns.map((column) => column.name));
  const missingColumns = [
    ['erp_account_key', 'TEXT'],
    ['erp_account_name', 'TEXT'],
    ['erp_quantity', 'REAL'],
  ] as const;

  for (const [columnName, columnType] of missingColumns) {
    if (!columnNames.has(columnName)) {
      await database.execAsync(
        `ALTER TABLE inventory_check_records ADD COLUMN ${columnName} ${columnType}`
      );
    }
  }
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
  db = wrapDatabaseWithChineseTableNames(
    await SQLite.openDatabaseAsync(DATABASE_FILE_NAME)
  );
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

  await db.runAsync(`
    DELETE FROM system_config
    WHERE key LIKE 'export_count_%'
      AND substr(key, -10) GLOB '????-??-??'
      AND date(substr(key, -10)) < date('now', '-30 days')
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
  const configVersion = versionResult ? parseInt(versionResult.value, 10) : 0;
  const userVersionResult = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const pragmaUserVersion = Number(userVersionResult?.user_version || 0);
  const currentVersion = Math.max(configVersion || 0, pragmaUserVersion || 0);
  const targetDbVersion = DB_VERSION;

  logger.log(
    '[DB Version] 当前数据库版本:',
    currentVersion,
    'system_config:',
    configVersion,
    'user_version:',
    pragmaUserVersion,
    '期望版本:',
    DB_VERSION
  );

  if (currentVersion > DB_VERSION) {
    throw new Error('数据库版本高于当前应用，请安装匹配或更新版本的应用');
  } else if (currentVersion > 0 && currentVersion < DB_VERSION) {
    throw new Error('数据库结构版本过旧，新版应用不提供旧表兼容迁移');
  }

  // 创建所有表
  await db.execAsync(`
      -- 可靠性与性能配置
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      PRAGMA wal_autocheckpoint = 1000;
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
        operation_type TEXT NOT NULL DEFAULT 'outbound',
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
        rule_id TEXT,
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
        terminator TEXT NOT NULL DEFAULT '',
        display_order INTEGER,
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
        scan_model TEXT NOT NULL,
        version TEXT DEFAULT '',
        inventory_code TEXT NOT NULL UNIQUE,
        supplier TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(scan_model, version)
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
        rule_id TEXT,
        rule_name TEXT,
        sync_status TEXT DEFAULT 'pending',
        sync_file_name TEXT,
        synced_at TEXT,
        sync_message TEXT
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
        rule_id TEXT,
        rule_name TEXT,
        sync_status TEXT DEFAULT 'pending',
        sync_file_name TEXT,
        synced_at TEXT,
        sync_message TEXT,
        erp_account_key TEXT,
        erp_account_name TEXT,
        erp_quantity REAL
      );
    `);

  await ensureInventoryCheckErpSnapshotColumns(db);
  const ruleColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(qr_code_rules)');
  if (!ruleColumns.some(column => column.name === 'terminator')) {
    await db.execAsync("ALTER TABLE qr_code_rules ADD COLUMN terminator TEXT NOT NULL DEFAULT ''");
  }
  if (!ruleColumns.some(column => column.name === 'display_order')) {
    await db.execAsync('ALTER TABLE qr_code_rules ADD COLUMN display_order INTEGER');
  }
  await runExclusiveWriteTransaction(db, 'migrateLegacyRuleFields', async transaction => {
    const rows = await transaction.getAllAsync<RuleRecordRow>('SELECT * FROM qr_code_rules');
    for (const row of rows) {
      const order = safeJsonParseNullable<string[]>(row.field_order ?? null, 'ruleMigration.fieldOrder') || [];
      const ids = safeJsonParseNullable<string[]>(row.custom_field_ids ?? null, 'ruleMigration.customFieldIds') || [];
      if (!ids.length && !order.some(field => field.startsWith('custom:'))) continue;
      const rule = normalizeRuleRecord(row);
      await transaction.runAsync(
        'UPDATE qr_code_rules SET field_order = ?, field_prefixes = ?, custom_field_ids = ? WHERE id = ?',
        [JSON.stringify(rule.fieldOrder), JSON.stringify(rule.fieldPrefixes), '[]', rule.id],
      );
    }
  });
  // Retire the derived ledger only; parsed batch/date fields on business records remain intact.
  await db.execAsync('DROP TABLE IF EXISTS "批次库存流水"; DROP TABLE IF EXISTS batch_stock_events;');
  for (const table of ['materials', 'inbound_records']) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === 'erp_account_key')) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN erp_account_key TEXT`);
    }
  }
  await ensureTraceNoUniqueIndexes(db);
  await ensureRollingInventoryTraceNoIndex(db);
  await ensureRecycleBinTableAndTriggers(db);

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
  await db.execAsync(`PRAGMA user_version = ${targetDbVersion}`);
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
    const customerChanged = customerName !== undefined && customerName !== existingOrder.customer_name;
    const warehouseChanged = warehouse && (
      warehouse.id !== existingOrder.warehouse_id || warehouse.name !== existingOrder.warehouse_name
    );
    // 更新现有订单
    const updates: string[] = [];
    const params: any[] = [];

    if (customerChanged) {
      updates.push('customer_name = ?');
      params.push(customerName);
    }
    if (warehouseChanged) {
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

      if (customerChanged) {
        materialUpdates.push('customer_name = ?');
        materialParams.push(customerName);
      }
      if (warehouseChanged) {
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
    await runExclusiveWriteTransaction(database, 'upsertOrder', async (transactionDatabase) => {
      await upsertOrderWithDatabase(transactionDatabase, orderNo, customerName, warehouse);
    });
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

    const trimmedOrderNo = orderNo.trim();
    const trimmedWarehouseId =
      typeof warehouseId === 'string' && warehouseId.trim() !== '' ? warehouseId.trim() : '';

    const result = await runDatabaseReadWithRetry('getOrder', () => {
      const database = getDb();
      return trimmedWarehouseId
        ? database.getFirstAsync<Order>(
            `SELECT * FROM orders
             WHERE order_no = ?
               AND (warehouse_id = ? OR warehouse_id IS NULL OR warehouse_id = '')
             ORDER BY CASE WHEN warehouse_id = ? THEN 0 ELSE 1 END
             LIMIT 1`,
            [trimmedOrderNo, trimmedWarehouseId, trimmedWarehouseId]
          )
        : database.getFirstAsync<Order>('SELECT * FROM orders WHERE order_no = ?', [
            trimmedOrderNo,
          ]);
    });
    return result || null;
  } catch (error) {
    logger.error('[getOrder] 获取订单失败:', error);
    throw error;
  }
};

// 获取所有订单
export const getAllOrders = async (): Promise<Order[]> => {
  try {
    const orders = await runDatabaseReadWithRetry('getAllOrders', () =>
      getDb().getAllAsync<Order>('SELECT * FROM orders')
    );
    return sortOrdersByOrderNo(deduplicateOrdersByBusinessKey(orders));
  } catch (error) {
    logger.error('获取订单列表失败:', error);
    throw error;
  }
};

export const getRecentDocumentSummaries = async (
  requestedLimit = 3
): Promise<RecentDocumentSummary[]> => {
  const limit = Math.max(1, Math.min(10, Math.trunc(requestedLimit) || 3));

  try {
    const rows = await runDatabaseReadWithRetry('getRecentDocumentSummaries', () =>
      getDb().getAllAsync<any>(
        `SELECT
          document_type,
          document_no,
          warehouse_id,
          warehouse_name,
          subject,
          created_at
        FROM (
          SELECT
            'outbound' AS document_type,
            order_no AS document_no,
            warehouse_id,
            MAX(warehouse_name) AS warehouse_name,
            MAX(customer_name) AS subject,
            MAX(created_at) AS created_at
          FROM orders
          WHERE TRIM(order_no) != ''
          GROUP BY order_no, warehouse_id

          UNION ALL

          SELECT
            'inbound' AS document_type,
            inbound_no AS document_no,
            warehouse_id,
            MAX(warehouse_name) AS warehouse_name,
            '' AS subject,
            MAX(created_at) AS created_at
          FROM inbound_records
          WHERE TRIM(inbound_no) != ''
          GROUP BY inbound_no, warehouse_id

          UNION ALL

          SELECT
            'inventory' AS document_type,
            check_no AS document_no,
            warehouse_id,
            MAX(warehouse_name) AS warehouse_name,
            '' AS subject,
            MAX(created_at) AS created_at
          FROM inventory_check_records
          WHERE TRIM(check_no) != ''
          GROUP BY check_no, warehouse_id
        ) recent_documents
        ORDER BY created_at DESC, document_no DESC
        LIMIT ?`,
        [limit]
      )
    );

    return rows.map((row) => ({
      type:
        row.document_type === 'inbound' || row.document_type === 'inventory'
          ? row.document_type
          : 'outbound',
      document_no: String(row.document_no || ''),
      warehouse_id: row.warehouse_id || undefined,
      warehouse_name: row.warehouse_name || undefined,
      subject: row.subject || undefined,
      created_at: String(row.created_at || ''),
    }));
  } catch (error) {
    logger.error('[getRecentDocumentSummaries] 获取最近单据失败:', error);
    throw error;
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

const getOrderBusinessKey = (order: Pick<Order, 'order_no' | 'warehouse_id'>) =>
  `${(order.warehouse_id || '').trim()}::${(order.order_no || '').trim()}`;

const getOrderCompletenessScore = (order: Order) =>
  Number(Boolean(order.customer_name?.trim())) +
  Number(Boolean(order.warehouse_id?.trim())) +
  Number(Boolean(order.warehouse_name?.trim()));

const isBetterDuplicateOrderCandidate = (candidate: Order, current: Order) => {
  const scoreDiff = getOrderCompletenessScore(candidate) - getOrderCompletenessScore(current);
  if (scoreDiff !== 0) {
    return scoreDiff > 0;
  }

  return parseStoredDateTimeToMillis(candidate.created_at) > parseStoredDateTimeToMillis(current.created_at);
};

const deduplicateOrdersByBusinessKey = (orders: Order[]): Order[] => {
  const byKey = new Map<string, Order>();

  orders.forEach((order) => {
    const key = getOrderBusinessKey(order);
    const current = byKey.get(key);
    if (!current || isBetterDuplicateOrderCandidate(order, current)) {
      byKey.set(key, order);
    }
  });

  return Array.from(byKey.values());
};

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
    const orders = await runDatabaseReadWithRetry('getFilteredOrders', () =>
      getDb().getAllAsync<Order>(`SELECT * FROM orders ${whereClause}`, queryParams)
    );
    return sortOrdersByOrderNo(deduplicateOrdersByBusinessKey(orders));
  } catch (error) {
    logger.error('[getFilteredOrders] 查询订单失败:', error);
    throw error;
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

    await runExclusiveWriteTransaction(database, 'deleteOrder', async (transactionDatabase) => {
      const rows = await transactionDatabase.getAllAsync<{ id: string }>(`SELECT id FROM materials WHERE order_no = ?${warehouseClause}`, params);
      await deleteMaterialsWithDatabase(transactionDatabase, rows.map(row => row.id));
      // 删除关联的拆包记录，避免留下孤儿数据
      await transactionDatabase.runAsync(`DELETE FROM unpack_records WHERE order_no = ?${warehouseClause}`, params);

      // 删除关联的物料记录
      await transactionDatabase.runAsync(`DELETE FROM materials WHERE order_no = ?${warehouseClause}`, params);

      // 最后删除订单
      await transactionDatabase.runAsync(`DELETE FROM orders WHERE order_no = ?${warehouseClause}`, params);
    });
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

    const preparedMaterials = materials.map((material) => ({
      id: generateId(),
      scannedAt: material.scanned_at || getISODateTime(),
      material,
    }));

    await runExclusiveWriteTransaction(database, 'addMaterialsBatch', async (transactionDatabase) => {
      for (const { id, scannedAt, material } of preparedMaterials) {
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
        const operationType: MaterialWritePayload['operation_type'] =
          material.operation_type === 'outbound' || material.operation_type === 'inventory'
            ? material.operation_type
            : 'outbound';

        await transactionDatabase.runAsync(
          `INSERT OR IGNORE INTO materials (
            id, order_no, customer_name, operation_type, model, batch, quantity,
            package, version, productionDate, traceNo, sourceNo, scanned_at, raw_content,
            customFields, isUnpacked, original_quantity, remaining_quantity,
            warehouse_id, warehouse_name, inventory_code, rule_id, rule_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
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
            scannedAt,
            material.raw_content,
            material.customFields ? JSON.stringify(material.customFields) : null,
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

        const inserted = await transactionDatabase.getFirstAsync<{
          id: string;
          order_no: string | null;
          operation_type: string | null;
          model: string | null;
          raw_content: string | null;
        }>(
          'SELECT id, order_no, operation_type, model, raw_content FROM materials WHERE id = ?',
          [id]
        );
        verifyMaterialWriteResult(
          inserted,
          {
            ...material,
            id,
            customer_name: material.customer_name || '',
            operation_type: operationType,
            batch: material.batch || '',
            quantity: parseQuantity(material.quantity, { min: 0 }) ?? 0,
            raw_content: material.raw_content,
            scanned_at: scannedAt,
          },
          id
        );
      }
    });

    const materialIds = preparedMaterials.map(({ id }) => id);
    logger.log('[addMaterialsBatch] 批量添加完成，成功:', materialIds.length);
    return materialIds;
  } catch (error) {
    logger.error('[addMaterialsBatch] 批量添加失败:', error);
    throw error;
  }
};

export type MaterialWritePayload = {
  id?: string;
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
  erp_account_key?: string;
};

const prepareMaterialWritePayload = (material: MaterialWritePayload): MaterialWritePayload => ({
  ...material,
  id: material.id || generateId(),
  scanned_at: material.scanned_at || getISODateTime(),
});

const verifyMaterialWriteResult = (
  inserted: {
    id: string;
    order_no: string | null;
    operation_type: string | null;
    model: string | null;
    raw_content: string | null;
  } | null,
  material: MaterialWritePayload,
  materialId: string
): void => {
  if (!inserted) {
    throw new Error('物料写入后校验失败');
  }

  const expectedOperationType = material.operation_type || 'outbound';
  if (
    inserted.order_no !== (material.order_no || '') ||
    inserted.operation_type !== expectedOperationType ||
    inserted.model !== (material.model || '') ||
    inserted.raw_content !== material.raw_content
  ) {
    throw new Error(`物料写入幂等校验失败: ${materialId}`);
  }
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

  const operationType = material.operation_type || 'outbound';
  if (operationType === 'outbound') {
    if (material.model.trim() === '') {
      throw new Error('出库物料型号为空，拒绝保存');
    }
    if (!material.warehouse_id || material.warehouse_id.trim() === '') {
      throw new Error('出库物料缺少仓库ID，拒绝保存');
    }
  }

  const materialId = material.id || generateId();
  const scannedAt = material.scanned_at || getISODateTime();
  const quantity = parseQuantity(material.quantity, { min: 0 }) ?? 0;

  await database.runAsync(
    `INSERT OR IGNORE INTO materials (
      id, order_no, customer_name, operation_type, model, batch, quantity,
      package, version, productionDate, traceNo, sourceNo, scanned_at, raw_content,
      customFields, isUnpacked, original_quantity, remaining_quantity,
      warehouse_id, warehouse_name, inventory_code, rule_id, rule_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      materialId,
      material.order_no || '',
      material.customer_name || '',
      operationType,
      material.model || '',
      material.batch || '',
      quantity,
      material.package || '',
      material.version || '',
      material.productionDate || '',
      material.traceNo || '',
      material.sourceNo || '',
      scannedAt,
      material.raw_content,
      material.customFields ? JSON.stringify(material.customFields) : null,
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

  const inserted = await database.getFirstAsync<{
    id: string;
    order_no: string | null;
    operation_type: string | null;
    model: string | null;
    raw_content: string | null;
  }>(
    'SELECT id, order_no, operation_type, model, raw_content FROM materials WHERE id = ?',
    [materialId]
  );
  verifyMaterialWriteResult(inserted, material, materialId);

  const accountKey = material.erp_account_key || getErpAccountByOutboundOrderNo(material.order_no)?.key;
  if (accountKey) {
    await database.runAsync('UPDATE materials SET erp_account_key = ? WHERE id = ?', [accountKey, materialId]);
  }

  return materialId;
};

const checkpointAfterCriticalWrite = async (
  database: SQLite.SQLiteDatabase,
  label: string
): Promise<void> => {
  if (isWebPlatform) {
    logger.log(`${label} Web 预览环境跳过 WAL checkpoint`);
    return;
  }

  committedWritesSinceCheckpoint += 1;
  if (committedWritesSinceCheckpoint < WRITE_CHECKPOINT_BATCH_SIZE) {
    return;
  }
  committedWritesSinceCheckpoint = 0;

  const checkpoint = await runFullWalCheckpoint(database);
  if (checkpoint.completed) {
    pendingCriticalWriteCheckpointLabel = null;
    return;
  }

  const checkpointMessage = `${label} 已提交，但 WAL FULL checkpoint 未完全完成，无法确认主数据库文件已合并到最新状态`;
  pendingCriticalWriteCheckpointLabel = label;
  logger.warn(
    `${checkpointMessage}，将在下一次关键写入前重试`,
    checkpoint.error || checkpoint.lastCheckpoint || 'no checkpoint result'
  );
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
    const preparedMaterial = prepareMaterialWritePayload(material);
    logger.log('[addMaterial] 获取数据库连接成功');
    return await runExclusiveWriteTransaction(database, 'addMaterial', async (transactionDatabase) => {
      return insertMaterialWithDatabase(transactionDatabase, preparedMaterial);
    });
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
    const preparedMaterial = prepareMaterialWritePayload(material);
    const materialId = await runExclusiveWriteTransaction(
      database,
      'addMaterialWithOrder',
      async (transactionDatabase) => {
        await upsertOrderWithDatabase(transactionDatabase, preparedMaterial.order_no, customerName, warehouse);
        return insertMaterialWithDatabase(transactionDatabase, preparedMaterial);
      }
    );
    return materialId;
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

    const result = await runDatabaseReadWithRetry('getMaterial', () =>
      getDb().getFirstAsync<any>('SELECT * FROM materials WHERE id = ?', [id.trim()])
    );

    if (!result) return null;

    // 转换 customFields
    return {
      ...result,
      customFields: safeJsonParseNullable<Record<string, string>>(result.customFields, 'database.safeJsonParseNullable'),
      isUnpacked: result.isUnpacked === 1,
    };
  } catch (error) {
    logger.error('[getMaterial] 获取物料记录失败:', error);
    throw error;
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

    let sql = `SELECT
      m.*,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM materials m
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(m.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(m.version), '') COLLATE NOCASE
    WHERE m.order_no = ?`;
    const params: any[] = [orderNo.trim()];

    if (warehouseId && typeof warehouseId === 'string' && warehouseId.trim() !== '') {
      sql += ' AND m.warehouse_id = ?';
      params.push(warehouseId.trim());
    }

    sql += ' ORDER BY m.scanned_at DESC, m.id DESC';

    const results = await runDatabaseReadWithRetry('getMaterialsByOrder', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return results.map((r) => ({
      ...r,
      customFields: safeJsonParseNullable<Record<string, string>>(r.customFields, 'database.safeJsonParseNullable'),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('[getMaterialsByOrder] 获取订单物料失败:', error);
    throw error;
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
      customFields: safeJsonParseNullable<Record<string, string>>(record.customFields, 'database.safeJsonParseNullable'),
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

    let unpackTraceSql = `
      SELECT m.*
      FROM unpack_records u
      JOIN materials m ON m.id = u.original_material_id
      WHERE (TRIM(u.traceNo) = ? OR TRIM(u.new_traceNo) = ?)`;
    const unpackTraceParams: any[] = [duplicateIdentifier.value, duplicateIdentifier.value];
    if (trimmedWarehouseId) {
      unpackTraceSql += " AND (u.warehouse_id = ? OR u.warehouse_id IS NULL OR u.warehouse_id = '')";
      unpackTraceParams.push(trimmedWarehouseId);
    }
    unpackTraceSql += `
      ORDER BY CASE WHEN u.label_type = 'shipped' THEN 0 ELSE 1 END,
               u.unpacked_at DESC,
               u.id DESC
      LIMIT 1`;

    const existingInUnpackRecord = await database.getFirstAsync<any>(
      unpackTraceSql,
      unpackTraceParams
    );
    if (existingInUnpackRecord) {
      const material = mapMaterialRecord(existingInUnpackRecord);
      return { material, isUnpacked: true, canRescan: false };
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

export const hasAnyBusinessData = async (): Promise<boolean> => {
  try {
    const result = await runDatabaseReadWithRetry('hasAnyBusinessData', () =>
      getDb().getFirstAsync<{ exists: number }>(`
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM orders LIMIT 1)
            OR EXISTS (SELECT 1 FROM materials LIMIT 1)
            OR EXISTS (SELECT 1 FROM inbound_records LIMIT 1)
            OR EXISTS (SELECT 1 FROM inventory_check_records LIMIT 1)
            OR EXISTS (SELECT 1 FROM unpack_records LIMIT 1)
          THEN 1
          ELSE 0
        END AS [exists]
      `)
    );

    return result?.exists === 1;
  } catch (error) {
    logger.error('[hasAnyBusinessData] 检查业务数据是否存在失败:', error);
    throw error;
  }
};

// 获取所有物料记录
export const getAllMaterials = async (warehouseId?: string): Promise<MaterialRecord[]> => {
  try {
    let sql = `SELECT
      m.*,
      COALESCE(NULLIF(TRIM(m.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM materials m
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(m.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(m.version), '') COLLATE NOCASE`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE m.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY m.scanned_at DESC';

    const results = await runDatabaseReadWithRetry('getAllMaterials', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return results.map((r) => ({
      ...r,
      customFields: safeJsonParseNullable<Record<string, string>>(r.customFields, 'database.safeJsonParseNullable'),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('获取物料列表失败:', error);
    throw error;
  }
};

export const getOutboundExportRows = async (warehouseId?: string): Promise<OutboundExportRow[]> => {
  try {
    const database = getDb();
    const conditions = ["m.operation_type = 'outbound'"];
    const params: SQLite.SQLiteBindValue[] = [];
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
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(m.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(m.version), '') COLLATE NOCASE`;

    if (warehouseId) {
      conditions.push('m.warehouse_id = ?');
      params.push(warehouseId);
    }

    sql += ` WHERE ${conditions.join(' AND ')}
      ORDER BY m.scanned_at DESC, m.id DESC`;

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
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(m.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(m.version), '') COLLATE NOCASE
    ${whereClause}
    ORDER BY m.scanned_at DESC, m.id DESC`;

    const results = await runDatabaseReadWithRetry('searchMaterials', () =>
      getDb().getAllAsync<any>(sql, queryParams)
    );

    return results.map((r) => ({
      ...r,
      customFields: safeJsonParseNullable<Record<string, string>>(r.customFields, 'database.safeJsonParseNullable'),
      isUnpacked: r.isUnpacked === 1,
    }));
  } catch (error) {
    logger.error('搜索物料记录失败:', error);
    throw error;
  }
};

// Deleting either split label cancels the parent operation, never just half of a label pair.
const deleteMaterialsWithDatabase = async (
  transactionDatabase: SQLite.SQLiteDatabase,
  ids: string[]
): Promise<void> => {
  const deleting = new Set(ids);
  for (const id of deleting) {
    const dependents = await transactionDatabase.getAllAsync<{ id: string }>(
      `SELECT m.id FROM materials m
       WHERE m.id != ? AND EXISTS (
         SELECT 1 FROM unpack_records u
         WHERE u.original_material_id = ? AND TRIM(COALESCE(u.new_traceNo, '')) != ''
           AND COALESCE(m.warehouse_id, '') = COALESCE(u.warehouse_id, '')
           AND (TRIM(m.traceNo) = TRIM(u.new_traceNo) OR EXISTS (
             SELECT 1 FROM unpack_records next
             WHERE next.original_material_id = m.id AND TRIM(next.traceNo) = TRIM(u.new_traceNo)
           ))
       )`, [id, id]
    );
    if (dependents.some(row => !deleting.has(row.id))) {
      throw new Error('拆包后的标签已有后续出库记录，请先撤销后续出库，再删除原拆包');
    }
  }
  for (const trimmedId of deleting) {
    const materialRow = await transactionDatabase.getFirstAsync<{
      order_no: string | null;
      warehouse_id: string | null;
    }>('SELECT order_no, warehouse_id FROM materials WHERE id = ?', [trimmedId]);
    await transactionDatabase.runAsync('DELETE FROM unpack_records WHERE original_material_id = ?', [trimmedId]);
    await transactionDatabase.runAsync('DELETE FROM materials WHERE id = ?', [trimmedId]);

    if (materialRow?.order_no) {
      const remainingMaterial = await transactionDatabase.getFirstAsync<{ count: number }>(
        materialRow.warehouse_id
          ? 'SELECT COUNT(*) as count FROM materials WHERE order_no = ? AND warehouse_id = ?'
          : "SELECT COUNT(*) as count FROM materials WHERE order_no = ? AND (warehouse_id IS NULL OR warehouse_id = '')",
        materialRow.warehouse_id ? [materialRow.order_no, materialRow.warehouse_id] : [materialRow.order_no]
      );

      if ((remainingMaterial?.count || 0) === 0) {
        await transactionDatabase.runAsync(
          materialRow.warehouse_id
            ? 'DELETE FROM orders WHERE order_no = ? AND warehouse_id = ?'
            : "DELETE FROM orders WHERE order_no = ? AND (warehouse_id IS NULL OR warehouse_id = '')",
          materialRow.warehouse_id ? [materialRow.order_no, materialRow.warehouse_id] : [materialRow.order_no]
        );
      }
    }
  }
};

// 删除物料记录
export const deleteMaterial = async (id: string): Promise<void> => {
  try {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      logger.warn('[deleteMaterial] 无效的 id:', id);
      return;
    }
    await runExclusiveWriteTransaction(getDb(), 'deleteMaterial', transactionDatabase =>
      deleteMaterialsWithDatabase(transactionDatabase, [id.trim()]));
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
    await runExclusiveWriteTransaction(database, 'updateMaterialCustomFields', async (transactionDatabase) => {
      await transactionDatabase.runAsync('UPDATE materials SET customFields = ? WHERE id = ?', [
        JSON.stringify(customFields),
        id.trim(),
      ]);
    });
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
    await runExclusiveWriteTransaction(database, 'updateMaterialQuantity', async (transactionDatabase) => {
      await updateMaterialWithDatabase(transactionDatabase, id.trim(), { quantity: parsedQuantity });
    });
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
  if (updates.batch !== undefined || updates.productionDate !== undefined) {
    const current = await database.getFirstAsync<MaterialRecord>('SELECT * FROM materials WHERE id = ?', [id]);
    if (current && updates.batch !== undefined && (current.batch || '') !== updates.batch) throw new Error('批次只能由扫码解析，不允许手动修改');
    if (current && updates.productionDate !== undefined && (current.productionDate || '') !== updates.productionDate) {
      throw new Error('生产日期只能由扫码解析，不允许手动修改');
    }
  }
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
    await runExclusiveWriteTransaction(database, 'updateMaterial', async (transactionDatabase) => {
      await updateMaterialWithDatabase(transactionDatabase, id, updates);
    });
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
    let sql = `SELECT
      u.*,
      COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code,
      NULLIF(TRIM(ib.supplier), '') AS supplier
    FROM unpack_records u
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(u.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(u.version), '') COLLATE NOCASE`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE u.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY u.unpacked_at DESC';

    const results = await runDatabaseReadWithRetry('getAllUnpackRecords', () =>
      getDb().getAllAsync<any>(sql, params)
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取拆包记录失败:', error);
    throw error;
  }
};

// 获取待打印的拆包记录
export const getPendingUnpackRecords = async (warehouseId?: string): Promise<UnpackRecord[]> => {
  try {
    let sql = `SELECT
      u.*,
      COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code,
      NULLIF(TRIM(ib.supplier), '') AS supplier
    FROM unpack_records u
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(u.model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(u.version), '') COLLATE NOCASE
    WHERE u.status = 'pending'`;
    const params: any[] = [];

    if (warehouseId) {
      sql += ' AND u.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY u.unpacked_at DESC';

    const results = await runDatabaseReadWithRetry('getPendingUnpackRecords', () =>
      getDb().getAllAsync<any>(sql, params)
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取待打印记录失败:', error);
    throw error;
  }
};

// 获取已打印的拆包记录
export const getPrintedUnpackRecords = async (): Promise<UnpackRecord[]> => {
  try {
    const results = await runDatabaseReadWithRetry('getPrintedUnpackRecords', () =>
      getDb().getAllAsync<any>(
        `SELECT
        u.*,
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code,
        NULLIF(TRIM(ib.supplier), '') AS supplier
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib
        ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(u.model) COLLATE NOCASE
        AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
          COALESCE(TRIM(u.version), '') COLLATE NOCASE
      WHERE u.status = 'printed'
      ORDER BY u.unpacked_at DESC`
      )
    );
    return results as UnpackRecord[];
  } catch (error) {
    logger.error('获取已打印记录失败:', error);
    throw error;
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
  createMaterial?: {
    material: MaterialWritePayload;
    customerName?: string;
    warehouse: OrderWarehouseInfo;
  };
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

  try {
    const result = await runExclusiveWriteTransaction(
      database,
      'saveUnpackOperation',
      async (transactionDatabase) => {
        if (params.createMaterial) {
          const materialToCreate = prepareMaterialWritePayload({
            ...params.createMaterial.material,
            id: params.material.id,
          });
          await upsertOrderWithDatabase(
            transactionDatabase,
            materialToCreate.order_no,
            params.createMaterial.customerName,
            params.createMaterial.warehouse
          );
          await insertMaterialWithDatabase(transactionDatabase, materialToCreate);
        }

        const currentMaterial = await transactionDatabase.getFirstAsync<any>(
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

        const shippedTraceNo =
          trimmedNewTraceNo || getNextUnpackTraceNoAfter(currentMaterial.traceNo);
        const remainingTraceNo =
          remainingQuantity > 0 ? getNextUnpackTraceNoAfter(shippedTraceNo) : '';

        if (shippedTraceNo) {
          await assertUnpackTraceNoAvailable(
            transactionDatabase,
            shippedTraceNo,
            params.material.id
          );
        }
        if (remainingTraceNo) {
          await assertUnpackTraceNoAvailable(
            transactionDatabase,
            remainingTraceNo,
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
        const sourceTraceNo = currentMaterial.traceNo || '';
        const nextMaterialTraceNo = remainingTraceNo || shippedTraceNo || sourceTraceNo;
        const remainingRecordTraceNo = remainingQuantity > 0 ? nextMaterialTraceNo : '';

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
          sourceNo: currentMaterial.sourceNo || '',
          pair_id: pairId,
          status: 'pending' as const,
          notes,
          unpacked_at: timestamp,
        };

        const shippedRecord = await insertUnpackRecord(
          transactionDatabase,
          {
            ...baseRecord,
            traceNo: sourceTraceNo,
            new_traceNo: shippedTraceNo,
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
          transactionDatabase,
          {
            ...baseRecord,
            traceNo: remainingRecordTraceNo,
            new_traceNo: remainingTraceNo,
            new_quantity: remainingQuantity.toString(),
            label_type: 'remaining',
          },
          {
            createdAt: timestamp,
            updatedAt: timestamp,
            unpackedAt: timestamp,
          }
        );

        await updateMaterialWithDatabase(transactionDatabase, params.material.id, {
          traceNo: nextMaterialTraceNo,
          quantity: updatedShippedQuantity,
          original_quantity: materialOriginalQuantity,
          remaining_quantity: remainingQuantity.toString(),
          isUnpacked: true,
        });

        return { pairId, shippedRecord, remainingRecord };
      }
    );
    return result;
  } catch (error) {
    logger.error('保存拆包操作失败:', error);
    throw error;
  }
};

// 标记拆包记录为已打印
export const markUnpackRecordsAsPrinted = async (ids: string[]): Promise<void> => {
  try {
    if (ids.length === 0) {
      return;
    }

    const database = getDb();
    const placeholders = ids.map(() => '?').join(',');
    await runExclusiveWriteTransaction(database, 'markUnpackRecordsAsPrinted', async (transactionDatabase) => {
      await transactionDatabase.runAsync(
        `UPDATE unpack_records SET status = 'printed', printed_at = ? WHERE id IN (${placeholders})`,
        [getISODateTime(), ...ids]
      );
    });
  } catch (error) {
    logger.error('标记拆包记录失败:', error);
    throw error;
  }
};

// 删除拆包记录会撤销对应的整条出库物料及其全部成对标签。
export const deleteUnpackRecord = async (id: string): Promise<void> => {
  if (typeof id !== 'string' || !id.trim()) return;
  await deleteUnpackRecords([id]);
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
    await runExclusiveWriteTransaction(database, 'deleteUnpackRecords', async (transactionDatabase) => {
      const parents = await transactionDatabase.getAllAsync<{ original_material_id: string }>(
        `SELECT DISTINCT original_material_id FROM unpack_records WHERE id IN (${placeholders})`, normalizedIds
      );
      await deleteMaterialsWithDatabase(transactionDatabase, parents.map(row => row.original_material_id).filter(Boolean));
      await transactionDatabase.runAsync(
        `DELETE FROM unpack_records WHERE id IN (${placeholders})`,
        normalizedIds
      );
    });
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
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code,
        NULLIF(TRIM(ib.supplier), '') AS supplier
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib
        ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(u.model) COLLATE NOCASE
        AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
          COALESCE(TRIM(u.version), '') COLLATE NOCASE
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
        COALESCE(NULLIF(TRIM(u.inventory_code), ''), ib.inventory_code) AS inventory_code,
        NULLIF(TRIM(ib.supplier), '') AS supplier
      FROM unpack_records u
      LEFT JOIN inventory_bindings ib
        ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(u.model) COLLATE NOCASE
        AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
          COALESCE(TRIM(u.version), '') COLLATE NOCASE
      WHERE (u.traceNo = ? OR u.new_traceNo = ?) AND u.label_type = 'shipped'
      ORDER BY u.unpacked_at DESC`,
      [traceNo.trim(), traceNo.trim()]
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

// ========== 仓库相关函数 ==========

// 获取所有仓库
export const getAllWarehouses = async (): Promise<Warehouse[]> => {
  try {
    logger.log('[getAllWarehouses] 开始获取仓库列表');
    const results = await runDatabaseReadWithRetry('getAllWarehouses', () =>
      getDb().getAllAsync<any>(
        'SELECT * FROM warehouses ORDER BY sort_order ASC, created_at DESC, id DESC'
      )
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
    throw error;
  }
};

// 获取默认仓库
export const getDefaultWarehouse = async (): Promise<Warehouse | null> => {
  try {
    const result = await runDatabaseReadWithRetry('getDefaultWarehouse', () =>
      getDb().getFirstAsync<any>(
        'SELECT * FROM warehouses WHERE is_default = 1 ORDER BY created_at ASC, id ASC LIMIT 1'
      )
    );

    if (!result) return null;

    return {
      ...result,
      is_default: result.is_default === 1,
    } as Warehouse;
  } catch (error) {
    logger.error('获取默认仓库失败:', error);
    throw error;
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

    await runExclusiveWriteTransaction(database, 'addWarehouse', async (transactionDatabase) => {
      const warehouseCount = await transactionDatabase.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM warehouses'
      );
      const shouldBeDefault = warehouse.is_default || (warehouseCount?.count || 0) === 0;
      const sortOrderResult = await transactionDatabase.getFirstAsync<{ max_sort_order: number | null }>(
        'SELECT MAX(sort_order) as max_sort_order FROM warehouses'
      );
      const sortOrder =
        typeof sortOrderResult?.max_sort_order === 'number' ? sortOrderResult.max_sort_order + 1 : 0;

      // 如果设置为默认仓库，先取消其他仓库的默认状态
      if (shouldBeDefault) {
        await transactionDatabase.runAsync('UPDATE warehouses SET is_default = 0');
      }

      await transactionDatabase.runAsync(
        'INSERT INTO warehouses (id, name, description, is_default, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          id,
          warehouse.name,
          warehouse.description || null,
          shouldBeDefault ? 1 : 0,
          sortOrder,
          isoDateTime,
        ]
      );
    });

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

    await runExclusiveWriteTransaction(database, 'reorderWarehouses', async (transactionDatabase) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await transactionDatabase.runAsync('UPDATE warehouses SET sort_order = ? WHERE id = ?', [
          index,
          orderedIds[index],
        ]);
      }
    });
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
      await runExclusiveWriteTransaction(database, 'updateWarehouse', async (transactionDatabase) => {
        if (updates.is_default === false) {
          const otherDefault = await transactionDatabase.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) AS count FROM warehouses WHERE id != ? AND is_default = 1',
            [id]
          );
          if ((otherDefault?.count || 0) === 0) {
            throw new Error('至少需要保留一个默认仓库，请先将其他仓库设为默认');
          }
        }

        // 如果设置为默认仓库，先取消其他仓库的默认状态
        if (updates.is_default) {
          await transactionDatabase.runAsync('UPDATE warehouses SET is_default = 0 WHERE id != ?', [id]);
        }

        values.push(id);
        await transactionDatabase.runAsync(
          `UPDATE warehouses SET ${updateFields.join(', ')} WHERE id = ?`,
          values
        );
      });
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
    const trimmedId = id.trim();

    await runExclusiveWriteTransaction(database, 'deleteWarehouse', async (transactionDatabase) => {
      const countRows = [
        await transactionDatabase.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM inbound_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
        await transactionDatabase.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM inventory_check_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
        await transactionDatabase.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM materials WHERE warehouse_id = ?',
          [trimmedId]
        ),
        await transactionDatabase.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM orders WHERE warehouse_id = ?',
          [trimmedId]
        ),
        await transactionDatabase.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM unpack_records WHERE warehouse_id = ?',
          [trimmedId]
        ),
      ];
      const referencedCount = countRows.reduce((sum, row) => sum + (row?.count || 0), 0);

      if (referencedCount > 0) {
        throw new Error('该仓库已有业务数据，不能删除。请先备份数据库；如确需清理，请使用对应业务记录页面逐项删除。');
      }

      // 仅允许删除无业务数据引用的空仓库，避免误删整仓历史记录。
      await transactionDatabase.runAsync('DELETE FROM warehouses WHERE id = ?', [trimmedId]);
    });
    logger.log(`[deleteWarehouse] 空仓库 ${trimmedId} 已删除`);
  } catch (error) {
    logger.error('删除仓库失败:', error);
    throw error;
  }
};

// ========== 物料管理（存货编码绑定）相关函数 ==========

const normalizeInventoryBinding = (binding: InventoryBinding): InventoryBinding => ({
  ...binding,
  version: typeof binding.version === 'string' ? binding.version : '',
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
      'WHERE scan_model LIKE ? OR COALESCE(version, \'\') LIKE ? OR inventory_code LIKE ? OR COALESCE(supplier, \'\') LIKE ?',
    params: [likeKeyword, likeKeyword, likeKeyword, likeKeyword] as (string | number)[],
  };
};

// 获取所有物料绑定
export const getAllInventoryBindings = async (): Promise<InventoryBinding[]> => {
  try {
    const results = await runDatabaseReadWithRetry('getAllInventoryBindings', () =>
      getDb().getAllAsync<InventoryBinding>(
        'SELECT * FROM inventory_bindings ORDER BY created_at DESC'
      )
    );
    return results.map(normalizeInventoryBinding);
  } catch (error) {
    logger.error('获取物料绑定列表失败:', error);
    throw error;
  }
};

const hydrateInboundRecordRows = async (rows: any[]): Promise<InboundRecord[]> => {
  const uniqueRows = deduplicateInboundRowsById(rows);
  const normalizedRows = uniqueRows.map((row) => ({
    ...row,
    scan_model: normalizeInboundModel(row.scan_model),
    version: normalizeInboundVersion(row.version),
    inventory_code: String(row.inventory_code || '').trim(),
    rawContent: row.rawContent ?? row.raw_content ?? '',
  }));
  const missingInventoryCodeKeys = new Set(
    normalizedRows
      .filter((row) => !row.inventory_code && row.scan_model)
      .map((row) => buildInboundModelVersionKey(row.scan_model, row.version))
  );
  let bindings: InventoryBinding[] = [];
  if (missingInventoryCodeKeys.size > 0) {
    try {
      bindings = await getAllInventoryBindings();
    } catch (error) {
      logger.warn('[hydrateInboundRecordRows] 读取物料绑定失败，保留原入库记录:', error);
    }
  }

  return normalizedRows.map((row) => {
    const inventoryCode =
      row.inventory_code ||
      resolveInboundInventoryCodeFromBindings(bindings, row.scan_model, row.version);

    return {
      ...row,
      inventory_code: inventoryCode,
      customFields:
        typeof row.customFields === 'string'
          ? safeJsonParseNullable<Record<string, string>>(
              row.customFields,
              'database.inboundRecordCustomFields'
            )
          : row.customFields || undefined,
    };
  }) as InboundRecord[];
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
    const normalizedPageSize = Math.max(1, Math.floor(pageSize));
    const { whereClause, params } = buildInventoryBindingSearchClause(keyword);

    const totalResult = await runDatabaseReadWithRetry('getInventoryBindingsPage.total', () =>
      getDb().getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM inventory_bindings ${whereClause}`,
        params
      )
    );
    const total = totalResult?.count || 0;
    const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 1;
    const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
    const offset = (safePage - 1) * normalizedPageSize;

    const items = await runDatabaseReadWithRetry('getInventoryBindingsPage.items', () =>
      getDb().getAllAsync<InventoryBinding>(
        `SELECT * FROM inventory_bindings ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, normalizedPageSize, offset]
      )
    );

    return {
      items: items.map(normalizeInventoryBinding),
      total,
      page: safePage,
      pageSize: normalizedPageSize,
    };
  } catch (error) {
    logger.error('分页获取物料绑定失败:', error);
    throw error;
  }
};

// 根据扫描型号获取存货编码
export const getInventoryCodeByModel = async (
  scanModel: string,
  version?: string
): Promise<string | null> => {
  try {
    // 参数验证
    if (!scanModel || typeof scanModel !== 'string' || scanModel.trim() === '') {
      logger.warn('[getInventoryCodeByModel] 无效的 scanModel:', scanModel);
      return null;
    }

    const database = getDb();
    const normalizedModel = scanModel.trim();
    const normalizedVersion = version?.trim() || '';

    if (normalizedVersion) {
      const exactVersionResult = await database.getFirstAsync<{ inventory_code: string }>(
        "SELECT inventory_code FROM inventory_bindings WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
        [normalizedModel, normalizedVersion]
      );

      if (exactVersionResult?.inventory_code) {
        return exactVersionResult.inventory_code.trim();
      }
    }

    const result = await database.getFirstAsync<{ inventory_code: string }>(
      "SELECT inventory_code FROM inventory_bindings WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ''",
      [normalizedModel]
    );
    return result?.inventory_code?.trim() || null;
  } catch (error) {
    logger.error('[getInventoryCodeByModel] 获取存货编码失败:', error);
    return null;
  }
};

/**
 * 仅按“扫描型号 + 版本号”精确查询物料绑定。
 *
 * 业务扫码仍使用 getInventoryCodeByModel 的既有回退逻辑；本方法只供
 * 规则冲突诊断使用，避免把“有版本但未精确匹配”的候选误判为已绑定。
 */
export const getExactInventoryCodeByModelVersion = async (
  scanModel: string,
  version?: string
): Promise<string | null> => {
  try {
    const normalizedModel = typeof scanModel === 'string' ? scanModel.trim() : '';
    if (!normalizedModel) return null;

    const normalizedVersion = typeof version === 'string' ? version.trim() : '';
    const result = await getDb().getFirstAsync<{ inventory_code: string }>(
      "SELECT inventory_code FROM inventory_bindings WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
      [normalizedModel, normalizedVersion]
    );
    return result?.inventory_code?.trim() || null;
  } catch (error) {
    logger.error('[getExactInventoryCodeByModelVersion] 获取精确存货编码失败:', error);
    return null;
  }
};

// 根据扫描型号获取供应商
export const getSupplierByModel = async (scanModel: string): Promise<string | null> => {
  try {
    const database = getDb();
    const result = await database.getFirstAsync<{ supplier: string }>(
      'SELECT supplier FROM inventory_bindings WHERE scan_model = ? COLLATE NOCASE',
      [scanModel]
    );
    return result?.supplier || null;
  } catch (error) {
    logger.error('获取供应商失败:', error);
    return null;
  }
};

export const getSupplierForInventoryBinding = async ({
  scanModel,
  version,
  inventoryCode,
}: {
  scanModel: string;
  version?: string | null;
  inventoryCode?: string | null;
}): Promise<string | null> => {
  try {
    const database = getDb();
    const normalizedInventoryCode = inventoryCode?.trim() || '';
    if (normalizedInventoryCode) {
      const codeMatch = await database.getFirstAsync<{ supplier?: string | null }>(
        `SELECT supplier
         FROM inventory_bindings
         WHERE TRIM(inventory_code) = ? COLLATE NOCASE
         LIMIT 1`,
        [normalizedInventoryCode]
      );
      const supplier = codeMatch?.supplier?.trim();
      if (supplier) {
        return supplier;
      }
    }

    const normalizedModel = scanModel.trim();
    if (!normalizedModel) {
      return null;
    }

    const normalizedVersion = version?.trim() || '';
    const modelMatch = await database.getFirstAsync<{ supplier?: string | null }>(
      `SELECT supplier
       FROM inventory_bindings
       WHERE TRIM(scan_model) = ? COLLATE NOCASE
         AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE
       LIMIT 1`,
      [normalizedModel, normalizedVersion]
    );
    const supplier = modelMatch?.supplier?.trim();
    if (supplier) {
      return supplier;
    }

    if (!normalizedVersion) {
      return null;
    }

    const defaultVersionMatch = await database.getFirstAsync<{ supplier?: string | null }>(
      `SELECT supplier
       FROM inventory_bindings
       WHERE TRIM(scan_model) = ? COLLATE NOCASE
         AND COALESCE(TRIM(version), '') = ''
       LIMIT 1`,
      [normalizedModel]
    );
    return defaultVersionMatch?.supplier?.trim() || null;
  } catch (error) {
    logger.error('[getSupplierForInventoryBinding] 获取物料绑定供应商失败:', error);
    return null;
  }
};

const syncInventoryCodeToHistoricalRecordsWithDatabase = async (
  database: SQLite.SQLiteDatabase,
  scanModel: string,
  inventoryCode: string | null | undefined,
  version?: string | null
): Promise<void> => {
  const normalizedModel = typeof scanModel === 'string' ? scanModel.trim() : '';
  if (!normalizedModel) {
    return;
  }
  const normalizedVersion = typeof version === 'string' ? version.trim() : '';

  const normalizedInventoryCode =
    typeof inventoryCode === 'string' && inventoryCode.trim() ? inventoryCode.trim() : null;

  await database.runAsync(
    "UPDATE materials SET inventory_code = ? WHERE TRIM(model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
    [normalizedInventoryCode, normalizedModel, normalizedVersion]
  );
  await database.runAsync(
    "UPDATE unpack_records SET inventory_code = ? WHERE TRIM(model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
    [normalizedInventoryCode, normalizedModel, normalizedVersion]
  );
  await database.runAsync(
    "UPDATE inbound_records SET inventory_code = ? WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
    [normalizedInventoryCode, normalizedModel, normalizedVersion]
  );
  await database.runAsync(
    "UPDATE inventory_check_records SET inventory_code = ? WHERE TRIM(scan_model) = ? COLLATE NOCASE AND COALESCE(TRIM(version), '') = ? COLLATE NOCASE",
    [normalizedInventoryCode, normalizedModel, normalizedVersion]
  );
};

// 添加物料绑定
export const addInventoryBinding = async (
  binding: Omit<InventoryBinding, 'id' | 'created_at'>
): Promise<string> => {
  try {
    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();
    const scanModel = binding.scan_model.trim();
    const version = binding.version?.trim() || '';
    const inventoryCode = binding.inventory_code.trim();
    if (!scanModel || !inventoryCode) {
      throw new Error('物料绑定的型号和存货编码不能为空');
    }

    await runExclusiveWriteTransaction(database, 'addInventoryBinding', async (transactionDatabase) => {
      const duplicate = await transactionDatabase.getFirstAsync<{ id: string }>(
        `SELECT id
         FROM inventory_bindings
         WHERE inventory_code = ? COLLATE NOCASE
            OR (
              scan_model = ? COLLATE NOCASE
              AND COALESCE(version, '') = ? COLLATE NOCASE
            )
         LIMIT 1`,
        [inventoryCode, scanModel, version]
      );
      if (duplicate) {
        throw new Error('该存货编码或型号与版本组合已存在');
      }

      await transactionDatabase.runAsync(
        'INSERT INTO inventory_bindings (id, scan_model, version, inventory_code, supplier, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          scanModel,
          version,
          inventoryCode,
          binding.supplier?.trim() || null,
          binding.description?.trim() || null,
          isoDateTime,
        ]
      );

      await syncInventoryCodeToHistoricalRecordsWithDatabase(
        transactionDatabase,
        scanModel,
        inventoryCode,
        version
      );
    });

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

    const nextBinding = {
      scan_model:
        typeof updates.scan_model === 'string'
          ? updates.scan_model.trim()
          : existingBinding.scan_model.trim(),
      version:
        typeof updates.version === 'string'
          ? updates.version.trim()
          : existingBinding.version?.trim() || '',
      inventory_code:
        typeof updates.inventory_code === 'string'
          ? updates.inventory_code.trim()
          : existingBinding.inventory_code.trim(),
      supplier:
        typeof updates.supplier === 'string'
          ? updates.supplier.trim()
          : updates.supplier === null
            ? ''
            : existingBinding.supplier?.trim() || '',
      description:
        typeof updates.description === 'string'
          ? updates.description.trim()
          : updates.description === null
            ? ''
            : existingBinding.description?.trim() || '',
    };
    if (!nextBinding.scan_model || !nextBinding.inventory_code) {
      throw new Error('物料绑定的型号和存货编码不能为空');
    }

    const updateFields: string[] = [];
    const values: SQLite.SQLiteBindValue[] = [];
    const appendUpdate = (column: string, value: SQLite.SQLiteBindValue) => {
      updateFields.push(`${column} = ?`);
      values.push(value);
    };

    if (updates.scan_model !== undefined) appendUpdate('scan_model', nextBinding.scan_model);
    if (updates.version !== undefined) appendUpdate('version', nextBinding.version);
    if (updates.inventory_code !== undefined) {
      appendUpdate('inventory_code', nextBinding.inventory_code);
    }
    if (updates.supplier !== undefined) appendUpdate('supplier', nextBinding.supplier || null);
    if (updates.description !== undefined) {
      appendUpdate('description', nextBinding.description || null);
    }

    if (updateFields.length > 0) {
      await runExclusiveWriteTransaction(database, 'updateInventoryBinding', async (transactionDatabase) => {
        const duplicate = await transactionDatabase.getFirstAsync<{ id: string }>(
          `SELECT id
           FROM inventory_bindings
           WHERE id != ?
             AND (
               inventory_code = ? COLLATE NOCASE
               OR (
                 scan_model = ? COLLATE NOCASE
                 AND COALESCE(version, '') = ? COLLATE NOCASE
               )
             )
           LIMIT 1`,
          [id, nextBinding.inventory_code, nextBinding.scan_model, nextBinding.version]
        );
        if (duplicate) {
          throw new Error('该存货编码或型号与版本组合已存在');
        }

        await transactionDatabase.runAsync(
          `UPDATE inventory_bindings SET ${updateFields.join(', ')} WHERE id = ?`,
          [...values, id]
        );

        await syncInventoryCodeToHistoricalRecordsWithDatabase(
          transactionDatabase,
          nextBinding.scan_model,
          nextBinding.inventory_code,
          nextBinding.version
        );
      });
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
    await runExclusiveWriteTransaction(database, 'deleteInventoryBinding', async (transactionDatabase) => {
      await transactionDatabase.runAsync('DELETE FROM inventory_bindings WHERE id = ?', [id.trim()]);
    });
  } catch (error) {
    logger.error('[deleteInventoryBinding] 删除物料绑定失败:', error);
    throw error;
  }
};

// 批量导入物料绑定
export const importInventoryBindings = async (
  bindings: Array<{
    scan_model: string;
    version?: string;
    inventory_code: string;
    supplier?: string;
    description?: string;
  }>
): Promise<InventoryBindingImportResult> => {
  try {
    const database = getDb();
    const result: InventoryBindingImportResult = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: [],
    };

    await runExclusiveWriteTransaction(database, 'importInventoryBindings', async (transactionDatabase) => {
      for (const [bindingIndex, binding] of bindings.entries()) {
        const normalizedModel = binding.scan_model.trim();
        const normalizedVersion = binding.version?.trim() || '';
        const normalizedInventoryCode = binding.inventory_code.trim();
        const normalizedSupplier = binding.supplier?.trim() || '';
        const normalizedDescription = binding.description?.trim() || '';

        if (!normalizedModel || !normalizedInventoryCode) {
          throw new Error(
            `物料绑定第 ${bindingIndex + 1} 行缺少型号或存货编码，已取消整批导入`
          );
        }

        const existingByCode = await transactionDatabase.getFirstAsync<InventoryBinding>(
          'SELECT * FROM inventory_bindings WHERE inventory_code = ? COLLATE NOCASE',
          [normalizedInventoryCode]
        );
        const existingByModelVersion = await transactionDatabase.getFirstAsync<InventoryBinding>(
          "SELECT * FROM inventory_bindings WHERE scan_model = ? COLLATE NOCASE AND COALESCE(version, '') = ? COLLATE NOCASE",
          [normalizedModel, normalizedVersion]
        );

        const existing =
          existingByCode &&
          existingByModelVersion &&
          existingByCode.id === existingByModelVersion.id
            ? existingByCode
            : null;

        if ((existingByCode || existingByModelVersion) && !existing) {
          result.conflicts.push(
            normalizedVersion
              ? `${normalizedModel}/${normalizedVersion}（${normalizedInventoryCode}）`
              : `${normalizedModel}（${normalizedInventoryCode}）`
          );
          continue;
        }

        if (existing) {
          const currentSupplier = existing.supplier?.trim() || '';
          const currentDescription = existing.description?.trim() || '';
          const nextSupplier = normalizedSupplier || currentSupplier;
          const nextDescription = normalizedDescription || currentDescription;
          if (
            currentSupplier === nextSupplier &&
            currentDescription === nextDescription
          ) {
            result.unchanged++;
            continue;
          }

          await transactionDatabase.runAsync(
            'UPDATE inventory_bindings SET supplier = ?, description = ? WHERE id = ?',
            [nextSupplier || null, nextDescription || null, existing.id]
          );
          result.updated++;
          continue;
        }

        await transactionDatabase.runAsync(
          'INSERT INTO inventory_bindings (id, scan_model, version, inventory_code, supplier, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            generateId(),
            normalizedModel,
            normalizedVersion,
            normalizedInventoryCode,
            normalizedSupplier || null,
            normalizedDescription || null,
            getISODateTime(),
          ]
        );

        await syncInventoryCodeToHistoricalRecordsWithDatabase(
          transactionDatabase,
          normalizedModel,
          normalizedInventoryCode,
          normalizedVersion
        );

        result.inserted++;
      }
    });

    return result;
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
    let sql = 'SELECT i.* FROM inbound_records i';
    const params: any[] = [];

    if (warehouseId) {
      sql += ' WHERE i.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY i.created_at DESC';

    const results = await runDatabaseReadWithRetry('getAllInboundRecords', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return await hydrateInboundRecordRows(results);
  } catch (error) {
    logger.error('获取入库记录失败:', error);
    throw error;
  }
};

export const getInboundExportSummaryRows = async (
  warehouseId?: string
): Promise<InboundExportSummaryRow[]> => {
  try {
    const params: SQLite.SQLiteBindValue[] = [];
    const conditions: string[] = [];

    if (warehouseId) {
      conditions.push('i.warehouse_id = ?');
      params.push(warehouseId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await runDatabaseReadWithRetry('getInboundExportSummaryRows', () =>
      getDb().getAllAsync<any>(
        `SELECT
        COALESCE(i.warehouse_name, '') AS warehouse_name,
        COALESCE(NULLIF(TRIM(i.inventory_code), ''), ib.inventory_code, '') AS inventory_code,
        COALESCE(i.scan_model, '') AS scan_model,
        COALESCE(i.version, '') AS version,
        COALESCE(i.package, '') AS package,
        SUM(COALESCE(i.quantity, 0)) AS total_quantity,
        COALESCE(i.in_date, '') AS in_date
      FROM inbound_records i
      LEFT JOIN inventory_bindings ib
        ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(i.scan_model) COLLATE NOCASE
        AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
          COALESCE(TRIM(i.version), '') COLLATE NOCASE
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
      )
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
    throw error;
  }
};

export const getInboundDocumentSummaries = async (
  warehouseId?: string
): Promise<InboundDocumentSummary[]> => {
  try {
    let sql = `
      SELECT
        inbound_no,
        warehouse_id,
        MAX(warehouse_name) AS warehouse_name,
        MAX(in_date) AS in_date,
        MAX(created_at) AS created_at,
        COUNT(*) AS record_count,
        COUNT(DISTINCT UPPER(TRIM(scan_model))) AS model_count,
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

    const rows = await runDatabaseReadWithRetry('getInboundDocumentSummaries', () =>
      getDb().getAllAsync<any>(sql, params)
    );

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
    throw error;
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

    let sql = `SELECT
      i.id,
      i.inbound_no,
      i.warehouse_id,
      i.warehouse_name,
      i.inventory_code,
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
    WHERE i.inbound_no = ?`;
    const params: any[] = [trimmedInboundNo];

    if (warehouseId) {
      sql += ' AND i.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY i.created_at DESC, i.id DESC';

    const rows = await runDatabaseReadWithRetry('getInboundRecordsByNo', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return await hydrateInboundRecordRows(rows);
  } catch (error) {
    logger.error('[getInboundRecordsByNo] 获取入库单明细失败:', error);
    throw error;
  }
};

/**
 * 检查入库记录中是否已存在指定的 traceNo（追踪码）
 * @param traceNo 追踪码
 * @returns 存在返回 true，否则 false
 */
export const checkInboundTraceNoExists = async (
  traceNo: string,
  _warehouseId?: string,
  excludedRecordIds: string[] = []
): Promise<boolean> => {
  try {
    const trimmedTraceNo = traceNo.trim();
    if (!trimmedTraceNo) {
      return false;
    }

    const database = getDb();
    const normalizedExcludedIds = excludedRecordIds.map((id) => id.trim()).filter(Boolean);
    let sql = 'SELECT 1 FROM inbound_records WHERE traceNo = ?';
    const params: SQLite.SQLiteBindValue[] = [trimmedTraceNo];

    if (normalizedExcludedIds.length > 0) {
      sql += ` AND id NOT IN (${normalizedExcludedIds.map(() => '?').join(', ')})`;
      params.push(...normalizedExcludedIds);
    }

    sql += ' LIMIT 1';

    const row = await database.getFirstAsync<any>(sql, params);
    return !!row;
  } catch (error) {
    logger.error('[checkInboundTraceNoExists] 查询追踪码失败:', error);
    return true;
  }
};

type InboundRecordInsert = Omit<InboundRecord, 'id' | 'created_at'> & {
  id?: string;
};

const insertInboundRecord = async (
  database: SQLite.SQLiteDatabase,
  record: InboundRecordInsert,
  options?: {
    id?: string;
    createdAt?: string;
  }
): Promise<string> => {
  const id = options?.id || record.id || generateId();
  const createdAt = options?.createdAt || getISODateTime();
  const quantity = parseQuantity(record.quantity, { min: 1 });
  const normalizedModel = normalizeInboundModel(record.scan_model);
  const normalizedVersion = normalizeInboundVersion(record.version);
  const normalizedInventoryCode = String(record.inventory_code || '').trim();

  if (quantity === null) {
    throw new Error('入库数量无效，必须为大于 0 的整数');
  }
  if (!normalizedModel) {
    throw new Error('入库型号不能为空');
  }

  await database.runAsync(
    `INSERT INTO inbound_records (
      id, inbound_no, warehouse_id, warehouse_name, inventory_code, scan_model, batch,
      quantity, in_date, notes, raw_content, created_at, package, version,
      productionDate, traceNo, sourceNo, customFields, rule_id, rule_name, sync_status,
      sync_file_name, synced_at, sync_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.inbound_no,
      record.warehouse_id,
      record.warehouse_name,
      normalizedInventoryCode || null,
      normalizedModel,
      record.batch || null,
      quantity,
      record.in_date,
      record.notes || null,
      record.rawContent || null,
      createdAt,
      record.package || null,
      normalizedVersion || null,
      record.productionDate || null,
      record.traceNo || null,
      record.sourceNo || null,
      record.customFields ? JSON.stringify(record.customFields) : null,
      record.rule_id || null,
      record.rule_name || null,
      record.sync_status || 'pending',
      record.sync_file_name || null,
      record.synced_at || null,
      record.sync_message || null,
    ]
  );

  if (record.erp_account_key) {
    await database.runAsync('UPDATE inbound_records SET erp_account_key = ? WHERE id = ?', [record.erp_account_key, id]);
  }
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
    let id = '';
    await runExclusiveWriteTransaction(database, 'addInboundRecord', async (transactionDatabase) => {
      id = await insertInboundRecord(transactionDatabase, record);
    });
    return id;
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

    await runExclusiveWriteTransaction(database, 'addInboundRecordsBatch', async (transactionDatabase) => {
      assertUniqueTraceNosInBatch(records, '入库记录');
      const existingRecords: ExistingInboundRecordIdentity[] = [];
      const recordsToInsert: InboundRecordInsert[] = [];

      for (const record of records) {
        const stableId = record.id?.trim();
        const existing = stableId
          ? await transactionDatabase.getFirstAsync<ExistingInboundRecordIdentity>(
              `SELECT id, inbound_no, warehouse_id, inventory_code, scan_model, version, quantity, traceNo, batch, productionDate, erp_account_key
               FROM inbound_records
               WHERE id = ?
               LIMIT 1`,
              [stableId]
            )
          : null;

        if (!existing) {
          recordsToInsert.push(record);
          continue;
        }
        if (!isEquivalentInboundRecord(existing, record)) {
          throw new Error('检测到相同记录标识对应不同入库内容，请清空草稿后重新扫描');
        }
        existingRecords.push(existing);
        ids.push(existing.id);
      }

      if (existingRecords.length > 0 && recordsToInsert.length > 0) {
        throw new Error('检测到入库草稿仅有部分记录已保存，请勿继续提交并检查入库记录');
      }
      if (existingRecords.length === records.length) {
        return;
      }

      await assertInboundTraceNosNotAlreadySaved(transactionDatabase, records);

      for (const record of recordsToInsert) {
        ids.push(await insertInboundRecord(transactionDatabase, record));
      }
    });
    return ids;
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
    await runExclusiveWriteTransaction(database, 'updateInboundDocumentSyncStatus', async (transactionDatabase) => {
      await transactionDatabase.runAsync(
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
    });
  } catch (error) {
    logger.error('[updateInboundDocumentSyncStatus] 更新入库单同步状态失败:', error);
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

    await runExclusiveWriteTransaction(database, 'deleteInboundRecord', async (transactionDatabase) => {
      await transactionDatabase.runAsync('DELETE FROM inbound_records WHERE id = ?', [trimmedId]);
    });
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

    await runExclusiveWriteTransaction(database, 'deleteInboundDocument', async (transactionDatabase) => {
      await transactionDatabase.runAsync(
        'DELETE FROM inbound_records WHERE inbound_no = ? AND warehouse_id = ?',
        [trimmedInboundNo, trimmedWarehouseId]
      );
    });
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
    throw new Error('无法生成盘点单号，请稍后重试');
  }
};

// 获取所有盘点记录
export const getAllInventoryCheckRecords = async (
  warehouseId?: string,
  checkType?: 'whole' | 'partial'
): Promise<InventoryCheckRecord[]> => {
  try {
    let sql = `SELECT
      c.*,
      COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code) AS inventory_code
    FROM inventory_check_records c
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(c.scan_model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(c.version), '') COLLATE NOCASE`;
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

    const results = await runDatabaseReadWithRetry('getAllInventoryCheckRecords', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return results.map((r) => ({
      ...r,
      customFields: safeJsonParseNullable<Record<string, string>>(r.customFields, 'database.safeJsonParseNullable'),
    })) as InventoryCheckRecord[];
  } catch (error) {
    logger.error('获取盘点记录失败:', error);
    throw error;
  }
};

export const getInventoryCheckExportSummaryRows = async (
  warehouseId?: string,
  checkType?: 'whole' | 'partial'
): Promise<InventoryCheckExportSummaryRow[]> => {
  try {
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
    const rows = await runDatabaseReadWithRetry('getInventoryCheckExportSummaryRows', () =>
      getDb().getAllAsync<any>(
        `SELECT
        COALESCE(c.warehouse_name, '') AS warehouse_name,
        COALESCE(NULLIF(TRIM(c.inventory_code), ''), ib.inventory_code, '') AS inventory_code,
        COALESCE(c.scan_model, '') AS scan_model,
        COALESCE(c.version, '') AS version,
        COALESCE(c.package, '') AS package,
        SUM(COALESCE(c.actual_quantity, c.quantity, 0)) AS total_quantity,
        COALESCE(c.check_date, '') AS check_date
      FROM inventory_check_records c
      LEFT JOIN inventory_bindings ib
        ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(c.scan_model) COLLATE NOCASE
        AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
          COALESCE(TRIM(c.version), '') COLLATE NOCASE
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
      )
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
    throw error;
  }
};

export const getInventoryCheckDocumentSummaries = async (
  warehouseId?: string,
  erpAccountKey?: string
): Promise<InventoryCheckDocumentSummary[]> => {
  try {
    let sql = `
      SELECT
        check_no,
        warehouse_id,
        MAX(warehouse_name) AS warehouse_name,
        MAX(check_date) AS check_date,
        MAX(created_at) AS created_at,
        COUNT(*) AS record_count,
        COUNT(DISTINCT TRIM(scan_model) || '|' || COALESCE(TRIM(version), '')) AS model_count,
        SUM(COALESCE(actual_quantity, quantity, 0)) AS total_quantity,
        SUM(CASE WHEN check_type = 'whole' THEN 1 ELSE 0 END) AS whole_count,
        SUM(CASE WHEN check_type = 'partial' THEN 1 ELSE 0 END) AS partial_count,
        CASE
          WHEN SUM(CASE WHEN sync_status = 'success' THEN 1 ELSE 0 END) = COUNT(*) THEN 'success'
          WHEN SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
          ELSE 'pending'
        END AS sync_status,
        MAX(sync_file_name) AS sync_file_name,
        MAX(synced_at) AS synced_at,
        MAX(sync_message) AS sync_message,
        MAX(erp_account_key) AS erp_account_key,
        MAX(erp_account_name) AS erp_account_name
      FROM inventory_check_records`;
    const params: any[] = [];

    const conditions: string[] = [];
    if (warehouseId) {
      conditions.push('warehouse_id = ?');
      params.push(warehouseId);
    }
    if (erpAccountKey) {
      conditions.push('erp_account_key = ?');
      params.push(erpAccountKey);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += `
      GROUP BY check_no, warehouse_id
      ORDER BY MAX(created_at) DESC, check_no DESC`;

    const rows = await runDatabaseReadWithRetry('getInventoryCheckDocumentSummaries', () =>
      getDb().getAllAsync<any>(sql, params)
    );

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
      erp_account_key: row.erp_account_key || undefined,
      erp_account_name: row.erp_account_name || undefined,
    }));
  } catch (error) {
    logger.error('[getInventoryCheckDocumentSummaries] 获取盘点单列表失败:', error);
    throw error;
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
      c.rule_id,
      c.rule_name,
      c.sync_status,
      c.sync_file_name,
      c.synced_at,
      c.sync_message,
      c.erp_account_key,
      c.erp_account_name,
      c.erp_quantity
    FROM inventory_check_records c
    LEFT JOIN inventory_bindings ib
      ON TRIM(ib.scan_model) COLLATE NOCASE = TRIM(c.scan_model) COLLATE NOCASE
      AND COALESCE(TRIM(ib.version), '') COLLATE NOCASE =
        COALESCE(TRIM(c.version), '') COLLATE NOCASE
    WHERE c.check_no = ?`;
    const params: any[] = [trimmedCheckNo];

    if (warehouseId) {
      sql += ' AND c.warehouse_id = ?';
      params.push(warehouseId);
    }

    sql += ' ORDER BY c.created_at DESC, c.id DESC';

    const rows = await runDatabaseReadWithRetry('getInventoryCheckRecordsByNo', () =>
      getDb().getAllAsync<any>(sql, params)
    );

    return rows.map((row) => ({
      ...row,
      customFields: safeJsonParseNullable<Record<string, string>>(row.customFields, 'database.safeJsonParseNullable'),
    })) as InventoryCheckRecord[];
  } catch (error) {
    logger.error('[getInventoryCheckRecordsByNo] 获取盘点单明细失败:', error);
    throw error;
  }
};

/**
 * 返回已经写入正式盘点表的草稿记录 ID。
 *
 * 盘点保存成功但 AsyncStorage 草稿清理失败时，首页不能继续把这些记录
 * 显示成“盘点暂存”。按 ID 批量核对也能保持保存操作的幂等性。
 */
export const getExistingInventoryCheckRecordIds = async (
  recordIds: string[]
): Promise<Set<string>> => {
  const normalizedIds = Array.from(
    new Set(recordIds.map((id) => id.trim()).filter(Boolean))
  );
  if (normalizedIds.length === 0) {
    return new Set();
  }

  if (!db) {
    await initDatabase();
  }

  const database = getDb();
  const existingIds = new Set<string>();
  const chunkSize = 400;
  for (let offset = 0; offset < normalizedIds.length; offset += chunkSize) {
    const chunk = normalizedIds.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await runDatabaseReadWithRetry(
      'getExistingInventoryCheckRecordIds',
      () =>
        database.getAllAsync<{ id: string }>(
          `SELECT id FROM inventory_check_records WHERE id IN (${placeholders})`,
          chunk
        )
    );
    rows.forEach((row) => {
      const id = String(row.id || '').trim();
      if (id) {
        existingIds.add(id);
      }
    });
  }

  return existingIds;
};

type InventoryCheckRecordInsert = Omit<InventoryCheckRecord, 'id' | 'created_at'> & {
  id?: string;
};

type ExistingInventoryCheckRecordIdentity = {
  id: string;
  check_no: string;
  warehouse_id: string;
  inventory_code?: string | null;
  scan_model: string;
  version?: string | null;
  quantity?: number | null;
  check_type: string;
  actual_quantity?: number | null;
  traceNo?: string | null;
  erp_account_key?: string | null;
  erp_quantity?: number | null;
  batch?: string | null;
  productionDate?: string | null;
};

const isEquivalentInventoryCheckRecord = (
  existing: ExistingInventoryCheckRecordIdentity,
  record: InventoryCheckRecordInsert
): boolean =>
  normalizeComparableText(existing.warehouse_id) === normalizeComparableText(record.warehouse_id) &&
  normalizeComparableText(existing.batch) === normalizeComparableText(record.batch) &&
  normalizeComparableText(existing.productionDate) === normalizeComparableText(record.productionDate) &&
  normalizeComparableText(existing.inventory_code).toLocaleLowerCase() ===
    normalizeComparableText(record.inventory_code).toLocaleLowerCase() &&
  normalizeComparableText(existing.scan_model).toLocaleLowerCase() ===
    normalizeComparableText(record.scan_model).toLocaleLowerCase() &&
  normalizeComparableText(existing.version).toLocaleLowerCase() ===
    normalizeComparableText(record.version).toLocaleLowerCase() &&
  Number(existing.quantity) === Number(record.quantity) &&
  normalizeComparableText(existing.check_type) === normalizeComparableText(record.check_type) &&
  Number(existing.actual_quantity ?? 0) === Number(record.actual_quantity ?? 0) &&
  normalizeComparableText(existing.traceNo) === normalizeComparableText(record.traceNo) &&
  normalizeComparableText(existing.erp_account_key) ===
    normalizeComparableText(record.erp_account_key) &&
  Number(existing.erp_quantity ?? 0) === Number(record.erp_quantity ?? 0);

export type InventoryCheckBatchSaveResult = {
  ids: string[];
  checkNo: string;
  reusedExisting: boolean;
};

const insertInventoryCheckRecord = async (
  database: SQLite.SQLiteDatabase,
  record: InventoryCheckRecordInsert,
  options?: {
    id?: string;
    createdAt?: string;
  }
): Promise<string> => {
  const id = options?.id || record.id || generateId();
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
      version, productionDate, traceNo, sourceNo, customFields, rule_id, rule_name, sync_status,
      sync_file_name, synced_at, sync_message, erp_account_key, erp_account_name, erp_quantity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      record.customFields ? JSON.stringify(record.customFields) : null,
      record.rule_id || null,
      record.rule_name || null,
      record.sync_status || 'pending',
      record.sync_file_name || null,
      record.synced_at || null,
      record.sync_message || null,
      record.erp_account_key || null,
      record.erp_account_name || null,
      record.erp_quantity ?? null,
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
    let id = '';
    await runExclusiveWriteTransaction(database, 'addInventoryCheckRecord', async (transactionDatabase) => {
      id = await insertInventoryCheckRecord(transactionDatabase, record);
    });
    return id;
  } catch (error) {
    logger.error('添加盘点记录失败:', error);
    throw error;
  }
};

export const addInventoryCheckRecordsBatch = async (
  records: InventoryCheckRecordInsert[]
): Promise<InventoryCheckBatchSaveResult> => {
  if (records.length === 0) {
    return { ids: [], checkNo: '', reusedExisting: false };
  }

  try {
    if (!db) {
      logger.warn('[addInventoryCheckRecordsBatch] 数据库未初始化，等待初始化...');
      await initDatabase();
    }

    const database = getDb();
    const ids: string[] = [];
    let savedCheckNo = records[0]?.check_no?.trim() || '';
    let reusedExisting = false;

    await runExclusiveWriteTransaction(database, 'addInventoryCheckRecordsBatch', async (transactionDatabase) => {
      assertUniqueTraceNosInBatch(records, '盘点记录');

      const existingRecords: ExistingInventoryCheckRecordIdentity[] = [];
      const recordsToInsert: InventoryCheckRecordInsert[] = [];
      for (const record of records) {
        const stableId = record.id?.trim();
        const existing = stableId
          ? await transactionDatabase.getFirstAsync<ExistingInventoryCheckRecordIdentity>(
              `SELECT id, check_no, warehouse_id, inventory_code, scan_model, version, quantity,
                      check_type, actual_quantity, traceNo, erp_account_key, erp_quantity, batch, productionDate
               FROM inventory_check_records
               WHERE id = ?
               LIMIT 1`,
              [stableId]
            )
          : null;

        if (!existing) {
          recordsToInsert.push(record);
          continue;
        }
        if (!isEquivalentInventoryCheckRecord(existing, record)) {
          throw new Error('检测到相同记录标识对应不同盘点内容，请清空草稿后重新扫描');
        }
        existingRecords.push(existing);
        ids.push(existing.id);
      }

      if (existingRecords.length > 0 && recordsToInsert.length > 0) {
        throw new Error('检测到盘点草稿仅有部分记录已保存，请勿继续提交并检查盘点记录');
      }
      if (existingRecords.length === records.length) {
        const existingCheckNos = new Set(
          existingRecords.map((record) => record.check_no.trim()).filter(Boolean)
        );
        if (existingCheckNos.size !== 1) {
          throw new Error('盘点草稿记录已分散到多个盘点单，请清空草稿并检查盘点记录');
        }
        savedCheckNo = Array.from(existingCheckNos)[0];
        reusedExisting = true;
        return;
      }

      for (const record of recordsToInsert) {
        ids.push(await insertInventoryCheckRecord(transactionDatabase, record));
      }
    });
    return { ids, checkNo: savedCheckNo, reusedExisting };
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
    await runExclusiveWriteTransaction(database, 'updateInventoryCheckDocumentSyncStatus', async (transactionDatabase) => {
      await transactionDatabase.runAsync(
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
    });
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
    await runExclusiveWriteTransaction(database, 'deleteInventoryCheckRecord', async (transactionDatabase) => {
      await transactionDatabase.runAsync('DELETE FROM inventory_check_records WHERE id = ?', [id.trim()]);
    });
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
    await runExclusiveWriteTransaction(database, 'deleteInventoryCheckDocument', async (transactionDatabase) => {
      await transactionDatabase.runAsync(
        'DELETE FROM inventory_check_records WHERE check_no = ? AND warehouse_id = ?',
        [trimmedCheckNo, trimmedWarehouseId]
      );
    });
  } catch (error) {
    logger.error('[deleteInventoryCheckDocument] 删除盘点单失败:', error);
    throw error;
  }
};

// ========== 二维码规则相关函数 ==========

type QRCodeRuleConfiguration = Pick<
  QRCodeRule,
  'name' | 'separator' | 'terminator' | 'fieldOrder' | 'matchConditions' | 'fieldPrefixes'
>;

export const normalizeQRCodeRuleName = (name: string): string =>
  name.normalize('NFKC').trim().toLowerCase();

const assertUniqueQRCodeRuleName = async (
  database: SQLite.SQLiteDatabase,
  name: string,
  excludedRuleId?: string,
): Promise<void> => {
  const normalizedName = normalizeQRCodeRuleName(name);
  const rules = await database.getAllAsync<Pick<QRCodeRule, 'id' | 'name'>>(
    'SELECT id, name FROM qr_code_rules',
  );
  const duplicate = rules.find(rule =>
    rule.id !== excludedRuleId && normalizeQRCodeRuleName(rule.name) === normalizedName,
  );
  if (duplicate) {
    throw new Error(`解析规则名称“${name.trim()}”已存在，请使用不同名称`);
  }
};

const makeQRCodeRuleNamesUnique = (rules: QRCodeRule[]): {
  rules: QRCodeRule[];
  renamed: Array<{ from: string; to: string }>;
} => {
  const usedNames = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const normalizedRules = rules.map((rule) => {
    const baseName = rule.name.trim();
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(normalizeQRCodeRuleName(name))) {
      name = `${baseName} (${suffix})`;
      suffix += 1;
    }
    usedNames.add(normalizeQRCodeRuleName(name));
    if (name !== rule.name) renamed.push({ from: rule.name, to: name });
    return { ...rule, name };
  });
  return { rules: normalizedRules, renamed };
};

const assertValidQRCodeRuleConfiguration = (
  rule: QRCodeRuleConfiguration,
): void => {
  if (!rule.name.trim()) {
    throw new Error('解析规则名称不能为空');
  }
  if (!rule.separator) {
    throw new Error(`解析规则“${rule.name}”的分隔符不能为空`);
  }
  assertValidRuleTerminator(rule.terminator);
  if (!Array.isArray(rule.fieldOrder) || rule.fieldOrder.length < 2) {
    throw new Error(`解析规则“${rule.name}”至少需要配置 2 个字段`);
  }

  const seenFields = new Set<string>();
  rule.fieldOrder.forEach((fieldName, index) => {
    const normalizedFieldName = String(fieldName || '').trim();
    const isStandardField = AVAILABLE_FIELDS.includes(normalizedFieldName);
    if (!isStandardField && !isIgnoredRuleField(normalizedFieldName)) {
      throw new Error(`解析规则“${rule.name}”第 ${index + 1} 段字段无效`);
    }
    if (seenFields.has(normalizedFieldName)) {
      throw new Error(`解析规则“${rule.name}”重复使用了字段：${normalizedFieldName}`);
    }
    seenFields.add(normalizedFieldName);
  });

  (rule.matchConditions || []).forEach((condition, index) => {
    if (
      !Number.isInteger(condition.fieldIndex) ||
      condition.fieldIndex < 0 ||
      condition.fieldIndex >= rule.fieldOrder.length
    ) {
      throw new Error(`解析规则“${rule.name}”第 ${index + 1} 个识别条件位置无效`);
    }
    if (!condition.keyword.trim()) {
      throw new Error(`解析规则“${rule.name}”第 ${index + 1} 个识别条件不能为空`);
    }
    if (condition.operator !== undefined && !isConditionOperator(condition.operator)) {
      throw new Error(`解析规则“${rule.name}”第 ${index + 1} 个识别条件类型无效`);
    }
  });

  Object.keys(rule.fieldPrefixes || {}).forEach((fieldName) => {
    if (!seenFields.has(fieldName)) {
      throw new Error(`解析规则“${rule.name}”包含未选字段的前缀配置`);
    }
  });
};

// 获取所有规则
export const getAllRules = async (): Promise<QRCodeRule[]> => {
  try {
    const results = await runDatabaseReadWithRetry('getAllRules', () =>
      getDb().getAllAsync<any>('SELECT * FROM qr_code_rules')
    );

    return sortRulesForDisplay(results.map(normalizeRuleRecord));
  } catch (error) {
    logger.error('获取规则列表失败:', error);
    throw error;
  }
};

// 获取启用的规则
export const getActiveRules = async (): Promise<QRCodeRule[]> => {
  try {
    const rules = await getAllRules();
    return rules.filter((r) => r.isActive);
  } catch (error) {
    logger.error('获取启用规则失败:', error);
    throw error;
  }
};

// 保存规则列表的手工展示顺序（只影响列表展示，不参与扫码匹配与冲突判断）。
export const setRulesDisplayOrder = async (orderedIds: string[]): Promise<void> => {
  try {
    const database = getDb();
    await runExclusiveWriteTransaction(database, 'setRulesDisplayOrder', async (transactionDatabase) => {
      for (let index = 0; index < orderedIds.length; index++) {
        await transactionDatabase.runAsync(
          'UPDATE qr_code_rules SET display_order = ? WHERE id = ?',
          [index + 1, orderedIds[index]]
        );
      }
    });
  } catch (error) {
    logger.error('保存规则排序失败:', error);
    throw error;
  }
};

// 添加规则
export const addRule = async (
  rule: Omit<QRCodeRule, 'id' | 'created_at' | 'updated_at'>
): Promise<string> => {
  try {
    rule = migrateLegacyRuleFields({ ...rule, name: rule.name.trim() });
    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();

    await runExclusiveWriteTransaction(database, 'addRule', async (transactionDatabase) => {
      assertValidQRCodeRuleConfiguration(rule);
      await assertUniqueQRCodeRuleName(transactionDatabase, rule.name);
      await transactionDatabase.runAsync(
        `INSERT INTO qr_code_rules (
          id, name, description, separator, field_order, custom_field_ids, is_active,
          supplier_name, match_conditions, field_prefixes, terminator, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          rule.name,
          rule.description || null,
          rule.separator,
          JSON.stringify(rule.fieldOrder),
          rule.customFieldIds ? JSON.stringify(rule.customFieldIds) : null,
          rule.isActive ? 1 : 0,
          rule.supplierName || null,
          rule.matchConditions ? JSON.stringify(rule.matchConditions) : null,
          rule.fieldPrefixes ? JSON.stringify(rule.fieldPrefixes) : null,
          rule.terminator || '',
          isoDateTime,
          isoDateTime,
        ]
      );
    });

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
  terminator: 'terminator',
};

// 更新规则
export const updateRule = async (id: string, updates: Partial<QRCodeRule>): Promise<void> => {
  try {
    if (updates.name !== undefined) updates = { ...updates, name: updates.name.trim() };
    if (updates.fieldOrder) updates = migrateLegacyRuleFields({ ...updates, fieldOrder: updates.fieldOrder });
    const trimmedId = id.trim();
    if (!trimmedId) {
      throw new Error('解析规则 ID 不能为空');
    }
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
        values.push(JSON.stringify(value));
      } else if (key === 'customFieldIds') {
        updateFields.push('custom_field_ids = ?');
        values.push(JSON.stringify(value));
      } else if (key === 'matchConditions') {
        updateFields.push('match_conditions = ?');
        values.push(JSON.stringify(value));
      } else if (key === 'fieldPrefixes') {
        updateFields.push('field_prefixes = ?');
        values.push(JSON.stringify(value));
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
      values.push(trimmedId);
      await runExclusiveWriteTransaction(database, 'updateRule', async (transactionDatabase) => {
        const rawRule = await transactionDatabase.getFirstAsync<any>(
          'SELECT * FROM qr_code_rules WHERE id = ? LIMIT 1',
          [trimmedId]
        );
        if (!rawRule) {
          throw new Error('解析规则不存在或已被删除');
        }
        const currentRule = normalizeRuleRecord(rawRule);
        const mergedRule: QRCodeRule = { ...currentRule, ...updates, id: currentRule.id };
        assertValidQRCodeRuleConfiguration(mergedRule);
        await assertUniqueQRCodeRuleName(transactionDatabase, mergedRule.name, currentRule.id);
        await transactionDatabase.runAsync(
          `UPDATE qr_code_rules SET ${updateFields.join(', ')} WHERE id = ?`,
          values
        );
      });
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
    await runExclusiveWriteTransaction(database, 'deleteRule', async (transactionDatabase) => {
      await transactionDatabase.runAsync('DELETE FROM qr_code_rules WHERE id = ?', [id.trim()]);
    });
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

    const result = await runDatabaseReadWithRetry('getRuleById', () =>
      getDb().getFirstAsync<any>('SELECT * FROM qr_code_rules WHERE id = ?', [id.trim()])
    );

    if (!result) return null;

    return normalizeRuleRecord(result);
  } catch (error) {
    logger.error('获取规则失败:', error);
    throw error;
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
    const results = await runDatabaseReadWithRetry('getAllCustomFields', () =>
      getDb().getAllAsync<CustomFieldRow>('SELECT * FROM custom_fields ORDER BY sort_order ASC')
    );

    return results.map(normalizeCustomFieldRecord);
  } catch (error) {
    logger.error('获取自定义字段列表失败:', error);
    throw error;
  }
};

// 添加自定义字段
export const addCustomField = async (
  field: Omit<CustomField, 'id' | 'created_at' | 'updated_at' | 'sortOrder'>
): Promise<string> => {
  try {
    const normalizedName = field.name.trim();
    if (!normalizedName) {
      throw new Error('占位字段名称不能为空');
    }
    if (!isCustomFieldType(field.type)) {
      throw new Error(`无效的自定义字段类型: ${String(field.type)}`);
    }

    const database = getDb();
    const id = generateId();
    const isoDateTime = getISODateTime();
    const normalizedOptions = field.type === 'select' ? field.options : undefined;

    await runExclusiveWriteTransaction(database, 'addCustomField', async (transactionDatabase) => {
      const duplicate = await transactionDatabase.getFirstAsync<{ id: string }>(
        'SELECT id FROM custom_fields WHERE TRIM(name) = ? COLLATE NOCASE LIMIT 1',
        [normalizedName]
      );
      if (duplicate) {
        throw new Error(`占位字段名称已存在：${normalizedName}`);
      }
      // 获取当前最大排序值
      const maxResult = await transactionDatabase.getFirstAsync<{ max: number }>(
        'SELECT MAX(sort_order) as max FROM custom_fields'
      );
      const maxSort = Number(maxResult?.max ?? 0) || 0;

      await transactionDatabase.runAsync(
        'INSERT INTO custom_fields (id, name, type, required, options, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          normalizedName,
          field.type,
          field.required ? 1 : 0,
          normalizedOptions ? JSON.stringify(normalizedOptions) : null,
          maxSort + 1,
          isoDateTime,
          isoDateTime,
        ]
      );
    });

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
    const trimmedId = id.trim();
    if (!trimmedId) {
      throw new Error('占位字段 ID 不能为空');
    }
    const database = getDb();
    const updateFields: string[] = [];
    const values: SQLite.SQLiteBindValue[] = [];

    if (typeof updates.name === 'string') {
      const normalizedName = updates.name.trim();
      if (!normalizedName) {
        throw new Error('占位字段名称不能为空');
      }
      updateFields.push('name = ?');
      values.push(normalizedName);
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
      values.push(updates.options.length > 0 ? JSON.stringify(updates.options) : null);
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
      values.push(trimmedId);
      await runExclusiveWriteTransaction(database, 'updateCustomField', async (transactionDatabase) => {
        if (typeof updates.name === 'string') {
          const duplicate = await transactionDatabase.getFirstAsync<{ id: string }>(
            'SELECT id FROM custom_fields WHERE TRIM(name) = ? COLLATE NOCASE AND id != ? LIMIT 1',
            [updates.name.trim(), trimmedId]
          );
          if (duplicate) {
            throw new Error(`占位字段名称已存在：${updates.name.trim()}`);
          }
        }
        await transactionDatabase.runAsync(
          `UPDATE custom_fields SET ${updateFields.join(', ')} WHERE id = ?`,
          values
        );
      });
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

    await runExclusiveWriteTransaction(database, 'deleteCustomField', async (transactionDatabase) => {
      const rules = await transactionDatabase.getAllAsync<any>('SELECT * FROM qr_code_rules');
      const referencedRules = rules
        .map((rawRule) => normalizeRuleRecord(rawRule))
        .filter(
          (rule) =>
            rule.fieldOrder.includes(customFieldKey) ||
            (rule.customFieldIds || []).includes(trimmedId)
        );

      if (referencedRules.length > 0) {
        throw new Error(
          `该占位字段仍被解析规则使用：${referencedRules
            .map((rule) => rule.name)
            .join('、')}。请先在这些规则中替换或移除该占位字段`
        );
      }

      await transactionDatabase.runAsync('DELETE FROM custom_fields WHERE id = ?', [trimmedId]);
    });
  } catch (error) {
    logger.error('[deleteCustomField] 删除自定义字段失败:', error);
    throw error;
  }
};

// 重新排序自定义字段
export const reorderCustomFields = async (fieldIds: string[]): Promise<void> => {
  const database = getDb();
  try {
    await runExclusiveWriteTransaction(database, 'reorderCustomFields', async (transactionDatabase) => {
      for (let i = 0; i < fieldIds.length; i++) {
        await transactionDatabase.runAsync('UPDATE custom_fields SET sort_order = ? WHERE id = ?', [
          i + 1,
          fieldIds[i],
        ]);
      }
    });
  } catch (error) {
    logger.error('重新排序自定义字段失败:', error);
    throw error;
  }
};

// ========== 二维码解析相关函数（逻辑部分，不涉及存储） ==========

const splitByBracketPair = (
  str: string,
  leftBracket: string,
  rightBracket: string
): string[] => {
  let s = str.trim();
  if (s.startsWith(leftBracket)) s = s.slice(leftBracket.length);
  if (s.endsWith(rightBracket)) s = s.slice(0, -rightBracket.length);
  return s.split(rightBracket + leftBracket).map((p) => p.trim());
};

const getBracketPairFromSeparator = (
  separator: string
): { left: string; right: string } | null => {
  const characters = Array.from(separator);
  if (characters.length !== 2 || characters[0] === characters[1]) {
    return null;
  }

  return { left: characters[0], right: characters[1] };
};

const matchesBracketPair = (content: string, left: string, right: string): boolean => {
  const normalized = content.trim();
  return (
    normalized.startsWith(left) &&
    normalized.endsWith(right) &&
    normalized.includes(`${right}${left}`)
  );
};

const splitBySeparator = (content: string, separator: string): string[] => {
  if (!separator) {
    return [content.trim()];
  }

  return content.split(separator).map((part) => part.trim());
};

const isLikelyDateValue = (value: string): boolean => {
  const numbers = value.match(/\d+/g);
  if (!numbers || numbers.length < 3) {
    return false;
  }

  for (let index = 0; index <= numbers.length - 3; index += 1) {
    const yearText = numbers[index];
    const monthText = numbers[index + 1];
    const dayText = numbers[index + 2];

    if (!/^\d{4}$/.test(yearText)) {
      continue;
    }

    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);

    if (year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return true;
    }
  }

  return false;
};

const normalizeSplitPartsForRule = (parts: string[], rule: QRCodeRule): string[] => {
  const fieldOrder = rule.fieldOrder || [];
  const expectedCount = fieldOrder.length;

  if (expectedCount === 0) {
    return parts;
  }

  // Some supplier QR codes use the separator as a record terminator, for example
  // "MODEL;LOT;QTY;". Ignore only surplus empty fields at the end so empty fields
  // in the middle continue to preserve their configured positions.
  const effectiveParts = [...parts];
  while (
    effectiveParts.length > expectedCount &&
    effectiveParts[effectiveParts.length - 1] === ''
  ) {
    effectiveParts.pop();
  }

  if (effectiveParts.length <= expectedCount) {
    return effectiveParts;
  }

  const buildParts = (fieldIndex: number, partIndex: number, normalized: string[]): string[] | null => {
    if (fieldIndex === expectedCount) {
      return partIndex === effectiveParts.length ? normalized : null;
    }

    const remainingFields = expectedCount - fieldIndex - 1;
    const remainingParts = effectiveParts.length - partIndex;
    if (remainingParts < remainingFields + 1) {
      return null;
    }

    const maxConsumeCount = remainingParts - remainingFields;
    const consumeCounts = Array.from({ length: maxConsumeCount }, (_, index) => index + 1);

    for (const consumeCount of consumeCounts) {
      const fieldName = fieldOrder[fieldIndex];
      const mergedValue = effectiveParts
        .slice(partIndex, partIndex + consumeCount)
        .join(rule.separator)
        .trim();

      // Reassemble dates split by their own delimiter, not a complete date plus another field.
      if (
        consumeCount > 1 &&
        (!isLikelyDateValue(stripConfiguredFieldPrefix(mergedValue, rule.fieldPrefixes?.[fieldName])) ||
          effectiveParts.slice(partIndex, partIndex + consumeCount).some(isLikelyDateValue))
      ) {
        continue;
      }

      const result = buildParts(fieldIndex + 1, partIndex + consumeCount, [
        ...normalized,
        mergedValue,
      ]);
      if (result) {
        return result;
      }
    }

    return null;
  };

  return buildParts(0, 0, []) || effectiveParts;
};

const splitContentByRule = (content: string, rule: QRCodeRule): string[] => {
  // Same-as-separator endings are handled by field count, preserving required empty fields.
  const terminator = rule.terminator === rule.separator ? undefined : rule.terminator;
  const normalizedContent = stripRuleTerminator(content, terminator).content.trim();
  const configuredBracketPair = getBracketPairFromSeparator(rule.separator);
  const parts =
    configuredBracketPair &&
    matchesBracketPair(normalizedContent, configuredBracketPair.left, configuredBracketPair.right)
      ? splitByBracketPair(
          normalizedContent,
          configuredBracketPair.left,
          configuredBracketPair.right
        )
      : splitBySeparator(normalizedContent, rule.separator);

  return normalizeSplitPartsForRule(parts, rule);
};

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

// Shared by the editor and live detection so diagnostic results cannot drift from scanning.
export const inspectQRCodeRule = (content: string, rule: QRCodeRule) => {
  rule = migrateLegacyRuleFields(rule);
  const parts = splitContentByRule(content, rule);
  const errors: string[] = [];
  if (!content.trim()) errors.push('样本内容为空');
  if (!rule.separator) errors.push('分隔符未设置');
  if ((rule.separator === '/' || rule.separator === '//') && /^(?:https?|s?ftp):\/\//i.test(content.trimStart())) {
    errors.push('网址不作为物料二维码解析');
  }
  if (rule.fieldOrder.length < 2) errors.push('至少需要配置2段字段');
  if (parts.length !== rule.fieldOrder.length) {
    errors.push(`需要${rule.fieldOrder.length}段，实际${parts.length}段`);
  }
  rule.fieldOrder.forEach((field, index) => {
    const prefix = rule.fieldPrefixes?.[field];
    if (prefix?.trim() && !doesConfiguredFieldPrefixMatch(parts[index] ?? '', prefix)) {
      errors.push(`第${index + 1}段前缀不匹配：${prefix}`);
    }
  });
  (rule.matchConditions || []).forEach(condition => {
    if (parts[condition.fieldIndex] === undefined || !matchesRuleCondition(parts[condition.fieldIndex], condition)) {
      errors.push(`第${condition.fieldIndex + 1}段不满足“${CONDITION_OPERATORS[condition.operator ?? 'contains'] ?? '未知条件'} ${condition.keyword}”`);
    }
  });
  return { parts, errors, matched: errors.length === 0,
    values: parts.map((part, index) => stripConfiguredFieldPrefix(part, rule.fieldPrefixes?.[rule.fieldOrder[index]])),
  };
};

type RuleDetectionCandidate = {
  rule: QRCodeRule;
  parts: string[];
  fieldCount: number;
  matchConditionCount: number;
  separatorLength: number;
  configuredPrefixCount: number;
  matchedPrefixCount: number;
  matchedTerminatorLength: number;
};

export interface QRCodeRuleDetectionAnalysis {
  /** 所有通过分隔符、段数、前缀及手动条件校验的规则。 */
  matchedRules: QRCodeRule[];
  /** 实际参与最终优先级选择的规则；带识别条件的候选优先于普通候选。 */
  consideredRules: QRCodeRule[];
  /** 唯一胜出的规则；存在同优先级冲突时为 null。 */
  selectedRule: QRCodeRule | null;
  /** 与最佳候选优先级完全相同、无法由扫码内容自动区分的规则。 */
  conflictingRules: QRCodeRule[];
}

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

  if (a.matchConditionCount !== b.matchConditionCount) {
    return b.matchConditionCount - a.matchConditionCount;
  }

  if (a.matchedTerminatorLength !== b.matchedTerminatorLength) {
    return b.matchedTerminatorLength - a.matchedTerminatorLength;
  }

  if (a.separatorLength !== b.separatorLength) {
    return b.separatorLength - a.separatorLength;
  }

  if (a.fieldCount !== b.fieldCount) {
    return b.fieldCount - a.fieldCount;
  }

  return a.rule.name.localeCompare(b.rule.name, 'zh-CN');
};

const haveEquivalentRuleDetectionPriority = (
  a: RuleDetectionCandidate,
  b: RuleDetectionCandidate
): boolean =>
  a.matchedPrefixCount === b.matchedPrefixCount &&
  a.configuredPrefixCount === b.configuredPrefixCount &&
  a.matchConditionCount === b.matchConditionCount &&
  a.matchedTerminatorLength === b.matchedTerminatorLength &&
  a.separatorLength === b.separatorLength &&
  a.fieldCount === b.fieldCount;

const buildRuleDetectionCandidate = (
  content: string,
  rule: QRCodeRule,
  parts: string[]
): RuleDetectionCandidate => {
  const fieldCount = rule.fieldOrder?.length || 0;
  const prefixStats = getRulePrefixStats(rule, parts);
  return {
    rule,
    parts,
    fieldCount,
    matchConditionCount: rule.matchConditions?.length || 0,
    separatorLength: Array.from(rule.separator || '').length,
    configuredPrefixCount: prefixStats.configuredCount,
    matchedPrefixCount: prefixStats.matchedCount,
    matchedTerminatorLength: stripRuleTerminator(content, rule.terminator).matched
      ? rule.terminator!.length : 0,
  };
};

const selectBestRuleDetectionCandidate = (candidates: RuleDetectionCandidate[]): {
  best: RuleDetectionCandidate | null;
  conflicts: RuleDetectionCandidate[];
} => {
  if (candidates.length === 0) {
    return { best: null, conflicts: [] };
  }

  const sorted = candidates.slice().sort(compareRuleDetectionCandidates);
  const best = sorted[0];
  const conflicts = sorted.filter((candidate) =>
    haveEquivalentRuleDetectionPriority(best, candidate)
  );

  return { best, conflicts: conflicts.length > 1 ? conflicts : [] };
};

/**
 * 使用与业务扫码相同的优先级分析一个样本，供规则编辑页显示真实的区分结果。
 */
export const analyzeQRCodeRuleDetection = (
  content: string,
  activeRules: readonly QRCodeRule[]
): QRCodeRuleDetectionAnalysis => {
  const conditionedCandidates: RuleDetectionCandidate[] = [];
  const exactCandidates: RuleDetectionCandidate[] = [];

  // 每条规则只移除自身的结束符，再独立检查分隔符、前缀和识别条件。
  for (const originalRule of activeRules) {
    const rule = migrateLegacyRuleFields(originalRule);
    const inspection = inspectQRCodeRule(content, rule);
    if (!inspection.matched) continue;

    const candidate = buildRuleDetectionCandidate(content, rule, inspection.parts);
    if ((rule.matchConditions?.length || 0) > 0) {
      conditionedCandidates.push(candidate);
    } else {
      exactCandidates.push(candidate);
    }
  }

  const consideredCandidates = conditionedCandidates.length > 0
    ? conditionedCandidates
    : exactCandidates;
  const selection = selectBestRuleDetectionCandidate(consideredCandidates);
  const hasConflict = selection.conflicts.length > 1;

  return {
    matchedRules: [...conditionedCandidates, ...exactCandidates].map((candidate) => candidate.rule),
    consideredRules: consideredCandidates.map((candidate) => candidate.rule),
    selectedRule: hasConflict ? null : selection.best?.rule ?? null,
    conflictingRules: hasConflict ? selection.conflicts.map((candidate) => candidate.rule) : [],
  };
};

// 根据二维码内容自动识别规则
export const detectRule = async (
  content: string,
  activeRules?: readonly QRCodeRule[]
): Promise<QRCodeRule | null> => {
  try {
    const rules = (activeRules ?? await getActiveRules()).map(migrateLegacyRuleFields);
    const analysis = analyzeQRCodeRuleDetection(content, rules);
    if (analysis.conflictingRules.length > 1) {
      throw new QRCodeRuleConflictError(analysis.conflictingRules.map((rule) => rule.name));
    }

    return analysis.selectedRule;
  } catch (error) {
    if (error instanceof QRCodeRuleConflictError) {
      throw error;
    }
    logger.error('识别规则失败:', error);
    throw error;
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
  rule = migrateLegacyRuleFields(rule);
  const parts = splitContentByRule(content, rule);

  // 提取标准字段和自定义字段
  const standardFields: Record<string, string> = {};
  const customFields: Record<string, string> = {};

  rule.fieldOrder.forEach((fieldName, index) => {
    if (isIgnoredRuleField(fieldName)) return;
    if (index < parts.length) {
      const parsedValue = stripConfiguredFieldPrefix(parts[index], rule.fieldPrefixes?.[fieldName]);
      standardFields[fieldName] = parsedValue;
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
      warehouses,
      outboundOrderRule,
      outboundWarehouseOrderRules,
      savedSyncConfig,
      savedSoundEnabled,
    ] = await Promise.all([
      getAllRules(),
      getAllWarehouses(),
      loadOutboundOrderRule(),
      loadOutboundWarehouseOrderRules(),
      AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG),
      AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED),
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
    const validatedSyncConfig =
      syncConfig && !getSyncConfigError(syncConfig) ? normalizeSyncConfig(syncConfig) : null;

    const backup: BackupData = {
      version: CURRENT_DATA_VERSION,
      timestamp: getISODateTime(),
      backupTime: getISODateTime(),
      // 只导出配置数据
      rules,
      customFields: [], // Retained only as an empty compatibility field in configuration backups.
      warehouses,
      outboundOrderRule,
      outboundWarehouseOrderRules,
      soundEnabled: savedSoundEnabled !== 'false',
      stats: {
        rules: rules.length,
        customFields: 0,
        warehouses: warehouses.length,
        hasOutboundOrderRule: true,
        outboundWarehouseOrderRules: Object.keys(outboundWarehouseOrderRules).length,
        hasSoundSetting: true,
        hasSyncConfig: Boolean(validatedSyncConfig),
      },
      // 同步服务器配置
      syncConfig: validatedSyncConfig,
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
    const migratedRules = backup.rules.map(migrateLegacyRuleFields);
    const uniqueRuleNames = makeQRCodeRuleNamesUnique(migratedRules);
    backup = { ...backup, rules: uniqueRuleNames.rules, customFields: [] };

    const ruleIds = new Set<string>();
    backup.rules.forEach((rule) => {
      const id = rule.id.trim();
      if (!id || ruleIds.has(id)) {
        throw new Error(`备份中存在无效或重复的解析规则 ID：${rule.name || '-'}`);
      }
      ruleIds.add(id);
      assertValidQRCodeRuleConfiguration(rule);
    });

    const warehouseIds = new Set<string>();
    const warehouseNames = new Set<string>();
    backup.warehouses.forEach((warehouse) => {
      const id = warehouse.id.trim();
      const name = warehouse.name.trim();
      const normalizedName = name.toLocaleLowerCase();
      if (!id || !name || warehouseIds.has(id) || warehouseNames.has(normalizedName)) {
        throw new Error(`备份中存在无效或重复的仓库：${name || '-'}`);
      }
      warehouseIds.add(id);
      warehouseNames.add(normalizedName);
    });

    const database = getDb();

    // 1. 检查程序中是否有配置数据
    const currentStats = await getConfigStats();
    const hasConfigData =
      (currentStats.warehouses ?? 0) > 0 ||
      currentStats.rules > 0 ||
      currentStats.customFields > 0;

    // 2. 统一在事务里替换配置，避免删旧后导入失败留下半套配置
    if (hasConfigData) {
      logger.log('程序中已有配置数据，将在事务中替换配置');
    } else {
      logger.log('程序为空，直接导入配置');
    }

    const warnings: string[] = [];
    if (uniqueRuleNames.renamed.length > 0) {
      warnings.push(`备份中有 ${uniqueRuleNames.renamed.length} 条解析规则名称重复，已自动追加序号以保留全部规则。`);
    }
    const backupWarehouses = backup.warehouses || [];
    const backupWarehouseIds = new Set(backupWarehouses.map((warehouse) => warehouse.id));
    const backupDefaultWarehouseId =
      backupWarehouses.find((warehouse) => warehouse.is_default)?.id ||
      backupWarehouses[0]?.id;
    const restoredWarehouseIdMap = new Map<string, string>();
    const referencedWarehouseRows = await database.getAllAsync<{ id: string }>(`
      SELECT DISTINCT warehouse_id AS id FROM orders WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM materials WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM inbound_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM inventory_check_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
      UNION
      SELECT DISTINCT warehouse_id AS id FROM unpack_records WHERE warehouse_id IS NOT NULL AND TRIM(warehouse_id) != ''
    `);
    const referencedWarehouseIds = referencedWarehouseRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const preservedLocalWarehouseIds = referencedWarehouseIds.filter((id) => !backupWarehouseIds.has(id));

    await runExclusiveWriteTransaction(database, 'importBackupData', async (transactionDatabase) => {
      // 物料绑定由独立的 Excel 导入/导出管理，配置恢复不得清空或覆盖现有绑定。
      await transactionDatabase.runAsync('DELETE FROM qr_code_rules');
      await transactionDatabase.runAsync('DELETE FROM custom_fields');

      if (referencedWarehouseIds.length > 0) {
        await transactionDatabase.runAsync(
          `DELETE FROM warehouses WHERE id NOT IN (${referencedWarehouseIds.map(() => '?').join(',')})`,
          referencedWarehouseIds
        );
      } else {
        await transactionDatabase.runAsync('DELETE FROM warehouses');
      }

      if (backupWarehouses.length > 0) {
        await transactionDatabase.runAsync('UPDATE warehouses SET is_default = 0');
      }

      // 3. 导入仓库
      if (backupWarehouses.length > 0) {
        for (const [index, warehouse] of backupWarehouses.entries()) {
          try {
            const existingWarehouse = await transactionDatabase.getFirstAsync<{ id: string }>(
              'SELECT id FROM warehouses WHERE name = ? LIMIT 1',
              [warehouse.name]
            );
            const targetWarehouseId = existingWarehouse?.id || warehouse.id;
            restoredWarehouseIdMap.set(warehouse.id, targetWarehouseId);
            const sortOrder =
              getBackupSortOrder(warehouse as unknown as Record<string, unknown>) ?? index;
            await transactionDatabase.runAsync(
              'INSERT OR REPLACE INTO warehouses (id, name, description, is_default, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [
                targetWarehouseId,
                warehouse.name,
                warehouse.description || null,
                warehouse.id === backupDefaultWarehouseId ? 1 : 0,
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
            await transactionDatabase.runAsync(
              `INSERT INTO qr_code_rules (
                id, name, description, separator, field_order, custom_field_ids,
                is_active, supplier_name, match_conditions, field_prefixes, terminator, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                rule.terminator || '',
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

      const defaultWarehouse = await transactionDatabase.getFirstAsync<{ id: string }>(
        'SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1'
      );
      if (!defaultWarehouse) {
        const firstWarehouse = await transactionDatabase.getFirstAsync<{ id: string }>(
          'SELECT id FROM warehouses ORDER BY sort_order ASC, created_at ASC, id ASC LIMIT 1'
        );
        if (firstWarehouse?.id) {
          await transactionDatabase.runAsync(
            'UPDATE warehouses SET is_default = 1 WHERE id = ?',
            [firstWarehouse.id]
          );
        }
      }
    });

    if (preservedLocalWarehouseIds.length > 0) {
      warnings.push(`已保留 ${preservedLocalWarehouseIds.length} 个仍被业务数据引用的本地仓库，避免历史记录失去仓库归属。`);
    }

    let syncConfigRestored = false;
    let outboundWarehouseOrderRulesRestored = false;
    const restoredWarehouseOrderRules = Object.entries(
      backup.outboundWarehouseOrderRules || {}
    ).reduce<OutboundWarehouseSampleRuleMap>((result, [warehouseId, rule]) => {
      result[restoredWarehouseIdMap.get(warehouseId) || warehouseId] = rule;
      return result;
    }, {});

    try {
      if (backup.outboundOrderRule) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.OUTBOUND_ORDER_RULE,
          JSON.stringify(backup.outboundOrderRule)
        );
      } else {
        await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_RULE);
      }
      await AsyncStorage.setItem(
        STORAGE_KEYS.OUTBOUND_WAREHOUSE_ORDER_RULES,
        JSON.stringify(restoredWarehouseOrderRules)
      );
      outboundWarehouseOrderRulesRestored = true;
    } catch (e) {
      logger.error('导入出库单号规则失败:', e);
      warnings.push('出库单号规则未能写入本地存储，请在设置页重新确认样例规则。');
    }

    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
    } catch (e) {
      logger.warn('清理恢复前仓库选择失败:', e);
      warnings.push('当前仓库选择未能重置，请重新进入业务页面后确认仓库。');
    }

    if (typeof backup.soundEnabled === 'boolean') {
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.SOUND_ENABLED,
          String(backup.soundEnabled)
        );
      } catch (e) {
        logger.error('导入扫码声音设置失败:', e);
        warnings.push('扫码声音设置未能恢复，请在设置页重新确认。');
      }
    }

    // 6. 导入同步服务器配置
    if (backup.syncConfig) {
      const syncConfigError = getSyncConfigError(backup.syncConfig);
      if (syncConfigError) {
        try {
          await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_CONFIG);
          await AsyncStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
        } catch (e) {
          logger.error('清理无效同步配置失败:', e);
        }
        warnings.push(`备份中的同步服务器配置无效，未恢复：${syncConfigError}`);
      } else {
        try {
          await AsyncStorage.setItem(
            STORAGE_KEYS.SYNC_CONFIG,
            JSON.stringify(normalizeSyncConfig(backup.syncConfig))
          );
          await AsyncStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
          syncConfigRestored = true;
        } catch (e) {
          logger.error('导入同步配置失败:', e);
          warnings.push('同步服务器配置未能写入本地存储，请在设置页重新确认服务器地址和端口。');
        }
      }
    } else {
      try {
        await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_CONFIG);
        await AsyncStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
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
  inventoryBindings: number;
  warehouses: number;
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
    let nextCount = 0;

    await runExclusiveWriteTransaction(database, 'incrementExportCount', async (transactionDatabase) => {
      const result = await transactionDatabase.getFirstAsync<{ value: string }>(
        'SELECT value FROM system_config WHERE key = ?',
        [key]
      );
      const current = result ? parseInt(result.value, 10) : 0;
      nextCount = (Number.isFinite(current) ? current : 0) + 1;
      await transactionDatabase.runAsync('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', [
        key,
        nextCount.toString(),
      ]);
    });

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
  materials: ['id', 'order_no', 'quantity', 'scanned_at'],
  qr_code_rules: ['id', 'name', 'separator', 'field_order', 'is_active'],
  custom_fields: ['id', 'name', 'type', 'required', 'sort_order'],
  warehouses: ['id', 'name', 'is_default', 'created_at'],
  inventory_bindings: ['id', 'scan_model', 'inventory_code', 'created_at'],
  unpack_records: ['id', 'original_material_id', 'new_quantity', 'pair_id', 'unpacked_at'],
  inbound_records: ['id', 'inbound_no', 'warehouse_id', 'scan_model', 'quantity', 'created_at'],
  inventory_check_records: [
    'id',
    'check_no',
    'warehouse_id',
    'scan_model',
    'check_type',
    'created_at',
  ],
  recycle_bin: [
    'id',
    'entity_type',
    'payload',
    'deleted_at',
    'expires_at',
  ],
};
const RESTORE_REQUIRED_TABLES = new Set(Object.keys(RESTORE_SCHEMA_REQUIREMENTS));

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
  const integrityRows = await database.getAllAsync<{ quick_check: string }>('PRAGMA quick_check');
  const integrityMessages = integrityRows
    .map((row) => String(row.quick_check || '').trim())
    .filter(Boolean);
  if (integrityMessages.length !== 1 || integrityMessages[0].toLowerCase() !== 'ok') {
    throw new Error(`数据库完整性校验失败: ${integrityMessages.join('；') || '未返回校验结果'}`);
  }

  for (const [tableName, requiredColumns] of Object.entries(RESTORE_SCHEMA_REQUIREMENTS)) {
    const tableExists = await database.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [getPhysicalDatabaseTableName(tableName)]
    );

    if (!tableExists) {
      if (RESTORE_REQUIRED_TABLES.has(tableName)) {
        throw new Error(`数据库缺少必要数据表: ${getPhysicalDatabaseTableName(tableName)}`);
      }
      continue;
    }

    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const columnSet = new Set(columns.map((column) => column.name));
    const missingColumns = requiredColumns.filter((column) => !columnSet.has(column));

    if (missingColumns.length > 0) {
      throw new Error(
        `数据库表 ${getPhysicalDatabaseTableName(tableName)} 缺少字段: ${missingColumns.join(', ')}`
      );
    }
  }
};

// 获取数据库文件路径
const getDatabaseFilePath = (): string => {
  // Expo SQLite 将数据库文件存储在应用的文档目录下
  // 新版数据库使用独立文件，旧 warehouse.db 会原样保留，不参与自动迁移。
  const documentDirectory = FS.documentDirectory;
  return `${documentDirectory}SQLite/${DATABASE_FILE_NAME}`;
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

export const checkpointDatabaseToDisk = async (): Promise<void> => {
  if (isWebPlatform) {
    return;
  }

  await runWithTransientDatabaseRetry(
    'checkpointDatabaseToDisk',
    () =>
      runSerializedDatabaseOperation('checkpointDatabaseToDisk', async () => {
        if (!db) {
          return;
        }

        await checkpointDatabaseForFileBackup(getDb());
      }),
    [120, 300, 700, 1200],
    (error) => refreshDatabaseConnectionAfterTransientError('checkpointDatabaseToDisk', error)
  );
};

export const ensureDatabaseConnectionReady = async (
  context = 'ensureDatabaseConnectionReady'
): Promise<void> => {
  if (isWebPlatform) {
    return;
  }

  await runWithTransientDatabaseRetry(
    context,
    async () => {
      if (!db) {
        await initDatabase();
      }

      await getDb().getFirstAsync<{ ok: number }>('SELECT 1 AS ok');
    },
    [80, 180, 400],
    (error) => refreshDatabaseConnectionAfterTransientError(context, error)
  );
};

export const getSystemConfigValue = async (key: string): Promise<string | null> => {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return null;
  }

  if (!db) {
    await initDatabase();
  }

  const result = await getDb().getFirstAsync<{ value: string }>(
    'SELECT value FROM system_config WHERE key = ?',
    [trimmedKey]
  );
  return result?.value ?? null;
};

export const setSystemConfigValue = async (key: string, value: string): Promise<void> => {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error('system_config key 不能为空');
  }

  if (!db) {
    await initDatabase();
  }

  const database = getDb();
  await runExclusiveWriteTransaction(database, 'setSystemConfigValue', async (transactionDatabase) => {
    await transactionDatabase.runAsync('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', [
      trimmedKey,
      value,
    ]);
  });
};

export const removeSystemConfigValue = async (key: string): Promise<void> => {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return;
  }

  if (!db) {
    await initDatabase();
  }

  const database = getDb();
  await runExclusiveWriteTransaction(database, 'removeSystemConfigValue', async (transactionDatabase) => {
    await transactionDatabase.runAsync('DELETE FROM system_config WHERE key = ?', [trimmedKey]);
  });
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

    const result = await runWithTransientDatabaseRetry(
      'exportDatabaseFile',
      () =>
        runSerializedDatabaseOperation('exportDatabaseFile', async () => {
          // 确保所有数据已写入磁盘
          const database = getDb();

          await checkpointDatabaseForFileBackup(database);

          const dbFilePath = getDatabaseFilePath();

          // 检查数据库文件是否存在
          const fileInfo = await FS.getInfoAsync(dbFilePath);
          if (!fileInfo.exists) {
            logger.error('数据库文件不存在:', dbFilePath);
            return {
              success: false,
              message: '数据库文件不存在',
            };
          }

          // 生成按天归档并自动递增序号的备份文件名
          const timestamp = getDatabaseBackupDateString();
          const backupDir = `${FS.documentDirectory}backups`;

          // 确保备份目录存在
          const dirInfo = await FS.getInfoAsync(backupDir);
          if (!dirInfo.exists) {
            await FS.makeDirectoryAsync(backupDir, { intermediates: true });
          }

          const backupFileName = await getNextDatedBackupFileName(
            backupDir,
            sanitizeBackupFileName(APP_NAME),
            timestamp,
            'db'
          );
          const backupFilePath = `${backupDir}/${backupFileName}`;

          // 复制数据库文件到备份目录
          await FS.copyAsync({
            from: dbFilePath,
            to: backupFilePath,
          });

          return {
            success: true,
            message: '数据库文件导出成功',
            filePath: backupFilePath,
          };
        }),
      [120, 300, 700, 1200],
      (error) => refreshDatabaseConnectionAfterTransientError('exportDatabaseFile', error)
    );

    return result;
  } catch (error) {
    logger.error('导出数据库文件失败:', error);

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

    let shouldReinitialize = false;
    let restoredDatabasePath = '';
    let rollbackDatabasePath = '';
    let hasRollbackDatabase = false;
    const importResult = await runSerializedDatabaseOperation('importDatabaseFile', async () => {
      // 关闭当前数据库连接
      const database = db;
      if (database) {
        await checkpointDatabaseForFileBackup(database);
        await database.closeAsync();
      }
      db = null;
      shouldReinitialize = true;

      // 等待一下，确保数据库完全关闭
      await new Promise((resolve) => setTimeout(resolve, 500));

      const dbFilePath = getDatabaseFilePath();
      const dbBackupPath = `${dbFilePath}.backup`;
      restoredDatabasePath = dbFilePath;
      rollbackDatabasePath = dbBackupPath;

      try {
        // 1. 备份当前数据库文件（如果存在）
        // 先清理上次异常中断遗留的回滚文件，避免把旧数据误当成本次备份。
        await FS.deleteAsync(dbBackupPath, { idempotent: true });
        const currentDbInfo = await FS.getInfoAsync(dbFilePath);
        if (currentDbInfo.exists) {
          await FS.copyAsync({
            from: dbFilePath,
            to: dbBackupPath,
          });
          hasRollbackDatabase = true;
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
        db = wrapDatabaseWithChineseTableNames(
          await SQLite.openDatabaseAsync(DATABASE_FILE_NAME)
        );

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

        await db.closeAsync();
        db = null;

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

        if (db) {
          try {
            await db.closeAsync();
          } catch (closeError) {
            logger.warn('恢复失败后关闭数据库连接失败:', closeError);
          }
          db = null;
        }

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
        } else {
          await FS.deleteAsync(dbFilePath, { idempotent: true });
          await deleteDatabaseSidecarFiles(dbFilePath);
        }

        return {
          success: false,
          message: `恢复失败，${
            backupInfo.exists ? '已回滚到原数据库' : '已移除无效数据库文件'
          }: ${restoreError instanceof Error ? restoreError.message : '未知错误'}`,
        };
      }
    });

    if (shouldReinitialize) {
      if (!importResult.success) {
        await initDatabase();
        return importResult;
      }

      try {
        await initDatabase();
      } catch (initializationError) {
        logger.error('恢复数据库后初始化失败，尝试回滚:', initializationError);

        if (!restoredDatabasePath) {
          throw initializationError;
        }

        let restoredOriginalDatabase = false;
        await runSerializedDatabaseOperation('rollbackImportedDatabaseAfterInitFailure', async () => {
          if (db) {
            await db.closeAsync();
            db = null;
          }

          await FS.deleteAsync(restoredDatabasePath, { idempotent: true });
          await deleteDatabaseSidecarFiles(restoredDatabasePath);

          if (hasRollbackDatabase && rollbackDatabasePath) {
            const rollbackInfo = await FS.getInfoAsync(rollbackDatabasePath);
            if (rollbackInfo.exists) {
              await FS.copyAsync({
                from: rollbackDatabasePath,
                to: restoredDatabasePath,
              });
              restoredOriginalDatabase = true;
            }
          }
        });

        try {
          await initDatabase();
        } catch (rollbackInitializationError) {
          logger.error('回滚数据库后初始化失败:', rollbackInitializationError);
          return {
            success: false,
            message: `恢复后的数据库初始化失败，自动恢复也未完成: ${
              initializationError instanceof Error ? initializationError.message : '未知错误'
            }；恢复错误: ${
              rollbackInitializationError instanceof Error
                ? rollbackInitializationError.message
                : '未知错误'
            }`,
          };
        }

        if (restoredOriginalDatabase && rollbackDatabasePath) {
          await FS.deleteAsync(rollbackDatabasePath, { idempotent: true });
        }

        return {
          success: false,
          message: `恢复后的数据库初始化失败，${
            restoredOriginalDatabase ? '已回滚到原数据库' : '已移除无效数据库并重新创建空数据库'
          }: ${
            initializationError instanceof Error ? initializationError.message : '未知错误'
          }`,
        };
      }
    }

    if (hasRollbackDatabase && rollbackDatabasePath) {
      await FS.deleteAsync(rollbackDatabasePath, { idempotent: true });
    }

    return importResult;
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
