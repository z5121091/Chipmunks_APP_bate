import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';
import { parseQuantity } from '@/utils/quantity';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { useCustomAlert } from '@/components/CustomAlert';
import {
  ScanWorkflowPanel,
  type WorkflowMetric,
} from '@/components/ScanWorkflowPanel';
import { createStyles } from './styles';
import { parseQRCodeSync, isQRCode } from '@/utils/qrcodeParser';
import {
  initDatabase,
  upsertOrder,
  addMaterialWithOrder,
  getOrder,
  detectRule,
  parseWithRule,
  checkMaterialExists,
  searchMaterials,
  getInventoryCodeByModel,
  deleteMaterial,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
} from '@/utils/database';
import {
  scanQueue,
  QueueItem,
  QueueItemParsedPayload,
} from '@/utils/scanQueue';
import { STORAGE_KEYS } from '@/constants/config';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import {
  feedbackSuccess,
  feedbackCustomerSuccess,
  feedbackError,
  feedbackWarning,
  feedbackDuplicate,
  feedbackNeedCustomerName,
  feedbackSwitchOrder,
  initSoundSetting,
  useFeedbackCleanup,
} from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { getISODateTime } from '@/utils/time';
import {
  sanitizeLooseScannerInput,
  shouldIgnoreRecentDuplicateScan,
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

const CUSTOMER_NAME_HAS_CHINESE_REGEX = /[\u3400-\u9fff\uf900-\ufaff]/;
const CUSTOMER_NAME_ALLOWED_REGEX = /^[\u3400-\u9fff\uf900-\ufaffA-Za-z0-9（）()【】\[\]·•&\-—_.、，,．。\s]+$/;
const OUTBOUND_WORK_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const normalizeOrderNoCandidate = (value: string) => value.trim().replace(/\s+/g, '').toUpperCase();

const sanitizeScannerInput = sanitizeLooseScannerInput;

const normalizeCustomerNameScan = (value: string) => sanitizeScannerInput(value);

const isValidCustomerNameScan = (
  value: string,
  orderRule: OutboundOrderRuleConfig,
  warehouseRules: OutboundWarehouseSampleRuleMap
) => {
  const normalized = normalizeCustomerNameScan(value);
  if (!normalized || normalized.length < 2 || normalized.length > 40) {
    return false;
  }

  const normalizedOrderCandidate = normalizeOrderNoCandidate(normalized);
  if (getMatchingOutboundWarehouseOrderRules(normalizedOrderCandidate, warehouseRules).length > 0) {
    return false;
  }

  if (Object.keys(warehouseRules).length === 0 && isOutboundOrderNo(normalizedOrderCandidate, orderRule)) {
    return false;
  }

  return (
    CUSTOMER_NAME_HAS_CHINESE_REGEX.test(normalized) &&
    CUSTOMER_NAME_ALLOWED_REGEX.test(normalized)
  );
};

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

interface OutboundWorkDraft {
  orderNo: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  updatedAt: string;
}

const isOutboundWorkDraft = (value: unknown): value is OutboundWorkDraft => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const draft = value as OutboundWorkDraft;
  return (
    typeof draft.orderNo === 'string' &&
    typeof draft.customerName === 'string' &&
    typeof draft.warehouseId === 'string' &&
    typeof draft.warehouseName === 'string' &&
    typeof draft.updatedAt === 'string'
  );
};

const isFreshOutboundWorkDraft = (draft: OutboundWorkDraft) => {
  const updatedAt = new Date(draft.updatedAt).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= OUTBOUND_WORK_DRAFT_MAX_AGE_MS;
};

const createOutboundWorkDraft = (
  orderNo: string,
  customerName: string,
  warehouse: Warehouse
): OutboundWorkDraft => ({
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
  customFields: parsed.customFields,
});

// ========================================
// React.memo 优化：列表项组件
// ========================================
const getRecordRenderSignature = (items: MaterialItem[] = []) =>
  items
    .map((item) =>
      [
        item.id || '',
        item.version || '',
        item.batch || '',
        item.sourceNo || '',
        item.package || '',
        item.productionDate || '',
        item.quantity ?? '',
      ].join(':')
    )
    .join('|');

const buildMaterialGroupKey = (item: MaterialItem) =>
  JSON.stringify([
    item.model || '',
    item.version || '',
  ]);

const RecordItem = React.memo(
  ({
    group,
    isExpanded,
    onToggle,
    onDeleteItem,
    styles,
  }: {
    group: AggregatedGroup;
    isExpanded: boolean;
    onToggle: (key: string) => void;
    onDeleteItem: (item: MaterialItem) => void;
    styles: ReturnType<typeof createStyles>;
  }) => {
    return (
      <View key={group.key}>
        {/* 聚合项（两行布局） */}
        <TouchableOpacity
          style={styles.itemRow}
          activeOpacity={0.7}
          onPress={() => onToggle(group.key)}
        >
          <View style={styles.itemLeft}>
            <Text style={styles.itemModel}>
              {isExpanded ? '▼' : '▶'} {group.model}
            </Text>
            <Text style={styles.itemBatch}>版本: {group.version || '-'}</Text>
          </View>
          <View style={styles.itemRight}>
            <Text style={styles.itemQty}>{group.totalQuantity.toLocaleString()}</Text>
          </View>
        </TouchableOpacity>

        {/* 展开的明细 */}
        {isExpanded && (
          <View style={styles.detailsContainer}>
            {group.items.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.detailItem}
                onLongPress={() => onDeleteItem(item)}
                delayLongPress={500}
              >
                <Text style={styles.detailText}>
                  批次: {item.batch || '-'} | 生产日期: {item.productionDate || '-'} | 数量:{' '}
                  {parseInt(item.quantity, 10) || 0}
                </Text>
                <Text style={styles.detailText}>版本号: {item.version || '-'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：只有关键属性变化时才重新渲染
    return (
      prevProps.group.model === nextProps.group.model &&
      prevProps.group.version === nextProps.group.version &&
      prevProps.group.totalQuantity === nextProps.group.totalQuantity &&
      prevProps.group.boxCount === nextProps.group.boxCount &&
      prevProps.isExpanded === nextProps.isExpanded &&
      getRecordRenderSignature(prevProps.group.items) === getRecordRenderSignature(nextProps.group.items)
    );
  }
);

export default function PDAScanScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const alert = useCustomAlert();

  // 初始化声音设置
  useEffect(() => {
    initSoundSetting();
  }, []);

  // 输入
  const inputRef = useRef<TextInput>(null);
  const [inputValue, setInputValue] = useState('');
  const processingRef = useRef(false);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postProcessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(true);
  const liveInputValueRef = useRef('');
  const pendingScanCodesRef = useRef<string[]>([]);
  const lastScanRef = useRef('');
  const lastScanTimeRef = useRef(0);
  const scannerFocusBlockedRef = useRef(false);
  const orderNoRef = useRef(''); // 🔥 添加 orderNoRef，用于批量写入时判断是否需要刷新

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
  // 🔥 同步 orderNo 到 orderNoRef（避免闭包问题）
  useEffect(() => {
    orderNoRef.current = orderNo;
  }, [orderNo]);

  // 扫码记录（参考入库实现）
  const [scanRecords, setScanRecords] = useState<MaterialItem[]>([]);

  // 聚合展开状态（记录哪些聚合组是展开的）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const expandedGroupsRef = useRef<Set<string>>(new Set());

  // Toast
  const { showToast, ToastContainer } = useToast();
  const currentScanStep = !orderNo
    ? 'order'
    : customerName.trim()
      ? 'material'
      : 'customer';
  const currentScanPlaceholder =
    currentScanStep === 'order'
      ? '先扫描订单号'
      : currentScanStep === 'customer'
        ? '再扫描客户名称二维码'
        : '继续扫描物料二维码';

  useEffect(() => {
    scannerFocusBlockedRef.current = showWarehousePicker;
  }, [showWarehousePicker]);

  const showAlertIfActive = useCallback((title: string, message: string) => {
    if (!screenActiveRef.current) {
      return;
    }

    alert.showAlert(title, message, [{ text: '知道了' }], 'warning');
  }, [alert]);

  const shouldAcceptScanCode = useCallback((code: string) => {
    if (shouldIgnoreRecentDuplicateScan(code, lastScanRef, lastScanTimeRef)) {
      logger.warn('[扫码出库] 忽略短时间重复扫码:', code);
      return false;
    }

    return true;
  }, []);

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
    if (!showWarehousePicker) {
      focusScannerInput(80);
    }
  }, [focusScannerInput, showWarehousePicker]);

  // AsyncStorage Key
  const OUTBOUND_SCAN_RECORDS_KEY = 'outbound_scan_records';

  const saveOutboundWorkDraft = useCallback(
    async (nextOrderNo: string, nextCustomerName: string, warehouse: Warehouse) => {
      const draft = createOutboundWorkDraft(nextOrderNo, nextCustomerName, warehouse);
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT, JSON.stringify(draft)),
        AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, draft.orderNo),
      ]);
    },
    []
  );

  const clearOutboundWorkDraft = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT),
      AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO),
    ]);
  }, []);

  // 自动清理震动和提示音
  useFeedbackCleanup();

  // 页面聚焦时初始化和恢复数据
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      let isActive = true;

      const init = async () => {
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
                  currentWarehouse,
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
              const materialId = await addMaterialWithOrder({
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
                rule_name: parsed.ruleName,
                customFields: parsed.customFields,
                scanned_at: getISODateTime(),
                warehouse_id: warehouseId,
                warehouse_name: warehouseName,
                inventory_code: parsed.inventoryCode || '',
              }, parsed.customerName || '', { id: warehouseId, name: warehouseName });

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
              return [...appendedItems.slice().reverse(), ...preservedItems];
            });
          }

          return { success, materialIds, errors };
        });

        // 3. 启动队列定时器
        scanQueue.startTimer();

        // 4. 订阅队列变化（简化订阅，避免重复刷新）
        // 注意：批量写入函数中已经统一刷新 UI，这里只用于显示统计信息
        const unsubscribe = scanQueue.subscribe(() => {
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
        setCurrentWarehouse(warehouse);

        // 8. 加载扫码出库持久化状态（显式传入仓库，避免读取旧闭包）
        await loadOutboundState(list, warehouse);

        // 9. 聚焦输入框
        if (isActive) {
          focusScannerInput(100);
        }

        // 返回清理函数
        return () => {
          scanQueue.stopTimer();
          unsubscribe();
        };
      };

      const cleanupPromise = init();

      return () => {
        isActive = false;
        screenActiveRef.current = false;
        processingRef.current = false;
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
        // 等待 init 完成，清理订阅
        cleanupPromise
          .then((cleanup) => {
            if (cleanup) cleanup();
          })
          .catch(logger.error);
      };
    }, [focusScannerInput])
  );

  // 加载扫码出库持久化状态（订单号、仓库、扫码记录）
  const loadOutboundState = async (
    warehouseList?: Warehouse[],
    explicitWarehouse?: Warehouse | null
  ) => {
    try {
      const list = warehouseList || warehouses;
      const activeWarehouse = explicitWarehouse ?? currentWarehouse;

      // 1. 优先恢复新的出库作业草稿。草稿只恢复作业现场，不负责创建正式订单。
      const savedDraftText = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT);
      const savedDraft = savedDraftText
        ? safeJsonParseNullable<OutboundWorkDraft>(
            savedDraftText,
            'outbound.workDraft',
            isOutboundWorkDraft
          )
        : null;

      if (savedDraft) {
        if (!isFreshOutboundWorkDraft(savedDraft)) {
          logger.log('[loadOutboundState] 出库作业草稿已过期，清空草稿');
          await clearOutboundWorkDraft();
        } else {
          const draftWarehouse = list.find((w) => w.id === savedDraft.warehouseId);
          if (!draftWarehouse) {
            logger.log('[loadOutboundState] 草稿仓库不存在，清空草稿');
            await clearOutboundWorkDraft();
          } else if (activeWarehouse && savedDraft.warehouseId !== activeWarehouse.id) {
            logger.log('[loadOutboundState] 草稿仓库与当前仓库不一致，清空草稿:', {
              draftWarehouseId: savedDraft.warehouseId,
              activeWarehouseId: activeWarehouse.id,
            });
            await clearOutboundWorkDraft();
          } else {
            const order = await getOrder(savedDraft.orderNo, savedDraft.warehouseId);
            if (!screenActiveRef.current) {
              return;
            }

            const restoredCustomerName = (
              order?.customer_name ||
              savedDraft.customerName ||
              ''
            ).trim();

            setOrderNo(savedDraft.orderNo);
            setCustomerName(restoredCustomerName);
            await saveOutboundWorkDraft(savedDraft.orderNo, restoredCustomerName, draftWarehouse);
            await loadOrderMaterials(savedDraft.orderNo, savedDraft.warehouseId);
            return;
          }
        }
      }

      // 2. 兼容旧版本只保存订单号的状态，并迁移为新草稿。
      const savedOrderNo = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO);
      if (!screenActiveRef.current) {
        return;
      }

      if (savedOrderNo) {
        // 验证订单是否存在
        const order = await getOrder(savedOrderNo, activeWarehouse?.id);
        if (!screenActiveRef.current) {
          return;
        }

        if (!order) {
          logger.log('[loadOutboundState] 订单不存在，清空订单号:', savedOrderNo);
          await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO);
          if (screenActiveRef.current) {
            setOrderNo('');
            setCustomerName('');
          }
          return;
        }

        const warehouse = list.find((w) => w.id === order.warehouse_id);
        if (!warehouse) {
          logger.log('[loadOutboundState] 订单的仓库已不存在，清空订单号');
          showAlertIfActive('当前出库作业已清空', '上次暂存订单所属仓库已不存在。已保存的历史订单不会删除，请重新扫描当前仓库订单。');
          await clearOutboundWorkDraft();
          if (screenActiveRef.current) {
            setOrderNo('');
            setCustomerName('');
          }
          return;
        }

        if (activeWarehouse && order.warehouse_id !== activeWarehouse.id) {
          logger.log('[loadOutboundState] 订单仓库不匹配，清空订单号:', {
            savedOrderNo,
            orderWarehouseId: order.warehouse_id,
            currentWarehouseId: activeWarehouse.id,
          });
          showAlertIfActive('当前出库作业已清空', `上次暂存订单属于【${warehouse.name}】，当前仓库是【${activeWarehouse.name}】。已保存的历史订单不会删除，请重新扫描当前仓库订单。`);
          await clearOutboundWorkDraft();
          if (screenActiveRef.current) {
            setOrderNo('');
            setCustomerName('');
          }
          return;
        }

        if (!screenActiveRef.current) {
          return;
        }

        setOrderNo(savedOrderNo);
        setCustomerName((order.customer_name || '').trim());
        await saveOutboundWorkDraft(savedOrderNo, (order.customer_name || '').trim(), warehouse);
        await loadOrderMaterials(savedOrderNo, order.warehouse_id);
      }
    } catch (error) {
      logger.error('[扫码出库] 加载持久化状态失败:', error);
    }
  };

  // 切换仓库
  const handleWarehouseChange = async (warehouse: Warehouse) => {
    // 切换仓库
    setCurrentWarehouse(warehouse);
    await AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(warehouse));

    // 清空当前扫码记录（新仓库从零开始）
    setOrderNo('');
    setCustomerName('');
    setScanRecords([]);

    await clearOutboundWorkDraft();
    await clearScanRecords();

    // 清空展开状态
    expandedGroupsRef.current = new Set();
    setExpandedGroups(new Set());
  };

  // 清空扫描记录
  const clearScanRecords = async () => {
    try {
      await AsyncStorage.removeItem(OUTBOUND_SCAN_RECORDS_KEY);
    } catch (error) {
      logger.error('清空扫描记录失败:', error);
    }
  };

  // 加载订单物料（从数据库加载已保存的记录）
  const loadOrderMaterials = async (no: string, explicitWarehouseId?: string) => {
    // 🔥 优先使用显式传入的 warehouseId（解决闭包问题）
    const warehouseId = explicitWarehouseId || currentWarehouse?.id;

    // 确保仓库ID有效
    if (!warehouseId || typeof warehouseId !== 'string' || warehouseId.trim() === '') {
      logger.warn('[loadOrderMaterials] 仓库ID无效，无法加载订单物料');
      return;
    }

    // 确保订单号有效
    if (!no || typeof no !== 'string' || no.trim() === '') {
      logger.warn('[loadOrderMaterials] 订单号无效，无法加载订单物料');
      return;
    }

    const list = await searchMaterials({
      exactOrderNo: no.trim(),
      warehouse_id: warehouseId.trim(),
    });
    if (!screenActiveRef.current) {
      return;
    }


    // 加载全部数据用于聚合，显示时限制10行
    const materials = list
      .slice()
      .map((m) => ({
        id: m.id,
        model: m.model,
        batch: m.batch,
        quantity: String(m.quantity),
        scannedAt: new Date(m.scanned_at),
        version: m.version,
        traceNo: m.traceNo,
        sourceNo: m.sourceNo,
        package: m.package,
        productionDate: m.productionDate,
        customFields: m.customFields,
      }));
    if (!screenActiveRef.current) {
      return;
    }

    setScanRecords(materials);
  };

  // 处理扫描（带参数版本）
  const processScan = useCallback(
    async (code: string) => {
      logger.log('[processScan] 开始处理扫码:', code);
      logger.log('[processScan] 当前订单号:', orderNo);
      logger.log('[processScan] 当前客户名称:', customerName);
      logger.log('[processScan] 当前仓库:', currentWarehouse ? currentWarehouse.name : 'null');

      if (!code || processingRef.current) return;

      const normalizedOrderCode = normalizeOrderNoCandidate(code);
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
      const isOrderNoScan = matchedAvailableWarehouseRules.length > 0 || legacyParsedOrderNo !== null;
      const hasCustomerBound = customerName.trim().length > 0;
      const waitingForCustomer = !!orderNo && !hasCustomerBound;

      // 如果当前没有订单号，扫描内容必须是订单号格式
      if (!orderNo && !isOrderNoScan) {
        showToast(
          hasWarehouseSampleRules
            ? '请先扫描已配置仓库样例结构的出库单号'
            : `请先扫描订单号\n格式: ${getOutboundOrderRuleHint(outboundOrderRule)}`,
          'error'
        );
        feedbackError();
        return;
      }

      processingRef.current = true;

      try {
        // 判断是否是订单号格式
        if (isOrderNoScan) {
          let activeWarehouse = currentWarehouse;
          if (hasWarehouseSampleRules) {
            if (matchedAvailableWarehouseRules.length > 1) {
              showToast('出库单号匹配多个仓库，请检查样例规则', 'error');
              feedbackError();
              return;
            }

            const matchedWarehouseId = matchedAvailableWarehouseRules[0]?.warehouseId;
            const boundWarehouse = warehouses.find(
              (warehouse) => String(warehouse.id) === matchedWarehouseId
            );
            if (!boundWarehouse) {
              showToast('出库单号未匹配有效仓库，请检查样例规则', 'error');
              feedbackError();
              return;
            }

            activeWarehouse = boundWarehouse;
            if (!currentWarehouse || currentWarehouse.id !== boundWarehouse.id) {
              setCurrentWarehouse(boundWarehouse);
              await AsyncStorage.setItem(
                STORAGE_KEYS.GLOBAL_WAREHOUSE,
                JSON.stringify(boundWarehouse)
              );
            }
          }

          // 确保仓库已加载
          if (!activeWarehouse) {
            showToast('请先选择仓库', 'error');
            feedbackError();
            return;
          }

          // 确保仓库ID有效
          if (
            !activeWarehouse.id ||
            typeof activeWarehouse.id !== 'string' ||
            activeWarehouse.id.trim() === ''
          ) {
            showToast('仓库信息无效，请重新选择仓库', 'error');
            feedbackError();
            return;
          }

          // 切换/新建当前出库作业。草稿只恢复现场，不直接创建空订单。
          const isSwitchingOrder = !!orderNo && orderNo !== normalizedOrderCode;
          const isSameOrder = orderNo === normalizedOrderCode;
          const existing = await getOrder(normalizedOrderCode, activeWarehouse.id);

          setScanRecords([]); // 清空当前列表
          expandedGroupsRef.current = new Set();
          setExpandedGroups(new Set());
          const nextCustomerName = (
            existing?.customer_name ||
            (isSameOrder ? customerName : '') ||
            ''
          ).trim();
          setOrderNo(normalizedOrderCode);
          setCustomerName(nextCustomerName);
          await saveOutboundWorkDraft(normalizedOrderCode, nextCustomerName, activeWarehouse);

          if (existing) {
            await loadOrderMaterials(normalizedOrderCode, activeWarehouse.id);

            if (nextCustomerName) {
              showToast(
                isSwitchingOrder
                  ? '已切换订单，继续扫码'
                  : '当前订单已恢复，继续扫码',
                'warning'
              );
              feedbackSwitchOrder();
            } else {
              showToast(
                isSwitchingOrder ? '已切换订单，请扫描客户' : '订单已识别，请扫描客户',
                'warning'
              );
              feedbackNeedCustomerName(false);
            }
          } else {
            showToast(
              isSwitchingOrder ? '已切换订单，请扫描客户' : '订单已识别，请扫描客户',
              'success'
            );
            feedbackNeedCustomerName(true);
          }
          return;
        }

        if (waitingForCustomer) {
          if (!currentWarehouse) {
            showToast('请选择仓库', 'warning');
            feedbackWarning();
            setShowWarehousePicker(true);
            return;
          }

          if (!isValidCustomerNameScan(code, outboundOrderRule, outboundWarehouseOrderRules)) {
            showToast('请扫描客户名称二维码', 'error');
            feedbackError();
            return;
          }

          const normalizedCustomerName = normalizeCustomerNameScan(code);
          const existingOrder = await getOrder(orderNo, currentWarehouse.id);
          if (existingOrder) {
            await upsertOrder(orderNo, normalizedCustomerName, {
              id: currentWarehouse.id,
              name: currentWarehouse.name,
            });
          }
          setCustomerName(normalizedCustomerName);
          await saveOutboundWorkDraft(orderNo, normalizedCustomerName, currentWarehouse);
          showToast(`客户已识别：${normalizedCustomerName}`, 'success');
          feedbackCustomerSuccess();
          return;
        }

        // 物料扫描
        if (!orderNo) {
          showToast('请先扫描订单', 'warning');
          feedbackWarning();
          return;
        }

        if (!currentWarehouse) {
          showToast('请选择仓库', 'warning');
          feedbackWarning();
          setShowWarehousePicker(true);
          return;
        }

        // 确保仓库ID有效
        if (
          !currentWarehouse.id ||
          typeof currentWarehouse.id !== 'string' ||
          currentWarehouse.id.trim() === ''
        ) {
          showToast('仓库信息无效，请重新选择仓库', 'error');
          feedbackError();
          return;
        }

        if (isValidCustomerNameScan(code, outboundOrderRule, outboundWarehouseOrderRules) && !isQRCode(code)) {
          showToast('当前步骤请扫描物料二维码', 'warning');
          feedbackWarning();
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
        let ruleName = '';
        let customFields: Record<string, string> = {};

        try {
          const rule = await detectRule(code);
          if (rule) {
            separator = rule.separator || ',';
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
          // 静默失败，走兜底逻辑 parseQRCodeSync
        } catch (error) {
          logger.warn('[扫码出库] 规则解析失败，使用兜底解析:', error);
        }

        if (!parsed) {
          // 兜底：使用 qrcodeParser 的同步解析（不依赖数据库）
          const fallback = parseQRCodeSync(code);
          if (fallback) {
            parsed = {
              model: fallback.model,
              batch: fallback.batch,
              quantity: fallback.quantity,
              traceNo: fallback.traceNo,
              sourceNo: fallback.sourceNo,
              package: fallback.package,
              version: fallback.version,
              productionDate: fallback.productionDate,
            };
          }
        }

        if (!parsed) {
          showToast('未识别到有效内容', 'error');
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
          return;
        }

        // 检查重复 + 查找存货编码（并行查询，性能优化）
        logger.log('[扫码出库] 开始检查重复和查找存货编码，参数:', {
          orderNo,
          model: normalizedModel,
          batch: parsed.batch,
          traceNo: parsed.traceNo,
          quantity: normalizedQuantity,
        });
        const [check, inventoryCode] = await Promise.all([
          checkMaterialExists(
            orderNo,
            normalizedModel,
            parsed.batch,
            parsed.sourceNo,
            parsed.traceNo,
            normalizedQuantity.toString(),
            currentWarehouse.id
          ),
          getInventoryCodeByModel(normalizedModel),
        ]);
        logger.log('[扫码出库] 重复检查结果:', check);
        logger.log('[扫码出库] 存货编码:', inventoryCode);

        if (check.material && !check.canRescan) {
          showToast('已扫过此追溯码', 'warning');
          feedbackDuplicate();
          return;
        }

        // 扫码出库必须在数据库提交成功后再提示成功，避免“已扫码”但实际未落库。
        await saveOutboundWorkDraft(orderNo, customerName.trim(), currentWarehouse);
        const savedPayload: QueueItemParsedPayload = {
          orderNo,
          customerName: customerName.trim(),
          model: normalizedModel,
          batch: parsed.batch || '',
          quantity: normalizedQuantity.toString(),
          traceNo: parsed.traceNo,
          sourceNo: parsed.sourceNo,
          package: parsed.package,
          version: parsed.version,
          productionDate: parsed.productionDate,
          separator,
          ruleName,
          customFields,
          inventoryCode: inventoryCode || '',
          warehouseId: currentWarehouse.id,
          warehouseName: currentWarehouse.name,
        };
        const materialId = await addMaterialWithOrder({
          order_no: orderNo,
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
          rule_name: savedPayload.ruleName,
          customFields: savedPayload.customFields,
          scanned_at: getISODateTime(),
          warehouse_id: savedPayload.warehouseId,
          warehouse_name: savedPayload.warehouseName,
          inventory_code: savedPayload.inventoryCode || '',
        }, savedPayload.customerName || '', {
          id: savedPayload.warehouseId,
          name: savedPayload.warehouseName,
        });

        if (orderNo === orderNoRef.current) {
          const savedItem = mapQueueItemToMaterialItem(materialId, savedPayload);
          setScanRecords((prev) => {
            const preservedItems = prev.filter((item) => item.id !== savedItem.id);
            return [savedItem, ...preservedItems];
          });
        }

        showToast(`已扫码：${normalizedModel}`, 'success');
        feedbackSuccess();
      } catch (e) {
        logger.error('[扫码出库] 处理失败:', e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast(`处理失败：${errorMessage}`, 'error');
        feedbackError();
      } finally {
        // 给扫码枪留一个很短的输入窗口，避免上一条还在处理时下一条被吞掉。
        if (postProcessTimerRef.current) {
          clearTimeout(postProcessTimerRef.current);
        }
        postProcessTimerRef.current = setTimeout(() => {
          postProcessTimerRef.current = null;
          processingRef.current = false;
          if (!screenActiveRef.current) {
            return;
          }

          const nextPendingCode = pendingScanCodesRef.current.shift();
          if (nextPendingCode) {
            processScan(nextPendingCode);
            return;
          }

          focusScannerInput(0);
        }, 170);
      }
    },
    [
      currentWarehouse,
      customerName,
      focusScannerInput,
      orderNo,
      outboundOrderRule,
      outboundWarehouseOrderRules,
      saveOutboundWorkDraft,
      showToast,
      warehouses,
    ]
  );

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

  const workflowMetrics = useMemo<WorkflowMetric[]>(
    () => {
      const workStatus = !orderNo
        ? { value: '待扫订单', tone: 'default' as const }
        : !customerName
          ? { value: '待扫客户', tone: 'warning' as const }
          : scanRecords.length === 0
            ? { value: '待扫物料', tone: 'accent' as const }
            : { value: '作业中', tone: 'success' as const };

      return [
        {
          key: 'status',
          label: '状态',
          value: workStatus.value,
          tone: workStatus.tone,
        },
        {
          key: 'order',
          label: '订单',
          value: orderNo || '—',
          tone: orderNo ? 'success' : 'default',
        },
        {
          key: 'customer',
          label: '客户',
          value: customerName || '—',
          tone: customerName ? 'success' : 'default',
        },
      ];
    },
    [customerName, orderNo, scanRecords.length]
  );

  const outboundListState = useMemo(
    () => Array.from(expandedGroups).sort().join('|'),
    [expandedGroups]
  );

  const renderAggregatedGroup = useCallback(
    ({ item }: { item: AggregatedGroup }) => {
      const isExpanded = expandedGroupsRef.current.has(item.key);
      return (
        <RecordItem
          group={item}
          isExpanded={isExpanded}
          onToggle={toggleExpand}
          onDeleteItem={handleDeleteItem}
          styles={styles}
        />
      );
    },
    [outboundListState, orderNo, styles]
  );

  const aggregatedGroupKeyExtractor = useCallback((item: AggregatedGroup) => item.key, []);

  // 切换展开/折叠
  const toggleExpand = (key: string) => {
    if (expandedGroupsRef.current.has(key)) {
      expandedGroupsRef.current.delete(key);
    } else {
      expandedGroupsRef.current.add(key);
    }
    setExpandedGroups(new Set(expandedGroupsRef.current));
  };

  // 删除单个物料
  const handleDeleteItem = useCallback(
    (item: MaterialItem) => {
      alert.showConfirm(
        '确认删除',
        '确定要删除这条物料吗？',
        () => {
          void (async () => {
            try {
              await deleteMaterial(item.id);
              // 从数据库重新加载列表
              if (orderNo) {
                await loadOrderMaterials(orderNo);
              }
              showToast('物料已删除', 'success');
            } catch (error) {
              logger.error('删除失败:', error);
              showToast('删除失败', 'error');
            }
          })();
        },
        true
      );
    },
    [alert, loadOrderMaterials, orderNo, showToast]
  );

  const normalizeScannerInput = useCallback((rawText: string): string => {
    return sanitizeScannerInput(rawText);
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

      if (!shouldAcceptScanCode(code)) {
        if (!processingRef.current && pendingScanCodesRef.current.length === 0) {
          focusScannerInput(0);
        }
        return;
      }

      if (processingRef.current) {
        pendingScanCodesRef.current.push(code);
        return;
      }

      processScan(code);
    },
    [focusScannerInput, normalizeScannerInput, processScan, shouldAcceptScanCode]
  );

  // 输入变化时自动检测并触发（扫码器逐字符输入，需要防抖检测完成）
  const handleInputChange = useCallback(
    (text: string) => {
      // 清除之前的定时器（每次输入都重置）
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }

      liveInputValueRef.current = text;
      setInputValue(text);

      // 如果当前有输入内容，启动定时器检测扫码完成
      if (text.length > 0) {
        autoSubmitTimerRef.current = setTimeout(() => {
          autoSubmitTimerRef.current = null;
          flushScannerInput(text);
        }, 150); // 150ms 防抖，等待扫码器输入完成
        return;
      }
    },
    [flushScannerInput]
  );

  // 扫码完成确认（焦点录入模式：用户手动按回车）
  const handleSubmitEditing = useCallback(() => {
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    flushScannerInput();
  }, [flushScannerInput]);

  // 选择仓库
  const selectWarehouse = async (wh: Warehouse) => {
    // 如果选择的是当前仓库，直接关闭弹窗
    if (wh.id === currentWarehouse?.id) {
      setShowWarehousePicker(false);
      return;
    }

    // B: 清空当前页面数据（订单号与仓库绑定，不同仓库序号位数不同）
    setOrderNo('');

    setScanRecords([]);
    expandedGroupsRef.current = new Set();
    setExpandedGroups(new Set());

    // 清理持久化存储
    await clearOutboundWorkDraft();
    await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_SCAN_RECORDS);

    // 切换到新仓库
    await handleWarehouseChange(wh);
    setShowWarehousePicker(false);
    showToast(`仓库已切换：${wh.name}`, 'success');
    focusScannerInput(100);
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          {/* 顶部：仓库 + 订单 */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.7}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={24} color={theme.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.warehouseBtn}
              activeOpacity={0.7}
              onPress={() => setShowWarehousePicker(true)}
            >
              <FontAwesome6 name="warehouse" size={14} color={theme.textPrimary} />
              <Text style={styles.warehouseText} numberOfLines={1} ellipsizeMode="tail">
                {currentWarehouse?.name || '仓库'}
              </Text>
              <FontAwesome6 name="chevron-down" size={10} color={theme.textMuted} />
            </TouchableOpacity>
            <View
              style={[
                styles.stepTag,
                currentScanStep !== 'order' && styles.stepTagActive,
              ]}
            >
              <FontAwesome6
                name={
                  currentScanStep === 'order'
                    ? 'barcode'
                    : currentScanStep === 'customer'
                      ? 'user'
                      : 'cube'
                }
                size={12}
                color={
                  currentScanStep !== 'order'
                    ? theme.primary
                    : theme.textMuted
                }
              />
              <Text
                style={[
                  styles.stepText,
                  currentScanStep !== 'order' && styles.stepTextActive,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {currentScanStep === 'order'
                  ? '待扫订单'
                  : currentScanStep === 'customer'
                    ? '待扫客户'
                    : scanRecords.length === 0
                      ? '待扫物料'
                      : '继续扫物料'}
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
            placeholder={currentScanPlaceholder}
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
            <Text style={styles.listTitle}>本单物料</Text>
            <Text style={styles.listCount}>
              {aggregateTotals.modelCount} 型号 / {aggregateTotals.totalQuantity.toLocaleString()}{' '}
              PCS
            </Text>
          </View>
          <FlatList
            data={aggregateMaterials}
            keyExtractor={aggregatedGroupKeyExtractor}
            renderItem={renderAggregatedGroup}
            extraData={outboundListState}
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
                title={
                  !orderNo
                    ? '等待订单'
                    : !customerName
                      ? '等待客户'
                      : '暂无物料'
                }
                description={
                  !orderNo
                    ? '先扫描订单二维码'
                    : !customerName
                      ? '扫描客户名称二维码'
                      : '继续扫描物料二维码'
                }
                compact
                style={styles.empty}
              />
            }
          />
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
        <ToastContainer />
        {alert.AlertComponent}
      </View>
    </Screen>
  );
}
