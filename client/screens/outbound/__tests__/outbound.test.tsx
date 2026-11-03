import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PDAScanScreen from '../index';
import * as database from '@/utils/database';
import { fetchSaleDispatchVoucher, mapSaleDispatchVoucher } from '@/utils/erpSaleDispatch';
import { getErpAccountByOutboundOrderNo } from '@/utils/erpAccounts';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { UiPageHeader, UiToolbarButton, UiWorkflowSummary } from '@/components/UiRedesign';
import { AppModalCard } from '@/components/AppModalCard';
import { feedbackError, feedbackSuccess, feedbackWarning, feedbackUnpackRequired, feedbackUnpackComplete, feedbackOutboundOrderComplete, feedbackOutboundOrderReady, feedbackOverQuantity, feedbackNotBound, feedbackSalesReturnOrderReady, feedbackSalesReturnSaved } from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { STORAGE_KEYS } from '@/constants/config';
import { useCustomAlert } from '@/components/CustomAlert';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';
import { BackHandler, FlatList, Text } from 'react-native';
import { DEFAULT_OUTBOUND_ORDER_RULE } from '@/utils/outboundOrderRule';
import { OUTBOUND_VERIFICATION_TTL_MS } from '@/utils/outboundProgress';
import { scanQueue, QueueItemStatus, type QueueItem } from '@/utils/scanQueue';
import { loadUnpackPrintTasks, submitUnpackPrintTask } from '@/utils/unpackPrintTasks';

let mockScreenFocused = true;
const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockNativeDispatch = jest.fn();
const mockNativeNavigation = { dispatch: mockNativeDispatch };
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-router', () => ({
  useNavigation: () => mockNativeNavigation,
  useFocusEffect: (callback: () => void) => require('react').useEffect(
    () => mockScreenFocused ? callback() : undefined, [callback, mockScreenFocused]
  ),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AggregatedRecordItem', () => ({ AggregatedRecordItem: 'Record' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'Field' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: 'Card' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Form' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary', UiToolbarButton: 'ToolbarButton' }));
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
  feedbackDuplicate: jest.fn(), feedbackNewOrder: jest.fn(), feedbackSwitchOrder: jest.fn(),
  feedbackNotBound: jest.fn(), feedbackNotInOrder: jest.fn(), feedbackOverQuantity: jest.fn(),
  feedbackUnpackRequired: jest.fn(), feedbackUnpackComplete: jest.fn(), feedbackOutboundOrderComplete: jest.fn(),
  feedbackOutboundOrderReady: jest.fn(), feedbackDeleted: jest.fn(),
  feedbackSalesReturnOrderReady: jest.fn(), feedbackSalesReturnSaved: jest.fn(),
  initSoundSetting: jest.fn(), useFeedbackCleanup: jest.fn(),
}));
jest.mock('@/utils/scanQueue', () => ({
  QueueItemStatus: { PENDING: 'pending', WRITING: 'writing', SUCCESS: 'success', FAILED: 'failed' },
  getRecoveryMaterialId: (item: { id: string; materialId?: string }) => item.materialId || `outbound-scan-${item.id}`,
  scanQueue: {
  setBatchWriteFunction: jest.fn(), startTimer: jest.fn(), stopTimer: jest.fn(),
  subscribe: jest.fn(() => jest.fn()), getStats: jest.fn(),
  restoreForReview: jest.fn(), acknowledgeRecovered: jest.fn(), markReviewFailed: jest.fn(), discardReviewed: jest.fn(),
} }));
jest.mock('@/utils/unpackPrintTasks', () => ({
  loadUnpackPrintTasks: jest.fn(), submitUnpackPrintTask: jest.fn(), isUnpackPrintTaskInFlight: jest.fn(() => false),
}));
jest.mock('@/utils/unpackWorkflow', () => ({
  buildNextUnpackTraceNo: jest.fn(async () => ''), syncUnpackRecordsToComputer: jest.fn(async () => undefined),
  getUnpackSyncFailureMessage: jest.fn(),
}));
jest.mock('@/utils/erpSaleDispatch', () => ({
  ...jest.requireActual('@/utils/erpSaleDispatch'), fetchSaleDispatchVoucher: jest.fn(),
}));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(), upsertOrder: jest.fn(), getOrder: jest.fn(),
  getAllWarehouses: jest.fn(), getDefaultWarehouse: jest.fn(), getMaterialsByOrder: jest.fn(),
  getInventoryCodeByModel: jest.fn(), getInventoryBindingMatchByModel: jest.fn(),
  getInventorySupplierById: jest.fn(), getInventoryBindingByCode: jest.fn(),
  checkMaterialExists: jest.fn(), addMaterialWithOrder: jest.fn(), getMaterialById: jest.fn(),
  getSalesReturnsByOrder: jest.fn(), getSalesReturnById: jest.fn(), saveSalesReturnWithOrder: jest.fn(), deleteSalesReturn: jest.fn(),
  getActiveRules: jest.fn(), detectRule: jest.fn(), parseWithRule: jest.fn(),
  inspectQRCodeRule: jest.requireActual('@/utils/database').inspectQRCodeRule,
  QRCodeRuleConflictError: class QRCodeRuleConflictError extends Error {},
  generateId: jest.fn(() => 'unpack-1'), saveUnpackOperation: jest.fn(), deleteMaterial: jest.fn(),
}));

const no = 'IO-2026-09-06-001';
const warehouse = { id: 'W1', name: '无锡仓库', is_default: true, created_at: '' };
const shanghaiWarehouse = { ...warehouse, id: 'W2', name: '无锡总仓' };
function voucher(quantity = 3000, orderNo = no) {
  const account = getErpAccountByOutboundOrderNo(orderNo)!;
  return mapSaleDispatchVoucher(account, {
    Code: orderNo, Partner: { Name: 'Demo customer' }, Warehouse: { Name: account.expectedWarehouseName },
    RDRecordDetails: [{ Inventory: { Code: 'A', Specification: 'Model A' }, Quantity: quantity }],
  });
}

let root: TestRenderer.ReactTestRenderer;
async function tick(ms = 200) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
async function scan(code: string) {
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(code); });
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing(); });
  await tick();
}
function summaryValue(key: string) {
  return root.root.findByType(UiWorkflowSummary).props.items.find((item: { key: string }) => item.key === key)?.value;
}
function findAlertButton(title: string, label: string) {
  const matchingAlert = [...jest.mocked(jest.mocked(useCustomAlert)().showAlert).mock.calls]
    .reverse().find(call => call[0] === title);
  const button = matchingAlert?.[2]?.find(candidate => candidate.text === label);
  expect(button).toBeDefined();
  return button!;
}
function expectSilentDeferredButton(title: string, label: string) {
  const button = findAlertButton(title, label);
  expect(button.style).not.toBe('cancel');
  expect(button.text).not.toBe('取消');
}
async function pressAlertButton(title: string, label: string) {
  const button = findAlertButton(title, label);
  await act(async () => { button!.onPress?.(); });
  await tick();
}
const historical = (quantity = 100): database.MaterialRecord => ({
  id: 'saved-1', model: 'Model A', batch: 'B', inventory_code: 'A', quantity,
  customer_name: '', package: '', version: '', productionDate: '', traceNo: '', sourceNo: '',
  order_no: no, warehouse_id: 'W1', warehouse_name: warehouse.name,
  scanned_at: new Date().toISOString(), operation_type: 'outbound', raw_content: 'QR',
});

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  mockScreenFocused = true;
  await AsyncStorage.clear();
  jest.mocked(database.initDatabase).mockReset().mockResolvedValue(undefined);
  jest.mocked(scanQueue.restoreForReview).mockReset().mockResolvedValue([]);
  jest.mocked(scanQueue.acknowledgeRecovered).mockReset().mockResolvedValue(undefined);
  jest.mocked(scanQueue.markReviewFailed).mockReset().mockResolvedValue(undefined);
  jest.mocked(scanQueue.discardReviewed).mockReset().mockResolvedValue(undefined);
  jest.mocked(loadUnpackPrintTasks).mockReset().mockResolvedValue([]);
  jest.mocked(submitUnpackPrintTask).mockReset().mockImplementation(async pairId => ({
    pair_id: pairId, order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'submitted',
    attempt_count: 1, created_at: '', updated_at: '',
  }));
  jest.mocked(database.getAllWarehouses).mockResolvedValue([warehouse, shanghaiWarehouse]);
  jest.mocked(database.getDefaultWarehouse).mockResolvedValue(warehouse);
  jest.mocked(database.getMaterialsByOrder).mockReset().mockResolvedValue([]);
  jest.mocked(database.getSalesReturnsByOrder).mockReset().mockResolvedValue([]);
  jest.mocked(database.getSalesReturnById).mockReset().mockResolvedValue(null);
  jest.mocked(database.deleteSalesReturn).mockReset().mockResolvedValue(undefined);
  jest.mocked(database.saveSalesReturnWithOrder).mockReset().mockImplementation(async ({ material }) => ({
    ...historical(), ...material, id: material.id!, operation_type: 'sales_return',
    source_kind: 'trace_unknown', source_material_ids: [], notes: '销售退货；历史来源未知',
    returned_at: material.scanned_at,
  }));
  jest.mocked(database.getOrder).mockResolvedValue(null);
  jest.mocked(database.getActiveRules).mockResolvedValue([]);
  jest.mocked(buildRuleConflictDiagnostic).mockReset();
  jest.mocked(formatRuleConflictDiagnostic).mockReset().mockReturnValue('规则冲突诊断');
  jest.mocked(database.detectRule).mockResolvedValue({ id: 'rule', name: 'Rule', separator: '/' } as database.QRCodeRule);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '100' }, customFields: {} });
  jest.mocked(database.getInventoryCodeByModel).mockResolvedValue('A');
  jest.mocked(database.getInventorySupplierById).mockReset();
  jest.mocked(database.getInventoryBindingByCode).mockReset();
  jest.mocked(database.getInventoryBindingMatchByModel).mockReset().mockResolvedValue({ inventoryCode: 'A', matchKind: 'exact' });
  jest.mocked(database.getMaterialById).mockReset().mockResolvedValue(null);
  jest.mocked(database.checkMaterialExists).mockResolvedValue({ material: null, isUnpacked: false, canRescan: false });
  jest.mocked(database.addMaterialWithOrder).mockReset().mockImplementation(async () => `item-${jest.mocked(database.addMaterialWithOrder).mock.calls.length}`);
  jest.mocked(database.saveUnpackOperation).mockReset();
  jest.mocked(fetchSaleDispatchVoucher).mockReset().mockResolvedValue(voucher());
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  jest.useRealTimers();
});

describe('outbound rule supplier validation', () => {
  const rule = { id: 'rule-supplier', name: '极海标签', separator: '/', supplierId: 'supplier-apm', supplierName: '极海科技' } as database.QRCodeRule;
  const supplier = { id: 'supplier-apm', name: '极海科技', binding_count: 1, created_at: '' };
  const binding = { id: 'binding-a', scan_model: 'Model A', inventory_code: 'A', version: '', supplier: '极海科技', description: '', created_at: '' };

  it('saves a scanned outbound material after the rule supplier matches the material binding', async () => {
    jest.mocked(database.detectRule).mockResolvedValue(rule);
    jest.mocked(database.getInventorySupplierById).mockResolvedValue(supplier);
    jest.mocked(database.getInventoryBindingByCode).mockResolvedValue(binding);
    await scan(no);
    await scan('Model A/100');
    expect(database.getInventorySupplierById).toHaveBeenCalledWith(supplier.id);
    expect(database.getInventoryBindingByCode).toHaveBeenCalledWith('A');
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(database.addMaterialWithOrder).toHaveBeenCalledWith(expect.objectContaining({ model: 'Model A', inventory_code: 'A', quantity: 100 }), expect.anything(), expect.anything());
    expect(database.saveSalesReturnWithOrder).not.toHaveBeenCalled();
    expect(database.saveUnpackOperation).not.toHaveBeenCalled();
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['normal outbound', 3000, 100],
    ['sales return', -3000, 100],
    ['unpack outbound', 100, 240],
  ] as const)('blocks a supplier mismatch before any %s business record or print task is created', async (_name, required, quantity) => {
    jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(required));
    jest.mocked(database.detectRule).mockResolvedValue(rule);
    jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: String(quantity), traceNo: 'SUPPLIER-CHECK' }, customFields: {} });
    jest.mocked(database.getInventorySupplierById).mockResolvedValue(supplier);
    jest.mocked(database.getInventoryBindingByCode).mockResolvedValue({ ...binding, supplier: '珠海博雅科技' });
    await scan(no);
    await scan(`Model A/${quantity}/SUPPLIER-CHECK`);
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(database.saveSalesReturnWithOrder).not.toHaveBeenCalled();
    expect(database.saveUnpackOperation).not.toHaveBeenCalled();
    expect(submitUnpackPrintTask).not.toHaveBeenCalled();
    expect(feedbackSuccess).not.toHaveBeenCalled();
    expect(feedbackSalesReturnSaved).not.toHaveBeenCalled();
    expect(feedbackUnpackRequired).not.toHaveBeenCalled();
    expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(0);
    const alert = jest.mocked(useCustomAlert().showAlert).mock.calls.find(call => call[0] === '规则与物料供应商不一致');
    expect(alert?.[1]).toContain('解析规则「极海标签」所属供应商：极海科技');
    expect(alert?.[1]).toContain('物料绑定中的供应商：珠海博雅科技');
    expect(alert?.[1]).toContain('系统不会自动换用其他规则');
    expect(alert?.[2]?.some(button => button.text === '解析诊断')).toBe(true);
  });

  it('does not interpret a legacy supplier note as an enforced supplier association', async () => {
    jest.mocked(database.detectRule).mockResolvedValue({ ...rule, supplierId: undefined, supplierName: '历史供应商备注' });
    await scan(no);
    await scan('Model A/100');
    expect(database.getInventorySupplierById).not.toHaveBeenCalled();
    expect(database.getInventoryBindingByCode).not.toHaveBeenCalled();
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  });
});

it('loads a negative order as returns and releases each saved partial receipt before the whole order completes', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(-10000));
  jest.mocked(database.parseWithRule).mockReturnValue({
    standardFields: { model: 'Model A', quantity: '8000', traceNo: 'RETURN-1', batch: 'B' }, customFields: {},
  });
  await scan(no);
  expect(feedbackSalesReturnOrderReady).toHaveBeenCalledWith('loaded');
  expect(root.root.findByType(UiPageHeader).props.title).toBe('销售退货验收');
  expect(database.getSalesReturnsByOrder).toHaveBeenCalledWith(no, warehouse.id);
  expect(database.upsertOrder).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({ requiredQuantity: 10000, scannedQuantity: 0 });

  await scan('Model A/RETURN-1');

  expect(database.saveSalesReturnWithOrder).toHaveBeenCalledTimes(1);
  expect(database.saveSalesReturnWithOrder).toHaveBeenCalledWith(expect.objectContaining({
    requiredQuantity: 10000,
    material: expect.objectContaining({ quantity: 8000,
      traceNo: 'RETURN-1', customer_name: 'Demo customer', inventory_code: 'A', warehouse_id: warehouse.id }),
  }));
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(database.checkMaterialExists).not.toHaveBeenCalled();
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(feedbackSalesReturnSaved).toHaveBeenCalledWith(false);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 10000, scannedQuantity: 8000, remainingQuantity: 2000, status: 'partial',
  });
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('本次已放行'), 'success');
});

it.each([[-1, 'current'], [-100, 'complete']] as const)(
  'restores independently saved return history and repeats the verified %s return status', async (quantity, status) => {
    jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(-100));
    const returned: database.SalesReturnRecord = {
      ...historical(Math.abs(quantity)), operation_type: 'sales_return',
      source_kind: 'trace_matched', source_material_ids: ['source-1'],
      notes: '销售退货', returned_at: new Date().toISOString(),
    };
    jest.mocked(database.getSalesReturnsByOrder).mockResolvedValue([returned]);
    await scan(no);
    jest.mocked(feedbackSalesReturnOrderReady).mockClear();
    await scan(no);
    expect(feedbackSalesReturnOrderReady).toHaveBeenCalledWith(status);
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(Math.abs(quantity));
    expect(database.getMaterialsByOrder).not.toHaveBeenCalled();
  }
);

it('rejects excessive return quantity without opening an outbound unpack modal', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(-50));
  await scan(no);
  await scan('Model A/RETURN-1');
  expect(database.saveSalesReturnWithOrder).not.toHaveBeenCalled();
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(feedbackUnpackRequired).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalledWith('退货数量超出，本次未录入');
});

it('restores persisted return quantities when the legacy work draft has no ERP snapshot and the warehouse stays the same', async () => {
  await act(async () => { root.unmount(); });
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT, JSON.stringify({
    orderNo: no, customerName: 'Demo customer', warehouseId: warehouse.id,
    warehouseName: warehouse.name, updatedAt: new Date().toISOString(),
  }));
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValue(voucher(-10000));
  jest.mocked(database.getSalesReturnsByOrder).mockResolvedValue([{
    ...historical(8000), operation_type: 'sales_return', source_kind: 'trace_matched',
    source_material_ids: ['source-1'], notes: '销售退货', returned_at: new Date().toISOString(),
  }]);
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();
  expect(root.root.findByType(UiPageHeader).props.title).toBe('销售退货验收');
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 10000, scannedQuantity: 8000, remainingQuantity: 2000,
  });
  expect(database.getSalesReturnsByOrder).toHaveBeenCalledWith(no, warehouse.id);
  expect(database.upsertOrder).not.toHaveBeenCalled();
});

it('keeps a rejected return customer check out of saved progress and does not announce release', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(-1000));
  jest.mocked(database.saveSalesReturnWithOrder).mockRejectedValueOnce(new Error('追溯码属于客户A，不属于Demo customer'));
  await scan(no);
  await scan('Model A/RETURN-1');
  expect(feedbackSalesReturnSaved).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(0);
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('客户A'), 'error');
});

it('switches from a completed return into an ordinary outbound order using ordinary validation and speech', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(-100));
  await scan(no);
  await scan('Model A/RETURN-1');
  expect(feedbackSalesReturnSaved).toHaveBeenCalledWith(true);
  const nextNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(200, nextNo));
  await scan(nextNo);
  await scan('Model A/OUTBOUND-1');
  expect(root.root.findByType(UiPageHeader).props.title).toBe('出库扫描');
  expect(database.saveSalesReturnWithOrder).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(database.checkMaterialExists).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('switched');
});

it('rejects mixed positive and negative ERP quantities before saving or replacing the active order', async () => {
  await scan(no);
  const nextNo = 'IO-2026-09-06-002';
  const mixed = voucher(-100, nextNo);
  mixed.lines.push({ ...mixed.lines[0], inventoryCode: 'B', quantity: 50 });
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(mixed);
  await scan(nextNo);
  expect(database.saveSalesReturnWithOrder).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('正负混合'), 'error');
});

it('announces the initial order separately from material scan success', async () => {
  await scan(no);

  expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('announces a different order as switched even when the previous order has no scanned materials', async () => {
  await scan(no);
  const nextNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(500, nextNo));
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(nextNo);

  expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('switched');
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 500, scannedQuantity: 0,
  });
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it.each([
  [100, 'current'],
  [3000, 'complete'],
] as const)('reloads repeated order history once and announces its verified %s-unit state as %s', async (quantity, announcement) => {
  await scan(no);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(quantity)]);
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(database.getMaterialsByOrder).mockClear();

  await scan(no);
  await scan(no);

  expect(database.getMaterialsByOrder).toHaveBeenCalledTimes(2);
  expect(database.getMaterialsByOrder).toHaveBeenCalledWith(no, warehouse.id);
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([
    [announcement], [announcement],
  ]);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 3000,
    scannedQuantity: quantity,
    scannedItems: [expect.objectContaining({ id: 'saved-1' })],
  });
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
});

it('waits for current order history to finish restoring before announcing completion', async () => {
  await scan(no);
  let finishHistory!: (value: database.MaterialRecord[]) => void;
  jest.mocked(database.getMaterialsByOrder).mockImplementationOnce(
    () => new Promise(resolve => { finishHistory = resolve; })
  );
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(no);

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  await act(async () => { finishHistory([historical(3000)]); });
  await tick();

  expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('complete');
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(3000);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('does not announce an order as ready or complete when repeated-order history fails to load', async () => {
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  await scan(no);
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(database.getMaterialsByOrder).mockRejectedValueOnce(new Error('database is busy'));

  await scan(no);

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalledWith(expect.any(String));
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('does not announce completion from old quantities when repeated-order ERP verification fails', async () => {
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  await scan(no);
  await tick(OUTBOUND_VERIFICATION_TTL_MS);
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(fetchSaleDispatchVoucher).mockRejectedValueOnce(new Error('ERP单据已取消'));

  await scan(no);

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalledWith(expect.any(String));
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('shows cached verification without speech and waits for refreshed ERP quantities before reporting readiness', async () => {
  await scan(no);
  const nextNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, nextNo));
  await scan(nextNo);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  let finishVerification!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise(resolve => { finishVerification = resolve; })
  );
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(no);

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(3000);
  await act(async () => { finishVerification(voucher(4000)); });
  await tick();

  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([
    ['switched'],
  ]);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 4000, scannedQuantity: 3000, status: 'partial',
  });
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('keeps a following order scan queued until cached ERP verification finishes', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await scan(secondNo);
  let finishVerification!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise(resolve => { finishVerification = resolve; })
  );
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  await scan(no);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  const thirdNo = 'IO-2026-09-06-003';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(700, thirdNo));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  await scan(thirdNo);

  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);

  await act(async () => { finishVerification(voucher()); });
  await tick();

  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([
    ['switched'], ['switched'],
  ]);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(4);
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(700);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it.each([false, true])('gives completion precedence when switching between completed orders (cached destination: %s)', async cached => {
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(database.getMaterialsByOrder).mockImplementation(async orderNo => [{ ...historical(3000), order_no: orderNo }]);
  if (cached) {
    jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(3000, secondNo));
    await scan(secondNo);
  }
  await scan(no);
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(useToast().showToast).mockClear();
  let finishLoad!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise(resolve => { finishLoad = resolve; })
  );

  await scan(secondNo);

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(useToast().showToast).not.toHaveBeenCalled();
  await act(async () => { finishLoad(voucher(3000, secondNo)); });
  await tick();
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['complete']]);
  expect(jest.mocked(useToast().showToast).mock.calls).toEqual([['本单已扫完', 'success']]);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({ scannedQuantity: 3000, status: 'complete' });
  expect(useToast().showToast).not.toHaveBeenCalledWith(expect.stringContaining('切换仓库'), expect.anything());
  expect(useCustomAlert().showConfirm).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('ignores an old visit ERP response without releasing a new visit scan lock', async () => {
  let finishOldLoad!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise(resolve => { finishOldLoad = resolve; })
  );
  await scan(no);
  await act(async () => { mockScreenFocused = false; root.update(<PDAScanScreen />); });
  await act(async () => { mockScreenFocused = true; root.update(<PDAScanScreen />); });
  await tick();
  const secondNo = 'IO-2026-09-06-002';
  let finishCurrentLoad!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise(resolve => { finishCurrentLoad = resolve; })
  );
  await scan(secondNo);

  await act(async () => { finishOldLoad(voucher()); });
  await tick();

  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(true);
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(root.root.findAllByType(UiToolbarButton)).toHaveLength(0);
  await act(async () => { finishCurrentLoad(voucher(500, secondNo)); });
  await tick();
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({ requiredQuantity: 500, scannedQuantity: 100 });
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledWith(
    expect.objectContaining({ order_no: secondNo }), expect.anything(), expect.anything()
  );
});

it('pauses queued material scans after the requested order fails ERP loading', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  let rejectLoad!: (error: Error) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(
    () => new Promise((_, reject) => { rejectLoad = reject; })
  );
  await scan(secondNo);
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();

  await act(async () => { rejectLoad(new Error('ERP unavailable')); });
  await tick(1000);

  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '待处理扫码已暂停', expect.stringContaining('还有 1 条扫码尚未保存'), expect.any(Array), 'warning'
  );
  expectSilentDeferredButton('待处理扫码已暂停', '先核对');
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalled();
});

it('keeps material accepted after a queued order attached to that order when the previous load completes', async () => {
  let finishFirst!: (value: ReturnType<typeof voucher>) => void;
  let finishSecond!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
  const secondNo = 'IO-2026-09-06-002';
  await scan(no);
  await scan(secondNo);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);

  // Resolve A without advancing B's queued processing timer, then accept B's material.
  await act(async () => { finishFirst(voucher()); });
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  await act(async () => { finishSecond(voucher(100, secondNo)); });
  await tick();

  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledWith(
    expect.objectContaining({ order_no: secondNo, quantity: 100 }), expect.anything(), expect.anything()
  );
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(100);
  expect(feedbackError).not.toHaveBeenCalled();
});

it('keeps the selected warehouse ID when ERP names also match another local warehouse', async () => {
  await act(async () => { root.unmount(); });
  const sameNameWarehouse = { ...warehouse, id: 'W-DUPLICATE', is_default: false };
  jest.mocked(database.getAllWarehouses).mockResolvedValue([sameNameWarehouse, warehouse, shanghaiWarehouse]);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(100)]);
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();

  await scan(no);

  expect(database.getMaterialsByOrder).toHaveBeenCalledWith(no, warehouse.id);
  expect(database.getMaterialsByOrder).not.toHaveBeenCalledWith(no, sameNameWarehouse.id);
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(100);
  expect(database.upsertOrder).toHaveBeenCalledWith(no, expect.any(String), expect.objectContaining({ id: warehouse.id }));
  expect(useToast().showToast).not.toHaveBeenCalledWith(expect.stringContaining('切换仓库'), expect.anything());
});

it('offers an initialization retry without starting the legacy batch writer', async () => {
  await act(async () => { root.unmount(); });
  jest.mocked(database.initDatabase).mockRejectedValueOnce(new Error('database busy'));
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();
  expect(root.root.findByType(WarehouseScanInput).props.editable).toBe(false);
  expectSilentDeferredButton('出库数据加载失败', '稍后');

  await pressAlertButton('出库数据加载失败', '重新加载');

  expect(root.root.findByType(WarehouseScanInput).props.editable).toBe(true);
  expect(scanQueue.setBatchWriteFunction).not.toHaveBeenCalled();
  expect(scanQueue.startTimer).not.toHaveBeenCalled();
  await scan(no);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
});

it('shows a malformed legacy inbox error without blocking normal initialization or scans', async () => {
  await act(async () => { root.unmount(); });
  jest.mocked(scanQueue.restoreForReview).mockRejectedValue(new Error('历史扫码数据损坏'));
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();

  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '历史扫码缓存异常', expect.stringContaining('历史扫码'), expect.any(Array), 'warning'
  );
  expectSilentDeferredButton('历史扫码缓存异常', '稍后');
  expect(root.root.findByType(WarehouseScanInput).props.editable).toBe(true);
  await scan(no);
  await scan('Model A/100');

  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  expect(scanQueue.startTimer).not.toHaveBeenCalled();
});

it('keeps completed and unfinished materials in the original full list without a status panel or extra toolbar', async () => {
  const twoItems = voucher(3000);
  twoItems.lines.push({ ...twoItems.lines[0], inventoryCode: 'B', specification: 'Model B', quantity: 200 });
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(twoItems);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  await scan(no);

  expect(root.root.findByType(FlatList).props.data.map((item: { inventoryCode: string }) => item.inventoryCode)).toEqual(['A', 'B']);
  const pageText = root.root.findAllByType(Text).map(node => node.props.children).flat().join('');
  expect(pageText).not.toMatch(/最近一笔|物料完成/);
  expect(root.root.findAllByType(UiToolbarButton)).toHaveLength(0);
  await scan('Model A/100');
  expect(feedbackOverQuantity).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();

  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model B', quantity: '200' }, customFields: {} });
  jest.mocked(database.getInventoryBindingMatchByModel).mockResolvedValue({ inventoryCode: 'B', matchKind: 'generic' });
  await scan('Model B/200');

  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderComplete).toHaveBeenCalledTimes(1);
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('使用通用绑定'), 'success');
  expect(root.root.findByType(FlatList).props.data).toHaveLength(2);
  expect(root.root.findByType(FlatList).props.data.every((item: { status: string }) => item.status === 'complete')).toBe(true);
  expect(root.root.findAllByType(UiToolbarButton)).toHaveLength(0);
});

it('keeps legacy persisted scans in review until an operator explicitly chooses recovery', async () => {
  const legacy: QueueItem = {
    id: 'legacy-1', scanData: 'Model A/100', timestamp: Date.now(), status: QueueItemStatus.FAILED,
    parsed: { orderNo: no, model: 'Model A', batch: 'B', quantity: '100', warehouseId: warehouse.id, warehouseName: warehouse.name },
  };
  await act(async () => { root.unmount(); });
  jest.mocked(scanQueue.restoreForReview).mockResolvedValue([legacy]);
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick(1000);

  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '发现历史待核对扫码', expect.stringContaining('1 条旧版本扫码'), expect.any(Array), 'warning'
  );
  expectSilentDeferredButton('发现历史待核对扫码', '稍后');
  expect(scanQueue.startTimer).not.toHaveBeenCalled();
  expect(scanQueue.setBatchWriteFunction).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await pressAlertButton('发现历史待核对扫码', '稍后');
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await tick();
  expect(root.root.findByType(AppModalCard).props.title).toBe('历史扫码待核对');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it.each([true, false])('revalidates raw legacy scans with current binding rules before manual recovery (bound: %s)', async bound => {
  const legacy: QueueItem = {
    id: 'legacy-review-1', scanData: 'Model A/100', timestamp: Date.now(), status: QueueItemStatus.FAILED,
    parsed: { orderNo: no, model: 'STALE MODEL', batch: 'OLD', quantity: '999', warehouseId: warehouse.id, warehouseName: warehouse.name },
  };
  await act(async () => { root.unmount(); });
  jest.mocked(scanQueue.restoreForReview).mockResolvedValue([legacy]);
  jest.mocked(database.getInventoryBindingMatchByModel).mockResolvedValue({
    inventoryCode: bound ? 'A' : null, matchKind: bound ? 'exact' : 'none',
  });
  jest.mocked(database.addMaterialWithOrder).mockResolvedValueOnce('outbound-scan-legacy-review-1');
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();
  await pressAlertButton('发现历史待核对扫码', '查看待核对');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();

  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  await tick();

  expect(fetchSaleDispatchVoucher).toHaveBeenCalledWith(expect.anything(), no, expect.anything());
  expect(database.detectRule).toHaveBeenCalledWith('Model A/100', expect.any(Array));
  expect(database.getInventoryBindingMatchByModel).toHaveBeenCalledWith('Model A', undefined);
  if (bound) {
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(database.addMaterialWithOrder).toHaveBeenCalledWith(expect.objectContaining({
      id: 'outbound-scan-legacy-review-1', order_no: no, model: 'Model A', quantity: 100,
    }), expect.anything(), expect.anything());
    expect(scanQueue.acknowledgeRecovered).toHaveBeenCalledWith('legacy-review-1', 'outbound-scan-legacy-review-1');
  } else {
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(scanQueue.acknowledgeRecovered).not.toHaveBeenCalled();
    expect(feedbackNotBound).toHaveBeenCalledTimes(1);
    expect(scanQueue.discardReviewed).not.toHaveBeenCalled();
  }
});

it.each([false, true])('reloads committed quantities after legacy acknowledgement fails (unpack: %s)', async unpack => {
  const originalQuantity = unpack ? 2500 : 100;
  const legacy: QueueItem = {
    id: 'legacy-commit-1', scanData: `Model A/${originalQuantity}`, timestamp: Date.now(), status: QueueItemStatus.FAILED,
    parsed: { orderNo: no, model: 'Model A', batch: 'B', quantity: String(originalQuantity), warehouseId: warehouse.id, warehouseName: warehouse.name },
  };
  let persisted: database.MaterialRecord[] = [];
  await act(async () => { root.unmount(); });
  jest.mocked(scanQueue.restoreForReview).mockResolvedValue([legacy]);
  jest.mocked(scanQueue.acknowledgeRecovered).mockRejectedValueOnce(new Error('review acknowledgement unavailable'));
  jest.mocked(database.getMaterialsByOrder).mockImplementation(async () => persisted);
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100));
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
    model: 'Model A', quantity: String(originalQuantity),
  }, customFields: {} });
  if (unpack) {
    jest.mocked(database.saveUnpackOperation).mockImplementationOnce(async options => {
      persisted = [{ ...historical(100), id: options.material.id, isUnpacked: true }];
      return {
        pairId: 'pair-legacy-commit', shippedRecord: { new_quantity: '100' }, remainingRecord: { new_quantity: '2400' },
      } as Awaited<ReturnType<typeof database.saveUnpackOperation>>;
    });
  } else {
    jest.mocked(database.addMaterialWithOrder).mockImplementationOnce(async material => {
      persisted = [{ ...historical(100), id: material.id! }];
      return material.id!;
    });
  }
  await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
  await tick();
  await pressAlertButton('发现历史待核对扫码', '查看待核对');
  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  await tick();
  if (unpack) {
    await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
    await tick();
  }

  expect(scanQueue.acknowledgeRecovered).toHaveBeenCalledTimes(1);
  expect(database.getMaterialsByOrder).toHaveBeenCalledTimes(2);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({ scannedQuantity: 100, status: 'complete' });
  expect(feedbackWarning).toHaveBeenCalledWith(expect.stringContaining('已保存'));
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '100' }, customFields: {} });

  await scan('Model A/100');

  expect(feedbackOverQuantity).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(unpack ? 0 : 1);
  expect(database.saveUnpackOperation).toHaveBeenCalledTimes(unpack ? 1 : 0);
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(100);
});

it.each(['failed', 'pending'] as const)('offers manual handling for a %s print task and retries its existing pair ID without creating another unpack', async status => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-existing', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status, attempt_count: 1,
    last_error: 'helper unavailable', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  await scan(no);
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '拆包标签待处理', expect.stringContaining('1 笔未提交或需核对的标签任务'), expect.any(Array), 'warning'
  );
  expectSilentDeferredButton('拆包标签待处理', '稍后');
  expect(submitUnpackPrintTask).not.toHaveBeenCalled();
  await pressAlertButton('拆包标签待处理', '稍后');
  jest.mocked(useCustomAlert().showAlert).mockClear();
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await tick();
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '拆包标签待处理', expect.stringContaining('1 笔未提交或需核对的标签任务'), expect.any(Array), 'warning'
  );
  expect(submitUnpackPrintTask).not.toHaveBeenCalled();
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([{ ...task, status: 'submitted' }]);

  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  await tick();

  expect(submitUnpackPrintTask).not.toHaveBeenCalled();
  const confirmation = jest.mocked(useCustomAlert().showAlert).mock.calls.at(-1)![2]!
    .find(button => button.text === '核对并提交');
  expect(confirmation).toBeDefined();
  await act(async () => { confirmation!.onPress?.(); });
  await tick();

  expect(submitUnpackPrintTask).toHaveBeenCalledTimes(1);
  expect(submitUnpackPrintTask).toHaveBeenCalledWith('pair-existing', undefined, { retryConfirmed: true });
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(root.root.findAllByType(UiToolbarButton)).toHaveLength(0);
  expect(root.root.findAllByType(AppModalCard)).toHaveLength(0);
});

it.each(['2026/10/13 08:09', undefined, 'invalid-date'])('renders task update time %p safely below the remainder trace', async updatedAt => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-date', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'failed', attempt_count: 1,
    remainder_traceNo: 'REMAINDER-1', created_at: '', updated_at: updatedAt as string,
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  await scan(no);
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  const texts = root.root.findByType(AppModalCard).findAllByType(Text).map(node => node.props.children).flat().join('');
  expect(texts).toContain('剩余追溯码：REMAINDER-1');
  expect(texts).not.toContain('Invalid Date');
  if (updatedAt === '2026/10/13 08:09') expect(texts).toContain('2026-10-13 08:09');
  else expect(texts).toContain('-');
});

it('keeps a manually skipped task result visible instead of treating it as submitted', async () => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-skipped', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'pending', attempt_count: 0,
    created_at: '', updated_at: '',
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  await scan(no);
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  const skipped = { ...task, status: 'skipped' as const };
  jest.mocked(submitUnpackPrintTask).mockResolvedValueOnce(skipped);
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([skipped]);
  await pressAlertButton('重试标签任务', '核对并提交');
  expect(root.root.findAllByType(AppModalCard)).toHaveLength(1);
  expect(useToast().showToast).toHaveBeenCalledWith('该供应商标签按策略跳过打印', 'warning');
});

it('does not close a new order task list when an old manual retry refresh finishes late', async () => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-old', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'failed', attempt_count: 1,
    created_at: '', updated_at: '',
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  await scan(no);
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  let finishRefresh!: (rows: database.UnpackPrintTask[]) => void;
  jest.mocked(loadUnpackPrintTasks).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  const confirmation = jest.mocked(useCustomAlert().showAlert).mock.calls.at(-1)![2]!
    .find(button => button.text === '核对并提交')!;
  await act(async () => { confirmation.onPress?.(); });
  await act(async () => { root.root.findByType(AppModalCard).props.onClose(); });
  const nextNo = 'IO-2026-09-06-002';
  const nextTask = { ...task, pair_id: 'pair-new', order_no: nextNo };
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, nextNo));
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([nextTask]);
  await scan(nextNo);
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  await act(async () => { finishRefresh([{ ...task, status: 'submitted' }]); });
  await tick();
  expect(root.root.findAllByType(AppModalCard)).toHaveLength(1);
  expect(root.root.findByType(UiToolbarButton).props.label).toBe('核对后重试');
});

it('keeps an opened task list visible when an automatic unpack submission succeeds', async () => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-automatic', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'pending', attempt_count: 0,
    created_at: '', updated_at: '',
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  await scan(no);
  await pressAlertButton('拆包标签待处理', '稍后');
  let completeAutomatic!: (value: database.UnpackPrintTask) => void;
  jest.mocked(submitUnpackPrintTask).mockImplementationOnce(() => new Promise(resolve => { completeAutomatic = resolve; }));
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '4000', traceNo: 'TRACE-AUTO' }, customFields: {} });
  jest.mocked(database.saveUnpackOperation).mockResolvedValueOnce({
    pairId: task.pair_id, shippedRecord: { new_quantity: '3000' }, remainingRecord: { new_quantity: '1000' },
  } as Awaited<ReturnType<typeof database.saveUnpackOperation>>);
  await scan('Model A/4000/TRACE-AUTO');
  await act(async () => { root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  await tick();
  expect(submitUnpackPrintTask).toHaveBeenCalledWith('pair-automatic', undefined, { retryConfirmed: false });
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await tick();
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  const submitted = { ...task, status: 'submitted' as const };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([submitted]);
  await act(async () => { completeAutomatic(submitted); });
  await tick();
  expect(root.root.findAllByType(AppModalCard)).toHaveLength(1);
  expect(useToast().showToast).toHaveBeenCalledWith('标签任务已提交同步助手', 'success');
});

it('reports a resolved failed print task as a warning instead of claiming it was submitted', async () => {
  const task: database.UnpackPrintTask = {
    pair_id: 'pair-failed', order_no: no, warehouse_id: warehouse.id, warehouse_name: warehouse.name,
    shipment_record_id: 'shipped', remainder_record_id: 'remainder', status: 'failed', attempt_count: 2,
    last_error: '助手拒绝打印任务', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([task]);
  jest.mocked(submitUnpackPrintTask).mockResolvedValueOnce(task);
  await scan(no);
  jest.mocked(useToast().showToast).mockClear();
  await pressAlertButton('拆包标签待处理', '查看标签任务');
  await act(async () => { root.root.findByType(UiToolbarButton).props.onPress(); });
  const confirmation = jest.mocked(useCustomAlert().showAlert).mock.calls.at(-1)![2]!
    .find(button => button.text === '核对并提交');
  jest.mocked(loadUnpackPrintTasks).mockResolvedValue([{ ...task, updated_at: new Date(Date.now() + 1000).toISOString() }]);
  await act(async () => { confirmation!.onPress?.(); });
  await tick();

  expect(submitUnpackPrintTask).toHaveBeenCalledWith('pair-failed', undefined, { retryConfirmed: true });
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('助手拒绝打印任务'), 'warning');
  expect(useToast().showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
  expect(root.root.findByType(UiToolbarButton).props.label).toBe('核对后重试');
  jest.mocked(useCustomAlert().showAlert).mockClear();
  await act(async () => { root.root.findByType(AppModalCard).props.onClose(); });
  await tick();
  expect(useCustomAlert().showAlert).not.toHaveBeenCalledWith('拆包标签待处理', expect.anything(), expect.anything(), expect.anything());
});

it('blocks scans after history read failure, then reloads history when the same order is rescanned', async () => {
  jest.mocked(database.getMaterialsByOrder).mockRejectedValueOnce(new Error('history read failed'));
  await scan(no);
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  await scan(no);
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

it('shows a read-only diagnostic for a true rule conflict without saving outbound data', async () => {
  await scan(no);
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
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(useCustomAlert().showAlert).toHaveBeenCalledWith(
    '解析规则冲突',
    expect.stringContaining('规则冲突诊断'),
    expect.any(Array),
    'warning'
  );
  expect(feedbackWarning).toHaveBeenCalled();
});

it('revokes verification on refresh failure and requires successful recovery', async () => {
  await scan(no);
  jest.mocked(fetchSaleDispatchVoucher).mockRejectedValueOnce(new Error('ERP单据已取消'));
  await act(async () => { await root.root.findByType(UiPageHeader).props.onRightPress(); });
  await tick();
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('已暂停扫码'), 'warning');
  await scan(no);
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
});

it('accepts separate identical no-trace scans, caches page configuration, and avoids per-scan draft writes', async () => {
  await scan(no);
  const writesBefore = jest.mocked(AsyncStorage.multiSet).mock.calls.filter(([entries]) =>
    entries.some(([key]) => key === STORAGE_KEYS.OUTBOUND_WORK_DRAFT)).length;
  await scan('Model A/100');
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  expect(feedbackSuccess).toHaveBeenCalledTimes(2);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(database.getActiveRules).toHaveBeenCalledTimes(1);
  expect(database.getInventoryBindingMatchByModel).toHaveBeenCalledTimes(1);
  expect(jest.mocked(AsyncStorage.multiSet).mock.calls.filter(([entries]) =>
    entries.some(([key]) => key === STORAGE_KEYS.OUTBOUND_WORK_DRAFT))).toHaveLength(writesBefore);
});

it('announces once when the last ERP material is committed', async () => {
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({
    standardFields: { model: 'Model A', quantity: '3000' },
    customFields: {},
  });

  await scan('Model A/3000');

  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderComplete).toHaveBeenCalledTimes(1);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith('本单已扫完，可扫描下一单', 'success');
});

it('reuses the same order verification for 15 minutes without extending it after each package', async () => {
  let verifiedAt = 0;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(async () => {
    verifiedAt = Date.now();
    return voucher();
  });
  await scan(no);
  await scan('Model A/100');
  await tick(5 * 60 * 1000);
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);

  await tick(verifiedAt + OUTBOUND_VERIFICATION_TTL_MS - 1000 - Date.now());
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(3);

  await tick(verifiedAt + OUTBOUND_VERIFICATION_TTL_MS - Date.now());
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(4);
});

it('refreshes expired verification before recording the next package and routes by order account', async () => {
  await scan(no);
  await scan('Model A/100');
  await tick(OUTBOUND_VERIFICATION_TTL_MS);
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100));
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  const shanghaiNo = 'IO-2026-09-06-01';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(500, shanghaiNo));
  await scan(shanghaiNo);
  await scan('Model A/100');
  expect(jest.mocked(fetchSaleDispatchVoucher).mock.calls.at(-1)?.[0].key).toBe('shanghai-chipmunk');
  expect(jest.mocked(database.addMaterialWithOrder).mock.calls.at(-1)?.[0].warehouse_id).toBe('W2');
});

it('revalidates a stale unpack confirmation instead of saving the previous split quantity', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(1500));
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '2500' }, customFields: {} });
  await scan('Model A/100');
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  await tick(OUTBOUND_VERIFICATION_TTL_MS);
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(1200));
  await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('ERP需求或已扫数量已变化'), 'error');
  expect(feedbackUnpackRequired).toHaveBeenCalledTimes(1);
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
});

it('commits a merged-line unpack only once when confirmation is tapped twice', async () => {
  const merged = voucher(1000);
  merged.lines.push({ ...merged.lines[0], quantity: 500 });
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(merged);
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '2500' }, customFields: {} });
  await scan('Model A/100');
  expect(feedbackUnpackRequired).toHaveBeenCalledTimes(1);
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
  let completeWrite!: (value: Awaited<ReturnType<typeof database.saveUnpackOperation>>) => void;
  jest.mocked(database.saveUnpackOperation).mockImplementationOnce(() => new Promise(resolve => { completeWrite = resolve; }));
  let confirmation!: Promise<void>;
  await act(async () => {
    const confirm = root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress;
    confirmation = confirm();
    await confirm();
  });
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
  await act(async () => {
    completeWrite({
      pairId: 'pair', shippedRecord: { new_quantity: '1500' }, remainingRecord: { new_quantity: '1000' },
    } as Awaited<ReturnType<typeof database.saveUnpackOperation>>);
    await confirmation;
  });
  expect(database.saveUnpackOperation).toHaveBeenCalledTimes(1);
  expect(database.saveUnpackOperation).toHaveBeenCalledWith(expect.objectContaining({
    shippedQuantity: 1500, remainingQuantity: 1000, newTraceNo: '',
  }));
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).toHaveBeenCalledWith(true);
  expect(feedbackSuccess).not.toHaveBeenCalled();
});

it.each([false, true])('announces unpack completion only for committed data (list refresh fails instead of save: %s)', async saved => {
  const partialOrder = voucher(200);
  partialOrder.lines.push({
    ...partialOrder.lines[0],
    inventoryCode: 'B',
    inventoryName: 'Model B',
    specification: 'Model B',
    quantity: 100,
  });
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(partialOrder);
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '2500' }, customFields: {} });
  await scan('Model A/2500');
  if (saved) {
    jest.mocked(database.saveUnpackOperation).mockResolvedValueOnce({
      pairId: 'pair', shippedRecord: { new_quantity: '200' }, remainingRecord: { new_quantity: '2300' },
    } as Awaited<ReturnType<typeof database.saveUnpackOperation>>);
    jest.mocked(database.getMaterialsByOrder).mockRejectedValueOnce(new Error('list refresh failed'));
  } else {
    jest.mocked(database.saveUnpackOperation).mockRejectedValueOnce(new Error('database write failed'));
  }
  await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  expect(feedbackUnpackComplete).toHaveBeenCalledTimes(saved ? 1 : 0);
  expect(feedbackOutboundOrderComplete).toHaveBeenCalledTimes(0);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith(
    expect.stringContaining(saved ? '拆包完成：' : '拆包失败'), saved ? 'success' : 'error'
  );
});

it('does not announce completion when the unpack dialog is cancelled', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(200));
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '2500' }, customFields: {} });
  await scan('Model A/2500');
  await act(async () => { root.root.findByType(AppModalCard).props.onClose(); });
  expect(feedbackUnpackRequired).toHaveBeenCalledTimes(1);
  expect(database.saveUnpackOperation).not.toHaveBeenCalled();
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
});

it('counts an available 20-unit remainder first and splits only 180 from a fresh package for a 200-unit order', async () => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(200));
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
    model: 'Model A', quantity: '20', traceNo: 'REMAINDER-2',
  }, customFields: {} });
  jest.mocked(database.checkMaterialExists).mockResolvedValueOnce({
    material: { ...historical(), order_no: 'PREVIOUS', isUnpacked: true, remaining_quantity: '20' },
    isUnpacked: true, canRescan: true,
  });
  await scan('Model A/20/REMAINDER-2');
  expect(database.addMaterialWithOrder).toHaveBeenCalledWith(expect.objectContaining({
    quantity: 20, traceNo: 'REMAINDER-2',
  }), expect.anything(), expect.anything());
  expect(feedbackUnpackRequired).not.toHaveBeenCalled();
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
    model: 'Model A', quantity: '2500', traceNo: 'FRESH',
  }, customFields: {} });
  await scan('Model A/2500/FRESH');
  expect(feedbackUnpackRequired).toHaveBeenCalledTimes(1);
  jest.mocked(database.saveUnpackOperation).mockResolvedValueOnce({
    pairId: 'pair', shippedRecord: { new_quantity: '180' }, remainingRecord: { new_quantity: '2320' },
  } as Awaited<ReturnType<typeof database.saveUnpackOperation>>);
  await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  expect(database.saveUnpackOperation).toHaveBeenCalledWith(expect.objectContaining({
    shippedQuantity: 180, remainingQuantity: 2320,
  }));
  expect(feedbackUnpackComplete).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).toHaveBeenCalledWith(true);
});

it.each(['2617', ''])('shows production date %j instead of repeating the model in expanded ERP details', async productionDate => {
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([
    { ...historical(), productionDate, version: 'V2', traceNo: 'TRACE-1' },
  ]);
  await scan(no);
  const renderCard = () => {
    const list = root.root.findByType(FlatList);
    return list.props.renderItem({ item: list.props.data[0] });
  };
  let card!: TestRenderer.ReactTestRenderer;
  await act(async () => { card = TestRenderer.create(renderCard()); });
  try {
    await act(async () => { card.root.findAll(node => Boolean(node.props.onPress))[0].props.onPress(); });
    await act(async () => { card.update(renderCard()); });
    const detail = card.root.findAll(node => Boolean(node.props.onLongPress))[0];
    const text = detail.findAllByType(Text).map(node => node.props.children).flat().join('');
    expect(text).toContain(`生产日期: ${productionDate || '-'}`);
    expect(text).not.toContain('Model A');
    for (const expected of ['版本: V2', '数量 100', '批次: B', '追溯码: TRACE-1']) expect(text).toContain(expected);
    expect(card.root.findAllByType(Text).some(node => node.props.children === 'Model A')).toBe(true);
  } finally {
    await act(async () => { card.unmount(); });
  }
});

it('keeps committed-before-success feedback and processes queued scans serially', async () => {
  await scan(no);
  let completeWrite!: (value: string) => void;
  jest.mocked(database.addMaterialWithOrder).mockImplementationOnce(() => new Promise(resolve => { completeWrite = resolve; }));
  await scan('Model A/100');
  expect(feedbackSuccess).not.toHaveBeenCalled();
  await scan('960');
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  await act(async () => { completeWrite('first'); });
  await tick(5);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  expect(feedbackSuccess).toHaveBeenCalledTimes(2);
});

it('announces a failed material save without claiming success or advancing order quantities', async () => {
  await scan(no);
  jest.mocked(database.addMaterialWithOrder).mockRejectedValueOnce(new Error('database is busy'));

  await scan('Model A/100');

  expect(feedbackError).toHaveBeenCalledWith('保存失败，请查看提示');
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(0);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
});

it.each([false, true])('allows re-splitting after deleting shipped material (history refresh fails: %s)', async refreshFails => {
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(1500));
  await scan(no);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: {
    model: 'Model A', quantity: '2500', traceNo: 'ORIGINAL',
  }, customFields: {} });
  jest.mocked(database.saveUnpackOperation).mockResolvedValue({
    pairId: 'pair', shippedRecord: { new_quantity: '1500', new_traceNo: 'ORIGINAL-1' },
    remainingRecord: { new_quantity: '1000', new_traceNo: 'ORIGINAL-2' },
  } as Awaited<ReturnType<typeof database.saveUnpackOperation>>);
  await scan('Model A/2500/ORIGINAL');
  jest.mocked(database.getMaterialsByOrder).mockImplementation(async () => [{
    ...historical(1500),
    id: jest.mocked(database.saveUnpackOperation).mock.calls.at(-1)![0].material.id,
    isUnpacked: true,
  }]);
  await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  await tick();
  const list = root.root.findByType(FlatList);
  let card: TestRenderer.ReactTestRenderer;
  await act(async () => { card = TestRenderer.create(list.props.renderItem({ item: list.props.data[0] })); });
  await act(async () => { card!.root.findAll(node => Boolean(node.props.onPress))[0].props.onPress(); });
  await act(async () => { card!.update(root.root.findByType(FlatList).props.renderItem({ item: root.root.findByType(FlatList).props.data[0] })); });
  await act(async () => { card!.root.findAll(node => Boolean(node.props.onLongPress))[0].props.onLongPress(); });
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([]);
  if (refreshFails) jest.mocked(database.getMaterialsByOrder).mockRejectedValueOnce(new Error('database is busy'));
  await act(async () => { jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2](); });
  await tick();
  expect(database.deleteMaterial).toHaveBeenCalledWith(jest.mocked(database.saveUnpackOperation).mock.calls[0][0].material.id);
  await scan('Model A/2500/ORIGINAL');
  expect(root.root.findByType(FlatList).props.data[0].scannedQuantity).toBe(0);
  await act(async () => { await root.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  expect(database.saveUnpackOperation).toHaveBeenCalledTimes(2);
  await act(async () => { card!.unmount(); });
});

it.each(['123', 'MD85E33YA2', 'IC.00000305.01', 'ABC-123', '123\r\n'])(
  'silently ignores delimiter-free material code %j before and after selecting an order', async code => {
    await scan(code);
    expect(useToast().showToast).not.toHaveBeenCalled();
    expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
    await scan(no);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
    await tick(OUTBOUND_VERIFICATION_TTL_MS);
    jest.clearAllMocks();
    await scan(code);
    expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(database.getInventoryCodeByModel).not.toHaveBeenCalled();
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(database.saveUnpackOperation).not.toHaveBeenCalled();
    expect(useToast().showToast).not.toHaveBeenCalled();
    expect(feedbackSuccess).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();
    expect(feedbackWarning).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
    await scan('Model A/100');
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  }
);

it('allows a configured space delimiter and still validates structured codes with no matching rule', async () => {
  const rule = { id: 'space-rule', name: 'Space', separator: ' ' } as database.QRCodeRule;
  jest.mocked(database.getActiveRules).mockResolvedValue([rule]);
  await scan(no);
  await scan('MD85E33YA2 100');
  expect(database.detectRule).toHaveBeenCalledWith('MD85E33YA2 100', [rule]);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  jest.mocked(database.detectRule).mockResolvedValueOnce(null);
  await scan('Unknown/100');
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(useToast().showToast).toHaveBeenCalledWith('没有匹配的二维码解析规则，请先在设置中配置', 'error');
});

it('starts the cached order live query while local restoration is still pending and applies it only afterward', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await scan(secondNo);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  let finishLocalRestore!: (value: null) => void;
  jest.mocked(database.getOrder).mockImplementationOnce(() => new Promise(resolve => { finishLocalRestore = resolve; }));
  // Force the cache to win; live ERP still completes while local restoration waits.
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() =>
    new Promise(resolve => { setTimeout(() => resolve(voucher(4000)), 0); }));
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(no);

  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(jest.mocked(fetchSaleDispatchVoucher).mock.calls.at(-1)?.[2]).toEqual({ bypassCache: true });
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(100);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();

  await act(async () => { finishLocalRestore(null); });
  await tick();
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 4000, scannedQuantity: 3000, status: 'partial',
  });
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['switched']]);
});

it('handles an early cached live-query rejection without accepting the old cached quantities', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await scan(secondNo);
  let finishLocalRestore!: (value: null) => void;
  jest.mocked(database.getOrder).mockImplementationOnce(() => new Promise(resolve => { finishLocalRestore = resolve; }));
  // This case specifically exercises a cached result followed by failed verification.
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() =>
    new Promise((_, reject) => { setTimeout(() => reject(new Error('ERP temporarily unavailable')), 0); }));
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(no);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  await act(async () => { finishLocalRestore(null); });
  await tick();
  await scan('Model A/100');

  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalledWith('订单未核验，请重新扫描订单');
});

it('does not apply a prefetched cached query when local restoration finishes after leaving the page', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await scan(secondNo);
  let finishLocalRestore!: (value: null) => void;
  jest.mocked(database.getOrder).mockImplementationOnce(() => new Promise(resolve => { finishLocalRestore = resolve; }));
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() =>
    new Promise(resolve => { setTimeout(() => resolve(voucher(4000)), 0); }));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  await scan(no);

  await act(async () => { mockScreenFocused = false; root.update(<PDAScanScreen />); });
  await act(async () => { finishLocalRestore(null); });
  await tick();
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(100);
});

it('does not restart verification freshness when a prefetched response waits beyond the verification window for local restoration', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await scan(secondNo);
  const orderWritesBefore = jest.mocked(database.upsertOrder).mock.calls.length;
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([historical(3000)]);
  let finishLocalRestore!: (value: null) => void;
  jest.mocked(database.getOrder).mockImplementationOnce(() => new Promise(resolve => { finishLocalRestore = resolve; }));
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() =>
    new Promise(resolve => { setTimeout(() => resolve(voucher(3000)), 0); }));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  await scan(no);
  await tick(OUTBOUND_VERIFICATION_TTL_MS);
  await act(async () => { finishLocalRestore(null); });
  await tick();

  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  // 缓存恢复阶段写一次；过期实时结果不能再应用或改写订单元数据。
  expect(database.upsertOrder).toHaveBeenCalledTimes(orderWritesBefore + 1);
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderComplete).not.toHaveBeenCalled();
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(feedbackError).toHaveBeenCalledWith('订单加载失败，请查看提示');
});

it('uses the 80 ms order debounce when scanning the next order after the first order is loaded', async () => {
  await scan(no);
  jest.mocked(fetchSaleDispatchVoucher).mockClear();
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(100, secondNo));
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(secondNo); });
  await tick(79);
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await tick(1);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
});

it.each(['\n', '\r\n'])('immediately submits a complete order ending in %j only once with a following Enter', async ending => {
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(no + ending); });
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing(); });
  await tick();
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
});

it('waits for CRLF to finish and does not submit a separate CR input twice', async () => {
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(no + '\r'); });
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(no + '\r\n'); });
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing(); });
  await tick();
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
});

it('does not treat an incomplete order with LF as a complete scan', async () => {
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText('IO-2026-09-06-0\n'); });
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await tick(150);
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
});

it('keeps original material line endings during the quiet-period fallback after loading an order', async () => {
  await scan(no);
  jest.mocked(database.detectRule).mockClear();
  const raw = 'Model A/100\r\n';
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(raw); });
  await tick(499);
  expect(database.detectRule).not.toHaveBeenCalled();
  await tick(1);
  expect(database.detectRule).toHaveBeenCalledWith(raw, expect.any(Array));
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
});

describe('material scanner completion boundaries', () => {
  const rule: database.QRCodeRule = {
    id: 'three-fields', name: 'Three fields', description: '', separator: '/',
    fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '',
  };
  const full = 'Model A/LOT-1/100';
  beforeEach(async () => {
    jest.mocked(database.getActiveRules).mockResolvedValue([rule]);
    jest.mocked(database.detectRule).mockImplementation(async code =>
      database.inspectQRCodeRule(code, rule).matched ? rule : null
    );
    await scan(no);
    jest.mocked(database.detectRule).mockClear();
    jest.mocked(database.addMaterialWithOrder).mockClear();
    jest.mocked(feedbackSuccess).mockClear();
    jest.mocked(feedbackError).mockClear();
  });

  it('does not consume a Geehy label while the final box field is still arriving', async () => {
    const geehy = { ...rule, id: 'geehy', fieldOrder: [
      'model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo',
    ] };
    jest.mocked(database.getActiveRules).mockResolvedValue([geehy]);
    jest.mocked(database.detectRule).mockImplementation(async raw =>
      database.inspectQRCodeRule(raw, geehy).matched ? geehy : null);
    jest.mocked(database.parseWithRule).mockImplementation(jest.requireActual('@/utils/database').parseWithRule);
    jest.mocked(database.getInventoryBindingMatchByModel).mockImplementation(async model =>
      ({ inventoryCode: model === 'APM32F103RBT6' ? 'A' : null, matchKind: 'exact' }));
    const code = (suffix: number) => `APM32F103RBT6/NYORY/LQFP64/801204300041/960/2436/BT7124009010023-${suffix}/OPGD144429023`;
    const input = () => root.root.findByType(WarehouseScanInput).props;
    for (const suffix of [10, 11, 12]) {
      const raw = code(suffix);
      await act(async () => { input().onChangeText(raw.slice(0, -7)); });
      await tick(220);
      expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(suffix - 10);
      expect(input().value).toBe(raw.slice(0, -7));
      await act(async () => {
        input().onChangeText(raw);
        input().onSubmitEditing({ nativeEvent: { text: raw } });
      });
      await tick(0);
      expect(input().value).toBe('');
      expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(suffix - 9);
    }
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([code(10), code(11), code(12)]);
    expect(jest.mocked(database.addMaterialWithOrder).mock.calls.map(([item]) => [item.model, item.sourceNo]))
      .toEqual(Array.from({ length: 3 }, () => ['APM32F103RBT6', 'OPGD144429023']));
    expect(feedbackNotBound).not.toHaveBeenCalled();
  });

  it('accepts three complete Geehy packages 200ms apart with Enter without waiting for the fallback', async () => {
    const geehyRule = { ...rule, id: 'geehy', fieldOrder: [
      'model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo',
    ] };
    jest.mocked(database.getActiveRules).mockResolvedValue([geehyRule]);
    // 模拟实际规则拆字段，不能用固定型号 mock 掩盖串码。
    jest.mocked(database.detectRule).mockImplementation(async code =>
      database.inspectQRCodeRule(code, geehyRule).matched ? geehyRule : null);
    jest.mocked(database.parseWithRule).mockImplementation(jest.requireActual('@/utils/database').parseWithRule);
    jest.mocked(database.getInventoryBindingMatchByModel).mockImplementation(async model =>
      ({ inventoryCode: model === 'APM32F103RBT6' ? 'A' : null, matchKind: 'exact' }));
    const code = (suffix: string) => `APM32F103RBT6/NYORY/LQFP64/801204300041/960/2436/BT7124009010023-${suffix}/OPGD144429023`;
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(code('10')); });
    await tick(149);
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: code('10') } }); });
    await tick(1);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
    await tick(50);
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(code('11')); });
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: code('11') } }); });
    await tick(150);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
    await tick(50);
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(code('12')); });
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: code('12') } }); });
    await tick(150);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([code('10'), code('11'), code('12')]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(3);
    expect(jest.mocked(database.addMaterialWithOrder).mock.calls.map(([material]) =>
      [material.model, material.quantity, material.traceNo])).toEqual([
      ['APM32F103RBT6', 960, 'BT7124009010023-10'],
      ['APM32F103RBT6', 960, 'BT7124009010023-11'],
      ['APM32F103RBT6', 960, 'BT7124009010023-12'],
    ]);
    expect(feedbackNotBound).not.toHaveBeenCalled();
  });

  it.each([false, true])('queues a confirmed previous scan as soon as the next starts before 150ms (cumulative=%s)', async cumulative => {
    const next = 'Model A/LOT-2/100';
    const input = () => root.root.findByType(WarehouseScanInput).props;
    await act(async () => {
      input().onChangeText('Model A/LOT-1');
      input().onSubmitEditing({ nativeEvent: { text: full } });
    });
    await tick(20);
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    await act(async () => { input().onChangeText(cumulative ? full + next : next); });
    await tick(0);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(database.detectRule).toHaveBeenCalledWith(full, [rule]);
    expect(input().value).toBe(next);
    await act(async () => { input().onSubmitEditing({ nativeEvent: { text: cumulative ? full + next : next } }); });
    expect(input().value).toBe('');
    await tick(200);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next]);
  });

  it('recovers the next frame when native clear after a normal Enter is late', async () => {
    const next = 'Model A/LOT-2/100';
    const input = () => root.root.findByType(WarehouseScanInput).props;
    await act(async () => {
      input().onChangeText(full);
      input().onSubmitEditing({ nativeEvent: { text: full } });
    });
    await tick(200);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await act(async () => {
      input().onChangeText(full + 'Model A/LOT-2');
      input().onChangeText(full + next);
      input().onSubmitEditing({ nativeEvent: { text: full + next } });
    });
    await tick(200);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  });

  it('recovers the next frame when native clear after a quiet-period submission is late', async () => {
    const next = 'Model A/LOT-2/100';
    const input = () => root.root.findByType(WarehouseScanInput).props;
    await act(async () => { input().onChangeText(full); });
    await tick(500);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await act(async () => { input().onChangeText(full + next); });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  });

  it('keeps each confirmed frame boundary while the first rules read is blocked', async () => {
    let finishRules!: (value: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    const next = 'Model A/LOT-2/100';
    const third = 'Model A/LOT-3/100';
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText(full);
      input().onSubmitEditing({ nativeEvent: { text: full } });
      input().onChangeText(full + next);
      input().onSubmitEditing({ nativeEvent: { text: full + next } });
      input().onChangeText(full + next + third);
      input().onSubmitEditing({ nativeEvent: { text: full + next + third } });
    });
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
    await act(async () => { finishRules([rule]); });
    await tick(250);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next, third]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(3);
  });

  it('does not cut a new valid QR whose last trace extends the previous trace', async () => {
    const traceRule = { ...rule, fieldOrder: ['model', 'batch', 'quantity', 'traceNo'] };
    jest.mocked(database.getActiveRules).mockResolvedValue([traceRule]);
    jest.mocked(database.detectRule).mockImplementation(async code =>
      database.inspectQRCodeRule(code, traceRule).matched ? traceRule : null);
    const first = 'Model A/LOT-1/100/TRACE-1';
    const next = 'Model A/LOT-1/100/TRACE-10';
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText(first);
      input().onSubmitEditing({ nativeEvent: { text: first } });
    });
    await tick(200);
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText(next);
      input().onSubmitEditing({ nativeEvent: { text: next } });
    });
    await tick(200);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([first, next]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('preserves a confirmed previous package when the next scan starts immediately (cumulative=%s)', async cumulative => {
    const next = 'Model A/LOT-2/100';
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText('Model A/LOT-1');
      input().onSubmitEditing({ nativeEvent: { text: full } });
      input().onChangeText(cumulative ? full + 'Model A/LOT-2' : 'Model A/LOT-2');
      if (cumulative) {
        input().onChangeText(full); // 前包的旧快照不能擦掉第二包。
        input().onSubmitEditing({ nativeEvent: { text: full } });
      }
      input().onChangeText(cumulative ? full + next : next);
      input().onSubmitEditing({ nativeEvent: { text: cumulative ? full + next : next } });
    });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
    expect(feedbackNotBound).not.toHaveBeenCalled();
  });

  it('retains the consumed native prefix when Enter promotes the second frame before another cumulative change', async () => {
    const next = 'Model A/LOT-2/100';
    const third = 'Model A/LOT-3/100';
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText('Model A/LOT-1');
      input().onSubmitEditing({ nativeEvent: { text: full } });
      input().onChangeText(full + 'Model A/LOT-2');
      input().onSubmitEditing({ nativeEvent: { text: full + next } });
      input().onChangeText(full + next);
      input().onChangeText(full + next + 'Model A/LOT-3');
      input().onChangeText(full + next + third);
      input().onSubmitEditing({ nativeEvent: { text: full + next + third } });
    });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, next, third]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(3);
  });

  it('accepts two identical no-trace packages at a confirmed cumulative boundary without time-based deduplication', async () => {
    await act(async () => {
      const input = () => root.root.findByType(WarehouseScanInput).props;
      input().onChangeText('Model A/LOT-1');
      input().onSubmitEditing({ nativeEvent: { text: full } });
      input().onChangeText(full + full);
      input().onChangeText(full); // 原生受控值跟上，只剩第二包。
      input().onSubmitEditing({ nativeEvent: { text: full } });
    });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([raw]) => raw)).toEqual([full, full]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  });

  it('coalesces complete native Enter with its delayed final change and still accepts a new identical package', async () => {
    const input = () => root.root.findByType(WarehouseScanInput).props;
    await act(async () => {
      input().onChangeText('Model A/LOT-1');
      input().onSubmitEditing({ nativeEvent: { text: full } });
      input().onSubmitEditing({ nativeEvent: { text: full } });
    });
    await tick(100);
    expect(database.detectRule).not.toHaveBeenCalled();
    await act(async () => { input().onChangeText(full); });
    await tick(149);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(1);
    expect(database.detectRule).toHaveBeenCalledWith(full, [rule]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await act(async () => { input().onSubmitEditing({ nativeEvent: { text: full } }); });
    await tick();
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await scan(full);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
    expect(feedbackError).not.toHaveBeenCalled();
  });

  it.each(['Model A', 'Model A/LOT-1'])('retains partial input %s across a 150 ms pause and parses only its continuation', async prefix => {
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(prefix); });
    await tick(151);
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe(prefix);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(full); });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([code]) => code)).toEqual([full]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  });

  it('reports a genuinely incomplete structured QR once after the bounded wait', async () => {
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText('Unknown/LOT'); });
    await tick(499);
    expect(database.detectRule).not.toHaveBeenCalled();
    await tick(1);
    expect(database.detectRule).toHaveBeenCalledTimes(1);
    expect(feedbackError).toHaveBeenCalledTimes(1);
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
  });

  it('does not let an older unrelated Enter cancel the new package timer', async () => {
    await scan(full);
    const next = 'Model A/LOT-2/100';
    await act(async () => {
      root.root.findByType(WarehouseScanInput).props.onChangeText(next);
      root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: full } });
    });
    await tick(500);
    expect(jest.mocked(database.detectRule).mock.calls.map(([code]) => code)).toEqual([full, next]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  });

  it('waits for the first rule read and processes a complete QR once', async () => {
    let finishRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText(full); });
    await tick(200);
    expect(database.detectRule).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe(full);
    await act(async () => { finishRules([rule]); });
    await tick(500);
    expect(database.detectRule).toHaveBeenCalledWith(full, [rule]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale async completion check after a new scan is explicitly submitted', async () => {
    let finishOldRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishOldRules = resolve; }));
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText('Old/LOT'); });
    await tick(150);
    await scan(full);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await act(async () => { finishOldRules([{ ...rule, id: 'old-rule' }]); });
    await tick(1000);
    expect(jest.mocked(database.detectRule).mock.calls.map(([code]) => code)).toEqual([full]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    await scan('Model A/LOT-2/100');
    expect(database.detectRule).toHaveBeenLastCalledWith('Model A/LOT-2/100', [rule]);
  });

  it('does not revive a promoted QR or an old rule check after leaving and reentering the screen', async () => {
    let finishOldRules!: (rules: database.QRCodeRule[]) => void;
    jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishOldRules = resolve; }));
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText('Old/LOT'); });
    await tick(150);
    await act(async () => {
      root.root.findByType(WarehouseScanInput).props.onChangeText('Model A/LOT-1');
      root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: full } });
    });
    await act(async () => { mockScreenFocused = false; root.update(<PDAScanScreen />); });
    await act(async () => { mockScreenFocused = true; root.update(<PDAScanScreen />); });
    await tick();
    expect(root.root.findByType(WarehouseScanInput).props.value).toBe('');
    await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: full } }); });
    await act(async () => { finishOldRules([{ ...rule, id: 'old-rule' }]); });
    await tick(1000);
    expect(database.detectRule).not.toHaveBeenCalled();
    await scan(full);
    expect(database.detectRule).toHaveBeenCalledWith(full, [rule]);
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  });
});

it('loads three different fresh orders once each without an unnecessary local customer lookup', async () => {
  jest.mocked(database.getOrder).mockClear();
  jest.mocked(database.getOrder).mockRejectedValue(new Error('No local fallback should be needed'));
  const orderNos = [no, 'IO-2026-09-06-002', 'IO-2026-09-06-003'];
  for (const [index, orderNo] of orderNos.entries()) {
    const fresh = voucher(100 * (index + 1), orderNo);
    fresh.customerName = `Customer ${index + 1}`;
    jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(fresh);
    await scan(orderNo);
    expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
      requiredQuantity: fresh.lines[0].quantity, scannedQuantity: 0,
    });
  }
  expect(jest.mocked(fetchSaleDispatchVoucher).mock.calls.map(([, orderNo]) => orderNo)).toEqual(orderNos);
  expect(database.getOrder).not.toHaveBeenCalled();
  expect(jest.mocked(database.upsertOrder).mock.calls.map(([orderNo, customer]) => [orderNo, customer]))
    .toEqual(orderNos.map((orderNo, index) => [orderNo, `Customer ${index + 1}`]));
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['loaded'], ['switched'], ['switched']]);
});

it('shows fresh order B before its local records finish loading but keeps queued order C and its material correctly scoped', async () => {
  const secondNo = 'IO-2026-09-06-002';
  const thirdNo = 'IO-2026-09-06-003';
  await scan(no);
  let finishSecondQuery!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() => new Promise(resolve => { finishSecondQuery = resolve; }));
  let finishSecondHistory!: (value: database.MaterialRecord[]) => void;
  jest.mocked(database.getMaterialsByOrder).mockImplementationOnce(() => new Promise(resolve => { finishSecondHistory = resolve; }));
  const thirdVoucher = voucher(500, thirdNo);
  thirdVoucher.customerName = 'Customer C';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(thirdVoucher);

  await scan(secondNo);
  await scan(thirdNo);
  await scan('Model A/100');
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  const secondVoucher = voucher(200, secondNo);
  secondVoucher.customerName = 'Customer B';
  await act(async () => { finishSecondQuery(secondVoucher); });
  await tick();

  expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
    requiredQuantity: 200, scannedQuantity: 0,
  });
  expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(true);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['loaded']]);

  await act(async () => { finishSecondHistory([]); });
  await tick();
  expect(jest.mocked(fetchSaleDispatchVoucher).mock.calls.map(([, orderNo]) => orderNo)).toEqual([no, secondNo, thirdNo]);
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
  expect(database.addMaterialWithOrder).toHaveBeenCalledWith(expect.objectContaining({
    order_no: thirdNo, customer_name: 'Customer C',
  }), 'Customer C', expect.objectContaining({ id: warehouse.id }));
  expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(500);
});

it('still reads the local customer fallback when a fresh ERP order has no customer name', async () => {
  const fresh = voucher();
  fresh.customerName = '';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(fresh);
  jest.mocked(database.getOrder).mockResolvedValueOnce({
    id: 'local-order', order_no: no, customer_name: 'Saved customer', created_at: '',
    warehouse_id: warehouse.id, warehouse_name: warehouse.name,
  });
  await scan(no);
  expect(database.getOrder).toHaveBeenCalledWith(no, warehouse.id);
  expect(database.upsertOrder).toHaveBeenCalledWith(no, 'Saved customer', expect.objectContaining({ id: warehouse.id }));
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
});

it('persists a fresh order draft and number together in one storage batch', async () => {
  await scan(no);
  expect(AsyncStorage.multiSet).toHaveBeenCalledWith([
    [STORAGE_KEYS.OUTBOUND_WORK_DRAFT, expect.any(String)],
    [STORAGE_KEYS.OUTBOUND_ORDER_NO, no],
  ]);
  expect(await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_NO)).toBe(no);
  const saved = JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT))!);
  expect(saved).toMatchObject({ orderNo: no, customerName: 'Demo customer', warehouseId: warehouse.id });
  expect(saved.erpVoucher.lines[0].quantity).toBe(3000);
});

it('shows a verified fresh order before its local ERP cache read completes and never queries that order twice', async () => {
  const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!readStorage) throw new Error('Missing storage fixture');
  let finishCacheRead!: (value: null) => void;
  const cacheRead = new Promise<null>(resolve => { finishCacheRead = resolve; });
  jest.mocked(AsyncStorage.getItem).mockImplementation(key =>
    key === '@outbound_erp_voucher_cache' ? cacheRead : readStorage(key));
  try {
    await scan(no);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
    expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
    expect(summaryValue('order')).toBe(no);
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);
    expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(false);
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
    await act(async () => { finishCacheRead(null); });
    await tick();
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
    expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
  }
});

it('loads three different live orders across ERP warehouses while every cache read is blocked and ignores late stale cache results', async () => {
  const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!readStorage) throw new Error('Missing storage fixture');
  const finishCacheReads: Array<(value: string | null) => void> = [];
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => key === '@outbound_erp_voucher_cache'
    ? new Promise(resolve => { finishCacheReads.push(resolve); })
    : readStorage(key));
  // No order request may wait for QR parsing rules, even when that read cannot finish.
  jest.mocked(database.getActiveRules).mockImplementation(() => new Promise(() => undefined));
  const orderNos = ['IO-2026-09-06-01', no, 'IO-2026-09-06-002'];
  const staleCache: Record<string, { cachedAt: number; voucher: ReturnType<typeof voucher> }> = {};
  try {
    for (const [index, orderNo] of orderNos.entries()) {
      const fresh = voucher(100 * (index + 1), orderNo);
      fresh.customerName = `Live customer ${index + 1}`;
      jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(fresh);
      await scan(orderNo);

      expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(index + 1);
      expect(summaryValue('order')).toBe(orderNo);
      expect(summaryValue('customer')).toBe(fresh.customerName);
      expect(summaryValue('account')).toBe(fresh.accountName);
      expect(database.getMaterialsByOrder).toHaveBeenLastCalledWith(
        orderNo, index === 0 ? shanghaiWarehouse.id : warehouse.id
      );
      expect(root.root.findByType(FlatList).props.data[0]).toMatchObject({
        requiredQuantity: fresh.lines[0].quantity, scannedQuantity: 0,
      });
      expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(false);
      expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(index + 1);
      const stale = voucher(9999, orderNo);
      stale.customerName = 'Stale customer';
      staleCache[`${stale.accountKey}:${orderNo}`] = { cachedAt: Date.now(), voucher: stale };
    }
    expect(database.getActiveRules).not.toHaveBeenCalled();
    expect(database.getOrder).not.toHaveBeenCalled();
    expect(jest.mocked(fetchSaleDispatchVoucher).mock.calls.map(([, orderNo]) => orderNo)).toEqual(orderNos);
    expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['loaded'], ['switched'], ['switched']]);
    expect(finishCacheReads.length).toBeGreaterThanOrEqual(orderNos.length);

    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
    await act(async () => { finishCacheReads.forEach(finish => finish(JSON.stringify(staleCache))); });
    await tick();
    expect(summaryValue('order')).toBe(orderNos[2]);
    expect(summaryValue('customer')).toBe('Live customer 3');
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(300);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
    expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(3);
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
    jest.mocked(database.getActiveRules).mockResolvedValue([]);
  }
});

it('loads the live ERP order when local cache reads reject without making a second request', async () => {
  const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!readStorage) throw new Error('Missing storage fixture');
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => key === '@outbound_erp_voucher_cache'
    ? Promise.reject(new Error('Cache storage unavailable'))
    : readStorage(key));
  try {
    await scan(no);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
    expect(summaryValue('order')).toBe(no);
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);
    expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
    expect(feedbackError).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(false);
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
  }
});

it('reports live ERP failure before a blocked cache finishes and refuses materials even when stale cache arrives later', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-002';
  const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!readStorage) throw new Error('Missing storage fixture');
  let finishCacheRead!: (value: string | null) => void;
  const cacheRead = new Promise<string | null>(resolve => { finishCacheRead = resolve; });
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => key === '@outbound_erp_voucher_cache'
    ? cacheRead
    : readStorage(key));
  jest.mocked(fetchSaleDispatchVoucher).mockRejectedValueOnce(new Error('Live ERP unavailable'));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(feedbackError).mockClear();
  try {
    await scan(secondNo);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(feedbackError).toHaveBeenCalledWith('订单加载失败，请查看提示');
    expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(false);
    expect(summaryValue('order')).toBe(no);
    await scan('Model A/100');
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();

    const stale = voucher(9999, secondNo);
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
    await act(async () => { finishCacheRead(JSON.stringify({
      [`${stale.accountKey}:${secondNo}`]: { cachedAt: Date.now(), voucher: stale },
    })); });
    await tick();
    expect(summaryValue('order')).toBe(no);
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(3000);
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    await scan('Model A/100');
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(2);
  } finally {
    jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage);
  }
});

it('uses the 80 ms order path for a complete native Enter while an older partial-input rule read is blocked', async () => {
  let finishRules!: (rules: database.QRCodeRule[]) => void;
  jest.mocked(database.getActiveRules).mockImplementationOnce(() => new Promise(resolve => { finishRules = resolve; }));
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onChangeText('IO-2026-09-06-0'); });
  await tick(150);
  expect(database.getActiveRules).toHaveBeenCalledTimes(1);
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await act(async () => { root.root.findByType(WarehouseScanInput).props.onSubmitEditing({ nativeEvent: { text: no } }); });
  await tick(79);
  expect(fetchSaleDispatchVoucher).not.toHaveBeenCalled();
  await tick(1);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(summaryValue('order')).toBe(no);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('loaded');
  await act(async () => { finishRules([]); });
  await tick();
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
  expect(database.detectRule).not.toHaveBeenCalled();
});

it('publishes a different ERP warehouse and order together while the warehouse write is pending, but holds queued materials and readiness', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-01';
  const secondVoucher = voucher(500, secondNo);
  secondVoucher.customerName = 'Customer B';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(secondVoucher);
  const writeStorage = jest.mocked(AsyncStorage.setItem).getMockImplementation();
  if (!writeStorage) throw new Error('Missing storage fixture');
  let finishWarehouseWrite!: () => Promise<void>;
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => key === STORAGE_KEYS.GLOBAL_WAREHOUSE
    ? new Promise<void>(resolve => {
      finishWarehouseWrite = async () => { await writeStorage(key, value); resolve(); };
    })
    : writeStorage(key, value));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(useToast().showToast).mockClear();
  try {
    await scan(secondNo);

    expect(summaryValue('order')).toBe(secondNo);
    expect(summaryValue('customer')).toBe('Customer B');
    expect(summaryValue('account')).toBe(secondVoucher.accountName);
    expect(database.getMaterialsByOrder).toHaveBeenLastCalledWith(secondNo, shanghaiWarehouse.id);
    expect(root.root.findByType(FlatList).props.data[0].requiredQuantity).toBe(500);
    expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(true);
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(useToast().showToast).not.toHaveBeenCalled();

    await scan('Model A/100');
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    await act(async () => { await finishWarehouseWrite(); });
    await tick();

    expect(feedbackOutboundOrderReady).toHaveBeenCalledTimes(1);
    expect(feedbackOutboundOrderReady).toHaveBeenCalledWith('switched');
    expect(useToast().showToast).toHaveBeenCalledWith('订单已切换', 'success');
    expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(1);
    expect(database.addMaterialWithOrder).toHaveBeenCalledWith(expect.objectContaining({
      order_no: secondNo, warehouse_id: shanghaiWarehouse.id, customer_name: 'Customer B',
    }), 'Customer B', expect.objectContaining({ id: shanghaiWarehouse.id }));
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEYS.GLOBAL_WAREHOUSE))!).id).toBe(shanghaiWarehouse.id);
  } finally {
    jest.mocked(AsyncStorage.setItem).mockImplementation(writeStorage);
  }
});

it('waits for late material restoration after an early warehouse write failure, then revokes ERP readiness and blocks subsequent materials', async () => {
  await scan(no);
  const secondNo = 'IO-2026-09-06-01';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(500, secondNo));
  let finishHistory!: (rows: database.MaterialRecord[]) => void;
  jest.mocked(database.getMaterialsByOrder).mockImplementationOnce(() => new Promise(resolve => { finishHistory = resolve; }));
  const writeStorage = jest.mocked(AsyncStorage.setItem).getMockImplementation();
  if (!writeStorage) throw new Error('Missing storage fixture');
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => key === STORAGE_KEYS.GLOBAL_WAREHOUSE
    ? Promise.reject(new Error('warehouse storage unavailable'))
    : writeStorage(key, value));
  jest.mocked(feedbackOutboundOrderReady).mockClear();
  jest.mocked(feedbackError).mockClear();
  try {
    await scan(secondNo);
    expect(summaryValue('order')).toBe(secondNo);
    expect(database.getMaterialsByOrder).toHaveBeenLastCalledWith(secondNo, shanghaiWarehouse.id);
    expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(true);
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(feedbackError).not.toHaveBeenCalled();

    await act(async () => { finishHistory([]); });
    await tick();
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(root.root.findByType(WarehouseScanInput).props.statusLabel).toBe('ERP单据需要验证');
    expect(useToast().showToast).toHaveBeenCalledWith(expect.stringContaining('订单仓库设置保存失败'), 'error');

    await scan('Model A/100');
    expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();
    expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
    expect(feedbackError).toHaveBeenCalledWith('订单未核验，请重新扫描订单');
  } finally {
    jest.mocked(AsyncStorage.setItem).mockImplementation(writeStorage);
  }
});

it('keeps cached order verification quiet and emits only the final successful switch result', async () => {
  const secondNo = 'IO-2026-09-06-002';
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValueOnce(voucher(200, secondNo));
  await scan(secondNo);
  await scan(no);
  let finishVerification!: (value: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockImplementationOnce(() => new Promise(resolve => { finishVerification = resolve; }));
  jest.mocked(useToast().showToast).mockClear();
  jest.mocked(feedbackOutboundOrderReady).mockClear();

  await scan(secondNo);
  expect(summaryValue('order')).toBe(secondNo);
  expect(root.root.findByType(WarehouseScanInput).props.processing).toBe(true);
  expect(useToast().showToast).not.toHaveBeenCalled();
  expect(feedbackOutboundOrderReady).not.toHaveBeenCalled();

  await act(async () => { finishVerification(voucher(300, secondNo)); });
  await tick();
  expect(jest.mocked(useToast().showToast).mock.calls).toEqual([['订单已切换', 'success']]);
  expect(jest.mocked(feedbackOutboundOrderReady).mock.calls).toEqual([['switched']]);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(3);
  expect(database.addMaterialWithOrder).not.toHaveBeenCalled();
});

describe('outbound back navigation', () => {
  const getBackListener = () => {
    const calls = jest.mocked(BackHandler.addEventListener).mock.calls;
    return calls.filter(([event]) => event === 'hardwareBackPress').at(-1)![1];
  };
  let backSubscription: jest.SpiedFunction<typeof BackHandler.addEventListener>;

  beforeEach(async () => {
    await act(async () => { root.unmount(); });
    backSubscription = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
    await tick();
  });
  afterEach(() => { backSubscription.mockRestore(); });

  it.each(['header', 'hardware'])('closes the warehouse picker before %s back without losing the loaded order', async source => {
    await act(async () => { root.unmount(); });
    const react = require('react') as typeof import('react');
    const useState = react.useState;
    let reachedWarehouseConfiguration = false;
    let openPicker: ((open: boolean) => void) | undefined;
    // This picker only opens for a missing-warehouse scan, behind earlier ERP checks.
    // Seed that overlay state explicitly, then exercise the real page back event.
    const stateFixture = jest.spyOn(react, 'useState').mockImplementation(((initial: unknown) => {
      const state = useState(initial);
      if (!openPicker && reachedWarehouseConfiguration && initial === false) openPicker = state[1];
      if (initial === DEFAULT_OUTBOUND_ORDER_RULE) reachedWarehouseConfiguration = true;
      return state;
    }) as typeof react.useState);
    try {
      await act(async () => { root = TestRenderer.create(<PDAScanScreen />); });
    } finally { stateFixture.mockRestore(); }
    await tick();
    await scan(no);
    expect(openPicker).toBeDefined();
    await act(async () => { openPicker!(true); });
    expect(root.root.findAllByType(Text).some(text => text.props.children === '选择仓库')).toBe(true);
    const previousDraft = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT);
    jest.mocked(useCustomAlert().showAlert).mockClear();
    await act(async () => {
      if (source === 'hardware') expect(getBackListener()()).toBe(true);
      else root.root.findByType(UiPageHeader).props.onBack();
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Text).some(text => text.props.children === '选择仓库')).toBe(false);
    expect(summaryValue('order')).toBe(no);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT)).toBe(previousDraft);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(useCustomAlert().showAlert).not.toHaveBeenCalledWith('确认离开出库', expect.anything(), expect.anything(), expect.anything());
    await act(async () => { expect(getBackListener()()).toBe(true); });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('still asks before leaving a loading ERP order and keeps it alive when staying', async () => {
    let finish!: (result: ReturnType<typeof voucher>) => void;
    jest.mocked(fetchSaleDispatchVoucher).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await scan(no);
    await act(async () => { expect(getBackListener()()).toBe(true); });
    expect(mockRouter.back).not.toHaveBeenCalled();
    await pressAlertButton('确认离开出库', '留在此页');
    await act(async () => { finish(voucher()); });
    await tick();
    expect(summaryValue('order')).toBe(no);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('still blocks hardware back while a material is saving, then permits normal exit', async () => {
    await scan(no);
    let finish!: (id: string) => void;
    jest.mocked(database.addMaterialWithOrder).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await scan('Model A/100');
    await act(async () => { expect(getBackListener()()).toBe(true); });
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(useToast().showToast).toHaveBeenCalledWith('正在保存扫码，请处理完成后返回', 'warning');
    await act(async () => { finish('saved-back-test'); });
    await tick();
    await act(async () => { expect(getBackListener()()).toBe(true); });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});


it('native exit while loading confirms once and replays the original action only after approval', async () => {
  let finish!: (result: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await scan(no);
  const guard = jest.requireMock('expo-router/react-navigation').usePreventRemove;
  const [enabled, onRemove] = guard.mock.calls.at(-1);
  expect(enabled).toBe(true);
  const action = { type: 'POP', payload: { count: 1 }, target: 'warehouse-stack' };
  await act(async () => { onRemove({ data: { action } }); });
  expect(mockNativeDispatch).not.toHaveBeenCalled();
  mockNativeDispatch.mockImplementationOnce(() => { expect(guard.mock.calls.at(-1)[0]).toBe(false); });
  await pressAlertButton('确认离开出库', '离开出库');
  expect(mockNativeDispatch).toHaveBeenCalledTimes(1);
  expect(mockNativeDispatch).toHaveBeenCalledWith(action);
  await act(async () => { finish(voucher()); });
  await tick();
  expect(mockNativeDispatch).toHaveBeenCalledTimes(1);
});

it('native exit is blocked while a material is being persisted', async () => {
  await scan(no);
  let finish!: (id: string) => void;
  jest.mocked(database.addMaterialWithOrder).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await scan('Model A/100');
  const guard = jest.requireMock('expo-router/react-navigation').usePreventRemove;
  expect(guard.mock.calls.at(-1)[0]).toBe(true);
  await act(async () => { guard.mock.calls.at(-1)[1]({ data: { action: { type: 'POP' } } }); });
  expect(mockNativeDispatch).not.toHaveBeenCalled();
  expect(useToast().showToast).toHaveBeenCalledWith('正在保存扫码，请处理完成后返回', 'warning');
  await act(async () => { finish('native-back-record'); });
  await tick();
  expect(guard.mock.calls.at(-1)[0]).toBe(false);
});


it('header confirmation releases the native guard before leaving a loading order', async () => {
  let finish!: (result: ReturnType<typeof voucher>) => void;
  jest.mocked(fetchSaleDispatchVoucher).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await scan(no);
  await act(async () => { root.root.findByType(UiPageHeader).props.onBack(); });
  const guard = jest.requireMock('expo-router/react-navigation').usePreventRemove;
  mockRouter.back.mockImplementationOnce(() => { expect(guard.mock.calls.at(-1)[0]).toBe(false); });
  await pressAlertButton('确认离开出库', '离开出库');
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(jest.mocked(useCustomAlert().showAlert).mock.calls.filter(([title]) => title === '确认离开出库')).toHaveLength(1);
  await act(async () => { finish(voucher()); });
  await tick();
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
