import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  Platform,
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
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
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
  parseWithRule,
  getInventoryCodeByModel,
  generateId,
  updateInboundDocumentSyncStatus,
  checkInboundTraceNoExists,
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
import { sanitizeStructuredScannerInput, shouldIgnoreRecentDuplicateScan } from '@/utils/scannerInput';
import {
  getErpAccountByKey,
  type ErpAccountConfig,
  type ErpAccountKey,
} from '@/utils/erpAccounts';
import {
  fetchPurchaseReceiveVoucherStatuses,
  fetchPurchaseReceiveVoucher,
  loadCachedPurchaseReceiveVoucher,
  loadCachedPurchaseReceiveVoucherStatuses,
  savePurchaseReceiveVoucherCache,
  savePurchaseReceiveVoucherStatusesCache,
  type PurchaseReceiveVoucher,
} from '@/utils/erpPurchaseReceive';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
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
  status: 'complete' | 'partial' | 'pending';
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
  const routeParams = useSafeSearchParams<{ accountKey?: ErpAccountKey; voucherCode?: string }>();
  const selectedVoucherCode = (routeParams.voucherCode || '').trim().toUpperCase();
  const selectedAccountKey = routeParams.accountKey;

  // 输入
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const processingRef = useRef(false);
  const inboundDraftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const scannerFocusBlockedRef = useRef(false);
  // 扫码队列 - 暂存处理中的新扫码（字符串队列，用于 processing 中排队）
  const scanQueueRef = useRef<string[]>([]);
  // 扫码记录缓冲队列 - 批量 flush 到 scanRecords，避免每次扫码都重渲染
  const pendingRecordsRef = useRef<ScanRecord[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 防抖相关
  const lastScanRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);

  const shouldAcceptScanCode = useCallback((code: string) => {
    if (shouldIgnoreRecentDuplicateScan(code, lastScanRef, lastScanTimeRef)) {
      logger.warn('[扫码入库] 忽略短时间重复扫码:', code);
      return false;
    }

    return true;
  }, []);

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
    scannerFocusBlockedRef.current = saving || erpVoucherLoading;
  }, [erpVoucherLoading, saving]);

  const focusScannerInput = useCallback((delay = 80) => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }

    focusTimerRef.current = setTimeout(() => {
      focusTimerRef.current = null;
      if (screenActiveRef.current && !scannerFocusBlockedRef.current) {
        inputRef.current?.focus();
      }
    }, delay);
  }, []);

  useEffect(
    () => () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
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
      try {
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
            return null;
          }
          const records = await normalizeInboundDraftRecords(parsedRecords);
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
              return null;
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
              logger.warn('[loadScanRecords] 草稿账套与当前ERP账套不一致，跳过恢复:', {
                savedAccountKey: data.accountKey,
                currentAccountKey: selectedAccountKey,
              });
              return null;
            }

            // 验证保存时的仓库是否与当前仓库匹配
            if (data.warehouseId && data.warehouseId !== currentWarehouseId) {
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
      } catch (error) {
        logger.error('加载扫描记录失败:', error);
      }

      return null;
    },
    [getInboundDraftKeys, getLegacyInboundDraftKeys, selectedAccountKey, showToast]
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
    const legacyScopedDraftKeys = getLegacyInboundDraftKeys(currentWarehouse?.id);
    await enqueueInboundDraftWrite(() =>
      AsyncStorage.multiRemove([
        draftKeys.recordsKey,
        draftKeys.pendingKey,
        legacyScopedDraftKeys.recordsKey,
        legacyScopedDraftKeys.pendingKey,
        INBOUND_SCAN_RECORDS_KEY,
        INBOUND_PENDING_DATA_KEY,
      ])
    );
  };

  // 初始化
  // 自动清理震动和提示音
  useFeedbackCleanup();

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
      try {
        await assertPurchaseReceiveUnaudited(
          account,
          selectedVoucherCode,
          options.forceRefresh
        );
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message.includes('已在ERP审核')) {
          throw statusError;
        }
        logger.warn('[扫码入库] 审核消息状态读取失败:', statusError);
        throw new Error('无法确认ERP审核状态，请检查网络后重试');
      }

      const existingRecords = await getInboundRecordsByNo(selectedVoucherCode);
      const alreadyCompleted = existingRecords.some(
        (record) => (record.warehouse_name || '').trim() === account.expectedWarehouseName
      );
      if (alreadyCompleted) {
        throw new Error(
          `${selectedVoucherCode} 已在本机完成入库，请到单据管理查看，不能重复扫码`
        );
      }

      const cached = options.forceRefresh
        ? null
        : await loadCachedPurchaseReceiveVoucher(account.key, selectedVoucherCode);
      const voucher =
        cached?.data ||
        (await fetchPurchaseReceiveVoucher(account, selectedVoucherCode, {
          bypassCache: options.forceRefresh,
        }));
      if (!cached) {
        await savePurchaseReceiveVoucherCache(voucher);
      }
      setActiveErpVoucher(voucher);
      return voucher;
    } catch (error) {
      setActiveErpVoucher(null);
      setErpVoucherError(
        formatUserFacingErrorMessage(error, '采购入库单加载失败，请稍后重试')
      );
      throw error;
    } finally {
      setErpVoucherLoading(false);
    }
  }, [
    assertPurchaseReceiveUnaudited,
    selectedAccountKey,
    selectedVoucherCode,
    setActiveErpVoucher,
  ]);

  const handleRefreshErpVoucher = useCallback(async () => {
    if (!selectedVoucherCode || !selectedAccountKey || erpVoucherLoading || saving) {
      focusScannerInput(0);
      return;
    }

    try {
      const voucher = await loadSelectedErpVoucher({ forceRefresh: true });
      if (
        currentWarehouse &&
        voucher.warehouseName.trim() !== currentWarehouse.name.trim()
      ) {
        const message = `ERP仓库已变更为 ${voucher.warehouseName || '-'}，请返回列表后重新进入单据`;
        setActiveErpVoucher(null);
        setErpVoucherError(message);
        throw new Error(message);
      }
      setCurrentSupplier(voucher.partnerName || null);
      setInboundNo(voucher.code);
      showToast('ERP采购入库单已刷新', 'success');
    } catch (error) {
      showToast(formatUserFacingErrorMessage(error, 'ERP刷新失败，请稍后重试'), 'warning');
    } finally {
      focusScannerInput(100);
    }
  }, [
    currentWarehouse,
    erpVoucherLoading,
    focusScannerInput,
    loadSelectedErpVoucher,
    saving,
    selectedAccountKey,
    selectedVoucherCode,
    setActiveErpVoucher,
    showToast,
  ]);

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      let isActive = true;
      const init = async () => {
        try {
          // 1. 加载仓库列表（数据库已在 APP 启动时初始化）
          const list = await getAllWarehouses();

          const selectedVoucher = await loadSelectedErpVoucher();

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
        if (autoSubmitTimerRef.current) {
          clearTimeout(autoSubmitTimerRef.current);
          autoSubmitTimerRef.current = null;
        }
        if (focusTimerRef.current) {
          clearTimeout(focusTimerRef.current);
          focusTimerRef.current = null;
        }
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
          postProcessTimerRef.current = null;
        }
      };
    }, [focusScannerInput, loadScanRecords, loadSelectedErpVoucher, showToast])
  );

  // 批量 flush 缓冲的扫码记录到 state
  const flushPendingRecords = useCallback((): ScanRecord[] => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingRecordsRef.current.length === 0) {
      return scanRecordsRef.current;
    }

    const merged = [...pendingRecordsRef.current, ...scanRecordsRef.current];
    pendingRecordsRef.current = [];
    scanRecordsRef.current = merged;
    setScanRecords(merged);
    void saveScanRecords(merged, currentSupplier);
    return merged;
  }, [currentSupplier, saveScanRecords]);

  // 处理扫描（带参数版本，供自动触发调用）
  const processScan = useCallback(
    async (code: string) => {
      if (!code || processingRef.current) return;

      const activeErpVoucher = erpVoucherRef.current;

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
          const rule = await detectRule(code);
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
            if (!isQRCode(code)) {
              return;
            }
            showToast('没有匹配的二维码解析规则，请先在设置中配置', 'error');
            feedbackError();
            return;
          }
        } catch (e) {
          logger.error('[扫码入库] 规则解析失败:', e);
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
        const inventoryCode = await getInventoryCodeByModel(
          normalizedModel,
          normalizedVersion
        );
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

          const matchedLine = activeErpVoucher.lines.find(
            (line) => getInventoryCodeMatchKey(line.inventoryCode) === inventoryCodeMatchKey
          );
          const requiredQuantity = activeErpVoucher.lines.reduce(
            (sum, line) =>
              getInventoryCodeMatchKey(line.inventoryCode) === inventoryCodeMatchKey
                ? sum + line.quantity
                : sum,
            0
          );

          if (!matchedLine || requiredQuantity <= 0) {
            showToast(
              `不在ERP采购入库单：${normalizedModel}${normalizedVersion ? ` / ${normalizedVersion}` : ''}`,
              'error'
            );
            feedbackNotInOrder();
            return;
          }

          const scannedQuantity = [...pendingRecordsRef.current, ...scanRecordsRef.current].reduce(
            (sum, record) =>
              getInventoryCodeMatchKey(record.inventoryCode) === inventoryCodeMatchKey
                ? sum + record.quantity
                : sum,
            0
          );
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

        // 根据追溯码判断（已保存的记录 + 缓冲中未 flush 的记录）
        if (parsedRecord.traceNo) {
          const allCurrentRecords = [...pendingRecordsRef.current, ...scanRecordsRef.current];
          const existing = allCurrentRecords.find((r) => r.traceNo === parsedRecord.traceNo);
          if (existing) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        // 新增记录（保存原始记录，不合并数量）——先放入缓冲队列，批量 flush 到 UI
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
          traceNo: parsedRecord.traceNo || undefined,
          sourceNo: parsedRecord.sourceNo || undefined,
          // 占位字段解析值
          customFields: parsedRecord.customFields,
        };
        pendingRecordsRef.current.push(newRecord);
        void saveScanRecords(
          [...pendingRecordsRef.current, ...scanRecordsRef.current],
          activeErpVoucher.partnerName || currentSupplier
        );
        showToast(`已扫码：${normalizedModel}`, 'success');
        feedbackSuccess();
      } catch (e) {
        logger.error('[扫码入库] 处理失败:', e);
        const errorMessage = formatUserFacingErrorMessage(e, '二维码解析失败，请检查标签内容');
        logger.error('[扫码入库] 错误详情:', {
          code,
          codeLength: code.length,
          parsed,
          processingRef: processingRef.current,
          scanQueueLength: scanQueueRef.current.length,
        });
        showToast(`解析失败：${errorMessage}\n长度: ${code.length}`, 'error');
        feedbackError();
      } finally {
        processingRef.current = false;
        // 处理完成后，检查队列是否有待处理的扫码
        // 注意：使用 setTimeout 让 React 有机会更新状态，避免重复检测失败
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
        }
        postProcessTimerRef.current = setTimeout(() => {
          postProcessTimerRef.current = null;
          if (!screenActiveRef.current) {
            return;
          }
          if (scanQueueRef.current.length > 0) {
            logger.log('[扫码入库] 队列中有待处理扫码:', scanQueueRef.current.length);
            const nextCode = scanQueueRef.current.shift();
            if (nextCode) {
              processScanRef.current(nextCode);
            }
          } else {
            // 队列空了，启动 flush timer 批量刷新 UI
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                flushPendingRecords();
              }, 200);
            }
            // 短暂延迟后聚焦，等待 flush 完成
            focusScannerInput(50);
          }
        }, 0);
      }
    },
    [
      currentSupplier,
      currentWarehouse,
      flushPendingRecords,
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
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }

      // TextInput 是受控组件，非空内容也必须立即入状态，避免逐字符扫码被重渲染清空。
      setInputValue(text);

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        autoSubmitTimerRef.current = setTimeout(() => {
          autoSubmitTimerRef.current = null;
          const code = sanitizeStructuredScannerInput(text);
          // 检测到输入完成（输入停止超过阈值，认为扫码完成）
          if (code.length >= 1) {
            if (!shouldAcceptScanCode(code)) {
              setInputValue('');
              focusScannerInput(0);
              return;
            }
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
    [focusScannerInput, processScan, shouldAcceptScanCode]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback(() => {
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    const code = sanitizeStructuredScannerInput(inputValue);

    if (!code) return;

    if (!shouldAcceptScanCode(code)) {
      setInputValue('');
      focusScannerInput(0);
      return;
    }

    setInputValue('');
    if (processingRef.current) {
      scanQueueRef.current.push(code);
      return;
    }

    processScan(code);
  }, [focusScannerInput, inputValue, processScan, shouldAcceptScanCode]);

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

  // 确认入库
  const handleSaveInbound = async () => {
    if (saveInProgressRef.current) {
      return;
    }
    if (!currentWarehouse) {
      showToast('请先选择仓库', 'warning');
      feedbackWarning();
      return;
    }

    saveInProgressRef.current = true;
    setSaving(true);
    try {
      const recordsSnapshot = flushPendingRecords();
      if (recordsSnapshot.length === 0) {
        showToast('暂无扫描记录', 'warning');
        feedbackWarning();
        return;
      }

      const activeErpVoucher = erpVoucherRef.current;
      if (activeErpVoucher) {
        const account = selectedAccountKey ? getErpAccountByKey(selectedAccountKey) : null;
        if (!account) {
          showToast('未找到采购入库单所属账套', 'error');
          feedbackError();
          return;
        }

        let verifiedErpVoucher = activeErpVoucher;
        try {
          await assertPurchaseReceiveUnaudited(account, activeErpVoucher.code, true);
          verifiedErpVoucher = await fetchPurchaseReceiveVoucher(account, activeErpVoucher.code, {
            bypassCache: true,
          });
          if (verifiedErpVoucher.warehouseName.trim() !== currentWarehouse.name.trim()) {
            const message = `ERP仓库已变更为 ${verifiedErpVoucher.warehouseName || '-'}，请返回列表后重新进入单据`;
            setActiveErpVoucher(null);
            setErpVoucherError(message);
            throw new Error(message);
          }
          await savePurchaseReceiveVoucherCache(verifiedErpVoucher);
          setActiveErpVoucher(verifiedErpVoucher);
        } catch (error) {
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

        const requiredByInventoryCode = new Map<string, number>();
        verifiedErpVoucher.lines.forEach((line) => {
          const inventoryCode = getInventoryCodeMatchKey(line.inventoryCode);
          requiredByInventoryCode.set(
            inventoryCode,
            (requiredByInventoryCode.get(inventoryCode) || 0) + line.quantity
          );
        });
        const scannedByInventoryCode = new Map<string, number>();
        recordsSnapshot.forEach((record) => {
          const inventoryCode = getInventoryCodeMatchKey(record.inventoryCode);
          scannedByInventoryCode.set(
            inventoryCode,
            (scannedByInventoryCode.get(inventoryCode) || 0) + record.quantity
          );
        });
        const comparedInventoryCodes = new Set([
          ...requiredByInventoryCode.keys(),
          ...scannedByInventoryCode.keys(),
        ]);
        const incompleteCount = Array.from(comparedInventoryCodes).filter(
          (inventoryCode) =>
            (scannedByInventoryCode.get(inventoryCode) || 0) !==
            (requiredByInventoryCode.get(inventoryCode) || 0)
        ).length;

        if (incompleteCount > 0) {
          showToast(`有 ${incompleteCount} 项数量与ERP最新明细不一致`, 'warning');
          feedbackWarning();
          return;
        }
      }

      // 数据库级 traceNo 重复检测
      const traceNoRecords = recordsSnapshot.filter((r) => r.traceNo && r.traceNo.trim());
      if (traceNoRecords.length > 0) {
        const uniqueTraceNos = [...new Set(traceNoRecords.map((r) => r.traceNo!.trim()))];
        const currentDraftRecordIds = recordsSnapshot.map((record) => record.id).filter(Boolean);
        const checkResults = await Promise.all(
          uniqueTraceNos.map(async (traceNo) => ({
            traceNo,
            exists: await checkInboundTraceNoExists(traceNo, undefined, currentDraftRecordIds),
          }))
        );
        const duplicates = checkResults.filter((r) => r.exists).map((r) => r.traceNo);
        if (duplicates.length > 0) {
          alert.showAlert(
            '重复追踪码',
            `以下追踪码已存在于数据库中，无法重复入库：\n${duplicates.join('\n')}`,
            [{ text: '确定' }],
            'warning'
          );
          feedbackWarning();
          return;
        }
      }

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

      // 主写入成功后立即清草稿，避免后续刷新失败导致重复入库
      pendingRecordsRef.current = [];
      scanRecordsRef.current = [];
      setScanRecords([]);
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
      logger.error('[handleSaveInbound] 保存失败:', error);
      const errorMessage = formatUserFacingErrorMessage(error, '入库保存失败，请稍后重试');
      showToast(`保存失败: ${errorMessage}`, 'error');
      feedbackError();
    } finally {
      scannerFocusBlockedRef.current = false;
      saveInProgressRef.current = false;
      setSaving(false);
      focusScannerInput(120);
    }
  };

  // 清空记录
  const clearCurrentScanRecords = async () => {
    if (saving || (scanRecords.length === 0 && pendingRecordsRef.current.length === 0)) return;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      await clearScanRecords();
      pendingRecordsRef.current = [];
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
      logger.error('清空扫描记录失败:', error);
      showToast('清空失败，请重试', 'error');
      feedbackError();
    } finally {
      focusScannerInput(100);
    }
  };

  const handleClearRecords = () => {
    if (saving || (scanRecords.length === 0 && pendingRecordsRef.current.length === 0)) return;

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
            const recordsSnapshot = flushPendingRecords();
            const updated = recordsSnapshot.filter((r) => r.id !== record.id);
            if (!(await saveScanRecords(updated))) {
              showToast('删除失败，草稿未能保存，请重试', 'error');
              feedbackError();
              return;
            }
            scanRecordsRef.current = updated;
            setScanRecords(updated);
            showToast('记录已删除', 'success');
          })();
        },
        true
      );
    },
    [alert, flushPendingRecords, saveScanRecords, showToast]
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

    const progressMap = new Map<string, InboundErpLineProgress>();
    erpVoucher.lines.forEach((line) => {
      const inventoryCode = getInventoryCodeMatchKey(line.inventoryCode);
      const key = `erp-inbound:${inventoryCode || line.id}`;
      const existing = progressMap.get(key);
      if (existing) {
        existing.requiredQuantity += line.quantity;
        existing.remainingQuantity += line.quantity;
        return;
      }

      progressMap.set(key, {
        inventoryCode,
        key,
        remainingQuantity: line.quantity,
        requiredQuantity: line.quantity,
        scannedRecords: [],
        scannedQuantity: 0,
        specification: line.specification || line.inventoryName,
        status: 'pending',
        unitName: line.unitName || 'PCS',
      });
    });

    progressMap.forEach((progress) => {
      const scannedRecords = scanRecords.filter(
        (record) => getInventoryCodeMatchKey(record.inventoryCode) === progress.inventoryCode
      );
      const scannedQuantity = scannedRecords.reduce((sum, record) => sum + record.quantity, 0);
      progress.scannedRecords = scannedRecords;
      progress.scannedQuantity = scannedQuantity;
      progress.remainingQuantity = progress.requiredQuantity - scannedQuantity;
      progress.status =
        scannedQuantity === progress.requiredQuantity
          ? 'complete'
          : scannedQuantity > 0
            ? 'partial'
            : 'pending';
    });

    return Array.from(progressMap.values());
  }, [erpVoucher, scanRecords]);

  const erpCompletedLineCount = useMemo(
    () => erpLineProgressItems.filter((line) => line.status === 'complete').length,
    [erpLineProgressItems]
  );
  const incompleteErpLineCount = erpVoucher
    ? Math.max(0, erpLineProgressItems.length - erpCompletedLineCount)
    : 0;
  const inboundReadyToSave = erpVoucher
    ? erpLineProgressItems.length > 0 && incompleteErpLineCount === 0
    : scanRecords.length > 0;
  const inboundSaveLabel = inboundReadyToSave
    ? '完成入库'
    : `还差 ${incompleteErpLineCount} 项`;

  // 数据变化时自动保存到 AsyncStorage（实现持久化）
  useEffect(() => {
    // 当有扫描记录时自动保存
    if (scanRecords.length > 0) {
      void saveScanRecords(scanRecords, currentSupplier);
      logger.log('[入库] 数据变化，自动保存记录:', scanRecords.length);
    }
  }, [currentSupplier, saveScanRecords, scanRecords]);

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
    [handleDeleteRecord, styles, theme.primary, theme.success, theme.textMuted, toggleExpand]
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
            onBack={() => router.back()}
            backLabel="返回采购入库单列表"
            rightIcon={erpVoucher ? 'refresh-cw' : 'crosshair'}
            rightLabel={erpVoucher ? '刷新ERP采购入库单' : '聚焦扫码输入框'}
            rightDisabled={erpVoucherLoading || saving}
            onRightPress={() => {
              if (erpVoucher) {
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
          active={inputValue.length > 0}
          processing={erpVoucherLoading}
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
          onBlur={() => focusScannerInput(120)}
          placeholder={currentInboundPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={false}
          editable={!erpVoucherLoading && Boolean(erpVoucher)}
          showSoftInputOnFocus={false}
          actionLabel="提交入库扫码内容"
          actionDisabled={!erpVoucher || saving}
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
                  disabled={saving}
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
