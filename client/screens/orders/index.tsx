import { MotionPresence } from '@/components/AppMotion';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, TextInput, Platform, ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/hooks/useTheme';
import { useHardwareBack } from '@/hooks/useHardwareBack';
import { Screen } from '@/components/Screen';
import { useCustomAlert } from '@/components/CustomAlert';
import { exportOutboundHistoryToComputer } from '@/utils/outboundHistoryExport';
import { formatSyncErrorMessage } from '@/utils/excel';
import { AppEmptyState } from '@/components/AppEmptyState';
import { createStyles } from './styles';
import { AnimatedCard } from '@/components/AnimatedCard';
import {
  getQueryFilteredOrders,
  getQueryOrder,
  getQueryMaterialsByOrder,
  Order,
  type OrderSearchType,
  MaterialRecord,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
} from '@/utils/database';
import { safeJsonParseNullable } from '@/utils/json';
import { STORAGE_KEYS } from '@/constants/config';
import { formatDate } from '@/utils/time';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { groupOrderMaterials, normalizeOrderBatch, type OrderMaterialGroup } from '@/utils/orderMaterialGroups';
import { logger } from '@/utils/logger';

const ORDER_SEARCH_OPTIONS = [
  { key: 'order', label: '订单号', icon: 'file-lines', placeholder: '搜索订单号...' },
  { key: 'customer', label: '客户', icon: 'user', placeholder: '搜索客户名称...' },
  { key: 'batch', label: '批次', icon: 'barcode', placeholder: '输入完整批次号...' },
  { key: 'trace', label: '追溯码', icon: 'qrcode', placeholder: '搜索追溯码...' },
] as const;

// 订单视图类型
type TimeFilterType = 'current' | 'today' | 'all';
type QueryTimeFilterType = 'today' | 'all';

const getQueryTimeFilter = (filter: TimeFilterType): QueryTimeFilterType =>
  filter === 'all' ? 'all' : 'today';

export default function OrdersScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const [exportingHistory, setExportingHistory] = useState(false);
  const exportBusyRef = useRef(false);
  const screenVisitRef = useRef(0);
  const params = useSafeSearchParams<{ orderNo?: string; warehouseId?: string }>();
  const targetOrderNo = params.orderNo?.trim() || '';
  const targetWarehouseId = targetOrderNo ? params.warehouseId?.trim() : undefined;
  const targetKey = targetOrderNo ? JSON.stringify([targetOrderNo, targetWarehouseId]) : '';

  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<OrderSearchType>('order');
  const batchKeyword = searchType === 'batch' ? normalizeOrderBatch(searchText) : '';

  // 仓库相关状态
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<Warehouse | null>(null);
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);

  // 订单视图状态
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('current');
  const [currentOrderNo, setCurrentOrderNo] = useState('');
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [currentOrderMaterials, setCurrentOrderMaterials] = useState<MaterialRecord[]>([]);
  const [currentOrderLoading, setCurrentOrderLoading] = useState(false);

  // 展开的订单
  const [expandedOrderId, setExpandedOrderIdState] = useState<string | null>(null);
  const [expandedMaterials, setExpandedMaterials] = useState<MaterialRecord[]>([]);
  const [expandedBatchKeys, setExpandedBatchKeys] = useState<Set<string>>(new Set());
  const currentMaterialGroups = useMemo(() => groupOrderMaterials(currentOrderMaterials), [currentOrderMaterials]);
  const expandedMaterialGroups = useMemo(() => groupOrderMaterials(batchKeyword
    ? expandedMaterials.filter(material => normalizeOrderBatch(material.batch) === batchKeyword)
    : expandedMaterials), [batchKeyword, expandedMaterials]);
  const [expandedMaterialsLoadingId, setExpandedMaterialsLoadingId] = useState<string | null>(null);
  const expandedOrderIdRef = useRef<string | null>(null);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSearchEffectKeyRef = useRef<string | null>(null);
  const expandedMaterialsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedMaterialsRequestRef = useRef(0);
  const screenActiveRef = useRef(true);
  const warehouseLoadRequestRef = useRef(0);
  const currentOrderRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const appliedTargetRef = useRef<{ key: string; warehouseId?: string }>({ key: '' });

  useHardwareBack(useCallback(() => {
    if (!showWarehousePicker) return false;
    setShowWarehousePicker(false);
    return true;
  }, [showWarehousePicker]));

  const setExpandedOrderId = useCallback((id: string | null) => {
    expandedOrderIdRef.current = id;
    setExpandedOrderIdState(id);
  }, []);
  const showDetailError = alert.showError;

  const clearExpandedMaterialsTimer = useCallback(() => {
    if (expandedMaterialsTimerRef.current) {
      clearTimeout(expandedMaterialsTimerRef.current);
      expandedMaterialsTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      screenActiveRef.current = false;
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
    },
    [clearExpandedMaterialsTimer]
  );

  // 页面聚焦时恢复活动状态
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;

      return () => {
        screenActiveRef.current = false;
        screenVisitRef.current += 1;
        warehouseLoadRequestRef.current += 1;
        currentOrderRequestRef.current += 1;
        searchRequestRef.current += 1;
        expandedMaterialsRequestRef.current += 1;
        clearExpandedMaterialsTimer();
      };
    }, [clearExpandedMaterialsTimer])
  );

  const handleExportHistory = () => {
    if (exportBusyRef.current || !currentWarehouse) return;
    const warehouse = { id: currentWarehouse.id, name: currentWarehouse.name };
    const visit = screenVisitRef.current;
    alert.showConfirm(
      '导出历史',
      `将导出「${warehouse.name}」的全部历史出库扫码记录到电脑，不受当前搜索和日期筛选影响。仅包含本机已保存的数据。`,
      async () => {
        if (!screenActiveRef.current || screenVisitRef.current !== visit || exportBusyRef.current) return;
        exportBusyRef.current = true;
        setExportingHistory(true);
        try {
          const result = await exportOutboundHistoryToComputer(warehouse);
          if (screenActiveRef.current && screenVisitRef.current === visit) {
            alert.showSuccess(`「${warehouse.name}」历史出库记录已导出到电脑，共 ${result.recordCount} 条\n文件：${result.fileName}`);
          }
        } catch (error) {
          if (screenActiveRef.current && screenVisitRef.current === visit) {
            const message = error instanceof Error ? error.message : '请检查电脑同步助手';
            alert.showError(`「${warehouse.name}」导出失败：${formatSyncErrorMessage(message)}`);
          }
        } finally {
          exportBusyRef.current = false;
          setExportingHistory(false);
        }
      },
      false,
      '导出到电脑',
    );
  };

  // 加载仓库
  const loadWarehouses = useCallback(async (
    isCurrent: () => boolean,
    preferredWarehouseId?: string
  ): Promise<Warehouse | null> => {
    const list = await getAllWarehouses();
    if (!isCurrent()) return null;
    setWarehouses(list);

    // 工作台指定的仓库只用于查看单据，不改变扫码作业所用的全局仓库。
    const preferredWarehouse = list.find(warehouse => warehouse.id === preferredWarehouseId);
    if (preferredWarehouse) {
      setCurrentWarehouse(preferredWarehouse);
      return preferredWarehouse;
    }

    // 首次进入沿用作业仓库；后续查询选择只保存在查询页，不能改变出库作业。
    const savedWarehouse = await AsyncStorage.getItem(STORAGE_KEYS.ORDERS_WAREHOUSE)
      || await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
    if (!isCurrent()) return null;
    if (savedWarehouse) {
      const warehouse = safeJsonParseNullable<Warehouse>(savedWarehouse, 'orders.warehouse');
      // 确保仓库仍然存在
      const latestWarehouse = warehouse ? list.find((w) => w.id === warehouse.id) : null;
      if (latestWarehouse) {
        setCurrentWarehouse(latestWarehouse);
        await AsyncStorage.setItem(
          STORAGE_KEYS.ORDERS_WAREHOUSE,
          JSON.stringify(latestWarehouse)
        );
        return latestWarehouse;
      }
    }

    // 没有保存的选择，使用默认仓库
    const def = await getDefaultWarehouse();
    if (!isCurrent()) return null;
    const resolvedWarehouse = def || list[0] || null;
    setCurrentWarehouse(resolvedWarehouse);
    return resolvedWarehouse;
  }, []);

  // 订单查询下沉到 SQLite，避免订单多时把全量数据拉到 JS 里过滤。
  const runOrderSearch = useCallback(
    async ({
      text,
      type = searchType,
      warehouseId = currentWarehouse?.id,
      timeFilterValue = getQueryTimeFilter(timeFilter),
    }: {
      text: string;
      type?: OrderSearchType;
      warehouseId?: string;
      timeFilterValue?: QueryTimeFilterType;
    }) => {
      return getQueryFilteredOrders({
        searchText: text,
        searchType: type,
        warehouseId,
        timeFilter: timeFilterValue,
      });
    },
    [currentWarehouse?.id, searchType, timeFilter]
  );

  const buildSearchQueryKey = useCallback(
    ({
      text,
      type,
      warehouseId,
      timeFilterValue,
    }: {
      text: string;
      type: OrderSearchType;
      warehouseId?: string;
      timeFilterValue: QueryTimeFilterType;
    }) => [warehouseId || '', timeFilterValue, type, text.trim()].join('::'),
    []
  );

  const loadCurrentOrder = useCallback(async (warehouseId?: string) => {
    const requestId = ++currentOrderRequestRef.current;
    const isCurrent = () => screenActiveRef.current && requestId === currentOrderRequestRef.current;
    setCurrentOrderLoading(true);

    try {
      // 查询历史订单仅切换本页展示，不能修改扫码出库的当前单和草稿。
      const savedOrderNo = targetOrderNo ||
        (await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO))?.trim() || '';

      if (!isCurrent()) {
        return;
      }

      setCurrentOrderNo(savedOrderNo);

      if (!savedOrderNo) {
        setCurrentOrder(null);
        setCurrentOrderMaterials([]);
        return;
      }

      const [order, materials] = await Promise.all([
        getQueryOrder(savedOrderNo, warehouseId),
        getQueryMaterialsByOrder(savedOrderNo, warehouseId),
      ]);

      if (!isCurrent()) {
        return;
      }

      setCurrentOrder(order);
      setCurrentOrderMaterials(order ? materials : []);
    } catch (error) {
      logger.error('加载当前订单失败:', error);
      if (isCurrent()) {
        setCurrentOrder(null);
        setCurrentOrderMaterials([]);
      }
    } finally {
      if (isCurrent()) {
        setCurrentOrderLoading(false);
      }
    }
  }, [targetOrderNo]);

  const loadExpandedMaterials = useCallback(
    async (
      order: Pick<Order, 'id' | 'order_no'>,
      options?: {
        warehouseId?: string;
        delay?: number;
      }
    ) => {
      const requestId = expandedMaterialsRequestRef.current + 1;
      expandedMaterialsRequestRef.current = requestId;
      clearExpandedMaterialsTimer();
      setExpandedMaterialsLoadingId(order.id);

      const execute = async () => {
        try {
          const materials = await getQueryMaterialsByOrder(order.order_no, options?.warehouseId);

          if (!screenActiveRef.current) {
            return;
          }

          if (expandedMaterialsRequestRef.current !== requestId) {
            return;
          }

          if (expandedOrderIdRef.current !== order.id) {
            return;
          }

          setExpandedMaterials(materials);
        } catch (error) {
          if (screenActiveRef.current && expandedMaterialsRequestRef.current === requestId && expandedOrderIdRef.current === order.id) {
            logger.error('加载订单物料失败:', error);
            setExpandedOrderId(null);
            setExpandedMaterialsLoadingId(null);
            showDetailError('订单明细加载失败，请点击单据重试');
          }
        } finally {
          if (
            screenActiveRef.current &&
            expandedMaterialsRequestRef.current === requestId &&
            expandedOrderIdRef.current === order.id
          ) {
            setExpandedMaterialsLoadingId(null);
          }
        }
      };

      if (options?.delay && options.delay > 0) {
        expandedMaterialsTimerRef.current = setTimeout(() => {
          expandedMaterialsTimerRef.current = null;
          void execute();
        }, options.delay);
        return;
      }

      await execute();
    },
    [clearExpandedMaterialsTimer, setExpandedOrderId, showDetailError]
  );

  const loadDataForWarehouse = useCallback(async (warehouseId?: string) => {
    const requestId = ++warehouseLoadRequestRef.current;
    const searchId = ++searchRequestRef.current;
    const isCurrent = () => screenActiveRef.current && requestId === warehouseLoadRequestRef.current;
    try {
      const queryTimeFilter = getQueryTimeFilter(timeFilter);
      const searchKey = buildSearchQueryKey({
        text: searchText,
        type: searchType,
        warehouseId,
        timeFilterValue: queryTimeFilter,
      });
      skipSearchEffectKeyRef.current = searchKey;
      const [allOrdersForWarehouse, filtered] = await Promise.all([
        getQueryFilteredOrders({
          warehouseId,
          timeFilter: 'all',
        }),
        runOrderSearch({
          text: searchText,
          type: searchType,
          warehouseId,
          timeFilterValue: queryTimeFilter,
        }),
        loadCurrentOrder(warehouseId),
      ]);

      if (!isCurrent()) return;
      if (searchId === searchRequestRef.current) setFilteredOrders(filtered);

      // 如果有展开的订单，刷新其物料列表
      const currentExpandedId = expandedOrderIdRef.current;
      if (currentExpandedId) {
        const expandedOrder = allOrdersForWarehouse.find((o) => o.id === currentExpandedId);
        if (expandedOrder) {
          await loadExpandedMaterials(expandedOrder, { warehouseId: expandedOrder.warehouse_id || warehouseId });
        }
      }
    } catch (error) {
      logger.error('加载数据失败:', error);
    }
  }, [
    buildSearchQueryKey,
    loadCurrentOrder,
    loadExpandedMaterials,
    runOrderSearch,
    searchText,
    searchType,
    timeFilter,
  ]);

  // 搜索过滤
  const handleSearchInput = useCallback((text: string) => {
    setSearchText(text);
  }, []);

  // 搜索类型变更时重新搜索
  const handleSearchTypeChange = useCallback((type: OrderSearchType) => {
    setSearchType(type);
  }, []);

  useEffect(() => {
    let isActive = true;

    if (timeFilter === 'current') {
      return () => {
        isActive = false;
      };
    }

    if (!currentWarehouse?.id && warehouses.length === 0) {
      return () => {
        isActive = false;
      };
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const searchKey = buildSearchQueryKey({
      text: searchText,
      type: searchType,
      warehouseId: currentWarehouse?.id,
      timeFilterValue: getQueryTimeFilter(timeFilter),
    });

    searchTimeoutRef.current = setTimeout(
      () => {
        if (skipSearchEffectKeyRef.current === searchKey) {
          skipSearchEffectKeyRef.current = null;
          return;
        }
        const searchId = ++searchRequestRef.current;

        runOrderSearch({
          text: searchText,
          type: searchType,
          warehouseId: currentWarehouse?.id,
          timeFilterValue: getQueryTimeFilter(timeFilter),
        }).then((result) => {
          if (isActive && screenActiveRef.current && searchId === searchRequestRef.current) {
            setFilteredOrders(result);
          }
        }).catch((error) => {
          logger.error('搜索订单失败:', error);
        });
      },
      searchType === 'batch' || searchType === 'trace' ? 220 : 120
    );

    return () => {
      isActive = false;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, [
    buildSearchQueryKey,
    currentWarehouse?.id,
    runOrderSearch,
    searchText,
    searchType,
    timeFilter,
    warehouses.length,
  ]);

  const loadDataForWarehouseRef = useRef(loadDataForWarehouse);

  // 保持 loadDataForWarehouseRef 与 loadDataForWarehouse 同步
  useEffect(() => {
    loadDataForWarehouseRef.current = loadDataForWarehouse;
  }, [loadDataForWarehouse]);

  // 页面聚焦时刷新数据
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const requestId = ++warehouseLoadRequestRef.current;
      const isCurrent = () => isMounted && screenActiveRef.current && requestId === warehouseLoadRequestRef.current;

      const init = async () => {
        const isNewTarget = appliedTargetRef.current.key !== targetKey;
        const preferredWarehouseId = isNewTarget ? targetWarehouseId : appliedTargetRef.current.warehouseId;
        const warehouse = await loadWarehouses(isCurrent, preferredWarehouseId);
        if (isCurrent()) {
          appliedTargetRef.current = { key: targetKey, warehouseId: preferredWarehouseId };
          if (isNewTarget && targetKey) setTimeFilter('current');
          await loadDataForWarehouseRef.current(warehouse?.id);
        }
      };

      void init();

      return () => {
        isMounted = false;
      };
    }, [loadWarehouses, targetKey, targetWarehouseId])
  );

  // 处理仓库切换
  const handleWarehouseChange = useCallback(
    async (warehouse: Warehouse) => {
      if (warehouse.id === currentWarehouse?.id) {
        setShowWarehousePicker(false);
        return;
      }
      appliedTargetRef.current.warehouseId = undefined;
      setCurrentWarehouse(warehouse);
      setFilteredOrders([]);
      setCurrentOrder(null);
      setCurrentOrderMaterials([]);
      setShowWarehousePicker(false);

      // 保存到订单管理独立的 Storage Key（不与扫码出库共享）
      void AsyncStorage.setItem(STORAGE_KEYS.ORDERS_WAREHOUSE, JSON.stringify(warehouse));

      // 清空展开的订单（因为仓库切换后物料列表可能为空）
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      setExpandedOrderId(null);
      setExpandedMaterials([]);
      setExpandedMaterialsLoadingId(null);

      await loadDataForWarehouse(warehouse.id);
    },
    [clearExpandedMaterialsTimer, currentWarehouse, loadDataForWarehouse, setExpandedOrderId]
  );

  const handleTimeFilterChange = useCallback((filter: TimeFilterType) => {
    setTimeFilter(filter);
    if (filter === 'current') {
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      setExpandedOrderId(null);
      setExpandedMaterials([]);
      setExpandedMaterialsLoadingId(null);
      void loadCurrentOrder(currentWarehouse?.id);
    } else {
      // 切换到 today / all 列表视图时，重新加载订单列表数据
      // （否则列表还是旧数据甚至为空，用户会以为没切成功）
      void loadDataForWarehouse(currentWarehouse?.id);
    }
  }, [clearExpandedMaterialsTimer, currentWarehouse?.id, loadCurrentOrder, loadDataForWarehouse, setExpandedOrderId]);

  // 点击订单 - 展开/收起显示物料列表
  const handleToggleOrder = async (order: Order) => {
    if (expandedOrderIdRef.current === order.id) {
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      setExpandedOrderId(null);
      setExpandedMaterials([]);
      setExpandedMaterialsLoadingId(null);
    } else {
      setExpandedOrderId(order.id);
      setExpandedMaterials([]);
      await loadExpandedMaterials(order, { warehouseId: order.warehouse_id || currentWarehouse?.id });
    }
  };

  const copyOrderField = async (label: '订单号' | '客户名称', value: string) => {
    const visit = screenVisitRef.current;
    const isCurrent = () => screenActiveRef.current && screenVisitRef.current === visit;
    try {
      if (!(await Clipboard.setStringAsync(value))) throw new Error('剪贴板写入失败');
      if (isCurrent()) alert.showSuccess(`${label}已复制`);
    } catch (error) {
      logger.error('复制订单字段失败:', error);
      if (isCurrent()) alert.showError('复制失败，请稍后重试');
    }
  };

  // 查看物料详情
  const handleViewMaterial = (material: MaterialRecord) => {
    router.push('/detail', { id: material.id });
  };

  const renderMaterialRow = (material: MaterialRecord) => {
    const traceNo = material.traceNo?.trim() || '-';
    return (
      <View key={material.id} style={styles.materialItem}>
        <TouchableOpacity
          style={styles.materialMainInfo} feedback="none"
          accessibilityRole="button"
          accessibilityLabel={`查看扫码记录，追溯码：${traceNo}`}
          activeOpacity={0.86}
          onPress={() => handleViewMaterial(material)}
        >
          <View style={styles.materialScanRow}>
            <Text style={styles.materialIdentity}>
              {`追溯码：${traceNo}`}
            </Text>
            <Text style={styles.materialScanQuantity}>{material.operation_type === 'sales_return' ? '实收数量' : '数量'}：{material.quantity || 0}</Text>
            <Feather name="chevron-right" size={14} color={theme.textMuted} />
          </View>
        </TouchableOpacity>

      </View>
    );
  };

  const renderMaterialField = (label: string, value: string, primary = false) => (
    <View style={styles.materialFieldRow}>
      <Text style={[styles.materialFieldLabel, primary && styles.materialModel]}>{label}：</Text>
      <Text style={[styles.materialFieldValue, primary && styles.materialModel]}>{value || '-'}</Text>
    </View>
  );

  const renderMaterialGroup = (group: OrderMaterialGroup) => (
    <View key={group.key} style={styles.materialGroup}>
      {renderMaterialField('型号', group.model, true)}
      {renderMaterialField('编码', group.inventoryCode)}
      {renderMaterialField('版本号', group.version)}
      {renderMaterialField('封装', group.package)}
      <View style={styles.materialSummaryRow}>
        <Text style={styles.materialFieldLabel}>合计：</Text>
        <Text style={[styles.materialDetails, { flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {`${group.quantity.toLocaleString('zh-CN')} PCS`}
        </Text>
        <Text style={[styles.materialDetails, { marginLeft: 'auto', paddingLeft: 12, flexShrink: 1, textAlign: 'right' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {`扫码记录：${group.recordCount} 条`}
        </Text>
      </View>
      <View style={styles.batchRow}>
        <Text style={styles.batchCell}>批次</Text><Text style={styles.batchCell}>生产日期</Text>
        <Text style={styles.batchQuantity}>数量</Text><View style={{ width: 16 }} />
      </View>
      {group.batches.map(batch => {
        const expanded = expandedBatchKeys.has(batch.key);
        return <View key={batch.key}>
          <TouchableOpacity feedback="none" style={styles.batchRow} accessibilityRole="button"
            accessibilityLabel={`批次 ${batch.batch || '未填写'}，生产日期 ${batch.productionDate || '未填写'}，数量 ${batch.quantity}，${expanded ? '收起' : '展开'}扫码记录`}
            accessibilityState={{ expanded }} onPress={() => setExpandedBatchKeys(previous => {
              const next = new Set(previous);
              if (next.has(batch.key)) next.delete(batch.key); else next.add(batch.key);
              return next;
            })}>
            <Text style={styles.batchCell}>{batch.batch || '未填写'}</Text>
            <Text style={styles.batchCell}>{batch.productionDate || '未填写'}</Text>
            <Text style={styles.batchQuantity}>{batch.quantity.toLocaleString('zh-CN')}</Text>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.textSecondary} />
          </TouchableOpacity>
          <View>{expanded && batch.records.map(renderMaterialRow)}</View>
        </View>;
      })}
    </View>
  );

  const renderOrderItem = ({ item: order }: { item: Order }) => {
    const keyword = searchType === 'trace' ? searchText.trim().toLowerCase() : '';
    const traceMatches = keyword ? order.traceMatches?.filter(match => match.traceNo.toLowerCase().includes(keyword)) : undefined;
    const customerName = order.customer_name?.trim();
    const toggleOrder = () => handleToggleOrder(order);
    return (
      <View>
        <AnimatedCard disablePressAnimation onPress={toggleOrder}>
          <View
            style={[styles.orderItem, expandedOrderId === order.id && styles.orderItemExpanded]}
          >
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderLeft}>
                {expandedMaterialsLoadingId === order.id ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name={expandedOrderId === order.id ? "chevron-down" : "chevron-right"} size={18} color={theme.textSecondary} />}
                <TouchableOpacity style={styles.orderNoTarget} feedback="none"
                  accessibilityRole="button" accessibilityLabel={`订单号，${order.order_no}`}
                  accessibilityHint="点击展开或收起，长按复制"
                  onPress={toggleOrder} onLongPress={() => copyOrderField('订单号', order.order_no)}>
                  <Text style={styles.orderNo} numberOfLines={1} ellipsizeMode="tail">{order.order_no}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
            </View>

            <View style={styles.orderContent}>
              {customerName ? (
                <TouchableOpacity style={styles.orderInfo} feedback="none"
                  accessibilityRole="button" accessibilityLabel={`客户名称，${customerName}`}
                  accessibilityHint="点击展开或收起，长按复制"
                  onPress={toggleOrder} onLongPress={() => copyOrderField('客户名称', customerName)}>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {order.operation_type === 'sales_return' ? `销售退货 · ${customerName}` : customerName}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.orderInfo}>
                  <Text style={styles.noCustomer} numberOfLines={1}>暂无客户名称</Text>
                </View>
              )}
            </View>
          </View>
        </AnimatedCard>

        {<View>{expandedOrderId === order.id && expandedMaterialsLoadingId !== order.id && (
          <View testID="order-expanded-details" style={styles.materialsList}>
            {traceMatches?.length ? (
              <>
                <Text style={styles.materialDetails}>匹配的追溯码</Text>
                {traceMatches.map(match => (
                  <View key={JSON.stringify([match.materialId, match.traceNo])} style={styles.materialItem}>
                    <TouchableOpacity style={styles.materialMainInfo} feedback="none" accessibilityRole="button"
                      accessibilityLabel={`查看扫码记录，追溯码：${match.traceNo}`}
                      onPress={() => router.push('/detail', { id: match.materialId })}>
                      <View style={styles.materialScanRow}>
                        <Text style={styles.materialIdentity}>{`追溯码：${match.traceNo}`}</Text>
                        <Feather name="chevron-right" size={14} color={theme.textMuted} />
                      </View>
                      <Text style={styles.materialDetails}>{match.model || '未知型号'} · 批次 {match.batch || '-'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            ) : expandedMaterialGroups.length === 0 ? (
              <View style={styles.noMaterials}>
                <Text style={styles.noMaterialsText}>{batchKeyword ? '该订单暂无匹配批次' : '该订单暂无物料记录'}</Text>
              </View>
            ) : (
              <>
                {!!batchKeyword && <Text style={styles.materialDetails}>仅显示批次 {searchText.trim()}</Text>}
                {expandedMaterialGroups.map(renderMaterialGroup)}
              </>
            )}
          </View>
        )}</View>}
      </View>
    );
  };

  const renderCurrentOrderCard = () => {
    if (!currentOrder) {
      return null;
    }

    return (
      <View>
        <AnimatedCard>
          <View style={styles.orderItem}>
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderLeft}>
                <Feather name="file-text" size={18} color={theme.textSecondary} />
                <Text style={[styles.orderNo, styles.orderNoTarget]} numberOfLines={1} ellipsizeMode="tail">
                  {currentOrder.order_no}
                </Text>
              </View>
              <Text style={styles.orderDate}>{formatDate(currentOrder.created_at)}</Text>
            </View>

            <View style={styles.orderContent}>
              <View style={styles.orderInfo}>
                {currentOrder.customer_name ? (
                  <Text style={styles.customerName} numberOfLines={1}>
                    {currentOrder.operation_type === 'sales_return' ? `销售退货 · ${currentOrder.customer_name}` : currentOrder.customer_name}
                  </Text>
                ) : (
                  <Text style={styles.noCustomer} numberOfLines={1}>
                    暂无客户名称
                  </Text>
                )}
              </View>

            </View>
          </View>
        </AnimatedCard>
      </View>
    );
  };

  const renderCurrentMaterialItem = ({ item }: { item: OrderMaterialGroup }) => renderMaterialGroup(item);

  const renderCurrentEmpty = useCallback(() => {
    if (currentOrderLoading) {
      return (
        <AppEmptyState
          icon="loader"
          title="正在加载当前订单"
          loading
          compact
          style={styles.emptyContainer}
        />
      );
    }

    if (!currentOrderNo) {
      return (
        <View style={styles.emptyContainer}>
          <AppEmptyState
            icon="camera"
            title="暂无当前订单"
            description="先去扫码出库，系统会自动记录正在处理的订单"
            compact
          />
          <TouchableOpacity
            style={styles.emptyActionBtn}
            activeOpacity={0.86}
            onPress={() => router.push('/outbound')}
          >
            <Text style={styles.emptyActionText}>去扫码出库</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!currentOrder) {
      return (
        <View style={styles.emptyContainer}>
          <AppEmptyState
            icon="alert-circle"
            title="当前订单不存在"
            description="这张订单可能已删除，重新扫码订单后会自动更新"
            compact
          />
          <TouchableOpacity
            style={styles.emptyActionBtn}
            activeOpacity={0.86}
            onPress={() => router.push('/outbound')}
          >
            <Text style={styles.emptyActionText}>重新扫码</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.noMaterials}>
        <Text style={styles.noMaterialsText}>本单暂无物料记录</Text>
      </View>
    );
  }, [
    currentOrder,
    currentOrderLoading,
    currentOrderNo,
    router,
    styles.emptyActionBtn,
    styles.emptyActionText,
    styles.emptyContainer,
    styles.noMaterials,
    styles.noMaterialsText,
  ]);

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.86}
            onPress={() => router.back()} accessibilityLabel="返回上一页"
          >
            <Feather name="arrow-left" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>出库订单</Text>
            <Text style={styles.subtitle}>查询订单和出库记录</Text>
          </View>
        </View>

        {timeFilter !== 'current' && (
          <View style={styles.searchContainer}>
            <Feather name="search" size={18} color={theme.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={ORDER_SEARCH_OPTIONS.find(option => option.key === searchType)?.placeholder}
              placeholderTextColor={theme.textMuted}
              value={searchText}
              onChangeText={handleSearchInput}
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => handleSearchInput('')} style={styles.searchClear}>
                <Feather name="x" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 仓库选择器 + 视图筛选 + 搜索类型 */}
        <View style={styles.filterCard}>
          {/* 仓库、日期范围与低频导出入口同排；缩短仓库名称，不压缩点击高度。 */}
          <View style={styles.toolbarRow}>
            <TouchableOpacity style={styles.warehouseBtn} disabled={exportingHistory} activeOpacity={0.86}
              accessibilityRole="button" accessibilityLabel={`选择仓库，当前${currentWarehouse?.name || '未选择'}`}
              onPress={() => setShowWarehousePicker(true)}>
              <View style={styles.warehouseArrowSpace} />
              <Text style={styles.warehouseBtnText} numberOfLines={1}>{currentWarehouse?.name || '选择仓库'}</Text>
              <Feather name="chevron-down" size={12} color={theme.primary} />
            </TouchableOpacity>
            <View style={styles.timeSegments}>
              {([{ key: 'current', label: '当前' }, { key: 'today', label: '当天' }, { key: 'all', label: '全部' }] as const).map(option => (
                <TouchableOpacity key={option.key} accessibilityRole="button" accessibilityState={{ selected: timeFilter === option.key }}
                  style={[styles.timeSegment, timeFilter === option.key && styles.timeSegmentActive]}
                  onPress={() => handleTimeFilterChange(option.key)}>
                  <Text style={[styles.timeSegmentText, timeFilter === option.key && styles.searchTypeTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.exportHistoryButton, (!currentWarehouse || exportingHistory) && styles.exportHistoryButtonDisabled]}
              accessibilityRole="button" accessibilityLabel="导出当前仓库全部历史出库记录"
              disabled={!currentWarehouse || exportingHistory} activeOpacity={0.86} onPress={handleExportHistory}>
              <Text style={styles.exportHistoryText}>{exportingHistory ? '导出中' : '导出历史'}</Text>
            </TouchableOpacity>
          </View>

          {timeFilter !== 'current' && (
            <View style={styles.filterRow}>
              {ORDER_SEARCH_OPTIONS.map(option => {
                const selected = searchType === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.searchTypeBtn, selected && styles.searchTypeBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    activeOpacity={0.86}
                    onPress={() => handleSearchTypeChange(option.key)}
                  >
                    <FontAwesome6 name={option.icon} size={12}
                      color={selected ? theme.buttonPrimaryText : theme.textMuted} style={styles.searchTypeBtnIcon} />
                    <Text numberOfLines={1} style={[styles.searchTypeText, selected && styles.searchTypeTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* 订单列表 */}
        <View style={styles.recentOrders}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>
                {timeFilter === 'current' ? '当前订单' : '订单列表'}
              </Text>
              <Text style={styles.sectionTip}>
                {timeFilter === 'current'
                  ? '本单物料已直接展示'
                  : '点击展开查看物料'}
              </Text>
            </View>
          </View>

          {timeFilter === 'current' ? (
            <FlatList
              data={currentOrder ? currentMaterialGroups : []}
              keyExtractor={(item) => item.key}
              renderItem={renderCurrentMaterialItem}
              ListHeaderComponent={currentOrder ? renderCurrentOrderCard : null}
              extraData={[currentOrder, currentOrderLoading, expandedBatchKeys]}
              style={styles.ordersList}
              contentContainerStyle={[
                styles.ordersListContent,
                { paddingBottom: insets.bottom + 100 },
              ]}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              maxToRenderPerBatch={14}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={renderCurrentEmpty}
            />
          ) : (
            <FlatList
              data={filteredOrders}
              keyExtractor={(item) => item.id}
              renderItem={renderOrderItem}
              extraData={[expandedOrderId, expandedMaterialGroups, expandedBatchKeys, searchText, searchType]}
              style={styles.ordersList}
              contentContainerStyle={[
                styles.ordersListContent,
                { paddingBottom: insets.bottom + 100 },
              ]}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="file-text"
                  title={searchText ? '未找到匹配订单' : '暂无订单'}
                  description={batchKeyword ? '请核对完整批次号' : searchText ? '请尝试其他关键词' : '扫码出库后会自动生成订单'}
                  style={styles.emptyContainer}
                />
              }
            />
          )}
        </View>
      </View>

      {/* 仓库选择器弹窗 */}
      {<MotionPresence visible={Boolean(showWarehousePicker)} overlay style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 50 }}>{showWarehousePicker && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.pickerTitle}>选择仓库</Text>
            <FlatList
              data={warehouses}
              keyExtractor={(wh) => wh.id}
              style={{ flexShrink: 1 }}
              renderItem={({ item: wh }) => (
              <TouchableOpacity
                key={wh.id}
                style={[
                  styles.pickerItem,
                  currentWarehouse?.id === wh.id && styles.pickerItemActive,
                ]}
                activeOpacity={0.86}
                onPress={() => handleWarehouseChange(wh)}
              >
                <Text style={styles.pickerItemText}>{wh.name}</Text>
                {currentWarehouse?.id === wh.id && (
                  <FontAwesome6 name="check" size={14} color={theme.primary} />
                )}
              </TouchableOpacity>
            )}
            />
            <TouchableOpacity
              style={styles.pickerClose}
              activeOpacity={0.86}
              onPress={() => setShowWarehousePicker(false)}
            >
              <Text style={styles.pickerCloseText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}</MotionPresence>}
      {alert.AlertComponent}
    </Screen>
  );
}
