import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { AppEmptyState } from '@/components/AppEmptyState';
import { KeyboardAwareFormScrollView, KeyboardAwareModalContainer } from '@/components/KeyboardAwareForm';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { createStyles } from './styles';
import { AnimatedCard } from '@/components/AnimatedCard';
import {
  upsertOrder,
  getFilteredOrders,
  getOrder,
  deleteOrder,
  getMaterialsByOrder,
  deleteMaterial,
  updateMaterial,
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
import { Spacing, BorderRadius, Typography } from '@/constants/theme';
import { parseQuantity } from '@/utils/quantity';
import { logger } from '@/utils/logger';

// 搜索类型
type SearchType = 'order' | 'customer' | 'batch';

// 订单视图类型
type TimeFilterType = 'current' | 'today' | 'all';
type QueryTimeFilterType = 'today' | 'all';

const getQueryTimeFilter = (filter: TimeFilterType): QueryTimeFilterType =>
  filter === 'all' ? 'all' : 'today';

type OutboundWorkDraft = {
  orderNo?: unknown;
  warehouseId?: unknown;
};

// 自定义弹窗配置
interface CustomAlertConfig {
  visible: boolean;
  title: string;
  message: string;
  icon?: 'success' | 'warning' | 'error' | 'info';
  buttons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[];
}

interface DeferredTimerEntry {
  timerId: ReturnType<typeof setTimeout>;
  resolve: (isActive: boolean) => void;
}

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
  const deferredActionTimersRef = useRef<Set<DeferredTimerEntry>>(new Set());

  // 同步 ref
  useEffect(() => {
    expandedOrderIdRef.current = expandedOrderId;
  }, [expandedOrderId]);

  const clearDeferredActionTimers = useCallback(() => {
    deferredActionTimersRef.current.forEach((entry) => {
      clearTimeout(entry.timerId);
      entry.resolve(false);
    });
    deferredActionTimersRef.current.clear();
  }, []);

  const waitForUiFlush = useCallback((delay = 50) => {
    return new Promise<boolean>((resolve) => {
      if (!screenActiveRef.current) {
        resolve(false);
        return;
      }

      const entry = {} as DeferredTimerEntry;
      entry.resolve = resolve;
      entry.timerId = setTimeout(() => {
        deferredActionTimersRef.current.delete(entry);
        resolve(screenActiveRef.current);
      }, delay);

      deferredActionTimersRef.current.add(entry);
    });
  }, []);

  const clearExpandedMaterialsTimer = useCallback(() => {
    if (expandedMaterialsTimerRef.current) {
      clearTimeout(expandedMaterialsTimerRef.current);
      expandedMaterialsTimerRef.current = null;
    }
  }, []);

  // 自定义弹窗
  const [customAlert, setCustomAlert] = useState<CustomAlertConfig>({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  });

  // 显示自定义弹窗
  const showCustomAlert = (
    title: string,
    message: string,
    buttons: CustomAlertConfig['buttons'],
    icon?: 'success' | 'warning' | 'error' | 'info'
  ) => {
    setCustomAlert({ visible: true, title, message, buttons, icon });
  };

  // 关闭自定义弹窗
  const closeCustomAlert = () => {
    setCustomAlert((prev) => ({ ...prev, visible: false }));
  };

  const renderCustomAlertFooter = () => {
    if (customAlert.buttons.length === 0) {
      return null;
    }

    if (customAlert.buttons.length === 1) {
      const [button] = customAlert.buttons;
      return (
        <AppModalActions
          containerStyle={{ marginTop: 0 }}
          primaryLabel={button.text}
          primaryVariant={button.style === 'destructive' ? 'danger' : 'primary'}
          onPrimaryPress={() => {
            closeCustomAlert();
            button.onPress?.();
          }}
        />
      );
    }

    const secondaryButton =
      customAlert.buttons.find((button) => button.style === 'cancel') ?? customAlert.buttons[0];
    const primaryButton =
      customAlert.buttons.find((button) => button !== secondaryButton) ?? customAlert.buttons[0];

    return (
      <AppModalActions
        containerStyle={{ marginTop: 0 }}
        secondaryLabel={secondaryButton.text}
        secondaryVariant={secondaryButton.style === 'destructive' ? 'danger' : 'secondary'}
        onSecondaryPress={() => {
          closeCustomAlert();
          secondaryButton.onPress?.();
        }}
        primaryLabel={primaryButton.text}
        primaryVariant={primaryButton.style === 'destructive' ? 'danger' : 'primary'}
        onPrimaryPress={() => {
          closeCustomAlert();
          primaryButton.onPress?.();
        }}
      />
    );
  };

  // 编辑客户名称弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const customerNameInputRef = useRef<TextInput>(null);
  const customerNameFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 客户名称弹窗打开时聚焦输入框
  useEffect(() => {
    if (editModalVisible && customerNameInputRef.current) {
      customerNameFocusTimerRef.current = setTimeout(() => {
        customerNameInputRef.current?.focus();
        customerNameFocusTimerRef.current = null;
      }, 300);
    }

    return () => {
      if (customerNameFocusTimerRef.current) {
        clearTimeout(customerNameFocusTimerRef.current);
        customerNameFocusTimerRef.current = null;
      }
    };
  }, [editModalVisible]);

  // 编辑物料弹窗
  const [editMaterialModalVisible, setEditMaterialModalVisible] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialRecord | null>(null);
  const [editMaterialData, setEditMaterialData] = useState({
    model: '',
    batch: '',
    quantity: '',
    package: '',
    version: '',
    productionDate: '',
    traceNo: '',
    sourceNo: '',
  });
  const [savingMaterial, setSavingMaterial] = useState(false);
  const quantityInputRef = useRef<TextInput>(null);
  const editMaterialFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      screenActiveRef.current = false;
      clearDeferredActionTimers();
      expandedMaterialsRequestRef.current += 1;
      clearExpandedMaterialsTimer();
      if (editMaterialFocusTimerRef.current) {
        clearTimeout(editMaterialFocusTimerRef.current);
        editMaterialFocusTimerRef.current = null;
      }
    },
    [clearDeferredActionTimers, clearExpandedMaterialsTimer]
  );

  // 页面聚焦时恢复活动状态
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;

      return () => {
        screenActiveRef.current = false;
        clearDeferredActionTimers();
        expandedMaterialsRequestRef.current += 1;
        clearExpandedMaterialsTimer();
      };
    }, [clearDeferredActionTimers, clearExpandedMaterialsTimer])
  );

  // 加载仓库数据
  // 加载仓库
  const loadWarehouses = useCallback(async (): Promise<Warehouse | null> => {
    const list = await getAllWarehouses();
    setWarehouses(list);

    // 尝试从订单管理独立的 Storage Key 加载仓库（不与扫码出库共享）
    const savedWarehouse = await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE);
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
      return getFilteredOrders({
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

  const loadCurrentOrder = useCallback(async (warehouseId?: string) => {
    setCurrentOrderLoading(true);

    try {
      const savedOrderNo = (await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO))?.trim() || '';

      if (!screenActiveRef.current) {
        return;
      }

      setCurrentOrderNo(savedOrderNo);

      if (!savedOrderNo) {
        setCurrentOrder(null);
        setCurrentOrderMaterials([]);
        return;
      }

      const [order, materials] = await Promise.all([
        getOrder(savedOrderNo, warehouseId),
        getMaterialsByOrder(savedOrderNo, warehouseId),
      ]);

      if (!screenActiveRef.current) {
        return;
      }

      setCurrentOrder(order);
      setCurrentOrderMaterials(order ? materials : []);
    } catch (error) {
      logger.error('加载当前订单失败:', error);
      if (screenActiveRef.current) {
        setCurrentOrder(null);
        setCurrentOrderMaterials([]);
      }
    } finally {
      if (screenActiveRef.current) {
        setCurrentOrderLoading(false);
      }
    }
  }, []);

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
          const materials = await getMaterialsByOrder(order.order_no, options?.warehouseId);

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
        getFilteredOrders({
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

      setFilteredOrders(filtered);

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

  // 加载数据
  const loadData = useCallback(async () => {
    await loadDataForWarehouse(currentWarehouse?.id);
  }, [currentWarehouse?.id, loadDataForWarehouse]);

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

        runOrderSearch({
          text: searchText,
          type: searchType,
          warehouseId: currentWarehouse?.id,
          timeFilterValue: getQueryTimeFilter(timeFilter),
        }).then((result) => {
          if (isActive) {
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

      const init = async () => {
        const warehouse = await loadWarehouses();
        if (isMounted) {
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

  // 处理从首页/其他页面跳转过来的 orderNo 参数
  // 逻辑：将目标订单设为"当前订单"，停留在 current 视图，方便查看出库明细
  useEffect(() => {
    if (!params.orderNo) {
      return;
    }

    const targetOrderNo = params.orderNo.trim();
    if (!targetOrderNo) {
      return;
    }

    // 如果目标订单已经是当前订单，不需要重复切换
    if (currentOrderNo === targetOrderNo) {
      return;
    }

    // 把目标订单写入 AsyncStorage，作为新的"当前出库单"
    //    同时加载该订单数据，覆盖 currentOrder / currentOrderMaterials
    const switchCurrentOrder = async () => {
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, targetOrderNo);
        // 草稿要清空，避免用旧草稿的数量/仓库污染新订单
        await AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT);

        if (!screenActiveRef.current) {
          return;
        }

        setTimeFilter('current');
        setCurrentOrderNo(targetOrderNo);
        setCurrentOrderLoading(true);

        const [order, materials] = await Promise.all([
          getOrder(targetOrderNo, currentWarehouse?.id),
          getMaterialsByOrder(targetOrderNo, currentWarehouse?.id),
        ]);

        if (!screenActiveRef.current) {
          return;
        }

        setCurrentOrder(order);
        setCurrentOrderMaterials(order ? materials : []);
      } catch (error) {
        logger.error('切换当前订单失败:', error);
      } finally {
        if (screenActiveRef.current) {
          setCurrentOrderLoading(false);
        }
      }
    };

    void switchCurrentOrder();
    // 只在 orderNo 变化时触发，避免 currentOrderNo 变化导致循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.orderNo]);

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

  // 打开编辑客户名称弹窗
  const handleEditCustomer = (order: Order) => {
    setEditingOrder(order);
    setEditCustomerName(order.customer_name || '');
    setEditModalVisible(true);
  };

  const closeCustomerModal = useCallback(() => {
    setEditModalVisible(false);
    setEditingOrder(null);
    setEditCustomerName('');
  }, []);

  // 保存客户名称
  const handleSaveCustomer = async () => {
    if (!editingOrder) return;

    try {
      const nextCustomerName = editCustomerName.trim();
      await upsertOrder(
        editingOrder.order_no,
        nextCustomerName,
        editingOrder.warehouse_id
          ? {
              id: editingOrder.warehouse_id,
              name: editingOrder.warehouse_name || '',
            }
          : undefined
      );
      setEditModalVisible(false);
      setEditingOrder(null);
      setEditCustomerName('');
      await loadData();
      showCustomAlert(
        '成功',
        nextCustomerName ? '客户名称已更新' : '客户名称已清空',
        [{ text: '确定' }],
        'success'
      );
    } catch (error) {
      logger.error('保存失败:', error);
      showCustomAlert('错误', '保存失败', [{ text: '确定', style: 'destructive' }], 'error');
    }
  };

  const shouldClearOutboundDraftForDeletedOrder = useCallback(
    async (order: Order) => {
      const [savedOrderNo, savedDraftText] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO),
        AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT),
      ]);

      const normalizedOrderNo = order.order_no.trim();
      const normalizedWarehouseId =
        typeof order.warehouse_id === 'string' && order.warehouse_id.trim() !== ''
          ? order.warehouse_id.trim()
          : null;

      if (currentOrderNo === normalizedOrderNo || savedOrderNo?.trim() === normalizedOrderNo) {
        return true;
      }

      const draft = safeJsonParseNullable<OutboundWorkDraft>(
        savedDraftText,
        'orders.outboundWorkDraftForDelete'
      );
      if (!draft || typeof draft.orderNo !== 'string') {
        return false;
      }

      if (draft.orderNo.trim() !== normalizedOrderNo) {
        return false;
      }

      const draftWarehouseId =
        typeof draft.warehouseId === 'string' && draft.warehouseId.trim() !== ''
          ? draft.warehouseId.trim()
          : null;

      return normalizedWarehouseId ? draftWarehouseId === normalizedWarehouseId : draftWarehouseId === null;
    },
    [currentOrderNo]
  );

  // 删除订单
  const handleDeleteOrder = (order: Order) => {
    showCustomAlert(
      '确认删除',
      `确定要删除订单 ${order.order_no} 及其所有物料记录吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              const shouldClearOutboundDraft = await shouldClearOutboundDraftForDeletedOrder(order);
              await deleteOrder(order.order_no, order.warehouse_id);
              if (expandedOrderId === order.id) {
                expandedMaterialsRequestRef.current += 1;
                clearExpandedMaterialsTimer();
                setExpandedOrderId(null);
                setExpandedMaterials([]);
                setExpandedMaterialsLoadingId(null);
              }
              if (shouldClearOutboundDraft) {
                await Promise.all([
                  AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_ORDER_NO),
                  AsyncStorage.removeItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT),
                ]);
                if (currentOrderNo === order.order_no) {
                  setCurrentOrderNo('');
                  setCurrentOrder(null);
                  setCurrentOrderMaterials([]);
                }
              }
              await loadData();
              showCustomAlert('成功', '订单已删除', [{ text: '确定' }], 'success');
            } catch (error) {
              logger.error('删除订单失败:', error);
              showCustomAlert(
                '错误',
                '删除订单失败',
                [{ text: '确定', style: 'destructive' }],
                'error'
              );
            }
          },
        },
      ],
      'warning'
    );
  };

  // 删除物料
  const handleDeleteMaterial = (material: MaterialRecord) => {
    const materialSummary = [
      `型号：${material.model || '-'}`,
      `批次：${material.batch || '-'}`,
      `数量：${material.quantity || 0}`,
    ].join('\n');

    showCustomAlert(
      '确认删除',
      `确定要删除这条物料记录吗？\n${materialSummary}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMaterial(material.id!);
              // 短暂延迟确保 AsyncStorage 写入完成
              if (!(await waitForUiFlush())) {
                return;
              }
              const materials = await getMaterialsByOrder(material.order_no, currentWarehouse?.id);
              setExpandedMaterials(materials);
              await loadData();
              showCustomAlert(
                '删除成功',
                `物料记录已删除\n${materialSummary}`,
                [{ text: '确定' }],
                'success'
              );
            } catch (error) {
              logger.error('删除物料失败:', error);
              showCustomAlert(
                '错误',
                '删除失败',
                [{ text: '确定', style: 'destructive' }],
                'error'
              );
            }
          },
        },
      ],
      'warning'
    );
  };

  // 打开编辑物料弹窗
  const handleOpenEditMaterial = (material: MaterialRecord) => {
    if (material.isUnpacked) {
      showCustomAlert(
        '拆包物料不可直接修改',
        '该数量与拆包标签成对关联，请回到扫码出库重新处理。',
        [{ text: '确定' }],
        'warning'
      );
      return;
    }

    setEditingMaterial(material);
    setEditMaterialData({
      model: material.model || '',
      batch: material.batch || '',
      quantity: (material.quantity || 0).toString(),
      package: material.package || '',
      version: material.version || '',
      productionDate: material.productionDate || '',
      traceNo: material.traceNo || '',
      sourceNo: material.sourceNo || '',
    });
    setEditMaterialModalVisible(true);
    // 延迟聚焦到数量输入框，等待 Modal 打开动画完成
    editMaterialFocusTimerRef.current = setTimeout(() => {
      quantityInputRef.current?.focus();
      editMaterialFocusTimerRef.current = null;
    }, 300);
  };

  // 确认编辑物料
  const handleConfirmEditMaterial = async () => {
    if (!editingMaterial) return;
    if (editingMaterial.isUnpacked) {
      showCustomAlert(
        '拆包物料不可直接修改',
        '请关闭弹窗并回到扫码出库重新处理。',
        [{ text: '确定' }],
        'warning'
      );
      return;
    }

    // 验证数量
    const newQty = parseQuantity(editMaterialData.quantity);
    const originalQty = parseQuantity(
      editingMaterial.original_quantity || (editingMaterial.quantity || 0).toString(),
      { min: 0 }
    );

    if (newQty === null) {
      showCustomAlert(
        '错误',
        '请输入有效的数量',
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
      return;
    }

    if (originalQty !== null && newQty > originalQty) {
      showCustomAlert(
        '错误',
        `数量不能大于原始扫描数量（${originalQty}个）`,
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
      return;
    }

    let shouldNavigateToOutbound = false;
    setSavingMaterial(true);
    try {
      // 只更新数量字段，其他字段不可修改
      await updateMaterial(editingMaterial.id!, {
        quantity: newQty,
      });

      // 刷新物料列表（短暂延迟确保 AsyncStorage 写入完成）
      if (!(await waitForUiFlush())) {
        return;
      }
      const materials = await getMaterialsByOrder(editingMaterial.order_no, currentWarehouse?.id);
      setExpandedMaterials(materials);
      await loadData();

      setEditMaterialModalVisible(false);
      shouldNavigateToOutbound = true;
    } catch (error) {
      logger.error('更新物料失败:', error);
      showCustomAlert(
        '错误',
        '更新失败，请稍后重试',
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
    } finally {
      setSavingMaterial(false);
    }

    if (shouldNavigateToOutbound) {
      router.replace('/outbound');
    }
  };

  const renderMaterialRow = (material: MaterialRecord) => (
      <View key={material.id} style={styles.materialItem}>
        <TouchableOpacity
          style={styles.materialMainInfo}
          activeOpacity={0.7}
          onPress={() => handleViewMaterial(material)}
          onLongPress={() => handleDeleteMaterial(material)}
        >
          <Text style={styles.materialModel} numberOfLines={1}>
            {material.model || '未知型号'}
          </Text>
          <Text style={styles.materialDetails}>批次: {material.batch || '-'}</Text>
          <Text style={styles.materialDetails}>数量: {material.quantity || 0}</Text>
          <Text style={styles.materialDate}>{formatDate(material.scanned_at)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.unpackBtn, { backgroundColor: theme.backgroundTertiary }]}
          activeOpacity={0.7}
          onPress={() => handleOpenEditMaterial(material)}
        >
          <Feather name="edit-2" size={14} color={theme.textPrimary} />
          <Text style={[styles.unpackBtnText, { color: theme.textPrimary }]}>编辑</Text>
        </TouchableOpacity>
      </View>
  );

  const renderOrderItem = ({ item: order }: { item: Order }) => (
      <View>
        <AnimatedCard
          onPress={() => handleToggleOrder(order)}
          onLongPress={() => handleDeleteOrder(order)}
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
                    {order.customer_name}
                  </Text>
                ) : (
                  <Text style={styles.noCustomer} numberOfLines={1}>
                    点击设置客户名称
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.editBtn}
                activeOpacity={0.7}
                onPress={() => handleEditCustomer(order)}
              >
                <Feather
                  name={order.customer_name ? 'edit-2' : 'plus'}
                  size={16}
                  color={theme.primary}
                />
                <Text style={styles.editBtnText}>{order.customer_name ? '编辑' : '设置'}</Text>
              </TouchableOpacity>
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
        <AnimatedCard onLongPress={() => handleDeleteOrder(currentOrder)}>
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
                    {currentOrder.customer_name}
                  </Text>
                ) : (
                  <Text style={styles.noCustomer} numberOfLines={1}>
                    点击设置客户名称
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.editBtn}
                activeOpacity={0.7}
                onPress={() => handleEditCustomer(currentOrder)}
              >
                <Feather
                  name={currentOrder.customer_name ? 'edit-2' : 'plus'}
                  size={16}
                  color={theme.primary}
                />
                <Text style={styles.editBtnText}>
                  {currentOrder.customer_name ? '编辑' : '设置'}
                </Text>
              </TouchableOpacity>
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

  const isLongCustomAlert =
    customAlert.message.length > 48 ||
    customAlert.message.includes('\n') ||
    customAlert.buttons.length > 1;

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
            <Text style={styles.subtitle}>展开订单查看物料，长按可删除，按需编辑数量</Text>
          </View>
          <TouchableOpacity
            style={styles.headerActionButton}
            activeOpacity={0.7}
            onPress={() => router.push('/outbound')}
          >
            <Feather name="plus" size={20} color={theme.buttonPrimaryText} />
          </TouchableOpacity>
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
                  : '点击展开查看物料，长按删除订单'}
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

      {/* 编辑客户名称弹窗 */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCustomerModal}
        hardwareAccelerated
      >
        <View style={styles.modalOverlay}>
          <KeyboardAwareModalContainer extraScrollHeight={12}>
            <AppModalCard
              title={editingOrder?.customer_name ? '编辑客户名称' : '设置客户名称'}
              subtitle="留空可清空"
              onClose={closeCustomerModal}
              style={styles.customerModalContent}
              bodyStyle={styles.customerModalBody}
              size="compact"
              stretchBody
              footer={
                <AppModalActions
                  containerStyle={styles.modalActions}
                  secondaryLabel="取消"
                  onSecondaryPress={closeCustomerModal}
                  primaryLabel="保存"
                  onPrimaryPress={handleSaveCustomer}
                />
              }
            >
              <AppFormField label="客户名称">
                <TextInput
                  ref={customerNameInputRef}
                  style={styles.unpackTextInput}
                  placeholder="输入客户名称"
                  placeholderTextColor={theme.textMuted}
                  value={editCustomerName}
                  onChangeText={setEditCustomerName}
                  maxLength={40}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    void handleSaveCustomer();
                  }}
                />
              </AppFormField>
            </AppModalCard>
          </KeyboardAwareModalContainer>
        </View>
      </Modal>

      {/* 编辑物料弹窗 */}
      <Modal
        visible={editMaterialModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditMaterialModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title="编辑物料"
            subtitle="仅可修改数量"
            onClose={() => setEditMaterialModalVisible(false)}
            style={styles.unpackModalContent}
            bodyStyle={styles.modalBody}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={() => setEditMaterialModalVisible(false)}
                primaryLabel={savingMaterial ? '保存中...' : '保存'}
                primaryDisabled={savingMaterial}
                onPrimaryPress={handleConfirmEditMaterial}
              />
            }
          >
            <KeyboardAwareFormScrollView bottomOffset={16} extraScrollHeight={8}>
              {/* 型号（只读） */}
              <AppFormField label="型号">
                <View style={[styles.unpackTextInput, styles.editReadOnlyInput]}>
                  <Text style={styles.editReadOnlyText}>
                    {editMaterialData.model || '-'}
                  </Text>
                </View>
              </AppFormField>

              {/* 批次（只读） */}
              <AppFormField label="批次">
                <View style={[styles.unpackTextInput, styles.editReadOnlyInput]}>
                  <Text style={styles.editReadOnlyText}>
                    {editMaterialData.batch || '-'}
                  </Text>
                </View>
              </AppFormField>

              {/* 数量（可修改） */}
              <AppFormField label="数量" required>
                <TextInput
                  ref={quantityInputRef}
                  style={styles.unpackTextInput}
                  placeholder={`最多 ${editingMaterial?.original_quantity || editingMaterial?.quantity || 0} 个`}
                  placeholderTextColor={theme.textMuted}
                  value={editMaterialData.quantity}
                  onChangeText={(text) => {
                    const numeric = text.replace(/\D/g, '');
                    setEditMaterialData((prev) => ({ ...prev, quantity: numeric }));
                  }}
                  keyboardType="number-pad"
                />
              </AppFormField>
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>

      {/* 自定义弹窗 */}
      <Modal
        visible={customAlert.visible}
        transparent
        animationType="fade"
        onRequestClose={closeCustomAlert}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: theme.overlay,
            justifyContent: 'center',
            alignItems: 'center',
            padding: Spacing.md,
          }}
        >
          <AppModalCard
            title={customAlert.title}
            onClose={closeCustomAlert}
            style={{
              width: '100%',
              maxWidth: APP_MODAL_MAX_WIDTH,
              maxHeight: isLongCustomAlert ? '78%' : undefined,
            }}
            size="auto"
            bodyStyle={{ alignItems: 'center', paddingBottom: Spacing.md }}
            footer={renderCustomAlertFooter()}
          >
            {/* 图标 */}
            {customAlert.icon && (
              <View
                style={{
                  width: isLongCustomAlert ? 56 : 64,
                  height: isLongCustomAlert ? 56 : 64,
                  borderRadius: BorderRadius['3xl'],
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: Spacing.md,
                  backgroundColor:
                    customAlert.icon === 'success'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : customAlert.icon === 'warning'
                        ? 'rgba(245, 158, 11, 0.12)'
                        : customAlert.icon === 'error'
                          ? 'rgba(239, 68, 68, 0.12)'
                          : 'rgba(59, 130, 246, 0.12)',
                  shadowColor:
                    customAlert.icon === 'success'
                      ? theme.success
                      : customAlert.icon === 'warning'
                        ? theme.warning
                        : customAlert.icon === 'error'
                          ? theme.error
                          : theme.info,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 14,
                  elevation: 4,
                }}
              >
                <View
                  style={{
                    width: isLongCustomAlert ? 38 : 44,
                    height: isLongCustomAlert ? 38 : 44,
                    borderRadius: BorderRadius.xl,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor:
                      customAlert.icon === 'success'
                        ? theme.success
                        : customAlert.icon === 'warning'
                          ? theme.warning
                          : customAlert.icon === 'error'
                            ? theme.error
                            : theme.info,
                  }}
                >
                  <FontAwesome6
                    name={
                      customAlert.icon === 'success'
                        ? 'check'
                        : customAlert.icon === 'warning'
                          ? 'triangle-exclamation'
                          : customAlert.icon === 'error'
                            ? 'xmark'
                            : 'info'
                    }
                    size={isLongCustomAlert ? 20 : 22}
                    color={theme.white}
                  />
                </View>
              </View>
            )}
            <ScrollView
              style={{
                alignSelf: 'stretch',
                maxHeight: isLongCustomAlert ? 132 : 72,
                marginBottom: Spacing.xs,
              }}
              contentContainerStyle={{ alignItems: 'center', paddingBottom: Spacing.md }}
              showsVerticalScrollIndicator={isLongCustomAlert}
            >
              <Text
                style={{
                  ...(isLongCustomAlert ? Typography.body : Typography.bodyMedium),
                  color: theme.textSecondary,
                  textAlign: 'center',
                  lineHeight: isLongCustomAlert ? 21 : 22,
                }}
              >
                {customAlert.message}
              </Text>
            </ScrollView>
          </AppModalCard>
        </View>
      </Modal>

      {/* 仓库选择器弹窗 */}
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
                onPress={() => handleWarehouseChange(wh)}
              >
                <Text style={styles.pickerItemText}>{wh.name}</Text>
                {currentWarehouse?.id === wh.id && (
                  <FontAwesome6 name="check" size={14} color={theme.primary} />
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
    </Screen>
  );
}
