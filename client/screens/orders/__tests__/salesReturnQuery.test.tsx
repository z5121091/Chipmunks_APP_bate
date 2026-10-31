import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OrdersScreen from '../index';
import { getQueryOrder, getQueryMaterialsByOrder, getQueryFilteredOrders, type MaterialRecord } from '@/utils/database';
import { STORAGE_KEYS } from '@/constants/config';

const mockPush = jest.fn();
const mockParams: { orderNo?: string } = {};
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({
  useSafeRouter: () => ({ back: jest.fn(), push: mockPush }), useSafeSearchParams: () => mockParams,
}));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AnimatedCard', () => ({ AnimatedCard: 'Card' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/database', () => {
  const warehouse = { id: 'W1', name: '仓库' };
  return {
    getQueryOrder: jest.fn(), getQueryMaterialsByOrder: jest.fn(), getQueryFilteredOrders: jest.fn(),
    getAllWarehouses: jest.fn(async () => [warehouse, { id: 'W2', name: '仓库二' }]), getDefaultWarehouse: jest.fn(async () => warehouse),
  };
});

const makeOrder = (warehouseId: string, suffix: string) => ({
  id: `order-${suffix}`, order_no: `ORDER-${suffix}`, customer_name: `客户${suffix}`,
  created_at: '2026/10/15 10:00', warehouse_id: warehouseId,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const pressText = async (root: TestRenderer.ReactTestRenderer, text: string) => {
  const node = root.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(label => label.props.children === text));
  if (!node) throw new Error(`Missing button: ${text}`);
  await act(async () => { node.props.onPress(); });
};

it('ignores a late warehouse A response after warehouse B has already loaded', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await AsyncStorage.clear();
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, 'ACTIVE');
  const lateOrder = deferred<ReturnType<typeof makeOrder>>();
  const lateMaterials = deferred<MaterialRecord[]>();
  const lateList = deferred<ReturnType<typeof makeOrder>[]>();
  const orderA = makeOrder('W1', 'A');
  const orderB = makeOrder('W2', 'B');
  const materialB = { id: 'B', model: 'MODEL-B', quantity: 2, order_no: 'ACTIVE', warehouse_id: 'W2' } as MaterialRecord;
  jest.mocked(getQueryOrder).mockImplementation(async (_code, warehouseId) => warehouseId === 'W1' ? lateOrder.promise : orderB);
  jest.mocked(getQueryMaterialsByOrder).mockImplementation(async (_code, warehouseId) => warehouseId === 'W1' ? lateMaterials.promise : [materialB]);
  jest.mocked(getQueryFilteredOrders).mockImplementation(async options => options?.warehouseId === 'W1' ? lateList.promise : [orderB]);
  let root!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
    await pressText(root, '仓库');
    await pressText(root, '仓库二');
    expect(root.root.findByType(FlatList).props.data).toEqual([materialB]);
    await act(async () => { lateOrder.resolve(orderA); lateMaterials.resolve([]); lateList.resolve([orderA]); });
    expect(root.root.findByType(FlatList).props.data).toEqual([materialB]);
    await pressText(root, '全部');
    await act(async () => { await jest.advanceTimersByTimeAsync(250); });
    expect(root.root.findByType(FlatList).props.data).toEqual([orderB]);
  } finally {
    if (root) await act(async () => { root.unmount(); });
    jest.useRealTimers();
  }
});

it('viewing historical B preserves the active outbound order A and its draft after leaving', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await AsyncStorage.clear();
  const activeDraft = JSON.stringify({ orderNo: 'ACTIVE-A', warehouseId: 'W1', marker: 'keep' });
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, 'ACTIVE-A');
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT, activeDraft);
  mockParams.orderNo = 'HISTORY-B';
  const historical = makeOrder('W1', 'HISTORY-B');
  jest.mocked(getQueryOrder).mockResolvedValue(historical);
  jest.mocked(getQueryMaterialsByOrder).mockResolvedValue([]);
  jest.mocked(getQueryFilteredOrders).mockResolvedValue([historical]);
  let root!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
    expect(getQueryOrder).toHaveBeenCalledWith('HISTORY-B', 'W1');
    await act(async () => { root.unmount(); });
    expect(await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO)).toBe('ACTIVE-A');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT)).toBe(activeDraft);
  } finally {
    delete mockParams.orderNo;
  }
});

it('queries independent returns as positive received records and opens their own detail id', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await AsyncStorage.clear();
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_NO, 'RETURN-1');
  const record: MaterialRecord = {
    id: 'return-record-1', order_no: 'RETURN-1', customer_name: '客户 B', operation_type: 'sales_return',
    model: 'MODEL-1', batch: 'LOT-1', quantity: 80, package: '', version: '', productionDate: '',
    traceNo: 'TRACE-1', sourceNo: '', scanned_at: '2026/10/13 10:00', raw_content: '', warehouse_id: 'W1',
  };
  const order = { id: 'return-order-1', order_no: record.order_no, customer_name: record.customer_name,
    created_at: record.scanned_at, warehouse_id: 'W1', operation_type: 'sales_return' as const };
  jest.mocked(getQueryOrder).mockResolvedValue(order);
  jest.mocked(getQueryMaterialsByOrder).mockResolvedValue([record]);
  jest.mocked(getQueryFilteredOrders).mockResolvedValue([order]);
  let root!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(getQueryOrder).toHaveBeenCalledWith('RETURN-1', 'W1');
    expect(getQueryMaterialsByOrder).toHaveBeenCalledWith('RETURN-1', 'W1');
    expect(getQueryFilteredOrders).toHaveBeenCalled();
    expect(root.root.findAllByType(Text).map(node => node.props.children).flat().join(''))
      .toContain('销售退货 · 客户 B');
    const list = root.root.findByType(FlatList);
    expect(list.props.data).toEqual([record]);
    let row!: TestRenderer.ReactTestRenderer;
    await act(async () => { row = TestRenderer.create(list.props.renderItem({ item: record })); });
    try {
      expect(row.root.findAllByType(Text).map(node => node.props.children).flat().join('')).toContain('实收数量: 80');
      await act(async () => { row.root.findByType(TouchableOpacity).props.onPress(); });
      expect(mockPush).toHaveBeenCalledWith('/detail', { id: 'return-record-1' });
    } finally {
      await act(async () => { row.unmount(); });
    }
  } finally {
    if (root) await act(async () => { root.unmount(); });
    jest.useRealTimers();
  }
});
