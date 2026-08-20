import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, Platform, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AggregatedRecordItem } from '@/components/AggregatedRecordItem';
import {
  UiPageHeader,
  UiSafeBottomBar,
  UiToolbarButton,
  UiWorkflowSummary,
} from '@/components/UiRedesign';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { useCustomAlert } from '@/components/CustomAlert';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { logger } from '@/utils/logger';
import {
  Warehouse,
  detectRule,
  parseWithRule,
  getInventoryCodeByModel,
  addInventoryCheckRecordsBatch,
  generateCheckNo,
  generateId,
  updateInventoryCheckDocumentSyncStatus,
} from '@/utils/database';
import { isQRCode } from '@/utils/qrcodeParser';
import { parseQuantity } from '@/utils/quantity';
import { Spacing } from '@/constants/theme';
import {
  feedbackSuccess,
  feedbackError,
  feedbackWarning,
  feedbackDuplicate,
  feedbackConfirm,
  feedbackInventoryComplete,
  feedbackNotBound,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  hasMatchingTraceNo,
  sanitizeStructuredScannerInput,
  shouldIgnoreRecentDuplicateScan,
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
  const { showToast, ToastContainer } = useToast();
  const alert = useCustomAlert();

  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const selectedAccountRef = useRef<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  // 输入
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const scannerFocusBlockedRef = useRef(false);
  // 扫码队列 - 暂存处理中的新扫码
  const scanQueueRef = useRef<string[]>([]);
  const processScanRef = useRef<(code: string) => void>(() => undefined);
  const lastScanRef = useRef('');
  const lastScanTimeRef = useRef(0);

  const shouldAcceptScanCode = useCallback((code: string) => {
    if (shouldIgnoreRecentDuplicateScan(code, lastScanRef, lastScanTimeRef)) {
      logger.warn('[盘点] 忽略短时间重复扫码:', code);
      return false;
    }

    return true;
  }, []);

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
  const updateScanRecords = useCallback((updater: (records: ScanRecord[]) => ScanRecord[]) => {
    setScanRecords((prev) => {
      const next = updater(prev);
      scanRecordsRef.current = next;
      return next;
    });
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
      return {};
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
        return [];
      }

      const store = parsed as InventoryDraftStore;
      const records = store[getDraftScopeKey(accountKey, warehouse.id)];
      return Array.isArray(records) ? records : [];
    },
    []
  );

  // 每个 ERP 账套拥有独立盘点草稿；仓库由账套固定映射。
  const loadCheckRecords = useCallback(
    async (warehouse: Warehouse | null | undefined, account: ErpAccountConfig) => {
      try {
        if (!warehouse) {
          logger.log('[盘点] 当前仓库未加载，跳过恢复');
          return;
        }

        const records = await getDraftRecords(warehouse, account.key);
        replaceScanRecords(records);

        if (records.length > 0) {
          showToast(`已恢复 ${account.name} 的 ${records.length} 条盘点暂存`, 'success');
        }
      } catch (error) {
        logger.error('[盘点] 加载记录失败:', error);
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
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    scannerFocusBlockedRef.current = quantityModalVisible || saving || switchingAccount;
  }, [quantityModalVisible, saving, switchingAccount]);

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

  const resumeQueuedScans = useCallback(() => {
    if (!screenActiveRef.current || processingRef.current || quantityModalVisibleRef.current) {
      return;
    }

    const nextCode = scanQueueRef.current.shift();
    if (nextCode) {
      processScanRef.current(nextCode);
      return;
    }

    focusScannerInput(0);
  }, [focusScannerInput]);

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

  // 数据变化时自动保存
  useEffect(() => {
    if (scanRecords.length > 0) {
      void saveCheckRecords(scanRecords, currentWarehouse, selectedAccount.key);
    }
  }, [currentWarehouse, saveCheckRecords, scanRecords, selectedAccount.key]);

  // 删除单条记录
  const handleDeleteRecord = useCallback(
    (record: ScanRecord) => {
      alert.showConfirm(
        '确认删除',
        '确定要删除这条记录吗？',
        () => {
          void (async () => {
            const updated = scanRecordsRef.current.filter((r) => r.id !== record.id);
            const saved = await saveCheckRecords(
              updated,
              currentWarehouse,
              selectedAccount.key
            );
            if (!saved) {
              showToast('删除暂存失败，请重试', 'error');
              feedbackError();
              return;
            }
            replaceScanRecords(updated);
            showToast('记录已删除', 'success');
          })();
        },
        true
      );
    },
    [alert, currentWarehouse, replaceScanRecords, saveCheckRecords, selectedAccount.key, showToast]
  );

  // 自动清理震动和提示音
  useFeedbackCleanup();

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      let isActive = true;
      const init = async () => {
        try {
          const account = selectedAccountRef.current;
          const warehouse = getInventoryWarehouseForAccount(account);
          setCurrentWarehouse(warehouse);
          await loadCheckRecords(warehouse, account);

          if (isActive) {
            focusScannerInput(100);
          }
        } catch (error) {
          logger.error('[扫码盘点] 初始化失败:', error);
          if (isActive) {
            showToast('数据库读取失败，请关闭应用后重试', 'error');
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
    }, [focusScannerInput, loadCheckRecords, showToast])
  );

  const handleAccountChange = useCallback(
    async (nextAccount: ErpAccountConfig) => {
      if (
        nextAccount.key === selectedAccount.key ||
        accountSwitchInProgressRef.current
      ) {
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
    async (code: string) => {
      if (!code || processingRef.current) return;

      if (switchingAccount) {
        showToast('正在切换账套，请稍候', 'warning');
        return;
      }

      if (!selectedAccountAvailable) {
        showToast(`${selectedAccount.name}账套暂未开放，不能开始盘点`, 'warning');
        feedbackWarning();
        return;
      }

      processingRef.current = true;

      try {
        // 解析二维码
        const rule = await detectRule(code);
        if (!rule) {
          if (!isQRCode(code)) {
            logger.log('[盘点] 静默忽略未匹配规则的一维码');
            return;
          }
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

        updateScanRecords((prev) => [newRecord, ...prev]);
        showToast(`已扫码：${model}`, 'success');
        feedbackSuccess();
      } catch (e) {
        logger.error('[盘点] 处理失败:', e);
        showToast(e instanceof Error && e.message ? e.message : '处理失败，请重新扫描', 'error');
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
          resumeQueuedScans();
        }, 0);
      }
    },
    [
      resumeQueuedScans,
      selectedAccount.name,
      selectedAccountAvailable,
      showToast,
      switchingAccount,
      updateScanRecords,
    ]
  );
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

      // TextInput 是受控组件，逐字符扫码时也必须保留当前输入。
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

  // 打开数量修改弹窗
  const openQuantityModal = useCallback((record: ScanRecord) => {
    scannerFocusBlockedRef.current = true;
    quantityModalVisibleRef.current = true;
    setEditingRecord(record);
    setQuantityInput(record.actualQuantity?.toString() || record.quantity.toString());
    setQuantityModalVisible(true);
  }, []);

  // 确认修改数量（支持回车和按钮）
  const handleConfirmQuantity = () => {
    if (!editingRecord) return;

    const qty = parseQuantity(quantityInput, { min: 0 });
    if (qty === null) {
      showToast('请输入有效数量', 'warning');
      return;
    }

    updateScanRecords((prev) =>
      prev.map((r) => (r.id === editingRecord.id ? { ...r, actualQuantity: qty } : r))
    );
    scannerFocusBlockedRef.current = false;
    quantityModalVisibleRef.current = false;
    setQuantityModalVisible(false);
    setEditingRecord(null);
    showToast(`实盘数量已改为 ${qty}`, 'success');
    feedbackConfirm();
    setTimeout(resumeQueuedScans, 0);
  };

  const handleCancelQuantity = () => {
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
    if (saveInProgressRef.current || switchingAccount) {
      return;
    }
    if (!selectedAccountAvailable) {
      showToast(`${selectedAccount.name}账套暂未开放，无法核对ERP库存`, 'warning');
      feedbackWarning();
      return;
    }
    saveInProgressRef.current = true;
    setSaving(true);
    try {
      const allDraftRecords = [...scanRecordsRef.current];
      if (allDraftRecords.length === 0) {
        showToast('暂无扫描记录', 'warning');
        feedbackWarning();
        return;
      }

      showToast(`正在核对 ${selectedAccount.name} ERP库存…`, 'success');
      const reconciliation = await reconcileInventoryRecords(selectedAccount, allDraftRecords);
      logger.log('[库存盘点] ERP库存核对完成', {
        account: selectedAccount.key,
        queryCount: reconciliation.queryCount,
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
      saveInProgressRef.current = false;
      setSaving(false);
    }
  };

  // 完成盘点前明确告知本次将消耗多少次ERP查询，避免误触。
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

    const queryCount = new Set(
      scanRecords
        .map((record) => getInventoryCodeLookupKey(record.inventoryCode || ''))
        .filter(Boolean)
    ).size;
    alert.showConfirm(
      '完成盘点',
      `将查询 ${selectedAccount.name} ERP 的 ${queryCount} 个存货编码，并生成盘点差异。完成后本次暂存会清空，确定继续吗？`,
      () => {
        void performSaveInventory();
      }
    );
  };

  // 清空记录
  const handleClearRecords = () => {
    if (scanRecords.length === 0 || switchingAccount) return;
    alert.showConfirm(
      '清空盘点记录',
      `将清空 ${selectedAccount.name} 的 ${scanRecords.length} 条盘点暂存，确定继续吗？`,
      () => {
        void (async () => {
          const cleared = await clearCheckRecords(currentWarehouse, selectedAccount.key);
          if (!cleared) {
            showToast('清空失败，请重试', 'error');
            feedbackError();
            return;
          }
          replaceScanRecords([]);
          showToast('盘点记录已清空', 'warning');
          feedbackWarning();
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
    switchingAccount
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
          activeOpacity={0.7}
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
            onBack={() => router.back()}
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
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: saving || switchingAccount }}
                    disabled={saving || switchingAccount}
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
            switchingAccount
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
          editable={selectedAccountAvailable && !saving && !switchingAccount}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSubmitEditing}
          onBlur={() => focusScannerInput(120)}
          placeholder={currentInventoryPlaceholder}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={false}
          showSoftInputOnFocus={false}
          actionLabel="提交盘点扫码内容"
          actionDisabled={!selectedAccountAvailable || saving || switchingAccount}
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
              title="修改实际数量"
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
                />
              }
            >
              {editingRecord && (
                <AppFormField label="实际数量">
                  <TextInput
                    ref={quantityInputRef}
                    style={quantityModalStyles.textInput}
                    value={quantityInput}
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

        {alert.AlertComponent}
        <ToastContainer />
      </View>
    </Screen>
  );
}
