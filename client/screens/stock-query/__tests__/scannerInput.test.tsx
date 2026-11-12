import TestRenderer, { act, type ReactTestRendererJSON } from 'react-test-renderer';
import StockQueryScreen from '../index';
import { detectRule, getActiveRules, getAllWarehouses, getInventoryCodeByModel, initDatabase, type QRCodeRule } from '@/utils/database';
import { shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { fetchCurrentStockByInventoryCode, type CurrentStockQueryResult } from '@/utils/erpCurrentStock';
import { clearStockQuerySession } from '@/utils/stockQuerySession';

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
jest.mock('@/components/AppPressable', () => ({ AppPressable: 'AccountButton' }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'ScanInput' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/qrcodeParser', () => ({ isQRCode: () => true, shouldWaitForQRCodeContinuation: jest.fn(() => false) }));
jest.mock('@/utils/feedback', () => ({ feedbackNotBound: jest.fn(), feedbackQueryFailed: jest.fn(), feedbackQuerySuccess: jest.fn() }));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(async () => undefined), getActiveRules: jest.fn(async () => []),
  getAllWarehouses: jest.fn(async () => []),
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
const reenterStockQuery = async () => {
  await act(async () => { root.unmount(); });
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
};
const selectAccount = async (label: string) => {
  const button = root.root.findAllByType('AccountButton' as never)
    .find(node => node.props.children?.props?.children === label);
  expect(button).toBeDefined();
  await act(async () => { button!.props.onPress(); });
};
const scan = async (code: string) => {
  await act(async () => {
    input().props.onChangeText(code);
    input().props.onSubmitEditing({ nativeEvent: { text: code } });
  });
};
const visibleText = (node: ReactTestRendererJSON | string | null): string => {
  if (typeof node === 'string') return node;
  if (node?.type === 'Empty') return node.props.title;
  return node?.children?.map(visibleText).join(' ') ?? '';
};
const visibleScreen = () => {
  const rendered = root.toJSON();
  return Array.isArray(rendered) ? rendered.map(visibleText).join(' ') : visibleText(rendered);
};
const stockResult = (
  inventoryCode: string,
  accountKey: CurrentStockQueryResult['accountKey'] = 'shanghai-chipmunk',
): CurrentStockQueryResult => ({
  accountKey,
  accountName: accountKey,
  inventoryCode,
  rows: [{
    availableQuantity: 3,
    inventoryCode,
    inventoryName: inventoryCode,
    quantity: 3,
    raw: {},
    specification: `${inventoryCode}规格`,
    warehouseCode: 'W01',
    warehouseName: '测试仓库',
  }],
});
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.clearAllMocks();
  clearStockQuerySession();
  jest.mocked(fetchCurrentStockByInventoryCode).mockReset().mockResolvedValue({
    accountKey: 'shanghai-chipmunk', accountName: '上海花栗鼠', inventoryCode: 'INV', rows: [],
  });
  jest.mocked(initDatabase).mockResolvedValue(undefined);
  jest.mocked(getActiveRules).mockResolvedValue([]);
  jest.mocked(getAllWarehouses).mockReset().mockResolvedValue([]);
  jest.mocked(getInventoryCodeByModel).mockReset().mockResolvedValue('INV');
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

it('restores the last selected account and its result after leaving, with independent snapshots for both accounts', async () => {
  jest.mocked(fetchCurrentStockByInventoryCode)
    .mockResolvedValueOnce(stockResult('SHANGHAI-RESULT'))
    .mockResolvedValueOnce(stockResult('WUXI-RESULT', 'wuxi-duneng'));
  await scan('SHANGHAI/10/SCAN');
  expect(visibleScreen()).toContain('SHANGHAI-RESULT规格');
  expect(visibleScreen()).toContain('上次查询');

  await selectAccount('无锡笃能');
  expect(visibleScreen()).not.toContain('SHANGHAI-RESULT规格');
  await scan('WUXI/10/SCAN');
  expect(visibleScreen()).toContain('WUXI-RESULT规格');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenNthCalledWith(1, expect.objectContaining({ key: 'shanghai-chipmunk' }), 'INV');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenNthCalledWith(2, expect.objectContaining({ key: 'wuxi-duneng' }), 'INV');

  await reenterStockQuery();
  expect(visibleScreen()).toContain('WUXI-RESULT规格');
  expect(visibleScreen()).not.toContain('SHANGHAI-RESULT规格');
  await selectAccount('上海花栗鼠');
  expect(visibleScreen()).toContain('SHANGHAI-RESULT规格');
  expect(visibleScreen()).not.toContain('WUXI-RESULT规格');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});

it('shows every positive warehouse in the current account without loading the global warehouse picker', async () => {
  jest.mocked(getAllWarehouses).mockResolvedValue([
    { id: 'OTHER-ACCOUNT', name: '无锡笃能的无锡仓库' },
  ]);
  const result = stockResult('RES.01470052.00');
  const baseRow = result.rows[0];
  jest.mocked(getInventoryCodeByModel).mockResolvedValueOnce('RES.01470052.00');
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValueOnce({
    ...result,
    rows: [
      { ...baseRow, warehouseCode: '001', warehouseName: '无锡总仓', quantity: 21 },
      { ...baseRow, warehouseCode: '101', warehouseName: '翰哲仓', quantity: 32 },
      { ...baseRow, warehouseCode: '002', warehouseName: '零库存仓', quantity: 0 },
      { ...baseRow, warehouseCode: '003', warehouseName: '负库存仓', quantity: -1 },
      { ...baseRow, warehouseCode: '004', warehouseName: '未知数量仓', quantity: null },
    ],
  });
  await scan('CURRENT/10/SCAN');
  const screen = visibleScreen();
  expect(screen).toContain('无锡总仓');
  expect(screen).toContain('翰哲仓');
  expect(screen).toContain('001');
  expect(screen).toContain('101');
  expect(screen).toMatch(/现存量合计\s+53/);
  expect(screen).toMatch(/2\s+仓库/);
  expect(screen).not.toContain('零库存仓');
  expect(screen).not.toContain('负库存仓');
  expect(screen).not.toContain('未知数量仓');
  expect(screen).not.toContain('查询范围');
  expect(screen).not.toContain('无锡笃能的无锡仓库');
  expect(root.root.findAllByProps({ accessibilityLabel: '选择查询仓库' })).toHaveLength(0);
  expect(getAllWarehouses).not.toHaveBeenCalled();
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledWith(expect.objectContaining({ key: 'shanghai-chipmunk' }), 'RES.01470052.00');
  await reenterStockQuery();
  expect(visibleScreen()).toMatch(/现存量合计\s+53/);
  expect(visibleScreen()).toContain('翰哲仓');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});

it('applies current-account positive-stock display to the other account too', async () => {
  await selectAccount('无锡笃能');
  const result = stockResult('WUXI-STOCK', 'wuxi-duneng');
  const baseRow = result.rows[0];
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValueOnce({ ...result, rows: [
    { ...baseRow, warehouseCode: '001', warehouseName: '无锡仓库', quantity: 5 },
    { ...baseRow, warehouseCode: '002', warehouseName: '苏州仓', quantity: 7 },
    { ...baseRow, warehouseCode: '003', warehouseName: '无库存仓', quantity: 0 },
  ] });
  await scan('OTHER/10/SCAN');
  expect(visibleScreen()).toMatch(/现存量合计\s+12/);
  expect(visibleScreen()).toContain('无锡仓库');
  expect(visibleScreen()).toContain('苏州仓');
  expect(visibleScreen()).not.toContain('无库存仓');
  await selectAccount('上海花栗鼠');
  expect(visibleScreen()).not.toContain('无锡仓库');
  expect(visibleScreen()).not.toContain('苏州仓');
  expect(visibleScreen()).toContain('等待查询');
  await reenterStockQuery();
  await selectAccount('无锡笃能');
  expect(visibleScreen()).toContain('无锡仓库');
  expect(visibleScreen()).toContain('苏州仓');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
});

it('rejects mismatched ERP account results without polluting either account snapshot', async () => {
  jest.mocked(fetchCurrentStockByInventoryCode)
    .mockResolvedValueOnce(stockResult('SAVED-SHANGHAI'))
    .mockResolvedValueOnce(stockResult('WRONG-ACCOUNT', 'wuxi-duneng'));
  await scan('VALID/10/SCAN');
  await scan('MISMATCH/10/SCAN');
  expect(visibleScreen()).toContain('ERP返回的账套与当前账套不一致');
  expect(visibleScreen()).not.toContain('WRONG-ACCOUNT规格');
  await reenterStockQuery();
  expect(visibleScreen()).toContain('SAVED-SHANGHAI规格');
  await selectAccount('无锡笃能');
  expect(visibleScreen()).toContain('等待查询');
  expect(visibleScreen()).not.toContain('WRONG-ACCOUNT规格');
});

it('shows a clear empty state when the current account has no positive stock', async () => {
  const result = stockResult('NO-POSITIVE-STOCK');
  jest.mocked(fetchCurrentStockByInventoryCode).mockResolvedValueOnce({ ...result, rows: result.rows.map(row => ({ ...row, quantity: 0 })) });
  await scan('EMPTY/10/SCAN');
  expect(visibleScreen()).toContain('当前账套暂无可显示的库存');
  expect(visibleScreen()).toMatch(/0\s+仓库/);
  expect(visibleScreen()).not.toContain('测试仓库');
});

it('submits a new scan through the normal query and replaces the restored snapshot', async () => {
  const fresh = deferred<CurrentStockQueryResult>();
  jest.mocked(fetchCurrentStockByInventoryCode)
    .mockResolvedValueOnce(stockResult('OLD-RESULT'))
    .mockReturnValueOnce(fresh.promise);
  await scan('FIRST/10/SCAN');
  await reenterStockQuery();
  expect(visibleScreen()).toContain('OLD-RESULT规格');

  await scan('SECOND/10/SCAN');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
  expect(visibleScreen()).toContain('正在读取ERP库存');
  expect(visibleScreen()).not.toContain('OLD-RESULT规格');
  await act(async () => { fresh.resolve(stockResult('FRESH-RESULT')); });
  await reenterStockQuery();
  expect(visibleScreen()).toContain('FRESH-RESULT规格');
  expect(visibleScreen()).not.toContain('OLD-RESULT规格');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});

it('shows a new query error without presenting an old result as the latest query', async () => {
  const failed = deferred<CurrentStockQueryResult>();
  jest.mocked(fetchCurrentStockByInventoryCode)
    .mockResolvedValueOnce(stockResult('PREVIOUS-SUCCESS'))
    .mockReturnValueOnce(failed.promise);
  await scan('SUCCESS/10/SCAN');
  await scan('FAILURE/10/SCAN');
  await act(async () => { failed.reject(new Error('当前查询失败')); });
  expect(visibleScreen()).toContain('当前查询失败');
  expect(visibleScreen()).not.toContain('PREVIOUS-SUCCESS规格');

  await reenterStockQuery();
  expect(visibleScreen()).toContain('PREVIOUS-SUCCESS规格');
  expect(visibleScreen()).toContain('上次查询');
  expect(visibleScreen()).not.toContain('当前查询失败');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});

it('ignores an earlier route response after switching account and completing a new query', async () => {
  const late = deferred<CurrentStockQueryResult>();
  jest.mocked(fetchCurrentStockByInventoryCode)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(stockResult('OTHER-ACCOUNT-RESULT', 'wuxi-duneng'));
  await scan('OLD/10/SCAN');
  await reenterStockQuery();
  await selectAccount('无锡笃能');
  await scan('NEW/10/SCAN');
  await act(async () => { late.resolve(stockResult('LATE-RESULT')); });
  expect(visibleScreen()).toContain('OTHER-ACCOUNT-RESULT规格');
  expect(visibleScreen()).not.toContain('LATE-RESULT规格');

  await selectAccount('上海花栗鼠');
  expect(visibleScreen()).toContain('等待查询');
  expect(visibleScreen()).not.toContain('LATE-RESULT规格');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
});
