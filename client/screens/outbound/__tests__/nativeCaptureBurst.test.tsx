import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, FlatList, TextInput } from 'react-native';
import PDAScanScreen from '../index';
import * as database from '@/utils/database';
import { fetchSaleDispatchVoucher, mapSaleDispatchVoucher } from '@/utils/erpSaleDispatch';
import { getErpAccountByOutboundOrderNo } from '@/utils/erpAccounts';
import { feedbackError, feedbackNotBound, feedbackSuccess } from '@/utils/feedback';
import { GEEHY_SCAN_SAMPLES } from '@/utils/testFixtures/geehyScans';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockNativeNavigation = { dispatch: jest.fn() };
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  TextInput: { value: 'Input' },
  Platform: { value: { ...jest.requireActual('react-native').Platform, OS: 'android' } },
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn(), useIsFocused: () => true }));
jest.mock('expo-router', () => ({
  useNavigation: () => mockNativeNavigation,
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }),
}));
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AggregatedRecordItem', () => ({ AggregatedRecordItem: 'Record' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'Field' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: 'Card' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Form' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiWorkflowSummary: 'Summary', UiToolbarButton: 'ToolbarButton' }));
// WarehouseScanInput intentionally stays real: all events below enter its native TextInput handlers.
jest.mock('@/components/CustomAlert', () => {
  const alert = { showAlert: jest.fn(), showConfirm: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/ruleConflictDiagnosis', () => ({ buildRuleConflictDiagnostic: jest.fn(), formatRuleConflictDiagnostic: jest.fn() }));
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
  getRecoveryMaterialId: (item: { id: string }) => item.id,
  scanQueue: {
    setBatchWriteFunction: jest.fn(), startTimer: jest.fn(), stopTimer: jest.fn(),
    subscribe: jest.fn(() => jest.fn()), getStats: jest.fn(),
    restoreForReview: jest.fn(async () => []), acknowledgeRecovered: jest.fn(), markReviewFailed: jest.fn(), discardReviewed: jest.fn(),
  },
}));
jest.mock('@/utils/unpackPrintTasks', () => ({
  loadUnpackPrintTasks: jest.fn(async () => []), submitUnpackPrintTask: jest.fn(), isUnpackPrintTaskInFlight: jest.fn(() => false),
}));
jest.mock('@/utils/unpackWorkflow', () => ({
  buildNextUnpackTraceNo: jest.fn(async () => ''), syncUnpackRecordsToComputer: jest.fn(), getUnpackSyncFailureMessage: jest.fn(),
}));
jest.mock('@/utils/erpSaleDispatch', () => ({ ...jest.requireActual('@/utils/erpSaleDispatch'), fetchSaleDispatchVoucher: jest.fn() }));
jest.mock('@/utils/database', () => {
  const actual = jest.requireActual('@/utils/database');
  return {
    initDatabase: jest.fn(), upsertOrder: jest.fn(), getOrder: jest.fn(),
    getAllWarehouses: jest.fn(), getDefaultWarehouse: jest.fn(), getMaterialsByOrder: jest.fn(),
    findOutboundOrderWarehouseConflict: jest.fn(),
    getInventoryCodeByModel: jest.fn(), getInventoryBindingMatchByModel: jest.fn(),
    getInventorySupplierById: jest.fn(), getInventoryBindingByCode: jest.fn(),
    checkMaterialExists: jest.fn(), addMaterialWithOrder: jest.fn(), getMaterialById: jest.fn(),
    getSalesReturnsByOrder: jest.fn(), getSalesReturnById: jest.fn(), saveSalesReturnWithOrder: jest.fn(), deleteSalesReturn: jest.fn(),
    getActiveRules: jest.fn(), detectRule: jest.fn(actual.detectRule), parseWithRule: actual.parseWithRule,
    inspectQRCodeRule: actual.inspectQRCodeRule, QRCodeRuleConflictError: actual.QRCodeRuleConflictError,
    generateId: jest.fn(() => 'fixture-id'), saveUnpackOperation: jest.fn(), deleteMaterial: jest.fn(),
  };
});

const orderNo = 'IO-2026-11-03-001';
const warehouse = { id: 'W1', name: '无锡仓库', is_default: true, created_at: '' };
const rule: database.QRCodeRule = {
  id: 'geehy-native', name: '极海', description: '', separator: '/',
  fieldOrder: ['model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo'],
  isActive: true, created_at: '', updated_at: '',
};
let root: TestRenderer.ReactTestRenderer;
let eventCount: number;
let originalAppState: typeof AppState.currentState;
const clear = jest.fn();
const input = () => root.root.findByType(TextInput);
const change = (text: string) => {
  input().props.onChange({ nativeEvent: { text, eventCount: ++eventCount } });
  input().props.onChangeText(text);
};
const submit = (text: string) => input().props.onSubmitEditing({ nativeEvent: { text }, persist: jest.fn() });
const tick = async (ms = 0) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  eventCount = 0;
  originalAppState = AppState.currentState;
  AppState.currentState = 'active';
  await AsyncStorage.clear();
  jest.mocked(database.initDatabase).mockResolvedValue(undefined);
  jest.mocked(database.getAllWarehouses).mockResolvedValue([warehouse]);
  jest.mocked(database.getDefaultWarehouse).mockResolvedValue(warehouse);
  jest.mocked(database.getMaterialsByOrder).mockResolvedValue([]);
  jest.mocked(database.findOutboundOrderWarehouseConflict).mockResolvedValue(null);
  jest.mocked(database.getSalesReturnsByOrder).mockResolvedValue([]);
  jest.mocked(database.getOrder).mockResolvedValue(null);
  jest.mocked(database.getMaterialById).mockResolvedValue(null);
  jest.mocked(database.getActiveRules).mockResolvedValue([rule]);
  jest.mocked(database.getInventoryBindingMatchByModel).mockImplementation(async (model, version) => ({
    inventoryCode: model === 'APM32F103RBT6' && version === '801204300041' ? 'ERP-A' : null,
    matchKind: 'exact',
  }));
  jest.mocked(database.checkMaterialExists).mockResolvedValue({ material: null, isUnpacked: false, canRescan: false });
  jest.mocked(database.addMaterialWithOrder).mockImplementation(async material => material.id!);
  const account = getErpAccountByOutboundOrderNo(orderNo)!;
  jest.mocked(fetchSaleDispatchVoucher).mockResolvedValue(mapSaleDispatchVoucher(account, {
    Code: orderNo, Partner: { Name: '测试客户' }, Warehouse: { Name: account.expectedWarehouseName },
    RDRecordDetails: [{ Inventory: { Code: 'ERP-A', Specification: 'APM32F103RBT6' }, Quantity: 30_000 }],
  }));
  await act(async () => {
    root = TestRenderer.create(<PDAScanScreen />, {
      createNodeMock: node => node.type === TextInput ? { clear, focus: jest.fn(), blur: jest.fn(), isFocused: () => true } : null,
    });
  });
  await tick();
  await act(async () => { change(orderNo); submit(orderNo); });
  await tick();
  expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  AppState.currentState = originalAppState;
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each(['submit-first', 'partial-then-submit', 'normal-enter'] as const)(
  'preserves 30 unique Geehy packages through the real scanner input with %s ordering', async ordering => {
    for (const [index, sample] of GEEHY_SCAN_SAMPLES.entries()) {
      if (ordering === 'submit-first') {
        await act(async () => { submit(sample.raw); });
        await tick(5);
        expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(index);
        await act(async () => { change(sample.raw); });
      } else if (ordering === 'partial-then-submit') {
        await act(async () => { change(sample.raw.slice(0, -7)); submit(sample.raw); });
        await tick(20);
        expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(index);
        await act(async () => { change(sample.raw); });
      } else {
        await act(async () => { change(sample.raw); submit(sample.raw); });
      }
      // The accepted frame must save without advancing the simulated clock.
      await tick(0);
      expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(index + 1);
      expect(input().props.value).toBe('');
      expect(feedbackSuccess).toHaveBeenCalledTimes(index + 1);
      // A duplicate native Enter after clear cannot create another save.
      await act(async () => { submit(sample.raw); });
      await tick(1);
      expect(database.addMaterialWithOrder).toHaveBeenCalledTimes(index + 1);
    }
    const saved = jest.mocked(database.addMaterialWithOrder).mock.calls.map(([material]) => material);
    expect(saved.map(material => material.traceNo)).toEqual(GEEHY_SCAN_SAMPLES.map(sample => sample.traceNo));
    expect(new Set(saved.map(material => material.id)).size).toBe(30);
    expect(saved.reduce((quantity, material) => quantity + material.quantity, 0)).toBe(28_800);
    expect(saved.every(material => material.model === 'APM32F103RBT6' && material.sourceNo === 'OPGD144429023' &&
      material.quantity === 960 && material.inventory_code === 'ERP-A' && material.order_no === orderNo && material.warehouse_id === 'W1')).toBe(true);
    const progress = root.root.findAllByType(FlatList).find(list => list.props.data?.[0]?.inventoryCode === 'ERP-A')?.props.data[0];
    expect(progress?.scannedQuantity).toBe(28_800);
    expect(progress?.scannedItems).toHaveLength(30);
    expect(fetchSaleDispatchVoucher).toHaveBeenCalledTimes(1);
    expect(feedbackError).not.toHaveBeenCalled();
    expect(feedbackNotBound).not.toHaveBeenCalled();
  }
);
