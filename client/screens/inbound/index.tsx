import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Platform,
  BackHandler,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AggregatedRecordItem } from '@/components/AggregatedRecordItem';
import {
  UiPageHeader,
  UiSafeBottomBar,
  UiToolbarButton,
  UiWorkflowSummary,
} from '@/components/UiRedesign';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { createStyles } from './styles';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';
import {
  Warehouse,
  getAllWarehouses,
  addInboundRecordsBatch,
  detectRule,
  getActiveRules,
  parseWithRule,
  QRCodeRuleConflictError,
  getInventoryCodeByModel,
  generateId,
  updateInboundDocumentSyncStatus,
  getInboundRecordsByNo,
} from '@/utils/database';
import { isQRCode } from '@/utils/qrcodeParser';
import { parseQuantity } from '@/utils/quantity';

import { Feather, FontAwesome6 } from '@expo/vector-icons';
import {
  feedbackSuccess,
  feedbackError,
  feedbackWarning,
  feedbackDuplicate,
  feedbackInboundComplete,
  feedbackClear,
  feedbackClearFailed,
  feedbackNotBound,
  feedbackNotInOrder,
  feedbackOverQuantity,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { Str } from '@/resources/strings';
import { formatDateTime, formatDate, getISODateTime } from '@/utils/time';
import { STORAGE_KEYS } from '@/constants/config';

import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import {
  buildInboundExportFileNameFromNo,
  buildInboundSheets,
  type InboundExportRecord,
} from '@/utils/inboundExport';
import type { SyncConfig } from '@/constants/config';
import { cancelScanSubmit, scheduleScanSubmit, sanitizeStructuredScannerInput } from '@/utils/scannerInput';
import { buildOutboundProgress as buildInboundProgress } from '@/utils/outboundProgress';
import {
  getErpAccountByKey,
  type ErpAccountConfig,
  type ErpAccountKey,
} from '@/utils/erpAccounts';
import {
  fetchPurchaseReceiveVoucherStatuses,
  fetchPurchaseReceiveVoucher,
  getPurchaseReceiveBindingLines,
  loadCachedPurchaseReceiveVoucher,
  loadCachedPurchaseReceiveVoucherStatuses,
  savePurchaseReceiveVoucherCache,
  savePurchaseReceiveVoucherStatusesCache,
  type PurchaseReceiveVoucher,
} from '@/utils/erpPurchaseReceive';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';
import {
  buildInboundModelKey,
  buildInboundModelVersionKey,
  normalizeInboundModel,
  normalizeInboundVersion,
} from '@/utils/inboundRecords';

// 扫描记录类型
interface ScanRecord {
  id: string;
  model: string;
  batch: string;
  quantity: number;
  scanTime: string;
  rawContent: string;
  inventoryCode?: string;
  supplier?: string;
  ruleId?: string;
  ruleName?: string;
  // 扩展字段
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  // 占位字段解析值（仅用于兼容和排查，不展示、不导出）
  customFields?: Record<string, string>;
  // 是否已确认
  confirmed?: boolean;
}

type InboundAggregatedRecord = {
  model: string;
  version: string;
  records: ScanRecord[];
  totalQuantity: number;
  count: number;
};

type InboundErpLineProgress = {
  inventoryCode: string;
  key: string;
  remainingQuantity: number;
  requiredQuantity: number;
  scannedRecords: ScanRecord[];
  scannedQuantity: number;
  specification: string;
  status: 'complete' | 'partial' | 'pending' | 'over' | 'unmatched' | 'invalid';
  unitName: string;
};

const normalizeInventoryCode = (value?: string | null) =>
  (value || '').trim();
const getInventoryCodeMatchKey = (value?: string | null) =>
  normalizeInventoryCode(value).toUpperCase();

const normalizeInboundDraftRecords = async (records: readonly ScanRecord[]) => {
  const inventoryCodeRequests = new Map<string, Promise<string | null>>();

  return await Promise.all(
    records.map(async (record) => {
      const model = normalizeInboundModel(record.model);
      const version = normalizeInboundVersion(record.version);
      let inventoryCode = normalizeInventoryCode(record.inventoryCode);

      if (!inventoryCode && model) {
        const key = buildInboundModelVersionKey(model, version);
        let request = inventoryCodeRequests.get(key);
        if (!request) {
          request = getInventoryCodeByModel(model, version);
          inventoryCodeRequests.set(key, request);
        }
        inventoryCode = normalizeInventoryCode(await request);
      }

      return {
        ...record,
        model,
        version: version || undefined,
        inventoryCode: inventoryCode || undefined,
      };
    })
  );
};

const INBOUND_RECORD_SIGNATURE_FIELDS = [
  'id',
  'version',
  'batch',
  'productionDate',
  'quantity',
] as const;

export default function InboundScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const alert = useCustomAlert();
  const router = useSafeRouter();
  // 弹窗与路由 Hook 返回对象会随渲染更新；扫码回调通过 Ref 获取最新实例，避免高频扫码链路反复重建。
  const alertRef = useRef(alert);
  const routerRef = useRef(router);
  useEffect(() => {
    alertRef.current = alert;
    routerRef.current = router;
  }, [alert, router]);
  const routeParams = useSafeSearchParams<{ accountKey?: ErpAccountKey; voucherCode?: string }>();
  const selectedVoucherCode = (routeParams.voucherCode || '').trim().toUpperCase();
  const selectedAccountKey = routeParams.accountKey;

  // 输入
  const inputRef = useRef<WarehouseScanInputHandle>(null);
  const [inputValue, setInputValue] = useState('');
  const liveInputValueRef = useRef('');
  const processingRef = useRef(false);
  const sessionIdRef = useRef(0);
  const draftReadyRef = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const activeRulesRef = useRef<Awaited<ReturnType<typeof getActiveRules>> | null>(null);
  const inventoryBindingsRef = useRef(new Map<string, string>());
  const inboundDraftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const isSessionActive = useCallback((id: number) =>
    screenActiveRef.current && sessionIdRef.current === id, []);
  const scannerFocusBlockedRef = useRef(false);
  // 扫码队列 - 暂存处理中的新扫码（字符串队列，用于 processing 中排队）
  const scanQueueRef = useRef<string[]>([]);
  // 仓库
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);

  // 当前供应商（从物料管理获取）
  const [currentSupplier, setCurrentSupplier] = useState<string | null>(null);

  // 入库单号
  const [inboundNo, setInboundNo] = useState('');
  const erpVoucherRef = useRef<PurchaseReceiveVoucher | null>(null);
  const [erpVoucher, setErpVoucher] = useState<PurchaseReceiveVoucher | null>(null);
  const [erpVoucherLoading, setErpVoucherLoading] = useState(Boolean(selectedVoucherCode));
  const [erpVoucherError, setErpVoucherError] = useState('');

  const setActiveErpVoucher = useCallback((voucher: PurchaseReceiveVoucher | null) => {
    erpVoucherRef.current = voucher;
    setErpVoucher(voucher);
  }, []);

  // AsyncStorage Key
  const INBOUND_SCAN_RECORDS_KEY = 'inbound_scan_records';
  const INBOUND_PENDING_DATA_KEY = 'inbound_pending_data';
  const getLegacyInboundDraftKeys = useCallback(
    (warehouseId?: string | null) => {
      if (!warehouseId) {
        return {
          recordsKey: INBOUND_SCAN_RECORDS_KEY,
          pendingKey: INBOUND_PENDING_DATA_KEY,
        };
      }

      const voucherScope = selectedVoucherCode ? `:${selectedVoucherCode}` : '';
      return {
        recordsKey: `${INBOUND_SCAN_RECORDS_KEY}:${warehouseId}${voucherScope}`,
        pendingKey: `${INBOUND_PENDING_DATA_KEY}:${warehouseId}${voucherScope}`,
      };
    },
    [selectedVoucherCode]
  );
  const getInboundDraftKeys = useCallback(
    (warehouseId?: string | null) => {
      if (!warehouseId) {
        return {
          recordsKey: INBOUND_SCAN_RECORDS_KEY,
          pendingKey: INBOUND_PENDING_DATA_KEY,
        };
      }

      const voucherScope = selectedVoucherCode ? `:${selectedVoucherCode}` : '';
      const accountScope = selectedAccountKey || 'unscoped';
      return {
        recordsKey: `${INBOUND_SCAN_RECORDS_KEY}:${accountScope}:${warehouseId}${voucherScope}`,
        pendingKey: `${INBOUND_PENDING_DATA_KEY}:${accountScope}:${warehouseId}${voucherScope}`,
      };
    },
    [selectedAccountKey, selectedVoucherCode]
  );

  const enqueueInboundDraftWrite = useCallback(
    (operation: () => Promise<void>): Promise<void> => {
      const nextWrite = inboundDraftWriteQueueRef.current
        .catch(() => undefined)
        .then(operation);
      inboundDraftWriteQueueRef.current = nextWrite.then(
        () => undefined,
        () => undefined
      );
      return nextWrite;
    },
    []
  );

  // 扫描记录
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const scanRecordsRef = useRef<ScanRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInProgressRef = useRef(false);

  // 已保存入库记录
  // Toast
  const { showToast, ToastContainer } = useToast();

  useEffect(() => {
    scanRecordsRef.current = scanRecords;
  }, [scanRecords]);

  useEffect(() => {
    scannerFocusBlockedRef.current = saving || erpVoucherLoading || alert.visible;
  }, [alert.visible, erpVoucherLoading, saving]);

  const focusScannerInput = useCallback((delay = 0) => {
    if (screenActiveRef.current && !scannerFocusBlockedRef.current) inputRef.current?.focus(delay);
  }, []);

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
    if (!saving && !erpVoucherLoading) {
      focusScannerInput(80);
    }
  }, [erpVoucherLoading, focusScannerInput, saving]);

  // 展开状态管理（用 ref 同步，避免 renderAggregatedRecord 频繁重建）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());

  // 确认状态管理
  const [confirmedGroups, setConfirmedGroups] = useState<Set<string>>(new Set());
  const confirmedGroupsRef = useRef<Set<string>>(new Set());

  // 加载扫描记录。ERP 上下文显式传入，避免页面状态变化时重建聚焦初始化回调。
  const loadScanRecords = useCallback(
    async (
      warehouse: Warehouse | null,
      expectedVoucherCode: string,
      fallbackSupplier?: string | null
    ): Promise<string | null> => {
      const sessionId = sessionIdRef.current;
      try {
        await inboundDraftWriteQueueRef.current;
        const currentWarehouseId = warehouse?.id;
        if (!currentWarehouseId) {
          logger.log('[loadScanRecords] 当前仓库未加载，跳过恢复');
          return null;
        }

        const normalizedExpectedVoucherCode = expectedVoucherCode.trim().toUpperCase();
        const draftKeys = getInboundDraftKeys(currentWarehouseId);
        const legacyScopedDraftKeys = getLegacyInboundDraftKeys(currentWarehouseId);
        let savedRecords = await AsyncStorage.getItem(draftKeys.recordsKey);
        let pendingData = await AsyncStorage.getItem(draftKeys.pendingKey);
        let shouldMigrateLegacyDraft = false;
        let legacyDraftKeysToRemove: string[] = [];

        // 兼容旧版按仓库/单据隔离但未包含账套的草稿。
        if (!savedRecords) {
          savedRecords = await AsyncStorage.getItem(legacyScopedDraftKeys.recordsKey);
          pendingData = await AsyncStorage.getItem(legacyScopedDraftKeys.pendingKey);
          shouldMigrateLegacyDraft = Boolean(savedRecords);
          legacyDraftKeysToRemove = [
            legacyScopedDraftKeys.recordsKey,
            legacyScopedDraftKeys.pendingKey,
          ];
        }

        // 再兼容更早版本的单槽草稿，核对成功后迁移到按账套隔离的新 key。
        if (!savedRecords) {
          savedRecords = await AsyncStorage.getItem(INBOUND_SCAN_RECORDS_KEY);
          pendingData = await AsyncStorage.getItem(INBOUND_PENDING_DATA_KEY);
          shouldMigrateLegacyDraft = Boolean(savedRecords);
          legacyDraftKeysToRemove = [INBOUND_SCAN_RECORDS_KEY, INBOUND_PENDING_DATA_KEY];
        }

        if (savedRecords) {
          if (shouldMigrateLegacyDraft && normalizedExpectedVoucherCode && !pendingData) {
            logger.warn('[loadScanRecords] 旧版草稿缺少单号，跳过自动迁移以避免串单');
            return null;
          }

          const parsedRecords = safeJsonParseNullable<ScanRecord[]>(
            savedRecords,
            'inbound.scanRecords'
          );
          if (!parsedRecords) {
            throw new Error('本单入库草稿损坏，请先备份并检查，未覆盖原草稿');
          }
          if (!Array.isArray(parsedRecords) || parsedRecords.some(record =>
            !record || !record.id || !record.model || !Number.isSafeInteger(record.quantity) || record.quantity <= 0
          )) throw new Error('入库草稿格式异常，未覆盖原草稿');
          const records = await normalizeInboundDraftRecords(parsedRecords);
          if (!isSessionActive(sessionId)) return null;
          const normalizedSavedRecords = JSON.stringify(records);
          let restoredInboundNo: string | null = null;

          // 恢复供应商和入库单号，同时检查仓库是否匹配
          if (pendingData) {
            const data = safeJsonParseNullable<{
              supplier?: string | null;
               inboundNo?: string;
               warehouseId?: string;
               warehouseName?: string;
               accountKey?: ErpAccountKey;
             }>(pendingData, 'inbound.pendingData');
            if (!data) {
              throw new Error('本单草稿信息损坏，未覆盖原草稿');
            }

            const savedInboundNo = (data.inboundNo || '').trim().toUpperCase();
            if (shouldMigrateLegacyDraft && normalizedExpectedVoucherCode && !savedInboundNo) {
              logger.warn('[loadScanRecords] 旧版草稿没有可核对的单号，跳过自动迁移');
              return null;
            }
            if (
              normalizedExpectedVoucherCode &&
              savedInboundNo &&
              savedInboundNo !== normalizedExpectedVoucherCode
            ) {
              if (!shouldMigrateLegacyDraft) throw new Error('本单草稿单号不匹配，未覆盖原草稿');
              logger.warn('[loadScanRecords] 草稿单号与当前ERP单据不一致，跳过恢复:', {
                currentVoucherCode: normalizedExpectedVoucherCode,
                savedInboundNo,
              });
              return null;
            }
            if (
              data.accountKey &&
              selectedAccountKey &&
              data.accountKey !== selectedAccountKey
            ) {
              if (!shouldMigrateLegacyDraft) throw new Error('本单草稿账套不匹配，未覆盖原草稿');
              logger.warn('[loadScanRecords] 草稿账套与当前ERP账套不一致，跳过恢复:', {
                savedAccountKey: data.accountKey,
                currentAccountKey: selectedAccountKey,
              });
              return null;
            }

            // 验证保存时的仓库是否与当前仓库匹配
            if (data.warehouseId && data.warehouseId !== currentWarehouseId) {
              if (!shouldMigrateLegacyDraft) throw new Error('本单草稿仓库不匹配，未覆盖原草稿');
              logger.log('[loadScanRecords] 仓库不匹配，跳过恢复:', {
                savedWarehouseId: data.warehouseId,
                currentWarehouseId,
              });
              return null;
            }

            setCurrentSupplier(data.supplier || null);
            setInboundNo(data.inboundNo || '');
            restoredInboundNo = data.inboundNo || null;
          }

          scanRecordsRef.current = records;
          setScanRecords(records);

          if (records.length > 0) {
            showToast(`已恢复 ${records.length} 条入库暂存`, 'success');
          }

          if (shouldMigrateLegacyDraft) {
            await AsyncStorage.multiSet([
              [draftKeys.recordsKey, normalizedSavedRecords],
              [
                draftKeys.pendingKey,
                pendingData ||
                  JSON.stringify({
                    supplier: fallbackSupplier || null,
                     inboundNo: restoredInboundNo || normalizedExpectedVoucherCode,
                     warehouseId: currentWarehouseId,
                     warehouseName: warehouse?.name,
                     accountKey: selectedAccountKey,
                   }),
               ],
             ]);
            await AsyncStorage.multiRemove(legacyDraftKeysToRemove);
          } else if (normalizedSavedRecords !== savedRecords) {
            await AsyncStorage.setItem(draftKeys.recordsKey, normalizedSavedRecords);
          }

          return restoredInboundNo;
        }
        if (isSessionActive(sessionId)) {
          scanRecordsRef.current = [];
          setScanRecords([]);
        }
      } catch (error) {
        logger.error('加载扫描记录失败:', error);
        throw error;
      }

      return null;
    },
    [getInboundDraftKeys, getLegacyInboundDraftKeys, isSessionActive, selectedAccountKey, showToast]
  );

  // 保存扫描记录
  const saveScanRecords = useCallback(
    async (records: ScanRecord[], supplier?: string | null): Promise<boolean> => {
      try {
        const draftKeys = getInboundDraftKeys(currentWarehouse?.id);
        const pendingData = {
          supplier: supplier || currentSupplier,
          inboundNo,
          warehouseId: currentWarehouse?.id,
          warehouseName: currentWarehouse?.name,
          accountKey: selectedAccountKey,
        };
        await enqueueInboundDraftWrite(() =>
          AsyncStorage.multiSet([
            [draftKeys.recordsKey, JSON.stringify(records)],
            [draftKeys.pendingKey, JSON.stringify(pendingData)],
          ])
        );
        return true;
      } catch (error) {
        logger.error('保存扫描记录失败:', error);
        return false;
      }
    },
    [
      currentSupplier,
      currentWarehouse,
      enqueueInboundDraftWrite,
      getInboundDraftKeys,
      inboundNo,
      selectedAccountKey,
    ]
  );

  // 清空扫描记录
  const clearScanRecords = async () => {
    const draftKeys = getInboundDraftKeys(currentWarehouse?.id);
    await enqueueInboundDraftWrite(() =>
      AsyncStorage.multiRemove([
        draftKeys.recordsKey,
        draftKeys.pendingKey,
      ])
    );
  };

  // 初始化
  // 自动清理震动和提示音
  useFeedbackCleanup();

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!saveInProgressRef.current && !processingRef.current && scanQueueRef.current.length === 0) return false;
      showToast('正在处理入库数据，请完成后返回', 'warning');
      return true;
    });
    return () => subscription.remove();
  }, [showToast]));

  const assertPurchaseReceiveUnaudited = useCallback(
    async (account: ErpAccountConfig, voucherCode: string, forceRefresh = false) => {
      const cachedStatuses = await loadCachedPurchaseReceiveVoucherStatuses(account.key);
      let purchaseReceiveStatuses = cachedStatuses?.data || [];
      const cachedStatusTime = cachedStatuses ? Date.parse(cachedStatuses.cachedAt) : NaN;
      const statusCacheFresh =
        Number.isFinite(cachedStatusTime) && Date.now() - cachedStatusTime < 30_000;

      if (forceRefresh || !statusCacheFresh) {
        purchaseReceiveStatuses = await fetchPurchaseReceiveVoucherStatuses(account);
        await savePurchaseReceiveVoucherStatusesCache(account.key, purchaseReceiveStatuses);
      }

      const normalizedVoucherCode = voucherCode.trim().toUpperCase();
      const audited = purchaseReceiveStatuses.some(
        (status) =>
          status.status === 'audited' &&
          status.voucherCode.trim().toUpperCase() === normalizedVoucherCode
      );
      if (audited) {
        throw new Error(`${voucherCode} 已在ERP审核，不再允许扫码入库`);
      }
    },
    []
  );

  const loadSelectedErpVoucher = useCallback(async (
    options: { forceRefresh?: boolean } = {}
  ): Promise<PurchaseReceiveVoucher> => {
    const sessionId = sessionIdRef.current;
    if (!selectedVoucherCode || !selectedAccountKey) {
      setActiveErpVoucher(null);
      setErpVoucherLoading(false);
      const message = '请先从采购入库列表选择ERP单据';
      setErpVoucherError(message);
      throw new Error(message);
    }

    const account = getErpAccountByKey(selectedAccountKey);
    if (!account) {
      throw new Error('未找到采购入库单所属账套');
    }

    setErpVoucherLoading(true);
    setErpVoucherError('');
    try {
      const [existingRecords, cached] = await Promise.all([
        getInboundRecordsByNo(selectedVoucherCode),
        options.forceRefresh ? null : loadCachedPurchaseReceiveVoucher(account.key, selectedVoucherCode),
        assertPurchaseReceiveUnaudited(account, selectedVoucherCode, options.forceRefresh),
      ]);
      const alreadyCompleted = existingRecords.some(
        (record) => (record.warehouse_name || '').trim() === account.expectedWarehouseName
      );
      if (alreadyCompleted) {
        throw new Error(
          `${selectedVoucherCode} 已在本机完成入库，请到单据管理查看，不能重复扫码`
        );
      }

      const cachedAt = cached ? Date.parse(cached.cachedAt) : NaN;
      const cacheIsFresh = Number.isFinite(cachedAt) && Date.now() >= cachedAt && Date.now() - cachedAt < 5 * 60_000;
      const voucher =
        (cacheIsFresh ? cached?.data : null) ||
        (await fetchPurchaseReceiveVoucher(account, selectedVoucherCode, {
          bypassCache: true,
        }));
      if (!cacheIsFresh) {
        await savePurchaseReceiveVoucherCache(voucher);
      }
      if (!isSessionActive(sessionId)) throw new Error('已离开当前入库作业');
      setActiveErpVoucher(voucher);
      return voucher;
    } catch (error) {
      if (isSessionActive(sessionId)) {
        setActiveErpVoucher(null);
        setErpVoucherError(formatUserFacingErrorMessage(error, '采购入库单加载失败，请稍后重试'));
      }
      throw error;
    } finally {
      if (isSessionActive(sessionId)) setErpVoucherLoading(false);
    }
  }, [
    assertPurchaseReceiveUnaudited,
    isSessionActive,
    selectedAccountKey,
    selectedVoucherCode,
    setActiveErpVoucher,
  ]);

  const handleRefreshErpVoucher = useCallback(async () => {
    if (!selectedVoucherCode || !selectedAccountKey || erpVoucherLoading || saveInProgressRef.current ||
        processingRef.current || scanQueueRef.current.length > 0 || liveInputValueRef.current.trim()) {
      focusScannerInput(0);
      return;
    }

    const sessionId = sessionIdRef.current;
    saveInProgressRef.current = true;
    setSaving(true);
    draftReadyRef.current = false;
    setDraftReady(false);
    try {
      const voucher = await loadSelectedErpVoucher({ forceRefresh: true });
      if (!isSessionActive(sessionId)) return;
      if (
        currentWarehouse &&
        voucher.warehouseName.trim() !== currentWarehouse.name.trim()
      ) {
        const message = `ERP仓库已变更为 ${voucher.warehouseName || '-'}，请返回列表后重新进入单据`;
        setActiveErpVoucher(null);
        setErpVoucherError(message);
        throw new Error(message);
      }
      const warehouse = currentWarehouse || (await getAllWarehouses()).find(item => item.name === voucher.warehouseName);
      if (!warehouse) throw new Error('本地未找到ERP仓库，请检查仓库设置');
      if (!isSessionActive(sessionId)) return;
      setCurrentWarehouse(warehouse);
      await loadScanRecords(warehouse, voucher.code, voucher.partnerName);
      if (!isSessionActive(sessionId)) return;
      setCurrentSupplier(voucher.partnerName || null);
      setInboundNo(voucher.code);
      draftReadyRef.current = true;
      setDraftReady(true);
      showToast('ERP采购入库单已刷新', 'success');
    } catch (error) {
      if (isSessionActive(sessionId)) {
        const message = formatUserFacingErrorMessage(error, 'ERP或草稿恢复失败，请稍后重试');
        setErpVoucherError(message);
        showToast(message, 'warning');
      }
    } finally {
      if (isSessionActive(sessionId)) {
        saveInProgressRef.current = false;
        setSaving(false);
        focusScannerInput(100);
      }
    }
  }, [
    currentWarehouse,
    erpVoucherLoading,
    focusScannerInput,
    isSessionActive,
    loadScanRecords,
    loadSelectedErpVoucher,
    selectedAccountKey,
    selectedVoucherCode,
    setActiveErpVoucher,
    showToast,
  ]);

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      const sessionId = ++sessionIdRef.current;
      draftReadyRef.current = false;
      setDraftReady(false);
      setActiveErpVoucher(null);
      scanRecordsRef.current = [];
      setScanRecords([]);
      activeRulesRef.current = null;
      inventoryBindingsRef.current.clear();
      liveInputValueRef.current = '';
      setInputValue('');
      setSaving(false);
      let isActive = true;
      const init = async () => {
        try {
          // 1. 加载仓库列表（数据库已在 APP 启动时初始化）
          const list = await getAllWarehouses();
          if (!isSessionActive(sessionId)) return;

          const selectedVoucher = await loadSelectedErpVoucher();
          if (!isSessionActive(sessionId)) return;

          // 2. 恢复之前选择的仓库，并等待状态更新
          const warehouse =
            list.find((item) => item.name === selectedVoucher.warehouseName) || null;
          if (!warehouse) {
            throw new Error(`本地仓库中未找到ERP仓库：${selectedVoucher.warehouseName || '-'}`);
          }
          setInboundNo(selectedVoucher.code);
          setCurrentSupplier(selectedVoucher.partnerName || null);

          // 3. 设置当前仓库并等待状态更新
          setCurrentWarehouse(warehouse);

          // 4. 加载扫描记录（直接传入 warehouse 参数，避免状态闭包问题）
          const restoredInboundNo = await loadScanRecords(
            warehouse,
            selectedVoucher.code,
            selectedVoucher.partnerName
          );
          if (!isSessionActive(sessionId)) return;
          draftReadyRef.current = true;
          setDraftReady(true);

          // 5. 如果没有入库单号，生成新单号
          setInboundNo(restoredInboundNo || selectedVoucher.code);
          setCurrentSupplier(selectedVoucher.partnerName || null);

          // 7. 聚焦输入框
          if (isActive) {
            focusScannerInput(100);
          }
        } catch (error) {
          logger.error('[扫码入库] 初始化失败:', error);
          if (isActive) {
            setErpVoucherError(formatUserFacingErrorMessage(error, 'ERP或草稿恢复失败，请点击刷新'));
            showToast(
              formatUserFacingErrorMessage(error, '入库页面初始化失败，请稍后重试'),
              'error'
            );
            focusScannerInput(300);
          }
        }
      };
      void init();

      return () => {
        isActive = false;
        screenActiveRef.current = false;
        sessionIdRef.current += 1;
        draftReadyRef.current = false;
        scanQueueRef.current = [];
        processingRef.current = false;
        saveInProgressRef.current = false;
        cancelScanSubmit(autoSubmitTimerRef);
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
          postProcessTimerRef.current = null;
        }
      };
    }, [focusScannerInput, isSessionActive, loadScanRecords, loadSelectedErpVoucher, setActiveErpVoucher, showToast])
  );

  // 处理扫描（带参数版本，供自动触发调用）
  const processScan = useCallback(
    async (code: string) => {
      if (!code || processingRef.current) return;
      const sessionId = sessionIdRef.current;

      const activeErpVoucher = erpVoucherRef.current;

      processingRef.current = true;
      let parsed: {
        model: string;
        batch: string;
        quantity: string;
        package?: string;
        version?: string;
        productionDate?: string;
        traceNo?: string;
        sourceNo?: string;
        customFields?: Record<string, string>;
        ruleId?: string;
        ruleName?: string;
      } | null = null;

      try {
        // 解析二维码
        try {
          const rules = activeRulesRef.current ?? await getActiveRules();
          if (!isSessionActive(sessionId)) return;
          activeRulesRef.current = rules;
          if (!isQRCode(code, rules)) return;
          if (!draftReadyRef.current || saveInProgressRef.current) {
            showToast('入库作业尚未就绪或正在保存，请稍后重新扫描', 'warning');
            feedbackWarning();
            return;
          }
          if (!activeErpVoucher) {
            showToast('请先从采购入库列表选择ERP单据', 'warning');
            feedbackWarning();
            return;
          }
          if (!currentWarehouse) {
            showToast('请先选择仓库', 'error');
            feedbackError();
            return;
          }
          const rule = await detectRule(code, activeRulesRef.current);
          if (!isSessionActive(sessionId)) return;
          logger.log('[扫码入库] 检测到规则:', {
            ruleName: rule?.name,
            ruleSeparator: rule?.separator,
            codeLength: code.length,
          });
          if (rule) {
            const { standardFields, customFields } = parseWithRule(code, rule);
            logger.log('[扫码入库] 解析结果:', {
              standardFields,
              customFieldsCount: Object.keys(customFields || {}).length,
            });
            parsed = {
              model: standardFields.model || '',
              batch: standardFields.batch || '',
              quantity: standardFields.quantity || '',
              package: standardFields.package || '',
              version: standardFields.version || '',
              productionDate: standardFields.productionDate || '',
              traceNo: standardFields.traceNo || '',
              sourceNo: standardFields.sourceNo || '',
              customFields: customFields || {},
              ruleId: rule.id,
              ruleName: rule.name,
            };
          } else {
            logger.warn('[扫码入库] 未检测到匹配的解析规则');
            showToast('没有匹配的二维码解析规则，请先在设置中配置', 'error');
            feedbackError();
            return;
          }
        } catch (e) {
          logger.error('[扫码入库] 规则解析失败:', e);
          if (e instanceof QRCodeRuleConflictError) {
            const activeRules = activeRulesRef.current ?? [];
            const voucherInventoryCodes = new Set(
              (activeErpVoucher ? getPurchaseReceiveBindingLines(activeErpVoucher) : [])
                .map((line) => getInventoryCodeMatchKey(line.inventoryCode))
                .filter(Boolean)
            );
            const diagnostic = await buildRuleConflictDiagnostic(code, activeRules, {
              normalizeModel: normalizeInboundModel,
              normalizeVersion: normalizeInboundVersion,
              isInventoryCodeInCurrentDocument: (inventoryCode) =>
                voucherInventoryCodes.has(getInventoryCodeMatchKey(inventoryCode)),
            });
            if (diagnostic) {
              // 冲突诊断期间停止队列，避免操作者查看结果时继续写入后续扫码。
              scannerFocusBlockedRef.current = true;
              scanQueueRef.current = [];
              alertRef.current.showAlert(
                '解析规则冲突',
                formatRuleConflictDiagnostic(diagnostic, '当前入库单'),
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
          throw e;
        }

        if (!parsed || !parsed.model) {
          showToast(
            `未识别到物料信息\n内容: ${code.substring(0, 20)}${code.length > 20 ? '...' : ''}`,
            'error'
          );
          feedbackError();
          logger.error('[扫码入库] 无法识别物料信息:', {
            code,
            parsed,
            parsedModel: parsed?.model,
          });
          return;
        }

        const parsedRecord = parsed;
        const normalizedModel = normalizeInboundModel(parsedRecord.model);
        const normalizedVersion = normalizeInboundVersion(parsedRecord.version);
        if (!normalizedModel) {
          showToast('未识别到型号信息', 'error');
          feedbackError();
          return;
        }
        const quantity = parseQuantity(parsedRecord.quantity, { min: 1 });

        if (quantity === null) {
          logger.warn('[扫码入库] 忽略数量字段无效的扫码内容:', {
            code,
            quantity: parsedRecord.quantity,
            model: parsedRecord.model,
          });
          showToast('二维码数量无效，请重新扫描', 'error');
          feedbackError();
          return;
        }

        // ERP 单据是入库供应商的唯一来源；物料绑定只负责型号到存货编码的映射。
        const bindingKey = buildInboundModelVersionKey(normalizedModel, normalizedVersion);
        const inventoryCode = inventoryBindingsRef.current.get(bindingKey) ||
          await getInventoryCodeByModel(normalizedModel, normalizedVersion);
        if (!isSessionActive(sessionId)) return;
        if (inventoryCode) inventoryBindingsRef.current.set(bindingKey, inventoryCode);
        const normalizedInventoryCode = normalizeInventoryCode(inventoryCode);
        const inventoryCodeMatchKey = getInventoryCodeMatchKey(inventoryCode);

        logger.log('[扫码入库] 查询结果:', {
          model: normalizedModel,
          inventoryCode,
          currentSupplier,
        });

        if (activeErpVoucher) {
          if (!inventoryCodeMatchKey) {
            showToast(
              `未绑定存货编码：${normalizedModel}${normalizedVersion ? ` / ${normalizedVersion}` : ''}`,
              'error'
            );
            feedbackNotBound();
            return;
          }

          const progress = buildInboundProgress(getPurchaseReceiveBindingLines(activeErpVoucher), scanRecordsRef.current);
          const matchedLine = progress.find(line => line.inventoryCode === inventoryCodeMatchKey && line.sourceLineCount > 0);
          const requiredQuantity = matchedLine?.requiredQuantity || 0;

          if (!matchedLine || requiredQuantity <= 0) {
            showToast(
              `不在ERP采购入库单：${normalizedModel}${normalizedVersion ? ` / ${normalizedVersion}` : ''}`,
              'error'
            );
            feedbackNotInOrder();
            return;
          }

          if (progress.some(line => ['unmatched', 'invalid', 'over'].includes(line.status))) {
            throw new Error('本单存在不匹配或超量的记录，请先核对异常明细');
          }
          const scannedQuantity = matchedLine.scannedQuantity;
          if (scannedQuantity + quantity > requiredQuantity) {
            const remainingQuantity = Math.max(0, requiredQuantity - scannedQuantity);
            showToast(
              remainingQuantity > 0
                ? `超出本单数量：最多还可入 ${remainingQuantity.toLocaleString()}`
                : `本物料已扫够：${matchedLine.specification || normalizedModel}`,
              'warning'
            );
            feedbackOverQuantity();
            return;
          }
        }

        // 检查是否重复扫描（只检测追溯码，因为箱号可能重复）
        let isDuplicate = false;

        // 无追溯码的相同标签继续允许逐次扫描，不按二维码内容去重。
        const traceNo = parsedRecord.traceNo?.trim() || '';
        if (traceNo) {
          const existing = scanRecordsRef.current.find((r) => r.traceNo?.trim() === traceNo);
          if (existing) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        // 每包只保存一次草稿，成功后再更新数量和播放确认语音。
        const newRecord: ScanRecord = {
          id: generateId(),
          model: normalizedModel,
          batch: parsedRecord.batch,
          quantity,
          scanTime: formatDateTime(new Date().toISOString()),
          rawContent: code,
          inventoryCode: normalizedInventoryCode || undefined,
          supplier: activeErpVoucher.partnerName || undefined,
          ruleId: parsedRecord.ruleId,
          ruleName: parsedRecord.ruleName,
          // 扩展字段
          package: parsedRecord.package || undefined,
          version: normalizedVersion || undefined,
          productionDate: parsedRecord.productionDate || undefined,
          traceNo: traceNo || undefined,
          sourceNo: parsedRecord.sourceNo || undefined,
          // 占位字段解析值
          customFields: parsedRecord.customFields,
        };
        if (!isSessionActive(sessionId) || erpVoucherRef.current !== activeErpVoucher) return;
        const nextRecords = [newRecord, ...scanRecordsRef.current];
        if (!(await saveScanRecords(nextRecords, activeErpVoucher.partnerName || currentSupplier))) {
          if (isSessionActive(sessionId)) {
            draftReadyRef.current = false;
            setDraftReady(false);
            scanQueueRef.current = [];
            liveInputValueRef.current = '';
            setInputValue('');
            cancelScanSubmit(autoSubmitTimerRef);
          }
          throw new Error('扫码草稿保存失败，本次和排队扫码均未确认成功，请点击刷新恢复后核对重扫');
        }
        if (!isSessionActive(sessionId)) return;
        scanRecordsRef.current = nextRecords;
        setScanRecords(nextRecords);
        showToast(`已扫码：${normalizedModel}`, 'success');
        feedbackSuccess();
      } catch (e) {
        if (!isSessionActive(sessionId)) return;
        logger.error('[扫码入库] 处理失败:', e);
        const errorMessage = formatUserFacingErrorMessage(e, '二维码解析失败，请检查标签内容');
        logger.error('[扫码入库] 错误详情:', {
          code,
          codeLength: code.length,
          parsed,
          processingRef: processingRef.current,
          scanQueueLength: scanQueueRef.current.length,
        });
        showToast(`录入失败：${errorMessage}`, 'error');
        feedbackError();
      } finally {
        // 处理完成后，检查队列是否有待处理的扫码
        // 注意：使用 setTimeout 让 React 有机会更新状态，避免重复检测失败
        if (isSessionActive(sessionId)) {
          if (postProcessTimerRef.current) {
            clearTimeout(postProcessTimerRef.current);
          }
          postProcessTimerRef.current = setTimeout(() => {
            postProcessTimerRef.current = null;
            if (!isSessionActive(sessionId)) return;
            processingRef.current = false;
            if (scanQueueRef.current.length > 0) {
              const nextCode = scanQueueRef.current.shift();
              if (nextCode) processScanRef.current(nextCode);
            } else {
              focusScannerInput(50);
            }
          }, 0);
        }
      }
    },
    [
      currentSupplier,
      currentWarehouse,
      isSessionActive,
      focusScannerInput,
      saveScanRecords,
      showToast,
    ]
  );

  const processScanRef = useRef(processScan);
  useEffect(() => {
    processScanRef.current = processScan;
  }, [processScan]);

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback(
    (text: string) => {
      // 清除之前的定时器（每次输入都重置）
      cancelScanSubmit(autoSubmitTimerRef);

      // TextInput 是受控组件，非空内容也必须立即入状态，避免逐字符扫码被重渲染清空。
      if (!draftReadyRef.current || saveInProgressRef.current) return;
      liveInputValueRef.current = text;
      setInputValue(text);

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        scheduleScanSubmit(autoSubmitTimerRef, () => {
          const code = sanitizeStructuredScannerInput(text);
          // 检测到输入完成（输入停止超过阈值，认为扫码完成）
          if (code.length >= 1) {
            liveInputValueRef.current = '';
            setInputValue(''); // 清空输入框
            if (processingRef.current) {
              scanQueueRef.current.push(code);
              return;
            }
            processScan(code);
          }
        }, 150); // 150ms 防抖，等待扫码器输入完成
        return;
      }
    },
    [processScan]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback(() => {
    cancelScanSubmit(autoSubmitTimerRef);

    if (!draftReadyRef.current || saveInProgressRef.current) return;
    const code = sanitizeStructuredScannerInput(liveInputValueRef.current);

    if (!code) return;

    liveInputValueRef.current = '';
    setInputValue('');
    if (processingRef.current) {
      scanQueueRef.current.push(code);
      return;
    }

    processScan(code);
  }, [processScan]);

  const syncInboundSnapshot = async (
    records: InboundExportRecord[],
    warehouseName: string,
    inboundNo: string
  ): Promise<{ success: boolean; skipped: boolean; fileName?: string; message?: string }> => {
    const savedSyncConfig = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
    const syncConfig = savedSyncConfig
      ? safeJsonParseNullable<SyncConfig>(savedSyncConfig, 'inbound.syncConfig')
      : null;

    if (!syncConfig?.ip) {
      return { success: false, skipped: true };
    }

    const fileName = buildInboundExportFileNameFromNo(warehouseName, inboundNo);
    const result = await syncExcelToComputer(
      buildInboundSheets(records),
      '/inbound',
      syncConfig,
      undefined,
      undefined,
      undefined,
      fileName
    );

    return {
      success: result.success,
      skipped: false,
      fileName: result.fileName || fileName,
      message: result.message,
    };
  };

  const beginDraftMutation = useCallback(() => {
    if (saveInProgressRef.current) return false;
    if (!draftReadyRef.current || !erpVoucherRef.current) {
      showToast('本单草稿或ERP未验证，请点击刷新后重试', 'warning');
      return false;
    }
    if (processingRef.current || scanQueueRef.current.length > 0 || liveInputValueRef.current.trim()) {
      showToast('还有扫码内容正在处理，请处理完成后重试', 'warning');
      return false;
    }
    saveInProgressRef.current = true;
    setSaving(true);
    return true;
  }, [showToast]);

  // 确认入库
  const handleSaveInbound = async () => {
    if (!currentWarehouse) {
      showToast('请先选择仓库', 'warning');
      feedbackWarning();
      return;
    }

    if (!beginDraftMutation()) return;
    const sessionId = sessionIdRef.current;
    try {
      const recordsSnapshot = scanRecordsRef.current;
      if (recordsSnapshot.length === 0) {
        showToast('暂无扫描记录', 'warning');
        feedbackWarning();
        return;
      }

      const activeErpVoucher = erpVoucherRef.current;
      if (!activeErpVoucher || activeErpVoucher.accountKey !== selectedAccountKey ||
          activeErpVoucher.code.trim().toUpperCase() !== selectedVoucherCode ||
          inboundNo.trim().toUpperCase() !== selectedVoucherCode) {
        throw new Error('当前ERP单据未验证或与入库作业不一致，已阻止保存');
      }
      if (activeErpVoucher) {
        const account = selectedAccountKey ? getErpAccountByKey(selectedAccountKey) : null;
        if (!account) {
          showToast('未找到采购入库单所属账套', 'error');
          feedbackError();
          return;
        }

        let verifiedErpVoucher = activeErpVoucher;
        try {
          [verifiedErpVoucher] = await Promise.all([
            fetchPurchaseReceiveVoucher(account, activeErpVoucher.code, { bypassCache: true }),
            assertPurchaseReceiveUnaudited(account, activeErpVoucher.code, true),
          ]);
          if (!isSessionActive(sessionId)) return;
          if (verifiedErpVoucher.warehouseName.trim() !== currentWarehouse.name.trim()) {
            const message = `ERP仓库已变更为 ${verifiedErpVoucher.warehouseName || '-'}，请返回列表后重新进入单据`;
            setActiveErpVoucher(null);
            setErpVoucherError(message);
            throw new Error(message);
          }
          await savePurchaseReceiveVoucherCache(verifiedErpVoucher);
          if (!isSessionActive(sessionId)) return;
          setActiveErpVoucher(verifiedErpVoucher);
        } catch (error) {
          if (!isSessionActive(sessionId)) return;
          setActiveErpVoucher(null);
          draftReadyRef.current = false;
          setDraftReady(false);
          setErpVoucherError(formatUserFacingErrorMessage(error, 'ERP核验失败，请点击刷新'));
          showToast(
            formatUserFacingErrorMessage(
              error,
              '无法确认ERP单据最新状态，请稍后重试'
            ),
            'warning'
          );
          feedbackWarning();
          return;
        }

        const incompleteCount = buildInboundProgress(getPurchaseReceiveBindingLines(verifiedErpVoucher), recordsSnapshot)
          .filter(line => line.status !== 'complete').length;

        if (incompleteCount > 0) {
          showToast(`有 ${incompleteCount} 项数量与ERP最新明细不一致`, 'warning');
          feedbackWarning();
          return;
        }
      }

      // 批次内和历史追溯码判重由 addInboundRecordsBatch 在同一事务中执行。
      if (!isSessionActive(sessionId)) return;

      const today = formatDate(new Date().toISOString());
      const createdAt = getISODateTime();

      const recordsToSave: Parameters<typeof addInboundRecordsBatch>[0] = [];
      const exportRecords: InboundExportRecord[] = [];
      for (const record of recordsSnapshot) {
        const base = {
          id: record.id,
          inbound_no: inboundNo,
          warehouse_id: currentWarehouse.id,
          warehouse_name: currentWarehouse.name,
          erp_account_key: selectedAccountKey,
          inventory_code: record.inventoryCode || '',
          scan_model: record.model,
          batch: record.batch || '',
          quantity: record.quantity,
          in_date: today,
          notes: '',
          rawContent: record.rawContent || '',
          package: record.package || '',
          version: record.version || '',
          productionDate: record.productionDate || '',
          traceNo: record.traceNo || '',
          sourceNo: record.sourceNo || '',
          customFields: record.customFields,
          rule_id: record.ruleId,
          rule_name: record.ruleName,
        };
        recordsToSave.push(base);
        exportRecords.push({ ...base, created_at: createdAt });
      }
      const savedCount = recordsToSave.length;

      logger.log('[handleSaveInbound] 开始批量保存入库记录:', {
        count: savedCount,
        inboundNo,
        warehouseId: currentWarehouse.id,
      });

      await addInboundRecordsBatch(recordsToSave);
      if (isSessionActive(sessionId)) {
        draftReadyRef.current = false;
        setDraftReady(false);
        scanRecordsRef.current = [];
        setScanRecords([]);
      }
      let draftCleared = true;
      try {
        await clearScanRecords();
      } catch (draftError) {
        draftCleared = false;
        logger.warn('[handleSaveInbound] 入库已保存，但草稿清理失败:', draftError);
      }

      let syncResult: Awaited<ReturnType<typeof syncInboundSnapshot>> = {
        success: false,
        skipped: false,
        message: '电脑同步失败，请稍后重试',
      };
      try {
        syncResult = await syncInboundSnapshot(exportRecords, currentWarehouse.name, inboundNo);
      } catch (syncError) {
        logger.warn('[handleSaveInbound] 入库已保存，但同步流程异常:', syncError);
        syncResult = {
          success: false,
          skipped: false,
          message: syncError instanceof Error ? syncError.message : String(syncError),
        };
      }
      try {
        await updateInboundDocumentSyncStatus(
          inboundNo,
          currentWarehouse.id,
          syncResult.success ? 'success' : syncResult.skipped ? 'pending' : 'failed',
          syncResult.fileName,
          syncResult.message
        );
      } catch (statusError) {
        logger.warn('[handleSaveInbound] 入库单同步状态更新失败:', statusError);
      }

      if (!isSessionActive(sessionId)) return;
      setCurrentSupplier(null);
      expandedGroupsRef.current = new Set();
      confirmedGroupsRef.current = new Set();
      setExpandedGroups(new Set());
      setConfirmedGroups(new Set());

      if (syncResult.success) {
        showToast(
          syncResult.fileName
            ? `入库已保存并同步\n${syncResult.fileName}`
            : `入库已保存并同步，共 ${savedCount} 条`,
          'success'
        );
      } else if (!syncResult.skipped) {
        showToast(
          `入库已保存，稍后可在入库记录重新同步\n${formatSyncErrorMessage(syncResult.message)}`,
          'warning'
        );
      } else {
        showToast(`入库已保存，共 ${savedCount} 条`, 'success');
      }
      if (!draftCleared) {
        showToast('入库已保存，但本机草稿未能清理；请勿重复提交本单', 'warning');
      }
      feedbackInboundComplete();

      try {
        router.back();
      } catch (refreshError) {
        logger.error('[handleSaveInbound] 入库已保存，但刷新失败:', refreshError);
        showToast('入库已保存，但界面刷新失败，请重新进入页面确认', 'warning');
      }
    } catch (error) {
      if (!isSessionActive(sessionId)) return;
      logger.error('[handleSaveInbound] 保存失败:', error);
      const errorMessage = formatUserFacingErrorMessage(error, '入库保存失败，请稍后重试');
      showToast(`保存失败: ${errorMessage}`, 'error');
      feedbackError();
    } finally {
      if (isSessionActive(sessionId)) {
        scannerFocusBlockedRef.current = false;
        saveInProgressRef.current = false;
        setSaving(false);
        focusScannerInput(120);
      }
    }
  };

  // 清空记录
  const clearCurrentScanRecords = async () => {
    if (scanRecordsRef.current.length === 0 || !beginDraftMutation()) return;
    const sessionId = sessionIdRef.current;
    try {
      await clearScanRecords();
      if (!isSessionActive(sessionId)) return;
      scanRecordsRef.current = [];
      setScanRecords([]);
      confirmedGroupsRef.current = new Set();
      expandedGroupsRef.current = new Set();
      setConfirmedGroups(new Set());
      setExpandedGroups(new Set());
      setCurrentSupplier(erpVoucherRef.current?.partnerName || null);
      showToast('本单扫码记录已清空', 'warning');
      feedbackClear();
    } catch (error) {
      if (!isSessionActive(sessionId)) return;
      logger.error('清空扫描记录失败:', error);
      draftReadyRef.current = false;
      setDraftReady(false);
      showToast('清空失败，请点击刷新恢复并核对草稿', 'error');
      void feedbackClearFailed();
    } finally {
      if (isSessionActive(sessionId)) {
        saveInProgressRef.current = false;
        setSaving(false);
        focusScannerInput(100);
      }
    }
  };

  const handleClearRecords = () => {
    if (saving || scanRecords.length === 0) return;

    alert.showConfirm(
      '清空本单扫码记录',
      '只会清空本机尚未保存的扫码记录，不会修改 ERP 采购入库单。确定继续吗？',
      () => {
        void clearCurrentScanRecords();
      },
      true
    );
  };

  // 切换展开/折叠
  const toggleExpand = useCallback((key: string) => {
    const next = new Set(expandedGroupsRef.current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    expandedGroupsRef.current = next;
    setExpandedGroups(next);
  }, []);

  // 切换确认状态
  const toggleConfirm = useCallback((key: string) => {
    const next = new Set(confirmedGroupsRef.current);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    confirmedGroupsRef.current = next;
    setConfirmedGroups(next);
  }, []);

  // 删除单条记录
  const handleDeleteRecord = useCallback(
    (record: ScanRecord) => {
      alert.showConfirm(
        '确认删除',
        '确定要删除这条记录吗？',
        () => {
          void (async () => {
            if (!beginDraftMutation()) return;
            const sessionId = sessionIdRef.current;
            try {
              const updated = scanRecordsRef.current.filter((r) => r.id !== record.id);
              if (!(await saveScanRecords(updated))) {
                if (!isSessionActive(sessionId)) return;
                draftReadyRef.current = false;
                setDraftReady(false);
                showToast('删除失败，请点击刷新恢复并核对草稿', 'error');
                feedbackError();
                return;
              }
              if (!isSessionActive(sessionId)) return;
              scanRecordsRef.current = updated;
              setScanRecords(updated);
              showToast('记录已删除', 'success');
            } finally {
              if (isSessionActive(sessionId)) {
                saveInProgressRef.current = false;
                setSaving(false);
              }
            }
          })();
        },
        true
      );
    },
    [alert, beginDraftMutation, isSessionActive, saveScanRecords, showToast]
  );

  // 计算总数量
  const totalQuantity = scanRecords.reduce((sum, r) => sum + r.quantity, 0);

  // 计算已确认数量
  const confirmedCount = confirmedGroups.size;
  const currentInboundStep = scanRecords.length === 0 ? 'scan' : 'review';
  const currentInboundPlaceholder = erpVoucherLoading
    ? '正在读取ERP采购入库单...'
    : erpVoucherError
      ? 'ERP采购入库单加载失败'
      : currentInboundStep === 'scan'
        ? '持续扫描物料二维码'
        : '继续扫描或确认保存';

  // 入库作业按型号聚合；不同版本保留在展开明细中，不重复计算型号数。
  const aggregatedRecords = useMemo(() => {
    const map = new Map<
      string,
      { model: string; records: ScanRecord[]; totalQuantity: number }
    >();

    scanRecords.forEach((record) => {
      const model = normalizeInboundModel(record.model);
      const key = buildInboundModelKey(model);
      if (!map.has(key)) {
        map.set(key, { model, records: [], totalQuantity: 0 });
      }
      const group = map.get(key)!;
      group.records.push(record);
      group.totalQuantity += record.quantity;
    });

    return Array.from(map.values())
      .map((group) => {
        const records = group.records.slice().sort((a, b) => b.id.localeCompare(a.id));
        return {
          model: group.model,
          version: '',
          records,
          totalQuantity: group.totalQuantity,
          count: group.records.length,
        };
      })
      .sort((a, b) => (b.records[0]?.id || '').localeCompare(a.records[0]?.id || ''));
  }, [scanRecords]) as InboundAggregatedRecord[];

  const erpLineProgressItems = useMemo<InboundErpLineProgress[]>(() => {
    if (!erpVoucher) {
      return [];
    }

    return buildInboundProgress(getPurchaseReceiveBindingLines(erpVoucher), scanRecords).map(({ scannedItems, ...line }) => ({
      ...line,
      scannedRecords: scannedItems,
    }));
  }, [erpVoucher, scanRecords]);

  const erpCompletedLineCount = useMemo(
    () => erpLineProgressItems.filter((line) => line.status === 'complete').length,
    [erpLineProgressItems]
  );
  const incompleteErpLineCount = erpVoucher
    ? Math.max(0, erpLineProgressItems.length - erpCompletedLineCount)
    : 0;
  const inboundReadyToSave = draftReady && Boolean(erpVoucher) &&
    erpLineProgressItems.length > 0 && incompleteErpLineCount === 0;
  const inboundSaveLabel = inboundReadyToSave
    ? '完成入库'
    : !draftReady || !erpVoucher ? '请刷新核验' : `待核对 ${incompleteErpLineCount} 项`;

  const inboundListState = useMemo(
    () => `${[...expandedGroups].join('|')}::${[...confirmedGroups].join('|')}`,
    [expandedGroups, confirmedGroups]
  );

  const workflowSummaryItems = useMemo(
    () =>
      erpVoucher
        ? [
            {
              key: 'account',
              label: '账套',
              value: erpVoucher.accountName,
              icon: 'layers' as const,
              color: theme.success,
            },
            {
              key: 'inboundNo',
              label: '入库单号',
              value: inboundNo || erpVoucher.code,
              icon: 'file-text' as const,
              color: theme.success,
            },
            {
              key: 'supplier',
              label: '供应商',
              value: currentSupplier || erpVoucher.partnerName || 'ERP未返回',
              icon: 'truck' as const,
              color: currentSupplier || erpVoucher.partnerName ? theme.success : theme.warning,
            },
          ]
        : [
            {
              key: 'warehouse',
              label: '仓库',
              value: currentWarehouse?.name || Str.labelSelectWarehouse,
              icon: 'archive' as const,
              color: theme.primary,
            },
            {
              key: 'inboundNo',
              label: '入库单号',
              value: inboundNo || '首扫后生成',
              icon: 'file-text' as const,
              color: inboundNo ? theme.success : theme.textMuted,
            },
            {
              key: 'supplier',
              label: '供应商',
              value: currentSupplier || '待识别',
              icon: 'truck' as const,
              color: currentSupplier ? theme.success : theme.warning,
            },
          ],
    [
      currentSupplier,
      currentWarehouse?.name,
      erpVoucher,
      inboundNo,
      theme.primary,
      theme.success,
      theme.textMuted,
      theme.warning,
    ]
  );

  const renderInboundLeading = useCallback(
    (key: string) => {
      const isConfirmed = confirmedGroupsRef.current.has(key);

      return (
        <TouchableOpacity
          style={styles.checkbox}
          activeOpacity={0.7}
          onPress={() => toggleConfirm(key)}
        >
          <FontAwesome6
            name={isConfirmed ? 'square-check' : 'square'}
            size={18}
            color={isConfirmed ? theme.success : theme.textMuted}
          />
        </TouchableOpacity>
      );
    },
    [styles.checkbox, theme.success, theme.textMuted, toggleConfirm]
  );

  const renderInboundDetail = useCallback(
    (record: ScanRecord) => (
      <TouchableOpacity
        key={record.id}
        style={styles.detailItem}
        onLongPress={() => handleDeleteRecord(record)}
        delayLongPress={500}
      >
        <Text style={styles.detailText}>
          版本: {record.version || '-'} | 批次: {record.batch || '-'} | 生产日期:{' '}
          {record.productionDate || '-'} | 数量: {record.quantity}
        </Text>
      </TouchableOpacity>
    ),
    [handleDeleteRecord, styles.detailItem, styles.detailText]
  );

  const renderAggregatedRecord = useCallback(
    ({ item }: { item: InboundAggregatedRecord }) => {
      const key = `${item.model}|${item.version}`;
      const isExpanded = expandedGroupsRef.current.has(key);
      const isConfirmed = confirmedGroupsRef.current.has(key);

      return (
        <AggregatedRecordItem
          groupKey={key}
          model={item.model}
          version={item.version}
          totalQuantity={item.totalQuantity}
          records={item.records}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          recordSignatureFields={INBOUND_RECORD_SIGNATURE_FIELDS}
          compareValues={[item.count, isConfirmed]}
          containerStyle={styles.itemContainer}
          rowStyle={[styles.itemRow, isConfirmed && styles.itemConfirmed]}
          contentStyle={styles.modelContent}
          titleStyle={[styles.itemModel, isConfirmed && styles.itemModelConfirmed]}
          subtitleStyle={[styles.itemBatch, isConfirmed && styles.itemModelConfirmed]}
          quantityStyle={[styles.itemQty, isConfirmed && styles.itemQtyConfirmed]}
          detailsContainerStyle={styles.detailsContainer}
          chevronColor={isConfirmed ? theme.success : theme.textPrimary}
          toggleOnRowPress={false}
          renderLeading={renderInboundLeading}
          renderDetail={renderInboundDetail}
        />
      );
    },
    [
      renderInboundDetail,
      renderInboundLeading,
      styles,
      theme.success,
      theme.textPrimary,
      toggleExpand,
    ]
  );

  const renderErpLineProgress = useCallback(
    ({ item }: { item: InboundErpLineProgress }) => {
      const isExpanded = expandedGroupsRef.current.has(item.key);
      const progressRatio =
        item.requiredQuantity > 0
          ? Math.min(1, Math.max(0, item.scannedQuantity / item.requiredQuantity))
          : 0;
      const statusMeta =
        item.status === 'complete'
          ? { label: '完成', color: theme.success }
          : item.status === 'partial'
            ? { label: '进行中', color: theme.primary }
            : item.status === 'pending'
              ? { label: '待扫', color: theme.textMuted }
              : { label: item.status === 'over' ? '超出应入数量' : item.status === 'unmatched' ? '已不在本单' : '数量异常', color: theme.error };

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
                  应入 {item.requiredQuantity.toLocaleString()} / 已扫{' '}
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
              {item.scannedRecords.length > 0 ? (
                item.scannedRecords.map((record) => (
                  <TouchableOpacity
                    key={record.id}
                    style={styles.erpLineDetailItem}
                    activeOpacity={0.76}
                    onLongPress={() => handleDeleteRecord(record)}
                    delayLongPress={500}
                  >
                    <Text style={styles.detailText}>
                      {record.model}{record.version ? ` / ${record.version}` : ''} · 数量{' '}
                      {record.quantity.toLocaleString()}
                    </Text>
                    <Text style={styles.detailText}>
                      批次: {record.batch || '-'} | 追溯码: {record.traceNo || '-'}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.erpLineEmptyText}>尚未扫描本物料</Text>
              )}
            </View>
          ) : null}
        </View>
      );
    },
    [handleDeleteRecord, styles, theme.error, theme.primary, theme.success, theme.textMuted, toggleExpand]
  );

  const aggregatedRecordKeyExtractor = useCallback(
    (item: InboundAggregatedRecord) => `${item.model}|${item.version}`,
    []
  );

  const erpLineKeyExtractor = useCallback((item: InboundErpLineProgress) => item.key, []);

  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      safeAreaEdges={['top', 'left', 'right']}
    >
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title="入库扫描"
            onBack={() => {
              if (saveInProgressRef.current || processingRef.current || scanQueueRef.current.length > 0) {
                showToast('正在处理入库数据，请完成后返回', 'warning');
                return;
              }
              router.back();
            }}
            backLabel="返回采购入库单列表"
            rightIcon="refresh-cw"
            rightLabel="刷新ERP采购入库单与草稿"
            rightDisabled={erpVoucherLoading || saving}
            onRightPress={() => {
              void handleRefreshErpVoucher();
            }}
          />

          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        {/* 扫码输入 */}
        <WarehouseScanInput
          inputRef={inputRef}
          active={inputValue.length > 0}
          processing={erpVoucherLoading || saving}
          statusLabel={
            erpVoucherLoading
              ? '正在读取ERP采购入库单'
              : erpVoucher
                ? '采购入库扫码核对'
                : currentInboundStep === 'scan'
                  ? '入库扫码录入'
                  : '继续扫码或确认保存'
          }
          value={inputValue}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSubmitEditing}
          placeholder={currentInboundPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={!alert.visible}
          editable={draftReady && !saving && !erpVoucherLoading && Boolean(erpVoucher)}
          showSoftInputOnFocus={false}
          actionLabel="提交入库扫码内容"
          actionDisabled={!draftReady || !erpVoucher || saving}
          actionLoading={erpVoucherLoading}
          onActionPress={() => {
            if (inputValue.trim()) {
              handleSubmitEditing();
              return;
            }
            focusScannerInput(0);
          }}
        />

        {/* 物料列表 */}
        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>{erpVoucher ? '本单物料' : '待入库记录'}</Text>
            <Text style={styles.listCount}>
              {erpVoucher
                ? `${erpCompletedLineCount}/${erpLineProgressItems.length} 完成`
                : `${aggregatedRecords.length} 型号 / ${totalQuantity} PCS${
                    confirmedCount > 0 ? ` / 已确认 ${confirmedCount}` : ''
                  }`}
            </Text>
          </View>
          {erpVoucher ? (
            <FlatList
              style={styles.list}
              contentContainerStyle={
                erpLineProgressItems.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              data={erpLineProgressItems}
              renderItem={renderErpLineProgress}
              keyExtractor={erpLineKeyExtractor}
              extraData={inboundListState}
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="package"
                  title="ERP单据无明细"
                  description="请返回待入库单刷新后重试"
                  compact
                  style={styles.empty}
                />
              }
            />
          ) : (
            <FlatList
              style={styles.list}
              contentContainerStyle={
                aggregatedRecords.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              data={aggregatedRecords}
              renderItem={renderAggregatedRecord}
              keyExtractor={aggregatedRecordKeyExtractor}
              extraData={inboundListState}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              maxToRenderPerBatch={16}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="package"
                  title={erpVoucherError ? 'ERP单据加载失败' : '暂无扫描记录'}
                  description={erpVoucherError || '扫码后的待入库记录会显示在这里'}
                  compact
                  style={styles.empty}
                />
              }
            />
          )}

          {/* 操作按钮 */}
          {scanRecords.length > 0 && (
            <UiSafeBottomBar style={styles.actionBar}>
              <View style={styles.clearBtn}>
                <UiToolbarButton
                  label={Str.btnClear}
                  icon="trash-2"
                  variant="secondary"
                  disabled={saving || !draftReady}
                  onPress={handleClearRecords}
                  style={styles.actionButton}
                />
              </View>
              <View style={styles.submitBtn}>
                <UiToolbarButton
                  label={inboundSaveLabel}
                  icon="check-circle"
                  variant="success"
                  color={theme.success}
                  onPress={handleSaveInbound}
                  disabled={saving || !inboundReadyToSave}
                  loading={saving}
                  style={styles.actionButton}
                />
              </View>
            </UiSafeBottomBar>
          )}
        </View>

        {alert.AlertComponent}
        <ToastContainer />
      </View>
    </Screen>
  );
}
