import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  FlatList,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import {
  ScanWorkflowPanel,
  type WorkflowMetric,
} from '@/components/ScanWorkflowPanel';
import { createStyles } from './styles';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';
import {
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
  addInboundRecordsBatch,
  updateInboundSummary,
  generateInboundNo,
  detectRule,
  parseWithRule,
  getInventoryCodeByModel,
  getSupplierByModel,
  generateId,
  updateInboundDocumentSyncStatus,
  checkInboundTraceNoExists,
} from '@/utils/database';
import { isQRCode } from '@/utils/qrcodeParser';
import { parseQuantity } from '@/utils/quantity';

import { Feather, FontAwesome6 } from '@expo/vector-icons';
import { feedbackSuccess, feedbackError, feedbackWarning, feedbackDuplicate, feedbackInboundComplete, feedbackClear, useFeedbackCleanup } from '@/utils/feedback';
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
import {
  sanitizeCompactScannerInput,
  shouldIgnoreRecentDuplicateScan,
} from '@/utils/scannerInput';

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
  // 扩展字段
  package?: string;
  version?: string;
  productionDate?: string;
  traceNo?: string;
  sourceNo?: string;
  // 自定义字段
  customFields?: Record<string, string>;
  // 是否已确认
  confirmed?: boolean;
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
        record.productionDate || '',
        record.quantity ?? '',
      ].join(':')
    )
    .join('|');

const RecordItem = React.memo(({ item, isExpanded, isConfirmed, onToggle, onConfirm, onDeleteRecord, theme, styles }: {
  item: any;
  isExpanded: boolean;
  isConfirmed: boolean;
  onToggle: (key: string) => void;
  onConfirm: (key: string) => void;
  onDeleteRecord: (record: any) => void;
  theme: any;
  styles: any;
}) => {
  const key = `${item.model}|${item.version}`;

  return (
    <View key={key} style={styles.itemContainer}>
      {/* 聚合项 - 两行布局 */}
      <TouchableOpacity
        style={[
          styles.itemRow,
          isConfirmed && styles.itemConfirmed
        ]}
      >
        {/* 勾选框 */}
        <TouchableOpacity style={styles.checkbox}
          activeOpacity={0.7} onPress={() => onConfirm(key)}
        >
          <FontAwesome6
            name={isConfirmed ? "square-check" : "square"}
            size={18}
            color={isConfirmed ? theme.success : theme.textMuted}
          />
        </TouchableOpacity>

        {/* 型号内容（包含型号和版本号两行） */}
        <TouchableOpacity style={styles.modelContent}
          activeOpacity={0.7} onPress={() => onToggle(key)}
        >
          <Text style={[styles.itemModel, isConfirmed && styles.itemModelConfirmed]}>
            {isExpanded ? '▼' : '▶'} {item.model}
          </Text>
          <Text style={[styles.itemBatch, isConfirmed && styles.itemModelConfirmed]}>
            版本: {item.version || '-'}
          </Text>
        </TouchableOpacity>

        {/* 数量 */}
        <Text style={[styles.itemQty, isConfirmed && styles.itemQtyConfirmed]}>
          {item.totalQuantity.toLocaleString()}
        </Text>
      </TouchableOpacity>

      {/* 展开的明细 */}
      {isExpanded && (
        <View style={styles.detailsContainer}>
          {item.records.map((record: any) => (
            <TouchableOpacity
              key={record.id}
              style={styles.detailItem}
              onLongPress={() => onDeleteRecord(record)}
              delayLongPress={500}
            >
              <Text style={styles.detailText}>
                批次: {record.batch || '-'}  |  生产日期: {record.productionDate || '-'}  |  数量: {record.quantity}
              </Text>
              <Text style={styles.detailText}>
                版本号: {record.version || '-'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数：只有关键属性变化时才重新渲染
  return (
    prevProps.item.model === nextProps.item.model &&
    prevProps.item.version === nextProps.item.version &&
    prevProps.item.totalQuantity === nextProps.item.totalQuantity &&
    prevProps.item.count === nextProps.item.count &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isConfirmed === nextProps.isConfirmed &&
    getRecordRenderSignature(prevProps.item.records) === getRecordRenderSignature(nextProps.item.records)
  );
});

export default function InboundScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const alert = useCustomAlert();
  const router = useSafeRouter();

  // 输入
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const processingRef = useRef(false);
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
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);

  // 当前供应商（从物料管理获取）
  const [currentSupplier, setCurrentSupplier] = useState<string | null>(null);

  // 入库单号
  const [inboundNo, setInboundNo] = useState('');

  // AsyncStorage Key
  const INBOUND_SCAN_RECORDS_KEY = 'inbound_scan_records';
  const INBOUND_PENDING_DATA_KEY = 'inbound_pending_data';
  // 全局仓库 Storage Key
  const GLOBAL_WAREHOUSE_KEY = STORAGE_KEYS.GLOBAL_WAREHOUSE;
  const getInboundDraftKeys = (warehouseId?: string | null) => {
    if (!warehouseId) {
      return {
        recordsKey: INBOUND_SCAN_RECORDS_KEY,
        pendingKey: INBOUND_PENDING_DATA_KEY,
      };
    }

    return {
      recordsKey: `${INBOUND_SCAN_RECORDS_KEY}:${warehouseId}`,
      pendingKey: `${INBOUND_PENDING_DATA_KEY}:${warehouseId}`,
    };
  };

  // 扫描记录
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const scanRecordsRef = useRef<ScanRecord[]>([]);
  const [saving, setSaving] = useState(false);

  // 已保存入库记录
  // Toast
  const { showToast, ToastContainer } = useToast();

  useEffect(() => {
    scanRecordsRef.current = scanRecords;
  }, [scanRecords]);

  useEffect(() => {
    scannerFocusBlockedRef.current = showWarehousePicker || saving;
  }, [saving, showWarehousePicker]);

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

  useEffect(() => () => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
    }
    if (postProcessTimerRef.current) {
      clearTimeout(postProcessTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!showWarehousePicker && !saving) {
      focusScannerInput(80);
    }
  }, [focusScannerInput, saving, showWarehousePicker]);

  // 展开状态管理（用 ref 同步，避免 renderAggregatedRecord 频繁重建）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());

  // 确认状态管理
  const [confirmedGroups, setConfirmedGroups] = useState<Set<string>>(new Set());
  const confirmedGroupsRef = useRef<Set<string>>(new Set());

  // 加载扫描记录
  const loadScanRecords = async (warehouse?: Warehouse | null): Promise<string | null> => {
    try {
      const currentWarehouseId = warehouse?.id;
      if (!currentWarehouseId) {
        logger.log('[loadScanRecords] 当前仓库未加载，跳过恢复');
        return null;
      }

      const draftKeys = getInboundDraftKeys(currentWarehouseId);
      let savedRecords = await AsyncStorage.getItem(draftKeys.recordsKey);
      let pendingData = await AsyncStorage.getItem(draftKeys.pendingKey);
      let shouldMigrateLegacyDraft = false;

      // 兼容旧版本的单槽草稿，恢复成功后迁移到按仓库隔离的新 key。
      if (!savedRecords) {
        savedRecords = await AsyncStorage.getItem(INBOUND_SCAN_RECORDS_KEY);
        pendingData = await AsyncStorage.getItem(INBOUND_PENDING_DATA_KEY);
        shouldMigrateLegacyDraft = Boolean(savedRecords);
      }

      if (savedRecords) {
        const records = safeJsonParseNullable<ScanRecord[]>(savedRecords, 'inbound.scanRecords');
        if (!records) {
          return null;
        }
        let restoredInboundNo: string | null = null;

        // 恢复供应商和入库单号，同时检查仓库是否匹配
        if (pendingData) {
          const data = safeJsonParseNullable<{
            supplier?: string | null;
            inboundNo?: string;
            warehouseId?: string;
            warehouseName?: string;
          }>(pendingData, 'inbound.pendingData');
          if (!data) {
            return null;
          }

          // 验证保存时的仓库是否与当前仓库匹配（使用传入的 warehouse 参数，避免状态闭包问题）
          if (data.warehouseId) {
            if (data.warehouseId !== currentWarehouseId) {
              // 仓库不匹配，不恢复记录
              logger.log('[loadScanRecords] 仓库不匹配，跳过恢复:', {
                savedWarehouseId: data.warehouseId,
                currentWarehouseId: currentWarehouseId,
              });
              return null;
            }
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
            [draftKeys.recordsKey, savedRecords],
            [
              draftKeys.pendingKey,
              pendingData || JSON.stringify({
                supplier: currentSupplier,
                inboundNo: restoredInboundNo || inboundNo,
                warehouseId: currentWarehouseId,
                warehouseName: warehouse?.name,
              }),
            ],
          ]);
          await AsyncStorage.multiRemove([INBOUND_SCAN_RECORDS_KEY, INBOUND_PENDING_DATA_KEY]);
        }

        return restoredInboundNo;
      }
    } catch (error) {
      logger.error('加载扫描记录失败:', error);
    }

    return null;
  };

  // 保存扫描记录
  const saveScanRecords = async (records: ScanRecord[], supplier?: string | null) => {
    try {
      const draftKeys = getInboundDraftKeys(currentWarehouse?.id);
      await AsyncStorage.setItem(draftKeys.recordsKey, JSON.stringify(records));
      
      const pendingData = {
        supplier: supplier || currentSupplier,
        inboundNo: inboundNo,
        warehouseId: currentWarehouse?.id,
        warehouseName: currentWarehouse?.name,
      };
      await AsyncStorage.setItem(draftKeys.pendingKey, JSON.stringify(pendingData));
    } catch (error) {
      logger.error('保存扫描记录失败:', error);
    }
  };

  // 清空扫描记录
  const clearScanRecords = async () => {
    try {
      const draftKeys = getInboundDraftKeys(currentWarehouse?.id);
      await AsyncStorage.multiRemove([
        draftKeys.recordsKey,
        draftKeys.pendingKey,
        INBOUND_SCAN_RECORDS_KEY,
        INBOUND_PENDING_DATA_KEY,
      ]);
    } catch (error) {
      logger.error('清空扫描记录失败:', error);
    }
  };

  // 初始化
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
          const saved = safeJsonParseNullable<Warehouse>(savedWarehouse, 'inbound.globalWarehouse');
          // 确保仓库仍然存在
          const latestWarehouse = saved ? list.find(w => w.id === saved.id) : null;
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

        // 4. 加载扫描记录（直接传入 warehouse 参数，避免状态闭包问题）
        const restoredInboundNo = await loadScanRecords(warehouse);

        // 5. 如果没有入库单号，生成新单号
        if (!restoredInboundNo) {
          await generateNo();
        }

        // 7. 聚焦输入框
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
      };
    }, [focusScannerInput])
  );

  // 加载仓库
  // 切换仓库
  const handleWarehouseChange = async (warehouse: Warehouse) => {
    // 先 flush 缓冲中的记录，再保存当前仓库的扫码记录
    flushPendingRecords();
    if (scanRecordsRef.current.length > 0) {
      await saveScanRecords(scanRecordsRef.current);
    }

    // 切换仓库
    setCurrentWarehouse(warehouse);
    await AsyncStorage.setItem(GLOBAL_WAREHOUSE_KEY, JSON.stringify(warehouse));

    // 先重置界面状态，再恢复新仓库自己的暂存
    pendingRecordsRef.current = [];
    scanRecordsRef.current = [];
    setScanRecords([]);
    setCurrentSupplier(null);
    setInboundNo('');

    // 清空展开和确认状态（同步 ref）
    expandedGroupsRef.current = new Set();
    confirmedGroupsRef.current = new Set();
    setExpandedGroups(new Set());
    setConfirmedGroups(new Set());

    const restoredInboundNo = await loadScanRecords(warehouse);

    if (!restoredInboundNo) {
      await generateNo();
    }
  };

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
  }, [currentSupplier]);

  // 生成入库单号
  const generateNo = async () => {
    const no = await generateInboundNo();
    setInboundNo(no);
  };

  // 处理扫描（带参数版本，供自动触发调用）
  const processScan = useCallback(async (code: string) => {
    if (!code || processingRef.current) return;

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
    } | null = null;

    try {
      // 解析二维码
      try {
        const rule = await detectRule(code);
        logger.log('[扫码入库] 检测到规则:', { ruleName: rule?.name, ruleSeparator: rule?.separator, codeLength: code.length });
        if (rule) {
          const { standardFields, customFields } = parseWithRule(code, rule);
          logger.log('[扫码入库] 解析结果:', { standardFields, customFieldsCount: Object.keys(customFields || {}).length });
          parsed = {
            model: standardFields.model || '',
            batch: standardFields.batch || '',
            quantity: standardFields.quantity || '1',
            package: standardFields.package || '',
            version: standardFields.version || '',
            productionDate: standardFields.productionDate || '',
            traceNo: standardFields.traceNo || '',
            sourceNo: standardFields.sourceNo || '',
            customFields: customFields || {},
          };
        } else {
          logger.warn('[扫码入库] 未检测到匹配的解析规则');
        }
      } catch (e) {
        logger.error('[扫码入库] 规则解析失败:', e);
        showToast(`解析规则异常：${e instanceof Error ? e.message : String(e)}`, 'error');
      }

      if (!parsed || !parsed.model) {
        showToast(`未识别到物料信息\n内容: ${code.substring(0, 20)}${code.length > 20 ? '...' : ''}`, 'error');
        feedbackError();
        logger.error('[扫码入库] 无法识别物料信息:', { code, parsed, parsedModel: parsed?.model });
        return;
      }

      const parsedRecord = parsed;
      const quantity = parseQuantity(parsedRecord.quantity, { min: 1 });

      if (quantity === null) {
        logger.warn('[扫码入库] 忽略数量字段无效的扫码内容:', {
          code,
          quantity: parsedRecord.quantity,
          model: parsedRecord.model,
        });
        return;
      }

      // 查找存货编码和供应商
      const inventoryCode = await getInventoryCodeByModel(parsedRecord.model);
      const supplier = await getSupplierByModel(parsedRecord.model);

      logger.log('[扫码入库] 查询结果:', {
        model: parsedRecord.model,
        inventoryCode,
        supplier,
        currentSupplier,
      });

      // 检查供应商一致性（仅警告，不阻止入库）
      if (supplier && currentSupplier && supplier !== currentSupplier) {
        logger.warn('[扫码入库] 供应商不一致:', {
          currentSupplier,
          newSupplier: supplier,
          model: parsedRecord.model,
        });
        // 改为警告提示，不阻止入库
        showToast(`供应商不一致\n当前: ${currentSupplier}\n本次: ${supplier}`, 'warning');
        // 继续处理，不 return
      }

      // 首次扫描时设置供应商
      if (!currentSupplier && supplier) {
        setCurrentSupplier(supplier);
      }

      // 检查是否重复扫描（只检测追溯码，因为箱号可能重复）
      let isDuplicate = false;

      // 根据追溯码判断（已保存的记录 + 缓冲中未 flush 的记录）
      if (parsedRecord.traceNo) {
        const allCurrentRecords = [...pendingRecordsRef.current, ...scanRecordsRef.current];
        const existing = allCurrentRecords.find(r => r.traceNo === parsedRecord.traceNo);
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
        model: parsedRecord.model,
        batch: parsedRecord.batch,
        quantity,
        scanTime: formatDateTime(new Date().toISOString()),
        rawContent: code,
        inventoryCode: inventoryCode || undefined,
        supplier: supplier || undefined,
        // 扩展字段
        package: parsedRecord.package || undefined,
        version: parsedRecord.version || undefined,
        productionDate: parsedRecord.productionDate || undefined,
        traceNo: parsedRecord.traceNo || undefined,
        sourceNo: parsedRecord.sourceNo || undefined,
        // 自定义字段
        customFields: parsedRecord.customFields,
      };
      pendingRecordsRef.current.push(newRecord);
      void saveScanRecords(
        [...pendingRecordsRef.current, ...scanRecordsRef.current],
        supplier || currentSupplier
      );
      showToast(`已扫码：${parsedRecord.model}`, 'success');
      feedbackSuccess();
    } catch (e) {
      logger.error('[扫码入库] 处理失败:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
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
            processScan(nextCode);
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
  }, [currentWarehouse, currentSupplier, focusScannerInput]);

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback((text: string) => {
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
  }, [focusScannerInput, processScan, shouldAcceptScanCode]);

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
    if (!currentWarehouse) {
      showToast('请先选择仓库', 'warning');
      feedbackWarning();
      return;
    }
    const recordsSnapshot = flushPendingRecords();
    if (recordsSnapshot.length === 0) {
      showToast('暂无扫描记录', 'warning');
      feedbackWarning();
      return;
    }

    // 数据库级 traceNo 重复检测
    const traceNoRecords = recordsSnapshot.filter(r => r.traceNo && r.traceNo.trim());
    if (traceNoRecords.length > 0) {
      const uniqueTraceNos = [...new Set(traceNoRecords.map(r => r.traceNo!.trim()))];
      const checkResults = await Promise.all(
        uniqueTraceNos.map(async (traceNo) => ({
          traceNo,
          exists: await checkInboundTraceNoExists(traceNo),
        }))
      );
      const duplicates = checkResults.filter(r => r.exists).map(r => r.traceNo);
      if (duplicates.length > 0) {
        alert.showAlert(
          '重复追踪码',
          `以下追踪码已存在于数据库中，无法重复入库：\n${duplicates.join('\n')}`,
          [{ text: '确定' }],
          'warning',
        );
        feedbackWarning();
        return;
      }
    }

    setSaving(true);
    try {
      const today = formatDate(new Date().toISOString());
      const createdAt = getISODateTime();

      const recordsToSave: any[] = [];
      const exportRecords: InboundExportRecord[] = [];
      for (const record of recordsSnapshot) {
        const base = {
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
      feedbackInboundComplete();

      try {
        await clearScanRecords();

        // 更新入库汇总表（按型号+版本号+入库日期每日统计）
        await updateInboundSummary(currentWarehouse.id);

        await generateNo();
      } catch (refreshError) {
        logger.error('[handleSaveInbound] 入库已保存，但刷新失败:', refreshError);
        showToast('入库已保存，但界面刷新失败，请重新进入页面确认', 'warning');
      }
    } catch (error) {
      logger.error('[handleSaveInbound] 保存失败:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showToast(`保存失败: ${errorMessage}`, 'error');
      feedbackError();
    } finally {
      setSaving(false);
    }
  };

  // 清空记录
  const handleClearRecords = () => {
    if (scanRecords.length === 0 && pendingRecordsRef.current.length === 0) return;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingRecordsRef.current = [];
    scanRecordsRef.current = [];
    setScanRecords([]);
    setCurrentSupplier(null);
    clearScanRecords();
    showToast('记录已清空', 'warning');
    feedbackClear();
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
  const handleDeleteRecord = useCallback((record: ScanRecord) => {
    alert.showConfirm(
      '确认删除',
      '确定要删除这条记录吗？',
      () => {
        flushPendingRecords();
        const updated = scanRecordsRef.current.filter(r => r.id !== record.id);
        scanRecordsRef.current = updated;
        setScanRecords(updated);
        saveScanRecords(updated);
        showToast('记录已删除', 'success');
      },
      true
    );
  }, [alert, flushPendingRecords, showToast]);

  // 计算总数量
  const totalQuantity = scanRecords.reduce((sum, r) => sum + r.quantity, 0);

  // 计算已确认数量
  const confirmedCount = confirmedGroups.size;
  const currentInboundStep = scanRecords.length === 0 ? 'scan' : 'review';
  const currentInboundPlaceholder =
    currentInboundStep === 'scan' ? '持续扫描物料二维码' : '继续扫描或确认保存';

  // 聚合扫描记录（按型号+版本号聚合，用于显示）
  const aggregatedRecords = useMemo(() => {
    const map = new Map<string, { records: ScanRecord[], totalQuantity: number }>();
    
    scanRecords.forEach(record => {
      const key = `${record.model}|${record.version || ''}`;
      if (!map.has(key)) {
        map.set(key, { records: [], totalQuantity: 0 });
      }
      const group = map.get(key)!;
      group.records.push(record);
      group.totalQuantity += record.quantity;
    });
    
    return Array.from(map.entries())
      .map(([key, group]) => {
        const [model, version] = key.split('|');
        const records = group.records.slice().sort((a, b) => b.id.localeCompare(a.id));
        return {
          model,
          version: version || '',
          records,
          totalQuantity: group.totalQuantity,
          count: group.records.length,
        };
      })
      .sort((a, b) => (b.records[0]?.id || '').localeCompare(a.records[0]?.id || ''));
  }, [scanRecords]);

  // 数据变化时自动保存到 AsyncStorage（实现持久化）
  useEffect(() => {
    // 当有扫描记录时自动保存
    if (scanRecords.length > 0) {
      saveScanRecords(scanRecords, currentSupplier);
      logger.log('[入库] 数据变化，自动保存记录:', scanRecords.length);
    }
  }, [scanRecords, currentSupplier, currentWarehouse]);

  const inboundListState = useMemo(
    () => `${[...expandedGroups].join('|')}::${[...confirmedGroups].join('|')}`,
    [expandedGroups, confirmedGroups]
  );

  const workflowMetrics = useMemo<WorkflowMetric[]>(() => {
    const metrics: WorkflowMetric[] = [
      {
        key: 'supplier',
        label: '供应商',
        value: currentSupplier || '未设置',
        tone: currentSupplier ? 'default' : 'warning',
      },
    ];

    return metrics;
  }, [currentSupplier]);

  const renderAggregatedRecord = useCallback(({ item }: { item: any }) => {
    const key = `${item.model}|${item.version}`;
    const isExpanded = expandedGroupsRef.current.has(key);
    const isConfirmed = confirmedGroupsRef.current.has(key);

    return (
      <RecordItem
        item={item}
        isExpanded={isExpanded}
        isConfirmed={isConfirmed}
        onToggle={toggleExpand}
        onConfirm={toggleConfirm}
        onDeleteRecord={handleDeleteRecord}
        theme={theme}
        styles={styles}
      />
    );
  }, [handleDeleteRecord, styles, theme, toggleConfirm, toggleExpand]);

  const aggregatedRecordKeyExtractor = useCallback(
    (item: any) => `${item.model}|${item.version}`,
    []
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          {/* 顶部：仓库选择 + 供应商 */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => router.back()}>
              <Feather name="arrow-left" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.warehouseBtn} activeOpacity={0.7} onPress={() => setShowWarehousePicker(true)}>
              <FontAwesome6 name="warehouse" size={14} color={theme.textPrimary} />
              <Text style={styles.warehouseText} numberOfLines={1} ellipsizeMode="tail">
                {currentWarehouse?.name || Str.labelSelectWarehouse}
              </Text>
              <FontAwesome6 name="chevron-down" size={10} color={theme.textMuted} />
            </TouchableOpacity>
            <View style={[styles.supplierTag, currentInboundStep === 'scan' && styles.supplierTagActive]}>
              <FontAwesome6
                name={currentInboundStep === 'scan' ? 'magnifying-glass' : 'floppy-disk'}
                size={12}
                color={theme.textPrimary}
              />
              <Text
                style={[styles.supplierText, currentInboundStep === 'scan' && styles.supplierTextActive]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {currentInboundStep === 'scan' ? '等待扫码' : '待保存'}
              </Text>
            </View>
          </View>

          <ScanWorkflowPanel metrics={workflowMetrics} />
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
            placeholder={currentInboundPlaceholder}
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
            <Text style={styles.listTitle}>待入库记录</Text>
            <Text style={styles.listCount}>
              {aggregatedRecords.length} 型号 / {totalQuantity} PCS
              {confirmedCount > 0 && ` / 已确认 ${confirmedCount}`}
            </Text>
          </View>
          <FlatList
            style={styles.list}
            contentContainerStyle={aggregatedRecords.length === 0 ? styles.listEmptyContent : styles.listContent}
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
                title="暂无扫描记录"
                description="扫码后的待入库记录会显示在这里"
                compact
                style={styles.empty}
              />
            }
          />

          {/* 操作按钮 */}
          {scanRecords.length > 0 && (
            <View style={styles.actionBar}>
              <TouchableOpacity style={styles.clearBtn} activeOpacity={0.7} onPress={handleClearRecords}>
                <Feather name="trash-2" size={17} color={theme.textSecondary} />
                <Text style={styles.clearBtnText}>{Str.btnClear}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                activeOpacity={0.7}
                onPress={handleSaveInbound}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={theme.buttonPrimaryText} />
                ) : (
                  <>
                    <Feather name="check-circle" size={18} color={theme.buttonPrimaryText} />
                    <Text style={styles.submitBtnText}>保存入库</Text>
                  </>
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
              {warehouses.map(wh => (
                <TouchableOpacity key={wh.id}
                  style={[styles.pickerItem, currentWarehouse?.id === wh.id && styles.pickerItemActive]}
                  activeOpacity={0.7} onPress={() => selectWarehouse(wh)}
                >
                  <Text style={styles.pickerItemText}>{wh.name}</Text>
                  {currentWarehouse?.id === wh.id && (
                    <FontAwesome6 name="check" size={16} color={theme.primary} />
                  )}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.pickerClose} activeOpacity={0.7} onPress={() => setShowWarehousePicker(false)}>
                <Text style={styles.pickerCloseText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {alert.AlertComponent}
        <ToastContainer />


      </View>
    </Screen>
  );
}
