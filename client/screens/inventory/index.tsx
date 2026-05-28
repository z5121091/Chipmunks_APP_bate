import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { AppEmptyState } from '@/components/AppEmptyState';
import { useCustomAlert } from '@/components/CustomAlert';
import {
  ScanWorkflowPanel,
  type WorkflowMetric,
  type WorkflowStep,
} from '@/components/ScanWorkflowPanel';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { logger } from '@/utils/logger';
import {
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
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
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseNullable } from '@/utils/json';
import { formatDateTime, formatDate, getISODateTime } from '@/utils/time';
import { STORAGE_KEYS, SyncConfig } from '@/constants/config';
import { getErrorDetail } from '@/utils/errorTypes';
import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import {
  buildInventoryExportFileNameFromNo,
  buildInventorySheets,
  InventoryExportMode,
  InventoryExportRecord,
} from '@/utils/inventoryExport';
import {
  sanitizeCompactScannerInput,
  shouldIgnoreRecentDuplicateScan,
} from '@/utils/scannerInput';

// 盘点类型
type CheckType = 'whole' | 'partial';

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
  // 扩展字段
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  // 自定义字段
  customFields?: Record<string, string>;
}


// ========================================
// React.memo 优化：列表项组件
// ========================================
const getRecordRenderSignature = (records: any[] = []) =>
  records
    .map((record) =>
      [
        record.id || '',
        record.version || '',
        record.batch || '',
        record.sourceNo || '',
        record.package || '',
        record.productionDate || '',
        record.quantity ?? '',
        record.actualQuantity ?? '',
      ].join(':')
    )
    .join('|');

const buildInventoryGroupKey = (record: ScanRecord) =>
  JSON.stringify([
    record.model || '',
    record.version || '',
  ]);

const RecordItem = React.memo(
  ({
    item,
    isExpanded,
    onToggle,
    onDeleteRecord,
    onEditQuantity,
    checkType,
    theme,
    styles,
  }: {
    item: any;
    isExpanded: boolean;
    onToggle: (key: string) => void;
    onDeleteRecord: (record: any) => void;
    onEditQuantity?: (record: any) => void;
    checkType: CheckType;
    theme: any;
    styles: any;
  }) => {
    const key = item.key;

    return (
      <View key={key} style={styles.itemContainer}>
        {/* 聚合项（两行布局） */}
        <TouchableOpacity
          style={styles.itemRow}
          activeOpacity={0.7}
          onPress={() => onToggle(key)}
        >
          <View style={styles.itemLeft}>
            <TouchableOpacity
              style={styles.itemModelRow}
              activeOpacity={0.7}
              onPress={() => onToggle(key)}
            >
              <Text style={styles.itemModel}>
                {isExpanded ? '▼' : '▶'} {item.model}
              </Text>
            </TouchableOpacity>
            <Text style={styles.itemBatch}>版本: {item.version || '-'}</Text>
          </View>
          <View style={styles.itemRight}>
            {checkType === 'partial' ? (
              <>
                <View style={styles.quantityRow}>
                  <Text style={styles.itemQtyLabel}>标签:</Text>
                  <Text style={styles.itemQty}>{item.totalQuantity.toLocaleString()}</Text>
                </View>
                <View style={styles.actualRow}>
                  <Text style={styles.actualLabel}>实际:</Text>
                  <Text style={styles.actualQty}>{item.actualTotalQuantity.toLocaleString()}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.itemQty}>{item.totalQuantity.toLocaleString()}</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* 展开的明细 */}
        {isExpanded && (
          <View style={styles.detailsContainer}>
            {item.records.map((record: any) => {
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
                  activeOpacity={checkType === 'partial' ? 0.7 : 1}
                  onPress={checkType === 'partial' ? () => onEditQuantity?.(record) : undefined}
                  onLongPress={() => onDeleteRecord(record)}
                  delayLongPress={500}
                >
                  <Text style={styles.detailText}>
                    批次: {record.batch || '-'}  |  生产日期: {record.productionDate || '-'}  |  标签:{' '}
                    {record.quantity}
                  </Text>
                  {checkType === 'partial' && (
                    <View style={styles.detailActualRow}>
                      <Text style={styles.detailText}>
                        实际: {actualQuantity}
                        {isAdjusted ? ' (已调整)' : ''}
                      </Text>
                      <Feather name="edit-3" size={12} color={theme.accent} />
                    </View>
                  )}
                  <Text style={styles.detailText}>版本号: {record.version || '-'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：只有关键属性变化时才重新渲染
    return (
      prevProps.item.model === nextProps.item.model &&
      prevProps.item.version === nextProps.item.version &&
      prevProps.item.totalQuantity === nextProps.item.totalQuantity &&
      prevProps.item.actualTotalQuantity === nextProps.item.actualTotalQuantity &&
      prevProps.item.count === nextProps.item.count &&
      prevProps.isExpanded === nextProps.isExpanded &&
      prevProps.checkType === nextProps.checkType &&
      getRecordRenderSignature(prevProps.item.records) === getRecordRenderSignature(nextProps.item.records)
    );
  }
);

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

  // 盘点类型
  const [checkType, setCheckType] = useState<CheckType>('whole');

  // 输入
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const scannerFocusBlockedRef = useRef(false);
  // 扫码队列 - 暂存处理中的新扫码
  const scanQueueRef = useRef<string[]>([]);
  const lastScanRef = useRef('');
  const lastScanTimeRef = useRef(0);

  const shouldAcceptScanCode = useCallback((code: string) => {
    if (shouldIgnoreRecentDuplicateScan(code, lastScanRef, lastScanTimeRef)) {
      logger.warn('[盘点] 忽略短时间重复扫码:', code);
      return false;
    }

    return true;
  }, []);

  // 仓库
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);

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

  // AsyncStorage Key
  const INVENTORY_CHECK_RECORDS_KEY = 'inventory_check_records';
  const INVENTORY_CHECK_TYPE_KEY = 'inventory_check_type';
  const INVENTORY_PENDING_WAREHOUSE_KEY = 'inventory_pending_warehouse';
  // 全局仓库 Storage Key
  const GLOBAL_WAREHOUSE_KEY = STORAGE_KEYS.GLOBAL_WAREHOUSE;

  type InventoryDraftStore = Record<string, Partial<Record<CheckType, ScanRecord[]>>>;

  const isScanRecordArray = (value: unknown): value is ScanRecord[] => Array.isArray(value);

  const readCheckDraftStore = async (): Promise<InventoryDraftStore> => {
    const savedRecords = await AsyncStorage.getItem(INVENTORY_CHECK_RECORDS_KEY);
    if (!savedRecords) {
      return {};
    }

    const parsed = safeJsonParseNullable<unknown>(savedRecords, 'inventory.scanRecords');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return parsed as InventoryDraftStore;
  };

  const getDraftRecords = async (
    warehouse: Warehouse | null | undefined,
    type: CheckType
  ): Promise<ScanRecord[]> => {
    if (!warehouse) {
      return [];
    }

    const savedRecords = await AsyncStorage.getItem(INVENTORY_CHECK_RECORDS_KEY);
    if (!savedRecords) {
      return [];
    }

    const parsed = safeJsonParseNullable<unknown>(savedRecords, 'inventory.scanRecords');
    if (!parsed) {
      return [];
    }

    // 兼容旧版本单草稿结构，首次读取后会被新的分类型结构覆盖。
    if (isScanRecordArray(parsed)) {
      const [savedType, savedWarehouse] = await Promise.all([
        AsyncStorage.getItem(INVENTORY_CHECK_TYPE_KEY),
        AsyncStorage.getItem(INVENTORY_PENDING_WAREHOUSE_KEY),
      ]);
      const savedWarehouseInfo = savedWarehouse
        ? safeJsonParseNullable<{ id?: string }>(savedWarehouse, 'inventory.pendingWarehouse')
        : null;
      if ((savedType || 'whole') === type && savedWarehouseInfo?.id === warehouse.id) {
        return parsed;
      }
      return [];
    }

    if (typeof parsed !== 'object') {
      return [];
    }

    const store = parsed as InventoryDraftStore;
    const records = store[warehouse.id]?.[type];
    return Array.isArray(records) ? records : [];
  };

  // 加载指定盘点类型的扫描记录
  const loadCheckRecords = async (warehouse?: Warehouse | null, type: CheckType = checkType) => {
    try {
      if (!warehouse) {
        logger.log('[盘点] 当前仓库未加载，跳过恢复');
        return;
      }

      const records = await getDraftRecords(warehouse, type);
      replaceScanRecords(records);

      if (records.length > 0) {
        showToast(`已恢复 ${records.length} 条${type === 'whole' ? '整包' : '拆包'}暂存`, 'success');
      }
    } catch (error) {
      logger.error('[盘点] 加载记录失败:', error);
    }
  };

  // 保存指定盘点类型的扫描记录
  const saveCheckRecords = async (
    records: ScanRecord[],
    type: CheckType,
    warehouse?: Warehouse | null
  ) => {
    try {
      if (!warehouse) {
        return;
      }

      const store = await readCheckDraftStore();
      const warehouseDraft = { ...(store[warehouse.id] || {}) };

      if (records.length > 0) {
        warehouseDraft[type] = records;
      } else {
        delete warehouseDraft[type];
      }

      if (warehouseDraft.whole?.length || warehouseDraft.partial?.length) {
        store[warehouse.id] = warehouseDraft;
      } else {
        delete store[warehouse.id];
      }

      await AsyncStorage.setItem(INVENTORY_CHECK_RECORDS_KEY, JSON.stringify(store));
      await AsyncStorage.setItem(INVENTORY_CHECK_TYPE_KEY, type);
      if (warehouse) {
        await AsyncStorage.setItem(INVENTORY_PENDING_WAREHOUSE_KEY, JSON.stringify(warehouse));
      }
    } catch (error) {
      logger.error('[盘点] 保存记录失败:', error);
    }
  };

  // 清空扫描记录，可只清当前类型，也可清当前仓库全部盘点草稿
  const clearCheckRecords = async (type?: CheckType, warehouse?: Warehouse | null) => {
    try {
      if (!warehouse) {
        await AsyncStorage.removeItem(INVENTORY_CHECK_RECORDS_KEY);
        await AsyncStorage.removeItem(INVENTORY_CHECK_TYPE_KEY);
        await AsyncStorage.removeItem(INVENTORY_PENDING_WAREHOUSE_KEY);
        return true;
      }

      const store = await readCheckDraftStore();
      if (type) {
        const warehouseDraft = { ...(store[warehouse.id] || {}) };
        delete warehouseDraft[type];

        if (warehouseDraft.whole?.length || warehouseDraft.partial?.length) {
          store[warehouse.id] = warehouseDraft;
        } else {
          delete store[warehouse.id];
        }
      } else {
        delete store[warehouse.id];
      }

      await AsyncStorage.setItem(INVENTORY_CHECK_RECORDS_KEY, JSON.stringify(store));
      await AsyncStorage.setItem(INVENTORY_CHECK_TYPE_KEY, checkType);
      return true;
    } catch (error) {
      logger.error('[盘点] 清空记录失败:', error);
      return false;
    }
  };

  // 拆包数量修改
  const [quantityModalVisible, setQuantityModalVisible] = useState(false);
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

  // Toast
  const { showToast, ToastContainer } = useToast();
  const alert = useCustomAlert();

  useEffect(() => {
    scannerFocusBlockedRef.current =
      showWarehousePicker || quantityModalVisible || saving;
  }, [quantityModalVisible, saving, showWarehousePicker]);

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
      if (errorActionTimerRef.current) {
        clearTimeout(errorActionTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!showWarehousePicker && !quantityModalVisible && !saving) {
      focusScannerInput(80);
    }
  }, [focusScannerInput, quantityModalVisible, saving, showWarehousePicker]);

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
      saveCheckRecords(scanRecords, checkType, currentWarehouse);
    }
  }, [scanRecords, checkType, currentWarehouse]);

  // 删除单条记录
  const handleDeleteRecord = useCallback(
    (record: ScanRecord) => {
      alert.showConfirm(
        '确认删除',
        '确定要删除这条记录吗？',
        () => {
          const updated = scanRecordsRef.current.filter((r) => r.id !== record.id);
          replaceScanRecords(updated);
          void saveCheckRecords(updated, checkType, currentWarehouse);
          showToast('记录已删除', 'success');
        },
        true
      );
    },
    [alert, checkType, currentWarehouse, replaceScanRecords, showToast]
  );

  // 自动清理震动和提示音
  useFeedbackCleanup();

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      let isActive = true;
      const init = async () => {
        // 1. 加载仓库列表（数据库已在 APP 启动时初始化）
        const list = await getAllWarehouses();
        setWarehouses(list);

        // 2. 恢复之前选择的仓库，并等待状态更新
        let warehouse: Warehouse | null = null;
        const savedWarehouse = await AsyncStorage.getItem(GLOBAL_WAREHOUSE_KEY);
        if (savedWarehouse) {
          const saved = safeJsonParseNullable<Warehouse>(
            savedWarehouse,
            'inventory.globalWarehouse'
          );
          // 确保仓库仍然存在
          const latestWarehouse = saved ? list.find((w) => w.id === saved.id) : null;
          if (latestWarehouse) {
            warehouse = latestWarehouse;
            await AsyncStorage.setItem(GLOBAL_WAREHOUSE_KEY, JSON.stringify(latestWarehouse));
          }
        }

        // 没有保存的选择，使用默认仓库
        if (!warehouse) {
          const def = await getDefaultWarehouse();
          warehouse = def || list[0] || null;
        }

        // 3. 设置当前仓库并等待状态更新
        setCurrentWarehouse(warehouse);

        // 4. 加载检查记录（直接使用显式仓库，避免闭包拿到旧状态）
        await loadCheckRecords(warehouse);

        // 5. 聚焦输入框
        if (isActive) {
          focusScannerInput(100);
        }
      };

      init();

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
        if (errorActionTimerRef.current) {
          clearTimeout(errorActionTimerRef.current);
          errorActionTimerRef.current = null;
        }
      };
    }, [focusScannerInput])
  );

  // 加载仓库
  // 切换仓库
  const handleWarehouseChange = async (warehouse: Warehouse) => {
    // 先保存当前仓库的扫码记录
    if (scanRecords.length > 0) {
      await saveCheckRecords(scanRecords, checkType, currentWarehouse);
    }

    // 切换仓库
    setCurrentWarehouse(warehouse);
    await AsyncStorage.setItem(GLOBAL_WAREHOUSE_KEY, JSON.stringify(warehouse));

    // 先重置界面状态，再恢复新仓库自己的暂存
    replaceScanRecords([]);
    expandedGroupsRef.current = new Set();
    setExpandedGroups(new Set());
    setEditingRecord(null);
    setQuantityModalVisible(false);

    await loadCheckRecords(warehouse);
  };

  const handleCheckTypeChange = useCallback(
    async (nextType: CheckType) => {
      if (nextType === checkType) {
        return;
      }

      if (currentWarehouse && scanRecords.length > 0) {
        await saveCheckRecords(scanRecords, checkType, currentWarehouse);
      }

      const savedCount = scanRecords.length;
      const fromLabel = checkType === 'whole' ? '整包' : '拆包';
      const toLabel = nextType === 'whole' ? '整包' : '拆包';

      setCheckType(nextType);
      replaceScanRecords([]);
      expandedGroupsRef.current = new Set();
      setExpandedGroups(new Set());
      setEditingRecord(null);
      setQuantityModalVisible(false);

      if (currentWarehouse) {
        const nextRecords = await getDraftRecords(currentWarehouse, nextType);
        await loadCheckRecords(currentWarehouse, nextType);

        if (savedCount > 0) {
          const restoreText = nextRecords.length > 0 ? `，已恢复${toLabel}${nextRecords.length}条` : '';
          showToast(`${fromLabel}已暂存 ${savedCount} 条${restoreText}，确认盘点会合并保存`, 'success');
        } else if (nextRecords.length > 0) {
          showToast(`已恢复${toLabel}暂存 ${nextRecords.length} 条`, 'success');
        }
      }
    },
    [checkType, currentWarehouse, replaceScanRecords, scanRecords]
  );

  // 处理扫描（带参数版本）
  const processScan = useCallback(
    async (code: string) => {
      if (!code || processingRef.current) return;

      if (!currentWarehouse) {
        const errorDetail = getErrorDetail('ERR_NO_WAREHOUSE', undefined, router);
        showToast(errorDetail.title, 'error');
        if (errorDetail.action && errorDetail.onPress) {
          if (errorActionTimerRef.current) {
            clearTimeout(errorActionTimerRef.current);
          }
          errorActionTimerRef.current = setTimeout(() => {
            errorActionTimerRef.current = null;
            if (screenActiveRef.current) {
              errorDetail.onPress?.();
            }
          }, 500);
        }
        feedbackError();
        return;
      }

      processingRef.current = true;

      try {
        // 解析二维码
        const rule = await detectRule(code);
        if (!rule) {
          const errorDetail = getErrorDetail('ERR_QR_FORMAT', { code }, router);
          showToast(errorDetail.title, 'error');
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
          return;
        }

        // 查找存货编码
        const inventoryCode = await getInventoryCodeByModel(model);

        // 检查重复（只检测追溯码，因为箱号可能重复）
        let isDuplicate = false;

        // 根据追溯码字段判断（已保存的记录）
        if (standardFields.traceNo) {
          const currentRecords = scanRecordsRef.current;
          const existingByTraceNo = currentRecords.find((r) => r.traceNo === standardFields.traceNo);
          if (existingByTraceNo) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
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
          actualQuantity: checkType === 'partial' ? quantity : undefined,
          inventoryCode: inventoryCode || undefined,
          scanTime: formatDateTime(new Date().toISOString()),
          // 扩展字段
          package: standardFields.package || undefined,
          version: version || undefined,
          productionDate: standardFields.productionDate || undefined,
          traceNo: standardFields.traceNo || undefined,
          sourceNo: standardFields.sourceNo || undefined,
          // 自定义字段
          customFields: customFields || {},
        };

        if (checkType === 'partial') {
          const groupKey = buildInventoryGroupKey(newRecord);
          const nextExpandedGroups = new Set(expandedGroupsRef.current);
          nextExpandedGroups.add(groupKey);
          expandedGroupsRef.current = nextExpandedGroups;
          setExpandedGroups(nextExpandedGroups);
        }

        updateScanRecords((prev) => [newRecord, ...prev]);

        showToast(`已扫码：${model}`, 'success');
        feedbackSuccess();
      } catch (e) {
        logger.error('[盘点] 处理失败:', e);
        logger.error(e);
        showToast('处理失败', 'error');
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
            const nextCode = scanQueueRef.current.shift();
            if (nextCode) {
              processScan(nextCode);
            }
          } else {
            // 队列空了，重新聚焦输入框
            focusScannerInput(0);
          }
        }, 0);
      }
    },
    [checkType, currentWarehouse, focusScannerInput, updateScanRecords]
  );

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback(
    (text: string) => {
      // 清除之前的定时器（每次输入都重置）
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        autoSubmitTimerRef.current = setTimeout(() => {
          autoSubmitTimerRef.current = null;
          const code = sanitizeCompactScannerInput(text);
          // 检测到输入完成（输入停止超过阈值，认为扫码完成）
          if (code.length >= 1) {
            // 一维码过滤：不含分隔符的扫码静默忽略
            if (!isQRCode(code)) {
              setInputValue(''); // 清空输入框
              focusScannerInput(0);
              return;
            }
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

      // 输入框被清空时，更新状态
      setInputValue(text);
    },
    [focusScannerInput, processScan, shouldAcceptScanCode]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback(() => {
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    const code = sanitizeCompactScannerInput(inputValue);

    if (!code) return;

    // 一维码过滤：不含分隔符的扫码静默忽略
    if (!isQRCode(code)) {
      setInputValue('');
      focusScannerInput(0);
      return;
    }

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

  // 选择仓库
  const selectWarehouse = async (wh: Warehouse) => {
    // 如果选择的是当前仓库，直接关闭弹窗
    if (wh.id === currentWarehouse?.id) {
      setShowWarehousePicker(false);
      return;
    }

    // 切换到新仓库
    await handleWarehouseChange(wh);
    setShowWarehousePicker(false);
    showToast(`仓库已切换：${wh.name}`, 'success');
    focusScannerInput(100);
  };

  // 打开数量修改弹窗
  const openQuantityModal = (record: ScanRecord) => {
    setEditingRecord(record);
    setQuantityInput(record.actualQuantity?.toString() || record.quantity.toString());
    setQuantityModalVisible(true);
  };

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
    setQuantityModalVisible(false);
    setEditingRecord(null);
    showToast(`实盘数量已改为 ${qty}`, 'success');
    feedbackConfirm();
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

  // 确认盘点
  const handleSaveInventory = async () => {
    if (!currentWarehouse) {
      showToast('请先选择仓库', 'warning');
      feedbackWarning();
      return;
    }
    const wholeDraft = checkType === 'whole'
      ? scanRecords
      : await getDraftRecords(currentWarehouse, 'whole');
    const partialDraft = checkType === 'partial'
      ? scanRecords
      : await getDraftRecords(currentWarehouse, 'partial');
    const allDraftRecords = [
      ...wholeDraft.map((record) => ({ record, type: 'whole' as const })),
      ...partialDraft.map((record) => ({ record, type: 'partial' as const })),
    ];

    if (allDraftRecords.length === 0) {
      showToast('暂无扫描记录', 'warning');
      feedbackWarning();
      return;
    }

    // 数据库已在 APP 启动时初始化，直接处理保存

    setSaving(true);
    try {
      logger.log('[库存盘点] 开始保存盘点记录，共', scanRecords.length, '条');
      const checkNo = await generateCheckNo();
      const today = formatDate(new Date().toISOString());
      const createdAt = getISODateTime();
      logger.log('[库存盘点] 盘点单号:', checkNo);

      const recordsToSave: any[] = [];
      const exportRecords: InventoryExportRecord[] = [];
      for (const { record, type } of allDraftRecords) {
        const base = {
          check_no: checkNo,
          warehouse_id: currentWarehouse.id,
          warehouse_name: currentWarehouse.name,
          inventory_code: record.inventoryCode || '',
          scan_model: record.model,
          batch: record.batch,
          quantity: record.quantity,
          check_type: type,
          actual_quantity: type === 'partial' ? record.actualQuantity : undefined,
          check_date: today,
          notes: '',
          package: record.package,
          version: record.version,
          productionDate: record.productionDate,
          traceNo: record.traceNo,
          sourceNo: record.sourceNo,
          customFields: record.customFields,
        };
        recordsToSave.push(base);
        exportRecords.push({ ...base, created_at: createdAt });
      }
      const exportMode: InventoryExportMode =
        wholeDraft.length > 0 && partialDraft.length > 0
          ? 'complete'
          : wholeDraft.length > 0
            ? 'whole'
            : 'partial';
      const savedCount = recordsToSave.length;

      await addInventoryCheckRecordsBatch(recordsToSave);
      let syncResult: Awaited<ReturnType<typeof syncInventorySnapshot>> = {
        success: false,
        skipped: false,
        message: '电脑同步失败，请稍后重试',
      };
      try {
        syncResult = await syncInventorySnapshot(exportRecords, exportMode, currentWarehouse.name, checkNo);
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

      try {
        const cleared = await clearCheckRecords(checkType, currentWarehouse);
        if (!cleared) {
          throw new Error('本地盘点草稿清理失败');
        }
      } catch (refreshError) {
        logger.error('[库存盘点] 盘点已保存，但界面刷新失败:', refreshError);
        showToast('盘点已保存，但界面刷新失败，请重新进入页面确认', 'warning');
      }
    } catch (error) {
      logger.error('[库存盘点] 保存失败:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`保存失败: ${errorMessage}`, 'error');
      feedbackError();
    } finally {
      setSaving(false);
    }
  };

  // 清空记录
  const handleClearRecords = () => {
    if (scanRecords.length === 0) return;
    replaceScanRecords([]);
    clearCheckRecords(checkType, currentWarehouse);
    showToast('记录已清空', 'warning');
    feedbackWarning();
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
      return sum + (checkType === 'partial' ? t.actualQty : t.qty);
    }, 0);
  }, [modelVersionTotals, checkType]);
  const currentInventoryStep =
    scanRecords.length === 0
      ? 'scan'
      : checkType === 'partial' && quantityModalVisible
        ? 'adjust'
        : 'review';
  const currentInventoryPlaceholder =
    currentInventoryStep === 'scan'
      ? '持续扫描盘点二维码'
      : checkType === 'partial'
        ? '继续扫码或调整实际数量'
        : '继续扫码或确认盘点';

  // 聚合显示数据（按型号+版本号聚合，显示规则与扫码入库保持一致）
  const aggregatedRecords = useMemo(() => {
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
    () => `${[...expandedGroups].join('|')}::${checkType}`,
    [checkType, expandedGroups]
  );
  const workflowSteps = useMemo<WorkflowStep[]>(
    () =>
      checkType === 'partial'
        ? [
            {
              key: 'scan',
              label: '物料',
              status: scanRecords.length === 0 ? 'active' : 'complete',
            },
            {
              key: 'adjust',
              label: '数量',
              status:
                scanRecords.length === 0
                  ? 'pending'
                  : quantityModalVisible
                    ? 'active'
                    : 'complete',
            },
            {
              key: 'review',
              label: '确认',
              status:
                scanRecords.length === 0
                  ? 'pending'
                  : quantityModalVisible
                    ? 'pending'
                    : 'active',
            },
          ]
        : [
            {
              key: 'scan',
              label: '物料',
              status: scanRecords.length === 0 ? 'active' : 'complete',
            },
            {
              key: 'review',
              label: '确认',
              status: scanRecords.length === 0 ? 'pending' : 'active',
            },
          ],
    [checkType, quantityModalVisible, scanRecords.length]
  );
  const workflowMetrics = useMemo<WorkflowMetric[]>(
    () => [
      {
        key: 'step',
        label: '当前步骤',
        value:
          currentInventoryStep === 'scan'
            ? '等待扫码'
            : currentInventoryStep === 'adjust'
              ? '调整数量'
              : '待确认',
        tone: (
          currentInventoryStep === 'scan'
            ? 'default'
            : currentInventoryStep === 'adjust'
              ? 'warning'
              : 'success'
        ) as WorkflowMetric['tone'],
      },
      {
        key: 'mode',
        label: '盘点方式',
        value: checkType === 'partial' ? '拆包盘点' : '整包盘点',
        tone: 'accent',
      },
    ],
    [checkType, currentInventoryStep]
  );

  const renderAggregatedRecord = useCallback(
    ({ item }: { item: any }) => {
      const key = item.key;
      const isExpanded = expandedGroupsRef.current.has(key);

      return (
        <RecordItem
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          onDeleteRecord={handleDeleteRecord}
          onEditQuantity={openQuantityModal}
          checkType={checkType}
          theme={theme}
          styles={styles}
        />
      );
    },
    [
      checkType,
      handleDeleteRecord,
      openQuantityModal,
      styles,
      theme,
      toggleExpand,
    ]
  );

  const aggregatedRecordKeyExtractor = useCallback(
    (item: any) => item.key,
    []
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          {/* 顶栏：盘点类型 + 仓库 */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.7}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            {/* 盘点类型选择 */}
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeBtn, checkType === 'whole' && styles.typeBtnActive]}
                activeOpacity={0.7}
                onPress={() => {
                  void handleCheckTypeChange('whole');
                }}
              >
                <FontAwesome6
                  name="box"
                  size={12}
                  color={checkType === 'whole' ? theme.white : theme.textSecondary}
                />
                <Text style={[styles.typeBtnText, checkType === 'whole' && styles.typeBtnTextActive]}>
                  整包
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeBtn, checkType === 'partial' && styles.typeBtnActive]}
                activeOpacity={0.7}
                onPress={() => {
                  void handleCheckTypeChange('partial');
                }}
              >
                <FontAwesome6
                  name="layer-group"
                  size={12}
                  color={checkType === 'partial' ? theme.white : theme.textSecondary}
                />
                <Text
                  style={[styles.typeBtnText, checkType === 'partial' && styles.typeBtnTextActive]}
                >
                  拆包
                </Text>
              </TouchableOpacity>
            </View>

            {/* 仓库选择 */}
            <TouchableOpacity
              style={styles.warehouseBtn}
              activeOpacity={0.7}
              onPress={() => setShowWarehousePicker(true)}
            >
              <FontAwesome6 name="warehouse" size={14} color={theme.textPrimary} />
              <Text style={styles.warehouseText} numberOfLines={1}>
                {currentWarehouse?.name || '仓库'}
              </Text>
              <FontAwesome6 name="chevron-down" size={10} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <ScanWorkflowPanel
            steps={workflowSteps}
            metrics={workflowMetrics}
          />
        </View>

        {/* 扫码输入 */}
        <View style={[styles.scanBox, inputValue.length > 0 && styles.scanBoxActive]}>
          <TextInput
            ref={inputRef}
            style={styles.scanInput}
            value={inputValue}
            onChangeText={handleInputChange}
            onSubmitEditing={handleSubmitEditing}
            onBlur={() => focusScannerInput(120)}
            placeholder={currentInventoryPlaceholder}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus={false}
            showSoftInputOnFocus={false}
          />
        </View>

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
          {scanRecords.length > 0 && (
            <View style={styles.actionBar}>
              <TouchableOpacity
                style={styles.clearBtn}
                activeOpacity={0.7}
                onPress={handleClearRecords}
              >
                <Text style={styles.clearBtnText}>清空</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                activeOpacity={0.7}
                onPress={handleSaveInventory}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>确认盘点</Text>
                )}
              </TouchableOpacity>
            </View>
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
                    <FontAwesome6 name="check" size={16} color={theme.primary} />
                  )}
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.pickerClose}
                activeOpacity={0.7}
                onPress={() => setShowWarehousePicker(false)}
              >
                <Text style={styles.pickerCloseText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* 拆包数量修改弹窗 */}
        <Modal
          visible={quantityModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setQuantityModalVisible(false)}
        >
          <View style={quantityModalStyles.modalOverlay}>
            <AppModalCard
              title="修改实际数量"
              subtitle={editingRecord ? `用于修正 ${editingRecord.model} 的实际数量` : undefined}
              onClose={() => setQuantityModalVisible(false)}
              style={quantityModalStyles.modalContent}
              bodyStyle={quantityModalStyles.modalBody}
              size="compact"
              stretchBody
              footer={
                <AppModalActions
                  secondaryLabel="取消"
                  onSecondaryPress={() => setQuantityModalVisible(false)}
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
