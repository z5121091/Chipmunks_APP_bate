import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PDAScanScreen from '../index';
import * as database from '@/utils/database';
import { fetchSaleDispatchVoucher, mapSaleDispatchVoucher } from '@/utils/erpSaleDispatch';
import { getErpAccountByOutboundOrderNo } from '@/utils/erpAccounts';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { UiPageHeader } from '@/components/UiRedesign';
import { AppModalCard } from '@/components/AppModalCard';
import { feedbackError, feedbackSuccess, feedbackWarning, feedbackUnpackRequired, feedbackUnpackComplete, feedbackOutboundOrderComplete } from '@/utils/feedback';
import { useToast } from '@/utils/toast';
import { STORAGE_KEYS } from '@/constants/config';
import { useCustomAlert } from '@/components/CustomAlert';
import { buildRuleConflictDiagnostic, formatRuleConflictDiagnostic } from '@/utils/ruleConflictDiagnosis';
import { FlatList, Text } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
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
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary' }));
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
  initSoundSetting: jest.fn(), useFeedbackCleanup: jest.fn(),
}));
jest.mock('@/utils/scanQueue', () => ({ scanQueue: {
  setBatchWriteFunction: jest.fn(), startTimer: jest.fn(), stopTimer: jest.fn(),
  subscribe: jest.fn(() => jest.fn()), getStats: jest.fn(),
} }));
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
  getInventoryCodeByModel: jest.fn(), checkMaterialExists: jest.fn(), addMaterialWithOrder: jest.fn(),
  getActiveRules: jest.fn(), detectRule: jest.fn(), parseWithRule: jest.fn(),
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
  await AsyncStorage.clear();
  jest.mocked(database.getAllWarehouses).mockResolvedValue([warehouse, shanghaiWarehouse]);
  jest.mocked(database.getDefaultWarehouse).mockResolvedValue(warehouse);
  jest.mocked(database.getMaterialsByOrder).mockReset().mockResolvedValue([]);
  jest.mocked(database.getOrder).mockResolvedValue(null);
  jest.mocked(database.getActiveRules).mockResolvedValue([]);
  jest.mocked(buildRuleConflictDiagnostic).mockReset();
  jest.mocked(formatRuleConflictDiagnostic).mockReset().mockReturnValue('规则冲突诊断');
  jest.mocked(database.detectRule).mockResolvedValue({ id: 'rule', name: 'Rule', separator: '/' } as database.QRCodeRule);
  jest.mocked(database.parseWithRule).mockReturnValue({ standardFields: { model: 'Model A', quantity: '100' }, customFields: {} });
  jest.mocked(database.getInventoryCodeByModel).mockResolvedValue('A');
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
    '规则冲突诊断',
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
  const writesBefore = jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === STORAGE_KEYS.OUTBOUND_WORK_DRAFT).length;
  await scan('Model A/100');
  await scan('Model A/100');
  expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(2);
  expect(feedbackSuccess).toHaveBeenCalledTimes(2);
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
  expect(database.getActiveRules).toHaveBeenCalledTimes(1);
  expect(database.getInventoryCodeByModel).toHaveBeenCalledTimes(1);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === STORAGE_KEYS.OUTBOUND_WORK_DRAFT)).toHaveLength(writesBefore);
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

it('refreshes expired verification before recording the next package and routes by order account', async () => {
  await scan(no);
  await scan('Model A/100');
  await tick(60_000);
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
  await tick(60_000);
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
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([{ ...historical(1500), id: 'unpack-1', isUnpacked: true }]);
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
  expect(database.deleteMaterial).toHaveBeenCalledWith('unpack-1');
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
    await tick(60_000);
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
