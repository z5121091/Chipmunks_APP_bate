import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, Platform, Modal, ScrollView, BackHandler, type NativeSyntheticEvent, type TextInputSubmitEditingEventData } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useConfirmedRouteExit } from '@/hooks/useConfirmedRouteExit';
import { workDraftStorage as AsyncStorage } from '@/utils/workDraftIsolation';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';
import { parseQuantity } from '@/utils/quantity';
import { isQRCode, recoverConfirmedScannerContent, shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AggregatedRecordItem } from '@/components/AggregatedRecordItem';
import { AppFormField } from '@/components/AppFormField';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { UiPageHeader, UiWorkflowSummary, UiToolbarButton } from '@/components/UiRedesign';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { useCustomAlert } from '@/components/CustomAlert';
import { createStyles } from './styles';
import {
  initDatabase,
  upsertOrder,
  addMaterialWithOrder,
  getOrder,
  detectRule,
  getActiveRules,
  parseWithRule,
  QRCodeRuleConflictError,
  checkMaterialExists,
  getMaterialsByOrder,
  getInventoryCodeByModel,
  getInventoryBindingMatchByModel,
  getMaterialById,
  getSalesReturnsByOrder,
  getSalesReturnById,
  saveSalesReturnWithOrder,
  deleteSalesReturn,
  deleteMaterial,
  generateId,
  saveUnpackOperation,
  type MaterialRecord,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
  type UnpackPrintTask,
} from '@/utils/database';
import { scanQueue, getRecoveryMaterialId, type QueueItem, type QueueItemParsedPayload } from '@/utils/scanQueue';
import { STORAGE_KEYS } from '@/constants/config';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import {
  feedbackSuccess,
  feedbackError,
  feedbackWarning,
  feedbackDuplicate,
  feedbackOutboundOrderReady,
  feedbackSalesReturnOrderReady,
  feedbackSalesReturnSaved,
  feedbackNotBound,
  feedbackNotInOrder,
  feedbackOverQuantity,
  feedbackOutboundOrderComplete,
  feedbackUnpackRequired,
  feedbackUnpackComplete,
  feedbackDeleted,
  initSoundSetting,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { getISODateTime } from '@/utils/time';
import { formatPrintTaskTime } from '@/utils/printTaskTime';
import {
  cancelScanSubmit,
  resolveScannerChangeAfterSubmit,
  resolveScannerTextAfterConsumedPrefix,
  MATERIAL_SCAN_QUIET_MS,
  scheduleScanSubmit,
  scheduleScanSubmitWithCompletionCheck,
  resolvePendingScannerSubmit,
  sanitizeStructuredScannerInput,
} from '@/utils/scannerInput';
import {
  DEFAULT_OUTBOUND_ORDER_RULE,
  getMatchingOutboundWarehouseOrderRules,
  getOutboundOrderRuleHint,
  isOutboundOrderNo,
  loadOutboundOrderRule,
  loadOutboundWarehouseOrderRules,
  parseOutboundOrderNo,
  type OutboundOrderRuleConfig,
  type OutboundWarehouseSampleRuleMap,
} from '@/utils/outboundOrderRule';
import { getErpAccountByOutboundOrderNo, type ErpAccountConfig } from '@/utils/erpAccounts';
import {
  fetchSaleDispatchVoucher,
  type SaleDispatchVoucher,
} from '@/utils/erpSaleDispatch';
import {
  buildNextUnpackTraceNo,
  getUnpackSyncFailureMessage,
} from '@/utils/unpackWorkflow';
import { loadUnpackPrintTasks, submitUnpackPrintTask, isUnpackPrintTaskInFlight } from '@/utils/unpackPrintTasks';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';
import { assertRuleSupplierForScan, RuleSupplierValidationError } from '@/utils/ruleSupplierValidation';
import {
  buildOutboundProgress,
  buildSalesReturnProgress,
  isOutboundOrderComplete,
  isSalesReturnOrderComplete,
  isOutboundVerificationFresh,
  normalizeOutboundInventoryCode as normalizeInventoryCode,
  type OutboundLineProgress,
} from '@/utils/outboundProgress';
import { getSaleDispatchDirection } from '@/utils/salesReturn';

const LEGACY_OUTBOUND_SCAN_RECORDS_KEY = 'outbound_scan_records';
const OUTBOUND_ERP_VOUCHER_CACHE_KEY = '@outbound_erp_voucher_cache';
const OUTBOUND_ERP_VOUCHER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const OUTBOUND_ERP_VOUCHER_CACHE_MAX_ITEMS = 30;
const SCAN_AUTO_SUBMIT_DEBOUNCE_MS = 150;
const ORDER_SCAN_FAST_SUBMIT_DEBOUNCE_MS = 80;

const normalizeOrderNoCandidate = (value: string) => value.trim().replace(/\s+/g, '').toUpperCase();

interface MaterialItem {
  id: string;
  model: string;
  batch: string;
  quantity: string;
  scannedAt: Date;
  version?: string;
  traceNo?: string;
  sourceNo?: string;
  package?: string;
  productionDate?: string;
  inventoryCode?: string;
  customFields?: Record<string, string>;
  operationType?: MaterialRecord['operation_type'];
}

interface AggregatedGroup {
  key: string;
  model: string;
  version: string;
  batch: string;
  sourceNo: string;
  package: string;
  totalQuantity: number;
  boxCount: number;
  items: MaterialItem[]; // 所有items，用于聚合总数量和显示
}

type ErpLineProgress = OutboundLineProgress<MaterialItem>;

interface PendingOutboundUnpack {
  lineSpecification: string;
  newTraceNo: string;
  originalQuantity: number;
  rawContent: string;
  remainingQuantity: number;
  savedPayload: QueueItemParsedPayload;
  shippedQuantity: number;
  recoveryItem?: QueueItem;
  materialId?: string;
  genericBinding?: boolean;
}

interface OutboundScanOptions {
  materialId?: string;
  expectedOrderNo?: string;
  recoveryItem?: QueueItem;
  confirmedNativePrefix?: string | null;
}

interface PendingOutboundScan extends OutboundScanOptions {
  code: string;
}

const MATERIAL_ITEM_SIGNATURE_FIELDS = [
  'id',
  'version',
  'batch',
  'sourceNo',
  'package',
  'productionDate',
  'quantity',
] as const;

interface OutboundWorkDraft {
  erpVoucher?: OutboundWorkDraftErpVoucher;
  orderNo: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  updatedAt: string;
}

interface OutboundWorkDraftErpLine {
  inventoryCode: string;
  inventoryName: string;
  quantity: number;
  specification: string;
  unitName: string;
}

interface OutboundWorkDraftErpVoucher {
  accountKey: SaleDispatchVoucher['accountKey'];
  accountName: string;
  clerkName: string;
  code: string;
  customerName: string;
  expectedWarehouseName: string;
  id: number | string;
  lines: OutboundWorkDraftErpLine[];
  sourceVoucherCode: string;
  statusName: string;
  voucherDate: string;
  warehouseName: string;
}

interface OutboundErpVoucherCacheEntry {
  cachedAt: number;
  voucher: OutboundWorkDraftErpVoucher;
}

type OutboundErpVoucherCache = Record<string, OutboundErpVoucherCacheEntry>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOutboundWorkDraftErpVoucher = (value: unknown): value is OutboundWorkDraftErpVoucher => {
  if (!isPlainRecord(value)) {
    return false;
  }

  const voucher = value as unknown as OutboundWorkDraftErpVoucher;
  return (
    typeof voucher.accountKey === 'string' &&
    typeof voucher.accountName === 'string' &&
    typeof voucher.code === 'string' &&
    typeof voucher.customerName === 'string' &&
    typeof voucher.expectedWarehouseName === 'string' &&
    Array.isArray(voucher.lines) &&
    voucher.lines.every(
      (line) =>
        line &&
        typeof line === 'object' &&
        typeof (line as OutboundWorkDraftErpLine).inventoryCode === 'string' &&
        typeof (line as OutboundWorkDraftErpLine).quantity === 'number'
    ) &&
    typeof voucher.warehouseName === 'string'
  );
};

const isOutboundWorkDraft = (value: unknown): value is OutboundWorkDraft => {
  if (!isPlainRecord(value)) {
    return false;
  }

  const draft = value as unknown as OutboundWorkDraft;
  return (
    typeof draft.orderNo === 'string' &&
    typeof draft.customerName === 'string' &&
    typeof draft.warehouseId === 'string' &&
    typeof draft.warehouseName === 'string' &&
    typeof draft.updatedAt === 'string' &&
    (draft.erpVoucher === undefined || isOutboundWorkDraftErpVoucher(draft.erpVoucher))
  );
};

const createErpVoucherSnapshot = (
  voucher?: SaleDispatchVoucher | null
): OutboundWorkDraftErpVoucher | undefined => {
  if (!voucher) {
    return undefined;
  }

  return {
    accountKey: voucher.accountKey,
    accountName: voucher.accountName,
    clerkName: voucher.clerkName,
    code: voucher.code,
    customerName: voucher.customerName,
    expectedWarehouseName: voucher.expectedWarehouseName,
    id: voucher.id,
    lines: voucher.lines.map((line) => ({
      inventoryCode: line.inventoryCode,
      inventoryName: line.inventoryName,
      quantity: line.quantity,
      specification: line.specification,
      unitName: line.unitName,
    })),
    sourceVoucherCode: voucher.sourceVoucherCode,
    statusName: voucher.statusName,
    voucherDate: voucher.voucherDate,
    warehouseName: voucher.warehouseName,
  };
};

const restoreErpVoucherFromDraft = (
  voucher: OutboundWorkDraftErpVoucher
): SaleDispatchVoucher => ({
  ...voucher,
  lines: voucher.lines.map((line) => ({
    ...line,
    raw: {},
  })),
  raw: {},
});

const isOutboundErpVoucherCache = (value: unknown): value is OutboundErpVoucherCache => {
  if (!isPlainRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      isPlainRecord(entry) &&
      typeof entry.cachedAt === 'number' &&
      Number.isFinite(entry.cachedAt) &&
      isOutboundWorkDraftErpVoucher(entry.voucher)
  );
};

const buildErpVoucherCacheKey = (
  accountKey: SaleDispatchVoucher['accountKey'],
  voucherCode: string
) => `${accountKey}:${normalizeOrderNoCandidate(voucherCode)}`;

const pruneErpVoucherCache = (
  cache: OutboundErpVoucherCache,
  now = Date.now()
): OutboundErpVoucherCache =>
  Object.fromEntries(
    Object.entries(cache)
      .filter(([, entry]) => now - entry.cachedAt <= OUTBOUND_ERP_VOUCHER_CACHE_TTL_MS)
      .sort(([, a], [, b]) => b.cachedAt - a.cachedAt)
      .slice(0, OUTBOUND_ERP_VOUCHER_CACHE_MAX_ITEMS)
  ) as OutboundErpVoucherCache;

const readErpVoucherCache = async (): Promise<OutboundErpVoucherCache> => {
  const cacheText = await AsyncStorage.getItem(OUTBOUND_ERP_VOUCHER_CACHE_KEY);
  return cacheText
    ? safeJsonParseNullable<OutboundErpVoucherCache>(
        cacheText,
        'outbound.erpVoucherCache',
        isOutboundErpVoucherCache
      ) || {}
    : {};
};

const writeErpVoucherCache = async (cache: OutboundErpVoucherCache) => {
  await AsyncStorage.setItem(OUTBOUND_ERP_VOUCHER_CACHE_KEY, JSON.stringify(cache));
};

const loadCachedErpVoucher = async (
  accountKey: SaleDispatchVoucher['accountKey'],
  voucherCode: string
): Promise<SaleDispatchVoucher | null> => {
  const cache = await readErpVoucherCache();
  const cacheKey = buildErpVoucherCacheKey(accountKey, voucherCode);
  const entry = cache[cacheKey];

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.cachedAt > OUTBOUND_ERP_VOUCHER_CACHE_TTL_MS) {
    delete cache[cacheKey];
    writeErpVoucherCache(pruneErpVoucherCache(cache)).catch((error) => {
      logger.warn('[扫码出库] 清理过期ERP单据缓存失败:', error);
    });
    return null;
  }

  return restoreErpVoucherFromDraft(entry.voucher);
};

const saveCachedErpVoucher = async (voucher: SaleDispatchVoucher) => {
  const snapshot = createErpVoucherSnapshot(voucher);
  if (!snapshot) {
    return;
  }

  const cache = pruneErpVoucherCache(await readErpVoucherCache());
  cache[buildErpVoucherCacheKey(voucher.accountKey, voucher.code)] = {
    cachedAt: Date.now(),
    voucher: snapshot,
  };

  await writeErpVoucherCache(pruneErpVoucherCache(cache));
};

type SaleDispatchLoadResult = { fromCache: boolean; voucher: SaleDispatchVoucher; receivedAt?: number };

type PreparedErpVoucherRequest = {
  accountKey: SaleDispatchVoucher['accountKey'];
  orderNo: string;
  sessionId: number;
  outcome: Promise<
    { ok: true; result: SaleDispatchLoadResult; receivedAt: number } | { ok: false; error: unknown }
  >;
};

const loadSaleDispatchVoucher = async (
  account: ErpAccountConfig,
  voucherCode: string,
  options: {
    bypassProxyCache?: boolean;
    forceRefresh?: boolean;
    preparedRequest?: PreparedErpVoucherRequest;
  } = {}
): Promise<SaleDispatchLoadResult> => {
  const candidateRequest = options.preparedRequest;
  const preparedRequest = candidateRequest?.accountKey === account.key &&
    candidateRequest.orderNo === normalizeOrderNoCandidate(voucherCode)
    ? candidateRequest
    : undefined;
  const resolvePreparedOutcome = (outcome: Awaited<PreparedErpVoucherRequest['outcome']>) => {
    if (!outcome.ok) throw outcome.error;
    if (!isOutboundVerificationFresh(outcome.receivedAt)) {
      throw new Error('ERP查询结果已过期，请重新扫描订单');
    }
    return outcome.result;
  };

  if (!options.forceRefresh) {
    // 缓存只是恢复加速；实时 ERP 已返回时，不再等待设备上的慢缓存读取。
    // 两个分支都接住失败，未被选中的读取也不会产生未处理拒绝。
    const cacheRequest = loadCachedErpVoucher(account.key, voucherCode).catch((error) => {
      logger.warn('[扫码出库] ERP缓存读取失败，继续使用实时查询:', error);
      return null;
    });
    const first = preparedRequest
      ? await Promise.race([
        cacheRequest.then((voucher) => ({ source: 'cache' as const, voucher })),
        preparedRequest.outcome.then((outcome) => ({ source: 'live' as const, outcome })),
      ])
      : { source: 'cache' as const, voucher: await cacheRequest };
    if (first.source === 'live') {
      return resolvePreparedOutcome(first.outcome);
    }
    const cachedVoucher = first.voucher;
    if (cachedVoucher) {
      assertSaleDispatchDirection(cachedVoucher);
      return {
        fromCache: true,
        voucher: cachedVoucher,
      };
    }
  }

  if (preparedRequest) {
    return resolvePreparedOutcome(await preparedRequest.outcome);
  }

  const voucher = await fetchSaleDispatchVoucher(account, voucherCode, {
    bypassCache: options.bypassProxyCache,
  });
  const receivedAt = Date.now();
  assertSaleDispatchDirection(voucher);
  saveCachedErpVoucher(voucher).catch((error) => {
    logger.warn('[扫码出库] 保存ERP单据缓存失败:', error);
  });

  return {
    fromCache: false,
    voucher,
    receivedAt,
  };
};

type RefreshedErpVoucherState = {
  voucher: SaleDispatchVoucher;
  warehouse: Warehouse;
};

const createOutboundWorkDraft = (
  orderNo: string,
  customerName: string,
  warehouse: Warehouse,
  erpVoucher?: SaleDispatchVoucher | null
): OutboundWorkDraft => ({
  erpVoucher: createErpVoucherSnapshot(erpVoucher),
  orderNo: orderNo.trim(),
  customerName: customerName.trim(),
  warehouseId: warehouse.id,
  warehouseName: warehouse.name,
  updatedAt: new Date().toISOString(),
});

const mapQueueItemToMaterialItem = (
  materialId: string,
  parsed: QueueItemParsedPayload
): MaterialItem => ({
  id: materialId,
  model: parsed.model || '',
  batch: parsed.batch || '',
  quantity: String(parseQuantity(parsed.quantity || '1') ?? 1),
  scannedAt: new Date(),
  version: parsed.version,
  traceNo: parsed.traceNo,
  sourceNo: parsed.sourceNo,
  package: parsed.package,
  productionDate: parsed.productionDate,
  inventoryCode: parsed.inventoryCode,
  customFields: parsed.customFields,
});

const mapMaterialRecordToMaterialItem = (material: MaterialRecord): MaterialItem => ({
  id: material.id,
  model: material.model,
  batch: material.batch,
  quantity: String(material.quantity),
  scannedAt: new Date(material.scanned_at),
  version: material.version,
  traceNo: material.traceNo,
  sourceNo: material.sourceNo,
  package: material.package,
  productionDate: material.productionDate,
  inventoryCode: (material.inventory_code || '').trim(),
  customFields: material.customFields,
  operationType: material.operation_type,
});

const assertSaleDispatchDirection = (voucher: SaleDispatchVoucher) => {
  if (getSaleDispatchDirection(voucher.lines) === 'invalid') {
    throw new Error('ERP单据数量无效：仅支持全正数出库单或全负数退货单，数量须为非零整数；正负混合单请在ERP拆分后操作');
  }
};

const buildSaleDispatchProgress = (lines: SaleDispatchVoucher['lines'], records: MaterialItem[]) =>
  getSaleDispatchDirection(lines) === 'sales_return'
    ? buildSalesReturnProgress(lines, records) : buildOutboundProgress(lines, records);

const isSaleDispatchOrderComplete = (lines: SaleDispatchVoucher['lines'], records: MaterialItem[]) =>
  getSaleDispatchDirection(lines) === 'sales_return'
    ? isSalesReturnOrderComplete(lines, records) : isOutboundOrderComplete(lines, records);

// 退货单仅在独立验收表形成查询汇总，避免空壳订单进入普通出库统计。
const upsertSaleDispatchOrder = (no: string, customer: string,
  warehouse: Parameters<typeof upsertOrder>[2], voucher: SaleDispatchVoucher) =>
  getSaleDispatchDirection(voucher.lines) === 'sales_return'
    ? Promise.resolve() : upsertOrder(no, customer, warehouse);

const mapQueueItemToMaterialRecord = (
  materialId: string,
  parsed: QueueItemParsedPayload,
  rawContent: string
): MaterialRecord => ({
  id: materialId,
  order_no: parsed.orderNo,
  customer_name: parsed.customerName || '',
  operation_type: 'outbound',
  model: parsed.model || '',
  batch: parsed.batch || '',
  quantity: parseQuantity(parsed.quantity, { min: 0 }) ?? 0,
  package: parsed.package || '',
  version: parsed.version || '',
  productionDate: parsed.productionDate || '',
  traceNo: parsed.traceNo || '',
  sourceNo: parsed.sourceNo || '',
  scanned_at: getISODateTime(),
  raw_content: rawContent,
  separator: parsed.separator,
  rule_id: parsed.ruleId,
  rule_name: parsed.ruleName,
  customFields: parsed.customFields,
  warehouse_id: parsed.warehouseId,
  warehouse_name: parsed.warehouseName,
  inventory_code: parsed.inventoryCode || '',
});

const buildMaterialGroupKey = (item: MaterialItem) =>
  JSON.stringify([item.model || '', item.version || '']);

const buildOrderMaterialsKey = (no: string, warehouseId?: string) =>
  JSON.stringify([normalizeOrderNoCandidate(no), warehouseId || '']);

const isOutboundVisibleMaterial = (material: MaterialRecord) =>
  material.operation_type !== 'inventory';

const mergeMaterialItemsById = (items: MaterialItem[]) => {
  const mergedItems: MaterialItem[] = [];
  const indexesById = new Map<string, number>();

  items.forEach((item) => {
    const existingIndex = indexesById.get(item.id);
    if (existingIndex === undefined) {
      indexesById.set(item.id, mergedItems.length);
      mergedItems.push(item);
      return;
    }

    const existing = mergedItems[existingIndex];
    mergedItems[existingIndex] = {
      ...item,
      ...existing,
      inventoryCode: (existing.inventoryCode || item.inventoryCode || '').trim(),
      customFields: existing.customFields || item.customFields,
    };
  });

  return mergedItems;
};

export default function PDAScanScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const alert = useCustomAlert();
  // 弹窗与路由 Hook 返回对象会随渲染更新；扫码回调通过 Ref 获取最新实例，避免高频扫码链路反复重建。
  const alertRef = useRef(alert);
  const routerRef = useRef(router);
  useEffect(() => {
    alertRef.current = alert;
    routerRef.current = router;
  }, [alert, router]);

  // 初始化声音设置
  useEffect(() => {
    initSoundSetting();
  }, []);

  // 输入
  const inputRef = useRef<WarehouseScanInputHandle>(null);
  const [inputValue, setInputValue] = useState('');
  const [isErpOrderLoading, setIsErpOrderLoading] = useState(false);
  const [pendingOutboundUnpack, setPendingOutboundUnpack] =
    useState<PendingOutboundUnpack | null>(null);
  const pendingOutboundUnpackRef = useRef<PendingOutboundUnpack | null>(null);
  const [outboundUnpackNotes, setOutboundUnpackNotes] = useState('');
  const [outboundUnpacking, setOutboundUnpacking] = useState(false);
  const outboundUnpackingRef = useRef(false);
  const unpackOperationRef = useRef<object | null>(null);
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const pageSessionRef = useRef(0);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const initializingRef = useRef(true);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [leaveApproved, setLeaveApproved] = useState(false);
  const [pendingScanCount, setPendingScanCount] = useState(0);
  const queuePausedRef = useRef(false);
  const [queuePaused, setQueuePaused] = useState(false);
  const queuePausePromptRef = useRef(false);
  const legacyPromptSessionRef = useRef(-1);
  const printFailureNoticeRef = useRef('');
  const [legacyReviewItems, setLegacyReviewItems] = useState<QueueItem[]>([]);
  const [legacyReviewError, setLegacyReviewError] = useState<string | null>(null);
  const [showLegacyReview, setShowLegacyReview] = useState(false);
  const [showPrintTasks, setShowPrintTasks] = useState(false);
  const [printTasks, setPrintTasks] = useState<UnpackPrintTask[]>([]);
  const [retryingPrintTask, setRetryingPrintTask] = useState<string | null>(null);
  const scanAcceptanceOrderRef = useRef('');
  const inputEventSequenceRef = useRef(0);
  const requestBackRef = useRef<() => void>(() => undefined);
  const liveInputValueRef = useRef('');
  const scannerInputRevisionRef = useRef(0);
  const pendingNativeSubmitTextRef = useRef<string | null>(null);
  const consumedNativePrefixRef = useRef('');
  const lastConfirmedNativeTextRef = useRef<string | null>(null);
  const pendingScanCodesRef = useRef<PendingOutboundScan[]>([]);
  const processScanRef = useRef<(code: string, options?: OutboundScanOptions) => Promise<void>>(async () => undefined);
  const scannerFocusBlockedRef = useRef(false);
  const orderNoRef = useRef(''); // 批量写入后据此判断当前订单是否已变化。
  const customerNameRef = useRef('');
  const currentWarehouseRef = useRef<Warehouse | null>(null);
  const savedOutboundDraftRef = useRef<string | null>(null);
  const orderMaterialsKeyRef = useRef<string | null>(null);
  const [orderMaterialsReady, setOrderMaterialsReady] = useState(false);
  const activeRulesRef = useRef<Awaited<ReturnType<typeof getActiveRules>> | null>(null);
  const inventoryBindingsRef = useRef(new Map<string, Awaited<ReturnType<typeof getInventoryBindingMatchByModel>>>());
  const loadOutboundStateRef = useRef<
    (warehouseList: Warehouse[], explicitWarehouse: Warehouse | null, sessionId?: number) => Promise<void>
  >(async () => undefined);
  const loadOrderMaterialsRef = useRef<
    (orderNo: string, explicitWarehouseId?: string) => Promise<MaterialItem[]>
  >(async () => []);
  const forceRefreshErpVoucherForOrderRef = useRef<
    (
      orderNo: string,
      warehouseList: Warehouse[],
      options?: { clearOnFailure?: boolean }
    ) => Promise<RefreshedErpVoucherState | null>
  >(async () => null);

  // 仓库
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [outboundOrderRule, setOutboundOrderRule] = useState<OutboundOrderRuleConfig>(
    DEFAULT_OUTBOUND_ORDER_RULE
  );
  const [outboundWarehouseOrderRules, setOutboundWarehouseOrderRules] =
    useState<OutboundWarehouseSampleRuleMap>({});
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);

  // 当前订单
  const [orderNo, setOrderNo] = useState('');
  const [customerName, setCustomerName] = useState('');

  const setActiveOrderNo = useCallback((nextOrderNo: string) => {
    if (nextOrderNo !== orderNoRef.current) {
      setPrintTasks([]);
    }
    orderMaterialsKeyRef.current = null;
    setOrderMaterialsReady(false);
    orderNoRef.current = nextOrderNo;
    const hasLaterAcceptedOrder = pendingScanCodesRef.current.some((item) =>
      item.expectedOrderNo && normalizeOrderNoCandidate(item.code) === normalizeOrderNoCandidate(item.expectedOrderNo));
    if (!hasLaterAcceptedOrder) scanAcceptanceOrderRef.current = nextOrderNo;
    setOrderNo(nextOrderNo);
  }, []);

  const setActiveCustomerName = useCallback((nextCustomerName: string) => {
    customerNameRef.current = nextCustomerName;
    setCustomerName(nextCustomerName);
  }, []);

  const setActiveWarehouse = useCallback((nextWarehouse: Warehouse | null) => {
    if (nextWarehouse?.id !== currentWarehouseRef.current?.id) {
      orderMaterialsKeyRef.current = null;
      setOrderMaterialsReady(false);
    }
    currentWarehouseRef.current = nextWarehouse;
    setCurrentWarehouse(nextWarehouse);
  }, []);

  const erpVoucherRef = useRef<SaleDispatchVoucher | null>(null);
  const verifiedErpVoucherRef = useRef<SaleDispatchVoucher | null>(null);
  const [verifiedErpVoucher, setVerifiedErpVoucher] = useState<SaleDispatchVoucher | null>(null);
  const erpVerifiedAtRef = useRef(0);
  const erpVerificationErrorRef = useRef('');
  const erpVoucherRefreshRef = useRef<{
    key: string;
    promise: Promise<RefreshedErpVoucherState | null>;
  } | null>(null);
  const [erpVoucher, setErpVoucher] = useState<SaleDispatchVoucher | null>(null);
  const [erpVoucherRecoveryRequired, setErpVoucherRecoveryRequired] = useState(false);

  const setActiveErpVoucher = useCallback((nextVoucher: SaleDispatchVoucher | null) => {
    if (getSaleDispatchDirection(erpVoucherRef.current?.lines || []) !==
        getSaleDispatchDirection(nextVoucher?.lines || [])) {
      orderMaterialsKeyRef.current = null;
      setOrderMaterialsReady(false);
    }
    if (verifiedErpVoucherRef.current !== nextVoucher) {
      verifiedErpVoucherRef.current = null;
      erpVerifiedAtRef.current = 0;
      setVerifiedErpVoucher(null);
    }
    erpVoucherRef.current = nextVoucher;
    setErpVoucher(nextVoucher);
    if (nextVoucher) {
      setErpVoucherRecoveryRequired(false);
    }
  }, []);

  const markErpVoucherVerified = useCallback((voucher: SaleDispatchVoucher, receivedAt = Date.now()) => {
    // 并行请求可能早于本地恢复结束；核验有效期从收到响应起算。
    if (!isOutboundVerificationFresh(receivedAt)) {
      verifiedErpVoucherRef.current = null;
      setVerifiedErpVoucher(null);
      erpVerifiedAtRef.current = 0;
      return;
    }
    verifiedErpVoucherRef.current = voucher;
    setVerifiedErpVoucher(voucher);
    erpVerifiedAtRef.current = receivedAt;
    erpVerificationErrorRef.current = '';
  }, []);

  const markErpVoucherUnverified = useCallback(() => {
    verifiedErpVoucherRef.current = null;
    setVerifiedErpVoucher(null);
    erpVerifiedAtRef.current = 0;
  }, []);

  const isErpVoucherVerified = useCallback(
    (voucher: SaleDispatchVoucher) => verifiedErpVoucherRef.current === voucher &&
      isOutboundVerificationFresh(erpVerifiedAtRef.current),
    []
  );

  const isCurrentSession = useCallback((sessionId: number) =>
    screenActiveRef.current && pageSessionRef.current === sessionId, []);

  const pausePendingScans = useCallback(() => {
    if (!queuePausedRef.current) queuePausePromptRef.current = false;
    queuePausedRef.current = true;
    setQueuePaused(true);
  }, []);

  const clearPendingScans = useCallback(() => {
    pendingScanCodesRef.current = [];
    setPendingScanCount(0);
    queuePausedRef.current = false;
    queuePausePromptRef.current = false;
    setQueuePaused(false);
  }, []);

  const reloadOutbound = useCallback(() => {
    if (processingRef.current) return;
    queuePausedRef.current = false;
    queuePausePromptRef.current = false;
    setQueuePaused(false);
    setReloadGeneration((value) => value + 1);
  }, []);

  const refreshPrintTasks = useCallback(async (no: string, warehouseId: string, sessionId = pageSessionRef.current) => {
    if (!no || !warehouseId) return;
    const tasks = await loadUnpackPrintTasks(no, warehouseId);
    if (isCurrentSession(sessionId) && orderNoRef.current === no && currentWarehouseRef.current?.id === warehouseId) {
      setPrintTasks(tasks);
    }
  }, [isCurrentSession]);

  // 同步 ref，避免扫码队列连续处理时读到旧闭包
  useEffect(() => {
    orderNoRef.current = orderNo;
  }, [orderNo]);
  useEffect(() => {
    customerNameRef.current = customerName;
  }, [customerName]);
  useEffect(() => {
    currentWarehouseRef.current = currentWarehouse;
  }, [currentWarehouse]);

  // 扫码记录（参考入库实现）
  const [scanRecords, setScanRecords] = useState<MaterialItem[]>([]);
  const scanRecordsRef = useRef<MaterialItem[]>([]);

  useEffect(() => {
    scanRecordsRef.current = scanRecords;
  }, [scanRecords]);

  // 聚合展开状态（记录哪些聚合组是展开的）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());

  // Toast
  const { showToast: notifyToast, ToastContainer } = useToast();
  const showToast = useCallback((...args: Parameters<typeof notifyToast>) => {
    notifyToast(...args);
    if (args[1] === 'error') pausePendingScans();
  }, [notifyToast, pausePendingScans]);

  const submitPrintTask = useCallback(async (pairId: string, no: string, warehouseId: string,
    sessionId = pageSessionRef.current, options?: { closeOnSuccess?: boolean; retryConfirmed?: boolean }) => {
    const ownsCurrentOrder = () => isCurrentSession(sessionId) && orderNoRef.current === no &&
      currentWarehouseRef.current?.id === warehouseId;
    if (isCurrentSession(sessionId)) setRetryingPrintTask(pairId);
    try {
      const task = await submitUnpackPrintTask(pairId, undefined, { retryConfirmed: options?.retryConfirmed === true });
      if (ownsCurrentOrder()) {
        await refreshPrintTasks(no, warehouseId, sessionId);
        if (!ownsCurrentOrder()) return;
        if (task.status === 'submitted') {
          notifyToast('标签任务已提交同步助手', 'success');
          if (options?.closeOnSuccess) setShowPrintTasks(false);
        }
        else if (task.status === 'skipped') notifyToast('该供应商标签按策略跳过打印', 'warning');
        else if (task.status === 'failed') notifyToast(`标签任务失败，记录已保留：${task.last_error || '请打开标签任务处理'}`, 'warning');
        else notifyToast('标签任务仍在处理中，请查看任务状态', 'warning');
      }
    } catch (error) {
      if (ownsCurrentOrder()) {
        await refreshPrintTasks(no, warehouseId, sessionId).catch(logger.warn);
        if (!ownsCurrentOrder()) return;
        notifyToast(`拆包已保存，标签待处理：${getUnpackSyncFailureMessage(error)}`, 'warning');
      }
    } finally {
      if (isCurrentSession(sessionId)) setRetryingPrintTask((current) => current === pairId ? null : current);
    }
  }, [isCurrentSession, notifyToast, refreshPrintTasks]);
  const currentScanStep = !orderNo ? 'order' : 'material';
  const currentScanPlaceholder = isErpOrderLoading
    ? '正在查询ERP单据...'
    : initializationError
      ? '数据未加载，请点击右上角重新加载'
    : queuePaused && pendingScanCount > 0
      ? '待处理已暂停，核对后点击扫码按钮'
    : orderNo && !orderMaterialsReady
      ? '本单记录未加载，请重新扫描订单或点击刷新'
    : erpVoucherRecoveryRequired
      ? 'ERP单据未验证，请重新扫描订单或点击刷新'
    : currentScanStep === 'order'
      ? '先扫描订单号'
      : '继续扫描物料二维码';
  const currentScanStatusLabel = isErpOrderLoading
    ? '正在读取ERP单据'
    : initializationError
      ? '出库数据加载失败'
    : queuePaused && pendingScanCount > 0
      ? '待处理扫码已暂停'
    : orderNo && !orderMaterialsReady
      ? '本单记录需要恢复'
    : erpVoucherRecoveryRequired
      ? 'ERP单据需要验证'
    : currentScanStep === 'order'
      ? '等待出库单号'
      : '物料扫码录入';

  useEffect(() => {
    scannerFocusBlockedRef.current = showWarehousePicker || !!pendingOutboundUnpack || alert.visible || showLegacyReview || showPrintTasks;
  }, [alert.visible, pendingOutboundUnpack, showWarehousePicker, showLegacyReview, showPrintTasks]);

  const showAlertIfActive = useCallback(
    (title: string, message: string) => {
      if (!screenActiveRef.current) {
        return;
      }

      alert.showAlert(title, message, [{ text: '知道了' }], 'warning');
    },
    [alert]
  );

  const focusScannerInput = useCallback((delay = 0) => {
    if (screenActiveRef.current && !scannerFocusBlockedRef.current) inputRef.current?.focus(delay);
  }, []);

  const resumePendingScanCodes = useCallback(
    (delay = 0, sessionId = pageSessionRef.current) => {
      if (!isCurrentSession(sessionId)) return;
      if (postProcessTimerRef.current) {
        clearTimeout(postProcessTimerRef.current);
      }
      postProcessTimerRef.current = setTimeout(() => {
        if (!isCurrentSession(sessionId)) return;
        postProcessTimerRef.current = null;
        processingRef.current = false;
        setScanProcessing(false);
        if (initializingRef.current || scannerFocusBlockedRef.current || pendingOutboundUnpackRef.current || queuePausedRef.current) {
          return;
        }

        const nextPendingCode = pendingScanCodesRef.current.shift();
        setPendingScanCount(pendingScanCodesRef.current.length);
        if (nextPendingCode) {
          void processScanRef.current(nextPendingCode.code, nextPendingCode);
          return;
        }

        focusScannerInput(0);
      }, pendingScanCodesRef.current.length > 0 ? 0 : delay);
    },
    [focusScannerInput, isCurrentSession]
  );

  useEffect(
    () => () => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
      }
      if (postProcessTimerRef.current) {
        clearTimeout(postProcessTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!showWarehousePicker) {
      focusScannerInput(80);
    }
  }, [focusScannerInput, showWarehousePicker]);

  const saveOutboundWorkDraft = useCallback(
    async (
      nextOrderNo: string,
      nextCustomerName: string,
      warehouse: Warehouse,
      nextErpVoucher: SaleDispatchVoucher | null = erpVoucherRef.current
    ) => {
      const draft = createOutboundWorkDraft(
        nextOrderNo,
        nextCustomerName,
        warehouse,
        nextErpVoucher
      );
      const draftSignature = JSON.stringify({ ...draft, updatedAt: '' });
      if (savedOutboundDraftRef.current === draftSignature) {
        return;
      }
      const serializedDraft = JSON.stringify(draft);

      try {
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.OUTBOUND_WORK_DRAFT, serializedDraft],
          [STORAGE_KEYS.OUTBOUND_ORDER_NO, draft.orderNo],
        ]);
        savedOutboundDraftRef.current = draftSignature;
      } catch (error) {
        logger.warn('[扫码出库] 保存出库草稿到 AsyncStorage 失败，继续当前扫码流程:', error);
      }
    },
    []
  );

  const clearOutboundWorkDraft = useCallback(async (): Promise<boolean> => {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.OUTBOUND_WORK_DRAFT,
        STORAGE_KEYS.OUTBOUND_ORDER_NO,
      ]);
      savedOutboundDraftRef.current = null;
      return true;
    } catch (error) {
      logger.error('[扫码出库] 清理出库草稿失败:', error);
      return false;
    }
  }, []);

  const loadSavedOutboundWorkDraft = useCallback(async (): Promise<OutboundWorkDraft | null> => {
    const asyncDraftText = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT);

    return asyncDraftText
      ? safeJsonParseNullable<OutboundWorkDraft>(
          asyncDraftText,
          'outbound.workDraft.asyncStorage',
          isOutboundWorkDraft
        )
      : null;
  }, []);

  // 自动清理震动和提示音
  useFeedbackCleanup();

  // 每次进入／重新加载都有独立访问编号，旧请求不能更新新页面。
  useFocusEffect(
    useCallback(() => {
      const sessionId = ++pageSessionRef.current;
      logger.log('[扫码出库] 初始化页面访问:', { sessionId, reloadGeneration });
      screenActiveRef.current = true;
      scannerInputRevisionRef.current += 1;
      pendingNativeSubmitTextRef.current = null;
      consumedNativePrefixRef.current = '';
      lastConfirmedNativeTextRef.current = null;
      liveInputValueRef.current = '';
      setInputValue('');
      initializingRef.current = true;
      processingRef.current = true;
      setIsErpOrderLoading(true);
      setInitializationError(null);
      orderMaterialsKeyRef.current = null;
      setOrderMaterialsReady(false);
      activeRulesRef.current = null;
      inventoryBindingsRef.current.clear();
      markErpVoucherUnverified();
      const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
        requestBackRef.current();
        return true;
      });

      const init = async () => {
        try {
          await initDatabase();
          if (!isCurrentSession(sessionId)) return;
          // 旧持久队列仅恢复为待核对，不再通过另一条入口自动补写。
          try {
            const reviewItems = await scanQueue.restoreForReview();
            if (!isCurrentSession(sessionId)) return;
            setLegacyReviewItems(reviewItems);
            setLegacyReviewError(null);
          } catch (error) {
            if (!isCurrentSession(sessionId)) return;
            setLegacyReviewItems([]);
            setLegacyReviewError(formatUserFacingErrorMessage(error, '历史扫码缓存读取失败，原始内容已保留'));
            notifyToast('历史扫码缓存异常已保留，当前新扫码可以继续', 'warning');
          }
          const [list, orderRule, warehouseOrderRules] = await Promise.all([
            getAllWarehouses(), loadOutboundOrderRule(), loadOutboundWarehouseOrderRules(),
          ]);
          if (!isCurrentSession(sessionId)) return;
          setWarehouses(list);
          setOutboundOrderRule(orderRule);
          setOutboundWarehouseOrderRules(warehouseOrderRules);
          let warehouse: Warehouse | null = null;
          const savedWarehouse = await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
          if (!isCurrentSession(sessionId)) return;
          const saved = savedWarehouse
            ? safeJsonParseNullable<Warehouse>(savedWarehouse, 'outbound.globalWarehouse')
            : null;
          warehouse = saved ? list.find((item) => item.id === saved.id) || null : null;
          if (!warehouse) {
            const defaultWarehouse = await getDefaultWarehouse();
            if (!isCurrentSession(sessionId)) return;
            warehouse = defaultWarehouse || list[0] || null;
          }
          setActiveWarehouse(warehouse);
          await loadOutboundStateRef.current(list, warehouse, sessionId);
          if (!isCurrentSession(sessionId)) return;
          initializingRef.current = false;
          focusScannerInput(0);
        } catch (error) {
          if (!isCurrentSession(sessionId)) return;
          const message = formatUserFacingErrorMessage(error, '出库数据加载失败，请重新加载');
          setInitializationError(message);
          pausePendingScans();
          showToast(message, 'error');
          alertRef.current.showAlert('出库数据加载失败', message,
            [{ text: '稍后' }, { text: '重新加载', onPress: reloadOutbound }], 'error');
          void feedbackError('出库数据加载失败，请重新加载');
        } finally {
          if (isCurrentSession(sessionId)) {
            initializingRef.current = false;
            setIsErpOrderLoading(false);
            resumePendingScanCodes(0, sessionId);
          }
        }
      };
      void init();
      return () => {
        backSubscription.remove();
        if (pageSessionRef.current !== sessionId) return;
        screenActiveRef.current = false;
        pageSessionRef.current += 1;
        scannerInputRevisionRef.current += 1;
        pendingNativeSubmitTextRef.current = null;
        consumedNativePrefixRef.current = '';
        lastConfirmedNativeTextRef.current = null;
        liveInputValueRef.current = '';
        processingRef.current = false;
        initializingRef.current = false;
        cancelScanSubmit(autoSubmitTimerRef);
        if (postProcessTimerRef.current) clearTimeout(postProcessTimerRef.current);
        postProcessTimerRef.current = null;
      };
    }, [focusScannerInput, isCurrentSession, markErpVoucherUnverified, pausePendingScans,
      notifyToast, reloadGeneration, reloadOutbound, resumePendingScanCodes, setActiveWarehouse, showToast])
  );
  // 加载扫码出库持久化状态（订单号、仓库、扫码记录）
  const loadOutboundState = useCallback(
    async (warehouseList: Warehouse[], explicitWarehouse: Warehouse | null, sessionId = pageSessionRef.current) => {
      try {
        const list = warehouseList;
        let activeWarehouse = explicitWarehouse;

      // 1. 优先恢复出库作业草稿。草稿只保存现场，实际订单和物料以 SQLite 为准。
      const savedDraft = await loadSavedOutboundWorkDraft();
      if (!isCurrentSession(sessionId)) return;

      if (savedDraft) {
        const draftOrderNo = savedDraft.orderNo.trim();
        const draftWarehouse = list.find((w) => w.id === savedDraft.warehouseId);
        if (!draftOrderNo) {
          logger.log('[loadOutboundState] 草稿订单号为空，清空草稿');
          await clearOutboundWorkDraft();
        } else if (!draftWarehouse) {
          logger.log('[loadOutboundState] 草稿仓库不存在，清空草稿');
          await clearOutboundWorkDraft();
        } else {
          if (activeWarehouse && savedDraft.warehouseId !== activeWarehouse.id) {
            logger.log('[loadOutboundState] 草稿仓库与当前仓库不一致，切回草稿仓库:', {
              draftWarehouseId: savedDraft.warehouseId,
              activeWarehouseId: activeWarehouse.id,
            });
            activeWarehouse = draftWarehouse;
            setActiveWarehouse(draftWarehouse);
            await AsyncStorage.setItem(
              STORAGE_KEYS.GLOBAL_WAREHOUSE,
              JSON.stringify(draftWarehouse)
            );
            if (!isCurrentSession(sessionId)) return;
          }

          const cachedErpVoucher = savedDraft.erpVoucher
            ? restoreErpVoucherFromDraft(savedDraft.erpVoucher)
            : null;
          const immediateCustomerName = (
            cachedErpVoucher?.customerName ||
            savedDraft.customerName ||
            ''
          ).trim();

          setActiveOrderNo(draftOrderNo);
          setActiveCustomerName(immediateCustomerName);
          if (cachedErpVoucher) {
            markErpVoucherUnverified();
            setActiveErpVoucher(cachedErpVoucher);
          } else {
            setActiveErpVoucher(null);
          }

          try {
            await loadOrderMaterialsRef.current(draftOrderNo, draftWarehouse.id);
          } catch (error) {
            logger.warn('[loadOutboundState] 快速恢复出库物料失败:', error);
            throw error;
          }
          if (!isCurrentSession(sessionId)) return;

          void (async () => {
            const order = await getOrder(draftOrderNo, savedDraft.warehouseId);
            if (!isCurrentSession(sessionId) || orderNoRef.current !== draftOrderNo) return;
            const restoredCustomerName = (
              order?.customer_name ||
              savedDraft.customerName ||
              ''
            ).trim();
            const restoredErpState = await forceRefreshErpVoucherForOrderRef.current(
              draftOrderNo,
              list,
              { clearOnFailure: !cachedErpVoucher }
            );

            if (!isCurrentSession(sessionId) || orderNoRef.current !== draftOrderNo) {
              return;
            }

            const workWarehouse = restoredErpState?.warehouse || draftWarehouse;
            const workCustomerName = (
              restoredErpState?.voucher.customerName ||
              restoredCustomerName ||
              ''
            ).trim();

            setActiveCustomerName(workCustomerName);
            await saveOutboundWorkDraft(
              draftOrderNo,
              workCustomerName,
              workWarehouse,
              restoredErpState?.voucher || null
            );
            if (!isCurrentSession(sessionId) || orderNoRef.current !== draftOrderNo) return;

            if (workWarehouse.id !== draftWarehouse.id ||
                orderMaterialsKeyRef.current !== buildOrderMaterialsKey(draftOrderNo, workWarehouse.id)) {
              await loadOrderMaterialsRef.current(draftOrderNo, workWarehouse.id);
            }
          })().catch((error) => {
            logger.warn('[loadOutboundState] 后台刷新 ERP 出库草稿失败:', error);
          });

          return;
        }
      }

      // 2. 兼容旧版本只保存订单号的状态，并迁移为新草稿。
      const savedOrderNo = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO);
      if (!isCurrentSession(sessionId)) {
        return;
      }

      if (savedOrderNo) {
        // 验证订单是否存在；如果全局仓库被其他页面改过，不要直接把当前出库作业清掉。
        let order = await getOrder(savedOrderNo, activeWarehouse?.id);
        if (!isCurrentSession(sessionId)) return;
        if (!order && activeWarehouse) {
          order = await getOrder(savedOrderNo);
        }
        if (!isCurrentSession(sessionId)) {
          return;
        }

        if (!order) {
          logger.log('[loadOutboundState] 订单不存在，清空订单号:', savedOrderNo);
          await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO);
          if (isCurrentSession(sessionId)) {
            setActiveOrderNo('');
            setActiveCustomerName('');
          }
          return;
        }

        const warehouse = list.find((w) => w.id === order.warehouse_id);
        if (!warehouse) {
          logger.log('[loadOutboundState] 订单的仓库已不存在，清空订单号');
          showAlertIfActive(
            '当前出库作业已清空',
            '上次暂存订单所属仓库已不存在。已保存的历史订单不会删除，请重新扫描当前仓库订单。'
          );
          await clearOutboundWorkDraft();
          if (isCurrentSession(sessionId)) {
            setActiveOrderNo('');
            setActiveCustomerName('');
          }
          return;
        }

        if (activeWarehouse && order.warehouse_id !== activeWarehouse.id) {
          logger.log('[loadOutboundState] 订单仓库不匹配，切回订单仓库:', {
            savedOrderNo,
            orderWarehouseId: order.warehouse_id,
            currentWarehouseId: activeWarehouse.id,
          });
          activeWarehouse = warehouse;
          setActiveWarehouse(warehouse);
          await AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(warehouse));
        }

        if (!isCurrentSession(sessionId)) {
          return;
        }

        setActiveOrderNo(savedOrderNo);
        setActiveCustomerName((order.customer_name || '').trim());

        const restoredErpState = await forceRefreshErpVoucherForOrderRef.current(
          savedOrderNo,
          list
        );
        if (!isCurrentSession(sessionId) || orderNoRef.current !== savedOrderNo) {
          return;
        }
        const workWarehouse = restoredErpState?.warehouse || warehouse;
        const workCustomerName = (
          restoredErpState?.voucher.customerName ||
          order.customer_name ||
          ''
        ).trim();

        setActiveCustomerName(workCustomerName);
        await saveOutboundWorkDraft(savedOrderNo, workCustomerName, workWarehouse);
        if (!isCurrentSession(sessionId) || orderNoRef.current !== savedOrderNo) return;
        await loadOrderMaterialsRef.current(savedOrderNo, workWarehouse.id);
      }
      } catch (error) {
        if (!isCurrentSession(sessionId)) return;
        logger.error('[扫码出库] 加载持久化状态失败:', error);
        throw error;
      }
    },
    [
      clearOutboundWorkDraft,
      isCurrentSession,
      loadSavedOutboundWorkDraft,
      markErpVoucherUnverified,
      saveOutboundWorkDraft,
      setActiveCustomerName,
      setActiveErpVoucher,
      setActiveOrderNo,
      setActiveWarehouse,
      showAlertIfActive,
    ]
  );

  // 切换仓库
  const handleWarehouseChange = async (warehouse: Warehouse): Promise<boolean> => {
    const sessionId = pageSessionRef.current;
    if (processingRef.current) return false;
    processingRef.current = true;
    setScanProcessing(true);
    try {
    let draftsCleared = false;
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.OUTBOUND_WORK_DRAFT,
        STORAGE_KEYS.OUTBOUND_ORDER_NO,
        STORAGE_KEYS.OUTBOUND_SCAN_RECORDS,
        LEGACY_OUTBOUND_SCAN_RECORDS_KEY,
      ]);
      savedOutboundDraftRef.current = null;
      draftsCleared = true;
    } catch (error) {
      logger.error('[扫码出库] 切换仓库时清理暂存失败:', error);
    }
    if (!isCurrentSession(sessionId)) return false;
    if (!draftsCleared) {
      showToast('当前出库暂存清理失败，已取消切换仓库', 'error');
      feedbackError();
      return false;
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(warehouse));
    } catch (error) {
      if (!isCurrentSession(sessionId)) return false;
      logger.error('[扫码出库] 切换仓库时保存设置失败:', error);
      showToast('仓库设置保存失败，已取消切换仓库', 'error');
      void feedbackError();
      return false;
    }
    if (!isCurrentSession(sessionId)) return false;
    setActiveWarehouse(warehouse);
    setActiveOrderNo('');
    setActiveCustomerName('');
    setActiveErpVoucher(null);
    setErpVoucherRecoveryRequired(false);
    scanRecordsRef.current = [];
    setScanRecords([]);

    // 清空展开状态
    expandedGroupsRef.current = new Set();
    setExpandedGroups(new Set());
    clearPendingScans();
    setPrintTasks([]);
    return true;
    } finally {
      if (isCurrentSession(sessionId)) resumePendingScanCodes(0, sessionId);
    }
  };

  const resolveWarehouseForErpVoucher = useCallback(
    (voucher: SaleDispatchVoucher, warehouseList: Warehouse[]) => {
      const expectedNames = [voucher.warehouseName, voucher.expectedWarehouseName].filter(Boolean);

      for (const warehouseName of expectedNames) {
        // 同名仓库优先沿用当前有效 ID，不因列表顺序产生一次无意义的切换。
        const current = currentWarehouseRef.current;
        const matchedWarehouse = warehouseList.find((warehouse) =>
          warehouse.id === current?.id && warehouse.name.trim() === warehouseName.trim()) ||
          warehouseList.find((warehouse) => warehouse.name.trim() === warehouseName.trim());
        if (matchedWarehouse) {
          return matchedWarehouse;
        }
      }

      return null;
    },
    []
  );

  const refreshErpVoucherForOrder = useCallback(
    async (
      nextOrderNo: string,
      warehouseList: Warehouse[],
      options: {
        bypassProxyCache?: boolean;
        clearOnFailure?: boolean;
        forceRefresh?: boolean;
        preparedRequest?: PreparedErpVoucherRequest;
      } = {}
    ) => {
      const sessionId = pageSessionRef.current;
      const {
        bypassProxyCache = false,
        clearOnFailure = true,
        forceRefresh = false,
      } = options;
      const account = getErpAccountByOutboundOrderNo(nextOrderNo);
      if (!account) {
        setActiveErpVoucher(null);
        setErpVoucherRecoveryRequired(false);
        return null;
      }

      try {
        const preparedRequest = options.preparedRequest;
        let loaded: SaleDispatchLoadResult;
        let receivedAt: number | undefined;
        if (preparedRequest?.sessionId === sessionId &&
            preparedRequest.accountKey === account.key &&
            preparedRequest.orderNo === normalizeOrderNoCandidate(nextOrderNo)) {
          const outcome = await preparedRequest.outcome;
          if (!outcome.ok) throw outcome.error;
          if (!isOutboundVerificationFresh(outcome.receivedAt)) {
            throw new Error('ERP查询结果已过期，请重新扫描订单');
          }
          loaded = outcome.result;
          receivedAt = outcome.receivedAt;
        } else {
          loaded = await loadSaleDispatchVoucher(account, nextOrderNo, {
            bypassProxyCache,
            forceRefresh,
          });
        }
        const { fromCache, voucher } = loaded;
        if (
          !isCurrentSession(sessionId) ||
          normalizeOrderNoCandidate(orderNoRef.current) !== normalizeOrderNoCandidate(nextOrderNo)
        ) {
          return null;
        }
        const matchedWarehouse = resolveWarehouseForErpVoucher(
          voucher,
          warehouseList
        );
        if (!matchedWarehouse) {
          throw new Error(
            `本地未找到ERP仓库：${voucher.warehouseName || voucher.expectedWarehouseName || '-'}`
          );
        }

        setActiveErpVoucher(voucher);
        if (!fromCache) {
          markErpVoucherVerified(voucher, receivedAt ?? loaded.receivedAt);
        }
        setErpVoucherRecoveryRequired(false);

        if (matchedWarehouse && matchedWarehouse.id !== currentWarehouseRef.current?.id) {
          setActiveWarehouse(matchedWarehouse);
          await AsyncStorage.setItem(
            STORAGE_KEYS.GLOBAL_WAREHOUSE,
            JSON.stringify(matchedWarehouse)
          );
        }

        return {
          voucher,
          warehouse: matchedWarehouse,
        };
      } catch (error) {
        logger.warn('[扫码出库] 恢复 ERP 销售出库单失败，已阻止继续扫码:', error);
        if (
          !isCurrentSession(sessionId) ||
          normalizeOrderNoCandidate(orderNoRef.current) !== normalizeOrderNoCandidate(nextOrderNo)
        ) {
          return null;
        }
        if (clearOnFailure) {
          setActiveErpVoucher(null);
        }
        markErpVoucherUnverified();
        erpVerificationErrorRef.current = formatUserFacingErrorMessage(error, 'ERP核验失败，请稍后重试');
        setErpVoucherRecoveryRequired(true);
        return null;
      }
    },
    [
      markErpVoucherVerified,
      isCurrentSession,
      markErpVoucherUnverified,
      resolveWarehouseForErpVoucher,
      setActiveErpVoucher,
      setActiveWarehouse,
    ]
  );

  const forceRefreshErpVoucherForOrder = useCallback(
    (
      nextOrderNo: string,
      warehouseList: Warehouse[],
      options: { clearOnFailure?: boolean; preparedRequest?: PreparedErpVoucherRequest } = {}
    ): Promise<RefreshedErpVoucherState | null> => {
      const account = getErpAccountByOutboundOrderNo(nextOrderNo);
      if (!account) {
        return Promise.resolve(null);
      }

      const refreshKey = `${pageSessionRef.current}:${buildErpVoucherCacheKey(account.key, nextOrderNo)}`;
      const inFlightRefresh = erpVoucherRefreshRef.current;
      if (inFlightRefresh?.key === refreshKey) {
        return inFlightRefresh.promise;
      }

      markErpVoucherUnverified();
      const refreshPromise = refreshErpVoucherForOrder(nextOrderNo, warehouseList, {
        bypassProxyCache: true,
        clearOnFailure: options.clearOnFailure,
        forceRefresh: true,
        preparedRequest: options.preparedRequest,
      }).finally(() => {
        if (erpVoucherRefreshRef.current?.key === refreshKey) {
          erpVoucherRefreshRef.current = null;
        }
      });

      erpVoucherRefreshRef.current = {
        key: refreshKey,
        promise: refreshPromise,
      };
      return refreshPromise;
    },
    [markErpVoucherUnverified, refreshErpVoucherForOrder]
  );

  const handleRefreshErpVoucher = useCallback(async () => {
    const sessionId = pageSessionRef.current;
    const activeVoucher = erpVoucherRef.current;
    const activeOrderNo = orderNoRef.current;
    const account = activeOrderNo ? getErpAccountByOutboundOrderNo(activeOrderNo) : null;
    if (!activeOrderNo || processingRef.current || pendingOutboundUnpackRef.current ||
        isErpOrderLoading || (!activeVoucher && !account)) {
      focusScannerInput(0);
      return;
    }

    processingRef.current = true;
    setIsErpOrderLoading(true);
    try {
      const refreshed = await forceRefreshErpVoucherForOrder(activeOrderNo, warehouses, {
        clearOnFailure: false,
      });
      if (!isCurrentSession(sessionId)) return;
      if (!refreshed) {
        showToast(
          `${erpVerificationErrorRef.current || 'ERP验证失败'}，已暂停扫码`,
          'warning'
        );
        void feedbackError('订单核验失败，请查看提示');
        return;
      }

      const nextCustomerName = refreshed.voucher.customerName.trim();
      await loadOrderMaterialsRef.current(activeOrderNo, refreshed.warehouse.id);
      if (!isCurrentSession(sessionId)) return;
      await upsertSaleDispatchOrder(activeOrderNo, nextCustomerName, refreshed.warehouse, refreshed.voucher);
      setActiveCustomerName(nextCustomerName);
      await saveOutboundWorkDraft(
        activeOrderNo,
        nextCustomerName,
        refreshed.warehouse,
        refreshed.voucher
      );
      showToast('ERP销售出库单已刷新', 'success');
    } catch (error) {
      if (!isCurrentSession(sessionId)) return;
      markErpVoucherUnverified();
      setErpVoucherRecoveryRequired(true);
      showToast(formatUserFacingErrorMessage(error, '本单记录恢复失败，请重试'), 'error');
      void feedbackError('订单加载失败，请查看提示');
    } finally {
      if (isCurrentSession(sessionId)) {
        setIsErpOrderLoading(false);
        resumePendingScanCodes(100, sessionId);
      }
    }
  }, [
    focusScannerInput,
    forceRefreshErpVoucherForOrder,
    isCurrentSession,
    isErpOrderLoading,
    markErpVoucherUnverified,
    resumePendingScanCodes,
    saveOutboundWorkDraft,
    setActiveCustomerName,
    showToast,
    warehouses,
  ]);

  // 加载订单物料（从数据库加载已保存的记录）
  const loadOrderMaterials = useCallback(
    async (no: string, explicitWarehouseId?: string): Promise<MaterialItem[]> => {
      const sessionId = pageSessionRef.current;
      // 优先使用显式传入的 warehouseId，避免恢复流程读取旧闭包。
      let warehouseId = explicitWarehouseId || currentWarehouseRef.current?.id;
      const requestedOrderNo = normalizeOrderNoCandidate(no);
      if (normalizeOrderNoCandidate(orderNoRef.current) === requestedOrderNo) {
        orderMaterialsKeyRef.current = null;
        setOrderMaterialsReady(false);
      }

    // 确保仓库ID有效
    if (!warehouseId || typeof warehouseId !== 'string' || warehouseId.trim() === '') {
      logger.warn('[loadOrderMaterials] 仓库ID无效，无法加载订单物料');
      throw new Error('仓库信息无效，无法恢复已扫记录');
    }

    // 确保订单号有效
    if (!no || typeof no !== 'string' || no.trim() === '') {
      logger.warn('[loadOrderMaterials] 订单号无效，无法加载订单物料');
      throw new Error('订单号无效，无法恢复已扫记录');
    }

    const isReturn = erpVoucherRef.current &&
      normalizeOrderNoCandidate(erpVoucherRef.current.code) === requestedOrderNo &&
      getSaleDispatchDirection(erpVoucherRef.current.lines) === 'sales_return';
    let list = (await (isReturn
      ? getSalesReturnsByOrder(no.trim(), warehouseId.trim())
      : getMaterialsByOrder(no.trim(), warehouseId.trim()))).filter(
      isOutboundVisibleMaterial
    );

    if (
      !isCurrentSession(sessionId) ||
      normalizeOrderNoCandidate(orderNoRef.current) !== requestedOrderNo
    ) {
      return [];
    }

    // ERP 单号已经通过账套规则确定仓库，不能被其他仓库中的同号历史记录覆盖。
    // 仅为旧的非 ERP 本地订单保留跨仓库恢复能力。
    if (
      list.length === 0 &&
      explicitWarehouseId &&
      !getErpAccountByOutboundOrderNo(requestedOrderNo)
    ) {
      const fallbackList = (await getMaterialsByOrder(no.trim())).filter(
        isOutboundVisibleMaterial
      );
      if (
        !isCurrentSession(sessionId) ||
        normalizeOrderNoCandidate(orderNoRef.current) !== requestedOrderNo
      ) {
        return [];
      }
      const fallbackWarehouseId = fallbackList[0]?.warehouse_id?.trim();
      if (
        fallbackList.length > 0 &&
        fallbackWarehouseId &&
        fallbackWarehouseId !== warehouseId.trim()
      ) {
        const fallbackWarehouse = warehouses.find(
          (warehouse) => warehouse.id === fallbackWarehouseId
        );
        if (fallbackWarehouse) {
          logger.warn('[loadOrderMaterials] 当前仓库无物料，已找到同订单的其他仓库物料:', {
            orderNo: no.trim(),
            requestedWarehouseId: warehouseId.trim(),
            fallbackWarehouseId,
          });
          setActiveWarehouse(fallbackWarehouse);
          await AsyncStorage.setItem(
            STORAGE_KEYS.GLOBAL_WAREHOUSE,
            JSON.stringify(fallbackWarehouse)
          );
          await saveOutboundWorkDraft(no.trim(), customerNameRef.current.trim(), fallbackWarehouse);
          showAlertIfActive(
            '已切回订单仓库',
            `当前订单的物料记录在【${fallbackWarehouse.name}】，已自动切回该仓库显示。`
          );
          list = fallbackList.filter(
            (item) => item.warehouse_id?.trim() === fallbackWarehouseId
          );
          warehouseId = fallbackWarehouseId;
        }
      }
    }
    if (
      !isCurrentSession(sessionId) ||
      normalizeOrderNoCandidate(orderNoRef.current) !== requestedOrderNo
    ) {
      return [];
    }

    // 加载全部数据用于聚合，显示时限制10行
    const materials = await Promise.all(
      list.slice().map(async (material) => {
        const item = mapMaterialRecordToMaterialItem(material);
        if ((item.inventoryCode || '').trim() || !item.model.trim()) {
          return item;
        }

        try {
          return {
            ...item,
            inventoryCode: ((await getInventoryCodeByModel(item.model, item.version)) || '').trim(),
          };
        } catch (error) {
          logger.warn('[loadOrderMaterials] 补齐存货编码失败:', {
            error,
            model: item.model,
            version: item.version,
          });
          return item;
        }
      })
    );
    if (
      !isCurrentSession(sessionId) ||
      normalizeOrderNoCandidate(orderNoRef.current) !== requestedOrderNo
    ) {
      return [];
    }

    scanRecordsRef.current = materials;
    setScanRecords(materials);
    if (currentWarehouseRef.current?.id === warehouseId) {
      orderMaterialsKeyRef.current = buildOrderMaterialsKey(no, warehouseId);
      setOrderMaterialsReady(true);
    }
    void refreshPrintTasks(no, warehouseId, sessionId).catch((error) => logger.warn('[扫码出库] 标签任务读取失败:', error));
    return materials;
    },
    [
      saveOutboundWorkDraft,
      isCurrentSession,
      refreshPrintTasks,
      setActiveWarehouse,
      showAlertIfActive,
      warehouses,
    ]
  );

  useLayoutEffect(() => {
    loadOutboundStateRef.current = loadOutboundState;
    loadOrderMaterialsRef.current = loadOrderMaterials;
    forceRefreshErpVoucherForOrderRef.current = forceRefreshErpVoucherForOrder;
  }, [forceRefreshErpVoucherForOrder, loadOrderMaterials, loadOutboundState]);

  // 处理扫描（带参数版本）
  const processScan = useCallback(
    async (rawCode: string, options: OutboundScanOptions = {}) => {
      let code = rawCode;
      const sessionId = pageSessionRef.current;
      const eventId = options.materialId || `outbound-${Date.now()}-${++inputEventSequenceRef.current}-${generateId()}`;
      const ensureCurrent = () => {
        if (!isCurrentSession(sessionId)) throw new Error('出库页面已变化');
      };
      const activeOrderNo = orderNoRef.current;
      let activeCustomerName = customerNameRef.current;
      const activeWarehouse = currentWarehouseRef.current;
      let activeErpVoucher = erpVoucherRef.current;
      logger.log('[processScan] 开始处理扫码:', code);
      logger.log('[processScan] 当前订单号:', activeOrderNo);
      logger.log('[processScan] 当前客户名称:', activeCustomerName);
      logger.log('[processScan] 当前仓库:', activeWarehouse ? activeWarehouse.name : 'null');

      if (!code || !isCurrentSession(sessionId) || processingRef.current || pendingOutboundUnpackRef.current || initializationError) return;

      processingRef.current = true;
      setScanProcessing(true);
      let failureSpeech = '扫码处理失败，请查看提示';
      let materialSaved = false;
      try {
        const normalizedOrderCode = normalizeOrderNoCandidate(code);
        const matchedErpAccount = getErpAccountByOutboundOrderNo(normalizedOrderCode);
        const activeErpAccount = activeOrderNo
          ? getErpAccountByOutboundOrderNo(activeOrderNo)
          : null;
        const hasWarehouseSampleRules = Object.keys(outboundWarehouseOrderRules).length > 0;
        const matchedWarehouseRules = getMatchingOutboundWarehouseOrderRules(
          normalizedOrderCode,
          outboundWarehouseOrderRules
        );
        const availableWarehouseIds = new Set(warehouses.map((warehouse) => String(warehouse.id)));
        const matchedAvailableWarehouseRules = matchedWarehouseRules.filter((rule) =>
          availableWarehouseIds.has(rule.warehouseId)
        );
        const legacyParsedOrderNo = hasWarehouseSampleRules
          ? null
          : parseOutboundOrderNo(normalizedOrderCode, outboundOrderRule);
        const isOrderNoScan =
          matchedErpAccount !== null ||
          matchedAvailableWarehouseRules.length > 0 ||
          legacyParsedOrderNo !== null;
        // 订单号仍可用一维码录入；无分隔符的物料码静默忽略。
        if (!isOrderNoScan && !isQRCode(code)) {
          activeRulesRef.current ??= await getActiveRules();
          ensureCurrent();
          if (!isQRCode(code, activeRulesRef.current)) {
            return;
          }
        }
        if (!isOrderNoScan) {
          if (options.expectedOrderNo && normalizeOrderNoCandidate(options.expectedOrderNo) !== normalizeOrderNoCandidate(activeOrderNo)) {
            throw new Error(`这笔待处理扫码属于 ${options.expectedOrderNo}，请先加载该订单再继续`);
          }
        }
        if (erpVoucherRecoveryRequired && activeOrderNo && !isOrderNoScan) {
          showToast('ERP单据未验证，请重新扫描订单或点击刷新', 'error');
          void feedbackError('订单未核验，请重新扫描订单');
          return;
        }
        if (activeErpAccount && !activeErpVoucher && !isOrderNoScan) {
          showToast('ERP单据尚未验证，请重新扫描订单或点击刷新', 'error');
          void feedbackError('订单未核验，请重新扫描订单');
          return;
        }
        if (activeOrderNo && !isOrderNoScan &&
            orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, activeWarehouse?.id)) {
          try {
            await loadOrderMaterials(activeOrderNo, activeWarehouse?.id);
            ensureCurrent();
          } catch (error) {
            logger.warn('[扫码出库] 扫码前恢复本单记录失败:', error);
          }
          if (!isCurrentSession(sessionId) || orderNoRef.current !== activeOrderNo ||
              currentWarehouseRef.current?.id !== activeWarehouse?.id ||
              orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, activeWarehouse?.id)) {
            showToast('本单记录未加载，已暂停扫码。请重新扫描订单或点击刷新', 'error');
            void feedbackError('订单记录未加载，请重新扫描订单');
            return;
          }
        }
        // 如果当前没有订单号，扫描内容必须是订单号格式
        if (!activeOrderNo && !isOrderNoScan) {
          showToast(
            hasWarehouseSampleRules
              ? '请先扫描已配置仓库样例结构的出库单号'
              : `请先扫描订单号\n格式: ${getOutboundOrderRuleHint(outboundOrderRule)}`,
            'error'
          );
          void feedbackError('请先扫描订单');
          return;
        }

        // 判断是否是订单号格式
        if (isOrderNoScan) {
          failureSpeech = '订单加载失败，请查看提示';
          if (matchedErpAccount) {
            if (
              activeErpVoucher &&
              normalizeOrderNoCandidate(activeOrderNo) === normalizedOrderCode &&
              normalizeOrderNoCandidate(activeErpVoucher.code) === normalizedOrderCode
            ) {
              setIsErpOrderLoading(true);
              let workWarehouse = activeWarehouse || currentWarehouseRef.current;
              if (!isErpVoucherVerified(activeErpVoucher)) {
                setIsErpOrderLoading(true);
                const refreshed = await forceRefreshErpVoucherForOrder(normalizedOrderCode, warehouses, {
                  clearOnFailure: false,
                });
                ensureCurrent();
                if (!refreshed) throw new Error(erpVerificationErrorRef.current || 'ERP核验失败');
                activeErpVoucher = refreshed.voucher;
                workWarehouse = refreshed.warehouse;
                activeCustomerName = refreshed.voucher.customerName.trim();
                setActiveCustomerName(activeCustomerName);
              }
              if (!workWarehouse) {
                throw new Error('仓库信息缺失，无法恢复当前订单');
              }
              // 重扫同单也重新读取已保存记录，让界面与完成播报使用同一份数据。
              await loadOrderMaterials(normalizedOrderCode, workWarehouse.id);
              ensureCurrent();
              await upsertSaleDispatchOrder(normalizedOrderCode, activeCustomerName.trim(), workWarehouse, activeErpVoucher);
              ensureCurrent();
              await saveOutboundWorkDraft(
                normalizedOrderCode,
                activeCustomerName.trim() || activeErpVoucher.customerName,
                workWarehouse,
                activeErpVoucher
              );
              if (!isCurrentSession(sessionId) ||
                  normalizeOrderNoCandidate(orderNoRef.current) !== normalizedOrderCode) return;
              if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(normalizedOrderCode, workWarehouse.id) ||
                  erpVoucherRef.current !== activeErpVoucher || !isErpVoucherVerified(activeErpVoucher)) {
                throw new Error('本单记录或ERP核验状态已变化，请重新扫描订单');
              }
              const isReturn = getSaleDispatchDirection(activeErpVoucher.lines) === 'sales_return';
              const complete = isSaleDispatchOrderComplete(activeErpVoucher.lines, scanRecordsRef.current);
              showToast(isReturn ? (complete ? '本单退货已收齐' : '当前退货单，请继续扫码')
                : (complete ? '本单已扫完' : '当前订单，请继续扫码'), 'success');
              void (isReturn ? feedbackSalesReturnOrderReady(complete ? 'complete' : 'current')
                : feedbackOutboundOrderReady(complete ? 'complete' : 'current'));
              return;
            }

            setIsErpOrderLoading(true);
            // 每张不同订单都立即启动真实查询，与本地缓存读取同时进行。
            // 命中缓存时仍展示缓存并恢复记录，随后消费同一个实时请求核验。
            const preparedVerification: PreparedErpVoucherRequest = {
              accountKey: matchedErpAccount.key,
              orderNo: normalizedOrderCode,
              sessionId,
              outcome: loadSaleDispatchVoucher(matchedErpAccount, normalizedOrderCode, {
                bypassProxyCache: true,
                forceRefresh: true,
              }).then(
                (result) => ({ ok: true as const, result, receivedAt: result.receivedAt ?? Date.now() }),
                (error: unknown) => ({ ok: false as const, error })
              ),
            };
            const { fromCache, voucher, receivedAt } = await loadSaleDispatchVoucher(
              matchedErpAccount,
              normalizedOrderCode,
              { bypassProxyCache: true, preparedRequest: preparedVerification }
            );
            if (!isCurrentSession(sessionId)) {
              return;
            }
            const matchedWarehouse = resolveWarehouseForErpVoucher(
              voucher,
              warehouses
            );

            if (!matchedWarehouse) {
              showToast(
                `本地未找到ERP仓库：${voucher.warehouseName || voucher.expectedWarehouseName || '-'}`,
                'error'
              );
              void feedbackError('未找到订单仓库，请查看提示');
              return;
            }

            if (
              !matchedWarehouse.id ||
              typeof matchedWarehouse.id !== 'string' ||
              matchedWarehouse.id.trim() === ''
            ) {
              showToast('仓库信息无效，请重新选择仓库', 'error');
              void feedbackError('仓库信息无效，请重新选择');
              return;
            }

            const shouldPersistWarehouse = !activeWarehouse || activeWarehouse.id !== matchedWarehouse.id;

            const isSameOrder =
              normalizeOrderNoCandidate(activeOrderNo) === normalizedOrderCode;
            const isSwitchingOrder =
              !isSameOrder && normalizeOrderNoCandidate(activeOrderNo).length > 0;
            ensureCurrent();
            // 新单已有 ERP 客户时直接显示；本地头记录只用于缺失客户的兼容回退。
            // 后续 upsert 和历史物料恢复仍完整执行，未完成前不允许开始保存物料。
            const existing = !fromCache && voucher.customerName.trim()
              ? null
              : await getOrder(normalizedOrderCode, matchedWarehouse.id);
            ensureCurrent();
            if (!fromCache && receivedAt !== undefined && !isOutboundVerificationFresh(receivedAt)) {
              throw new Error('ERP查询结果已过期，请重新扫描订单');
            }
            const nextCustomerName = (voucher.customerName || existing?.customer_name || '').trim();

            scanRecordsRef.current = [];
            setScanRecords([]);
            expandedGroupsRef.current = new Set();
            setExpandedGroups(new Set());
            // Publish one coherent work context: never show the new warehouse
            // while the previous order is still active during storage I/O.
            if (shouldPersistWarehouse) setActiveWarehouse(matchedWarehouse);
            setActiveOrderNo(normalizedOrderCode);
            setActiveCustomerName(nextCustomerName);
            if (fromCache) {
              markErpVoucherUnverified();
            }
            setActiveErpVoucher(voucher);
            if (!fromCache) {
              markErpVoucherVerified(voucher, receivedAt);
            }
            setErpVoucherRecoveryRequired(false);

            const [warehousePersistence] = await Promise.all([
              shouldPersistWarehouse
                ? AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(matchedWarehouse))
                  .then(() => ({ ok: true as const }), () => ({ ok: false as const }))
                : Promise.resolve({ ok: true as const }),
              upsertSaleDispatchOrder(normalizedOrderCode, nextCustomerName, {
                id: matchedWarehouse.id,
                name: matchedWarehouse.name,
              }, voucher),
              saveOutboundWorkDraft(
                normalizedOrderCode,
                nextCustomerName,
                matchedWarehouse,
                voucher
              ),
              loadOrderMaterials(normalizedOrderCode, matchedWarehouse.id),
            ]);
            ensureCurrent();
            // Wait for the material restore as well, so an early storage error
            // cannot later be overwritten by its still-running ready callback.
            if (!warehousePersistence.ok) {
              throw new Error('订单仓库设置保存失败，请重新扫描订单');
            }

            let readyVoucher = voucher;
            let readyWarehouse = matchedWarehouse;
            if (fromCache) {
              // 缓存先恢复界面；ERP核验完成前不能据旧数量播报“本单已扫完”。
              // 核验过程只显示状态，最终只播一条结果，避免打断完成提示。
              const refreshed = await forceRefreshErpVoucherForOrder(normalizedOrderCode, warehouses, {
                preparedRequest: preparedVerification,
              });
              if (!isCurrentSession(sessionId) ||
                  normalizeOrderNoCandidate(orderNoRef.current) !== normalizedOrderCode) return;
              if (!refreshed) throw new Error(erpVerificationErrorRef.current || 'ERP核验失败');
              readyVoucher = refreshed.voucher;
              readyWarehouse = refreshed.warehouse;
              const refreshedCustomerName = readyVoucher.customerName.trim();
              setActiveCustomerName(refreshedCustomerName);
              await Promise.all([
                upsertSaleDispatchOrder(normalizedOrderCode, refreshedCustomerName, readyWarehouse, readyVoucher),
                saveOutboundWorkDraft(normalizedOrderCode, refreshedCustomerName, readyWarehouse, readyVoucher),
              ]);
              ensureCurrent();
              if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(normalizedOrderCode, readyWarehouse.id)) {
                await loadOrderMaterials(normalizedOrderCode, readyWarehouse.id);
              }
            }
            if (!isCurrentSession(sessionId) ||
                normalizeOrderNoCandidate(orderNoRef.current) !== normalizedOrderCode) return;
            if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(normalizedOrderCode, readyWarehouse.id) ||
                erpVoucherRef.current !== readyVoucher || !isErpVoucherVerified(readyVoucher)) {
              throw new Error('本单记录或ERP核验状态已变化，请重新扫描订单');
            }
            const isReturn = getSaleDispatchDirection(readyVoucher.lines) === 'sales_return';
            const currentOrderComplete = isSaleDispatchOrderComplete(readyVoucher.lines, scanRecordsRef.current);
            let orderLoadedMessage = '订单已载入';
            if (currentOrderComplete) {
              orderLoadedMessage = '本单已扫完';
            } else if (isSameOrder) {
              orderLoadedMessage = '当前订单，请继续扫码';
            } else if (isSwitchingOrder) {
              orderLoadedMessage = '订单已切换';
            }
            if (isReturn) {
              orderLoadedMessage = currentOrderComplete ? '本单退货已收齐'
                : isSameOrder ? '当前退货单，请继续扫码'
                  : isSwitchingOrder ? '已切换退货单' : '销售退货单已载入';
            }

            showToast(orderLoadedMessage, 'success');
            if (isReturn) {
              void feedbackSalesReturnOrderReady(currentOrderComplete ? 'complete'
                : isSameOrder ? 'current' : isSwitchingOrder ? 'switched' : 'loaded');
            } else if (currentOrderComplete) {
              void feedbackOutboundOrderReady('complete');
            } else if (isSameOrder) {
              void feedbackOutboundOrderReady('current');
            } else {
              void feedbackOutboundOrderReady(isSwitchingOrder ? 'switched' : 'loaded');
            }
            return;
          }

          setActiveErpVoucher(null);
          setErpVoucherRecoveryRequired(false);
          showToast('出库单未匹配到ERP账套，请检查单号规则', 'error');
          void feedbackError('订单未匹配账套，请查看提示');
          return;
        }

        // 物料扫描
        if (!activeOrderNo) {
          showToast('请先扫描订单', 'warning');
          void feedbackWarning('请先扫描订单');
          return;
        }

        let workWarehouse = currentWarehouseRef.current;
        if (!workWarehouse) {
          showToast('请选择仓库', 'warning');
          void feedbackWarning('请先选择仓库');
          setShowWarehousePicker(true);
          return;
        }

        // 确保仓库ID有效
        if (
          !workWarehouse.id ||
          typeof workWarehouse.id !== 'string' ||
          workWarehouse.id.trim() === ''
        ) {
          showToast('仓库信息无效，请重新选择仓库', 'error');
          void feedbackError('仓库信息无效，请重新选择');
          return;
        }

        // 解析
        let parsed: {
          model: string;
          batch: string;
          quantity: string;
          traceNo?: string;
          sourceNo?: string;
          package?: string;
          version?: string;
          productionDate?: string;
          separator?: string;
        } | null = null;

        // 保存扫码时使用的分隔符和规则名称
        let separator = ',';
        let ruleId = '';
        let ruleName = '';
        let customFields: Record<string, string> = {};
        let selectedRule: Awaited<ReturnType<typeof detectRule>> = null;

        try {
          activeRulesRef.current ??= await getActiveRules();
          code = recoverConfirmedScannerContent(code, options.confirmedNativePrefix ?? null, activeRulesRef.current);
          const rule = await detectRule(code, activeRulesRef.current);
          selectedRule = rule;
          if (rule) {
            separator = rule.separator || ',';
            ruleId = rule.id || '';
            ruleName = rule.name || '';
            const { standardFields, customFields: parsedCustomFields } = parseWithRule(code, rule);
            parsed = {
              model: standardFields.model || '',
              batch: standardFields.batch || '',
              quantity: standardFields.quantity || '',
              traceNo: standardFields.traceNo,
              sourceNo: standardFields.sourceNo,
              package: standardFields.package,
              version: standardFields.version,
              productionDate: standardFields.productionDate,
            };
            customFields = parsedCustomFields || {};
          }
        } catch (error) {
          logger.error('[扫码出库] 规则解析失败:', error);
          throw error;
        }

        if (!parsed) {
          showToast('没有匹配的二维码解析规则，请先在设置中配置', 'error');
          void feedbackError('二维码规则未匹配，请查看提示');
          return;
        }

        const normalizedModel = (parsed.model || '').trim();
        const normalizedQuantity = parseQuantity(parsed.quantity);

        if (!normalizedModel) {
          showToast('未识别到型号信息', 'error');
          void feedbackError('未识别到型号，请查看提示');
          return;
        }

        if (normalizedQuantity === null) {
          logger.warn('[扫码出库] 忽略数量字段无效的扫码内容:', {
            code,
            quantity: parsed.quantity,
            model: normalizedModel,
          });
          showToast('二维码数量无效，请重新扫描', 'error');
          void feedbackError('二维码数量无效，请重新扫描');
          return;
        }

        if (activeErpVoucher) {
          const latestErpVoucher = erpVoucherRef.current;
          if (
            latestErpVoucher &&
            buildErpVoucherCacheKey(latestErpVoucher.accountKey, latestErpVoucher.code) ===
              buildErpVoucherCacheKey(activeErpVoucher.accountKey, activeErpVoucher.code) &&
            isErpVoucherVerified(latestErpVoucher)
          ) {
            activeErpVoucher = latestErpVoucher;
          }
        }

        if (activeErpVoucher && !isErpVoucherVerified(activeErpVoucher)) {
          setIsErpOrderLoading(true);
          const refreshed = await forceRefreshErpVoucherForOrder(activeOrderNo, warehouses);
          ensureCurrent();
          if (!refreshed) {
            showToast('ERP单据实时核验失败，已阻止本次物料扫码', 'error');
            void feedbackError('订单核验失败，本次未录入');
            return;
          }

          activeErpVoucher = refreshed.voucher;
          workWarehouse = refreshed.warehouse;
          activeCustomerName = refreshed.voucher.customerName.trim();
          setActiveCustomerName(activeCustomerName);
          await Promise.all([
            upsertSaleDispatchOrder(activeOrderNo, activeCustomerName, {
              id: workWarehouse.id,
              name: workWarehouse.name,
            }, activeErpVoucher),
            saveOutboundWorkDraft(
              activeOrderNo,
              activeCustomerName,
              workWarehouse,
              activeErpVoucher
            ),
          ]);
          ensureCurrent();
          if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, workWarehouse.id)) {
            await loadOrderMaterials(activeOrderNo, workWarehouse.id);
          }
        }

        if (activeErpVoucher) assertSaleDispatchDirection(activeErpVoucher);
        const isReturnScan = !!activeErpVoucher &&
          getSaleDispatchDirection(activeErpVoucher.lines) === 'sales_return';
        // 退货走独立验收表；正出库的重复检查不能拦截原包装退回。
        logger.log('[扫码出库] 开始检查重复和查找存货编码，参数:', {
          orderNo: activeOrderNo,
          model: normalizedModel,
          batch: parsed.batch,
          traceNo: parsed.traceNo,
          quantity: normalizedQuantity,
        });
        if (options.recoveryItem) {
          const committed = isReturnScan ? await getSalesReturnById(eventId) : await getMaterialById(eventId);
          ensureCurrent();
          if (committed) {
            if (committed.order_no !== activeOrderNo || committed.warehouse_id !== workWarehouse.id ||
                committed.raw_content !== code) throw new Error('历史扫码标识对应的数据不一致，请人工核对');
            await scanQueue.acknowledgeRecovered(options.recoveryItem.id, committed.id);
            ensureCurrent();
            setLegacyReviewItems(await scanQueue.restoreForReview());
            await loadOrderMaterials(activeOrderNo, workWarehouse.id);
            ensureCurrent();
            showToast('这笔历史扫码已经保存，已恢复界面', 'success');
            return;
          }
        }
        const [check, bindingMatch] = await Promise.all([
          isReturnScan ? Promise.resolve({ material: null, isUnpacked: false, canRescan: false }) : checkMaterialExists(
            activeOrderNo,
            normalizedModel,
            parsed.batch,
            parsed.sourceNo,
            parsed.traceNo,
            normalizedQuantity.toString(),
            workWarehouse.id
          ),
          (async () => {
            const key = JSON.stringify([normalizedModel, parsed.version?.trim() || '']);
            const cached = inventoryBindingsRef.current.get(key);
            if (cached) return cached;
            const value = await getInventoryBindingMatchByModel(normalizedModel, parsed.version);
            if (value.inventoryCode) inventoryBindingsRef.current.set(key, value);
            return value;
          })(),
        ]);
        ensureCurrent();
        const inventoryCode = bindingMatch.inventoryCode;
        await assertRuleSupplierForScan({ rule: selectedRule, inventoryCode });
        ensureCurrent();
        logger.log('[扫码出库] 重复检查结果:', check);
        logger.log('[扫码出库] 存货编码:', inventoryCode);

        if (check.material && !check.canRescan) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        if (!isCurrentSession(sessionId) || orderNoRef.current !== activeOrderNo ||
            orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, workWarehouse.id)) {
          throw new Error('出库作业已变化或记录未恢复，请重新扫描');
        }
        const normalizedInventoryCode = normalizeInventoryCode(inventoryCode);
        let successToastText = `已扫码：${normalizedModel}`;

        if (activeErpVoucher) {
          if (!normalizedInventoryCode) {
            showToast(
              `未绑定存货编码：${normalizedModel}${parsed.version ? ` / ${parsed.version}` : ''}`,
              'error'
            );
            feedbackNotBound();
            return;
          }

          if (!isErpVoucherVerified(activeErpVoucher) || erpVoucherRef.current !== activeErpVoucher) {
            throw new Error('ERP单据正在更新，请重新扫描');
          }
          const progress = buildSaleDispatchProgress(activeErpVoucher.lines, scanRecordsRef.current);
          const matchedErpLine = progress.find((line) => line.inventoryCode === normalizedInventoryCode && line.sourceLineCount > 0);
          const erpRequiredQuantity = matchedErpLine?.requiredQuantity ?? 0;

          if (!matchedErpLine) {
            logger.warn('[扫码出库] 绑定存货编码未出现在ERP单据中:', {
              inventoryCode: normalizedInventoryCode,
              model: normalizedModel,
              version: parsed.version || '',
            });
            showToast(
              `不在ERP${isReturnScan ? '退货' : '出库'}单：${normalizedModel}${parsed.version ? ` / ${parsed.version}` : ''}\n绑定存货编码：${inventoryCode?.trim() || normalizedInventoryCode}`,
              'error'
            );
            feedbackNotInOrder();
            return;
          }

          if (parseQuantity(erpRequiredQuantity) === null || matchedErpLine.status === 'invalid') {
            logger.warn('[扫码出库] ERP单据物料数量无效:', {
              inventoryCode: normalizedInventoryCode,
              quantity: erpRequiredQuantity,
            });
            showToast(`ERP出库数量无效，仅支持整数件数：${matchedErpLine.specification || normalizedModel}`, 'error');
            void feedbackError('订单数量无效，本次未录入');
            return;
          }

          if (progress.some((line) => line.status === 'unmatched' || line.status === 'invalid' || line.status === 'over')) {
            throw new Error('本单存在不匹配或超量的已扫记录，请先核对并处理异常明细');
          }
          const scannedQuantity = matchedErpLine.scannedQuantity;

          if (scannedQuantity + normalizedQuantity > erpRequiredQuantity) {
            const remainingQuantity = Math.max(0, erpRequiredQuantity - scannedQuantity);
            if (isReturnScan) {
              showToast(`本次退货数量 ${normalizedQuantity} 超过待收数量 ${remainingQuantity}，未保存；请核对实际退回包装和ERP退货单`, 'error');
              void feedbackError('退货数量超出，本次未录入');
              return;
            }
            if (remainingQuantity <= 0) {
              showToast(`本物料已扫够：${normalizedModel}`, 'warning');
              feedbackOverQuantity();
              return;
            }

            const splitRemainingQuantity = normalizedQuantity - remainingQuantity;
            const nextPendingOutboundUnpack: PendingOutboundUnpack = {
              lineSpecification: matchedErpLine.specification,
              newTraceNo: await buildNextUnpackTraceNo(parsed.traceNo),
              originalQuantity: normalizedQuantity,
              rawContent: code,
              remainingQuantity: splitRemainingQuantity,
              savedPayload: {
                orderNo: activeOrderNo,
                customerName: activeCustomerName.trim(),
                model: normalizedModel,
                batch: parsed.batch || '',
                quantity: normalizedQuantity.toString(),
                traceNo: parsed.traceNo,
                sourceNo: parsed.sourceNo,
                package: parsed.package,
                version: parsed.version,
                productionDate: parsed.productionDate,
                separator,
                ruleId,
                ruleName,
                customFields,
                inventoryCode: normalizedInventoryCode,
                warehouseId: workWarehouse.id,
                warehouseName: workWarehouse.name,
              },
              shippedQuantity: remainingQuantity,
              recoveryItem: options.recoveryItem,
              materialId: eventId,
              genericBinding: bindingMatch.matchKind === 'generic',
            };
            ensureCurrent();
            setOutboundUnpackNotes('');
            pendingOutboundUnpackRef.current = nextPendingOutboundUnpack;
            setPendingOutboundUnpack(nextPendingOutboundUnpack);
            showToast('需要拆包确认', 'warning');
            void feedbackUnpackRequired();
            return;
          }

          const nextRemainingQuantity = Math.max(
            0,
            erpRequiredQuantity - scannedQuantity - normalizedQuantity
          );
          successToastText = isReturnScan
            ? `已收：${normalizedModel} ${normalizedQuantity}，待收 ${nextRemainingQuantity}；本次已放行`
            : `已扫：${normalizedModel}，剩余 ${nextRemainingQuantity}`;
        }

        // 扫码出库必须在数据库提交成功后再提示成功，避免“已扫码”但实际未落库。
        const savedPayload: QueueItemParsedPayload = {
          orderNo: activeOrderNo,
          customerName: activeCustomerName.trim(),
          model: normalizedModel,
          batch: parsed.batch || '',
          quantity: normalizedQuantity.toString(),
          traceNo: parsed.traceNo,
          sourceNo: parsed.sourceNo,
          package: parsed.package,
          version: parsed.version,
          productionDate: parsed.productionDate,
          separator,
          ruleId,
          ruleName,
          customFields,
          inventoryCode: normalizedInventoryCode,
          warehouseId: workWarehouse.id,
          warehouseName: workWarehouse.name,
        };
        failureSpeech = '保存失败，请查看提示';
        const materialPayload = {
            id: eventId,
            order_no: activeOrderNo,
            customer_name: savedPayload.customerName || '',
            model: savedPayload.model || '',
            batch: savedPayload.batch || '',
            quantity: parseQuantity(savedPayload.quantity || '1') ?? 1,
            traceNo: savedPayload.traceNo,
            sourceNo: savedPayload.sourceNo,
            package: savedPayload.package,
            version: savedPayload.version,
            productionDate: savedPayload.productionDate,
            raw_content: code,
            separator: savedPayload.separator,
            rule_id: savedPayload.ruleId,
            rule_name: savedPayload.ruleName,
            customFields: savedPayload.customFields,
            scanned_at: getISODateTime(),
            warehouse_id: savedPayload.warehouseId,
            warehouse_name: savedPayload.warehouseName,
            inventory_code: savedPayload.inventoryCode || '',
            erp_account_key: activeErpVoucher?.accountKey,
          };
        const materialId = isReturnScan
          ? (await saveSalesReturnWithOrder({
              material: materialPayload,
              requiredQuantity: buildSalesReturnProgress(activeErpVoucher!.lines, [])
                .find((line) => line.inventoryCode === normalizedInventoryCode)?.requiredQuantity ?? 0,
            })).id
          : await addMaterialWithOrder(
          { ...materialPayload, operation_type: 'outbound' },
          savedPayload.customerName || '',
          {
            id: savedPayload.warehouseId,
            name: savedPayload.warehouseName,
          }
        );

        materialSaved = true;
        if (options.recoveryItem) await scanQueue.acknowledgeRecovered(options.recoveryItem.id, materialId);
        ensureCurrent();
        if (options.recoveryItem) setLegacyReviewItems(await scanQueue.restoreForReview());
        await saveOutboundWorkDraft(activeOrderNo, activeCustomerName.trim(), workWarehouse);
        ensureCurrent();

        let orderJustCompleted = false;
        if (activeOrderNo === orderNoRef.current) {
          const recordsBeforeSave = scanRecordsRef.current;
          const savedItem = mapQueueItemToMaterialItem(materialId, savedPayload);
          savedItem.operationType = isReturnScan ? 'sales_return' : 'outbound';
          const preservedItems = recordsBeforeSave.filter(
            (item) => item.id !== savedItem.id
          );
          const nextRecords = [savedItem, ...preservedItems];
          scanRecordsRef.current = nextRecords;
          setScanRecords(nextRecords);
          orderJustCompleted = activeErpVoucher !== null &&
            !isSaleDispatchOrderComplete(activeErpVoucher.lines, recordsBeforeSave) &&
            isSaleDispatchOrderComplete(activeErpVoucher.lines, nextRecords);
        }

        showToast(
          `${orderJustCompleted ? (isReturnScan ? '本单退货已收齐，已收物料可再次出库' : '本单已扫完，可扫描下一单') : successToastText}${bindingMatch.matchKind === 'generic' ? ' · 使用通用绑定' : ''}`,
          'success'
        );
        void (isReturnScan ? feedbackSalesReturnSaved(orderJustCompleted)
          : orderJustCompleted ? feedbackOutboundOrderComplete() : feedbackSuccess());
      } catch (e) {
        if (!isCurrentSession(sessionId)) return;
        pausePendingScans();
        if (materialSaved) {
          // 数据提交后的附属步骤失败，必须使旧数量失效，再读取数据库实际结果。
          orderMaterialsKeyRef.current = null;
          setOrderMaterialsReady(false);
          try { await loadOrderMaterials(activeOrderNo, currentWarehouseRef.current?.id); }
          catch (reloadError) { logger.warn('[扫码出库] 已保存后数量恢复失败，保持暂停:', reloadError); }
          if (!isCurrentSession(sessionId)) return;
        }
        if (options.recoveryItem && !materialSaved) {
          await scanQueue.markReviewFailed(options.recoveryItem.id, formatUserFacingErrorMessage(e, '历史扫码校验失败'));
          if (!isCurrentSession(sessionId)) return;
          setLegacyReviewItems(await scanQueue.restoreForReview());
        }
        if (e instanceof QRCodeRuleConflictError) {
          const activeRules = activeRulesRef.current ?? [];
          const voucherInventoryCodes = new Set(
            (activeErpVoucher?.lines || [])
              .map((line) => normalizeInventoryCode(line.inventoryCode))
              .filter(Boolean)
          );
          const diagnostic = await buildRuleConflictDiagnostic(code, activeRules, {
            isInventoryCodeInCurrentDocument: (inventoryCode) =>
              voucherInventoryCodes.has(normalizeInventoryCode(inventoryCode)),
          });
          if (!isCurrentSession(sessionId)) return;
          if (diagnostic) {
            // 不在查看诊断时继续处理排队扫码；本次不会写入任何出库记录。
            scannerFocusBlockedRef.current = true;
            alertRef.current.showAlert(
              '解析规则冲突',
              `${formatRuleConflictDiagnostic(diagnostic, '当前出库单')}\n待处理 ${pendingScanCodesRef.current.length} 条已暂停，修正规则后可继续。`,
              [
                { text: '知道了' },
                { text: '去配置规则', onPress: () => routerRef.current.push('/rules') },
              ],
              'warning'
            );
            void feedbackWarning('解析规则冲突，请查看提示');
            return;
          }
        }
        if (e instanceof RuleSupplierValidationError) {
          scannerFocusBlockedRef.current = true;
          alertRef.current.showAlert(e.title, e.message, [
            { text: '知道了' },
            { text: '解析诊断', onPress: () => routerRef.current.push('/rule-diagnostics', { expectedRuleId: e.ruleId }) },
          ], 'warning');
          void feedbackWarning('供应商归属异常，请查看提示');
          return;
        }
        if (getErpAccountByOutboundOrderNo(normalizeOrderNoCandidate(code))) {
          markErpVoucherUnverified();
          setErpVoucherRecoveryRequired(true);
        }
        logger.error('[扫码出库] 处理失败:', e);
        const errorMessage = formatUserFacingErrorMessage(e, '扫码处理失败，请重新扫描');
        showToast(materialSaved ? `数据已保存，后续处理失败：${errorMessage}` : `处理失败：${errorMessage}`, materialSaved ? 'warning' : 'error');
        void (materialSaved ? feedbackWarning('数据已保存，请检查界面提示') : feedbackError(failureSpeech));
      } finally {
        if (isCurrentSession(sessionId)) {
          setIsErpOrderLoading(false);
          resumePendingScanCodes(170, sessionId);
        }
      }
    },
    [
      forceRefreshErpVoucherForOrder,
      initializationError,
      isCurrentSession,
      pausePendingScans,
      isErpVoucherVerified,
      loadOrderMaterials,
      markErpVoucherVerified,
      markErpVoucherUnverified,
      outboundOrderRule,
      outboundWarehouseOrderRules,
      erpVoucherRecoveryRequired,
      resolveWarehouseForErpVoucher,
      resumePendingScanCodes,
      saveOutboundWorkDraft,
      setActiveCustomerName,
      setActiveErpVoucher,
      setActiveOrderNo,
      setActiveWarehouse,
      showToast,
      warehouses,
    ]
  );

  useEffect(() => {
    processScanRef.current = processScan;
  }, [processScan]);

  // 聚合物料（按型号+版本，显示规则与扫码入库保持一致）
  const aggregateMaterials = useMemo(() => {
    const map = new Map<string, AggregatedGroup>();

    scanRecords.forEach((item) => {
      const key = buildMaterialGroupKey(item);

      if (!map.has(key)) {
        map.set(key, {
          key,
          model: item.model,
          version: item.version || '',
          batch: item.batch || '',
          sourceNo: item.sourceNo || '',
          package: item.package || '',
          totalQuantity: parseInt(item.quantity, 10) || 0,
          boxCount: 1,
          items: [item],
        });
      } else {
        const group = map.get(key)!;
        group.totalQuantity += parseInt(item.quantity, 10) || 0;
        group.boxCount += 1;
        group.items.push(item);
      }
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => b.id.localeCompare(a.id)),
      }))
      .sort((a, b) => (b.items[0]?.id || '').localeCompare(a.items[0]?.id || ''));
  }, [scanRecords]);

  const aggregateTotals = useMemo(
    () => ({
      modelCount: aggregateMaterials.length,
      totalQuantity: aggregateMaterials.reduce((sum, group) => sum + group.totalQuantity, 0),
    }),
    [aggregateMaterials]
  );

  const erpLineProgressItems = useMemo<ErpLineProgress[]>(
    () => erpVoucher ? buildSaleDispatchProgress(erpVoucher.lines, scanRecords) : [],
    [erpVoucher, scanRecords]
  );
  const isSalesReturn = !!erpVoucher && getSaleDispatchDirection(erpVoucher.lines) === 'sales_return';


  const erpRequiredTotal = useMemo(
    () => erpLineProgressItems.reduce((sum, line) => sum + line.requiredQuantity, 0),
    [erpLineProgressItems]
  );
  const isErpOrderComplete =
    erpVoucher !== null && verifiedErpVoucher === erpVoucher &&
    orderMaterialsReady &&
    !erpVoucherRecoveryRequired &&
    erpLineProgressItems.length > 0 &&
    erpLineProgressItems.every((line) => line.status === 'complete');

  const workflowSummaryItems = useMemo(
    () => {
      const inferredAccount = orderNo ? getErpAccountByOutboundOrderNo(orderNo) : null;

      return [
        {
          key: 'account',
          label: '账套',
          value: erpVoucher?.accountName || inferredAccount?.name || '待识别',
          icon: 'layers' as const,
          color: erpVoucher || inferredAccount ? theme.success : theme.textMuted,
        },
        {
          key: 'order',
          label: isSalesReturn ? '退货单号' : '出库单号',
          value: orderNo || '待扫描',
          icon: 'file-text' as const,
          color: orderNo ? theme.success : theme.textMuted,
        },
        {
          key: 'customer',
          label: '客户',
          value: customerName || (orderNo ? 'ERP未返回' : '待自动带出'),
          icon: 'user' as const,
          color: customerName ? theme.success : theme.warning,
        },
      ];
    },
    [customerName, erpVoucher, isSalesReturn, orderNo, theme.success, theme.textMuted, theme.warning]
  );

  // 切换展开/折叠
  const toggleExpand = useCallback((key: string) => {
    if (expandedGroupsRef.current.has(key)) {
      expandedGroupsRef.current.delete(key);
    } else {
      expandedGroupsRef.current.add(key);
    }
    setExpandedGroups(new Set(expandedGroupsRef.current));
  }, []);

  // 删除单个物料
  const handleDeleteItem = useCallback(
    (item: MaterialItem) => {
      alert.showConfirm(
        '确认删除',
        '确定要删除这条物料吗？',
        () => {
          void (async () => {
            const sessionId = pageSessionRef.current;
            if (processingRef.current || pendingOutboundUnpackRef.current || orderNo !== orderNoRef.current) {
              showToast('正在处理出库作业，请稍后删除', 'warning');
              return;
            }
            processingRef.current = true;
            try {
              if (item.operationType === 'sales_return') await deleteSalesReturn(item.id);
              else await deleteMaterial(item.id);
              if (!isCurrentSession(sessionId) || orderNoRef.current !== orderNo) return;
              const remainingItems = scanRecordsRef.current.filter(record => record.id !== item.id);
              scanRecordsRef.current = remainingItems;
              setScanRecords(remainingItems);
              if (orderNo) {
                try {
                  await loadOrderMaterials(orderNo);
                  if (!isCurrentSession(sessionId)) return;
                } catch (refreshError) {
                  if (!isCurrentSession(sessionId)) return;
                  logger.warn('[扫码出库] 物料已删除，但刷新列表失败:', refreshError);
                  showToast('物料已删除，列表暂未刷新；下次扫码将重新读取本单记录', 'warning');
                  void feedbackDeleted();
                  return;
                }
              }
              showToast('物料已删除', 'success');
              void feedbackDeleted();
            } catch (error) {
              if (!isCurrentSession(sessionId)) return;
              logger.error('删除失败:', error);
              showToast(formatUserFacingErrorMessage(error, '删除失败，请稍后重试'), 'error');
              void feedbackError('删除失败，请查看提示');
            } finally {
              if (isCurrentSession(sessionId)) resumePendingScanCodes(100, sessionId);
            }
          })();
        },
        true
      );
    },
    [alert, isCurrentSession, loadOrderMaterials, orderNo, resumePendingScanCodes, showToast]
  );

  const renderOutboundRight = useCallback(
    (group: AggregatedGroup) => (
      <View style={styles.itemRight}>
        <Text style={styles.itemQty}>{group.totalQuantity.toLocaleString()}</Text>
      </View>
    ),
    [styles.itemQty, styles.itemRight]
  );

  const renderOutboundDetail = useCallback(
    (item: MaterialItem) => (
      <TouchableOpacity
        key={item.id}
        style={styles.detailItem}
        onLongPress={() => handleDeleteItem(item)}
        delayLongPress={500}
      >
        <Text style={styles.detailText}>
          批次: {item.batch || '-'} | 生产日期: {item.productionDate || '-'} | 数量:{' '}
          {parseInt(item.quantity, 10) || 0}
        </Text>
      </TouchableOpacity>
    ),
    [handleDeleteItem, styles.detailItem, styles.detailText]
  );

  const renderErpLineDetail = useCallback(
    (item: MaterialItem) => (
      <TouchableOpacity
        key={item.id}
        style={styles.erpLineDetailItem}
        onLongPress={() => handleDeleteItem(item)}
        delayLongPress={500}
      >
        <Text style={styles.detailText}>
          生产日期: {item.productionDate?.trim() || '-'}{item.version ? ` | 版本: ${item.version}` : ''} | 数量{' '}
          {parseQuantity(item.quantity, { min: 0 }) ?? 0}
        </Text>
        <Text style={styles.detailText}>
          批次: {item.batch || '-'} | 追溯码: {item.traceNo || '-'}
        </Text>
      </TouchableOpacity>
    ),
    [handleDeleteItem, styles.detailText, styles.erpLineDetailItem]
  );

  const renderErpLineProgress = useCallback(
    ({ item }: { item: ErpLineProgress }) => {
      const isExpanded = expandedGroups.has(item.key);
      const progressRatio =
        item.requiredQuantity > 0
          ? Math.min(1, Math.max(0, item.scannedQuantity / item.requiredQuantity))
          : 0;
      const statusMeta =
        item.status === 'unmatched'
          ? { label: item.inventoryCode ? '不在本单' : '缺少存货编码', color: theme.error }
          : item.status === 'invalid'
            ? { label: '数据异常', color: theme.error }
          : item.status === 'complete'
          ? { label: '完成', color: theme.success }
          : item.status === 'over'
            ? { label: '超量', color: theme.error }
            : item.status === 'partial'
              ? { label: '进行中', color: theme.primary }
              : { label: '待扫', color: theme.textMuted };

      return (
        <View style={styles.erpLineCard}>
          <TouchableOpacity
            style={styles.erpLineMain}
            activeOpacity={0.76}
            onPress={() => toggleExpand(item.key)}
          >
            <View style={styles.erpLineContent}>
              <Text style={styles.erpLineCode} numberOfLines={2} ellipsizeMode="tail">
                {item.specification || '物料明细'}
              </Text>
              {item.sourceLineCount > 1 ? (
                <Text style={styles.erpLineMergeHint}>
                  ERP {item.sourceLineCount} 行合并
                </Text>
              ) : null}
              <View style={styles.erpLineProgressTrack}>
                <View
                  style={[
                    styles.erpLineProgressFill,
                    { backgroundColor: statusMeta.color, flex: progressRatio },
                  ]}
                />
                <View style={{ flex: 1 - progressRatio }} />
              </View>
              <View style={styles.erpLineMetaRow}>
                <Text style={styles.erpLineMetaText}>
                  {isSalesReturn ? '应退' : '应出'} {item.requiredQuantity.toLocaleString()} / {isSalesReturn ? '已收' : '已扫'}{' '}
                  {item.scannedQuantity.toLocaleString()}
                </Text>
                <Text style={[styles.erpLineMetaText, { color: statusMeta.color }]}>
                  {isSalesReturn ? '待收' : '剩余'} {Math.max(0, item.remainingQuantity).toLocaleString()} · {statusMeta.label}
                </Text>
              </View>
            </View>
            <Feather
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={17}
              color={theme.textMuted}
            />
          </TouchableOpacity>

          {isExpanded ? (
            <View style={styles.erpLineDetails}>
              {item.scannedItems.length > 0 ? (
                item.scannedItems.map(renderErpLineDetail)
              ) : (
                <Text style={styles.erpLineEmptyText}>暂无已扫明细</Text>
              )}
            </View>
          ) : null}
        </View>
      );
    },
    [
      expandedGroups,
      isSalesReturn,
      renderErpLineDetail,
      styles,
      theme.error,
      theme.primary,
      theme.success,
      theme.textMuted,
      toggleExpand,
    ]
  );

  const renderAggregatedGroup = useCallback(
    ({ item }: { item: AggregatedGroup }) => {
      const isExpanded = expandedGroups.has(item.key);
      return (
        <AggregatedRecordItem
          groupKey={item.key}
          model={item.model}
          version={item.version}
          totalQuantity={item.totalQuantity}
          records={item.items}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          recordSignatureFields={MATERIAL_ITEM_SIGNATURE_FIELDS}
          compareValues={[item.boxCount]}
          containerStyle={styles.itemContainer}
          rowStyle={styles.itemRow}
          contentStyle={styles.itemLeft}
          titleStyle={styles.itemModel}
          subtitleStyle={styles.itemBatch}
          detailsContainerStyle={styles.detailsContainer}
          chevronColor={theme.textPrimary}
          renderRight={() => renderOutboundRight(item)}
          renderDetail={renderOutboundDetail}
        />
      );
    },
    [
      expandedGroups,
      renderOutboundDetail,
      renderOutboundRight,
      styles,
      theme.textPrimary,
      toggleExpand,
    ]
  );

  const aggregatedGroupKeyExtractor = useCallback((item: AggregatedGroup) => item.key, []);
  const erpLineKeyExtractor = useCallback((item: ErpLineProgress) => item.key, []);

  const normalizeScannerInput = useCallback((rawText: string): string => {
    return sanitizeStructuredScannerInput(rawText);
  }, []);

  const flushScannerInput = useCallback(
    (rawText?: string, preserveNativeInput = false) => {
      const sourceText = typeof rawText === 'string' ? rawText : liveInputValueRef.current;
      const confirmedNativePrefix = lastConfirmedNativeTextRef.current;
      const code = normalizeScannerInput(recoverConfirmedScannerContent(
        sourceText, confirmedNativePrefix, activeRulesRef.current ?? []
      ));
      // 自动提交也会清空原生输入；保留已消费快照，供迟到的累计原文恢复使用。
      lastConfirmedNativeTextRef.current = code
        ? consumedNativePrefixRef.current + sourceText : null;

      cancelScanSubmit(autoSubmitTimerRef);
      scannerInputRevisionRef.current += 1;
      pendingNativeSubmitTextRef.current = null;
      liveInputValueRef.current = '';
      setInputValue('');
      // 新一包已到达时仅消费旧快照，避免旧清空命令抹去新输入。
      if (!preserveNativeInput) {
        consumedNativePrefixRef.current = '';
        inputRef.current?.clear();
      }

      if (!code) {
        if (!processingRef.current && pendingScanCodesRef.current.length === 0) {
          focusScannerInput(0);
        }
        return;
      }
      if (initializationError) {
        showToast('出库数据未恢复，请点击右上角重新加载', 'error');
        return;
      }
      const candidate = normalizeOrderNoCandidate(code);
      const isOrder = Boolean(getErpAccountByOutboundOrderNo(candidate) ||
        getMatchingOutboundWarehouseOrderRules(candidate, outboundWarehouseOrderRules).length ||
        parseOutboundOrderNo(candidate, outboundOrderRule));
      if (isOrder) scanAcceptanceOrderRef.current = candidate;
      const request: PendingOutboundScan = {
        code,
        confirmedNativePrefix,
        materialId: `outbound-${Date.now()}-${++inputEventSequenceRef.current}-${generateId()}`,
        expectedOrderNo: scanAcceptanceOrderRef.current || orderNoRef.current || undefined,
      };
      if (processingRef.current || pendingOutboundUnpackRef.current ||
          scannerFocusBlockedRef.current || (queuePausedRef.current && pendingScanCodesRef.current.length > 0 && !isOrder)) {
        if (pendingScanCodesRef.current.length >= 100) {
          showToast('已有100条扫码待处理，请等待或先处理异常；本次未接收，请稍后重扫', 'error');
          return;
        }
        pendingScanCodesRef.current.push(request);
        setPendingScanCount(pendingScanCodesRef.current.length);
        return;
      }
      void processScan(code, request);
    },
    [focusScannerInput, initializationError, normalizeScannerInput, outboundOrderRule, outboundWarehouseOrderRules, processScan, showToast]
  );

  const continuePendingScans = useCallback(() => {
    if (processingRef.current || initializingRef.current || initializationError || pendingOutboundUnpackRef.current) return;
    queuePausedRef.current = false;
    queuePausePromptRef.current = false;
    setQueuePaused(false);
    resumePendingScanCodes(0);
  }, [initializationError, resumePendingScanCodes]);

  const promptPendingScans = useCallback(() => {
    if (processingRef.current || initializingRef.current || initializationError || pendingOutboundUnpackRef.current) return;
    const count = pendingScanCodesRef.current.length;
    if (!queuePausedRef.current || count === 0) return;
    queuePausePromptRef.current = true;
    const sessionId = pageSessionRef.current;
    alertRef.current.showAlert('待处理扫码已暂停',
      `还有 ${count} 条扫码尚未保存。请核对刚才的错误及当前订单，确认后继续处理。也可以先核对，再点击扫码框右侧按钮继续。`,
      [{ text: '先核对' }, { text: '继续处理', onPress: () => {
        if (isCurrentSession(sessionId)) continuePendingScans();
      } }], 'warning');
  }, [continuePendingScans, initializationError, isCurrentSession]);

  // 维护入口只在需要处理异常时使用原有提示弹窗，不占据日常扫码主页面。
  useEffect(() => {
    const reviewableTasks = printTasks.filter((task) => task.status === 'failed' || task.status === 'pending');
    const noticeKey = `${orderNo}/${currentWarehouse?.id}/${reviewableTasks.map((task) => `${task.pair_id}:${task.status}:${task.updated_at}`).join(',')}`;
    if (showPrintTasks) {
      printFailureNoticeRef.current = noticeKey;
      return;
    }
    if (!screenActiveRef.current || initializingRef.current || scanProcessing || isErpOrderLoading ||
        initializationError || alert.visible || showWarehousePicker || pendingOutboundUnpack ||
        showLegacyReview) return;
    if (queuePaused && pendingScanCount > 0 && !queuePausePromptRef.current) {
      promptPendingScans();
      return;
    }
    const sessionId = pageSessionRef.current;
    if ((legacyReviewError || legacyReviewItems.length > 0) && legacyPromptSessionRef.current !== sessionId) {
      legacyPromptSessionRef.current = sessionId;
      alertRef.current.showAlert(legacyReviewError ? '历史扫码缓存异常' : '发现历史待核对扫码',
        legacyReviewError || `有 ${legacyReviewItems.length} 条旧版本扫码需要核对，尚未自动补写。当前新扫码可以继续。`,
        [{ text: '稍后' }, { text: '查看待核对', onPress: () => {
          if (isCurrentSession(sessionId)) setShowLegacyReview(true);
        } }], 'warning');
      return;
    }
    if (!retryingPrintTask && reviewableTasks.length > 0 && noticeKey !== printFailureNoticeRef.current) {
      printFailureNoticeRef.current = noticeKey;
      alertRef.current.showAlert('拆包标签待处理',
        `本单有 ${reviewableTasks.length} 笔未提交或需核对的标签任务，拆包数据已保留。${reviewableTasks[0].last_error ? `\n${reviewableTasks[0].last_error}` : ''}\n请核对是否已出纸后再提交。`,
        [{ text: '稍后' }, { text: '查看标签任务', onPress: () => {
          if (isCurrentSession(sessionId)) setShowPrintTasks(true);
        } }], 'warning');
    }
  }, [alert.visible, currentWarehouse?.id, initializationError, isCurrentSession, isErpOrderLoading,
    legacyReviewError, legacyReviewItems.length, orderNo, pendingOutboundUnpack, pendingScanCount,
    printTasks, promptPendingScans, queuePaused, retryingPrintTask, scanProcessing, showLegacyReview, showPrintTasks, showWarehousePicker]);

  useEffect(() => {
    if (!scannerFocusBlockedRef.current && !processingRef.current && !initializingRef.current &&
        !initializationError && !queuePausedRef.current && pendingScanCodesRef.current.length > 0) {
      resumePendingScanCodes(0);
    }
  }, [alert.visible, initializationError, pendingOutboundUnpack, pendingScanCount,
    resumePendingScanCodes, showLegacyReview, showPrintTasks, showWarehousePicker]);

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback(
    (incomingText: string, alreadyNormalized = false) => {
      const native = alreadyNormalized
        ? { text: incomingText, prefix: consumedNativePrefixRef.current }
        : resolveScannerTextAfterConsumedPrefix(
          consumedNativePrefixRef.current, incomingText, liveInputValueRef.current
        );
      if ('ignore' in native && native.ignore) return;
      consumedNativePrefixRef.current = native.prefix;
      const change = resolveScannerChangeAfterSubmit(pendingNativeSubmitTextRef.current, native.text);
      if (change.ignore) return;
      if (change.completedText) {
        flushScannerInput(change.completedText, true);
        if (native.text.startsWith(change.completedText)) {
          consumedNativePrefixRef.current += change.completedText;
        }
      }
      const text = change.text;
      pendingNativeSubmitTextRef.current = change.confirmed ? text : null;
      // 清除之前的定时器（每次输入都重置）
      cancelScanSubmit(autoSubmitTimerRef);
      const revision = ++scannerInputRevisionRef.current;
      const sessionId = pageSessionRef.current;
      if (pendingNativeSubmitTextRef.current !== text) pendingNativeSubmitTextRef.current = null;

      liveInputValueRef.current = text;
      setInputValue(text);

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        const normalizedOrderText = normalizeOrderNoCandidate(text);
        const shouldFastSubmitOrder =
          (Boolean(getErpAccountByOutboundOrderNo(normalizedOrderText)) ||
            getMatchingOutboundWarehouseOrderRules(
              normalizedOrderText,
              outboundWarehouseOrderRules
            ).length > 0 ||
            (Object.keys(outboundWarehouseOrderRules).length === 0 &&
              isOutboundOrderNo(normalizedOrderText, outboundOrderRule)));

        // 明确收到完整订单的 LF/CRLF 后立即提交。CR 单字符继续走 Enter 或防抖，
        // 避免扫码器分开发送 CR 与 CRLF 时产生两次立即提交。物料原码保持不变。
        if (shouldFastSubmitOrder && text.endsWith('\n') &&
            !/[\r\n]/.test(text.replace(/[\r\n]+$/, ''))) {
          flushScannerInput(text);
          return;
        }

        const isCurrent = () => isCurrentSession(sessionId) &&
          scannerInputRevisionRef.current === revision && liveInputValueRef.current === text;
        if (shouldFastSubmitOrder) {
          scheduleScanSubmit(autoSubmitTimerRef, () => {
            if (isCurrent()) flushScannerInput(text);
          }, ORDER_SCAN_FAST_SUBMIT_DEBOUNCE_MS);
        } else {
          scheduleScanSubmitWithCompletionCheck(autoSubmitTimerRef, {
            delay: SCAN_AUTO_SUBMIT_DEBOUNCE_MS,
            minimumQuietMs: MATERIAL_SCAN_QUIET_MS,
            isConfirmed: () => pendingNativeSubmitTextRef.current === text,
            isCurrent,
            shouldWaitForMore: async () => {
              if (pendingNativeSubmitTextRef.current === text) return false;
              const rules = activeRulesRef.current ?? await getActiveRules();
              if (!isCurrent()) return false;
              activeRulesRef.current = rules;
              return shouldWaitForQRCodeContinuation(text, rules);
            },
            submit: () => flushScannerInput(text),
          });
        }
        return;
      }
    },
    [flushScannerInput, isCurrentSession, outboundOrderRule, outboundWarehouseOrderRules]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback((event?: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    const nativeText = event?.nativeEvent.text;
    const native = typeof nativeText === 'string' ? resolveScannerTextAfterConsumedPrefix(
      consumedNativePrefixRef.current, nativeText, liveInputValueRef.current
    ) : undefined;
    if (native && 'ignore' in native && native.ignore) return;
    const pending = resolvePendingScannerSubmit(liveInputValueRef.current, native?.text);
    if (!pending) return;
    if (pending.advanced || pendingNativeSubmitTextRef.current === pending.text) {
      // 原生回车已收到完整码，JS 的末尾输入回调可能还在路上。
      // 留一个收码周期合并这些回调，避免无追溯码包装被保存两次。
      pendingNativeSubmitTextRef.current = pending.text;
      handleInputChange(pending.text, true);
      return;
    }
    flushScannerInput(pending.text);
  }, [flushScannerInput, handleInputChange]);

  const closePendingOutboundUnpack = useCallback(() => {
    if (outboundUnpackingRef.current) {
      return;
    }
    scannerFocusBlockedRef.current = false;
    pendingOutboundUnpackRef.current = null;
    setPendingOutboundUnpack(null);
    setOutboundUnpackNotes('');
    setOutboundUnpacking(false);
    resumePendingScanCodes(120);
  }, [resumePendingScanCodes]);

  const handleConfirmOutboundUnpack = useCallback(async () => {
    const sessionId = pageSessionRef.current;
    const pending = pendingOutboundUnpackRef.current;
    if (!pending || outboundUnpackingRef.current) {
      return;
    }

    const { savedPayload } = pending;
    const warehouse = {
      id: savedPayload.warehouseId,
      name: savedPayload.warehouseName,
    };

    if (!warehouse.id || !savedPayload.orderNo) {
      showToast('拆包数据缺少订单或仓库信息', 'error');
      void feedbackError('拆包信息不完整，请查看提示');
      return;
    }

    const materialId = pending.materialId || generateId();
    let unpackSaved = false;
    let orderJustCompleted = false;
    let pendingPrintPairId: string | null = null;
    const unpackOperation = {};
    unpackOperationRef.current = unpackOperation;
    outboundUnpackingRef.current = true;
    setOutboundUnpacking(true);

    try {
      let voucher = erpVoucherRef.current;
      if (!isCurrentSession(sessionId) || orderNoRef.current !== savedPayload.orderNo ||
          currentWarehouseRef.current?.id !== warehouse.id ||
          orderMaterialsKeyRef.current !== buildOrderMaterialsKey(savedPayload.orderNo, warehouse.id)) {
        throw new Error('订单或已扫记录发生变化，请取消拆包后重新扫描');
      }
      if (!voucher || !isErpVoucherVerified(voucher)) {
        const refreshed = await forceRefreshErpVoucherForOrder(savedPayload.orderNo, warehouses, {
          clearOnFailure: false,
        });
        if (!isCurrentSession(sessionId)) return;
        if (!refreshed) throw new Error(erpVerificationErrorRef.current || 'ERP核验失败，尚未保存拆包');
        voucher = refreshed.voucher;
      }
      if (currentWarehouseRef.current?.id !== warehouse.id || orderNoRef.current !== savedPayload.orderNo ||
          orderMaterialsKeyRef.current !== buildOrderMaterialsKey(savedPayload.orderNo, warehouse.id)) {
        throw new Error('ERP仓库发生变化，请取消拆包后重新扫描');
      }
      const progress = buildOutboundProgress(voucher.lines, scanRecordsRef.current);
      const line = progress.find((item) => item.inventoryCode === normalizeInventoryCode(savedPayload.inventoryCode));
      if (!line || progress.some((item) => ['unmatched', 'invalid', 'over'].includes(item.status)) ||
          line.remainingQuantity !== pending.shippedQuantity) {
        throw new Error('ERP需求或已扫数量已变化，请取消拆包后重新扫描');
      }
      savedPayload.customerName = voucher.customerName.trim();
      setActiveCustomerName(savedPayload.customerName);
      const materialRecord = mapQueueItemToMaterialRecord(
        materialId,
        savedPayload,
        pending.rawContent
      );
      const resolvedNewTraceNo =
        pending.newTraceNo || (await buildNextUnpackTraceNo(savedPayload.traceNo));
      const unpackResult = await saveUnpackOperation({
        operationId: `outbound-unpack:${materialId}`,
        material: materialRecord,
        createMaterial: {
          material: {
            id: materialId,
            order_no: savedPayload.orderNo,
            customer_name: savedPayload.customerName || '',
            operation_type: 'outbound',
            model: savedPayload.model || '',
            batch: savedPayload.batch || '',
            quantity: pending.originalQuantity,
            traceNo: savedPayload.traceNo,
            sourceNo: savedPayload.sourceNo,
            package: savedPayload.package,
            version: savedPayload.version,
            productionDate: savedPayload.productionDate,
            raw_content: pending.rawContent,
            separator: savedPayload.separator,
            rule_id: savedPayload.ruleId,
            rule_name: savedPayload.ruleName,
            customFields: savedPayload.customFields,
            scanned_at: getISODateTime(),
            warehouse_id: warehouse.id,
            warehouse_name: warehouse.name,
            inventory_code: savedPayload.inventoryCode || '',
            erp_account_key: voucher.accountKey,
          },
          customerName: savedPayload.customerName || '',
          warehouse,
        },
        shippedQuantity: pending.shippedQuantity,
        remainingQuantity: pending.remainingQuantity,
        newTraceNo: resolvedNewTraceNo,
        notes: outboundUnpackNotes,
      });
      unpackSaved = true;
      pendingPrintPairId = unpackResult.pairId;
      if (pending.recoveryItem) await scanQueue.acknowledgeRecovered(pending.recoveryItem.id, materialId);
      if (!isCurrentSession(sessionId)) {
        void submitPrintTask(unpackResult.pairId, savedPayload.orderNo, warehouse.id, sessionId);
        return;
      }
      if (pending.recoveryItem) setLegacyReviewItems(await scanQueue.restoreForReview());
      const shippedScanItem = mapQueueItemToMaterialItem(materialId, {
        ...savedPayload,
        quantity: pending.shippedQuantity.toString(),
        traceNo: unpackResult.shippedRecord.new_traceNo || savedPayload.traceNo,
      });

      await saveOutboundWorkDraft(savedPayload.orderNo, savedPayload.customerName || '', warehouse);
      if (!isCurrentSession(sessionId)) return;
      if (savedPayload.orderNo === orderNoRef.current) {
        const recordsBeforeRefresh = scanRecordsRef.current;
        let refreshedItems: MaterialItem[] = [];
        try {
          refreshedItems = await loadOrderMaterials(savedPayload.orderNo, warehouse.id);
        } catch (refreshError) {
          logger.warn('[扫码出库] 拆包完成后刷新本单物料失败:', refreshError);
        }
        if (!isCurrentSession(sessionId)) return;
        const mergedRecords = mergeMaterialItemsById([
          shippedScanItem,
          ...recordsBeforeRefresh,
          ...refreshedItems,
        ]);
        scanRecordsRef.current = mergedRecords;
        setScanRecords(mergedRecords);
        orderJustCompleted = !isOutboundOrderComplete(voucher.lines, recordsBeforeRefresh) &&
          isOutboundOrderComplete(voucher.lines, mergedRecords);
      }

      scannerFocusBlockedRef.current = false;
      pendingOutboundUnpackRef.current = null;
      setPendingOutboundUnpack(null);
      setOutboundUnpackNotes('');
      setOutboundUnpacking(false);
      showToast(
        orderJustCompleted
          ? `拆包完成：出库 ${pending.shippedQuantity}，本单已扫完，可扫描下一单`
          : `拆包完成：出库 ${pending.shippedQuantity}，剩余 ${pending.remainingQuantity}`,
        'success'
      );
      void (orderJustCompleted ? feedbackOutboundOrderComplete(true) : feedbackUnpackComplete());
      resumePendingScanCodes(120, sessionId);
    } catch (error) {
      if (!isCurrentSession(sessionId)) return;
      if (unpackSaved) {
        pausePendingScans();
        orderMaterialsKeyRef.current = null;
        setOrderMaterialsReady(false);
        try { await loadOrderMaterials(savedPayload.orderNo, warehouse.id); }
        catch (reloadError) { logger.warn('[扫码出库] 已拆包后数量恢复失败，保持暂停:', reloadError); }
        if (!isCurrentSession(sessionId)) return;
      }
      logger.error('[扫码出库] 拆包出库失败:', error);
      const message = formatUserFacingErrorMessage(error, '请稍后重试');
      showToast(
        unpackSaved ? `拆包已完成，但后续处理失败：${message}` : `拆包失败：${message}`,
        unpackSaved ? 'warning' : 'error'
      );
      if (unpackSaved) {
        scannerFocusBlockedRef.current = false;
        pendingOutboundUnpackRef.current = null;
        setPendingOutboundUnpack(null);
        setOutboundUnpackNotes('');
        void feedbackWarning('拆包已保存，请查看提示');
        resumePendingScanCodes(120, sessionId);
      } else {
        void feedbackError('拆包失败，请查看提示');
      }
    } finally {
      // 只释放这次拆包拥有的操作锁，不解除后来的操作。
      if (unpackOperationRef.current === unpackOperation) {
        unpackOperationRef.current = null;
        outboundUnpackingRef.current = false;
        setOutboundUnpacking(false);
      }
    }

    if (pendingPrintPairId) void submitPrintTask(pendingPrintPairId, savedPayload.orderNo, warehouse.id, sessionId);
  }, [
    forceRefreshErpVoucherForOrder,
    isCurrentSession,
    isErpVoucherVerified,
    loadOrderMaterials,
    outboundUnpackNotes,
    pausePendingScans,
    resumePendingScanCodes,
    saveOutboundWorkDraft,
    setActiveCustomerName,
    showToast,
    submitPrintTask,
    warehouses,
  ]);

  // 选择仓库
  const selectWarehouse = async (wh: Warehouse) => {
    if (processingRef.current) {
      showToast('正在处理扫码，请稍后切换仓库', 'warning');
      return;
    }

    // 如果选择的是当前仓库，直接关闭弹窗
    if (wh.id === currentWarehouse?.id) {
      setShowWarehousePicker(false);
      return;
    }

    const switchWarehouse = async () => {
      const switched = await handleWarehouseChange(wh);
      if (!switched) {
        return;
      }
      scannerFocusBlockedRef.current = false;
      setShowWarehousePicker(false);
      showToast(`仓库已切换：${wh.name}`, 'success');
      focusScannerInput(100);
    };

    const hasActiveOutboundWork =
      !!orderNoRef.current || customerNameRef.current.trim().length > 0 || scanRecords.length > 0;

    if (hasActiveOutboundWork) {
      alert.showAlert(
        '确认切换仓库',
        `切换到【${wh.name}】并清空当前作业显示，已保存记录保留。${pendingScanCodesRef.current.length > 0 ? `还有 ${pendingScanCodesRef.current.length} 条未处理扫码，切换后需要重扫。` : ''}`,
        [{ text: '取消', style: 'cancel' }, { text: '切换仓库', onPress: () => { void switchWarehouse(); } }],
        'warning'
      );
      return;
    }

    await switchWarehouse();
  };

  const requestBack = useCallback((proceed?: () => void) => {
    if (showWarehousePicker) {
      setShowWarehousePicker(false);
      return;
    }
    if (outboundUnpackingRef.current || (processingRef.current && !isErpOrderLoading)) {
      notifyToast('正在保存扫码，请处理完成后返回', 'warning');
      return;
    }
    const pendingCount = pendingScanCodesRef.current.length;
    if (pendingCount > 0 || isErpOrderLoading || pendingOutboundUnpackRef.current) {
      alertRef.current.showAlert('确认离开出库',
        `已保存数据保留。${pendingCount > 0 ? `还有 ${pendingCount} 条未处理扫码，离开后需要重新扫描。` : '当前订单仍在加载或待确认拆包，返回后请重新核对。'}`,
        [{ text: '留在此页' }, { text: '离开出库', onPress: () => {
          clearPendingScans();
          pendingOutboundUnpackRef.current = null;
          setPendingOutboundUnpack(null);
          pageSessionRef.current += 1;
          screenActiveRef.current = false;
          processingRef.current = false;
          if (proceed) proceed();
          else setLeaveApproved(true);
        } }], 'warning');
      return;
    }
    if (proceed) proceed();
    else routerRef.current.back();
  }, [clearPendingScans, isErpOrderLoading, notifyToast, showWarehousePicker]);

  useConfirmedRouteExit(
    !leaveApproved && (outboundUnpacking || scanProcessing || pendingScanCount > 0 || isErpOrderLoading || Boolean(pendingOutboundUnpack) || showWarehousePicker),
    requestBack,
  );

  useEffect(() => {
    if (!leaveApproved) return;
    routerRef.current.back();
    setLeaveApproved(false);
  }, [leaveApproved]);

  useLayoutEffect(() => { requestBackRef.current = requestBack; }, [requestBack]);

  const recoverLegacyItem = useCallback(async (item: QueueItem) => {
    if (processingRef.current || initializingRef.current || pendingOutboundUnpackRef.current || initializationError) {
      notifyToast('请等待当前操作完成后核对历史扫码', 'warning');
      return;
    }
    if (item.requiresManualReview) {
      alertRef.current.showAlert('请先核对这笔历史扫码',
        `${item.reviewReason || '无法确认这笔无追溯码记录是否已保存。'}\n请先查看原订单数量。确认已保存可移除待核对项；确认未保存请移除后重新扫码。此操作不删除业务明细。`,
        [{ text: '取消', style: 'cancel' }, { text: '查看原订单', onPress: () => {
          setShowLegacyReview(false);
          scannerFocusBlockedRef.current = false;
          void processScanRef.current(item.parsed.orderNo);
        } }, { text: '已核对，移除待核对', onPress: () => {
          void (async () => {
            await scanQueue.discardReviewed(item.id);
            if (screenActiveRef.current) setLegacyReviewItems(await scanQueue.restoreForReview());
          })().catch((error) => notifyToast(formatUserFacingErrorMessage(error, '历史扫码处理失败'), 'error'));
        } }], 'warning');
      return;
    }
    const sessionId = pageSessionRef.current;
    pausePendingScans();
    setShowLegacyReview(false);
    scannerFocusBlockedRef.current = false;
    await processScanRef.current(item.parsed.orderNo);
    if (!isCurrentSession(sessionId) || orderNoRef.current !== item.parsed.orderNo ||
        !erpVoucherRef.current || !isErpVoucherVerified(erpVoucherRef.current)) return;
    // 手动恢复在同一处理链内继续；旁边的实时扫码仍保持暂停，不会跨订单混写。
    if (postProcessTimerRef.current) clearTimeout(postProcessTimerRef.current);
    postProcessTimerRef.current = null;
    processingRef.current = false;
    await processScanRef.current(item.scanData, {
      materialId: getRecoveryMaterialId(item), expectedOrderNo: item.parsed.orderNo, recoveryItem: item,
    });
  }, [initializationError, isCurrentSession, isErpVoucherVerified, notifyToast, pausePendingScans]);

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title={isSalesReturn ? '销售退货验收' : '出库扫描'}
            onBack={() => requestBack()}
            rightIcon={initializationError || erpVoucher || erpVoucherRecoveryRequired || legacyReviewError || legacyReviewItems.length > 0 ? 'refresh-cw' : 'crosshair'}
            rightLabel={
              initializationError ? '重新加载出库数据' : erpVoucher || erpVoucherRecoveryRequired ? '刷新ERP销售出库单'
                : legacyReviewError || legacyReviewItems.length > 0 ? '查看历史待核对' : '聚焦扫码输入框'
            }
            rightDisabled={isErpOrderLoading}
            onRightPress={() => {
              if (initializationError) {
                reloadOutbound();
                return;
              }
              if (erpVoucher || erpVoucherRecoveryRequired) {
                legacyPromptSessionRef.current = -1;
                printFailureNoticeRef.current = '';
                void handleRefreshErpVoucher();
                return;
              }
              if (legacyReviewError || legacyReviewItems.length > 0) {
                setShowLegacyReview(true);
                return;
              }
              focusScannerInput(0);
            }}
          />

          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        {/* 扫码输入 */}
        <WarehouseScanInput
          inputRef={inputRef}
          active={inputValue.length > 0 || isErpOrderLoading}
          processing={isErpOrderLoading}
          acceptInputWhileProcessing={!initializationError}
          editable={!initializationError}
          statusLabel={currentScanStatusLabel}
          value={inputValue}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSubmitEditing}
          placeholder={currentScanPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={!showWarehousePicker && !pendingOutboundUnpack && !alert.visible && !showLegacyReview && !showPrintTasks}
          showSoftInputOnFocus={false}
          actionLabel={isSalesReturn ? '提交退货扫码内容' : '提交出库扫码内容'}
          actionLoading={isErpOrderLoading}
          onActionPress={() => {
            if (inputValue.trim()) {
              handleSubmitEditing();
              return;
            }
            if (queuePausedRef.current && pendingScanCodesRef.current.length > 0) {
              promptPendingScans();
              return;
            }
            focusScannerInput(0);
          }}
        />

        {isErpOrderComplete ? (
          <View style={styles.completionBanner}>
            <Feather name="check-circle" size={18} color={theme.success} />
            <Text style={styles.completionBannerText}>
              {isSalesReturn ? '本单退货已全部收齐，已收物料可再次出库' : '本单物料已全部扫完，请扫描下一张出库单'}
            </Text>
          </View>
        ) : null}

        {/* 物料列表 */}
        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>本单物料</Text>
            <Text style={styles.listCount}>
              {erpVoucher
                ? `${erpLineProgressItems.length} 明细 / ${aggregateTotals.totalQuantity.toLocaleString()}/${erpRequiredTotal.toLocaleString()} PCS`
                : `${aggregateTotals.modelCount} 型号 / ${aggregateTotals.totalQuantity.toLocaleString()} PCS`}
            </Text>
          </View>
          {erpVoucher ? (
            <FlatList
              data={erpLineProgressItems}
              keyExtractor={erpLineKeyExtractor}
              renderItem={renderErpLineProgress}
              extraData={expandedGroups}
              style={styles.list}
              contentContainerStyle={
                erpLineProgressItems.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              initialNumToRender={12}
              maxToRenderPerBatch={16}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <AppEmptyState
                  icon="package"
                  title="ERP单据无明细"
                  description="请确认销售出库单是否已有物料行"
                  compact
                  style={styles.empty}
                />
              }
            />
          ) : (
            <FlatList
              data={aggregateMaterials}
              keyExtractor={aggregatedGroupKeyExtractor}
              renderItem={renderAggregatedGroup}
              extraData={expandedGroups}
              style={styles.list}
              contentContainerStyle={
                scanRecords.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              initialNumToRender={12}
              maxToRenderPerBatch={16}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <AppEmptyState
                  icon="package"
                  title={!orderNo ? '等待出库单' : '暂无物料'}
                  description={!orderNo ? '先扫描销售出库单号' : '继续扫描物料二维码'}
                  compact
                  style={styles.empty}
                />
              }
            />
          )}
        </View>

        {showLegacyReview ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setShowLegacyReview(false)}>
            <View style={styles.modalOverlay}>
              <AppModalCard title="历史扫码待核对" subtitle="先核对原订单，再按当前规则恢复；不会自动补写"
                size="list" stretchBody={false} onClose={() => setShowLegacyReview(false)}>
                <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.listContent}>
                  {legacyReviewError ? (
                    <View style={styles.erpLineDetails}>
                      <Text style={[styles.detailText, { color: theme.warning }]}>{legacyReviewError}</Text>
                      <Text style={styles.detailText}>原始历史缓存已保留，新扫码不受影响。同步和备份前需要先核对这些历史记录。</Text>
                      <UiToolbarButton label="重新读取历史缓存" icon="refresh-cw" compact onPress={() => {
                        const sessionId = pageSessionRef.current;
                        void scanQueue.restoreForReview().then((items) => {
                          if (!isCurrentSession(sessionId)) return;
                          setLegacyReviewItems(items);
                          setLegacyReviewError(null);
                        }).catch((error) => {
                          if (isCurrentSession(sessionId)) setLegacyReviewError(formatUserFacingErrorMessage(error, '历史缓存仍未恢复'));
                        });
                      }} />
                    </View>
                  ) : null}
                  {legacyReviewItems.map((item) => (
                    <View key={item.id} style={styles.erpLineCard}>
                      <View style={styles.erpLineDetails}>
                        <Text style={styles.erpLineCode}>{item.parsed.model || '未识别型号'} · {item.parsed.quantity || '—'}</Text>
                        <Text style={styles.detailText}>订单：{item.parsed.orderNo} · 仓库：{item.parsed.warehouseName || '待核对'}</Text>
                        <Text style={styles.detailText}>追溯码：{item.parsed.traceNo || '无追溯码'}</Text>
                        {item.reviewReason || item.errorMessage ? (
                          <Text style={[styles.detailText, { color: theme.warning }]}>{item.reviewReason || item.errorMessage}</Text>
                        ) : null}
                        <UiToolbarButton label={item.requiresManualReview ? '人工核对' : '重新校验'} icon="refresh-cw" compact
                          disabled={scanProcessing || isErpOrderLoading || Boolean(pendingOutboundUnpack)}
                          onPress={() => { void recoverLegacyItem(item).catch((error) => notifyToast(formatUserFacingErrorMessage(error, '历史扫码恢复失败'), 'error')); }} />
                      </View>
                    </View>
                  ))}
                  {legacyReviewItems.length === 0 && !legacyReviewError ? <AppEmptyState title="暂无待核对扫码" description="历史记录已处理" icon="check-circle" compact /> : null}
                </ScrollView>
              </AppModalCard>
            </View>
          </Modal>
        ) : null}

        {showPrintTasks ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setShowPrintTasks(false)}>
            <View style={styles.modalOverlay}>
              <AppModalCard title="拆包标签任务" subtitle="任务回执由同步助手提供，请核对标签是否实际出纸"
                size="list" stretchBody={false} onClose={() => setShowPrintTasks(false)}>
                <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.listContent}>
                  {printTasks.map((task) => {
                    const label = task.status === 'submitted' ? '已提交同步助手' : task.status === 'skipped' ? '按策略跳过'
                      : task.status === 'failed' ? '失败待处理' : task.status === 'submitting' ? '正在提交' : '待提交';
                    const canRetry = task.status === 'pending' || task.status === 'failed';
                    const inFlight = retryingPrintTask === task.pair_id || isUnpackPrintTaskInFlight(task.pair_id);
                    return (
                      <View key={task.pair_id} style={styles.erpLineCard}>
                        <View style={styles.erpLineDetails}>
                          <Text style={styles.erpLineCode}>{task.model || '拆包标签'}</Text>
                          <Text style={[styles.detailText, { color: task.status === 'failed' ? theme.warning : theme.textSecondary }]}>{label} · 尝试 {task.attempt_count} 次</Text>
                          {task.shipped_quantity != null ? <Text style={styles.detailText}>出库 {task.shipped_quantity} / 剩余 {task.remaining_quantity}</Text> : null}
                          {task.remainder_traceNo ? <Text style={styles.detailText}>剩余追溯码：{task.remainder_traceNo}</Text> : null}
                          <Text style={styles.detailText}>更新时间：{formatPrintTaskTime(task.updated_at)}</Text>
                          {task.last_error || task.last_message ? <Text style={styles.detailText}>{task.last_error || task.last_message}</Text> : null}
                          {canRetry ? <UiToolbarButton label={inFlight ? '正在提交...' : '核对后重试'} icon="printer" compact disabled={inFlight}
                            onPress={() => {
                              const taskSessionId = pageSessionRef.current;
                              alertRef.current.showAlert('重试标签任务',
                                `请先核对 ${task.model || '这笔拆包'} 的标签是否已出纸。确认仍需处理后，将重新提交原任务。`,
                                [{ text: '取消', style: 'cancel' }, { text: '核对并提交', onPress: () => {
                                  void submitPrintTask(task.pair_id, task.order_no, task.warehouse_id,
                                    taskSessionId, { closeOnSuccess: true, retryConfirmed: true });
                                } }], 'warning');
                            }} /> : null}
                        </View>
                      </View>
                    );
                  })}
                  {printTasks.length === 0 ? <AppEmptyState title="暂无标签任务" description="本单拆包后会保存标签处理任务" icon="printer" compact /> : null}
                </ScrollView>
              </AppModalCard>
            </View>
          </Modal>
        ) : null}

        {/* 仓库选择器 */}
        {showWarehousePicker && (
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerBox}>
              <Text style={styles.pickerTitle}>选择仓库</Text>
              {warehouses.map((wh) => (
                <TouchableOpacity
                  key={wh.id}
                  style={[
                    styles.pickerItem,
                    currentWarehouse?.id === wh.id && styles.pickerItemActive,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => selectWarehouse(wh)}
                >
                  <Text style={styles.pickerItemText}>{wh.name}</Text>
                  {currentWarehouse?.id === wh.id && (
                    <FontAwesome6 name="check" size={14} color={theme.primary} />
                  )}
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.pickerClose}
                onPress={() => setShowWarehousePicker(false)}
              >
                <Text style={styles.pickerCloseText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Modal
          visible={!!pendingOutboundUnpack}
          transparent
          animationType="fade"
          onRequestClose={closePendingOutboundUnpack}
        >
          <View style={styles.modalOverlay}>
            <AppModalCard
              title="拆包出库"
              subtitle="按本单剩余数量拆出，并生成剩余标签"
              onClose={closePendingOutboundUnpack}
              style={styles.outboundUnpackModalContent}
              bodyStyle={styles.modalBody}
              size="largeForm"
              stretchBody
              footer={
                <AppModalActions
                  containerStyle={styles.modalActions}
                  secondaryLabel="取消"
                  onSecondaryPress={outboundUnpacking ? undefined : closePendingOutboundUnpack}
                  primaryLabel={outboundUnpacking ? '处理中...' : '确认拆包'}
                  primaryDisabled={outboundUnpacking}
                  onPrimaryPress={handleConfirmOutboundUnpack}
                />
              }
            >
              <KeyboardAwareFormScrollView
                contentContainerStyle={styles.outboundUnpackBodyContent}
                bottomOffset={32}
                showsVerticalScrollIndicator
              >
                <AppFormField label="型号">
                  <View style={[styles.unpackTextInput, styles.readOnlyInputContent]}>
                    <Text style={styles.unpackReadOnlyText} numberOfLines={2}>
                      {pendingOutboundUnpack?.savedPayload.model || '-'}
                    </Text>
                  </View>
                </AppFormField>

                <AppFormField label="规格/型号描述">
                  <View style={[styles.unpackTextInput, styles.readOnlyInputContent]}>
                    <Text style={styles.unpackReadOnlyText} numberOfLines={3}>
                      {pendingOutboundUnpack?.lineSpecification || '-'}
                    </Text>
                  </View>
                </AppFormField>

                <View style={styles.unpackQuantityGrid}>
                  <View style={styles.unpackQuantityCell}>
                    <Text style={styles.unpackQuantityLabel}>当前标签</Text>
                    <Text style={styles.unpackQuantityValue}>
                      {pendingOutboundUnpack?.originalQuantity.toLocaleString() || '0'}
                    </Text>
                  </View>
                  <View style={styles.unpackQuantityCell}>
                    <Text style={styles.unpackQuantityLabel}>本单出库</Text>
                    <Text style={styles.unpackQuantityValuePrimary}>
                      {pendingOutboundUnpack?.shippedQuantity.toLocaleString() || '0'}
                    </Text>
                  </View>
                  <View style={styles.unpackQuantityCell}>
                    <Text style={styles.unpackQuantityLabel}>剩余标签</Text>
                    <Text style={styles.unpackQuantityValue}>
                      {pendingOutboundUnpack?.remainingQuantity.toLocaleString() || '0'}
                    </Text>
                  </View>
                </View>

                <AppFormField label="新追踪码（自动生成）">
                  <View style={[styles.unpackTextInput, styles.readOnlyInputContent]}>
                    <Text style={styles.unpackTraceText} numberOfLines={2}>
                      {pendingOutboundUnpack?.newTraceNo || '-'}
                    </Text>
                  </View>
                </AppFormField>

                <AppFormField label="备注">
                  <TextInput
                    style={[styles.unpackTextInput, styles.unpackNotesInput]}
                    placeholder="可填写拆包原因"
                    placeholderTextColor={theme.textMuted}
                    value={outboundUnpackNotes}
                    onChangeText={setOutboundUnpackNotes}
                    multiline
                  />
                </AppFormField>
              </KeyboardAwareFormScrollView>
            </AppModalCard>
          </View>
        </Modal>
        <ToastContainer />
        {alert.AlertComponent}
      </View>
    </Screen>
  );
}
