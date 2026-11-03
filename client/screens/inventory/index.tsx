import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { AppModal as Modal } from '@/components/AppModal';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, Platform, FlatList, type NativeSyntheticEvent, type TextInputSubmitEditingEventData } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, Spacing, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AggregatedRecordItem } from '@/components/AggregatedRecordItem';
import {
  UiPageHeader,
  UiSafeBottomBar,
  UiToolbarButton,
  UiWorkflowSummary,
} from '@/components/UiRedesign';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { useCustomAlert } from '@/components/CustomAlert';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useHardwareBack } from '@/hooks/useHardwareBack';
import { logger } from '@/utils/logger';
import {
  Warehouse,
  getActiveRules,
  detectRule,
  parseWithRule,
  getInventoryCodeByModel,
  addInventoryCheckRecordsBatch,
  generateCheckNo,
  generateId,
  updateInventoryCheckDocumentSyncStatus,
} from '@/utils/database';
import { isQRCode, recoverConfirmedScannerContent, shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { parseQuantity } from '@/utils/quantity';
import {
  feedbackSuccess,
  feedbackError,
  feedbackWarning,
  feedbackClear,
  feedbackClearFailed,
  feedbackDuplicate,
  feedbackConfirm,
  feedbackInventoryComplete,
  feedbackNotBound,
  feedbackDeleted,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { workDraftStorage as AsyncStorage } from '@/utils/workDraftIsolation';
import { safeJsonParseNullable } from '@/utils/json';
import { formatDateTime, formatDate, getISODateTime } from '@/utils/time';
import { STORAGE_KEYS, SyncConfig } from '@/constants/config';
import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import {
  buildInventoryExportFileNameFromNo,
  buildInventorySheets,
  InventoryExportMode,
  InventoryExportRecord,
} from '@/utils/inventoryExport';
import {
  cancelScanSubmit,
  MATERIAL_SCAN_QUIET_MS,
  scheduleScanSubmitWithCompletionCheck,
  resolvePendingScannerSubmit,
  RECENT_SCAN_DUPLICATE_WINDOW_MS,
  hasMatchingTraceNo,
  sanitizeStructuredScannerInput,
} from '@/utils/scannerInput';
import {
  ERP_ACCOUNTS,
  isErpAccountAvailable,
  type ErpAccountConfig,
  type ErpAccountKey,
} from '@/utils/erpAccounts';
import {
  getInventoryCodeLookupKey,
  reconcileInventoryRecords,
} from '@/utils/inventoryReconciliation';

// 扫描记录（每条独立）
interface ScanRecord {
  id: string;
  traceCode: string; // 追溯码（二维码原始内容）
  model: string;
  batch: string;
  quantity: number;
  actualQuantity?: number;
  inventoryCode?: string;
  scanTime: string;
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
}

type InventoryAggregatedRecord = {
  key: string;
  model: string;
  version: string;
  records: ScanRecord[];
  totalQuantity: number;
  actualTotalQuantity: number;
  count: number;
};

const INVENTORY_RECORD_SIGNATURE_FIELDS = [
  'id',
  'version',
  'batch',
  'sourceNo',
  'package',
  'productionDate',
  'quantity',
  'actualQuantity',
] as const;

const buildInventoryGroupKey = (record: ScanRecord) =>
  JSON.stringify([record.model || '', record.version || '']);

const INVENTORY_CHECK_RECORDS_KEY = 'inventory_check_records_by_erp_account_v1';
type InventoryDraftStore = Record<string, ScanRecord[]>;

const getInventoryWarehouseForAccount = (account: ErpAccountConfig): Warehouse => ({
  id: `erp-account:${account.key}`,
  name: account.expectedWarehouseName.trim() || account.name,
  description: `${account.name} ERP盘点仓库`,
});

const getDraftScopeKey = (accountKey: ErpAccountKey, warehouseId: string): string =>
  `${accountKey}::${warehouseId}`;

export default function InventoryScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const quantityModalStyles = useMemo(
    () => ({
      modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        paddingHorizontal: Spacing.md,
      },
      modalContent: {
        width: '100%' as const,
        maxWidth: APP_MODAL_MAX_WIDTH,
      },
      modalBody: {
        paddingVertical: Spacing.sm,
        justifyContent: 'center' as const,
      },
      textInput: {
        height: 44,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: BorderRadius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: Typography.body.fontSize,
        color: theme.textPrimary,
        backgroundColor: theme.backgroundTertiary,
      },
    }),
    [theme]
  );
  const router = useSafeRouter();
  const { showToast, ToastContainer } = useToast({ persistentErrors: true });
  const alert = useCustomAlert({ persistentErrors: true });

  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const selectedAccountRef = useRef<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  // 输入
  const inputRef = useRef<WarehouseScanInputHandle>(null);
  const [inputValue, setInputValue] = useState('');
  const liveInputValueRef = useRef('');
  const inputRevisionRef = useRef(0);
  const pendingNativeSubmitTextRef = useRef<string | null>(null);
  const lastConsumedInputRef = useRef<{ text: string; at: number } | null>(null);
  const activeRulesRef = useRef<Awaited<ReturnType<typeof getActiveRules>> | null>(null);
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const inventorySessionRef = useRef(0);
  const draftReadyRef = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const scannerFocusBlockedRef = useRef(false);
  // 扫码队列 - 暂存处理中的新扫码
  const scanQueueRef = useRef<{ code: string; previousNativeText: string | null }[]>([]);
  const processScanRef = useRef<(code: string, previousNativeText?: string | null) => void>(() => undefined);

  // 盘点仓库由账套固定映射，不允许再手动组合账套与仓库。
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse>(() =>
    getInventoryWarehouseForAccount(ERP_ACCOUNTS[0])
  );
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const accountSwitchInProgressRef = useRef(false);

  // 扫描记录
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const scanRecordsRef = useRef<ScanRecord[]>([]);
  const replaceScanRecords = useCallback((records: ScanRecord[]) => {
    scanRecordsRef.current = records;
    setScanRecords(records);
  }, []);

  const draftMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueDraftMutation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const queuedTask = draftMutationQueueRef.current.then(task, task);
    draftMutationQueueRef.current = queuedTask.then(
      () => undefined,
      () => undefined
    );
    return queuedTask;
  }, []);

  const readCheckDraftStore = useCallback(async (): Promise<InventoryDraftStore> => {
    const savedRecords = await AsyncStorage.getItem(INVENTORY_CHECK_RECORDS_KEY);
    if (!savedRecords) {
      return {};
    }

    const parsed = safeJsonParseNullable<unknown>(savedRecords, 'inventory.scanRecords');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('盘点草稿格式异常，未覆盖原草稿');
    }

    return parsed as InventoryDraftStore;
  }, []);

  const getDraftRecords = useCallback(
    async (
      warehouse: Warehouse | null | undefined,
      accountKey: ErpAccountKey
    ): Promise<ScanRecord[]> => {
      if (!warehouse) {
        return [];
      }

      await draftMutationQueueRef.current;
      const savedRecords = await AsyncStorage.getItem(INVENTORY_CHECK_RECORDS_KEY);
      if (!savedRecords) {
        return [];
      }

      const parsed = safeJsonParseNullable<unknown>(savedRecords, 'inventory.scanRecords');
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('盘点草稿格式异常，未覆盖原草稿');
      }

      const store = parsed as InventoryDraftStore;
      const records = store[getDraftScopeKey(accountKey, warehouse.id)];
      if (records !== undefined && !Array.isArray(records)) {
        throw new Error('本账套盘点草稿格式异常，未覆盖原草稿');
      }
      return Array.isArray(records) ? records : [];
    },
    []
  );

  // 每个 ERP 账套拥有独立盘点草稿；仓库由账套固定映射。
  const loadCheckRecords = useCallback(
    async (warehouse: Warehouse | null | undefined, account: ErpAccountConfig, session: number) => {
      try {
        if (!warehouse) {
          logger.log('[盘点] 当前仓库未加载，跳过恢复');
          return;
        }

        const records = await getDraftRecords(warehouse, account.key);
        if (!screenActiveRef.current || session !== inventorySessionRef.current) return;
        replaceScanRecords(records);

        if (records.length > 0) {
          showToast(`已恢复 ${account.name} 的 ${records.length} 条盘点暂存`, 'success');
        }
      } catch (error) {
        logger.error('[盘点] 加载记录失败:', error);
        throw error;
      }
    },
    [getDraftRecords, replaceScanRecords, showToast]
  );

  // 保存当前账套的盘点草稿。
  const saveCheckRecords = useCallback(
    async (
      records: ScanRecord[],
      warehouse: Warehouse | null | undefined,
      accountKey: ErpAccountKey
    ): Promise<boolean> => {
      return enqueueDraftMutation(async () => {
        try {
          if (!warehouse) {
            return false;
          }

          const store = await readCheckDraftStore();
          const scopeKey = getDraftScopeKey(accountKey, warehouse.id);

          if (records.length > 0) {
            store[scopeKey] = records;
          } else {
            delete store[scopeKey];
          }

          await AsyncStorage.setItem(INVENTORY_CHECK_RECORDS_KEY, JSON.stringify(store));
          return true;
        } catch (error) {
          logger.error('[盘点] 保存记录失败:', error);
          return false;
        }
      });
    },
    [enqueueDraftMutation, readCheckDraftStore]
  );

  // 清空指定账套和仓库的盘点草稿。
  const clearCheckRecords = useCallback(
    async (warehouse: Warehouse | null | undefined, accountKey: ErpAccountKey) => {
      return enqueueDraftMutation(async () => {
        try {
          if (!warehouse) {
            return false;
          }

          const store = await readCheckDraftStore();
          delete store[getDraftScopeKey(accountKey, warehouse.id)];

          await AsyncStorage.setItem(INVENTORY_CHECK_RECORDS_KEY, JSON.stringify(store));
          return true;
        } catch (error) {
          logger.error('[盘点] 清空记录失败:', error);
          return false;
        }
      });
    },
    [enqueueDraftMutation, readCheckDraftStore]
  );

  // 任意盘点明细都可修正实盘数量，扫描时默认使用标签数量。
  const [quantityModalVisible, setQuantityModalVisible] = useState(false);
  const quantityModalVisibleRef = useRef(false);
  const [editingRecord, setEditingRecord] = useState<ScanRecord | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const quantityInputRef = useRef<TextInput>(null);
  const quantityFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 数量弹窗打开时聚焦输入框
  useEffect(() => {
    if (quantityModalVisible && quantityInputRef.current) {
      quantityFocusTimerRef.current = setTimeout(() => {
        quantityInputRef.current?.focus();
        quantityFocusTimerRef.current = null;
      }, 300);
    }

    return () => {
      if (quantityFocusTimerRef.current) {
        clearTimeout(quantityFocusTimerRef.current);
        quantityFocusTimerRef.current = null;
      }
    };
  }, [quantityModalVisible]);

  // 保存状态
  const [saving, setSaving] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [saveConfirmVisible, setSaveConfirmVisible] = useState(false);
  const saveConfirmRef = useRef(false);
  const [reconciliationProgress, setReconciliationProgress] = useState('');
  const saveInProgressRef = useRef(false);
  const saveOperationRef = useRef<{ settled: Promise<void>; finish: () => void } | null>(null);
  const beginSaveOperation = useCallback(() => {
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    const operation = { settled, finish };
    saveOperationRef.current = operation;
    return operation;
  }, []);
  const finishSaveOperation = useCallback((operation: { settled: Promise<void>; finish: () => void }, session: number) => {
    if (saveOperationRef.current === operation) {
      saveOperationRef.current = null;
      saveInProgressRef.current = false;
      if (screenActiveRef.current && session === inventorySessionRef.current) {
        setSaving(false);
        setReconciliationProgress('');
      }
    }
    operation.finish();
  }, []);

  const blockBackDuringWork = useCallback(() => {
    if (!saveInProgressRef.current && !processingRef.current && scanQueueRef.current.length === 0 && !liveInputValueRef.current.trim()) return false;
    showToast(saveInProgressRef.current ? '正在完成盘点，请稍候' : '正在处理扫码，请稍候再返回', 'warning');
    return true;
  }, [showToast]);

  // Hardware back can arrive before the saving state commits; the ref closes that gap.
  useHardwareBack(blockBackDuringWork);
  // Cover scan parsing, queued scans, persistence and final reconciliation on every exit path.
  usePreventRemove(saving || scanBusy || Boolean(inputValue.trim()), blockBackDuringWork);

  useEffect(() => {
    scannerFocusBlockedRef.current = quantityModalVisible || saveConfirmVisible || saving || switchingAccount || alert.visible;
  }, [alert.visible, quantityModalVisible, saveConfirmVisible, saving, switchingAccount]);

  const focusScannerInput = useCallback((delay = 0) => {
    if (screenActiveRef.current && !scannerFocusBlockedRef.current) inputRef.current?.focus(delay);
  }, []);

  const resumeQueuedScans = useCallback(() => {
    if (!screenActiveRef.current || processingRef.current || quantityModalVisibleRef.current || saveConfirmRef.current ||
      saveInProgressRef.current || accountSwitchInProgressRef.current) {
      return;
    }

    const nextCode = scanQueueRef.current.shift();
    if (nextCode) {
      processScanRef.current(nextCode.code, nextCode.previousNativeText);
      return;
    }

    focusScannerInput(0);
  }, [focusScannerInput]);

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
    if (!quantityModalVisible && !saving && !switchingAccount) {
      focusScannerInput(80);
    }
  }, [focusScannerInput, quantityModalVisible, saving, switchingAccount]);

  // 展开状态管理（用 ref 同步，避免 renderAggregatedRecord 频繁重建）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());

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

  // 删除单条记录
  const handleDeleteRecord = useCallback(
    (record: ScanRecord) => {
      if (saveInProgressRef.current || accountSwitchInProgressRef.current) return;
      alert.showConfirm(
        '确认删除',
        '确定要删除这条记录吗？',
        () => {
          if (saveInProgressRef.current || accountSwitchInProgressRef.current ||
            selectedAccountRef.current.key !== selectedAccount.key) return;
          if (processingRef.current || scanQueueRef.current.length > 0 || autoSubmitTimerRef.current) {
            showToast('请等待当前扫码处理完成后再删除记录', 'warning');
            return;
          }
          saveInProgressRef.current = true;
          setSaving(true);
          setReconciliationProgress('正在删除盘点暂存');
          const session = inventorySessionRef.current;
          const operation = beginSaveOperation();
          void (async () => {
            try {
              const updated = scanRecordsRef.current.filter((r) => r.id !== record.id);
              const saved = await saveCheckRecords(updated, currentWarehouse, selectedAccount.key);
              if (!screenActiveRef.current || session !== inventorySessionRef.current) return;
              if (!saved) {
                showToast('删除暂存失败，请重试', 'error');
                feedbackError();
                return;
              }
              replaceScanRecords(updated);
              showToast('记录已删除', 'success');
              void feedbackDeleted();
            } finally {
              finishSaveOperation(operation, session);
            }
          })();
        },
        true
      );
    },
    [alert, beginSaveOperation, currentWarehouse, finishSaveOperation, replaceScanRecords, saveCheckRecords, selectedAccount.key, showToast]
  );

  // 自动清理震动和提示音
  useFeedbackCleanup();

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      activeRulesRef.current = null;
      const session = ++inventorySessionRef.current;
      draftReadyRef.current = false;
      setDraftReady(false);
      processingRef.current = false;
      setScanBusy(scanQueueRef.current.length > 0);
      let isActive = true;
      const init = async () => {
        try {
          // 上一次进入可能正在提交；等其落盘后再恢复，不能把旧内存当成新草稿。
          await saveOperationRef.current?.settled;
          if (!isActive || session !== inventorySessionRef.current) return;
          setSaving(false);
          setReconciliationProgress('');
          const account = selectedAccountRef.current;
          const warehouse = getInventoryWarehouseForAccount(account);
          setCurrentWarehouse(warehouse);
          await loadCheckRecords(warehouse, account, session);

          if (isActive && session === inventorySessionRef.current) {
            draftReadyRef.current = true;
            setDraftReady(true);
            focusScannerInput(100);
          }
        } catch (error) {
          logger.error('[扫码盘点] 初始化失败:', error);
          if (isActive) {
            showToast('盘点暂存读取失败，请重新进入页面重试，原草稿未覆盖', 'error');
          }
        }
      };

      void init();

      return () => {
        isActive = false;
        inventorySessionRef.current += 1;
        draftReadyRef.current = false;
        screenActiveRef.current = false;
        scanQueueRef.current = [];
        liveInputValueRef.current = '';
        inputRevisionRef.current += 1;
        pendingNativeSubmitTextRef.current = null;
        setInputValue('');
        saveConfirmRef.current = false;
        setSaveConfirmVisible(false);
        cancelScanSubmit(autoSubmitTimerRef);
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
          postProcessTimerRef.current = null;
        }
      };
    }, [focusScannerInput, loadCheckRecords, showToast])
  );

  const handleAccountChange = useCallback(
    async (nextAccount: ErpAccountConfig) => {
      if (
        nextAccount.key === selectedAccount.key ||
        !draftReadyRef.current ||
        saveInProgressRef.current ||
        accountSwitchInProgressRef.current
      ) {
        return;
      }

      if (processingRef.current || scanQueueRef.current.length > 0 || autoSubmitTimerRef.current) {
        showToast('请等待当前扫码处理完成后再切换账套', 'warning');
        return;
      }

      accountSwitchInProgressRef.current = true;
      setSwitchingAccount(true);
      try {
        const currentRecords = [...scanRecordsRef.current];
        if (currentRecords.length > 0) {
          const saved = await saveCheckRecords(
            currentRecords,
            currentWarehouse,
            selectedAccount.key
          );
          if (!saved) {
            showToast('当前盘点暂存失败，已取消切换账套', 'error');
            feedbackError();
            return;
          }
        }

        const nextWarehouse = getInventoryWarehouseForAccount(nextAccount);
        const nextRecords = await getDraftRecords(nextWarehouse, nextAccount.key);

        selectedAccountRef.current = nextAccount;
        setSelectedAccount(nextAccount);
        setCurrentWarehouse(nextWarehouse);
        replaceScanRecords(nextRecords);
        expandedGroupsRef.current = new Set();
        setExpandedGroups(new Set());
        setEditingRecord(null);
        quantityModalVisibleRef.current = false;
        setQuantityModalVisible(false);
        scanQueueRef.current = [];
        liveInputValueRef.current = '';
        inputRevisionRef.current += 1;
        pendingNativeSubmitTextRef.current = null;
        setInputValue('');

        if (!isErpAccountAvailable(nextAccount)) {
          showToast(`${nextAccount.name}账套暂未开放`, 'warning');
        } else if (nextRecords.length > 0) {
          showToast(`已切换到 ${nextAccount.name}，恢复 ${nextRecords.length} 条暂存`, 'success');
        } else {
          showToast(`已切换到 ${nextAccount.name}`, 'success');
        }
      } catch (error) {
        logger.error('[盘点] 切换账套失败:', error);
        showToast('切换账套失败，当前盘点暂存未改变', 'error');
        feedbackError();
      } finally {
        accountSwitchInProgressRef.current = false;
        setSwitchingAccount(false);
      }
    },
    [
      currentWarehouse,
      replaceScanRecords,
      getDraftRecords,
      saveCheckRecords,
      selectedAccount.key,
      showToast,
    ]
  );

  // 处理扫描（带参数版本）
  const processScan = useCallback(
    async (code: string, previousNativeText: string | null = null) => {
      if (!code || !draftReadyRef.current || processingRef.current || saveInProgressRef.current || saveConfirmRef.current) return;

      processingRef.current = true;
      setScanBusy(true);
      const session = inventorySessionRef.current;
      const isCurrent = () => screenActiveRef.current && session === inventorySessionRef.current;

      try {
        const rules = activeRulesRef.current ?? await getActiveRules();
        if (!isCurrent()) return;
        activeRulesRef.current = rules;
        code = recoverConfirmedScannerContent(code, previousNativeText, rules);
        if (!isQRCode(code, rules)) return;
        if (accountSwitchInProgressRef.current || switchingAccount) {
          showToast('正在切换账套，请稍候', 'warning');
          return;
        }
        if (!selectedAccountAvailable) {
          showToast(`${selectedAccount.name}账套暂未开放，不能开始盘点`, 'warning');
          feedbackWarning();
          return;
        }
        // 解析二维码
        const rule = await detectRule(code, rules);
        if (!isCurrent()) return;
        if (!rule) {
          showToast('没有匹配的二维码解析规则，请先在设置中配置', 'error');
          logger.error('[盘点] 无法识别二维码格式:', code);
          feedbackError();
          return;
        }

        const { standardFields, customFields } = parseWithRule(code, rule);
        const model = standardFields.model || '';
        const batch = standardFields.batch || '';
        const quantity = parseQuantity(standardFields.quantity, { min: 1 });
        const version = standardFields.version || '';

        if (!model) {
          showToast('未识别到型号信息', 'error');
          feedbackError();
          logger.error('[盘点] 无法识别型号信息');
          return;
        }

        if (quantity === null) {
          logger.warn('[盘点] 忽略数量字段无效的扫码内容:', {
            code,
            quantity: standardFields.quantity,
            model,
          });
          showToast('二维码数量无效，请重新扫描', 'error');
          feedbackError();
          return;
        }

        // 盘点必须按“型号 + 可选版本号”匹配，保持与出入库一致。
        const inventoryCode = await getInventoryCodeByModel(model, version);
        if (!isCurrent()) return;
        if (!inventoryCode) {
          showToast(`未绑定存货编码：${model}${version ? ` / ${version}` : ''}`, 'error');
          feedbackNotBound();
          return;
        }

        if (hasMatchingTraceNo(scanRecordsRef.current, standardFields.traceNo)) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        // 新增记录
        const newRecord: ScanRecord = {
          id: generateId(),
          traceCode: code, // 追溯码
          model,
          batch,
          quantity,
          actualQuantity: quantity,
          inventoryCode: inventoryCode || undefined,
          scanTime: formatDateTime(new Date().toISOString()),
          ruleId: rule.id,
          ruleName: rule.name,
          // 扩展字段
          package: standardFields.package || undefined,
          version: version || undefined,
          productionDate: standardFields.productionDate || undefined,
          traceNo: standardFields.traceNo || undefined,
          sourceNo: standardFields.sourceNo || undefined,
          // 占位字段解析值
          customFields: customFields || {},
        };

        const nextRecords = [newRecord, ...scanRecordsRef.current];
        if (!(await saveCheckRecords(nextRecords, currentWarehouse, selectedAccount.key))) {
          throw new Error('盘点暂存保存失败，本次扫码未计入，请检查后重新扫描');
        }
        if (!isCurrent()) return;
        replaceScanRecords(nextRecords);
        showToast(`已扫码：${model}`, 'success');
        feedbackSuccess();
      } catch (e) {
        if (!isCurrent()) return;
        logger.error('[盘点] 处理失败:', e);
        showToast(e instanceof Error && e.message ? e.message : '处理失败，请重新扫描', 'error');
        feedbackError();
      } finally {
        if (isCurrent()) {
          processingRef.current = false;
          setScanBusy(scanQueueRef.current.length > 0);
          // 当前会话处理完成后再接收下一条；旧页面不得解除新页面的扫码锁。
          if (postProcessTimerRef.current) {
            clearTimeout(postProcessTimerRef.current);
          }
          postProcessTimerRef.current = setTimeout(() => {
            postProcessTimerRef.current = null;
            if (isCurrent()) resumeQueuedScans();
          }, 0);
        }
      }
    },
    [
      resumeQueuedScans,
      currentWarehouse,
      replaceScanRecords,
      saveCheckRecords,
      selectedAccount.key,
      selectedAccount.name,
      selectedAccountAvailable,
      showToast,
      switchingAccount,
    ]
  );
  useEffect(() => {
    processScanRef.current = processScan;
  }, [processScan]);

  const flushScannerInput = useCallback(() => {
    if (!draftReadyRef.current || quantityModalVisibleRef.current || saveConfirmRef.current || saveInProgressRef.current ||
      accountSwitchInProgressRef.current) return;
    const rawCode = sanitizeStructuredScannerInput(liveInputValueRef.current);
    const previousNativeText = lastConsumedInputRef.current?.text ?? null;
    const code = recoverConfirmedScannerContent(rawCode, previousNativeText, activeRulesRef.current ?? []);
    liveInputValueRef.current = '';
    inputRevisionRef.current += 1;
    pendingNativeSubmitTextRef.current = null;
    setInputValue('');
    inputRef.current?.clear();
    if (!code) return;
    lastConsumedInputRef.current = { text: rawCode, at: Date.now() };
    if (processingRef.current) {
      scanQueueRef.current.push({ code, previousNativeText });
      return;
    }
    processScan(code, previousNativeText);
  }, [processScan]);

  // 字段齐全不代表末段收完；回车保持快速提交，无回车时等待静默收尾。
  const handleInputChange = useCallback((text: string) => {
    if (!draftReadyRef.current || quantityModalVisibleRef.current || saveConfirmRef.current || saveInProgressRef.current ||
      accountSwitchInProgressRef.current) return;
    cancelScanSubmit(autoSubmitTimerRef);
    const revision = ++inputRevisionRef.current;
    if (pendingNativeSubmitTextRef.current !== text) pendingNativeSubmitTextRef.current = null;
    liveInputValueRef.current = text;
    setInputValue(text);
    if (!text) return;

    const session = inventorySessionRef.current;
    const isCurrent = () => screenActiveRef.current && session === inventorySessionRef.current
      && draftReadyRef.current && !quantityModalVisibleRef.current && !saveConfirmRef.current
      && !saveInProgressRef.current && !accountSwitchInProgressRef.current
      && inputRevisionRef.current === revision && liveInputValueRef.current === text;
    scheduleScanSubmitWithCompletionCheck(autoSubmitTimerRef, {
      delay: 150,
      minimumQuietMs: MATERIAL_SCAN_QUIET_MS,
      isConfirmed: () => pendingNativeSubmitTextRef.current === text,
      isCurrent,
      shouldWaitForMore: async () => {
        if (pendingNativeSubmitTextRef.current === text) return false;
        const rules = activeRulesRef.current ?? await getActiveRules();
        if (!isCurrent()) return false;
        activeRulesRef.current = rules;
        return shouldWaitForQRCodeContinuation(sanitizeStructuredScannerInput(text), rules);
      },
      submit: flushScannerInput,
    });
  }, [flushScannerInput]);

  // 原生回车可能先于最后一次 onChangeText；迟到回车不能消费另一笔扫码。
  const handleSubmitEditing = useCallback((event?: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    const nativeText = sanitizeStructuredScannerInput(event?.nativeEvent.text ?? '');
    const previous = lastConsumedInputRef.current;
    // Two labels of the same model share a prefix. A late Enter for the first
    // must not replace the partially received second label with the first one.
    if (previous && nativeText === previous.text && nativeText !== liveInputValueRef.current
      && Date.now() - previous.at < RECENT_SCAN_DUPLICATE_WINDOW_MS) return;
    const pending = resolvePendingScannerSubmit(liveInputValueRef.current, event?.nativeEvent.text);
    if (!pending) return;
    if (pending.advanced || pendingNativeSubmitTextRef.current === pending.text) {
      pendingNativeSubmitTextRef.current = pending.text;
      handleInputChange(pending.text);
      return;
    }
    cancelScanSubmit(autoSubmitTimerRef);
    flushScannerInput();
  }, [flushScannerInput, handleInputChange]);

  // 打开数量修改弹窗
  const openQuantityModal = useCallback((record: ScanRecord) => {
    if (!draftReadyRef.current || saveInProgressRef.current || accountSwitchInProgressRef.current) return;
    if (processingRef.current || scanQueueRef.current.length > 0 || autoSubmitTimerRef.current) {
      showToast('请等待当前扫码处理完成后再修改数量', 'warning');
      return;
    }
    scannerFocusBlockedRef.current = true;
    quantityModalVisibleRef.current = true;
    setEditingRecord(record);
    setQuantityInput(record.actualQuantity?.toString() || record.quantity.toString());
    setQuantityModalVisible(true);
  }, [showToast]);

  // 确认修改数量（支持回车和按钮）
  const handleConfirmQuantity = async () => {
    if (!editingRecord || saveInProgressRef.current || accountSwitchInProgressRef.current) return;

    const qty = parseQuantity(quantityInput, { min: 0 });
    if (qty === null) {
      showToast('请输入有效数量', 'warning');
      return;
    }

    saveInProgressRef.current = true;
    setSaving(true);
    setReconciliationProgress('正在保存实盘数量');
    const session = inventorySessionRef.current;
    const operation = beginSaveOperation();
    try {
      const nextRecords = scanRecordsRef.current.map((r) =>
        r.id === editingRecord.id ? { ...r, actualQuantity: qty } : r);
      const saved = await saveCheckRecords(nextRecords, currentWarehouse, selectedAccount.key);
      if (!screenActiveRef.current || session !== inventorySessionRef.current) return;
      if (!saved) {
        showToast('实盘数量保存失败，原数量未修改，请重试', 'error');
        feedbackError();
        return;
      }
      replaceScanRecords(nextRecords);
      scannerFocusBlockedRef.current = false;
      quantityModalVisibleRef.current = false;
      setQuantityModalVisible(false);
      setEditingRecord(null);
      showToast(`实盘数量已改为 ${qty}`, 'success');
      feedbackConfirm();
    } finally {
      finishSaveOperation(operation, session);
      if (screenActiveRef.current && session === inventorySessionRef.current) setTimeout(resumeQueuedScans, 0);
    }
  };

  const handleCancelQuantity = () => {
    if (saveInProgressRef.current) return;
    scannerFocusBlockedRef.current = false;
    quantityModalVisibleRef.current = false;
    setQuantityModalVisible(false);
    setEditingRecord(null);
    setTimeout(resumeQueuedScans, 0);
  };

  const syncInventorySnapshot = async (
    records: InventoryExportRecord[],
    mode: InventoryExportMode,
    warehouseName: string,
    checkNo: string
  ): Promise<{ success: boolean; skipped: boolean; fileName?: string; message?: string }> => {
    const savedSyncConfig = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
    const syncConfig = savedSyncConfig
      ? safeJsonParseNullable<SyncConfig>(savedSyncConfig, 'inventory.syncConfig')
      : null;

    if (!syncConfig?.ip) {
      return { success: false, skipped: true };
    }

    const fileName = buildInventoryExportFileNameFromNo(warehouseName, mode, checkNo);
    const result = await syncExcelToComputer(
      buildInventorySheets(records),
      '/inventory',
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

  const performSaveInventory = async () => {
    if (saveInProgressRef.current || accountSwitchInProgressRef.current) {
      return;
    }
    if (selectedAccountRef.current.key !== selectedAccount.key) {
      showToast('账套已切换，请重新确认完成盘点', 'warning');
      return;
    }
    if (processingRef.current || scanQueueRef.current.length > 0 ||
      autoSubmitTimerRef.current || quantityModalVisibleRef.current) {
      showToast('请等待扫码和数量调整完成后再完成盘点', 'warning');
      return;
    }
    if (!selectedAccountAvailable) {
      showToast(`${selectedAccount.name}账套暂未开放，无法核对ERP库存`, 'warning');
      feedbackWarning();
      return;
    }
    saveInProgressRef.current = true;
    setSaving(true);
    const session = inventorySessionRef.current;
    const operation = beginSaveOperation();
    try {
      const allDraftRecords = [...scanRecordsRef.current];
      if (allDraftRecords.length === 0) {
        showToast('暂无扫描记录', 'warning');
        feedbackWarning();
        return;
      }

      showToast(`正在核对 ${selectedAccount.name} ERP库存…`, 'success');
      const reconciliation = await reconcileInventoryRecords(selectedAccount, allDraftRecords, {
        onProgress: (completed, total) => {
          setReconciliationProgress(`核对库存 ${completed}/${total}`);
        },
      });
      setReconciliationProgress('正在保存盘点…');
      logger.log('[库存盘点] ERP库存核对完成', {
        account: selectedAccount.key,
        queryCount: reconciliation.queryCount,
        batchCount: reconciliation.batchCount,
      });

      logger.log('[库存盘点] 开始保存盘点记录，共', allDraftRecords.length, '条');
      let checkNo = await generateCheckNo();
      const today = formatDate(new Date().toISOString());
      const createdAt = getISODateTime();
      logger.log('[库存盘点] 盘点单号:', checkNo);

      const recordsToSave: Parameters<typeof addInventoryCheckRecordsBatch>[0] = [];
      const exportRecords: InventoryExportRecord[] = [];
      for (const record of allDraftRecords) {
        const inventoryCode = record.inventoryCode || '';
        const erpQuantity = reconciliation.erpQuantityByInventoryCode.get(
          getInventoryCodeLookupKey(inventoryCode)
        );
        if (erpQuantity === undefined) {
          throw new Error(`${inventoryCode || record.model} 缺少ERP库存核对结果`);
        }

        const base = {
          id: record.id,
          check_no: checkNo,
          warehouse_id: currentWarehouse.id,
          warehouse_name: currentWarehouse.name,
          inventory_code: inventoryCode,
          scan_model: record.model,
          batch: record.batch,
          quantity: record.quantity,
          check_type: 'whole' as const,
          actual_quantity: record.actualQuantity ?? record.quantity,
          check_date: today,
          notes: '',
          package: record.package,
          version: record.version,
          productionDate: record.productionDate,
          traceNo: record.traceNo,
          sourceNo: record.sourceNo,
          customFields: record.customFields,
          rule_id: record.ruleId,
          rule_name: record.ruleName,
          erp_account_key: selectedAccount.key,
          erp_account_name: selectedAccount.name,
          erp_quantity: erpQuantity,
        };
        recordsToSave.push(base);
        exportRecords.push({
          ...base,
          account_name: selectedAccount.name,
          created_at: createdAt,
        });
      }
      const exportMode: InventoryExportMode = 'complete';
      const savedCount = recordsToSave.length;

      const batchSaveResult = await addInventoryCheckRecordsBatch(recordsToSave);
      checkNo = batchSaveResult.checkNo || checkNo;
      if (batchSaveResult.reusedExisting) {
        exportRecords.forEach((record) => {
          record.check_no = checkNo;
        });
        logger.warn('[库存盘点] 检测到已保存草稿，沿用原盘点单继续清理和同步:', checkNo);
      }
      const draftsCleared = await clearCheckRecords(currentWarehouse, selectedAccount.key);
      if (!draftsCleared) {
        logger.error('[库存盘点] 盘点已保存，但本地草稿清理失败');
      }
      let syncResult: Awaited<ReturnType<typeof syncInventorySnapshot>> = {
        success: false,
        skipped: false,
        message: '电脑同步失败，请稍后重试',
      };
      try {
        syncResult = await syncInventorySnapshot(
          exportRecords,
          exportMode,
          currentWarehouse.name,
          checkNo
        );
      } catch (syncError) {
        logger.warn('[库存盘点] 盘点已保存，但同步流程异常:', syncError);
        syncResult = {
          success: false,
          skipped: false,
          message: syncError instanceof Error ? syncError.message : String(syncError),
        };
      }
      try {
        await updateInventoryCheckDocumentSyncStatus(
          checkNo,
          currentWarehouse.id,
          syncResult.success ? 'success' : syncResult.skipped ? 'pending' : 'failed',
          syncResult.fileName,
          syncResult.message
        );
      } catch (statusError) {
        logger.warn('[库存盘点] 盘点单同步状态更新失败:', statusError);
      }

      logger.log('[库存盘点] 保存成功');
      replaceScanRecords([]);
      expandedGroupsRef.current = new Set();
      setExpandedGroups(new Set());
      if (syncResult.success) {
        showToast(
          syncResult.fileName
            ? `盘点已保存并同步\n${syncResult.fileName}`
            : `盘点已保存并同步，共 ${savedCount} 条`,
          'success'
        );
      } else if (!syncResult.skipped) {
        showToast(
          `盘点已保存，稍后可在盘点记录重新同步\n${formatSyncErrorMessage(syncResult.message)}`,
          'warning'
        );
      } else {
        showToast(`盘点已保存，共 ${savedCount} 条`, 'success');
      }
      feedbackInventoryComplete();

      if (!draftsCleared) {
        showToast('盘点已保存，但本地草稿未清理，请重新进入页面确认', 'warning');
      }
    } catch (error) {
      logger.error('[库存盘点] 保存失败:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`盘点未完成：${errorMessage}\n扫描暂存已保留`, 'error');
      feedbackError();
    } finally {
      finishSaveOperation(operation, session);
    }
  };

  // 完成后才查询ERP；重复扫描的存货编码会合并后分批核对。
  const handleSaveInventory = () => {
    if (saveInProgressRef.current || saving || switchingAccount) {
      return;
    }
    if (scanRecords.length === 0) {
      showToast('暂无扫描记录', 'warning');
      feedbackWarning();
      return;
    }
    if (!selectedAccountAvailable) {
      showToast(`${selectedAccount.name}账套暂未开放，无法完成盘点`, 'warning');
      feedbackWarning();
      return;
    }

    if (processingRef.current || scanQueueRef.current.length || autoSubmitTimerRef.current || quantityModalVisibleRef.current) {
      showToast('请等待扫码处理完成后再完成盘点', 'warning');
      return;
    }
    saveConfirmRef.current = true;
    scannerFocusBlockedRef.current = true;
    setSaveConfirmVisible(true);
  };
  const closeSaveConfirmation = () => {
    saveConfirmRef.current = false;
    setSaveConfirmVisible(false);
    focusScannerInput();
  };

  // 清空记录
  const handleClearRecords = () => {
    if (scanRecords.length === 0 || switchingAccount || saveInProgressRef.current) return;
    alert.showConfirm(
      '清空盘点记录',
      `将清空 ${selectedAccount.name} 的 ${scanRecords.length} 条盘点暂存，确定继续吗？`,
      () => {
        if (saveInProgressRef.current || accountSwitchInProgressRef.current ||
          selectedAccountRef.current.key !== selectedAccount.key) return;
        if (processingRef.current || scanQueueRef.current.length > 0 || autoSubmitTimerRef.current) {
          showToast('正在处理扫码，请稍后清空', 'warning');
          return;
        }
        saveInProgressRef.current = true;
        setReconciliationProgress('正在清空盘点记录');
        setSaving(true);
        const session = inventorySessionRef.current;
        const operation = beginSaveOperation();
        void (async () => {
          try {
            const cleared = await clearCheckRecords(currentWarehouse, selectedAccount.key);
            if (!cleared) {
              showToast('清空失败，请重试', 'error');
              void feedbackClearFailed();
              return;
            }
            replaceScanRecords([]);
            showToast('盘点记录已清空', 'warning');
            void feedbackClear();
          } finally {
            finishSaveOperation(operation, session);
          }
        })();
      },
      true
    );
  };

  // 计算每个型号+版本的累计数量
  const modelVersionTotals = useMemo(() => {
    const totals: { [key: string]: { qty: number; actualQty: number; count: number } } = {};
    scanRecords.forEach((r) => {
      const key = buildInventoryGroupKey(r);
      if (!totals[key]) {
        totals[key] = { qty: 0, actualQty: 0, count: 0 };
      }
      totals[key].qty += r.quantity;
      totals[key].actualQty += r.actualQuantity !== undefined ? r.actualQuantity : r.quantity;
      totals[key].count += 1;
    });
    return totals;
  }, [scanRecords]);

  // 计算总数量
  const totalQuantity = useMemo(() => {
    return Object.values(modelVersionTotals).reduce((sum, t) => {
      return sum + t.actualQty;
    }, 0);
  }, [modelVersionTotals]);
  const totalDraftCount = scanRecords.length;
  const currentInventoryStep =
    scanRecords.length === 0
      ? 'scan'
      : quantityModalVisible
        ? 'adjust'
        : 'review';
  const currentInventoryPlaceholder =
    saving
      ? reconciliationProgress || '正在准备库存核对…'
      : switchingAccount
      ? '正在切换账套…'
      : !selectedAccountAvailable
      ? `${selectedAccount.name}账套暂未开放`
      : currentInventoryStep === 'scan'
      ? '持续扫描盘点二维码'
      : currentInventoryStep === 'adjust'
        ? '调整实际数量'
        : '继续扫码或完成盘点';

  // 聚合显示数据（按型号+版本号聚合，显示规则与扫码入库保持一致）
  const aggregatedRecords = useMemo<InventoryAggregatedRecord[]>(() => {
    const map = new Map<
      string,
      { records: ScanRecord[]; totalQuantity: number; actualTotalQuantity: number }
    >();

    scanRecords.forEach((record) => {
      const key = buildInventoryGroupKey(record);
      if (!map.has(key)) {
        map.set(key, { records: [], totalQuantity: 0, actualTotalQuantity: 0 });
      }
      const group = map.get(key)!;
      group.records.push(record);
      group.totalQuantity += record.quantity;
      group.actualTotalQuantity +=
        record.actualQuantity !== undefined ? record.actualQuantity : record.quantity;
    });

    return Array.from(map.entries())
      .map(([key, group]) => {
        const records = group.records.slice().sort((a, b) => b.id.localeCompare(a.id));
        const firstRecord = records[0];
        return {
          key,
          model: firstRecord?.model || '',
          version: firstRecord?.version || '',
          batch: firstRecord?.batch || '',
          sourceNo: firstRecord?.sourceNo || '',
          package: firstRecord?.package || '',
          records,
          totalQuantity: group.totalQuantity,
          actualTotalQuantity: group.actualTotalQuantity,
          count: group.records.length,
        };
      })
      .sort((a, b) => (b.records[0]?.id || '').localeCompare(a.records[0]?.id || ''));
  }, [scanRecords]);

  const inventoryListState = useMemo(
    () => `${[...expandedGroups].join('|')}::${selectedAccount.key}`,
    [expandedGroups, selectedAccount.key]
  );
  const workflowSummaryItems = useMemo(
    () => [
      {
        key: 'drafts',
        label: '本次盘点',
        value: `${scanRecords.length} 条 / ${totalQuantity.toLocaleString()} PCS`,
        icon: 'layers' as const,
        color: totalDraftCount > 0 ? theme.success : theme.textMuted,
      },
      {
        key: 'warehouse',
        label: 'ERP仓库',
        value: currentWarehouse.name,
        icon: 'archive' as const,
        color: theme.primary,
      },
    ],
    [
      currentWarehouse.name,
      scanRecords.length,
      theme.primary,
      theme.success,
      theme.textMuted,
      totalQuantity,
      totalDraftCount,
    ]
  );

  const renderInventoryRight = useCallback(
    (item: InventoryAggregatedRecord) => (
      <View style={styles.itemRight}>
        {item.actualTotalQuantity !== item.totalQuantity ? (
          <React.Fragment>
            <View style={styles.quantityRow}>
              <Text style={styles.itemQtyLabel}>标签:</Text>
              <Text style={styles.itemQty}>{item.totalQuantity.toLocaleString()}</Text>
            </View>
            <View style={styles.actualRow}>
              <Text style={styles.actualLabel}>实际:</Text>
              <Text style={styles.actualQty}>{item.actualTotalQuantity.toLocaleString()}</Text>
            </View>
          </React.Fragment>
        ) : (
          <Text style={styles.itemQty}>{item.actualTotalQuantity.toLocaleString()}</Text>
        )}
      </View>
    ),
    [
      styles.actualLabel,
      styles.actualQty,
      styles.actualRow,
      styles.itemQty,
      styles.itemQtyLabel,
      styles.itemRight,
      styles.quantityRow,
    ]
  );

  const renderInventoryDetail = useCallback(
    (record: ScanRecord) => {
      const actualQuantity =
        record.actualQuantity !== undefined && record.actualQuantity !== null
          ? record.actualQuantity
          : record.quantity;
      const isAdjusted =
        record.actualQuantity !== undefined &&
        record.actualQuantity !== null &&
        record.actualQuantity !== record.quantity;

      return (
        <TouchableOpacity
          key={record.id}
          style={styles.detailItem}
          activeOpacity={0.86}
          onPress={() => openQuantityModal(record)}
          onLongPress={() => handleDeleteRecord(record)}
          delayLongPress={500}
        >
          <Text style={styles.detailText}>
            批次: {record.batch || '-'} | 生产日期: {record.productionDate || '-'} | 标签:{' '}
            {record.quantity}
          </Text>
          <View style={styles.detailActualRow}>
            <Text style={styles.detailText}>
              实际: {actualQuantity}
              {isAdjusted ? ' (已调整)' : ''}
            </Text>
            <Feather name="edit-3" size={12} color={theme.accent} />
          </View>
        </TouchableOpacity>
      );
    },
    [
      handleDeleteRecord,
      openQuantityModal,
      styles.detailActualRow,
      styles.detailItem,
      styles.detailText,
      theme.accent,
    ]
  );

  const renderAggregatedRecord = useCallback(
    ({ item }: { item: InventoryAggregatedRecord }) => {
      const key = item.key;
      const isExpanded = expandedGroupsRef.current.has(key);

      return (
        <AggregatedRecordItem
          groupKey={key}
          model={item.model}
          version={item.version}
          totalQuantity={item.totalQuantity}
          records={item.records}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          recordSignatureFields={INVENTORY_RECORD_SIGNATURE_FIELDS}
          compareValues={[item.actualTotalQuantity, item.count, selectedAccount.key]}
          containerStyle={styles.itemContainer}
          rowStyle={styles.itemRow}
          contentStyle={styles.itemLeft}
          titleStyle={styles.itemModel}
          subtitleStyle={styles.itemBatch}
          detailsContainerStyle={styles.detailsContainer}
          chevronColor={theme.textPrimary}
          renderRight={() => renderInventoryRight(item)}
          renderDetail={renderInventoryDetail}
        />
      );
    },
    [
      renderInventoryDetail,
      renderInventoryRight,
      selectedAccount.key,
      styles,
      theme.textPrimary,
      toggleExpand,
    ]
  );

  const aggregatedRecordKeyExtractor = useCallback(
    (item: InventoryAggregatedRecord) => item.key,
    []
  );

  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      safeAreaEdges={['top', 'left', 'right']}
    >
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title="库存盘点"
            onBack={() => {
              if (blockBackDuringWork()) return;
              router.back();
            }}
            rightIcon="crosshair"
            rightLabel="聚焦扫码输入框"
            onRightPress={() => focusScannerInput(0)}
          />

          {/* 顶栏：ERP账套 */}
          <View style={styles.topBar}>
            <View style={styles.typeSelector}>
              {ERP_ACCOUNTS.map((account) => {
                const active = selectedAccount.key === account.key;
                const available = isErpAccountAvailable(account);
                const contentColor = active ? theme.buttonPrimaryText : theme.textPrimary;

                return (
                  <TouchableOpacity
                    key={account.key}
                    style={[styles.typeBtn, active && styles.typeBtnActive]}
                    activeOpacity={0.86}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: saving || switchingAccount }}
                    disabled={!draftReady || saving || switchingAccount}
                    onPress={() => {
                      void handleAccountChange(account);
                    }}
                  >
                    <Feather name="briefcase" size={15} color={contentColor} />
                    <Text
                      style={[styles.typeBtnText, active && styles.typeBtnTextActive]}
                      numberOfLines={1}
                    >
                      {account.name}{available ? '' : '（未开放）'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        {/* 扫码输入 */}
        <WarehouseScanInput
          inputRef={inputRef}
          active={inputValue.length > 0}
          statusLabel={
            saving
              ? reconciliationProgress || '正在核对ERP库存'
              : switchingAccount
              ? '正在切换账套'
              : !selectedAccountAvailable
              ? '当前账套暂未开放'
              : currentInventoryStep === 'scan'
              ? '盘点扫码录入'
              : currentInventoryStep === 'adjust'
                ? '调整实际数量'
                : '继续扫码或确认盘点'
          }
          value={inputValue}
          editable={draftReady && selectedAccountAvailable && !saving && !switchingAccount && !saveConfirmVisible}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSubmitEditing}
          placeholder={currentInventoryPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={!quantityModalVisible && !saveConfirmVisible && !alert.visible}
          showSoftInputOnFocus={false}
          actionLabel="提交盘点扫码内容"
          actionDisabled={!draftReady || !selectedAccountAvailable || saving || switchingAccount}
          actionLoading={saving || switchingAccount}
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
            <Text style={styles.listTitle}>扫描记录</Text>
            <Text style={styles.listCount}>
              {scanRecords.length} 条 / {totalQuantity} PCS
            </Text>
          </View>
          <FlatList
            style={styles.list}
            contentContainerStyle={
              aggregatedRecords.length === 0 ? styles.listEmptyContent : styles.listContent
            }
            data={aggregatedRecords}
            renderItem={renderAggregatedRecord}
            keyExtractor={aggregatedRecordKeyExtractor}
            extraData={inventoryListState}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            ListEmptyComponent={
              <AppEmptyState
                icon="package"
                title="暂无扫描记录"
                description="盘点扫码后的记录会在这里显示"
                compact
                style={styles.empty}
              />
            }
          />

          {/* 操作按钮 */}
          {totalDraftCount > 0 && (
            <UiSafeBottomBar style={styles.actionBar}>
              <View style={styles.clearBtn}>
                <UiToolbarButton
                  label="清空盘点"
                  icon="trash-2"
                  variant="secondary"
                  disabled={saving || switchingAccount || scanRecords.length === 0}
                  onPress={handleClearRecords}
                  style={styles.actionButton}
                />
              </View>
              <View style={styles.submitBtn}>
                <UiToolbarButton
                  label="完成盘点"
                  icon="check-circle"
                  variant="primary"
                  loading={saving}
                  onPress={handleSaveInventory}
                  disabled={saving || switchingAccount}
                  style={styles.actionButton}
                />
              </View>
            </UiSafeBottomBar>
          )}
        </View>

        {/* 实盘数量修改弹窗 */}
        <Modal
          visible={quantityModalVisible}
          transparent
          animationType="fade"
          onRequestClose={handleCancelQuantity}
        >
          <View style={quantityModalStyles.modalOverlay}>
            <AppModalCard
              title="修改实盘数量"
              subtitle={editingRecord ? `用于修正 ${editingRecord.model} 的实际数量` : undefined}
              onClose={handleCancelQuantity}
              style={quantityModalStyles.modalContent}
              bodyStyle={quantityModalStyles.modalBody}
              size="compact"
              stretchBody
              footer={
                <AppModalActions
                  secondaryLabel="取消"
                  onSecondaryPress={handleCancelQuantity}
                  primaryLabel="保存"
                  onPrimaryPress={handleConfirmQuantity}
                  primaryDisabled={saving}
                  secondaryDisabled={saving}
                />
              }
            >
              {editingRecord && (
                <AppFormField label="实际数量">
                  <TextInput
                    ref={quantityInputRef}
                    style={quantityModalStyles.textInput}
                    value={quantityInput}
                    editable={!saving}
                    onChangeText={setQuantityInput}
                    onSubmitEditing={() => void handleConfirmQuantity()}
                    placeholder="实际数量"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="numeric"
                    autoFocus
                    returnKeyType="done"
                  />
                </AppFormField>
              )}
            </AppModalCard>
          </View>
        </Modal>

        {<Modal visible={Boolean(saveConfirmVisible) && (true)} transparent animationType="fade" onRequestClose={closeSaveConfirmation}>{saveConfirmVisible ? <>
          <View style={quantityModalStyles.modalOverlay}>
            <AppModalCard title="完成盘点" subtitle={`${selectedAccount.name} · ${currentWarehouse.name}`} size="compact"
              onClose={closeSaveConfirmation}
              footer={<AppModalActions secondaryLabel="取消" onSecondaryPress={closeSaveConfirmation}
                primaryLabel="确认完成" onPrimaryPress={() => {
                  if (!saveConfirmRef.current) return;
                  closeSaveConfirmation();
                  void performSaveInventory();
                }} />}>
              <KeyboardAwareFormScrollView>
                <Text style={[Typography.dialogNote, { color: theme.textPrimary }]}>
                  核对 ERP 库存后保存本次盘点明细和差异。
                </Text>
                <Text style={[Typography.dialogNote, { color: theme.textMuted, marginTop: Spacing.sm }]}>
                  仅保存本次扫描的盘点记录；未扫描物料不受影响。
                </Text>
              </KeyboardAwareFormScrollView>
            </AppModalCard>
          </View>
        </> : null}</Modal>}
        {alert.AlertComponent}
        <ToastContainer />
      </View>
    </Screen>
  );
}
