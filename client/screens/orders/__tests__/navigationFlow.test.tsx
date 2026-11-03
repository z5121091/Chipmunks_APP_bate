import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList, Text, TextInput } from 'react-native';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { exportOutboundHistoryToComputer } from '@/utils/outboundHistoryExport';
import OrdersScreen from '../index';
import InboundRecordsScreen from '@/screens/inbound-records';
import InventoryRecordsScreen from '@/screens/inventory-records';
import { getQueryFilteredOrders, getQueryMaterialsByOrder, getQueryOrder, type Order, type MaterialRecord } from '@/utils/database';
import { MotionCollapse } from '@/components/AppMotion';

type FocusEntry = { callback: () => void | (() => void); cleanup?: () => void };
const mockFocusEntries = new Set<FocusEntry>();
let mockFocused = true;
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockAlert = { showConfirm: jest.fn(), showSuccess: jest.fn(), showError: jest.fn(), AlertComponent: null };
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
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@/utils/outboundHistoryExport', () => ({ exportOutboundHistoryToComputer: jest.fn() }));
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
  traceNo: 'TRACE-A', productionDate: '2436',
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
  // A closing picker is non-interactive immediately and remains visible briefly for its exit.
  await act(async () => { jest.advanceTimersByTime(220); });
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
    await act(async () => { row.update(root!.root.findByType(FlatList).props.renderItem({ item: order })); });
    expect(row.root.findAllByType(MotionCollapse)).toHaveLength(0);
    await act(async () => { row.update(root!.root.findByType(FlatList).props.renderItem({ item: order })); });
    expect(row.root.findAllByProps({ testID: 'order-expanded-details' }).length).toBeGreaterThan(0);
    await pressText(row, 'LOT-A');
    await act(async () => { row.update(root!.root.findByType(FlatList).props.renderItem({ item: order })); });
    expect(row.root.findAllByType(Text).filter(node => node.props.children === 'MODEL-A')).toHaveLength(1);
    expect(row.root.findAllByType(Text).filter(node => node.props.children === '2436')).toHaveLength(1);
    await pressText(row, '追溯码：TRACE-A');
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
    expect(textContent(row)).toContain('追溯码：');
    expect(root!.root.findByType(FlatList).props.extraData).toContain(order.id);
  } finally {
    if (row) await act(async () => { row.unmount(); });
  }
});

it.each([undefined, '  ', '-', ' TRACE-NEW '])('keeps the five material lines and displays trace %j without falling back to another identity', async traceNo => {
  jest.mocked(getQueryMaterialsByOrder).mockResolvedValue([{
    ...material, traceNo, sourceNo: 'BOX-DO-NOT-USE', inventory_code: 'CODE-A', version: 'V1', package: 'LQFP64',
  }]);
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '全部');
  let row!: TestRenderer.ReactTestRenderer;
  try {
    const renderRow = () => root!.root.findByType(FlatList).props.renderItem({ item: order });
    await act(async () => { row = TestRenderer.create(renderRow()); });
    await act(async () => { await row.root.findByType('Card').props.onPress(); });
    await act(async () => { row.update(renderRow()); });
    const labels = row.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
    const modelLine = labels.indexOf('型号：');
    expect(labels.slice(modelLine, modelLine + 11)).toEqual([
      '型号：', 'MODEL-A', '编码：', 'CODE-A', '版本号：', 'V1', '封装：', 'LQFP64', '合计：', '5 PCS', '扫码记录：1 条',
    ]);
    await pressText(row, 'LOT-A');
    await act(async () => { row.update(renderRow()); });
    const expectedTrace = traceNo?.trim() || '-';
    expect(textContent(row)).toContain(`追溯码：${expectedTrace}`);
    expect(textContent(row)).not.toContain('BOX-DO-NOT-USE');
    expect(row.root.findAllByType(TouchableOpacity).some(node =>
      node.props.accessibilityLabel === `查看扫码记录，追溯码：${expectedTrace}`)).toBe(true);
    await pressText(row, `追溯码：${expectedTrace}`);
    expect(mockPush).toHaveBeenCalledWith('/detail', { id: 'material-A' });
  } finally {
    if (row) await act(async () => { row.unmount(); });
  }
});

it('retries an order read on the next click after failure, without a timer or animation', async () => {
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '全部');
  jest.mocked(getQueryMaterialsByOrder).mockClear().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([material]);
  let row!: TestRenderer.ReactTestRenderer;
  try {
    const renderRow = () => root!.root.findByType(FlatList).props.renderItem({ item: order });
    await act(async () => { row = TestRenderer.create(renderRow()); });
    await act(async () => { await row.root.findByType('Card').props.onPress(); });
    await act(async () => { row.update(renderRow()); });
    expect(mockAlert.showError).toHaveBeenCalledWith('订单明细加载失败，请点击单据重试');
    expect(row.root.findAllByProps({ testID: 'order-expanded-details' })).toHaveLength(0);
    await act(async () => { await row.root.findByType('Card').props.onPress(); });
    await act(async () => { row.update(renderRow()); });
    expect(getQueryMaterialsByOrder).toHaveBeenCalledTimes(2);
    expect(textContent(row)).toContain('MODEL-A');
    expect(row.root.findAllByType(MotionCollapse)).toHaveLength(0);
    expect(row.root.findByType('Card').props.disablePressAnimation).toBe(true);
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


it.each(['当前', '当天', '全部'])('exports the selected warehouse history independently of the %s view and search', async view => {
  jest.mocked(exportOutboundHistoryToComputer).mockResolvedValue({ fileName: '仓库B.xlsx', recordCount: 8 });
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '仓库 A');
  await pressText(root!, '仓库 B');
  await pressText(root!, view);
  if (view !== '当前') {
    await pressText(root!, '批次');
    await act(async () => { root!.root.findByType(TextInput).props.onChangeText('FILTER-ONLY'); });
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
  }
  await pressText(root!, '导出历史');
  expect(mockAlert.showConfirm).toHaveBeenLastCalledWith('导出历史', expect.stringContaining('仓库 B'), expect.any(Function), false, '导出到电脑');
  expect(mockAlert.showConfirm.mock.calls.at(-1)?.[1]).toContain('不受当前搜索和日期筛选影响');
  expect(exportOutboundHistoryToComputer).not.toHaveBeenCalled();
  await act(async () => { await mockAlert.showConfirm.mock.calls.at(-1)![2](); });
  expect(exportOutboundHistoryToComputer).toHaveBeenCalledTimes(1);
  expect(exportOutboundHistoryToComputer).toHaveBeenCalledWith({ id: 'W2', name: '仓库 B' });
  expect(mockAlert.showSuccess).toHaveBeenCalledWith(expect.stringContaining('仓库B.xlsx'));
});

it('keeps the confirmed warehouse snapshot and blocks repeated confirmation while exporting', async () => {
  let finish!: (result: { fileName: string; recordCount: number }) => void;
  jest.mocked(exportOutboundHistoryToComputer).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '导出历史');
  const confirm = mockAlert.showConfirm.mock.calls.at(-1)![2];
  await pressText(root!, '仓库 A');
  await pressText(root!, '仓库 B');
  await act(async () => { void confirm(); void confirm(); });
  expect(exportOutboundHistoryToComputer).toHaveBeenCalledTimes(1);
  expect(exportOutboundHistoryToComputer).toHaveBeenCalledWith({ id: 'W1', name: '仓库 A' });
  expect(textContent(root!)).toContain('导出中');
  await act(async () => { finish({ fileName: 'A.xlsx', recordCount: 2 }); });
  expect(textContent(root!)).toContain('导出历史');
  expect(mockAlert.showSuccess).toHaveBeenCalledWith(expect.stringContaining('仓库 A'));
});

it('ignores confirmation from a previous page visit', async () => {
  await act(async () => { root = TestRenderer.create(<OrdersScreen />); });
  await pressText(root!, '导出历史');
  const confirm = mockAlert.showConfirm.mock.calls.at(-1)![2];
  await changeFocus(false);
  await changeFocus(true);
  await act(async () => { await confirm(); });
  expect(exportOutboundHistoryToComputer).not.toHaveBeenCalled();
});
