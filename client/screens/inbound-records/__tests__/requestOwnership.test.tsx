import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/config';
import { syncExcelToComputer } from '@/utils/excel';
import { buildInboundSheets, buildInboundExportFileNameFromNo } from '@/utils/inboundExport';
import { buildInventorySheets, buildInventoryExportFileNameFromNo } from '@/utils/inventoryExport';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, FlatList, Text } from 'react-native';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { MotionCollapse } from '@/components/AppMotion';
import InboundRecordsScreen from '../index';
import InventoryRecordsScreen from '@/screens/inventory-records';
import {
  getInboundRecordsByNo, getInventoryCheckRecordsByNo,
  updateInboundDocumentSyncStatus, updateInventoryCheckDocumentSyncStatus,
  type InboundRecord, type InventoryCheckRecord,
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
  erp_account_name: `账套 ${suffix}`, erp_account_keys: suffix === 'B' ? 'wuxi-duneng' : 'shanghai-chipmunk',
  completion_status: 'partial' as const, created_at: '2026/10/15 15:00', in_date: '2026-10-15',
  record_count: 1, model_count: 1, total_quantity: 40, whole_count: 1, partial_count: 0,
  sync_status: 'pending' as const,
});
type Row = ReturnType<typeof document>;
const variants = [
  { name: 'inbound', Screen: InboundRecordsScreen, query: getInboundDocumentSummaries, read: getInboundRecordsByNo, update: updateInboundDocumentSyncStatus,
    all: '全部仓库', scopeA: '仓库 A', scopeB: '仓库 B', secondKey: 'W2' },
  { name: 'inventory', Screen: InventoryRecordsScreen, query: getInventoryCheckDocumentSummaries, read: getInventoryCheckRecordsByNo, update: updateInventoryCheckDocumentSyncStatus,
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

  it('shows loading in the header and expands the document only after details arrive', async () => {
    await mount();
    const pending = deferred<never[]>();
    jest.mocked(variant.read).mockImplementationOnce(() => pending.promise);
    let row!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => { row = TestRenderer.create(list(root).props.renderItem({ item: document('A') })); });
      await act(async () => { void row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(row.root.findByType('Card').props.disablePressAnimation).toBe(true);
      expect(row.root.findAllByType(MotionCollapse)).toHaveLength(0);
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' })).toHaveLength(0);
      expect(row.root.findAllByType(ActivityIndicator)).toHaveLength(1);
      await act(async () => { pending.resolve([]); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' }).length).toBeGreaterThan(0);
      expect(row.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    } finally {
      if (row) await act(async () => { row.unmount(); });
    }
  });

  it('shows the account only in the summary after expanding the document', async () => {
    await mount();
    let row!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => { row = TestRenderer.create(list(root).props.renderItem({ item: document('A') })); });
      await act(async () => { row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      const labels = row.root.findAllByType(Text).map(node => node.props.children).flat().join('');
      expect(labels.match(/账套 A/g)).toHaveLength(1);
      expect(labels).not.toContain('账套：');
      expect(labels).toContain('点型号展开明细');
      if (variant.name === 'inbound') expect(labels).toContain('可继续扫码');
    } finally {
      if (row) await act(async () => { row.unmount(); });
    }
  });

  it('separates inventory codes, models and versions while keeping record quantities and trace details', async () => {
    const record = (id: string, quantity: number, actual: number, extra: Partial<InboundRecord & InventoryCheckRecord> = {}) => ({
      id, inventory_code: 'INV-A', scan_model: 'MODEL-A', version: 'V1', quantity, actual_quantity: actual,
      batch: 'BATCH-A', productionDate: '2528', traceNo: 'TRACE-A', created_at: '2026/10/15 15:00', ...extra,
    } as InboundRecord & InventoryCheckRecord);
    jest.mocked(variant.read).mockResolvedValueOnce([
      record('R1', 10, 7), record('R2', 20, 0, { traceNo: '  ' }),
      record('R3', 30, 25, { version: 'V2' }),
      record('R4', 40, 35, { inventory_code: 'INV-B' }),
      record('R5', 50, 45, { version: '' }),
      record('R6', 60, 55, { scan_model: 'MODEL-B' }),
    ]);
    await mount();
    let row!: TestRenderer.ReactTestRenderer;
    const labels = (node: TestRenderer.ReactTestInstance) => node.findAllByType(Text)
      .map(label => [label.props.children].flat().join(''));
    const groups = () => row.root.findAllByType(TouchableOpacity)
      .filter(node => labels(node).some(label => label.startsWith('型号：')));
    try {
      await act(async () => { row = TestRenderer.create(list(root).props.renderItem({ item: document('A') })); });
      await act(async () => { row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(groups()).toHaveLength(5);
      const sameVersion = groups().find(node => {
        const text = labels(node);
        return text.includes('存货编码：INV-A') && text.includes('型号：MODEL-A') && text.includes('版本号：V1');
      })!;
      expect(labels(sameVersion).slice(0, 4)).toEqual(['存货编码：INV-A', '型号：MODEL-A', '版本号：V1', '2 条明细']);
      expect(labels(sameVersion)[4]).toBe(variant.name === 'inventory' ? '7' : '30');
      expect(groups().some(node => labels(node).includes('版本号：-'))).toBe(true);
      await act(async () => { sameVersion.props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      const details = row.root.findAllByType(TouchableOpacity).filter(node => Boolean(node.props.onLongPress));
      expect(details).toHaveLength(2);
      expect(labels(details[0])).toEqual([
        '批次：BATCH-A', '生产日期：2528', '追溯码：TRACE-A',
        variant.name === 'inventory' ? '实盘 7' : '10', '/ PCS',
      ]);
      expect(labels(details[1])).toEqual([
        '批次：BATCH-A', '生产日期：2528', '追溯码：-',
        variant.name === 'inventory' ? '实盘 0' : '20', '/ PCS',
      ]);
    } finally {
      if (row) await act(async () => { row.unmount(); });
    }
  });

  it('handles three rapid taps without duplicate reads or waiting for animation callbacks', async () => {
    await mount();
    const pending = deferred<never[]>();
    jest.mocked(variant.read).mockClear().mockImplementationOnce(() => pending.promise);
    let row!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => { row = TestRenderer.create(list(root).props.renderItem({ item: document('A') })); });
      const press = row.root.findByType('Card').props.onPress;
      await act(async () => { void press(); void press(); void press(); });
      expect(variant.read).toHaveBeenCalledTimes(1);
      await act(async () => { pending.resolve([]); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' }).length).toBeGreaterThan(0);
      expect(row.root.findAllByType(MotionCollapse)).toHaveLength(0);
      await act(async () => { await row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' })).toHaveLength(0);
    } finally {
      if (row) await act(async () => { row.unmount(); });
    }
  });

  it('allows a single click to retry after a failed detail read', async () => {
    await mount();
    jest.mocked(variant.read).mockClear().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([]);
    let row!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => { row = TestRenderer.create(list(root).props.renderItem({ item: document('A') })); });
      await act(async () => { await row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' })).toHaveLength(0);
      await act(async () => { await row.root.findByType('Card').props.onPress(); });
      await act(async () => { row.update(list(root).props.renderItem({ item: document('A') })); });
      expect(variant.read).toHaveBeenCalledTimes(2);
      expect(row.root.findAllByProps({ testID: 'document-expanded-details' }).length).toBeGreaterThan(0);
    } finally {
      if (row) await act(async () => { row.unmount(); });
    }
  });

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
    expect(root.root.findAllByType('Notice').filter(node => node.props.visible !== false)).toHaveLength(0);
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
    expect(root.root.findAllByType('Notice').filter(node => node.props.visible !== false)).toHaveLength(0);
  });
});


describe.each(variants)('$name repeat document sync', variant => {
  let root: TestRenderer.ReactTestRenderer;
  const savedRow = (model: string, quantity: number) => ({
    id: model, inbound_no: 'II-A', check_no: 'PD-A', warehouse_id: 'W1', warehouse_name: '仓库 A',
    scan_model: model, model, quantity, actual_quantity: quantity, batch: 'BATCH', check_type: 'whole',
    created_at: '2026/10/15 15:00', inventory_code: 'INV',
    erp_account_name: '账套 A',
  } as InboundRecord & InventoryCheckRecord);
  const button = () => root.root.findAllByType(TouchableOpacity).find(node =>
    node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.includes('同步'))!;
  const pressSync = async () => {
    await act(async () => { button().props.onPress({ stopPropagation: jest.fn() }); });
  };
  const mount = async (status: 'pending' | 'success' | 'failed' = 'success') => {
    await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1', port: '8080' }));
    jest.mocked(variant.query).mockResolvedValue([{ ...document('A'), sync_status: status }]);
    jest.mocked(variant.read).mockResolvedValue([savedRow('OLD', 40)]);
    jest.mocked(variant.update).mockResolvedValue(undefined);
    jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true });
    await act(async () => { root = TestRenderer.create(<variant.Screen />); });
  };
  afterEach(async () => { if (root) await act(async () => { root.unmount(); }); });

  it.each(['pending', 'success', 'failed'] as const)('allows %s documents to sync again using fresh complete records and the same filename', async status => {
    await mount(status);
    expect(button().props.disabled).toBe(false);
    expect(button().props.accessibilityLabel).toContain(status === 'pending' ? '同步到电脑' : '重新同步');
    await pressSync();
    const rows = [savedRow('OLD', 40), savedRow('NEW', 60)];
    jest.mocked(variant.read).mockResolvedValue(rows);
    await pressSync();
    expect(variant.read).toHaveBeenCalledTimes(2);
    const no = variant.name === 'inbound' ? 'II-A' : 'PD-A';
    expect(variant.read).toHaveBeenLastCalledWith(no, 'W1');
    expect(syncExcelToComputer).toHaveBeenCalledTimes(2);
    const calls = jest.mocked(syncExcelToComputer).mock.calls;
    const fileName = variant.name === 'inbound'
      ? buildInboundExportFileNameFromNo('仓库 A', no)
      : buildInventoryExportFileNameFromNo('仓库 A', 'complete', no);
    expect(calls.map(call => call[6])).toEqual([fileName, fileName]);
    expect(calls[1][1]).toBe(variant.name === 'inbound' ? '/inbound' : '/inventory');
    expect(calls[1][0]).toEqual(variant.name === 'inbound' ? buildInboundSheets(rows) : buildInventorySheets(rows.map(row => ({ ...row, account_name: '账套 A' }))));
    expect(variant.update).toHaveBeenLastCalledWith(no, 'W1', 'success', fileName, undefined);
    expect(button().props.disabled).toBe(false);
  });

  it('blocks rapid taps and retains the lock when leaving and returning to the page', async () => {
    await mount();
    const upload = deferred<{ success: boolean }>();
    jest.mocked(syncExcelToComputer).mockReturnValueOnce(upload.promise);
    const press = button().props.onPress;
    await act(async () => {
      press({ stopPropagation: jest.fn() });
      press({ stopPropagation: jest.fn() });
    });
    expect(syncExcelToComputer).toHaveBeenCalledTimes(1);
    expect(button().props.disabled).toBe(true);
    await act(async () => {
      mockFocusCleanup?.();
      mockFocusCleanup = mockFocusCallback?.() || undefined;
    });
    await pressSync();
    expect(syncExcelToComputer).toHaveBeenCalledTimes(1);
    await act(async () => { upload.resolve({ success: true }); });
    expect(button().props.disabled).toBe(false);
    await pressSync();
    expect(syncExcelToComputer).toHaveBeenCalledTimes(2);
  });

  it('releases the lock after failed upload even if writing its failure status also fails', async () => {
    await mount();
    jest.mocked(syncExcelToComputer).mockRejectedValueOnce(new Error('offline'));
    jest.mocked(variant.update).mockRejectedValueOnce(new Error('status write failed'));
    await pressSync();
    expect(button().props.disabled).toBe(false);
    expect(root.root.findAllByType('Notice').filter(node => node.props.visible !== false).length).toBeGreaterThan(0);
    await pressSync();
    expect(syncExcelToComputer).toHaveBeenCalledTimes(2);
  });

  it('does not upload a late record read after switching the filter', async () => {
    await mount();
    const rows = deferred<(InboundRecord & InventoryCheckRecord)[]>();
    jest.mocked(variant.read).mockReturnValueOnce(rows.promise);
    await pressSync();
    await changeScope(root, variant.all, variant.scopeB);
    await act(async () => { rows.resolve([savedRow('OLD', 40)]); });
    expect(syncExcelToComputer).not.toHaveBeenCalled();
  });
});
