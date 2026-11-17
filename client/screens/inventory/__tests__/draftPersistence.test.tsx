import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InventoryScreen from '../index';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { MotionSurface } from '@/components/AppMotion';
import { feedbackSuccess, feedbackConfirm } from '@/utils/feedback';
import { addInventoryCheckRecordsBatch, detectRule, generateCheckNo, getActiveRules, getInternalLabelSpecifications, getInventoryBindingByCode, getInventoryCodeByModel, getInventorySupplierById, requireActiveInternalLabel, updateInventoryCheckDocumentSyncStatus, type QRCodeRule } from '@/utils/database';
import { buildInternalLabel, internalLabelPackageKey, parseInternalLabel } from '@/utils/internalLabelCode';
import { shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { reconcileInventoryRecords } from '@/utils/inventoryReconciliation';
import { syncExcelToComputer } from '@/utils/excel';
import { STORAGE_KEYS } from '@/constants/config';

const mockToast = jest.fn();
const mockAlert = { visible: false, showConfirm: jest.fn() };
const mockScannerFocus = jest.fn();
const mockRouter = { back: jest.fn() };
let mockFocusCallback: () => (() => void) | void;
let mockFocusCleanup: (() => void) | void;
let mockPreventRemove = false;
let mockBlockedRouteRemove: () => void;
let mockHardwareBack: () => boolean | null | undefined;
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => require('react').useEffect(() => {
  mockFocusCallback = callback;
  const cleanup = callback();
  mockFocusCleanup = cleanup;
  return () => { cleanup?.(); };
}, [callback]) }));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (prevent: boolean, callback: () => void) => {
  mockPreventRemove = prevent;
  mockBlockedRouteRemove = callback;
} }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => {
  const { Colors } = require('@/constants/theme');
  return { useTheme: () => ({ theme: Colors.light, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/WarehouseScanInput', () => {
  const React = require('react') as typeof import('react');
  return { WarehouseScanInput: (props: import('@/components/WarehouseScanInput').WarehouseScanInputProps) => {
    React.useImperativeHandle(props.inputRef, () => ({ focus: mockScannerFocus, clear: () => undefined }));
    return React.createElement('ScanInput', props);
  } };
});
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AggregatedRecordItem', () => ({ AggregatedRecordItem: 'Record' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiSafeBottomBar: 'Bottom', UiToolbarButton: 'Toolbar', UiWorkflowSummary: 'Summary' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/toast', () => ({ useToast: () => ({ showToast: mockToast, ToastContainer: () => null }) }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/excel', () => ({ syncExcelToComputer: jest.fn(), formatSyncErrorMessage: (text: string) => text }));
jest.mock('@/utils/inventoryReconciliation', () => ({ reconcileInventoryRecords: jest.fn(), getInventoryCodeLookupKey: (text: string) => text }));
jest.mock('@/utils/qrcodeParser', () => ({ recoverConfirmedScannerContent: (code: string) => code, isQRCode: () => true, shouldWaitForQRCodeContinuation: jest.fn(() => false) }));
jest.mock('@/utils/feedback', () => ({
  feedbackSuccess: jest.fn(), feedbackError: jest.fn(), feedbackWarning: jest.fn(), feedbackClear: jest.fn(), feedbackCancel: jest.fn(),
  feedbackClearFailed: jest.fn(), feedbackDuplicate: jest.fn(), feedbackConfirm: jest.fn(), feedbackInventoryComplete: jest.fn(),
  feedbackNotBound: jest.fn(), feedbackDeleted: jest.fn(), useFeedbackCleanup: jest.fn(),
}));
jest.mock('@/utils/database', () => ({
  getActiveRules: jest.fn(async () => [{}]), detectRule: jest.fn(async () => ({ id: 'R', name: '规则' })),
  parseWithRule: (code: string) => ({ standardFields: { model: 'MODEL', quantity: '10', traceNo: code }, customFields: {} }),
  getInventoryCodeByModel: jest.fn(async () => 'INV'), generateId: () => 'record-1',
  getInventorySupplierById: jest.fn(), getInventoryBindingByCode: jest.fn(),
  requireActiveInternalLabel: jest.fn(),
  getInternalLabelSpecifications: jest.fn(async () => new Map()),
  addInventoryCheckRecordsBatch: jest.fn(), generateCheckNo: jest.fn(), updateInventoryCheckDocumentSyncStatus: jest.fn(),
}));

const DRAFT_KEY = 'inventory_check_records_by_erp_account_v1';
const SCOPE = 'shanghai-chipmunk::erp-account:shanghai-chipmunk';
const supplierRule: QRCodeRule = {
  id: 'R', name: '规则', description: '', separator: '/', fieldOrder: ['model', 'quantity', 'traceNo'],
  supplierId: 'SUPPLIER-A', isActive: true, created_at: '', updated_at: '',
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
let root: TestRenderer.ReactTestRenderer;
const scan = async (code = 'MODEL/10/TRACE') => {
  await act(async () => { root.root.findByType('ScanInput' as never).props.onChangeText(code); });
  await act(async () => { root.root.findByType('ScanInput' as never).props.onSubmitEditing(); });
};
const records = () => root.root.findByType(FlatList).props.data;
const modalCard = (title: string) => root.root.findAllByType(AppModalCard).find(card => card.props.title === title);

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.clearAllMocks();
  jest.mocked(getInventorySupplierById).mockReset().mockResolvedValue({ id: 'SUPPLIER-A', name: '供应商A', binding_count: 1, created_at: '' });
  jest.mocked(getInventoryBindingByCode).mockReset().mockResolvedValue({ id: 'B', scan_model: 'MODEL', inventory_code: 'INV', supplier: '供应商A', created_at: '' });
  mockPreventRemove = false;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    mockHardwareBack = callback;
    return { remove: jest.fn() };
  });
  jest.mocked(reconcileInventoryRecords).mockReset().mockResolvedValue({
    differenceRows: [], erpQuantityByInventoryCode: new Map([['INV', 10]]), queryCount: 1, batchCount: 1,
  });
  jest.mocked(generateCheckNo).mockReset().mockResolvedValue('CHECK-1');
  jest.mocked(addInventoryCheckRecordsBatch).mockReset().mockResolvedValue({ ids: ['record-1'], checkNo: 'CHECK-1', reusedExisting: false });
  jest.mocked(updateInventoryCheckDocumentSyncStatus).mockReset().mockResolvedValue(undefined);
  jest.mocked(syncExcelToComputer).mockReset().mockResolvedValue({ success: true, fileName: '盘点.xlsx' });
  jest.mocked(shouldWaitForQRCodeContinuation).mockReturnValue(false);
  await AsyncStorage.clear();
});

const openSaveConfirmation = async () => {
  await act(async () => {
    root.root.findAllByType('Toolbar' as never).find(button => button.props.label === '完成盘点')!.props.onPress();
  });
};
const confirmSave = async () => {
  await openSaveConfirmation();
  await act(async () => {
    modalCard('完成盘点')!.findByType(AppModalActions).props.onPrimaryPress();
    expect(mockHardwareBack()).toBe(true);
  });
};
const expectNavigationBlocked = async () => {
  expect(mockPreventRemove).toBe(true);
  await act(async () => {
    expect(mockHardwareBack()).toBe(true);
    root.root.findByType('Header' as never).props.onBack();
    mockBlockedRouteRemove();
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith('正在完成盘点，请稍候', 'warning');
};

it('counts equal-quantity internal packs separately, groups by stock code and rejects a repeat scan', async () => {
  const specification = '川土微,CA-IS2062VW,集成隔离电源,CAN隔离器,独立逻辑电源,封装:SOIC16-WB';
  const codes = ['RES.A', 'RES.A', 'RES.B'].map((inventoryCode, index) => buildInternalLabel({
    inventoryCode, quantity: 10, packageId: `PACKAGEID00${index}`, revision: 1,
  }));
  jest.mocked(requireActiveInternalLabel).mockImplementation(async raw => ({
    ...parseInternalLabel(raw), accountKey: 'shanghai-chipmunk', warehouseCode: '001', warehouseName: '无锡总仓',
    inventoryName: '隔离芯片', specification,
  }));
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  for (const code of [...codes, codes[0]]) {
    await scan(code);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  }
  expect(records()).toHaveLength(2);
  expect(records()).toEqual(expect.arrayContaining([
    expect.objectContaining({ model: specification, totalQuantity: 20, count: 2, records: expect.arrayContaining([
      expect.objectContaining({ inventoryCode: 'RES.A', model: '隔离芯片', internalSpecification: specification }),
    ]) }),
    expect.objectContaining({ model: specification, totalQuantity: 10, count: 1, records: expect.arrayContaining([
      expect.objectContaining({ inventoryCode: 'RES.B', model: '隔离芯片', internalSpecification: specification }),
    ]) }),
  ]));
  const group = records()[0];
  const card = root.root.findByType(FlatList).props.renderItem({ item: group });
  expect(card.props.titleNumberOfLines).toBe(2);
  const detail = card.props.renderDetail(group.records[0]);
  expect(detail.props.children[0].props.children).toEqual(['规格型号: ', specification]);
  expect(detail.props.children[0].props.numberOfLines).toBeUndefined();
  expect(mockToast).toHaveBeenCalledWith('本盘点单已扫过此包装', 'warning');
  expect(getInventoryCodeByModel).not.toHaveBeenCalled();
  expect(getInventorySupplierById).not.toHaveBeenCalled();
  expect(getInventoryBindingByCode).not.toHaveBeenCalled();
});

it.each(['same', 'unknown', 'unlinked'] as const)('preserves %s supplier compatibility before persisting an inventory scan', async mode => {
  jest.mocked(detectRule).mockResolvedValueOnce(mode === 'unlinked' ? { ...supplierRule, supplierId: undefined } : supplierRule);
  if (mode === 'unknown') jest.mocked(getInventoryBindingByCode).mockResolvedValueOnce(null);
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  expect(records()).toHaveLength(1);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY))!)[SCOPE]).toHaveLength(1);
  if (mode === 'unlinked') {
    expect(getInventorySupplierById).not.toHaveBeenCalled();
    expect(getInventoryBindingByCode).not.toHaveBeenCalled();
  } else {
    expect(getInventorySupplierById).toHaveBeenCalledWith('SUPPLIER-A');
    expect(getInventoryBindingByCode).toHaveBeenCalledWith('INV');
  }
});

it.each(['mismatched', 'missing'] as const)('rejects a %s explicitly linked supplier without writing a count draft', async mode => {
  jest.mocked(detectRule).mockResolvedValueOnce(supplierRule);
  if (mode === 'missing') jest.mocked(getInventorySupplierById).mockResolvedValueOnce(null);
  else jest.mocked(getInventoryBindingByCode).mockResolvedValueOnce({
    id: 'B', scan_model: 'MODEL', inventory_code: 'INV', supplier: '供应商B', created_at: '',
  });
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  expect(records()).toEqual([]);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining(mode === 'missing' ? '关联的供应商已不存在' : '物料绑定中的供应商：供应商B'), 'error');
});

it('does not save or acknowledge supplier validation from an earlier visit after re-entry', async () => {
  const supplier = deferred<Awaited<ReturnType<typeof getInventorySupplierById>>>();
  jest.mocked(detectRule).mockResolvedValueOnce(supplierRule);
  jest.mocked(getInventorySupplierById).mockReturnValueOnce(supplier.promise);
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan('OLD/10/TRACE');
  expect(getInventorySupplierById).toHaveBeenCalledTimes(1);
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); });
  await act(async () => { supplier.resolve({ id: 'SUPPLIER-A', name: '供应商A', binding_count: 1, created_at: '' }); });
  expect(records()).toEqual([]);
  expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  await scan('NEW/10/TRACE');
  expect(records()[0].records[0].traceCode).toBe('NEW/10/TRACE');
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
});

it('recovers the specification from the local label registry for an older inventory draft', async () => {
  const packageId = 'PACKAGEID000';
  const packageKey = internalLabelPackageKey(packageId);
  const traceCode = buildInternalLabel({ inventoryCode: 'RES.A', quantity: 10, packageId, revision: 1 });
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ [SCOPE]: [{
    id: 'older-draft', traceCode, model: '贴片电阻', batch: '', quantity: 10, inventoryCode: 'RES.A',
    scanTime: '2026-11-11', package_key: packageKey,
  }] }));
  jest.mocked(getInternalLabelSpecifications).mockResolvedValueOnce(new Map([[packageKey, '12KΩ,±1%,0402']]));

  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });

  expect(getInternalLabelSpecifications).toHaveBeenCalledWith([packageKey]);
  expect(records()).toEqual([expect.objectContaining({
    model: '12KΩ,±1%,0402', records: [expect.objectContaining({ model: '贴片电阻', inventoryCode: 'RES.A' })],
  })]);
  expect(requireActiveInternalLabel).not.toHaveBeenCalled();
});

it('blocks header, hardware and native route removal throughout ERP, DB, draft cleanup, sync and status commit', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1' }));
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  const reconciliation = deferred<Awaited<ReturnType<typeof reconcileInventoryRecords>>>();
  const databaseSave = deferred<Awaited<ReturnType<typeof addInventoryCheckRecordsBatch>>>();
  const draftCleanup = deferred<void>();
  const sync = deferred<Awaited<ReturnType<typeof syncExcelToComputer>>>();
  const status = deferred<void>();
  const result = { differenceRows: [], erpQuantityByInventoryCode: new Map([['INV', 10]]), queryCount: 1, batchCount: 1 };
  jest.mocked(reconcileInventoryRecords).mockReturnValueOnce(reconciliation.promise);
  jest.mocked(addInventoryCheckRecordsBatch).mockReturnValueOnce(databaseSave.promise);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => draftCleanup.promise);
  jest.mocked(syncExcelToComputer).mockReturnValueOnce(sync.promise);
  jest.mocked(updateInventoryCheckDocumentSyncStatus).mockReturnValueOnce(status.promise);
  await confirmSave();
  await act(async () => { await jest.advanceTimersByTimeAsync(220); });
  expect(modalCard('完成盘点')).toBeUndefined();
  await expectNavigationBlocked();
  await act(async () => { reconciliation.resolve(result); });
  expect(addInventoryCheckRecordsBatch).toHaveBeenCalledTimes(1);
  await expectNavigationBlocked();
  await act(async () => { databaseSave.resolve({ ids: ['record-1'], checkNo: 'CHECK-1', reusedExisting: false }); });
  expect(syncExcelToComputer).not.toHaveBeenCalled();
  await expectNavigationBlocked();
  await act(async () => { draftCleanup.resolve(); });
  expect(syncExcelToComputer).toHaveBeenCalledTimes(1);
  await expectNavigationBlocked();
  await act(async () => { sync.resolve({ success: true, fileName: '盘点.xlsx' }); });
  expect(updateInventoryCheckDocumentSyncStatus).toHaveBeenCalledTimes(1);
  await expectNavigationBlocked();
  await act(async () => { status.resolve(); });
  expect(mockPreventRemove).toBe(false);
  expect(mockHardwareBack()).toBe(false);
  await act(async () => { root.root.findByType('Header' as never).props.onBack(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('canceling completion restores scanner focus and leaves the draft intact without ERP work', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await openSaveConfirmation();
  const confirmation = modalCard('完成盘点')!;
  expect(confirmation.props.size).toBe('auto');
  expect(confirmation.props.stretchBody).toBeUndefined();
  expect(confirmation.findAllByType(ScrollView)).toHaveLength(1);
  const body = confirmation.findAllByType(View).find(view => view.props.testID === 'app-modal-card-body')!;
  expect(StyleSheet.flatten(body.props.style).flex).toBeUndefined();
  const actions = confirmation.findByType(AppModalActions);
  expect(StyleSheet.flatten(actions.props.containerStyle).marginTop).toBe(0);
  expect(root.root.findByType('ScanInput' as never).props.autoFocus).toBe(false);
  mockScannerFocus.mockClear();
  await act(async () => {
    modalCard('完成盘点')!.findByType(AppModalActions).props.onSecondaryPress();
  });
  expect(root.root.findByType('ScanInput' as never).props.autoFocus).toBe(true);
  expect(mockScannerFocus).toHaveBeenCalled();
  expect(reconcileInventoryRecords).not.toHaveBeenCalled();
  expect(records()).toHaveLength(1);
  expect(mockPreventRemove).toBe(false);
  expect(mockHardwareBack()).toBe(false);
});

it.each(['ERP', 'database'])('releases leave protection after %s failure while preserving the unsaved draft', async stage => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  let reject!: (reason: Error) => void;
  const promise = new Promise<never>((_resolve, fail) => { reject = fail; });
  if (stage === 'ERP') jest.mocked(reconcileInventoryRecords).mockReturnValueOnce(promise);
  else jest.mocked(addInventoryCheckRecordsBatch).mockReturnValueOnce(promise);
  await confirmSave();
  await expectNavigationBlocked();
  await act(async () => { reject(new Error(`${stage} unavailable`)); });
  expect(mockPreventRemove).toBe(false);
  expect(mockHardwareBack()).toBe(false);
  expect(records()).toHaveLength(1);
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('扫描暂存已保留'), 'error');
});

it('allows leaving after a saved count finishes with a computer sync failure', async () => {
  await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1' }));
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  jest.mocked(syncExcelToComputer).mockRejectedValueOnce(new Error('computer offline'));
  await confirmSave();
  expect(mockPreventRemove).toBe(false);
  expect(mockHardwareBack()).toBe(false);
  expect(records()).toEqual([]);
  expect(updateInventoryCheckDocumentSyncStatus).toHaveBeenCalledWith('CHECK-1', expect.any(String), 'failed', undefined, 'computer offline');
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('盘点已保存，稍后可在盘点记录重新同步'), 'warning');
});

it('restores a delayed write after leaving and re-entering without a stale success acknowledgment', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  const write = deferred<void>();
  const realSet = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await write.promise;
    await realSet(key, value);
  });
  await scan();
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); });
  expect(root.root.findByType('ScanInput' as never).props.editable).toBe(false);
  await act(async () => { write.resolve(); });
  expect(records()).toHaveLength(1);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(root.root.findByType('ScanInput' as never).props.editable).toBe(true);
});

it('an old visit finishing cannot unlock a new scan or consume its queued input', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  const oldBinding = deferred<string>();
  const newBinding = deferred<string>();
  jest.mocked(getInventoryCodeByModel).mockReturnValueOnce(oldBinding.promise).mockReturnValueOnce(newBinding.promise);
  await scan('OLD/10/TRACE');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); });
  await scan('NEW/10/TRACE');
  await act(async () => { oldBinding.resolve('INV'); });
  await scan('QUEUED/10/TRACE');
  expect(getInventoryCodeByModel).toHaveBeenCalledTimes(2);
  await act(async () => { newBinding.resolve('INV'); await jest.advanceTimersByTimeAsync(1); });
  expect(records()[0].records).toHaveLength(2);
  expect(feedbackSuccess).toHaveBeenCalledTimes(2);
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('does not acknowledge or add a scan whose durable draft write failed; retry saves one record', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await scan();
  expect(records()).toEqual([]);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('本次扫码未计入'), 'error');
  expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await scan();
  expect(records()).toHaveLength(1);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY))!)[SCOPE]).toHaveLength(1);
});

it('waits for the durable write before showing success and restores that scan after remount', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  const write = deferred<void>();
  const realSet = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await write.promise;
    await realSet(key, value);
  });
  await scan();
  expect(records()).toEqual([]);
  expect(feedbackSuccess).not.toHaveBeenCalled();
  await act(async () => { write.resolve(); });
  expect(records()).toHaveLength(1);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
  await act(async () => { root.unmount(); root = TestRenderer.create(<InventoryScreen />); });
  expect(records()).toHaveLength(1);
});

it('keeps scanning disabled until the initial draft has been restored', async () => {
  const restore = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(restore.promise);
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  expect(root.root.findByType('ScanInput' as never).props.editable).toBe(false);
  await scan();
  expect(feedbackSuccess).not.toHaveBeenCalled();
  await act(async () => { restore.resolve(null); });
  expect(root.root.findByType('ScanInput' as never).props.editable).toBe(true);
});

const openActualQuantityEditor = async () => {
  const list = root.root.findByType(FlatList);
  const group = list.props.data[0];
  let row!: TestRenderer.ReactTestRenderer;
  await act(async () => { row = TestRenderer.create(list.props.renderItem({ item: group })); });
  const renderer = row.root.findByType('Record' as never).props.renderDetail;
  let detail!: TestRenderer.ReactTestRenderer;
  await act(async () => { detail = TestRenderer.create(renderer(group.records[0])); });
  await act(async () => { detail.root.findByType(TouchableOpacity).props.onPress(); });
  await act(async () => { detail.unmount(); row.unmount(); });
};

it.each([[320, 480, 1.3], [360, 640, 1]])('keeps the actual quantity editor compact on a %i dp PDA', async (width, height, fontScale) => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width, height, scale: 1, fontScale });
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await openActualQuantityEditor();
  const card = modalCard('修改实盘数量')!;
  const surface = card.findByType(MotionSurface);
  const viewport = root.root.findAllByType(View).find(node => node.props.testID === 'app-modal-viewport')!;
  const section = (name: 'header' | 'body' | 'footer') => card.findAllByType(View)
    .find(node => node.props.testID === `app-modal-card-${name}`)!;
  const measure = async (node: TestRenderer.ReactTestInstance, measuredHeight: number) => {
    await act(async () => { node.props.onLayout({ nativeEvent: { layout: { height: measuredHeight } } }); });
  };
  await measure(section('header'), 112);
  await measure(section('footer'), 76);
  await measure(viewport, height - 40);
  expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ width: width - 40, maxHeight: height - 40 });
  expect(StyleSheet.flatten(surface.props.style).height).toBeUndefined();
  expect(StyleSheet.flatten(section('body').props.style).flex).toBeUndefined();
  expect(card.findByType(ScrollView).props.scrollEnabled).toBe(false);
  const actions = section('footer').findByType(AppModalActions);
  expect(StyleSheet.flatten(actions.props.containerStyle)).toMatchObject({ marginTop: 0 });
  expect(actions.findAllByType(Text).map(node => node.props.children)).toEqual(['取消', '保存']);

  const input = card.findByType(TextInput);
  await act(async () => { input.props.onChangeText('7'); });
  await measure(viewport, 180);
  expect(card.findByType(ScrollView).props.scrollEnabled).toBe(true);
  expect(StyleSheet.flatten(section('body').props.style).height).toBeUndefined();
  expect(card.findByType(TextInput)).toBe(input);
  expect(input.props.value).toBe('7');
  await measure(viewport, height - 40);
  expect(card.findByType(ScrollView).props.scrollEnabled).toBe(false);

  await act(async () => { actions.props.onSecondaryPress(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(220); });
  expect(records()[0].records[0].actualQuantity).toBe(10);
  expect(modalCard('修改实盘数量')).toBeUndefined();
  await openActualQuantityEditor();
  const saveCard = modalCard('修改实盘数量')!;
  expect(saveCard.findByType(TextInput).props.value).toBe('10');
  await act(async () => { saveCard.findByType(TextInput).props.onChangeText('7'); });
  await act(async () => { await saveCard.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(records()[0].records[0].actualQuantity).toBe(7);
  expect(JSON.parse((await AsyncStorage.getItem(DRAFT_KEY))!)[SCOPE][0].actualQuantity).toBe(7);
});

it('keeps the original actual quantity and editor open if saving a quantity adjustment fails', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await openActualQuantityEditor();
  const card = modalCard('修改实盘数量')!;
  await act(async () => { card.findByType(TextInput).props.onChangeText('7'); });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => { await card.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(records()[0].records[0].actualQuantity).toBe(10);
  expect(modalCard('修改实盘数量')).toBe(card);
  expect(feedbackConfirm).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('原数量未修改'), 'error');
});

it('submits a complete label after the 500ms quiet window without Enter', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await act(async () => { root.root.findByType('ScanInput' as never).props.onChangeText('MODEL/10/FAST'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(499); });
  expect(records()).toEqual([]);
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(records()[0].records[0].traceCode).toBe('MODEL/10/FAST');
});

it('waits for a split label and keeps the complete native Enter text until its final change event', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  jest.mocked(shouldWaitForQRCodeContinuation).mockImplementation(text => text === 'MODEL/10');
  await act(async () => { root.root.findByType('ScanInput' as never).props.onChangeText('MODEL/10'); });
  await act(async () => { await jest.advanceTimersByTimeAsync(150); });
  expect(records()).toEqual([]);
  const full = 'MODEL/10/COMPLETE';
  await act(async () => { root.root.findByType('ScanInput' as never).props.onSubmitEditing({ nativeEvent: { text: full } }); });
  await act(async () => { await jest.advanceTimersByTimeAsync(10); root.root.findByType('ScanInput' as never).props.onChangeText(full); });
  // Once the true final change agrees with native Submit, no merge timer remains.
  expect(root.root.findByType('ScanInput' as never).props.value).toBe('');
  expect(records()[0].records).toHaveLength(1);
  expect(records()[0].records[0].traceCode).toBe(full);
  await act(async () => { root.root.findByType('ScanInput' as never).props.onSubmitEditing({ nativeEvent: { text: full } }); await jest.advanceTimersByTimeAsync(500); });
  expect(records()[0].records).toHaveLength(1);
  expect(feedbackSuccess).toHaveBeenCalledTimes(1);
});

it('a late Enter from the previous scan does not submit or cancel the next scan', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan('OLD/10/TRACE');
  await act(async () => { await jest.advanceTimersByTimeAsync(1); root.root.findByType('ScanInput' as never).props.onChangeText('NEW/10/TRACE'); });
  await act(async () => { root.root.findByType('ScanInput' as never).props.onSubmitEditing({ nativeEvent: { text: 'OLD/10/TRACE' } }); });
  expect(records()[0].records).toHaveLength(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  expect(records()[0].records).toHaveLength(2);
  expect(records()[0].records.map((item: { traceCode: string }) => item.traceCode)).toEqual(['NEW/10/TRACE', 'OLD/10/TRACE']);
});

it('a completion check from an old visit cannot save a scan after re-entry', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  const oldRules = deferred<Awaited<ReturnType<typeof getActiveRules>>>();
  jest.mocked(getActiveRules).mockReturnValueOnce(oldRules.promise);
  await act(async () => { root.root.findByType('ScanInput' as never).props.onChangeText('OLD/10/TRACE'); await jest.advanceTimersByTimeAsync(500); });
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = mockFocusCallback(); oldRules.resolve([]); });
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
  expect(records()).toEqual([]);
  expect(feedbackSuccess).not.toHaveBeenCalled();
});

it('ignores the old label Enter while receiving the next label with the same model prefix', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan('MODEL/10/OLD');
  await act(async () => { await jest.advanceTimersByTimeAsync(1); root.root.findByType('ScanInput' as never).props.onChangeText('MODEL/10/'); });
  await act(async () => { root.root.findByType('ScanInput' as never).props.onSubmitEditing({ nativeEvent: { text: 'MODEL/10/OLD' } }); await jest.advanceTimersByTimeAsync(10); });
  expect(root.root.findByType('ScanInput' as never).props.value).toBe('MODEL/10/');
  await act(async () => { root.root.findByType('ScanInput' as never).props.onChangeText('MODEL/10/NEW'); await jest.advanceTimersByTimeAsync(500); });
  expect(records()[0].records.map((item: { traceCode: string }) => item.traceCode)).toEqual(['MODEL/10/NEW', 'MODEL/10/OLD']);
});


it('blocks header, hardware and native exit during scan parsing and releases after persistence', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  const lookup = deferred<{ id: string; name: string }>();
  const { detectRule } = jest.requireMock('@/utils/database');
  detectRule.mockReturnValueOnce(lookup.promise);
  await scan('MODEL/10/NAVIGATION');
  expect(records()).toEqual([]);
  expect(mockPreventRemove).toBe(true);
  await act(async () => {
    expect(mockHardwareBack()).toBe(true);
    root.root.findByType('Header' as never).props.onBack();
    mockBlockedRouteRemove();
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith('正在处理扫码，请稍候再返回', 'warning');
  await act(async () => { lookup.resolve({ id: 'R', name: 'rule' }); });
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(records()).toHaveLength(1);
  expect(mockPreventRemove).toBe(false);
  expect(mockHardwareBack()).toBe(false);
  await act(async () => { root.root.findByType('Header' as never).props.onBack(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
