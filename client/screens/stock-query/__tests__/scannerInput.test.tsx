import TestRenderer, { act } from 'react-test-renderer';
import StockQueryScreen from '../index';
import { detectRule, getActiveRules, initDatabase, type QRCodeRule } from '@/utils/database';
import { shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { fetchCurrentStockByInventoryCode } from '@/utils/erpCurrentStock';

const mockRouter = { back: jest.fn() };
let mockFocusCallback: () => (() => void) | void;
let mockFocusCleanup: (() => void) | void;
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => require('react').useEffect(() => {
  mockFocusCallback = callback;
  mockFocusCleanup = callback();
  return () => { mockFocusCleanup?.(); };
}, [callback]) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => { const theme = {}; return { useTheme: () => ({ theme, isDark: false }) }; });
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'ScanInput' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/qrcodeParser', () => ({ isQRCode: () => true, shouldWaitForQRCodeContinuation: jest.fn(() => false) }));
jest.mock('@/utils/feedback', () => ({ feedbackNotBound: jest.fn(), feedbackQueryFailed: jest.fn(), feedbackQuerySuccess: jest.fn() }));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(async () => undefined), getActiveRules: jest.fn(async () => []),
  detectRule: jest.fn(async () => ({ id: 'R' })),
  parseWithRule: (code: string) => ({ standardFields: { model: code, version: '' } }),
  getInventoryCodeByModel: jest.fn(async () => 'INV'),
}));
jest.mock('@/utils/erpCurrentStock', () => ({ fetchCurrentStockByInventoryCode: jest.fn(async () => ({ inventoryCode: 'INV', rows: [] })) }));
let root: TestRenderer.ReactTestRenderer;
const input = () => root.root.findByType('ScanInput' as never);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
const remountWithRuleLoader = async (loadRules: () => Promise<QRCodeRule[]>) => {
  await act(async () => { root.unmount(); });
  jest.mocked(initDatabase).mockClear();
  jest.mocked(getActiveRules).mockClear().mockImplementation(loadRules);
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.clearAllMocks();
  jest.mocked(initDatabase).mockResolvedValue(undefined);
  jest.mocked(getActiveRules).mockResolvedValue([]);
  jest.mocked(shouldWaitForQRCodeContinuation).mockReturnValue(false);
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  jest.useRealTimers();
});
it('keeps the 150ms complete-label fast path', async () => {
  await act(async () => { input().props.onChangeText('MODEL/10/FAST'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(149); });
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(detectRule).toHaveBeenCalledWith('MODEL/10/FAST', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});
it('accepts the full native Enter text and does not consume its trailing change twice', async () => {
  jest.mocked(shouldWaitForQRCodeContinuation).mockImplementation(text => text === 'MODEL/10');
  await act(async () => { input().props.onChangeText('MODEL/10'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expect(detectRule).not.toHaveBeenCalled();
  await act(async () => { input().props.onSubmitEditing({ nativeEvent: { text: 'MODEL/10/FULL' } }); });
  await act(async () => { await jest.advanceTimersByTimeAsync(10); input().props.onChangeText('MODEL/10/FULL'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expect(detectRule).toHaveBeenCalledWith('MODEL/10/FULL', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  await act(async () => { input().props.onSubmitEditing({ nativeEvent: { text: 'MODEL/10/FULL' } }); await jest.advanceTimersByTimeAsync(500); });
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});
it('does not let a late Enter cancel the next pending scan', async () => {
  await act(async () => { input().props.onChangeText('FIRST/10/X'); input().props.onSubmitEditing({ nativeEvent: { text: 'FIRST/10/X' } }); });
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  await act(async () => { input().props.onChangeText('SECOND/10/Y'); input().props.onSubmitEditing({ nativeEvent: { text: 'FIRST/10/X' } }); });
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expect(detectRule).toHaveBeenLastCalledWith('SECOND/10/Y', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});
it('cancels an incomplete-label continuation when leaving and re-entering', async () => {
  jest.mocked(shouldWaitForQRCodeContinuation).mockReturnValue(true);
  await act(async () => { input().props.onChangeText('OLD/10'); await jest.advanceTimersByTimeAsync(150); });
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); await jest.advanceTimersByTimeAsync(500); });
  expect(detectRule).not.toHaveBeenCalled();
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
});

it('does not replace a shared model prefix with the previous label native Enter', async () => {
  await act(async () => { input().props.onChangeText('MODEL/10/OLD'); input().props.onSubmitEditing({ nativeEvent: { text: 'MODEL/10/OLD' } }); });
  await act(async () => { input().props.onChangeText('MODEL/10/'); input().props.onSubmitEditing({ nativeEvent: { text: 'MODEL/10/OLD' } }); });
  expect(input().props.value).toBe('MODEL/10/');
  await act(async () => { input().props.onChangeText('MODEL/10/NEW'); await jest.advanceTimersByTimeAsync(150); });
  expect(detectRule).toHaveBeenLastCalledWith('MODEL/10/NEW', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});

it('prepares local scan rules on focus without requesting stock', () => {
  expect(initDatabase).toHaveBeenCalledTimes(1);
  expect(getActiveRules).toHaveBeenCalledTimes(1);
  expect(detectRule).not.toHaveBeenCalled();
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
});

it('shares unfinished focus preparation with the first scan', async () => {
  const rules = deferred<QRCodeRule[]>();
  await remountWithRuleLoader(() => rules.promise);
  await act(async () => {
    input().props.onChangeText('FIRST/10/READY');
    input().props.onSubmitEditing({ nativeEvent: { text: 'FIRST/10/READY' } });
  });
  expect(initDatabase).toHaveBeenCalledTimes(1);
  expect(getActiveRules).toHaveBeenCalledTimes(1);
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  await act(async () => { rules.resolve([]); });
  expect(detectRule).toHaveBeenCalledWith('FIRST/10/READY', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});

it('discards an earlier focus preparation and scan without clearing the new preparation', async () => {
  const oldRules = deferred<QRCodeRule[]>();
  const newRules = deferred<QRCodeRule[]>();
  const freshRules = [{ id: 'FRESH' }] as QRCodeRule[];
  let loadCount = 0;
  await remountWithRuleLoader(() => ++loadCount === 1 ? oldRules.promise : newRules.promise);
  await act(async () => {
    input().props.onChangeText('OLD/10/SCAN');
    input().props.onSubmitEditing({ nativeEvent: { text: 'OLD/10/SCAN' } });
  });
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); });
  await act(async () => { oldRules.resolve([{ id: 'OLD' }] as QRCodeRule[]); });
  expect(detectRule).not.toHaveBeenCalled();
  await act(async () => {
    input().props.onChangeText('NEW/10/SCAN');
    input().props.onSubmitEditing({ nativeEvent: { text: 'NEW/10/SCAN' } });
  });
  expect(getActiveRules).toHaveBeenCalledTimes(2);
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  await act(async () => { newRules.resolve(freshRules); });
  expect(detectRule).toHaveBeenCalledTimes(1);
  expect(detectRule).toHaveBeenCalledWith('NEW/10/SCAN', freshRules);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});

it('retries a failed focus preparation when the user scans', async () => {
  let loadCount = 0;
  await remountWithRuleLoader(async () => {
    if (++loadCount === 1) throw new Error('temporary local read failure');
    return [];
  });
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  await act(async () => {
    input().props.onChangeText('RETRY/10/SCAN');
    input().props.onSubmitEditing({ nativeEvent: { text: 'RETRY/10/SCAN' } });
  });
  expect(initDatabase).toHaveBeenCalledTimes(2);
  expect(getActiveRules).toHaveBeenCalledTimes(2);
  expect(detectRule).toHaveBeenCalledWith('RETRY/10/SCAN', []);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});
