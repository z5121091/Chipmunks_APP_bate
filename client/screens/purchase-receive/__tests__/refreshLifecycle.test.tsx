import TestRenderer, { act } from 'react-test-renderer';
import { AppState, FlatList, Text, TouchableOpacity } from 'react-native';
import PurchaseReceiveScreen from '../index';
import * as erp from '@/utils/erpPurchaseReceive';
import { ERP_ACCOUNTS } from '@/utils/erpAccounts';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { UiPageHeader } from '@/components/UiRedesign';

let mockFocusCallback: (() => void | (() => void)) | undefined;
let mockFocusCleanup: (() => void) | undefined;
const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(() => {
    mockFocusCallback = callback;
    mockFocusCleanup = callback() || undefined;
    return () => { mockFocusCleanup?.(); };
  }, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary' }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'ScanInput' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/database', () => ({ getInboundDocumentSummaries: jest.fn(async () => []) }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/feedback', () => ({ feedbackInboundStart: jest.fn() }));
jest.mock('@/utils/erpPurchaseReceive', () => ({
  getPendingPurchaseReceivesSnapshot: jest.fn(),
  loadCachedPendingPurchaseReceives: jest.fn(),
  revalidatePendingPurchaseReceives: jest.fn(),
  fetchPurchaseReceiveVoucher: jest.fn(),
  fetchPurchaseReceiveVoucherStatuses: jest.fn(async () => []),
  loadCachedPurchaseReceiveVoucher: jest.fn(async () => null),
  loadCachedPurchaseReceiveVoucherStatuses: jest.fn(async () => null),
  savePurchaseReceiveVoucherCache: jest.fn(),
  savePurchaseReceiveVoucherStatusesCache: jest.fn(),
}));

const accountA = ERP_ACCOUNTS[0];
const accountB = ERP_ACCOUNTS[1];
const snapshot = (suffix: string, account = accountA) => ({
  cachedAt: new Date().toISOString(),
  data: {
    items: [{
      accountKey: account.key, code: `II-${suffix}`, id: suffix,
      partnerCode: 'P1', partnerName: `供应商 ${suffix}`, stateCode: '00', stateName: '未审',
      voucherDate: '2026-10-17', warehouseCode: 'W1', warehouseName: account.expectedWarehouseName,
    }],
    pageIndex: 0, totalCount: 1, totalPageNum: 1,
  },
});
type Snapshot = ReturnType<typeof snapshot>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

let root: TestRenderer.ReactTestRenderer | undefined;
let stateListener: ((state: typeof AppState.currentState) => void) | undefined;
let previousState: typeof AppState.currentState;
const codes = () => root!.root.findByType(FlatList).props.data.map((item: erp.PurchaseReceiveListItem) => item.code);
const mount = async () => {
  await act(async () => { root = TestRenderer.create(<PurchaseReceiveScreen />); });
};
const tick = async (ms: number) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
};
const changeAppState = async (state: typeof AppState.currentState) => {
  AppState.currentState = state;
  await act(async () => { stateListener!(state); });
};
const switchAccount = async () => {
  const button = root!.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(label => label.props.children === accountB.name));
  await act(async () => { button!.props.onPress(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  previousState = AppState.currentState;
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateListener = listener;
    return { remove: jest.fn() };
  });
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReset().mockReturnValue(null);
  jest.mocked(erp.loadCachedPendingPurchaseReceives).mockReset().mockResolvedValue(null);
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReset().mockResolvedValue(snapshot('A'));
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  mockFocusCallback = undefined;
  mockFocusCleanup = undefined;
  stateListener = undefined;
  AppState.currentState = previousState;
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('shows the workbench-prefetched snapshot while the current validation is still pending', async () => {
  const request = deferred<Snapshot>();
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(snapshot('PREFETCH'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReturnValue(request.promise);
  await mount();
  expect(codes()).toEqual(['II-PREFETCH']);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledWith(accountA, { forceRefresh: true });
  expect(erp.loadCachedPendingPurchaseReceives).not.toHaveBeenCalled();
  await act(async () => { request.resolve(snapshot('LATEST')); });
  expect(codes()).toEqual(['II-LATEST']);
});

it('starts the first load before the native app-state bridge has reported its initial state', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: null });
  await mount();
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledWith(accountA, { forceRefresh: true });
  expect(codes()).toEqual(['II-A']);
});

it('shows disk data before the ERP response and keeps it on an automatic refresh failure', async () => {
  const firstRequest = deferred<Snapshot>();
  jest.mocked(erp.loadCachedPendingPurchaseReceives).mockResolvedValue(snapshot('DISK'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReturnValueOnce(firstRequest.promise);
  await mount();
  expect(codes()).toEqual(['II-DISK']);
  await act(async () => { firstRequest.resolve(snapshot('LATEST')); });
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockRejectedValueOnce(new Error('ERP-OFFLINE'));
  await changeAppState('background');
  await changeAppState('active');
  expect(codes()).toEqual(['II-LATEST']);
  expect(root!.root.findAllByType(Text).some(node => String(node.props.children).includes('ERP-OFFLINE'))).toBe(false);
});

it('polls only local audit messages while idle and checks the daily list entry only on foreground', async () => {
  await mount();
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await changeAppState('background');
  await tick(60_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await changeAppState('active');
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(1, accountA, { forceRefresh: true });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(2, accountA, { forceRefresh: false });
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(2);
  await act(async () => { root!.root.findByType(WarehouseScanInput).props.onChangeText('II-'); });
  await tick(30_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(2);
  await act(async () => { root!.root.findByType(WarehouseScanInput).props.onChangeText(''); });
  await tick(60 * 60_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(122);
});

it('does not start another list load while the current validation is in flight', async () => {
  const request = deferred<Snapshot>();
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReturnValue(request.promise);
  await mount();
  await tick(90_000);
  await changeAppState('active');
  await act(async () => { root!.root.findByType(UiPageHeader).props.onRightPress(); });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledWith(accountA, { forceRefresh: true });
  await act(async () => { request.resolve(snapshot('LATEST')); });
  expect(codes()).toEqual(['II-LATEST']);
});

it('pauses local audit polling during detail loading and resumes without querying the ERP list', async () => {
  const detailRequest = deferred<erp.PurchaseReceiveVoucher>();
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockReturnValueOnce(detailRequest.promise);
  await mount();
  const list = root!.root.findByType(FlatList);
  const item = list.props.data[0] as erp.PurchaseReceiveListItem;
  const card = list.props.renderItem({ item });
  await act(async () => { void card.props.children[0].props.onPress(); });
  await tick(30_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(1);
  await act(async () => {
    detailRequest.resolve({
      ...item, accountName: accountA.name, lines: [], raw: {}, sourceVoucherCode: '',
    });
  });
  await tick(30_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(2);
});

it('does not apply a list response in the background and reloads the snapshot on foreground', async () => {
  const request = deferred<Snapshot>();
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(snapshot('PREFETCH'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReturnValueOnce(request.promise);
  await mount();
  await changeAppState('background');
  await act(async () => { request.resolve(snapshot('BACKGROUND')); });
  expect(codes()).toEqual(['II-PREFETCH']);
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(snapshot('BACKGROUND'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockResolvedValue(snapshot('BACKGROUND'));
  await changeAppState('active');
  expect(codes()).toEqual(['II-BACKGROUND']);
});

it('shows the other account snapshot immediately and ignores the previous account response', async () => {
  const request = deferred<Snapshot>();
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockImplementation(key =>
    key === accountB.key ? snapshot('B-PREFETCH', accountB) : snapshot('A-PREFETCH'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockImplementation(account =>
    account.key === accountB.key ? Promise.resolve(snapshot('B-LATEST', accountB)) : request.promise);
  await mount();
  await switchAccount();
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(1, accountA, { forceRefresh: true });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(2, accountB, { forceRefresh: true });
  expect(codes()).toEqual(['II-B-LATEST']);
  await act(async () => { request.resolve(snapshot('A-LATE')); });
  expect(codes()).toEqual(['II-B-LATEST']);
});

it('does not let a blurred page response replace the list and refreshes when returning', async () => {
  const request = deferred<Snapshot>();
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(snapshot('PREFETCH'));
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockReturnValueOnce(request.promise);
  await mount();
  await act(async () => { mockFocusCleanup!(); });
  await tick(60_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await act(async () => { request.resolve(snapshot('OLD-PAGE')); });
  expect(codes()).toEqual(['II-PREFETCH']);
  await act(async () => { mockFocusCleanup = mockFocusCallback!() || undefined; });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(1, accountA, { forceRefresh: true });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(2, accountA, { forceRefresh: true });
  expect(codes()).toEqual(['II-A']);
});

it('bypasses the freshness window for a user-requested refresh', async () => {
  await mount();
  await act(async () => { root!.root.findByType(UiPageHeader).props.onRightPress(); });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenLastCalledWith(accountA, { forceRefresh: true });
});

it('defers entry refresh while initially backgrounded and forces only the first foreground load', async () => {
  AppState.currentState = 'background';
  await mount();
  await tick(60_000);
  expect(erp.revalidatePendingPurchaseReceives).not.toHaveBeenCalled();
  await changeAppState('active');
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(1, accountA, { forceRefresh: true });
  await changeAppState('background');
  await changeAppState('active');
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(2, accountA, { forceRefresh: false });
});

it('forces a fresh list on every separate page visit even with a same-day snapshot', async () => {
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(snapshot('TODAY'));
  await mount();
  for (let visit = 0; visit < 2; visit += 1) {
    await act(async () => { mockFocusCleanup!(); });
    await act(async () => { mockFocusCleanup = mockFocusCallback!() || undefined; });
  }
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(3);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(1, accountA, { forceRefresh: true });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(2, accountA, { forceRefresh: true });
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenNthCalledWith(3, accountA, { forceRefresh: true });
});
