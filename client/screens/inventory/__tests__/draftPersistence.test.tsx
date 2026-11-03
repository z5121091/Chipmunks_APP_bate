import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import InventoryScreen from '../index';
import { feedbackSuccess, feedbackConfirm } from '@/utils/feedback';
import { addInventoryCheckRecordsBatch, generateCheckNo, getActiveRules, getInventoryCodeByModel, updateInventoryCheckDocumentSyncStatus } from '@/utils/database';
import { shouldWaitForQRCodeContinuation } from '@/utils/qrcodeParser';
import { reconcileInventoryRecords } from '@/utils/inventoryReconciliation';
import { syncExcelToComputer } from '@/utils/excel';
import { STORAGE_KEYS } from '@/constants/config';

const mockToast = jest.fn();
const mockAlert = { visible: false, showConfirm: jest.fn() };
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
jest.mock('@/hooks/useTheme', () => { const theme = {}; return { useTheme: () => ({ theme, isDark: false }) }; });
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'ScanInput' }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: 'ModalCard' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'ModalActions' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'FormField' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'KeyboardForm' }));
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
  feedbackSuccess: jest.fn(), feedbackError: jest.fn(), feedbackWarning: jest.fn(), feedbackClear: jest.fn(),
  feedbackClearFailed: jest.fn(), feedbackDuplicate: jest.fn(), feedbackConfirm: jest.fn(), feedbackInventoryComplete: jest.fn(),
  feedbackNotBound: jest.fn(), feedbackDeleted: jest.fn(), useFeedbackCleanup: jest.fn(),
}));
jest.mock('@/utils/database', () => ({
  getActiveRules: jest.fn(async () => [{}]), detectRule: jest.fn(async () => ({ id: 'R', name: '规则' })),
  parseWithRule: (code: string) => ({ standardFields: { model: 'MODEL', quantity: '10', traceNo: code }, customFields: {} }),
  getInventoryCodeByModel: jest.fn(async () => 'INV'), generateId: () => 'record-1',
  addInventoryCheckRecordsBatch: jest.fn(), generateCheckNo: jest.fn(), updateInventoryCheckDocumentSyncStatus: jest.fn(),
}));

const DRAFT_KEY = 'inventory_check_records_by_erp_account_v1';
const SCOPE = 'shanghai-chipmunk::erp-account:shanghai-chipmunk';
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

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.clearAllMocks();
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
    root.root.findAllByType('ModalCard' as never).find(card => card.props.title === '完成盘点')!.props.footer.props.onPrimaryPress();
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
  expect(root.root.findAllByType('ModalCard' as never).some(card => card.props.title === '完成盘点')).toBe(false);
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

it('canceling completion leaves draft intact and allows normal back without ERP work', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await openSaveConfirmation();
  await act(async () => {
    root.root.findAllByType('ModalCard' as never).find(card => card.props.title === '完成盘点')!.props.footer.props.onSecondaryPress();
  });
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

it('keeps the original actual quantity and editor open if saving a quantity adjustment fails', async () => {
  await act(async () => { root = TestRenderer.create(<InventoryScreen />); });
  await scan();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  const list = root.root.findByType(FlatList);
  const group = list.props.data[0];
  let row!: TestRenderer.ReactTestRenderer;
  await act(async () => { row = TestRenderer.create(list.props.renderItem({ item: group })); });
  const renderer = row.root.findByType('Record' as never).props.renderDetail;
  let detail!: TestRenderer.ReactTestRenderer;
  await act(async () => { detail = TestRenderer.create(renderer(group.records[0])); });
  await act(async () => { detail.root.findByType(TouchableOpacity).props.onPress(); });
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('7'); });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => { await root.root.findByType('ModalCard' as never).props.footer.props.onPrimaryPress(); });
  expect(records()[0].records[0].actualQuantity).toBe(10);
  expect(root.root.findByType('ModalCard' as never).props.title).toBe('修改实盘数量');
  expect(feedbackConfirm).not.toHaveBeenCalled();
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('原数量未修改'), 'error');
  await act(async () => { detail.unmount(); row.unmount(); });
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
  await act(async () => { await jest.advanceTimersByTimeAsync(500); });
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
