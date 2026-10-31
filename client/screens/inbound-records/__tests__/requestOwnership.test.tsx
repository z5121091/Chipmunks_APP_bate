import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text, TouchableOpacity } from 'react-native';
import InboundRecordsScreen from '../index';
import InventoryRecordsScreen from '@/screens/inventory-records';
import {
  getInboundDocumentSummaries,
  getInventoryCheckDocumentSummaries,
} from '@/utils/database';

let mockFocusCallback: (() => void | (() => void)) | undefined;
let mockFocusCleanup: (() => void) | undefined;
const mockAlert = {
  showConfirm: jest.fn((_title: string, _message: string, confirm: () => void) => confirm()),
  AlertComponent: null,
};
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(() => {
    mockFocusCallback = callback;
    mockFocusCleanup = callback() || undefined;
    return () => { mockFocusCleanup?.(); };
  }, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/screens/inventory-records/styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AnimatedCard', () => ({ AnimatedCard: 'Card' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppPillToast', () => ({ AppPillToast: 'Notice' }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/utils/feedback', () => ({ feedbackDeleted: jest.fn(async () => undefined) }));
jest.mock('@/utils/excel', () => ({ formatSyncErrorMessage: jest.fn(), syncExcelToComputer: jest.fn() }));
jest.mock('@/utils/inboundExport', () => ({ buildInboundExportFileNameFromNo: jest.fn(), buildInboundSheets: jest.fn() }));
jest.mock('@/utils/inventoryExport', () => ({ buildInventoryExportFileNameFromNo: jest.fn(), buildInventorySheets: jest.fn() }));
jest.mock('@/utils/erpAccounts', () => ({ ERP_ACCOUNTS: [
  { key: 'shanghai-chipmunk', name: '账套 A' }, { key: 'wuxi-duneng', name: '账套 B' },
] }));
jest.mock('@/utils/database', () => ({
  getAllWarehouses: jest.fn(async () => [{ id: 'W1', name: '仓库 A' }, { id: 'W2', name: '仓库 B' }]),
  getInboundDocumentSummaries: jest.fn(), getInventoryCheckDocumentSummaries: jest.fn(),
  getInboundRecordsByNo: jest.fn(async () => []), getInventoryCheckRecordsByNo: jest.fn(async () => []),
  deleteInboundDocument: jest.fn(async () => undefined), deleteInboundRecord: jest.fn(async () => undefined),
  deleteInventoryCheckDocument: jest.fn(async () => undefined), deleteInventoryCheckRecord: jest.fn(async () => undefined),
  updateInboundDocumentSyncStatus: jest.fn(async () => undefined), updateInventoryCheckDocumentSyncStatus: jest.fn(async () => undefined),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const document = (suffix: string) => ({
  inbound_no: `II-${suffix}`, check_no: `PD-${suffix}`, warehouse_id: suffix === 'B' ? 'W2' : 'W1',
  warehouse_name: `仓库 ${suffix}`, erp_account_key: suffix === 'B' ? 'wuxi-duneng' : 'shanghai-chipmunk',
  erp_account_name: `账套 ${suffix}`, created_at: '2026/10/15 15:00', in_date: '2026-10-15',
  record_count: 1, model_count: 1, total_quantity: 40, whole_count: 1, partial_count: 0,
  sync_status: 'pending' as const,
});
type Row = ReturnType<typeof document>;
const variants = [
  { name: 'inbound', Screen: InboundRecordsScreen, query: getInboundDocumentSummaries,
    all: '全部仓库', scopeA: '仓库 A', scopeB: '仓库 B', secondKey: 'W2' },
  { name: 'inventory', Screen: InventoryRecordsScreen, query: getInventoryCheckDocumentSummaries,
    all: '全部账套', scopeA: '账套 A', scopeB: '账套 B', secondKey: 'wuxi-duneng' },
];
const list = (root: TestRenderer.ReactTestRenderer) => root.root.findAllByType(FlatList)
  .find(node => node.props.refreshControl)!;
const pressText = async (root: TestRenderer.ReactTestRenderer, text: string) => {
  const button = root.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(label => label.props.children === text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.props.onPress(); });
};
const changeScope = async (root: TestRenderer.ReactTestRenderer, current: string, target: string) => {
  await pressText(root, current);
  await pressText(root, target);
};
const refresh = async (root: TestRenderer.ReactTestRenderer) => {
  await act(async () => { void list(root).props.refreshControl.props.onRefresh(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  mockFocusCallback = undefined;
  mockFocusCleanup = undefined;
});

describe.each(variants)('$name document request ownership', variant => {
  let root: TestRenderer.ReactTestRenderer;
  const mount = async () => {
    jest.mocked(variant.query).mockImplementation(async (...args) => {
      const scope = variant.name === 'inventory' ? args[1] : args[0];
      return [document(scope === variant.secondKey ? 'B' : 'A')];
    });
    await act(async () => { root = TestRenderer.create(<variant.Screen />); });
  };
  afterEach(async () => { if (root) await act(async () => { root.unmount(); }); });

  it('ignores a late manual refresh from A and leaves the newer B refresh running', async () => {
    await mount();
    await changeScope(root, variant.all, variant.scopeA);
    const lateA = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => lateA.promise);
    await refresh(root);
    await changeScope(root, variant.scopeA, variant.scopeB);
    expect(list(root).props.data).toEqual([document('B')]);

    const lateB = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => lateB.promise);
    await refresh(root);
    expect(list(root).props.refreshControl.props.refreshing).toBe(true);
    await act(async () => { lateA.resolve([document('OLD-A')]); });
    expect(list(root).props.data).toEqual([document('B')]);
    expect(list(root).props.refreshControl.props.refreshing).toBe(true);
    await act(async () => { lateB.resolve([document('NEW-B')]); });
    expect(list(root).props.data).toEqual([document('NEW-B')]);
    expect(list(root).props.refreshControl.props.refreshing).toBe(false);
  });

  it('does not show a stale refresh failure after changing scope', async () => {
    await mount();
    await changeScope(root, variant.all, variant.scopeA);
    const lateA = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => lateA.promise);
    await refresh(root);
    await changeScope(root, variant.scopeA, variant.scopeB);
    await act(async () => { lateA.reject(new Error('late A failed')); });
    expect(list(root).props.data).toEqual([document('B')]);
    expect(root.root.findAllByType('Notice')).toHaveLength(0);
  });

  it('keeps the newest refresh when the same scope completes out of order', async () => {
    await mount();
    const first = deferred<Row[]>();
    const second = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await refresh(root);
    await refresh(root);
    await act(async () => { second.resolve([document('NEW')]); });
    await act(async () => { first.resolve([document('OLD')]); });
    expect(list(root).props.data).toEqual([document('NEW')]);
  });

  it('ignores refresh results from the previous page visit', async () => {
    await mount();
    const oldVisit = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => oldVisit.promise);
    await refresh(root);
    jest.mocked(variant.query).mockResolvedValueOnce([document('REENTERED')]);
    await act(async () => {
      mockFocusCleanup?.();
      mockFocusCleanup = mockFocusCallback?.() || undefined;
    });
    await act(async () => { oldVisit.resolve([document('OLD-VISIT')]); });
    expect(list(root).props.data).toEqual([document('REENTERED')]);
  });

  it('ignores a late delete reload after the filter has changed', async () => {
    await mount();
    await changeScope(root, variant.all, variant.scopeA);
    const deletedScope = deferred<Row[]>();
    jest.mocked(variant.query).mockImplementationOnce(() => deletedScope.promise);
    await act(async () => { list(root).props.renderItem({ item: document('A') }).props.onLongPress(); });
    expect(mockAlert.showConfirm).toHaveBeenCalledTimes(1);
    await changeScope(root, variant.scopeA, variant.scopeB);
    await act(async () => { deletedScope.resolve([]); });
    expect(list(root).props.data).toEqual([document('B')]);
    expect(root.root.findAllByType('Notice')).toHaveLength(0);
  });
});
