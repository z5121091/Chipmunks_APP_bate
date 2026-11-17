import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { getAllWarehouses, getRuleById, updateRule } from '@/utils/database';
import { loadOutboundWarehouseOrderRules } from '@/utils/outboundOrderRule';
import OutboundOrderRulesScreen from '../index';
import RulePrefixEditScreen from '../../rule-prefix-edit';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn() }), useSafeSearchParams: () => ({ ruleId: 'RULE' }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('@/components/AppModal', () => ({ AppModal: require('react-native').Modal }));
jest.mock('@/components/AppMotion', () => ({ MotionContent: require('react-native').View }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/utils/feedback', () => ({ feedbackClear: jest.fn(), feedbackClearFailed: jest.fn() }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), showAlert: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ getAllWarehouses: jest.fn(), getRuleById: jest.fn(), updateRule: jest.fn(), FIELD_LABELS: { model: '型号' } }));
jest.mock('@/utils/outboundOrderRule', () => ({
  ...jest.requireActual('@/utils/outboundOrderRule'), loadOutboundWarehouseOrderRules: jest.fn(),
  saveOutboundWarehouseOrderRule: jest.fn(), clearOutboundWarehouseOrderRule: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));

let root: TestRenderer.ReactTestRenderer | undefined;
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  const viewport = { width: 320, height: 480, scale: 1, fontScale: 1.3 };
  Dimensions.set({ window: viewport, screen: viewport });
  jest.mocked(getAllWarehouses).mockResolvedValue([{ id: 'W1', name: '上海仓库', is_default: true }]);
  jest.mocked(loadOutboundWarehouseOrderRules).mockResolvedValue({});
  jest.mocked(getRuleById).mockResolvedValue({ id: 'RULE', name: '示例规则', description: '', separator: ',', fieldOrder: ['model'], fieldPrefixes: {}, isActive: true, created_at: '', updated_at: '' });
  jest.mocked(updateRule).mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});
function expectOneScrollOwner() {
  const editor = root!.root.findAllByType(Screen).find(screen => screen.props.disableAutoScroll === true)!;
  const form = editor.findByType(ScrollView);
  expect(StyleSheet.flatten(form.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  let ancestor = form.parent;
  while (ancestor) {
    expect(ancestor.type).not.toBe(ScrollView);
    ancestor = ancestor.parent;
  }
  expect(root!.root.findAllByType(Screen).some(screen => screen.props.disableAutoScroll === true)).toBe(true);
}
it('lets the outbound sample editor own its scroll without altering the native-list branch', async () => {
  await act(async () => { root = TestRenderer.create(<OutboundOrderRulesScreen />); });
  expect(root!.root.findByType(Screen).props.disableAutoScroll).toBeUndefined();
  expect(root!.root.findAllByType(FlatList)).toHaveLength(1);
  const open = root!.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === '编辑 上海仓库 的出库单号规则')!;
  await act(async () => { open.props.onPress(); });
  expectOneScrollOwner();
  await act(async () => { root!.root.findByType(TextInput).props.onChangeText('IO-2026-11-14-01'); });
  expect(root!.root.findByType(TextInput).props.value).toBe('IO-2026-11-14-01');
  expect(root!.root.findByType(AppModalActions).props.primaryLabel).toBe('保存样例');
});
it('lets the field-prefix editor own its scroll inside the full-screen modal and preserves save', async () => {
  await act(async () => { root = TestRenderer.create(<RulePrefixEditScreen />); });
  const list = root!.root.findByType(FlatList);
  const row = list.props.renderItem({ item: list.props.data[0], index: 0, separators: {} });
  await act(async () => { row.props.onPress(); });
  expect(root!.root.findAllByType(Modal)).toHaveLength(1);
  expectOneScrollOwner();
  const input = root!.root.findByType(TextInput);
  await act(async () => { input.props.onChangeText('P/N:'); });
  await act(async () => { await root!.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(updateRule).toHaveBeenCalledWith('RULE', { fieldPrefixes: { model: 'P/N:' } });
});
