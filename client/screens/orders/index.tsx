import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/hooks/useTheme';
import { useHardwareBack } from '@/hooks/useHardwareBack';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { createStyles } from './styles';
import { AnimatedCard } from '@/components/AnimatedCard';
import {
  getQueryFilteredOrders,
  getQueryOrder,
  getQueryMaterialsByOrder,
  Order,
  MaterialRecord,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
} from '@/utils/database';
import { safeJsonParseNullable } from '@/utils/json';
import { STORAGE_KEYS } from '@/constants/config';
import { formatDate } from '@/utils/time';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Spacing } from '@/constants/theme';
import { logger } from '@/utils/logger';

// 搜索类型
type SearchType = 'order' | 'customer' | 'batch';

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
  const params = useSafeSearchParams<{ orderNo?: string; materialId?: number }>();

  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchText, setSearchText] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('order');

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
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedMaterials, setExpandedMaterials] = useState<MaterialRecord[]>([]);
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
  const appliedTargetOrderRef = useRef('');

  useHardwareBack(useCallback(() => {
    if (!showWarehousePicker) return false;
    setShowWarehousePicker(false);
    return true;
  }, [showWarehousePicker]));

  // 同步 ref
  useEffect(() => {
    expandedOrderIdRef.current = expandedOrderId;
  }, [expandedOrderId]);

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
        warehouseLoadRequestRef.current += 1;
        currentOrderRequestRef.current += 1;
        searchRequestRef.current += 1;
        expandedMaterialsRequestRef.current += 1;
        clearExpandedMaterialsTimer();
      };
    }, [clearExpandedMaterialsTimer])
  );

  // 加载仓库
  const loadWarehouses = useCallback(async (isCurrent: () => boolean): Promise<Warehouse | null> => {
    const list = await getAllWarehouses();
    if (!isCurrent()) return null;
    setWarehouses(list);

    // 尝试从订单管理独立的 Storage Key 加载仓库（不与扫码出库共享）
    const savedWarehouse = await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
    if (!isCurrent()) return null;
    if (savedWarehouse) {
      const warehouse = safeJsonParseNullable<Warehouse>(savedWarehouse, 'orders.globalWarehouse');
      // 确保仓库仍然存在
      const latestWarehouse = warehouse ? list.find((w) => w.id === warehouse.id) : null;
      if (latestWarehouse) {
        setCurrentWarehouse(latestWarehouse);
        await AsyncStorage.setItem(
          STORAGE_KEYS.GLOBAL_WAREHOUSE,
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
      type?: SearchType;
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
      type: SearchType;
      warehouseId?: string;
      timeFilterValue: QueryTimeFilterType;
    }) => [warehouseId || '', timeFilterValue, type, text.trim()].join('::'),
    []
  );

  const loadCurrentOrder = useCallback(async (warehouseId?: string, selectCurrentView = false) => {
    const requestId = ++currentOrderRequestRef.current;
    const isCurrent = () => screenActiveRef.current && requestId === currentOrderRequestRef.current;
    setCurrentOrderLoading(true);
    if (selectCurrentView) setTimeFilter('current');

    try {
      // 查询历史订单仅切换本页展示，不能修改扫码出库的当前单和草稿。
      const savedOrderNo = params.orderNo?.trim() ||
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
  }, [params.orderNo]);

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
          if (expandedMaterialsRequestRef.current === requestId) {
            logger.error('加载订单物料失败:', error);
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
    [clearExpandedMaterialsTimer]
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
          await loadExpandedMaterials(expandedOrder, { warehouseId });
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
  const handleSearchTypeChange = useCallback((type: SearchType) => {
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
      searchType === 'batch' ? 220 : 120
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
        const warehouse = await loadWarehouses(isCurrent);
        if (isCurrent()) {
          await loadDataForWarehouseRef.current(warehouse?.id);
        }
      };

      void init();

      return () => {
        isMounted = false;
      };
    }, [loadWarehouses])
  );

  // 处理仓库切换
  const handleWarehouseChange = useCallback(
    async (warehouse: Warehouse) => {
      if (warehouse.id === currentWarehouse?.id) {
        setShowWarehousePicker(false);
        return;
      }
      setCurrentWarehouse(warehouse);
      setFilteredOrders([]);
      setCurrentOrder(null);
      setCurrentOrderMaterials([]);
      setShowWarehousePicker(false);

      // 保存到订单管理独立的 Storage Key（不与扫码出库共享）
      void AsyncStorage.setItem(STORAGE_KEYS.GLOBAL_WAREHOUSE, JSON.stringify(warehouse));

      // 清空展开的订单（因为仓库切换后物料列表可能为空）
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      setExpandedOrderId(null);
      setExpandedMaterials([]);
      setExpandedMaterialsLoadingId(null);

      await loadDataForWarehouse(warehouse.id);
    },
    [clearExpandedMaterialsTimer, currentWarehouse, loadDataForWarehouse]
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
  }, [clearExpandedMaterialsTimer, currentWarehouse?.id, loadCurrentOrder, loadDataForWarehouse]);

  // 只在首次进入或目标单号变化时选择“当前”。从物料详情返回时保留查询视图。
  useEffect(() => {
    const targetOrderNo = params.orderNo?.trim() || '';
    if (!targetOrderNo) {
      appliedTargetOrderRef.current = '';
      return;
    }
    if (!currentWarehouse?.id || appliedTargetOrderRef.current === targetOrderNo) return;
    appliedTargetOrderRef.current = targetOrderNo;
    void loadCurrentOrder(currentWarehouse.id, true);
  }, [params.orderNo, currentWarehouse?.id, loadCurrentOrder]);

  // 点击订单 - 展开/收起显示物料列表
  const handleToggleOrder = async (order: Order) => {
    if (expandedOrderId === order.id) {
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      setExpandedOrderId(null);
      setExpandedMaterials([]);
      setExpandedMaterialsLoadingId(null);
    } else {
      setExpandedOrderId(order.id);
      setExpandedMaterials([]);
      await loadExpandedMaterials(order, { warehouseId: currentWarehouse?.id, delay: 30 });
    }
  };

  // 查看物料详情
  const handleViewMaterial = (material: MaterialRecord) => {
    router.push('/detail', { id: material.id });
  };

  const renderMaterialRow = (material: MaterialRecord) => (
      <View key={material.id} style={styles.materialItem}>
        <TouchableOpacity
          style={styles.materialMainInfo}
          activeOpacity={0.7}
          onPress={() => handleViewMaterial(material)}
        >
          <Text style={styles.materialModel} numberOfLines={1}>
            {material.model || '未知型号'}
          </Text>
          <Text style={styles.materialDetails}>批次: {material.batch || '-'}</Text>
          <Text style={styles.materialDetails}>{material.operation_type === 'sales_return' ? '实收数量' : '数量'}: {material.quantity || 0}</Text>
          <Text style={styles.materialDate}>{formatDate(material.scanned_at)}</Text>
        </TouchableOpacity>

      </View>
  );

  const renderOrderItem = ({ item: order }: { item: Order }) => (
      <View>
        <AnimatedCard
          onPress={() => handleToggleOrder(order)}
        >
          <View
            style={[styles.orderItem, expandedOrderId === order.id && styles.orderItemExpanded]}
          >
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderLeft}>
                <Feather
                  name={expandedOrderId === order.id ? 'chevron-down' : 'chevron-right'}
                  size={18}
                  color={theme.textSecondary}
                />
                <Text style={styles.orderNo} numberOfLines={1} ellipsizeMode="tail">
                  {order.order_no}
                </Text>
              </View>
              <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
            </View>

            <View style={styles.orderContent}>
              <View style={styles.orderInfo}>
                {order.customer_name ? (
                  <Text style={styles.customerName} numberOfLines={1}>
                    {order.operation_type === 'sales_return' ? `销售退货 · ${order.customer_name}` : order.customer_name}
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

        {expandedOrderId === order.id && (
          <View style={styles.materialsList}>
            {expandedMaterialsLoadingId === order.id ? (
              <View style={styles.noMaterials}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.noMaterialsText, { marginTop: Spacing.xs }]}>
                  正在加载本单物料...
                </Text>
              </View>
            ) : expandedMaterials.length === 0 ? (
              <View style={styles.noMaterials}>
                <Text style={styles.noMaterialsText}>该订单暂无物料记录</Text>
              </View>
            ) : (
              expandedMaterials.map(renderMaterialRow)
            )}
          </View>
        )}
      </View>
  );

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
                <Text style={styles.orderNo} numberOfLines={1} ellipsizeMode="tail">
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

  const renderCurrentMaterialItem = ({ item }: { item: MaterialRecord }) => renderMaterialRow(item);

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
            activeOpacity={0.8}
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
            activeOpacity={0.8}
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
            activeOpacity={0.7}
            onPress={() => router.back()}
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
              placeholder={
                searchType === 'batch'
                  ? '搜索批次号...'
                  : searchType === 'customer'
                    ? '搜索客户名称...'
                    : '搜索订单号...'
              }
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
          {/* 第一行：仓库 + 订单视图 */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={styles.warehouseBtn}
              activeOpacity={0.7}
              onPress={() => setShowWarehousePicker(true)}
            >
              <FontAwesome6 name="warehouse" size={14} color={theme.primary} />
              <Text style={styles.warehouseBtnText}>{currentWarehouse?.name || '选择仓库'}</Text>
              <FontAwesome6
                name="chevron-down"
                size={10}
                color={theme.primary}
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.searchTypeBtn, timeFilter === 'current' && styles.searchTypeBtnActive]}
              activeOpacity={0.7}
              onPress={() => handleTimeFilterChange('current')}
            >
              <FontAwesome6
                name="location-dot"
                size={12}
                color={timeFilter === 'current' ? theme.buttonPrimaryText : theme.textMuted}
                style={styles.searchTypeBtnIcon}
              />
              <Text
                style={[
                  styles.searchTypeText,
                  timeFilter === 'current' && styles.searchTypeTextActive,
                ]}
              >
                当前
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.searchTypeBtn, timeFilter === 'today' && styles.searchTypeBtnActive]}
              activeOpacity={0.7}
              onPress={() => handleTimeFilterChange('today')}
            >
              <FontAwesome6
                name="calendar-day"
                size={12}
                color={timeFilter === 'today' ? theme.buttonPrimaryText : theme.textMuted}
                style={styles.searchTypeBtnIcon}
              />
              <Text
                style={[
                  styles.searchTypeText,
                  timeFilter === 'today' && styles.searchTypeTextActive,
                ]}
              >
                当天
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.searchTypeBtn, timeFilter === 'all' && styles.searchTypeBtnActive]}
              activeOpacity={0.7}
              onPress={() => handleTimeFilterChange('all')}
            >
              <FontAwesome6
                name="calendar"
                size={12}
                color={timeFilter === 'all' ? theme.buttonPrimaryText : theme.textMuted}
                style={styles.searchTypeBtnIcon}
              />
              <Text
                style={[styles.searchTypeText, timeFilter === 'all' && styles.searchTypeTextActive]}
              >
                全部
              </Text>
            </TouchableOpacity>
          </View>

          {timeFilter !== 'current' && (
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[
                  styles.searchTypeBtn,
                  searchType === 'order' && styles.searchTypeBtnActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleSearchTypeChange('order')}
              >
                <FontAwesome6
                  name="file-lines"
                  size={12}
                  color={searchType === 'order' ? theme.buttonPrimaryText : theme.textMuted}
                  style={styles.searchTypeBtnIcon}
                />
                <Text
                  style={[
                    styles.searchTypeText,
                    searchType === 'order' && styles.searchTypeTextActive,
                  ]}
                >
                  订单号
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.searchTypeBtn,
                  searchType === 'customer' && styles.searchTypeBtnActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleSearchTypeChange('customer')}
              >
                <FontAwesome6
                  name="user"
                  size={12}
                  color={searchType === 'customer' ? theme.buttonPrimaryText : theme.textMuted}
                  style={styles.searchTypeBtnIcon}
                />
                <Text
                  style={[
                    styles.searchTypeText,
                    searchType === 'customer' && styles.searchTypeTextActive,
                  ]}
                >
                  客户
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.searchTypeBtn,
                  searchType === 'batch' && styles.searchTypeBtnActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleSearchTypeChange('batch')}
              >
                <FontAwesome6
                  name="barcode"
                  size={12}
                  color={searchType === 'batch' ? theme.buttonPrimaryText : theme.textMuted}
                  style={styles.searchTypeBtnIcon}
                />
                <Text
                  style={[
                    styles.searchTypeText,
                    searchType === 'batch' && styles.searchTypeTextActive,
                  ]}
                >
                  批次
                </Text>
              </TouchableOpacity>
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
              data={currentOrder ? currentOrderMaterials : []}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderCurrentMaterialItem}
              ListHeaderComponent={currentOrder ? renderCurrentOrderCard : null}
              extraData={`${currentOrder?.id || ''}-${currentOrderMaterials.length}-${currentOrderLoading}`}
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
              extraData={`${expandedOrderId}-${expandedMaterials.length}`}
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
                  description={searchText ? '请尝试其他关键词' : '扫码出库后会自动生成订单'}
                  style={styles.emptyContainer}
                />
              }
            />
          )}
        </View>
      </View>

      {/* 仓库选择器弹窗 */}
      {showWarehousePicker && (
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
                activeOpacity={0.7}
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
              activeOpacity={0.7}
              onPress={() => setShowWarehousePicker(false)}
            >
              <Text style={styles.pickerCloseText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Screen>
  );
}
