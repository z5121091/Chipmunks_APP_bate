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
import * as XLSX from 'xlsx';
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
  getNextUnpackIndex,
  updateMaterial,
  saveUnpackOperation,
  Order,
  MaterialRecord,
  UnpackRecord,
  Warehouse,
  getAllWarehouses,
  getDefaultWarehouse,
} from '@/utils/database';
import {
  decodeBase64ToBytes,
  formatSyncErrorMessage,
  parseJsonResponse,
  toBinaryBody,
} from '@/utils/excel';
import { safeJsonParseNullable } from '@/utils/json';
import { STORAGE_KEYS, SyncConfig } from '@/constants/config';
import { formatDate, formatTime } from '@/utils/time';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Spacing, BorderRadius, BorderWidth, Typography } from '@/constants/theme';
import { rf } from '@/utils/responsive';
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

  const [orders, setOrders] = useState<Order[]>([]);
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

  // 拆包弹窗
  const [unpackModalVisible, setUnpackModalVisible] = useState(false);
  const [unpackingMaterial, setUnpackingMaterial] = useState<MaterialRecord | null>(null);
  const [unpackNewQuantity, setUnpackNewQuantity] = useState('');
  const [unpackNewTraceNo, setUnpackNewTraceNo] = useState('');
  const [unpackNotes, setUnpackNotes] = useState('');
  const [unpacking, setUnpacking] = useState(false);


  // 拆包数量输入框 ref
  const unpackQuantityRef = useRef<TextInput>(null);
  // 拆包备注输入框 ref
  const unpackNotesRef = useRef<TextInput>(null);
  const unpackFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拆包弹窗打开后聚焦输入框
  useEffect(() => {
    if (unpackModalVisible && unpackQuantityRef.current) {
      unpackFocusTimerRef.current = setTimeout(() => {
        unpackQuantityRef.current?.focus();
        unpackFocusTimerRef.current = null;
      }, 300);
    }

    return () => {
      if (unpackFocusTimerRef.current) {
        clearTimeout(unpackFocusTimerRef.current);
        unpackFocusTimerRef.current = null;
      }
    };
  }, [unpackModalVisible]);

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

  // 同步配置
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({ ip: '', port: '8080' });
  // 加载同步配置
  const loadSyncConfig = useCallback(async () => {
    const savedSyncConfig = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
    if (savedSyncConfig) {
      const parsedConfig = safeJsonParseNullable<SyncConfig>(savedSyncConfig, 'orders.syncConfig');
      if (parsedConfig) {
        setSyncConfig(parsedConfig);
      }
    }
  }, []);

  // 页面加载时获取同步配置
  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      loadSyncConfig();

      return () => {
        screenActiveRef.current = false;
        clearDeferredActionTimers();
        expandedMaterialsRequestRef.current += 1;
        clearExpandedMaterialsTimer();
      };
    }, [clearDeferredActionTimers, clearExpandedMaterialsTimer, loadSyncConfig])
  );

  // 拆包弹窗样式
  const unpackModalStyles = useMemo(
    () => ({
      modalOverlay: {
        flex: 1,
        backgroundColor: theme.overlay,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        padding: Spacing.md,
      },
      modalContent: {
        width: '100%' as const,
        maxWidth: APP_MODAL_MAX_WIDTH,
        maxHeight: '82%' as const,
      },
      modalBody: {
        paddingBottom: 0,
      },
      modalBodyContent: {
        paddingBottom: Spacing['2xl'],
      },
      modalActions: {
        marginTop: 0,
      },
      sectionTitle: {
        fontSize: rf(14),
        fontWeight: '500' as const,
        color: theme.textPrimary,
        marginBottom: Spacing.sm,
      },
      textInput: {
        fontSize: rf(16),
        color: theme.textPrimary,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        minHeight: 48,
        backgroundColor: theme.backgroundTertiary,
        borderRadius: BorderRadius.md,
        borderWidth: BorderWidth.normal,
        borderColor: theme.border,
      },
      infoBox: {
        backgroundColor: theme.backgroundTertiary,
        borderRadius: BorderRadius.md,
        padding: Spacing.lg,
        marginBottom: Spacing.lg,
      },
      infoRow: {
        flexDirection: 'row' as const,
        marginBottom: Spacing.sm,
      },
      infoLabel: {
        width: 60,
        fontSize: rf(13),
        color: theme.textSecondary,
      },
      infoValue: {
        flex: 1,
        fontSize: rf(14),
        color: theme.textPrimary,
        fontWeight: '500' as const,
      },
    }),
    [theme]
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

      setOrders(allOrdersForWarehouse);
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
    }
  }, [clearExpandedMaterialsTimer, currentWarehouse?.id, loadCurrentOrder]);

  // 处理从扫描页面跳转过来的参数（自动展开订单）
  useEffect(() => {
    if (params.orderNo && orders.length > 0) {
      // 找到对应的订单
      const targetOrder = orders.find((o) => o.order_no === params.orderNo);
      if (targetOrder && targetOrder.id !== expandedOrderId) {
        // 展开该订单
        setExpandedOrderId(targetOrder.id);
        setExpandedMaterials([]);
        void loadExpandedMaterials(targetOrder, {
          warehouseId: currentWarehouse?.id,
          delay: 120,
        });
      }
    }
  }, [currentWarehouse?.id, expandedOrderId, loadExpandedMaterials, orders, params.orderNo]);

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
    showCustomAlert(
      '确认删除',
      `确定要删除这条物料记录吗？`,
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

  // 打开拆包弹窗
  const handleOpenUnpack = async (material: MaterialRecord) => {
    setUnpackingMaterial(material);
    setUnpackNewQuantity('');
    setUnpackNotes('');

    // 获取拆包历史和下一个序号
    try {
      setUnpackNewTraceNo(await buildNextUnpackTraceNo(material.traceNo));
    } catch (error) {
      logger.error('获取拆包信息失败:', error);
      setUnpackNewTraceNo('');
    }

    setUnpackModalVisible(true);
  };

  const buildNextUnpackTraceNo = async (traceNo?: string | null) => {
    const baseTraceNo = traceNo ? traceNo.replace(/-\d+$/, '') : '';
    if (!baseTraceNo) {
      return '';
    }

    const nextIndex = await getNextUnpackIndex(traceNo || '');
    return `${baseTraceNo}-${nextIndex}`;
  };

  // 确认拆包
  const handleConfirmUnpack = async () => {
    if (!unpackingMaterial) return;

    const newQty = parseQuantity(unpackNewQuantity);
    if (!unpackNewQuantity.trim() || newQty === null) {
      showCustomAlert(
        '错误',
        '请输入有效的拆出数量',
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
      return;
    }

    // 使用剩余数量作为当前可用数量（已拆包物料使用 remaining_quantity，新物料使用 quantity）
    const availableQty = parseQuantity(
      unpackingMaterial.remaining_quantity || (unpackingMaterial.quantity || 0).toString(),
      { min: 0 }
    );
    if (availableQty !== null && newQty > availableQty) {
      showCustomAlert(
        '错误',
        `拆出数量不能大于当前数量（${availableQty}个）`,
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
      return;
    }

    const remainingQty = (availableQty ?? 0) - newQty;

    setUnpacking(true);
    try {
      const resolvedNewTraceNo =
        (await buildNextUnpackTraceNo(unpackingMaterial.traceNo)) || unpackNewTraceNo.trim();
      setUnpackNewTraceNo(resolvedNewTraceNo);

      const unpackResult = await saveUnpackOperation({
        material: unpackingMaterial,
        shippedQuantity: newQty,
        remainingQuantity: remainingQty,
        newTraceNo: resolvedNewTraceNo,
        notes: unpackNotes,
      });

      // 2. 刷新物料列表（短暂延迟确保 AsyncStorage 写入完成）
      if (!(await waitForUiFlush())) {
        return;
      }
      const materials = await getMaterialsByOrder(unpackingMaterial.order_no, currentWarehouse?.id);
      setExpandedMaterials(materials);
      await loadData();

      setUnpackModalVisible(false);

      showCustomAlert(
        '拆包成功',
        `已生成 2 条标签：\n• 发货标签：${resolvedNewTraceNo || '-'}（${newQty}个）\n• 剩余标签：${resolvedNewTraceNo || '-'}（${remainingQty}个）`,
        [
          { text: '完成', style: 'cancel' },
          {
            text: '同步到电脑',
            onPress: async () => {
              handleSyncUnpackToComputer(unpackResult.shippedRecord, unpackResult.remainingRecord);
            },
          },
        ],
        'success'
      );
    } catch (error) {
      logger.error('拆包失败:', error);
      const message = error instanceof Error && error.message
        ? error.message
        : '拆包失败，请稍后重试';
      showCustomAlert(
        '错误',
        message,
        [{ text: '确定', style: 'destructive' }],
        'error'
      );
    } finally {
      setUnpacking(false);
    }
  };

  // 同步单次拆包数据到电脑
  const handleSyncUnpackToComputer = async (
    shippedRecord: UnpackRecord,
    remainingRecord: UnpackRecord
  ) => {
    if (!syncConfig.ip) {
      showCustomAlert('提示', '请先在设置页面配置电脑IP地址', [{ text: '确定' }], 'warning');
      return;
    }

    try {
      // 定义表头（与设置页同步标签数据格式保持一致，确保BarTender能正确识别）
      const headers = [
        '仓库名称',
        '标签类型',
        '订单号',
        '客户',
        '型号',
        '存货编码',
        '批次',
        '封装',
        '版本',
        '原数量',
        '标签数量',
        '生产日期',
        '追踪码',
        '箱号',
        '拆包时间',
        '备注',
      ];

      // 构建数据行（发货标签和剩余标签）
      const rows = [
        [
          shippedRecord.warehouse_name || '',
          '发货标签',
          shippedRecord.order_no || '',
          shippedRecord.customer_name || '',
          shippedRecord.model || '',
          shippedRecord.inventory_code || '',
          shippedRecord.batch || '',
          shippedRecord.package || '',
          shippedRecord.version || '',
          parseQuantity(shippedRecord.original_quantity, { min: 0 }) ?? 0,
          parseQuantity(shippedRecord.new_quantity, { min: 0 }) ?? 0,
          shippedRecord.productionDate || '',
          shippedRecord.new_traceNo || shippedRecord.traceNo || '',
          shippedRecord.sourceNo || '',
          formatTime(shippedRecord.unpacked_at),
          shippedRecord.notes || '',
        ],
        [
          remainingRecord.warehouse_name || '',
          '剩余标签',
          remainingRecord.order_no || '',
          remainingRecord.customer_name || '',
          remainingRecord.model || '',
          remainingRecord.inventory_code || '',
          remainingRecord.batch || '',
          remainingRecord.package || '',
          remainingRecord.version || '',
          parseQuantity(remainingRecord.original_quantity, { min: 0 }) ?? 0,
          parseQuantity(remainingRecord.new_quantity, { min: 0 }) ?? 0,
          remainingRecord.productionDate || '',
          remainingRecord.new_traceNo || remainingRecord.traceNo || '',
          remainingRecord.sourceNo || '',
          formatTime(remainingRecord.unpacked_at),
          remainingRecord.notes || '',
        ],
      ];

      // 创建Excel
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

      // 计算列宽
      const colWidths = headers.map((header, colIdx) => {
        let maxWidth = header.length;
        rows.forEach((row) => {
          const cellValue = String(row[colIdx] || '');
          const width = cellValue.split('').reduce((acc, char) => {
            return acc + (char.charCodeAt(0) > 127 ? 2 : 1);
          }, 0);
          if (width > maxWidth) maxWidth = width;
        });
        return { wch: Math.min(maxWidth + 2, 50) };
      });
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '标签数据');
      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const bytes = decodeBase64ToBytes(wbout);
      const body = toBinaryBody(bytes);

      // 发送到电脑（添加订单号作为name_suffix，与设置页同步格式保持一致）
      const baseUrl = `http://${syncConfig.ip}:${syncConfig.port || '8080'}/labels`;
      const nameSuffix = shippedRecord.order_no || '拆包标签';
      const url = `${baseUrl}?name_suffix=${encodeURIComponent(nameSuffix)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text();
        logger.error('服务器响应错误:', response.status, errorText);
        throw new Error(`服务器错误 (${response.status})`);
      }

      // 尝试解析JSON响应
      const result = await parseJsonResponse<{
        success?: boolean;
        message?: string;
        fileName?: string;
      }>(response, '服务器返回格式错误，请检查同步服务是否正常运行');

      if (result.success) {
        showCustomAlert(
          '同步成功',
          '已同步 2 条标签到电脑',
          [{ text: '确定' }],
          'success'
        );
      } else {
        showCustomAlert(
          '同步失败',
          formatSyncErrorMessage(result.message, '未知错误'),
          [{ text: '确定', style: 'destructive' }],
          'error'
        );
      }
    } catch (error: any) {
      logger.error('同步失败:', error);
      const errorMsg =
        error.name === 'AbortError'
          ? '连接超时，请检查网络'
          : error.message?.includes('服务器')
            ? error.message
            : `同步失败：${formatSyncErrorMessage(error.message, '请检查网络和同步服务')}`;
      showCustomAlert('同步失败', errorMsg, [{ text: '确定', style: 'destructive' }], 'error');
    }
  };

  // 打开编辑物料弹窗
  const handleOpenEditMaterial = (material: MaterialRecord) => {
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
      showCustomAlert('成功', '物料数量已更新', [{ text: '确定' }], 'success');
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
  };

  const renderMaterialRow = useCallback(
    (material: MaterialRecord) => (
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

        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <TouchableOpacity
            style={[styles.unpackBtn, { backgroundColor: theme.backgroundTertiary }]}
            activeOpacity={0.7}
            onPress={() => handleOpenEditMaterial(material)}
          >
            <Feather name="edit-2" size={14} color={theme.textPrimary} />
            <Text style={[styles.unpackBtnText, { color: theme.textPrimary }]}>编辑</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.unpackBtn}
            activeOpacity={0.7}
            onPress={() => handleOpenUnpack(material)}
          >
            <Feather name="scissors" size={14} color={theme.primary} />
            <Text style={styles.unpackBtnText}>拆包</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [
      handleDeleteMaterial,
      handleOpenEditMaterial,
      handleOpenUnpack,
      handleViewMaterial,
      styles,
      theme.backgroundTertiary,
      theme.primary,
      theme.textPrimary,
    ]
  );

  const renderOrderItem = useCallback(
    ({ item: order }: { item: Order }) => (
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
    ),
    [
      expandedMaterials,
      expandedMaterialsLoadingId,
      expandedOrderId,
      handleDeleteOrder,
      handleEditCustomer,
      handleToggleOrder,
      renderMaterialRow,
      styles,
      theme.textSecondary,
    ]
  );

  const renderCurrentOrderCard = useCallback(() => {
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
  }, [currentOrder, handleDeleteOrder, handleEditCustomer, styles, theme.primary, theme.textSecondary]);

  const renderCurrentMaterialItem = useCallback(
    ({ item }: { item: MaterialRecord }) => renderMaterialRow(item),
    [renderMaterialRow]
  );

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
            <Text style={styles.subtitle}>展开订单查看物料，按需拆包</Text>
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
        <View style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
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
                  name="file-alt"
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
        <View style={unpackModalStyles.modalOverlay}>
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
                  containerStyle={unpackModalStyles.modalActions}
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
                  style={unpackModalStyles.textInput}
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

      {/* 拆包弹窗 */}
      <Modal
        visible={unpackModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUnpackModalVisible(false)}
      >
        <View style={unpackModalStyles.modalOverlay}>
          <AppModalCard
            title="拆包打印"
            subtitle="填写拆出数量并生成拆包标签"
            onClose={() => setUnpackModalVisible(false)}
            style={unpackModalStyles.modalContent}
            bodyStyle={unpackModalStyles.modalBody}
            size="largeForm"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={unpackModalStyles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={() => setUnpackModalVisible(false)}
                primaryLabel={unpacking ? '处理中...' : '确认拆包'}
                primaryDisabled={unpacking}
                onPrimaryPress={handleConfirmUnpack}
              />
            }
          >
            <KeyboardAwareFormScrollView
              contentContainerStyle={unpackModalStyles.modalBodyContent}
              bottomOffset={32}
              showsVerticalScrollIndicator={true}
            >
              <AppFormField label="型号">
                <View style={[unpackModalStyles.textInput, { justifyContent: 'center' }]}>
                  <Text style={{ fontSize: rf(15), color: theme.textSecondary }}>
                    {unpackingMaterial?.model || '-'}
                  </Text>
                </View>
              </AppFormField>

              <AppFormField label="批次">
                <View style={[unpackModalStyles.textInput, { justifyContent: 'center' }]}>
                  <Text style={{ fontSize: rf(15), color: theme.textSecondary }}>
                    {unpackingMaterial?.batch || '-'}
                  </Text>
                </View>
              </AppFormField>

              <AppFormField label="当前可拆数量">
                <View style={[unpackModalStyles.textInput, { justifyContent: 'center' }]}>
                  <Text style={{ fontSize: rf(15), fontWeight: '700', color: theme.primary }}>
                    {unpackingMaterial?.remaining_quantity ||
                      (unpackingMaterial?.quantity || 0).toString()}
                  </Text>
                </View>
              </AppFormField>

              {/* 新追踪码（自动生成） */}
              <AppFormField label="新追踪码（自动生成）">
                <View style={[unpackModalStyles.textInput, { justifyContent: 'center' }]}>
                  <Text style={{ fontSize: rf(16), fontWeight: '600', color: theme.primary }}>
                    {unpackNewTraceNo || '-'}
                  </Text>
                </View>
              </AppFormField>

              {/* 拆出数量 */}
              <AppFormField
                label="拆出数量"
                required
                hint={`可拆 ${
                  unpackingMaterial?.remaining_quantity ||
                  (unpackingMaterial?.quantity || 0).toString()
                } 个`}
              >
                <TextInput
                  ref={unpackQuantityRef}
                  style={unpackModalStyles.textInput}
                  placeholder="输入要拆出的数量"
                  placeholderTextColor={theme.textMuted}
                  value={unpackNewQuantity}
                  onChangeText={(text) => {
                    const numeric = text.replace(/[^0-9]/g, '');
                    setUnpackNewQuantity(numeric);
                  }}
                  keyboardType="number-pad"
                />
              </AppFormField>

              {/* 剩余数量预览 */}
              {unpackNewQuantity && parseQuantity(unpackNewQuantity) !== null && (
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.md,
                    marginTop: Spacing.sm,
                  }}
                >
                  <Text style={{ fontSize: rf(14), color: theme.textSecondary }}>剩余标签数量</Text>
                  <Text style={{ fontSize: rf(16), fontWeight: '600', color: theme.textPrimary }}>
                    {Math.max(
                      0,
                      (parseQuantity(
                        String(
                          unpackingMaterial?.remaining_quantity ||
                            unpackingMaterial?.quantity ||
                            '0'
                        ),
                        { min: 0 }
                      ) ?? 0) - (parseQuantity(unpackNewQuantity) ?? 0)
                    )}{' '}
                    个
                  </Text>
                </View>
              )}

              {/* 备注 */}
              <AppFormField label="备注">
                <TextInput
                  ref={unpackNotesRef}
                  style={[
                    unpackModalStyles.textInput,
                    { minHeight: 88, textAlignVertical: 'top' },
                  ]}
                  placeholder="添加备注信息"
                  placeholderTextColor={theme.textMuted}
                  value={unpackNotes}
                  onChangeText={setUnpackNotes}
                  multiline
                />
              </AppFormField>
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>

      {/* 编辑物料弹窗 */}
      <Modal
        visible={editMaterialModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditMaterialModalVisible(false)}
      >
        <View style={unpackModalStyles.modalOverlay}>
          <AppModalCard
            title="编辑物料"
            subtitle="仅可修改数量"
            onClose={() => setEditMaterialModalVisible(false)}
            style={unpackModalStyles.modalContent}
            bodyStyle={unpackModalStyles.modalBody}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={unpackModalStyles.modalActions}
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
                <View
                  style={[
                    unpackModalStyles.textInput,
                    {
                      justifyContent: 'center',
                      backgroundColor: theme.backgroundTertiary,
                      opacity: 0.7,
                    },
                  ]}
                >
                  <Text style={{ fontSize: rf(16), color: theme.textSecondary }}>
                    {editMaterialData.model || '-'}
                  </Text>
                </View>
              </AppFormField>

              {/* 批次（只读） */}
              <AppFormField label="批次">
                <View
                  style={[
                    unpackModalStyles.textInput,
                    {
                      justifyContent: 'center',
                      backgroundColor: theme.backgroundTertiary,
                      opacity: 0.7,
                    },
                  ]}
                >
                  <Text style={{ fontSize: rf(16), color: theme.textSecondary }}>
                    {editMaterialData.batch || '-'}
                  </Text>
                </View>
              </AppFormField>

              {/* 数量（可修改） */}
              <AppFormField label="数量" required>
                <TextInput
                  ref={quantityInputRef}
                  style={unpackModalStyles.textInput}
                  placeholder={`最多 ${editingMaterial?.original_quantity || editingMaterial?.quantity || 0} 个`}
                  placeholderTextColor={theme.textMuted}
                  value={editMaterialData.quantity}
                  onChangeText={(text) => {
                    const numeric = text.replace(/[^0-9]/g, '');
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
