import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList, Text, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OrdersScreen from '../index';
import InboundRecordsScreen from '@/screens/inbound-records';
import InventoryRecordsScreen from '@/screens/inventory-records';
import { getQueryFilteredOrders, getQueryMaterialsByOrder, getQueryOrder, type Order, type MaterialRecord } from '@/utils/database';

type FocusEntry = { callback: () => void | (() => void); cleanup?: () => void };
const mockFocusEntries = new Set<FocusEntry>();
let mockFocused = true;
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockParams: { orderNo?: string } = {};
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: FocusEntry['callback']) => require('react').useEffect(() => {
    const entry: FocusEntry = { callback };
    mockFocusEntries.add(entry);
    if (mockFocused) entry.cleanup = callback() || undefined;
    return () => { entry.cleanup?.(); mockFocusEntries.delete(entry); };
  }, [callback]),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/useSafeRouter', () => ({
  useSafeRouter: () => ({ back: mockBack, push: mockPush }), useSafeSearchParams: () => mockParams,
}));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/screens/inbound-records/styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/screens/inventory-records/styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AnimatedCard', () => ({ AnimatedCard: 'Card' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppPillToast', () => ({ AppPillToast: 'Notice' }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => ({ showConfirm: jest.fn(), AlertComponent: null }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/feedback', () => ({ feedbackDeleted: jest.fn(async () => undefined) }));
jest.mock('@/utils/excel', () => ({ formatSyncErrorMessage: jest.fn(), syncExcelToComputer: jest.fn() }));
jest.mock('@/utils/inboundExport', () => ({ buildInboundExportFileNameFromNo: jest.fn(), buildInboundSheets: jest.fn() }));
jest.mock('@/utils/inventoryExport', () => ({ buildInventoryExportFileNameFromNo: jest.fn(), buildInventorySheets: jest.fn() }));
jest.mock('@/utils/erpAccounts', () => ({ ERP_ACCOUNTS: [
  { key: 'shanghai-chipmunk', name: '账套 A' }, { key: 'wuxi-duneng', name: '账套 B' },
] }));
jest.mock('@/utils/database', () => {
  const warehouse = { id: 'W1', name: '仓库 A' };
  return {
    getQueryOrder: jest.fn(), getQueryMaterialsByOrder: jest.fn(), getQueryFilteredOrders: jest.fn(),
    getAllWarehouses: jest.fn(async () => [warehouse, { id: 'W2', name: '仓库 B' }]),
    getDefaultWarehouse: jest.fn(async () => warehouse),
    getInboundDocumentSummaries: jest.fn(async () => []), getInventoryCheckDocumentSummaries: jest.fn(async () => []),
    getInboundRecordsByNo: jest.fn(async () => []), getInventoryCheckRecordsByNo: jest.fn(async () => []),
    deleteInboundDocument: jest.fn(), deleteInboundRecord: jest.fn(),
    deleteInventoryCheckDocument: jest.fn(), deleteInventoryCheckRecord: jest.fn(),
    updateInboundDocumentSyncStatus: jest.fn(), updateInventoryCheckDocumentSyncStatus: jest.fn(),
  };
});

const order = { id: 'order-A', order_no: 'ORDER-A', customer_name: '客户 A',
  created_at: '2026/10/18 10:00', warehouse_id: 'W1' } as Order;
const material = { id: 'material-A', order_no: 'ORDER-A', model: 'MODEL-A', batch: 'LOT-A', quantity: 5,
  scanned_at: '2026/10/18 10:00', warehouse_id: 'W1' } as MaterialRecord;
const textContent = (root: TestRenderer.ReactTestRenderer) => root.root.findAllByType(Text)
  .map(node => node.props.children).flat().join('');
const pressText = async (root: TestRenderer.ReactTestRenderer, text: string) => {
  const button = root.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(label => label.props.children === text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.props.onPress(); });
};
const changeFocus = async (focused: boolean) => {
  await act(async () => {
    mockFocused = focused;
    for (const entry of mockFocusEntries) {
      if (focused) entry.cleanup = entry.callback() || undefined;
      else { entry.cleanup?.(); entry.cleanup = undefined; }
    }
  });
};
const handlers = new Set<() => boolean | null | undefined>();
const pressHardwareBack = async () => {
  await act(async () => {
    const handled = Array.from(handlers).reverse().some(handler => handler());
    if (!handled) mockBack();
  });
};

let root: TestRenderer.ReactTestRenderer | undefined;
beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.clearAllMocks();
  handlers.clear();
  mockFocusEntries.clear();
  mockFocused = true;
  delete mockParams.orderNo;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await AsyncStorage.clear();
  jest.mocked(getQueryOrder).mockResolvedValue(order);
  jest.mocked(getQueryFilteredOrders).mockResolvedValue([order]);
  jest.mocked(getQueryMaterialsByOrder).mockResolvedValue([material]);
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.add(handler);
    return { remove: () => handlers.delete(handler) };
  });
});
afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe.each([
  { name: 'orders', Screen: OrdersScreen, open: '仓库 A', title: '选择仓库' },
  { name: 'inbound records', Screen: InboundRecordsScreen, open: '全部仓库', title: '选择仓库' },
  { name: 'inventory records', Screen: InventoryRecordsScreen, open: '全部账套', title: '选择账套' },
])('$name back navigation', variant => {
  it('closes the picker on the first back and leaves the page only on the second back', async () => {
    await act(async () => { root = TestRenderer.create(<variant.Screen />); });
    await pressText(root!, variant.open);
    expect(textContent(root!)).toContain(variant.title);
    await pressHardwareBack();
    expect(textContent(root!)).not.toContain(variant.title);
    expect(mockBack).not.toHaveBeenCalled();
    await pressHardwareBack();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('removes its back handler while another screen is focused and restores it on return', async () => {
    await act(async () => { root = TestRenderer.create(<variant.Screen />); });
    await pressText(root!, variant.open);
    expect(handlers.size).toBe(1);
    await changeFocus(false);
    expect(handlers.size).toBe(0);
    await changeFocus(true);
    expect(handlers.size).toBe(1);
    await pressHardwareBack();
    expect(textContent(root!)).not.toContain(variant.title);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

it.each(['全部', '当天'])('keeps %s, search type, search text and expansion after opening material detail and returning', async filter => {
  mockParams.orderNo = 'ORDER-A';
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  expect(root!.root.findAllByType(TextInput)).toHaveLength(0);
  await pressText(root!, filter);
  await pressText(root!, '批次');
  await act(async () => { root!.root.findByType(TextInput).props.onChangeText('LOT-A'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  const orderList = root!.root.findByType(FlatList);
  let row!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { row = TestRenderer.create(orderList.props.renderItem({ item: order })); });
    await act(async () => { await row.root.findByType('Card').props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    await act(async () => { row.update(root!.root.findByType(FlatList).props.renderItem({ item: order })); });
    await pressText(row, 'MODEL-A');
    expect(mockPush).toHaveBeenCalledWith('/detail', { id: 'material-A' });
    await changeFocus(false);
    await changeFocus(true);
    expect(root!.root.findByType(TextInput).props.value).toBe('LOT-A');
    expect(root!.root.findByType(FlatList).props.data).toEqual([order]);
    expect(getQueryFilteredOrders).toHaveBeenLastCalledWith(expect.objectContaining({
      searchText: 'LOT-A', searchType: 'batch', timeFilter: filter === '全部' ? 'all' : 'today',
    }));
    await act(async () => { row.update(root!.root.findByType(FlatList).props.renderItem({ item: order })); });
    expect(textContent(row)).toContain('MODEL-A');
    expect(root!.root.findByType(FlatList).props.extraData).toContain(order.id);
  } finally {
    if (row) await act(async () => { row.unmount(); });
  }
});

it('applies a different target order while mounted but does not reset the view for the same target', async () => {
  mockParams.orderNo = 'ORDER-A';
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '全部');
  await act(async () => { root!.update(<OrdersScreen />); });
  expect(root!.root.findAllByType(TextInput)).toHaveLength(1);
  mockParams.orderNo = 'ORDER-B';
  await act(async () => { root!.update(<OrdersScreen />); });
  expect(root!.root.findAllByType(TextInput)).toHaveLength(0);
  expect(getQueryOrder).toHaveBeenLastCalledWith('ORDER-B', 'W1');
});
