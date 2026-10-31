import TestRenderer, { act } from 'react-test-renderer';
import { AppState, FlatList, Text, TouchableOpacity } from 'react-native';
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
import { syncExcelToComputer } from '@/utils/excel';
import { STORAGE_KEYS } from '@/constants/config';
import { logger } from '@/utils/logger';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
// These screen unit tests mock navigation; inventory also registers a removal guard.
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
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
  getPendingPurchaseReceivesSnapshot: jest.fn(), revalidatePendingPurchaseReceives: jest.fn(),
}));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(),
  getAllWarehouses: jest.fn(), getInboundRecordsByNo: jest.fn(), getInboundDocumentSummaries: jest.fn(),
  getInventoryCodeByModel: jest.fn(), addInboundRecordsBatch: jest.fn(),
  getInventorySupplierById: jest.fn(), getInventoryBindingByCode: jest.fn(),
  getActiveRules: jest.fn(), detectRule: jest.fn(), parseWithRule: jest.fn(),
  inspectQRCodeRule: jest.requireActual('@/utils/database').inspectQRCodeRule,
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
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
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
  jest.mocked(database.getInventorySupplierById).mockReset();
  jest.mocked(database.getInventoryBindingByCode).mockReset();
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
  jest.mocked(erp.getPendingPurchaseReceivesSnapshot).mockReturnValue(null);
  jest.mocked(erp.revalidatePendingPurchaseReceives).mockImplementation(async () => ({
    data: { items: [], pageIndex: 0, totalCount: 0, totalPageNum: 0 },
    cachedAt: new Date().toISOString(),
  }));
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
  it('keeps a matching but unfinished last field until its continuation and Enter arrive', async () => {
    await act(async () => { root = TestRenderer.create(<Screen />); });
    await tick();
    const rule = { id: 'tail', name: 'Tail', separator: '/', fieldOrder: ['model', 'quantity', 'sourceNo'], isActive: true } as database.QRCodeRule;
    jest.mocked(database.getActiveRules).mockResolvedValue([rule]);
    await act(async () => { scanner().props.onChangeText('Model A/100/BOX-'); });
    await tick(220);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(scanner().props.value).toBe('Model A/100/BOX-');
    await act(async () => {
      scanner().props.onChangeText('Model A/100/BOX-12345');
      scanner().props.onSubmitEditing({ nativeEvent: { text: 'Model A/100/BOX-12345' } });
    });
    await tick();
    expect(database.detectRule).toHaveBeenCalledWith('Model A/100/BOX-12345', [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    await act(async () => { scanner().props.onChangeText('Model A/100/BOX-12345Model A/100/BOX-67890'); });
    await tick(500);
    expect(database.detectRule).toHaveBeenLastCalledWith('Model A/100/BOX-67890', [rule]);
  });

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

describe('inbound rule supplier validation', () => {
  const rule = { id: 'rule-supplier', name: '极海标签', separator: '/', supplierId: 'supplier-apm', supplierName: '极海科技' } as database.QRCodeRule;
  const supplier = { id: 'supplier-apm', name: '极海科技', binding_count: 1, created_at: '' };
  const binding = { id: 'binding-a', scan_model: 'Model A', inventory_code: 'A', version: '', supplier: '极海科技', description: '', created_at: '' };

  it('accepts a matching supplier into the inbound draft before completion', async () => {
    jest.mocked(database.detectRule).mockResolvedValue(rule);
    jest.mocked(database.getInventorySupplierById).mockResolvedValue(supplier);
    jest.mocked(database.getInventoryBindingByCode).mockResolvedValue(binding);
    await mount();
    await scan();
    expect(database.getInventorySupplierById).toHaveBeenCalledWith(supplier.id);
    expect(database.getInventoryBindingByCode).toHaveBeenCalledWith('A');
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toEqual([
      expect.objectContaining({ model: 'Model A', inventoryCode: 'A', quantity: 100 }),
    ]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
    expect(useCustomAlert().showAlert).not.toHaveBeenCalledWith('规则与物料供应商不一致', expect.anything(), expect.anything(), expect.anything());
  });

  it('preserves earlier inbound draft records when the rule and bound material suppliers disagree', async () => {
    await mount();
    await scan();
    const previousDraft = await AsyncStorage.getItem(draftKey);
    const previousWrites = jest.mocked(AsyncStorage.multiSet).mock.calls.length;
    jest.mocked(database.detectRule).mockResolvedValue(rule);
    jest.mocked(database.getInventorySupplierById).mockResolvedValue(supplier);
    jest.mocked(database.getInventoryBindingByCode).mockResolvedValue({ ...binding, supplier: '珠海博雅科技' });
    await scan();
    expect(await AsyncStorage.getItem(draftKey)).toBe(previousDraft);
    expect(AsyncStorage.multiSet).toHaveBeenCalledTimes(previousWrites);
    expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    const alert = jest.mocked(useCustomAlert().showAlert).mock.calls.find(call => call[0] === '规则与物料供应商不一致');
    expect(alert?.[1]).toContain('解析规则「极海标签」所属供应商：极海科技');
    expect(alert?.[1]).toContain('物料绑定中的供应商：珠海博雅科技');
    expect(alert?.[1]).toContain('本次未录入或打印');
    const diagnose = alert?.[2]?.find(button => button.text === '解析诊断');
    expect(diagnose).toBeDefined();
    await act(async () => { diagnose?.onPress?.(); });
    expect(useSafeRouter().push).toHaveBeenCalledWith('/rule-diagnostics', { expectedRuleId: rule.id });
  });

  it('retains compatibility for a legacy supplier note without a formal supplier link', async () => {
    jest.mocked(database.detectRule).mockResolvedValue({ ...rule, supplierId: undefined, supplierName: '历史供应商备注' });
    await mount();
    await scan();
    expect(database.getInventorySupplierById).not.toHaveBeenCalled();
    expect(database.getInventoryBindingByCode).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(1);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('inbound scanner delivery boundaries', () => {
  const completeCode = 'Model A/LOT/100';
  const partialCode = 'Model A/LOT';
  const rule = {
    id: 'three-fields', name: 'Three fields', separator: '/', isActive: true,
    fieldOrder: ['model', 'batch', 'quantity'], matchConditions: [],
  } as database.QRCodeRule;

  const useCompleteRule = () => {
    jest.mocked(database.getActiveRules).mockReset().mockResolvedValue([rule]);
    jest.mocked(database.detectRule).mockReset().mockImplementation(async code =>
      database.inspectQRCodeRule(code, rule).matched ? rule : null
    );
  };

  it('waits for the fallback quiet period when complete packages have no Enter', async () => {
    useCompleteRule();
    await mount();
    await act(async () => { scanner().props.onChangeText(completeCode); });
    await tick(499);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(1);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(database.detectRule).toHaveBeenCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    await act(async () => { scanner().props.onChangeText('Model A/LOT-2/100'); });
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledTimes(2);
    expect(feedbackSuccess).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(2);
  });

  it.each([false, true])('keeps both immediately consecutive Enter-confirmed frames (cumulative=%s)', async cumulative => {
    useCompleteRule();
    await mount();
    const next = 'Model A/LOT-2/100';
    await act(async () => {
      scanner().props.onChangeText(partialCode);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } });
      scanner().props.onChangeText(cumulative ? completeCode + 'Model A/LOT-2' : 'Model A/LOT-2');
      scanner().props.onChangeText(cumulative ? completeCode + next : next);
      scanner().props.onSubmitEditing({ nativeEvent: { text: cumulative ? completeCode + next : next } });
    });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([completeCode, next]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(2);
    expect(scanner().props.value).toBe('');
  });

  it('recovers the next frame when native clear after a quiet-period submission is late', async () => {
    useCompleteRule();
    await mount();
    const next = 'Model A/LOT-2/100';
    await act(async () => { scanner().props.onChangeText(completeCode); });
    await tick(500);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    await act(async () => { scanner().props.onChangeText(completeCode + next); });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([completeCode, next]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(2);
  });

  it('recovers the next frame when native clear after a normal Enter is late', async () => {
    useCompleteRule();
    await mount();
    const next = 'Model A/LOT-2/100';
    await act(async () => {
      scanner().props.onChangeText(completeCode);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } });
    });
    await tick(10);
    await act(async () => {
      scanner().props.onChangeText(completeCode + next);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode + next } });
    });
    await tick(10);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([completeCode, next]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(2);
  });

  it('keeps each confirmed frame boundary while the first rules read is blocked', async () => {
    useCompleteRule();
    let finishRules!: (value: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    await mount();
    const next = 'Model A/LOT-2/100';
    const third = 'Model A/LOT-3/100';
    await act(async () => {
      scanner().props.onChangeText(completeCode);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } });
      scanner().props.onChangeText(completeCode + next);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode + next } });
      scanner().props.onChangeText(completeCode + next + third);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode + next + third } });
    });
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(scanner().props.value).toBe('');
    await act(async () => { finishRules([rule]); });
    await tick(250);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([completeCode, next, third]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(3);
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(3);
  });

  it('uses full native Enter text before the final change event without duplicating that scan', async () => {
    useCompleteRule();
    await mount();
    await act(async () => {
      scanner().props.onChangeText(partialCode);
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } });
      scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } });
    });
    await tick(10);
    await act(async () => { scanner().props.onChangeText(completeCode); });
    await tick(149);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(1);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(database.detectRule).toHaveBeenLastCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
    await act(async () => { scanner().props.onSubmitEditing({ nativeEvent: { text: completeCode } }); });
    await tick();
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);

    // A fresh physical scan of the same no-trace package is still a separate package.
    await scan(completeCode);
    expect(feedbackSuccess).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem(draftKey))!)).toHaveLength(2);
  });

  it('retains a partial QR after a 150ms pause and processes its continuation once', async () => {
    useCompleteRule();
    await mount();
    await act(async () => { scanner().props.onChangeText(partialCode); });
    await tick(151);
    expect(scanner().props.value).toBe(partialCode);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();
    await act(async () => { scanner().props.onChangeText(completeCode); });
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(database.detectRule).toHaveBeenLastCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
    await tick(400);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });

  it('reports a genuinely incomplete unknown QR after the single bounded continuation wait', async () => {
    useCompleteRule();
    await mount();
    await act(async () => { scanner().props.onChangeText('Unknown/LOT'); });
    await tick(499);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(scanner().props.value).toBe('Unknown/LOT');
    await tick(1);
    expect(database.detectRule).toHaveBeenCalledWith('Unknown/LOT', [rule]);
    expect(feedbackError).toHaveBeenCalledTimes(1);
    expect(scanner().props.value).toBe('');
    expect(feedbackSuccess).not.toHaveBeenCalled();
  });

  it('does not let a stale asynchronous completion check clear the next scan', async () => {
    useCompleteRule();
    let finishRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    await mount();
    await act(async () => { scanner().props.onChangeText(partialCode); });
    await tick(150);
    await act(async () => {
      scanner().props.onChangeText(completeCode);
      finishRules([rule]);
    });
    expect(scanner().props.value).toBe(completeCode);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(database.detectRule).toHaveBeenLastCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
  });

  it('does not let a previous page completion check submit or clear the new page input', async () => {
    useCompleteRule();
    let finishRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    await mount();
    await act(async () => { scanner().props.onChangeText(partialCode); });
    await tick(150);
    await act(async () => { root!.unmount(); });
    root = undefined;
    await mount();
    await act(async () => {
      scanner().props.onChangeText(completeCode);
      finishRules([rule]);
    });
    expect(scanner().props.value).toBe(completeCode);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
  });

  it('waits for first-use rules before parsing a complete Enter scan', async () => {
    useCompleteRule();
    let finishRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    await mount();
    await scan(completeCode);
    expect(database.getActiveRules).toHaveBeenCalledTimes(1);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();
    await act(async () => { finishRules([rule]); });
    await tick();
    expect(database.detectRule).toHaveBeenCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
  });

  it('ignores a delayed Enter from a different QR without cancelling the current timer', async () => {
    useCompleteRule();
    await mount();
    await act(async () => {
      scanner().props.onChangeText(completeCode);
      scanner().props.onSubmitEditing({ nativeEvent: { text: 'Other/LOT/100' } });
    });
    expect(scanner().props.value).toBe(completeCode);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledWith(completeCode, [rule]);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });
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

it('keeps a verified inbound draft visible when its inventory lookup fails, then recovers on refresh', async () => {
  const records = [{ id: 'saved-scan', model: 'Model A', batch: '', quantity: 100, scanTime: '', rawContent: 'Model A/100' }];
  await AsyncStorage.setItem(draftKey, JSON.stringify(records));
  await AsyncStorage.setItem(draftKey.replace('scan_records', 'pending_data'), JSON.stringify({
    inboundNo: no, warehouseId: warehouse.id, accountKey: account.key,
  }));
  jest.mocked(database.getInventoryCodeByModel).mockRejectedValueOnce(new Error('NativeDatabase.getFirstAsync failed'));

  await mount();
  expect(scanner().props.editable).toBe(false);
  const hasDraftRecord = () => root!.root.findAllByType(FlatList).some(list =>
    list.props.data?.some((item: { records?: { id: string }[]; scannedRecords?: { id: string }[] }) =>
      (item.records || item.scannedRecords)?.some(record => record.id === 'saved-scan'))
  );
  expect(hasDraftRecord()).toBe(true);
  expect(await AsyncStorage.getItem(draftKey)).toBe(JSON.stringify(records));

  await refresh();
  expect(scanner().props.editable).toBe(true);
  expect(hasDraftRecord()).toBe(true);
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
  expect(complete().props.disabled).toBe(false);
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith('本单尚未扫齐', expect.any(String), expect.any(Array), 'warning');
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
    })], { completionStatus: 'complete', expectedSavedIds: [] });
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
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('不在ERP单内'), 'error');
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
  const removalGuard = jest.requireMock('expo-router/react-navigation').usePreventRemove;
  expect(removalGuard.mock.calls.at(-1)[0]).toBe(true);
  jest.mocked(useSafeRouter().back).mockImplementationOnce(() => {
    expect(removalGuard.mock.calls.at(-1)[0]).toBe(false);
  });
  await act(async () => { resolveVoucher(voucher(100)); await save; });
  expect(useSafeRouter().back).toHaveBeenCalledTimes(1);
  expect(database.addInboundRecordsBatch).toHaveBeenCalledTimes(1);
  expect(database.addInboundRecordsBatch).toHaveBeenCalledWith([expect.objectContaining({
    warehouse_id: 'W1', inbound_no: no, quantity: 100, inventory_code: 'A',
  })], { completionStatus: 'complete', expectedSavedIds: [] });
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

it('checks the daily pending list on resume and polls only local statuses while foreground and idle', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  await mountList();
  const callback = listener.mock.calls.find(([event]) => event === 'change')![1];
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await act(async () => { callback('background'); });
  await tick(60_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(1);
  await act(async () => { callback('active'); });
  await tick();
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  await tick(30_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(3);
  await act(async () => { scanner().props.onChangeText('II-'); });
  await tick(30_000);
  expect(erp.revalidatePendingPurchaseReceives).toHaveBeenCalledTimes(2);
  expect(erp.fetchPurchaseReceiveVoucherStatuses).toHaveBeenCalledTimes(3);
  AppState.currentState = previousState;
  listener.mockRestore();
});


it('saves a partial receipt only after confirmation and speaks the partial outcome', async () => {
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(200));
  await mount();
  await scan();
  expect(complete().props.disabled).toBe(false);
  expect(complete().props.label).toBe('保存本次入库');
  await act(async () => { complete().props.onPress(); });
  expect(database.addInboundRecordsBatch).not.toHaveBeenCalled();
  const buttons = jest.mocked(useCustomAlert().showAlert).mock.calls.at(-1)![2]!;
  expect(buttons.map(button => button.text)).toEqual(['继续扫码', '保存本次入库']);
  await act(async () => { await buttons[1].onPress!(); });
  expect(database.addInboundRecordsBatch).toHaveBeenCalledWith(expect.any(Array), { completionStatus: 'partial', expectedSavedIds: [] });
  expect(feedbackInboundComplete).toHaveBeenCalledWith(false);
  expect(useSafeRouter().back).toHaveBeenCalledTimes(1);
});

it('resumes saved quantity, exports the full cumulative receipt and only saves new rows', async () => {
  const previous = { id: 'previous-package', inbound_no: no, warehouse_id: warehouse.id,
    warehouse_name: warehouse.name, erp_account_key: account.key, inventory_code: 'A', scan_model: 'Model A',
    batch: 'B', quantity: 60, in_date: '2026-10-31', created_at: '', traceNo: 'PREVIOUS-TRACE', completion_status: 'partial' as const };
  jest.mocked(database.getInboundRecordsByNo).mockResolvedValue([previous]);
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(100));
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '40', traceNo: 'NEW-TRACE' }, customFields: {} });
  await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1' }));
  jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true, fileName: 'receipt.xlsx' });
  await mount();
  await scan();
  expect(complete().props.label).toBe('完成入库');
  await act(async () => { await complete().props.onPress(); });
  expect(database.addInboundRecordsBatch).toHaveBeenCalledWith([expect.objectContaining({ quantity: 40, traceNo: 'NEW-TRACE' })],
    { completionStatus: 'complete', expectedSavedIds: [previous.id] });
  expect(feedbackInboundComplete).toHaveBeenCalledWith(true);
  const exported = JSON.stringify(jest.mocked(syncExcelToComputer).mock.calls.at(-1)![0]);
  expect(exported).toContain('PREVIOUS-TRACE');
  expect(exported).toContain('NEW-TRACE');
});

it('does not announce success or leave when partial persistence fails', async () => {
  jest.mocked(database.addInboundRecordsBatch).mockRejectedValueOnce(new Error('disk full'));
  await mount();
  await scan();
  await act(async () => { complete().props.onPress(); });
  const buttons = jest.mocked(useCustomAlert().showAlert).mock.calls.at(-1)![2]!;
  await act(async () => { await buttons[1].onPress!(); });
  expect(feedbackInboundComplete).not.toHaveBeenCalled();
  expect(useSafeRouter().back).not.toHaveBeenCalled();
  expect(complete().props.disabled).toBe(false);
});


it.each(['partial', 'complete', undefined] as const)('purchase lookup only reopens partial receipts (state=%s)', async status => {
  jest.mocked(database.getInboundDocumentSummaries).mockResolvedValue([{
    inbound_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    in_date: '', created_at: '', record_count: 1, model_count: 1, total_quantity: 60,
    sync_status: 'success', completion_status: status,
  }]);
  await mountList();
  await scan(no);
  if (status === 'partial') expect(useSafeRouter().push).toHaveBeenCalledWith('/inbound', { accountKey: account.key, voucherCode: no });
  else expect(useSafeRouter().push).not.toHaveBeenCalled();
});

it('drops a previously committed package from stale draft recovery and retains only new scans', async () => {
  const previous = { id: 'previous-package', inbound_no: no, warehouse_id: warehouse.id,
    warehouse_name: warehouse.name, erp_account_key: account.key, inventory_code: 'A', scan_model: 'Model A',
    batch: '', quantity: 60, in_date: '', created_at: '', traceNo: 'PREVIOUS', completion_status: 'partial' as const };
  jest.mocked(database.getInboundRecordsByNo).mockResolvedValue([previous]);
  jest.mocked(erp.fetchPurchaseReceiveVoucher).mockResolvedValue(voucher(100));
  await AsyncStorage.setItem(draftKey, JSON.stringify([{ id: previous.id, model: 'Model A', batch: '', quantity: 60, scanTime: '', rawContent: 'Model A/60', inventoryCode: 'A' }]));
  await AsyncStorage.setItem(draftKey.replace('scan_records', 'pending_data'), JSON.stringify({
    inboundNo: no, warehouseId: warehouse.id, accountKey: account.key,
  }));
  await mount();
  expect(root!.root.findAllByType(UiToolbarButton).filter(button => button.props.icon === 'check-circle')).toHaveLength(0);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '40' }, customFields: {} });
  await scan();
  await act(async () => { await complete().props.onPress(); });
  expect(database.addInboundRecordsBatch).toHaveBeenCalledWith([expect.objectContaining({ quantity: 40 })],
    { completionStatus: 'complete', expectedSavedIds: [previous.id] });
});
