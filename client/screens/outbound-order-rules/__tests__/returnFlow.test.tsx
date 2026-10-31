import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, Text, TextInput, TouchableOpacity } from 'react-native';
import OutboundOrderRulesScreen from '../index';
import { AppModalActions } from '@/components/AppModalActions';
import { useCustomAlert } from '@/components/CustomAlert';
import { getAllWarehouses, type Warehouse } from '@/utils/database';
import {
  clearOutboundWarehouseOrderRule,
  inferOutboundOrderRuleFromSample,
  loadOutboundWarehouseOrderRules,
  saveOutboundWarehouseOrderRule,
  type OutboundWarehouseSampleRuleMap,
} from '@/utils/outboundOrderRule';

const mockRouter = { back: jest.fn() };
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'KeyboardForm' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/utils/feedback', () => ({ feedbackClear: jest.fn(), feedbackClearFailed: jest.fn() }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ getAllWarehouses: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));
jest.mock('@/utils/outboundOrderRule', () => ({
  ...jest.requireActual('@/utils/outboundOrderRule'),
  loadOutboundWarehouseOrderRules: jest.fn(),
  saveOutboundWarehouseOrderRule: jest.fn(),
  clearOutboundWarehouseOrderRule: jest.fn(),
}));

const warehouses = [
  { id: 'warehouse-1', name: '上海仓库', is_default: 1 },
  { id: 'warehouse-2', name: '无锡仓库', is_default: 0 },
] as Warehouse[];
const sample = 'IO-2026-10-18-01';
const listeners = new Set<() => boolean | null | undefined>();
let root: TestRenderer.ReactTestRenderer | undefined;
const button = (label: string) => root!.root.findAllByType(TouchableOpacity)
  .find(item => item.props.accessibilityLabel === label)!;
const isEditing = () => root!.root.findAllByType(Text).some(item => item.props.children === '编辑订单号样例');
const actions = () => root!.root.findByType(AppModalActions);
const input = () => root!.root.findByType(TextInput);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
async function mount() {
  await act(async () => { root = TestRenderer.create(<OutboundOrderRulesScreen />); });
}
async function openEditor() {
  await act(async () => { button('编辑 上海仓库 的出库单号规则').props.onPress(); });
}
async function typeSample(value = sample) {
  await act(async () => { input().props.onChangeText(value); });
}
async function hardwareBack() {
  await act(async () => {
    // Android dispatches newest listeners first and the navigator handles an unconsumed back.
    const consumed = [...listeners].reverse().some(listener => listener() === true);
    if (!consumed) mockRouter.back();
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  listeners.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  jest.mocked(getAllWarehouses).mockResolvedValue(warehouses);
  jest.mocked(loadOutboundWarehouseOrderRules).mockResolvedValue({});
  jest.mocked(saveOutboundWarehouseOrderRule).mockResolvedValue({ 'warehouse-1': inferOutboundOrderRuleFromSample(sample) });
  jest.mocked(clearOutboundWarehouseOrderRule).mockResolvedValue({});
});
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = undefined; }
  jest.restoreAllMocks();
});

it('uses hardware back to cancel the editor first, then leaves the warehouse rule list', async () => {
  await mount();
  await openEditor();
  await typeSample();
  expect(isEditing()).toBe(true);
  await hardwareBack();
  expect(isEditing()).toBe(false);
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(saveOutboundWarehouseOrderRule).not.toHaveBeenCalled();
  await hardwareBack();
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('gives screen back the same editor-to-list-to-settings order', async () => {
  await mount();
  await openEditor();
  await typeSample();
  await act(async () => { button('返回仓库规则列表').props.onPress(); });
  expect(isEditing()).toBe(false);
  expect(mockRouter.back).not.toHaveBeenCalled();
  await act(async () => { button('返回设置').props.onPress(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('returns to the rule list after saving and reopens the saved sample', async () => {
  await mount();
  await openEditor();
  await typeSample();
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(saveOutboundWarehouseOrderRule).toHaveBeenCalledWith('warehouse-1', inferOutboundOrderRuleFromSample(sample));
  expect(isEditing()).toBe(false);
  expect(useCustomAlert().showSuccess).toHaveBeenCalledWith('已保存 上海仓库 的出库单号样例');
  await openEditor();
  expect(input().props.value).toBe(sample);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('consumes back and ignores duplicate save or clear while the save is pending', async () => {
  const pending = deferred<OutboundWarehouseSampleRuleMap>();
  jest.mocked(saveOutboundWarehouseOrderRule).mockReturnValueOnce(pending.promise);
  await mount();
  await openEditor();
  await typeSample();
  const save = actions().props.onPrimaryPress;
  const clear = actions().props.onSecondaryPress;
  await act(async () => { void save(); void save(); void clear(); });
  await hardwareBack();
  await act(async () => { button('返回仓库规则列表').props.onPress(); });
  expect(isEditing()).toBe(true);
  expect(input().props.value).toBe(sample);
  expect(input().props.editable).toBe(false);
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(saveOutboundWarehouseOrderRule).toHaveBeenCalledTimes(1);
  expect(clearOutboundWarehouseOrderRule).not.toHaveBeenCalled();
  await act(async () => { pending.resolve({ 'warehouse-1': inferOutboundOrderRuleFromSample(sample) }); });
  expect(isEditing()).toBe(false);
  await hardwareBack();
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('preserves the sample after a failed save and allows a normal one-level cancel', async () => {
  jest.mocked(saveOutboundWarehouseOrderRule).mockRejectedValueOnce(new Error('写入失败'));
  await mount();
  await openEditor();
  await typeSample();
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(isEditing()).toBe(true);
  expect(input().props.value).toBe(sample);
  expect(input().props.editable).toBe(true);
  expect(useCustomAlert().showWarning).toHaveBeenCalledWith('写入失败');
  await hardwareBack();
  expect(isEditing()).toBe(false);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('blocks hardware and screen back while clearing, then returns to the warehouse list', async () => {
  const pending = deferred<OutboundWarehouseSampleRuleMap>();
  jest.mocked(clearOutboundWarehouseOrderRule).mockReturnValueOnce(pending.promise);
  await mount();
  await openEditor();
  await typeSample();
  await act(async () => { void actions().props.onSecondaryPress(); });
  await hardwareBack();
  await act(async () => { button('返回仓库规则列表').props.onPress(); });
  expect(isEditing()).toBe(true);
  expect(mockRouter.back).not.toHaveBeenCalled();
  await act(async () => { pending.resolve({}); });
  expect(isEditing()).toBe(false);
  expect(clearOutboundWarehouseOrderRule).toHaveBeenCalledWith('warehouse-1');
});

it('keeps invalid or conflicting samples in the editor without committing', async () => {
  jest.mocked(loadOutboundWarehouseOrderRules).mockResolvedValueOnce({
    'warehouse-2': inferOutboundOrderRuleFromSample(sample),
  });
  await mount();
  await openEditor();
  await typeSample('not-valid');
  expect(actions().props.primaryDisabled).toBe(true);
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(isEditing()).toBe(true);
  expect(saveOutboundWarehouseOrderRule).not.toHaveBeenCalled();
  await typeSample();
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(useCustomAlert().showWarning).toHaveBeenCalledWith('该样例会同时匹配 无锡仓库，请调整后再保存');
  expect(input().props.value).toBe(sample);
  expect(saveOutboundWarehouseOrderRule).not.toHaveBeenCalled();
});

it('removes the focused hardware listener when this screen unmounts', async () => {
  await mount();
  expect(listeners.size).toBe(1);
  await openEditor();
  await act(async () => { root!.unmount(); root = undefined; });
  expect(listeners.size).toBe(0);
});
