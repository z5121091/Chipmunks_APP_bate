import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import WarehouseManagementScreen from '../index';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalViewport } from '@/components/AppModalViewport';
import { AppModalActions } from '@/components/AppModalActions';
import { AnimatedButton } from '@/components/AnimatedButton';
import * as database from '@/utils/database';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('@/components/AppModal', () => ({ AppModal: require('react-native').Modal }));
jest.mock('@/components/AppMotion', () => ({ MotionSurface: 'ModalSurface' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AnimatedButton', () => ({ AnimatedButton: 'Button' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/syncConnection', () => ({ refreshSyncConnection: jest.fn() }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), showConfirm: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ getAllWarehouses: jest.fn(), addWarehouse: jest.fn(), updateWarehouse: jest.fn(), deleteWarehouse: jest.fn(), reorderWarehouses: jest.fn() }));

let root: TestRenderer.ReactTestRenderer | undefined;
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.getAllWarehouses).mockResolvedValue([]);
  jest.mocked(database.addWarehouse).mockResolvedValue('NEW');
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

it.each([
  { width: 320, height: 480, fontScale: 1.3 },
  { width: 768, height: 1024, fontScale: 1 },
])('sizes the warehouse form to its content and preserves fields/save when a short window needs scrolling at $width dp', async viewport => {
  const size = { ...viewport, scale: 1 };
  Dimensions.set({ window: size, screen: size });
  await act(async () => { root = TestRenderer.create(<WarehouseManagementScreen />); });
  await act(async () => { root!.root.findByType(AnimatedButton).props.onPress(); });
  const card = root!.root.findByType(AppModalCard);
  expect(card.props.size).toBe('auto');
  expect(card.props.stretchBody).toBeUndefined();
  expect(root!.root.findAllByType(AppModalViewport)).toHaveLength(1);
  const form = card.findByType(ScrollView);
  expect(form.props.testID).toBe('app-modal-card-scroll');
  let ancestor = form.parent;
  while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
  const name = () => root!.root.findAllByType(TextInput).find(node => node.props.placeholder === '请输入仓库名称')!;
  const description = () => root!.root.findAllByType(TextInput).find(node => node.props.placeholder === '可选，用于备注仓库信息')!;
  await act(async () => { name().props.onChangeText('苏州仓库'); });
  await act(async () => { description().props.onChangeText('长描述与业务字段保持原值'); });
  const beforeResize = name();
  const frame = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-viewport')!;
  await act(async () => { frame.props.onLayout({ nativeEvent: { layout: { height: 240 } } }); });
  expect(name()).toBe(beforeResize);
  expect(name().props.value).toBe('苏州仓库');
  const surface = root!.root.findByType('ModalSurface' as React.ElementType);
  expect(StyleSheet.flatten(surface.props.style).height).toBeUndefined();
  expect(StyleSheet.flatten(surface.props.style).maxHeight).toBe(240);
  const footer = card.props.footer as React.ReactElement<React.ComponentProps<typeof AppModalActions>>;
  expect(footer.props.primaryLabel).toBe('保存');
  await act(async () => { await footer.props.onPrimaryPress(); });
  expect(database.addWarehouse).toHaveBeenCalledWith({ name: '苏州仓库', description: '长描述与业务字段保持原值', is_default: false });
});
