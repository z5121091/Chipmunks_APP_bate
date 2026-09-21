import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, Platform, Modal } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';
import { parseQuantity } from '@/utils/quantity';
import { isQRCode } from '@/utils/qrcodeParser';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AggregatedRecordItem } from '@/components/AggregatedRecordItem';
import { AppFormField } from '@/components/AppFormField';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { UiPageHeader, UiWorkflowSummary } from '@/components/UiRedesign';
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
  deleteMaterial,
  generateId,
  saveUnpackOperation,
  type MaterialRecord,
  type UnpackRecord,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
} from '@/utils/database';
import { scanQueue, QueueItem, QueueItemParsedPayload } from '@/utils/scanQueue';
import { STORAGE_KEYS } from '@/constants/config';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import {
  feedbackSuccess,
  feedbackError,
  feedbackWarning,
  feedbackDuplicate,
  feedbackNewOrder,
  feedbackSwitchOrder,
  feedbackNotBound,
  feedbackNotInOrder,
  feedbackOverQuantity,
  feedbackOutboundOrderComplete,
  feedbackUnpackRequired,
  feedbackUnpackComplete,
  initSoundSetting,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { getISODateTime } from '@/utils/time';
import {
  cancelScanSubmit,
  scheduleScanSubmit,
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
  syncUnpackRecordsToComputer,
} from '@/utils/unpackWorkflow';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';
import {
  buildOutboundProgress,
  isOutboundOrderComplete,
  isOutboundVerificationFresh,
  normalizeOutboundInventoryCode as normalizeInventoryCode,
  type OutboundLineProgress,
} from '@/utils/outboundProgress';

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

const loadSaleDispatchVoucher = async (
  account: ErpAccountConfig,
  voucherCode: string,
  options: { bypassProxyCache?: boolean; forceRefresh?: boolean } = {}
): Promise<{ fromCache: boolean; voucher: SaleDispatchVoucher }> => {
  if (!options.forceRefresh) {
    const cachedVoucher = await loadCachedErpVoucher(account.key, voucherCode);
    if (cachedVoucher) {
      return {
        fromCache: true,
        voucher: cachedVoucher,
      };
    }
  }

  const voucher = await fetchSaleDispatchVoucher(account, voucherCode, {
    bypassCache: options.bypassProxyCache,
  });
  saveCachedErpVoucher(voucher).catch((error) => {
    logger.warn('[扫码出库] 保存ERP单据缓存失败:', error);
  });

  return {
    fromCache: false,
    voucher,
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
});

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
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const liveInputValueRef = useRef('');
  const pendingScanCodesRef = useRef<string[]>([]);
  const processScanRef = useRef<(code: string) => void>(() => undefined);
  const scannerFocusBlockedRef = useRef(false);
  const orderNoRef = useRef(''); // 🔥 添加 orderNoRef，用于批量写入时判断是否需要刷新
  const customerNameRef = useRef('');
  const currentWarehouseRef = useRef<Warehouse | null>(null);
  const savedOutboundDraftRef = useRef<string | null>(null);
  const orderMaterialsKeyRef = useRef<string | null>(null);
  const [orderMaterialsReady, setOrderMaterialsReady] = useState(false);
  const activeRulesRef = useRef<Awaited<ReturnType<typeof getActiveRules>> | null>(null);
  const inventoryBindingsRef = useRef(new Map<string, string>());
  const loadOutboundStateRef = useRef<
    (warehouseList: Warehouse[], explicitWarehouse: Warehouse | null) => Promise<void>
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
    orderMaterialsKeyRef.current = null;
    setOrderMaterialsReady(false);
    orderNoRef.current = nextOrderNo;
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

  const markErpVoucherVerified = useCallback((voucher: SaleDispatchVoucher) => {
    verifiedErpVoucherRef.current = voucher;
    setVerifiedErpVoucher(voucher);
    erpVerifiedAtRef.current = Date.now();
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
  const { showToast, ToastContainer } = useToast();
  const currentScanStep = !orderNo ? 'order' : 'material';
  const currentScanPlaceholder = isErpOrderLoading
    ? '正在查询ERP单据...'
    : orderNo && !orderMaterialsReady
      ? '本单记录未加载，请重新扫描订单或点击刷新'
    : erpVoucherRecoveryRequired
      ? 'ERP单据未验证，请重新扫描订单或点击刷新'
    : currentScanStep === 'order'
      ? '先扫描订单号'
      : '继续扫描物料二维码';
  const currentScanStatusLabel = isErpOrderLoading
    ? '正在读取ERP单据'
    : orderNo && !orderMaterialsReady
      ? '本单记录需要恢复'
    : erpVoucherRecoveryRequired
      ? 'ERP单据需要验证'
    : currentScanStep === 'order'
      ? '等待出库单号'
      : '物料扫码录入';

  useEffect(() => {
    scannerFocusBlockedRef.current = showWarehousePicker || !!pendingOutboundUnpack || alert.visible;
  }, [alert.visible, pendingOutboundUnpack, showWarehousePicker]);

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
    (delay = 0) => {
      if (postProcessTimerRef.current) {
        clearTimeout(postProcessTimerRef.current);
      }
      postProcessTimerRef.current = setTimeout(() => {
        postProcessTimerRef.current = null;
        processingRef.current = false;
        if (!screenActiveRef.current || pendingOutboundUnpackRef.current) {
          return;
        }

        const nextPendingCode = pendingScanCodesRef.current.shift();
        if (nextPendingCode) {
          processScanRef.current(nextPendingCode);
          return;
        }

        focusScannerInput(0);
      }, pendingScanCodesRef.current.length > 0 ? 0 : delay);
    },
    [focusScannerInput]
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
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT, serializedDraft),
          AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, draft.orderNo),
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
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT),
        AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO),
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

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      processingRef.current = true;
      setIsErpOrderLoading(true);
      orderMaterialsKeyRef.current = null;
      setOrderMaterialsReady(false);
      activeRulesRef.current = null;
      inventoryBindingsRef.current.clear();
      markErpVoucherUnverified();
      let isActive = true;

      const init = async () => {
        let unsubscribe: (() => void) | null = null;
        let queueStarted = false;

        try {
          // 1. 设置批量写入函数（数据库写入前强制等待数据库初始化）
          scanQueue.setBatchWriteFunction(async (items: QueueItem[]) => {
            logger.log('[ScanQueue] ===== 批量写入开始 =====');
            logger.log('[ScanQueue] 批量数量:', items.length);

            // 🔥 限制每次批量写入的数量，防止突然扫太多导致卡顿
            const itemsToProcess = items.slice(0, 10);
            logger.log('[ScanQueue] 限制后数量:', itemsToProcess.length);

            // 🔥 强制等待数据库初始化，确保数据库一定 ready
            logger.log('[ScanQueue] 等待数据库初始化...');
            await initDatabase();
            logger.log('[ScanQueue] 数据库初始化完成');

            const success: boolean[] = [];
            const materialIds: string[] = [];
            const errors: (string | null)[] = [];
            const appendedItems: MaterialItem[] = [];

            logger.log('[ScanQueue] 开始处理队列项...');

            for (const item of itemsToProcess) {
              try {
                const parsed: QueueItemParsedPayload = item.parsed;
                const orderNo = parsed.orderNo;
                const warehouseId = parsed.warehouseId;
                const warehouseName = parsed.warehouseName;

                logger.log('[ScanQueue] 处理物料:', {
                  orderNo,
                  model: parsed.model,
                  batch: parsed.batch,
                  warehouseId,
                  warehouseName,
                });

                if (!orderNo || typeof orderNo !== 'string' || orderNo.trim() === '') {
                  throw new Error('订单号为空');
                }

                if (!warehouseId || typeof warehouseId !== 'string' || warehouseId.trim() === '') {
                  logger.error('[ScanQueue] 仓库ID无效，跳过物料:', {
                    warehouseId,
                    warehouseName,
                    currentWarehouse: currentWarehouseRef.current,
                    parsed,
                  });
                  throw new Error('仓库ID无效');
                }

                const duplicateCheck = await checkMaterialExists(
                  orderNo,
                  parsed.model || '',
                  parsed.batch || '',
                  parsed.sourceNo,
                  parsed.traceNo,
                  parsed.quantity,
                  warehouseId
                );
                if (duplicateCheck.material && !duplicateCheck.canRescan) {
                  throw new Error(`已存在相同追踪码：${parsed.traceNo || ''}`);
                }

                // 订单与物料写入放在同一事务中，避免出现半成功状态
                const materialId = await addMaterialWithOrder(
                  {
                    order_no: orderNo,
                    customer_name: parsed.customerName || '',
                    operation_type: 'outbound',
                    model: parsed.model || '',
                    batch: parsed.batch || '',
                    quantity: parseQuantity(parsed.quantity || '1') ?? 1,
                    traceNo: parsed.traceNo,
                    sourceNo: parsed.sourceNo,
                    package: parsed.package,
                    version: parsed.version,
                    productionDate: parsed.productionDate,
                    raw_content: item.scanData,
                    separator: parsed.separator,
                    rule_id: parsed.ruleId,
                    rule_name: parsed.ruleName,
                    customFields: parsed.customFields,
                    scanned_at: getISODateTime(),
                    warehouse_id: warehouseId,
                    warehouse_name: warehouseName,
                    inventory_code: parsed.inventoryCode || '',
                  },
                  parsed.customerName || '',
                  { id: warehouseId, name: warehouseName }
                );

                logger.log('[ScanQueue] 物料添加成功:', materialId);
                logger.log('[ScanQueue] 订单更新成功:', orderNo);

                success.push(true);
                materialIds.push(materialId);
                errors.push(null);

                if (orderNo === orderNoRef.current) {
                  appendedItems.push(mapQueueItemToMaterialItem(materialId, parsed));
                }
              } catch (e) {
                logger.error('[ScanQueue] 批量写入失败:', item.id, e);
                success.push(false);
                materialIds.push('');
                errors.push(e instanceof Error ? e.message : String(e));
              }
            }

            if (appendedItems.length > 0 && screenActiveRef.current) {
              const appendedIds = new Set(appendedItems.map((item) => item.id));
              setScanRecords((prev) => {
                const preservedItems = prev.filter((item) => !appendedIds.has(item.id));
                const nextRecords = [...appendedItems.slice().reverse(), ...preservedItems];
                scanRecordsRef.current = nextRecords;
                return nextRecords;
              });
            }

            return { success, materialIds, errors };
          });

          // 3. 启动队列定时器
          scanQueue.startTimer();
          queueStarted = true;

          // 4. 订阅队列变化（简化订阅，避免重复刷新）
          // 注意：批量写入函数中已经统一刷新 UI，这里只用于显示统计信息
          unsubscribe = scanQueue.subscribe(() => {
            // 队列变化时，只需要更新统计信息，不需要重新加载数据
            // 因为批量写入函数中已经统一刷新了 UI
            const stats = scanQueue.getStats();
            logger.log('[ScanQueue] 队列状态:', stats);
          });

          // 5. 加载仓库列表
          const [list, orderRule, warehouseOrderRules] = await Promise.all([
            getAllWarehouses(),
            loadOutboundOrderRule(),
            loadOutboundWarehouseOrderRules(),
          ]);
          setWarehouses(list);
          setOutboundOrderRule(orderRule);
          setOutboundWarehouseOrderRules(warehouseOrderRules);

          // 6. 恢复之前选择的仓库，并等待状态更新
          let warehouse: Warehouse | null = null;
          const savedWarehouse = await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
          if (savedWarehouse) {
            const saved = safeJsonParseNullable<Warehouse>(
              savedWarehouse,
              'outbound.globalWarehouse'
            );
            // 确保仓库仍然存在
            const latestWarehouse = saved ? list.find((w) => w.id === saved.id) : null;
            if (latestWarehouse) {
              warehouse = latestWarehouse;
              await AsyncStorage.setItem(
                STORAGE_KEYS.GLOBAL_WAREHOUSE,
                JSON.stringify(latestWarehouse)
              );
            }
          }

          // 没有保存的选择，使用默认仓库
          if (!warehouse) {
            const def = await getDefaultWarehouse();
            warehouse = def || list[0] || null;
          }

          // 7. 设置当前仓库
          setActiveWarehouse(warehouse);

          // 8. 加载扫码出库持久化状态（显式传入仓库，避免读取旧闭包）
          await loadOutboundStateRef.current(list, warehouse);

          // 9. 聚焦输入框
          if (isActive) {
            focusScannerInput(100);
          }

          // 返回清理函数
          return () => {
            scanQueue.stopTimer();
            unsubscribe?.();
          };
        } catch (error) {
          logger.error('[扫码出库] 初始化失败:', error);
          if (queueStarted) {
            scanQueue.stopTimer();
          }
          unsubscribe?.();

          if (isActive) {
            showToast('数据库读取失败，请关闭应用后重试', 'error');
            focusScannerInput(300);
          }
          return undefined;
        } finally {
          if (isActive) {
            setIsErpOrderLoading(false);
            resumePendingScanCodes(0);
          }
        }
      };

      const cleanupPromise = init();

      return () => {
        isActive = false;
        screenActiveRef.current = false;
        processingRef.current = false;
        pendingScanCodesRef.current = [];
        cancelScanSubmit(autoSubmitTimerRef);
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
          postProcessTimerRef.current = null;
        }
        // 等待 init 完成，清理订阅
        cleanupPromise
          .then((cleanup) => {
            if (cleanup) cleanup();
          })
          .catch(logger.error);
      };
    }, [focusScannerInput, markErpVoucherUnverified, resumePendingScanCodes, setActiveWarehouse, showToast])
  );

  // 加载扫码出库持久化状态（订单号、仓库、扫码记录）
  const loadOutboundState = useCallback(
    async (warehouseList: Warehouse[], explicitWarehouse: Warehouse | null) => {
      try {
        const list = warehouseList;
        let activeWarehouse = explicitWarehouse;

      // 1. 优先恢复出库作业草稿。草稿只保存现场，实际订单和物料以 SQLite 为准。
      const savedDraft = await loadSavedOutboundWorkDraft();

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
          }

          void (async () => {
            const order = await getOrder(draftOrderNo, savedDraft.warehouseId);
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

            if (!screenActiveRef.current || orderNoRef.current !== draftOrderNo) {
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

            if (workWarehouse.id !== draftWarehouse.id) {
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
      if (!screenActiveRef.current) {
        return;
      }

      if (savedOrderNo) {
        // 验证订单是否存在；如果全局仓库被其他页面改过，不要直接把当前出库作业清掉。
        let order = await getOrder(savedOrderNo, activeWarehouse?.id);
        if (!order && activeWarehouse) {
          order = await getOrder(savedOrderNo);
        }
        if (!screenActiveRef.current) {
          return;
        }

        if (!order) {
          logger.log('[loadOutboundState] 订单不存在，清空订单号:', savedOrderNo);
          await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO);
          if (screenActiveRef.current) {
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
          if (screenActiveRef.current) {
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

        if (!screenActiveRef.current) {
          return;
        }

        setActiveOrderNo(savedOrderNo);
        setActiveCustomerName((order.customer_name || '').trim());

        const restoredErpState = await forceRefreshErpVoucherForOrderRef.current(
          savedOrderNo,
          list
        );
        if (!screenActiveRef.current || orderNoRef.current !== savedOrderNo) {
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
        await loadOrderMaterialsRef.current(savedOrderNo, workWarehouse.id);
      }
      } catch (error) {
        logger.error('[扫码出库] 加载持久化状态失败:', error);
      }
    },
    [
      clearOutboundWorkDraft,
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
    const [draftCleared, recordsCleared] = await Promise.all([
      clearOutboundWorkDraft(),
      clearScanRecords(),
    ]);
    if (!draftCleared || !recordsCleared) {
      showToast('当前出库暂存清理失败，已取消切换仓库', 'error');
      feedbackError();
      return false;
    }

    await AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(warehouse));
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
    pendingScanCodesRef.current = [];
    return true;
  };

  // 清空扫描记录
  const clearScanRecords = async (): Promise<boolean> => {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.OUTBOUND_SCAN_RECORDS,
        LEGACY_OUTBOUND_SCAN_RECORDS_KEY,
      ]);
      return true;
    } catch (error) {
      logger.error('清空扫描记录失败:', error);
      return false;
    }
  };

  const resolveWarehouseForErpVoucher = useCallback(
    (voucher: SaleDispatchVoucher, warehouseList: Warehouse[]) => {
      const expectedNames = [voucher.warehouseName, voucher.expectedWarehouseName].filter(Boolean);

      for (const warehouseName of expectedNames) {
        const matchedWarehouse = warehouseList.find((warehouse) => warehouse.name === warehouseName);
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
      } = {}
    ) => {
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
        const { fromCache, voucher } = await loadSaleDispatchVoucher(account, nextOrderNo, {
          bypassProxyCache,
          forceRefresh,
        });
        if (
          !screenActiveRef.current ||
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
          markErpVoucherVerified(voucher);
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
          !screenActiveRef.current ||
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
      options: { clearOnFailure?: boolean } = {}
    ): Promise<RefreshedErpVoucherState | null> => {
      const account = getErpAccountByOutboundOrderNo(nextOrderNo);
      if (!account) {
        return Promise.resolve(null);
      }

      const refreshKey = buildErpVoucherCacheKey(account.key, nextOrderNo);
      const inFlightRefresh = erpVoucherRefreshRef.current;
      if (inFlightRefresh?.key === refreshKey) {
        return inFlightRefresh.promise;
      }

      markErpVoucherUnverified();
      const refreshPromise = refreshErpVoucherForOrder(nextOrderNo, warehouseList, {
        bypassProxyCache: true,
        clearOnFailure: options.clearOnFailure,
        forceRefresh: true,
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
      if (!refreshed) {
        showToast(
          `${erpVerificationErrorRef.current || 'ERP验证失败'}，已暂停扫码`,
          'warning'
        );
        return;
      }

      const nextCustomerName = refreshed.voucher.customerName.trim();
      await loadOrderMaterialsRef.current(activeOrderNo, refreshed.warehouse.id);
      await upsertOrder(activeOrderNo, nextCustomerName, refreshed.warehouse);
      setActiveCustomerName(nextCustomerName);
      await saveOutboundWorkDraft(
        activeOrderNo,
        nextCustomerName,
        refreshed.warehouse,
        refreshed.voucher
      );
      showToast('ERP销售出库单已刷新', 'success');
    } catch (error) {
      markErpVoucherUnverified();
      setErpVoucherRecoveryRequired(true);
      showToast(formatUserFacingErrorMessage(error, '本单记录恢复失败，请重试'), 'error');
    } finally {
      setIsErpOrderLoading(false);
      resumePendingScanCodes(100);
    }
  }, [
    focusScannerInput,
    forceRefreshErpVoucherForOrder,
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

    let list = (await getMaterialsByOrder(no.trim(), warehouseId.trim())).filter(
      isOutboundVisibleMaterial
    );

    if (
      !screenActiveRef.current ||
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
        !screenActiveRef.current ||
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
      !screenActiveRef.current ||
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
      !screenActiveRef.current ||
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
    return materials;
    },
    [
      saveOutboundWorkDraft,
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
    async (code: string) => {
      const activeOrderNo = orderNoRef.current;
      let activeCustomerName = customerNameRef.current;
      const activeWarehouse = currentWarehouseRef.current;
      let activeErpVoucher = erpVoucherRef.current;
      logger.log('[processScan] 开始处理扫码:', code);
      logger.log('[processScan] 当前订单号:', activeOrderNo);
      logger.log('[processScan] 当前客户名称:', activeCustomerName);
      logger.log('[processScan] 当前仓库:', activeWarehouse ? activeWarehouse.name : 'null');

      if (!code || processingRef.current || pendingOutboundUnpackRef.current) return;

      processingRef.current = true;
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
          if (!isQRCode(code, activeRulesRef.current)) {
            return;
          }
        }
        if (erpVoucherRecoveryRequired && activeOrderNo && !isOrderNoScan) {
          showToast('ERP单据未验证，请重新扫描订单或点击刷新', 'error');
          feedbackError();
          return;
        }
        if (activeErpAccount && !activeErpVoucher && !isOrderNoScan) {
          showToast('ERP单据尚未验证，请重新扫描订单或点击刷新', 'error');
          feedbackError();
          return;
        }
        if (activeOrderNo && !isOrderNoScan &&
            orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, activeWarehouse?.id)) {
          try {
            await loadOrderMaterials(activeOrderNo, activeWarehouse?.id);
          } catch (error) {
            logger.warn('[扫码出库] 扫码前恢复本单记录失败:', error);
          }
          if (!screenActiveRef.current || orderNoRef.current !== activeOrderNo ||
              currentWarehouseRef.current?.id !== activeWarehouse?.id ||
              orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, activeWarehouse?.id)) {
            showToast('本单记录未加载，已暂停扫码。请重新扫描订单或点击刷新', 'error');
            feedbackError();
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
          feedbackError();
          return;
        }

        // 判断是否是订单号格式
        if (isOrderNoScan) {
          if (matchedErpAccount) {
            if (
              activeErpVoucher &&
              normalizeOrderNoCandidate(activeErpVoucher.code) === normalizedOrderCode
            ) {
              let workWarehouse = activeWarehouse || currentWarehouseRef.current;
              if (!isErpVoucherVerified(activeErpVoucher)) {
                setIsErpOrderLoading(true);
                const refreshed = await forceRefreshErpVoucherForOrder(normalizedOrderCode, warehouses, {
                  clearOnFailure: false,
                });
                if (!refreshed) throw new Error(erpVerificationErrorRef.current || 'ERP核验失败');
                activeErpVoucher = refreshed.voucher;
                workWarehouse = refreshed.warehouse;
                activeCustomerName = refreshed.voucher.customerName.trim();
                setActiveCustomerName(activeCustomerName);
              }
              if (workWarehouse) {
                if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(normalizedOrderCode, workWarehouse.id)) {
                  await loadOrderMaterials(normalizedOrderCode, workWarehouse.id);
                }
                await upsertOrder(normalizedOrderCode, activeCustomerName.trim(), workWarehouse);
                await saveOutboundWorkDraft(
                  normalizedOrderCode,
                  activeCustomerName.trim() || activeErpVoucher.customerName,
                  workWarehouse,
                  activeErpVoucher
                );
              }
              showToast('当前ERP单据已恢复，继续扫码', 'success');
              feedbackSuccess();
              return;
            }

            setIsErpOrderLoading(true);
            const { fromCache, voucher } = await loadSaleDispatchVoucher(
              matchedErpAccount,
              normalizedOrderCode,
              { bypassProxyCache: true }
            );
            if (!screenActiveRef.current) {
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
              feedbackError();
              return;
            }

            if (
              !matchedWarehouse.id ||
              typeof matchedWarehouse.id !== 'string' ||
              matchedWarehouse.id.trim() === ''
            ) {
              showToast('仓库信息无效，请重新选择仓库', 'error');
              feedbackError();
              return;
            }

            if (!activeWarehouse || activeWarehouse.id !== matchedWarehouse.id) {
              setActiveWarehouse(matchedWarehouse);
              await AsyncStorage.setItem(
                STORAGE_KEYS.GLOBAL_WAREHOUSE,
                JSON.stringify(matchedWarehouse)
              );
            }

            const isSameOrder =
              normalizeOrderNoCandidate(activeOrderNo) === normalizedOrderCode;
            const isSwitchingOrder =
              !isSameOrder && scanRecordsRef.current.length > 0;
            const existing = await getOrder(normalizedOrderCode, matchedWarehouse.id);
            const nextCustomerName = (voucher.customerName || existing?.customer_name || '').trim();

            scanRecordsRef.current = [];
            setScanRecords([]);
            expandedGroupsRef.current = new Set();
            setExpandedGroups(new Set());
            setActiveOrderNo(normalizedOrderCode);
            setActiveCustomerName(nextCustomerName);
            if (fromCache) {
              markErpVoucherUnverified();
            }
            setActiveErpVoucher(voucher);
            if (!fromCache) {
              markErpVoucherVerified(voucher);
            }
            setErpVoucherRecoveryRequired(false);

            await Promise.all([
              upsertOrder(normalizedOrderCode, nextCustomerName, {
                id: matchedWarehouse.id,
                name: matchedWarehouse.name,
              }),
              saveOutboundWorkDraft(
                normalizedOrderCode,
                nextCustomerName,
                matchedWarehouse,
                voucher
              ),
              loadOrderMaterials(normalizedOrderCode, matchedWarehouse.id),
            ]);

            if (fromCache) {
              void forceRefreshErpVoucherForOrder(normalizedOrderCode, warehouses)
                .then(async (refreshed) => {
                  if (
                    !refreshed ||
                    !screenActiveRef.current ||
                    normalizeOrderNoCandidate(orderNoRef.current) !== normalizedOrderCode
                  ) {
                    return;
                  }

                  const refreshedCustomerName = refreshed.voucher.customerName.trim();
                  setActiveCustomerName(refreshedCustomerName);
                  await Promise.all([
                    upsertOrder(normalizedOrderCode, refreshedCustomerName, {
                      id: refreshed.warehouse.id,
                      name: refreshed.warehouse.name,
                    }),
                    saveOutboundWorkDraft(
                      normalizedOrderCode,
                      refreshedCustomerName,
                      refreshed.warehouse,
                      refreshed.voucher
                    ),
                  ]);
                  if (refreshed.warehouse.id !== matchedWarehouse.id) {
                    await loadOrderMaterials(normalizedOrderCode, refreshed.warehouse.id);
                  }
                })
                .catch((error) => {
                  logger.warn('[扫码出库] 本机缓存载入后的ERP实时核验失败:', error);
                });
            }

            let orderLoadedMessage = `${matchedErpAccount.name}单据已载入`;
            if (isSameOrder) {
              orderLoadedMessage = fromCache
                ? '当前ERP单据已恢复，正在核验ERP'
                : '当前ERP单据已恢复，继续扫码';
            } else if (isSwitchingOrder) {
              orderLoadedMessage = fromCache
                ? `已切换到${matchedErpAccount.name}单据，正在核验ERP`
                : `已切换到${matchedErpAccount.name}单据`;
            } else if (fromCache) {
              orderLoadedMessage = `${matchedErpAccount.name}单据已载入，正在核验ERP`;
            }

            showToast(
              orderLoadedMessage,
              isSwitchingOrder ? 'warning' : 'success'
            );
            if (isSameOrder) {
              feedbackSuccess();
            } else if (isSwitchingOrder) {
              feedbackSwitchOrder();
            } else {
              feedbackNewOrder();
            }
            return;
          }

          setActiveErpVoucher(null);
          setErpVoucherRecoveryRequired(false);
          showToast('出库单未匹配到ERP账套，请检查单号规则', 'error');
          feedbackError();
          return;
        }

        // 物料扫描
        if (!activeOrderNo) {
          showToast('请先扫描订单', 'warning');
          feedbackWarning();
          return;
        }

        let workWarehouse = currentWarehouseRef.current;
        if (!workWarehouse) {
          showToast('请选择仓库', 'warning');
          feedbackWarning();
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
          feedbackError();
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

        try {
          activeRulesRef.current ??= await getActiveRules();
          const rule = await detectRule(code, activeRulesRef.current);
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
          feedbackError();
          return;
        }

        const normalizedModel = (parsed.model || '').trim();
        const normalizedQuantity = parseQuantity(parsed.quantity);

        if (!normalizedModel) {
          showToast('未识别到型号信息', 'error');
          feedbackError();
          return;
        }

        if (normalizedQuantity === null) {
          logger.warn('[扫码出库] 忽略数量字段无效的扫码内容:', {
            code,
            quantity: parsed.quantity,
            model: normalizedModel,
          });
          showToast('二维码数量无效，请重新扫描', 'error');
          feedbackError();
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
          if (!refreshed) {
            showToast('ERP单据实时核验失败，已阻止本次物料扫码', 'error');
            feedbackError();
            return;
          }

          activeErpVoucher = refreshed.voucher;
          workWarehouse = refreshed.warehouse;
          activeCustomerName = refreshed.voucher.customerName.trim();
          setActiveCustomerName(activeCustomerName);
          await Promise.all([
            upsertOrder(activeOrderNo, activeCustomerName, {
              id: workWarehouse.id,
              name: workWarehouse.name,
            }),
            saveOutboundWorkDraft(
              activeOrderNo,
              activeCustomerName,
              workWarehouse,
              activeErpVoucher
            ),
          ]);
          if (orderMaterialsKeyRef.current !== buildOrderMaterialsKey(activeOrderNo, workWarehouse.id)) {
            await loadOrderMaterials(activeOrderNo, workWarehouse.id);
          }
        }

        // 检查重复 + 查找存货编码（并行查询，性能优化）
        logger.log('[扫码出库] 开始检查重复和查找存货编码，参数:', {
          orderNo: activeOrderNo,
          model: normalizedModel,
          batch: parsed.batch,
          traceNo: parsed.traceNo,
          quantity: normalizedQuantity,
        });
        const [check, inventoryCode] = await Promise.all([
          checkMaterialExists(
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
            const value = await getInventoryCodeByModel(normalizedModel, parsed.version);
            if (value) inventoryBindingsRef.current.set(key, value);
            return value;
          })(),
        ]);
        logger.log('[扫码出库] 重复检查结果:', check);
        logger.log('[扫码出库] 存货编码:', inventoryCode);

        if (check.material && !check.canRescan) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        if (!screenActiveRef.current || orderNoRef.current !== activeOrderNo ||
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
          const progress = buildOutboundProgress(activeErpVoucher.lines, scanRecordsRef.current);
          const matchedErpLine = progress.find((line) => line.inventoryCode === normalizedInventoryCode && line.sourceLineCount > 0);
          const erpRequiredQuantity = matchedErpLine?.requiredQuantity ?? 0;

          if (!matchedErpLine) {
            logger.warn('[扫码出库] 绑定存货编码未出现在ERP单据中:', {
              inventoryCode: normalizedInventoryCode,
              model: normalizedModel,
              version: parsed.version || '',
            });
            showToast(
              `不在ERP出库单：${normalizedModel}${parsed.version ? ` / ${parsed.version}` : ''}\n绑定存货编码：${inventoryCode?.trim() || normalizedInventoryCode}`,
              'error'
            );
            feedbackNotInOrder();
            return;
          }

          if (erpRequiredQuantity <= 0 || matchedErpLine.status === 'invalid') {
            logger.warn('[扫码出库] ERP单据物料数量无效:', {
              inventoryCode: normalizedInventoryCode,
              quantity: erpRequiredQuantity,
            });
            showToast(`ERP出库数量无效：${matchedErpLine.specification || normalizedModel}`, 'error');
            feedbackError();
            return;
          }

          if (progress.some((line) => line.status === 'unmatched' || line.status === 'invalid' || line.status === 'over')) {
            throw new Error('本单存在不匹配或超量的已扫记录，请先核对并处理异常明细');
          }
          const scannedQuantity = matchedErpLine.scannedQuantity;

          if (scannedQuantity + normalizedQuantity > erpRequiredQuantity) {
            const remainingQuantity = Math.max(0, erpRequiredQuantity - scannedQuantity);
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
            };
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
          successToastText = `已扫：${normalizedModel}，剩余 ${nextRemainingQuantity}`;
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
        const materialId = await addMaterialWithOrder(
          {
            order_no: activeOrderNo,
            customer_name: savedPayload.customerName || '',
            operation_type: 'outbound',
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
          },
          savedPayload.customerName || '',
          {
            id: savedPayload.warehouseId,
            name: savedPayload.warehouseName,
          }
        );

        await saveOutboundWorkDraft(activeOrderNo, activeCustomerName.trim(), workWarehouse);

        let orderJustCompleted = false;
        if (activeOrderNo === orderNoRef.current) {
          const recordsBeforeSave = scanRecordsRef.current;
          const savedItem = mapQueueItemToMaterialItem(materialId, savedPayload);
          const preservedItems = recordsBeforeSave.filter(
            (item) => item.id !== savedItem.id
          );
          const nextRecords = [savedItem, ...preservedItems];
          scanRecordsRef.current = nextRecords;
          setScanRecords(nextRecords);
          orderJustCompleted = activeErpVoucher !== null &&
            !isOutboundOrderComplete(activeErpVoucher.lines, recordsBeforeSave) &&
            isOutboundOrderComplete(activeErpVoucher.lines, nextRecords);
        }

        showToast(
          orderJustCompleted ? '本单已扫完，可扫描下一单' : successToastText,
          'success'
        );
        void (orderJustCompleted ? feedbackOutboundOrderComplete() : feedbackSuccess());
      } catch (e) {
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
          if (diagnostic) {
            // 不在查看诊断时继续处理排队扫码；本次不会写入任何出库记录。
            scannerFocusBlockedRef.current = true;
            pendingScanCodesRef.current = [];
            alertRef.current.showAlert(
              '解析规则冲突',
              formatRuleConflictDiagnostic(diagnostic, '当前出库单'),
              [
                { text: '知道了', style: 'cancel' },
                { text: '去配置规则', onPress: () => routerRef.current.push('/rules') },
              ],
              'warning'
            );
            feedbackWarning();
            return;
          }
        }
        if (getErpAccountByOutboundOrderNo(normalizeOrderNoCandidate(code))) {
          markErpVoucherUnverified();
          setErpVoucherRecoveryRequired(true);
        }
        logger.error('[扫码出库] 处理失败:', e);
        const errorMessage = formatUserFacingErrorMessage(e, '扫码处理失败，请重新扫描');
        showToast(`处理失败：${errorMessage}`, 'error');
        feedbackError();
      } finally {
        setIsErpOrderLoading(false);
        // 已提交的完整扫码立即串行处理；仅在空闲时延迟恢复焦点。
        resumePendingScanCodes(170);
      }
    },
    [
      forceRefreshErpVoucherForOrder,
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
    () => erpVoucher ? buildOutboundProgress(erpVoucher.lines, scanRecords) : [],
    [erpVoucher, scanRecords]
  );

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
          label: '出库单号',
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
    [customerName, erpVoucher, orderNo, theme.success, theme.textMuted, theme.warning]
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
            if (processingRef.current || pendingOutboundUnpackRef.current || orderNo !== orderNoRef.current) {
              showToast('正在处理出库作业，请稍后删除', 'warning');
              return;
            }
            processingRef.current = true;
            try {
              await deleteMaterial(item.id);
              const remainingItems = scanRecordsRef.current.filter(record => record.id !== item.id);
              scanRecordsRef.current = remainingItems;
              setScanRecords(remainingItems);
              if (orderNo) {
                try {
                  await loadOrderMaterials(orderNo);
                } catch (refreshError) {
                  logger.warn('[扫码出库] 物料已删除，但刷新列表失败:', refreshError);
                  showToast('物料已删除，列表暂未刷新；下次扫码将重新读取本单记录', 'warning');
                  return;
                }
              }
              showToast('物料已删除', 'success');
            } catch (error) {
              logger.error('删除失败:', error);
              showToast(formatUserFacingErrorMessage(error, '删除失败，请稍后重试'), 'error');
            } finally {
              resumePendingScanCodes(100);
            }
          })();
        },
        true
      );
    },
    [alert, loadOrderMaterials, orderNo, resumePendingScanCodes, showToast]
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
                  应出 {item.requiredQuantity.toLocaleString()} / 已扫{' '}
                  {item.scannedQuantity.toLocaleString()}
                </Text>
                <Text style={[styles.erpLineMetaText, { color: statusMeta.color }]}>
                  剩余 {Math.max(0, item.remainingQuantity).toLocaleString()} · {statusMeta.label}
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
    (rawText?: string) => {
      const sourceText = typeof rawText === 'string' ? rawText : liveInputValueRef.current;
      const code = normalizeScannerInput(sourceText);

      liveInputValueRef.current = '';
      setInputValue('');

      if (!code) {
        if (!processingRef.current && pendingScanCodesRef.current.length === 0) {
          focusScannerInput(0);
        }
        return;
      }

      if (processingRef.current || pendingOutboundUnpackRef.current) {
        pendingScanCodesRef.current.push(code);
        return;
      }

      processScan(code);
    },
    [focusScannerInput, normalizeScannerInput, processScan]
  );

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback(
    (text: string) => {
      // 清除之前的定时器（每次输入都重置）
      cancelScanSubmit(autoSubmitTimerRef);

      liveInputValueRef.current = text;
      setInputValue(text);

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        const normalizedOrderText = normalizeOrderNoCandidate(text);
        const shouldFastSubmitOrder =
          currentScanStep === 'order' &&
          (Boolean(getErpAccountByOutboundOrderNo(normalizedOrderText)) ||
            getMatchingOutboundWarehouseOrderRules(
              normalizedOrderText,
              outboundWarehouseOrderRules
            ).length > 0 ||
            (Object.keys(outboundWarehouseOrderRules).length === 0 &&
              isOutboundOrderNo(normalizedOrderText, outboundOrderRule)));

        scheduleScanSubmit(
          autoSubmitTimerRef,
          () => {
            flushScannerInput(text);
          },
          shouldFastSubmitOrder
            ? ORDER_SCAN_FAST_SUBMIT_DEBOUNCE_MS
            : SCAN_AUTO_SUBMIT_DEBOUNCE_MS
        );
        return;
      }
    },
    [currentScanStep, flushScannerInput, outboundOrderRule, outboundWarehouseOrderRules]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback(() => {
    cancelScanSubmit(autoSubmitTimerRef);

    flushScannerInput();
  }, [flushScannerInput]);

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
      feedbackError();
      return;
    }

    const materialId = generateId();
    let unpackSaved = false;
    let orderJustCompleted = false;
    let pendingSync: { remainingRecord: UnpackRecord; shippedRecord: UnpackRecord } | null = null;
    outboundUnpackingRef.current = true;
    setOutboundUnpacking(true);

    try {
      let voucher = erpVoucherRef.current;
      if (!screenActiveRef.current || orderNoRef.current !== savedPayload.orderNo ||
          currentWarehouseRef.current?.id !== warehouse.id ||
          orderMaterialsKeyRef.current !== buildOrderMaterialsKey(savedPayload.orderNo, warehouse.id)) {
        throw new Error('订单或已扫记录发生变化，请取消拆包后重新扫描');
      }
      if (!voucher || !isErpVoucherVerified(voucher)) {
        const refreshed = await forceRefreshErpVoucherForOrder(savedPayload.orderNo, warehouses, {
          clearOnFailure: false,
        });
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

      pendingSync = {
        remainingRecord: unpackResult.remainingRecord,
        shippedRecord: unpackResult.shippedRecord,
      };
      const shippedScanItem = mapQueueItemToMaterialItem(materialId, {
        ...savedPayload,
        quantity: pending.shippedQuantity.toString(),
        traceNo: unpackResult.shippedRecord.new_traceNo || savedPayload.traceNo,
      });

      await saveOutboundWorkDraft(savedPayload.orderNo, savedPayload.customerName || '', warehouse);
      if (savedPayload.orderNo === orderNoRef.current) {
        const recordsBeforeRefresh = scanRecordsRef.current;
        let refreshedItems: MaterialItem[] = [];
        try {
          refreshedItems = await loadOrderMaterials(savedPayload.orderNo, warehouse.id);
        } catch (refreshError) {
          logger.warn('[扫码出库] 拆包完成后刷新本单物料失败:', refreshError);
        }
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
      resumePendingScanCodes(120);
    } catch (error) {
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
        feedbackWarning();
        resumePendingScanCodes(120);
      } else {
        feedbackError();
      }
    } finally {
      outboundUnpackingRef.current = false;
      setOutboundUnpacking(false);
    }

    if (pendingSync) {
      syncUnpackRecordsToComputer([pendingSync.shippedRecord, pendingSync.remainingRecord])
        .then(() => {
          logger.log('[扫码出库] 拆包标签已同步，电脑端已按供应商模板策略处理');
        })
        .catch((syncError) => {
          logger.warn('[扫码出库] 拆包标签自动打印失败:', syncError);
          showToast(
            `拆包已完成，但标签自动打印失败：${getUnpackSyncFailureMessage(syncError)}`,
            'warning'
          );
        });
    }
  }, [
    forceRefreshErpVoucherForOrder,
    isErpVoucherVerified,
    loadOrderMaterials,
    outboundUnpackNotes,
    resumePendingScanCodes,
    saveOutboundWorkDraft,
    setActiveCustomerName,
    showToast,
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
      alert.showConfirm(
        '确认切换仓库',
        '当前出库订单、客户和本单物料显示会被清空。已落库的历史物料不会删除，确定切换吗？',
        () => {
          void switchWarehouse();
        },
        true
      );
      return;
    }

    await switchWarehouse();
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title="出库扫描"
            onBack={() => router.back()}
            rightIcon={erpVoucher || erpVoucherRecoveryRequired ? 'refresh-cw' : 'crosshair'}
            rightLabel={
              erpVoucher || erpVoucherRecoveryRequired ? '刷新ERP销售出库单' : '聚焦扫码输入框'
            }
            rightDisabled={isErpOrderLoading}
            onRightPress={() => {
              if (erpVoucher || erpVoucherRecoveryRequired) {
                void handleRefreshErpVoucher();
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
          statusLabel={currentScanStatusLabel}
          value={inputValue}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSubmitEditing}
          placeholder={currentScanPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={!showWarehousePicker && !pendingOutboundUnpack && !alert.visible}
          showSoftInputOnFocus={false}
          actionLabel="提交出库扫码内容"
          actionLoading={isErpOrderLoading}
          onActionPress={() => {
            if (inputValue.trim()) {
              handleSubmitEditing();
              return;
            }
            focusScannerInput(0);
          }}
        />

        {isErpOrderComplete ? (
          <View style={styles.completionBanner}>
            <Feather name="check-circle" size={18} color={theme.success} />
            <Text style={styles.completionBannerText}>
              本单物料已全部扫完，请扫描下一张出库单
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
