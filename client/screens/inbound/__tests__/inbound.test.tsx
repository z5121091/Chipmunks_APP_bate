import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InboundScreen from '../index';
import PurchaseReceiveScreen from '../../purchase-receive';
import InventoryScreen from '../../inventory';
import StockQueryScreen from '../../stock-query';
import * as database from '@/utils/database';
import * as erp from '@/utils/erpPurchaseReceive';
import { ERP_ACCOUNTS } from '@/utils/erpAccounts';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { UiPageHeader, UiToolbarButton } from '@/components/UiRedesign';
import { feedbackSuccess, feedbackInboundComplete, feedbackError, feedbackWarning, feedbackClear, feedbackClearFailed, feedbackNotBound, feedbackQueryFailed, feedbackQuerySuccess } from '@/utils/feedback';
import { fetchCurrentStockByInventoryCode } from '@/utils/erpCurrentStock';
import { useToast } from '@/utils/toast';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { AppModalActions } from '@/components/AppModalActions';
import { getInventoryCodeLookupKey, reconcileInventoryRecords } from '@/utils/inventoryReconciliation';
import { logger } from '@/utils/logger';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => {
  const router = { back: jest.fn(), push: jest.fn() };
  return {
    useSafeRouter: () => router,
    useSafeSearchParams: () => ({ accountKey: 'shanghai-chipmunk', voucherCode: 'II-2026-09-06-01' }),
  };
});
jest.mock('@/hooks/useTheme', () => {
  const theme = jest.requireActual('@/constants/theme').Colors.light;
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('../../purchase-receive/styles', () => ({ createStyles: () => ({}) }));
jest.mock('../../inventory/styles', () => ({ createStyles: () => ({}) }));
jest.mock('../../stock-query/styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AggregatedRecordItem', () => ({ AggregatedRecordItem: 'Record' }));
jest.mock('@/components/UiRedesign', () => ({
  UiPageHeader: 'Header', UiWorkflowSummary: 'Summary', UiSafeBottomBar: 'Bar', UiToolbarButton: 'Button',
}));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'ScanInput' }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showAlert: jest.fn(), showConfirm: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/ruleConflictDiagnosis', () => ({
  buildRuleConflictDiagnostic: jest.fn(),
  formatRuleConflictDiagnostic: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/toast', () => {
  const toast = { showToast: jest.fn(), ToastContainer: () => null };
  return { useToast: () => toast };
});
jest.mock('@/utils/feedback', () => ({
  feedbackSuccess: jest.fn(), feedbackError: jest.fn(), feedbackWarning: jest.fn(),
  feedbackDuplicate: jest.fn(), feedbackClear: jest.fn(), feedbackInboundComplete: jest.fn(),
  feedbackNotBound: jest.fn(), feedbackNotInOrder: jest.fn(), feedbackOverQuantity: jest.fn(),
  feedbackQuerySuccess: jest.fn(), feedbackQueryFailed: jest.fn(), feedbackClearFailed: jest.fn(),
  useFeedbackCleanup: jest.fn(),
}));
jest.mock('@/utils/excel', () => ({ formatSyncErrorMessage: jest.fn(), syncExcelToComputer: jest.fn() }));
jest.mock('@/utils/erpPurchaseReceive', () => ({
  ...jest.requireActual('@/utils/erpPurchaseReceive'),
  fetchPurchaseReceiveVoucher: jest.fn(), fetchPurchaseReceiveVoucherStatuses: jest.fn(),
  loadCachedPurchaseReceiveVoucher: jest.fn(), loadCachedPurchaseReceiveVoucherStatuses: jest.fn(),
  savePurchaseReceiveVoucherCache: jest.fn(), savePurchaseReceiveVoucherStatusesCache: jest.fn(),
  fetchAllPendingPurchaseReceives: jest.fn(), loadCachedPendingPurchaseReceives: jest.fn(),
  savePendingPurchaseReceivesCache: jest.fn(),
}));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(),
  getAllWarehouses: jest.fn(), getInboundRecordsByNo: jest.fn(), getInboundDocumentSummaries: jest.fn(),
  getInventoryCodeByModel: jest.fn(), addInboundRecordsBatch: jest.fn(),
  getActiveRules: jest.fn(), detectRule: jest.fn(), parseWithRule: jest.fn(),
  QRCodeRuleConflictError: class QRCodeRuleConflictError extends Error {},
  generateId: jest.fn(), updateInboundDocumentSyncStatus: jest.fn(),
  generateCheckNo: jest.fn(), addInventoryCheckRecordsBatch: jest.fn(), updateInventoryCheckDocumentSyncStatus: jest.fn(),
}));
jest.mock('@/utils/inventoryReconciliation', () => ({
  ...jest.requireActual('@/utils/inventoryReconciliation'), reconcileInventoryRecords: jest.fn(),
}));
jest.mock('@/utils/erpCurrentStock', () => ({ fetchCurrentStockByInventoryCode: jest.fn() }));

const account = ERP_ACCOUNTS.find(item => item.key === 'shanghai-chipmunk')!;
const no = 'II-2026-09-06-01';
const warehouse = { id: 'W1', name: account.expectedWarehouseName, is_default: true, created_at: '' };
const draftKey = `inbound_scan_records:${account.key}:${warehouse.id}:${no}`;
const voucher = (quantity = 300) => erp.mapPurchaseReceiveVoucher(account, {
  Code: no, Partner: { Name: 'Demo supplier' }, Warehouse: { Name: warehouse.name },
  VoucherState: { Code: '00', Name: '未审' },
  RDRecordDetails: [{ Inventory: { Code: 'A', Specification: 'Model A' }, Quantity: quantity }],
});
let root: TestRenderer.ReactTestRenderer | undefined;
const scanner = () => root!.root.findByType(WarehouseScanInput);
const complete = () => root!.root.findAllByType(UiToolbarButton).find(button => button.props.icon === 'check-circle')!;
async function tick(ms = 200) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
async function mount() {
  await act(async () => { root = TestRenderer.create(<InboundScreen />); });
  await tick();
}
async function scan(code = 'Model A/100') {
  await act(async () => { scanner().props.onChangeText(code); });
  await act(async () => { scanner().props.onSubmitEditing(); });
  await tick();
}
async function refresh() {
  await act(async () => { root!.root.findByType(UiPageHeader).props.onRightPress(); });
  await tick();
}

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(database.getAllWarehouses).mockResolvedValue([warehouse]);
  jest.mocked(database.getInboundRecordsByNo).mockResolvedValue([]);
  jest.mocked(database.getActiveRules).mockResolvedValue([]);
  jest.mocked(buildRuleConflictDiagnostic).mockReset();
  jest.mocked(formatRuleConflictDiagnostic).mockReset().mockReturnValue('规则冲突诊断');
  jest.mocked(database.generateCheckNo).mockResolvedValue('COUNT-TEST');
  jest.mocked(database.addInventoryCheckRecordsBatch).mockReset().mockRejectedValue(new Error('TEST-SAVE-STOP'));
  jest.mocked(reconcileInventoryRecords).mockResolvedValue({ erpQuantityByInventoryCode: new Map([[getInventoryCodeLookupKey('A'), 100000]]), queryCount: 1, batchCount: 1 });
  jest.mocked(database.detectRule).mockResolvedValue({ id: 'rule', name: 'Rule', separator: '/' } as database.QRCodeRule);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '100' }, customFields: {} });
  jest.mocked(database.getInventoryCodeByModel).mockResolvedValue('A');
  jest.mocked(fetchCurrentStockByInventoryCode).mockReset().mockResolvedValue({
    inventoryCode: 'A', rows: [],
  } as Awaited<ReturnType<typeof fetchCurrentStockByInventoryCode>>);
  jest.mocked(database.generateId).mockImplementation(() => `scan-${jest.mocked(database.generateId).mock.calls.length}`);
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockReset().mockResolvedValue(voucher());
  jest.mocked(erp.fetchPurchaseReceiveVoucherStatuses).mockResolvedValue([]);
  jest.mocked(erp.loadCachedPurchaseReceiveVoucher).mockResolvedValue(null);
  jest.mocked(erp.loadCachedPurchaseReceiveVoucherStatuses).mockResolvedValue(null);
  jest.mocked(database.getInboundDocumentSummaries).mockResolvedValue([]);
  jest.mocked(erp.fetchAllPendingPurchaseReceives).mockResolvedValue({ items: [], pageIndex: 0, totalCount: 0, totalPageNum: 0 });
  jest.mocked(erp.loadCachedPendingPurchaseReceives).mockResolvedValue(null);
  jest.mocked(erp.savePendingPurchaseReceivesCache).mockImplementation(async (_key, data) => ({ data, cachedAt: new Date().toISOString() }));
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.useRealTimers();
});

describe.each([
  ['inbound', InboundScreen],
  ['inventory', InventoryScreen],
] as const)('%s material input', (_name, Screen) => {
  it('consumes same-event Enter once and accepts repeated physical scans without a trace number', async () => {
    await act(async () => { root = TestRenderer.create(<Screen />); });
    await tick();
    for (let index = 0; index < 2; index++) {
      await act(async () => {
        const props = scanner().props;
        props.onChangeText('Model A/100');
        props.onSubmitEditing();
        props.onSubmitEditing();
      });
      await tick();
      expect(scanner().props.value).toBe('');
      expect(feedbackSuccess).toHaveBeenCalledTimes(index + 1);
    }
    await act(async () => { scanner().props.onChangeText('Model A/100'); });
    await tick();
    await act(async () => { scanner().props.onSubmitEditing(); });
    await tick();
    expect(feedbackSuccess).toHaveBeenCalledTimes(3);
    expect(database.parseWithRule).toHaveBeenCalledTimes(3);
  });

  it('silently clears separator-free scans before parsing, and accepts the next QR', async () => {
    await act(async () => { root = TestRenderer.create(<Screen />); });
    await tick(1000);
    jest.clearAllMocks();
    for (const code of ['123', 'IC.00000305.01', 'ABC-123', '123\r\n']) {
      await scan(code);
      expect(scanner().props.value).toBe('');
    }
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(database.getInventoryCodeByModel).not.toHaveBeenCalled();
    expect(feedbackSuccess).not.toHaveBeenCalled();
    expect(feedbackWarning).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();
    expect(useToast().showToast).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
    expect(erp.fetchPurchaseReceiveVoucher).not.toHaveBeenCalled();
    await scan();
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });

  it('keeps configured space separators and reports unmatched structured codes', async () => {
    const rule = { id: 'space', name: 'Space', separator: ' ' } as database.QRCodeRule;
    jest.mocked(database.getActiveRules).mockResolvedValue([rule]);
    jest.mocked(database.detectRule).mockResolvedValue(rule);
    await act(async () => { root = TestRenderer.create(<Screen />); });
    await tick();
    await scan('MD85E33YA2 100');
    expect(database.detectRule).toHaveBeenCalledWith('MD85E33YA2 100', [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    jest.mocked(database.detectRule).mockResolvedValue(null);
    await scan('Unknown/100');
    expect(feedbackError).toHaveBeenCalledTimes(1);
  });
});

it('shows a read-only diagnostic for a true rule conflict without saving inbound data', async () => {
  await mount();
  const ConflictError = database.QRCodeRuleConflictError as unknown as new (message?: string) => Error;
  jest.mocked(database.detectRule).mockRejectedValueOnce(new ConflictError('规则冲突'));
  jest.mocked(buildRuleConflictDiagnostic).mockResolvedValue({
    candidates: [{
      ruleId: 'rule-a',
      ruleName: '候选规则 A',
      model: 'Model A',
      version: '',
      inventoryCode: 'A',
      isInCurrentDocument: true,
    }],
    hiddenCandidateCount: 0,
  });

  await scan('Model A/100');

  expect(buildRuleConflictDiagnostic).toHaveBeenCalledWith(
    'Model A/100',
    [],
    expect.objectContaining({ isInventoryCodeInCurrentDocument: expect.any(Function) })
  );
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '解析规则冲突',
    '规则冲突诊断',
    expect.any(Array),
    'warning'
  );
  expect(feedbackWarning).toHaveBeenCalled();
});

it('silently ignores even short one-dimensional stock scans without clearing the previous result', async () => {
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
  await tick();
  await scan();
  jest.clearAllMocks();
  for (const code of ['1', '123', 'IC.00000305.01', 'ABC-123', '123\r\n']) {
    await act(async () => { scanner().props.onChangeText(code); });
    await tick();
    await act(async () => { scanner().props.onSubmitEditing(); });
    expect(scanner().props.value).toBe('');
  }
  expect(database.detectRule).not.toHaveBeenCalled();
  expect(database.getInventoryCodeByModel).not.toHaveBeenCalled();
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  expect(feedbackQuerySuccess).not.toHaveBeenCalled();
  expect(feedbackQueryFailed).not.toHaveBeenCalled();
  expect(feedbackNotBound).not.toHaveBeenCalled();
  expect(feedbackClear).not.toHaveBeenCalled();
  expect(root!.root.findAllByType(Text).some(text => text.props.children === 'A')).toBe(true);
});

it.each(ERP_ACCOUNTS)('queries only the selected account $key and announces one success per query', async selected => {
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
  if (selected.key !== ERP_ACCOUNTS[0].key) await switchAccount();
  // Same-event Enter must read the latest input even before React re-renders.
  await act(async () => {
    const props = scanner().props;
    props.onChangeText('Model A/100');
    props.onSubmitEditing();
    props.onSubmitEditing();
  });
  await tick();
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledWith(selected, 'A');
  expect(feedbackQuerySuccess).toHaveBeenCalledTimes(1);
  expect(feedbackQueryFailed).not.toHaveBeenCalled();
  await act(async () => { scanner().props.onChangeText('Model A/100'); });
  await tick(149);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(2);
  expect(feedbackQuerySuccess).toHaveBeenCalledTimes(2);
  expect(database.getActiveRules).toHaveBeenCalledTimes(1);
});

it('shows ERP query results without a local batch ledger', async () => {
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
  await scan();
  const text = root!.root.findAllByType(Text).map(node => node.props.children);
  expect(text).not.toContain('已登记批次');
  expect(text).not.toContain('批次号');
  expect(feedbackQuerySuccess).toHaveBeenCalledTimes(1);
});

it('keeps parsed batches immutable and confirms only scanned packages without a full-count option', async () => {
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
    model: 'Model A', quantity: '100', batch: 'PARSED-BATCH', traceNo: 'PARSED-TRACE', productionDate: '2617',
  }, customFields: {} });
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await tick(1000);
  await scan('Model A/PARSED-BATCH/100/PARSED-TRACE');
  await act(async () => { complete().props.onPress(); });
  expect(root!.root.findAllByType(TouchableOpacity).filter(node => node.props.accessibilityRole === 'checkbox')).toHaveLength(0);
  expect(scanner().props.autoFocus).toBe(false);
  // Scanner input is blocked while the confirmation is open.
  const parsedCount = jest.mocked(database.parseWithRule).mock.calls.length;
  await scan('DO-NOT-ACCEPT/100');
  expect(database.parseWithRule).toHaveBeenCalledTimes(parsedCount);
  await act(async () => {
    root!.root.findAllByType(AppModalActions).find(node => node.props.primaryLabel === '确认完成')!.props.onPrimaryPress();
  });
  await tick();
  expect(logger.error).toHaveBeenLastCalledWith('[库存盘点] 保存失败:', new Error('TEST-SAVE-STOP'));
  expect(database.addInventoryCheckRecordsBatch).toHaveBeenCalledWith(
    [expect.objectContaining({ batch: 'PARSED-BATCH', traceNo: 'PARSED-TRACE', productionDate: '2617', quantity: 100, erp_quantity: 100000 })]
  );
});

it('distinguishes unbound stock labels, unmatched rules and failed ERP queries', async () => {
  const spaceRule = { id: 'space', name: 'Space', separator: ' ' } as database.QRCodeRule;
  jest.mocked(database.getActiveRules).mockResolvedValue([spaceRule]);
  jest.mocked(database.getInventoryCodeByModel).mockResolvedValueOnce(null);
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
  await scan('MODEL 100');
  expect(feedbackNotBound).toHaveBeenCalledTimes(1);
  expect(fetchCurrentStockByInventoryCode).not.toHaveBeenCalled();
  expect(feedbackQueryFailed).not.toHaveBeenCalled();
  jest.mocked(database.detectRule).mockResolvedValueOnce(null);
  await scan('Unknown/100');
  expect(feedbackQueryFailed).toHaveBeenCalledTimes(1);
  jest.mocked(fetchCurrentStockByInventoryCode).mockRejectedValueOnce(new Error('network unavailable'));
  await scan();
  expect(feedbackQueryFailed).toHaveBeenCalledTimes(2);
  expect(feedbackQuerySuccess).not.toHaveBeenCalled();
  await scan();
  expect(feedbackQuerySuccess).toHaveBeenCalledTimes(1);
});

it('does not announce a late stock response after leaving the page', async () => {
  let finish!: (result: Awaited<ReturnType<typeof fetchCurrentStockByInventoryCode>>) => void;
  jest.mocked(fetchCurrentStockByInventoryCode).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { root = TestRenderer.create(<StockQueryScreen />); });
  await scan();
  await act(async () => {
    scanner().props.onChangeText('123');
    scanner().props.onSubmitEditing();
  });
  expect(scanner().props.value).toBe('');
  expect(fetchCurrentStockByInventoryCode).toHaveBeenCalledTimes(1);
  await act(async () => { root!.unmount(); });
  root = undefined;
  await act(async () => { finish({ inventoryCode: 'A', rows: [] } as Awaited<ReturnType<typeof fetchCurrentStockByInventoryCode>>); });
  expect(feedbackQuerySuccess).not.toHaveBeenCalled();
  expect(feedbackQueryFailed).not.toHaveBeenCalled();
});

it.each(['inbound', 'inventory'])('announces %s clear only after storage succeeds and announces failures separately', async name => {
  await act(async () => { root = TestRenderer.create(name === 'inbound' ? <InboundScreen /> : <InventoryScreen />); });
  await tick(1000);
  await scan();
  await tick(1000);
  const pressClear = async () => {
    await act(async () => {
      root!.root.findAllByType(UiToolbarButton).find(button => button.props.icon === 'trash-2')!.props.onPress();
    });
    expect(feedbackClear).not.toHaveBeenCalled();
    await act(async () => { jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2](); });
    await tick();
  };
  if (name === 'inbound') jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error('disk failure'));
  else jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk failure'));
  await pressClear();
  expect(feedbackClearFailed).toHaveBeenCalledTimes(1);
  expect(feedbackClear).not.toHaveBeenCalled();
  if (name === 'inbound') await refresh();
  await pressClear();
  expect(feedbackClear).toHaveBeenCalledTimes(1);
});

it('keeps identical no-trace packages and writes once before each success voice', async () => {
  await mount();
  await scan();
  await scan();
  expect(feedbackSuccess).toHaveBeenCalledTimes(2);
  expect(AsyncStorage.multiSet).toHaveBeenCalledTimes(2);
  expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(2);
  expect(database.getActiveRules).toHaveBeenCalledTimes(1);
  expect(database.getInventoryCodeByModel).toHaveBeenCalledTimes(1);
});

it('does not enable scanning or overwrite a draft when restoration fails', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk read failed'));
  await mount();
  expect(scanner().props.editable).toBe(false);
  await scan();
  expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  await refresh();
  expect(scanner().props.editable).toBe(true);
});

it('preserves corrupt drafts and requires recovery', async () => {
  await AsyncStorage.setItem(draftKey, '{invalid');
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try { await mount(); } finally { log.mockRestore(); }
  expect(scanner().props.editable).toBe(false);
  await scan();
  expect(await AsyncStorage.getItem(draftKey)).toBe('{invalid');
});

it('revokes ERP verification on failure instead of allowing local-only completion', async () => {
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(100));
  await mount();
  await scan();
  const submit = complete().props.onPress;
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockRejectedValueOnce(new Error('ERP unavailable'));
  await refresh();
  expect(complete().props.disabled).toBe(true);
  await act(async () => { await submit(); });
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  await refresh();
  expect(complete().props.disabled).toBe(false);
});

it('waits for durable storage and rejects completion/clear during queued scanning', async () => {
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(300));
  await mount();
  await scan();
  let resolveWrite!: () => void;
  jest.mocked(AsyncStorage.multiSet).mockImplementationOnce(() => new Promise(resolve => { resolveWrite = resolve; }));
  await scan();
  await scan();
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  await act(async () => { await complete().props.onPress(); });
  await act(async () => {
    root!.root.findAllByType(UiToolbarButton).find(button => button.props.icon === 'trash-2')!.props.onPress();
    jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2]();
  });
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  await act(async () => { resolveWrite(); });
  await tick();
  expect(feedbackSuccess).toHaveBeenCalledTimes(3);
  expect(complete().props.disabled).toBe(false);
});

it('stops a failed draft write and clears queued submissions so refresh can recover', async () => {
  await mount();
  let rejectWrite!: (error: Error) => void;
  jest.mocked(AsyncStorage.multiSet).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  await scan();
  await scan();
  await scan();
  await act(async () => { rejectWrite(new Error('disk full')); });
  await tick();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(scanner().props.editable).toBe(false);
  await refresh();
  expect(scanner().props.editable).toBe(true);
  await scan();
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
});

it('revalidates quantities with the selected account and blocks stale completion', async () => {
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(100));
  await mount();
  await scan();
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(200));
  await act(async () => { await complete().props.onPress(); });
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  expect(erp.fetchPurchaseReceiveVoucher).toHaveBeenLastCalledWith(account, no, { bypassCache: true });
  expect(complete().props.disabled).toBe(true);
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('最新明细不一致'), 'warning');
});

it.each(['珠海极海半导体有限公司', '珠海领芯科技有限公司'])(
  'scans, restores and completes %s M-code receipts using the single existing binding', async supplier => {
    const incoming = erp.mapPurchaseReceiveVoucher(account, {
      Code: no, Partner: { Name: supplier }, Warehouse: { Name: warehouse.name },
      VoucherState: { Code: '00', Name: '未审' },
      RDRecordDetails: [{ Inventory: { Code: 'IC.M0000255.00', Specification: 'Model A' }, Quantity: 100 }],
    });
    jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(incoming);
    jest.mocked(database.getInventoryCodeByModel).mockResolvedValue('IC.00000255.00');
    jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
      model: 'Model A', version: 'V1', quantity: '100', batch: 'LOT-01', productionDate: '2617', traceNo: 'TRACE-01',
    }, customFields: {} });
    await mount();
    await scan();
    expect(database.getInventoryCodeByModel).toHaveBeenCalledWith('Model A', 'V1');
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(complete().props.disabled).toBe(false);
    await act(async () => { root!.unmount(); });
    root = undefined;
    await mount();
    expect(complete().props.disabled).toBe(false);
    await act(async () => { await complete().props.onPress(); });
    expect(database.addInboundRecordsBatch).toHaveBeenCalledWith([expect.objectContaining({
      erp_account_key: account.key, inventory_code: 'IC.00000255.00', quantity: 100,
      batch: 'LOT-01', productionDate: '2617', traceNo: 'TRACE-01', version: 'V1',
    })]);
    expect(feedbackInboundComplete).toHaveBeenCalledTimes(1);
    expect(incoming.lines[0].inventoryCode).toBe('IC.M0000255.00');
  }
);

it('blocks completion when a refreshed M-code receipt changes to an ineligible supplier', async () => {
  const incoming = { ...voucher(100), partnerName: '珠海极海半导体有限公司' };
  incoming.lines[0].inventoryCode = 'IC.M0000255.00';
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(incoming);
  jest.mocked(database.getInventoryCodeByModel).mockResolvedValue('IC.00000255.00');
  await mount();
  await scan();
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue({ ...incoming, partnerName: '其他供应商' });
  await act(async () => { await complete().props.onPress(); });
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('最新明细不一致'), 'warning');
});

it('keeps removed ERP lines visible and blocks completion after refresh', async () => {
  await mount();
  await scan();
  const updated = voucher(100);
  updated.lines[0].inventoryCode = 'B';
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(updated);
  await refresh();
  expect(root!.root.findAllByType(Text).some(node =>
    Array.isArray(node.props.children) && node.props.children.includes('已不在本单'))).toBe(true);
  expect(complete().props.disabled).toBe(true);
});

it('locks scanning while saving and commits once when confirmation is tapped twice', async () => {
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(100));
  await mount();
  await scan();
  let resolveVoucher!: (value: erp.PurchaseReceiveVoucher) => void;
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockImplementationOnce(() => new Promise(resolve => { resolveVoucher = resolve; }));
  let save!: Promise<void>;
  await act(async () => {
    const submit = complete().props.onPress;
    save = submit();
    await submit();
  });
  expect(scanner().props.editable).toBe(false);
  await scan();
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  await act(async () => { resolveVoucher(voucher(100)); await save; });
  expect(database.addInboundRecordsBatch).toHaveBeenCalledTimes(1);
  expect(database.addInboundRecordsBatch).toHaveBeenCalledWith([expect.objectContaining({
    warehouse_id: 'W1', inbound_no: no, quantity: 100, inventory_code: 'A',
  })]);
  expect(feedbackInboundComplete).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(draftKey)).toBeNull();
});

async function mountList() {
  await act(async () => { root = TestRenderer.create(<PurchaseReceiveScreen />); });
  await tick();
}
async function switchAccount() {
  const other = ERP_ACCOUNTS.find(item => item.key !== account.key)!;
  await act(async () => {
    root!.root.findAllByType(TouchableOpacity).find(node =>
      node.findAllByType(Text).some(text => text.props.children === other.name))!.props.onPress();
  });
  await tick();
}

it('auto-submits a two-digit Shanghai receipt without needing Enter', async () => {
  await mountList();
  await act(async () => { scanner().props.onChangeText(no); });
  await tick();
  expect(erp.fetchPurchaseReceiveVoucher).toHaveBeenCalledWith(account, no, { bypassCache: true });
  expect(useSafeRouter().push).toHaveBeenCalledWith('/inbound', { accountKey: account.key, voucherCode: no });
});

it('keeps the purchase scanner keyboard hidden and clears failed scans before the next same-event Enter', async () => {
  await mountList();
  expect(scanner().props.showSoftInputOnFocus).toBe(false);
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockRejectedValueOnce(new Error('Not found'));
  await act(async () => {
    const props = scanner().props;
    props.onChangeText('II-2026-09-06-99');
    props.onSubmitEditing();
    props.onSubmitEditing();
  });
  await tick();
  expect(erp.fetchPurchaseReceiveVoucher).toHaveBeenCalledTimes(1);
  expect(scanner().props.value).toBe('');
  expect(useSafeRouter().push).not.toHaveBeenCalled();
  await act(async () => {
    const props = scanner().props;
    props.onChangeText(no);
    props.onSubmitEditing();
    props.onSubmitEditing();
  });
  await tick();
  expect(erp.fetchPurchaseReceiveVoucher).toHaveBeenCalledTimes(2);
  expect(erp.fetchPurchaseReceiveVoucher).toHaveBeenLastCalledWith(account, no, { bypassCache: true });
  expect(useSafeRouter().push).toHaveBeenCalledTimes(1);
  expect(scanner().props.value).toBe('');
});

it('cancels pending auto-submit and old detail results when switching accounts', async () => {
  await mountList();
  await act(async () => { scanner().props.onChangeText(no); });
  await switchAccount();
  expect(erp.fetchPurchaseReceiveVoucher).not.toHaveBeenCalled();
  const otherNo = `${no}1`;
  let resolveDetail!: (data: erp.PurchaseReceiveVoucher) => void;
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockImplementationOnce(() => new Promise(resolve => { resolveDetail = resolve; }));
  await act(async () => { scanner().props.onChangeText(otherNo); });
  await tick();
  await act(async () => { root!.unmount(); });
  root = undefined;
  await act(async () => { resolveDetail(voucher()); });
  expect(useSafeRouter().push).not.toHaveBeenCalled();
});

it('refreshes stale lists on foreground but does not add periodic ERP list queries', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  await mountList();
  const callback = listener.mock.calls.find(([event]) => event === 'change')![1];
  await tick(6 * 60_000);
  expect(erp.fetchAllPendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await act(async () => { callback('active'); });
  await tick();
  expect(erp.fetchAllPendingPurchaseReceives).toHaveBeenCalledTimes(2);
  listener.mockRestore();
});
