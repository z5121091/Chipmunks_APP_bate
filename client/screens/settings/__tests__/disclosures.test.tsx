import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import SettingsScreen from '../index';
import { UiListItem } from '@/components/UiRedesign';
import { MotionCollapse } from '@/components/AppMotion';

// Keep the actual settings groups and shared disclosure/button components.
// Native storage, network checks and navigation are outside this regression.
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
const mockPush = jest.fn();
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'FormScrollView' }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => ({ showError: jest.fn(), AlertComponent: null }) }));
jest.mock('@/utils/toast', () => ({ useToast: () => ({ ToastContainer: () => null }) }));
jest.mock('@/utils/feedback', () => ({ initSoundSetting: jest.fn(), setSoundEnabled: jest.fn() }));
jest.mock('@/utils/database', () => ({ STORAGE_KEYS: {} }));
jest.mock('@/utils/workDraftIsolation', () => ({}));
jest.mock('@/utils/nasBackup', () => ({}));
jest.mock('@/utils/backupDiagnostic', () => ({}));
jest.mock('@/utils/heartbeat', () => ({}));
jest.mock('@/utils/backendApi', () => ({ buildErpProxyPath: (value: string) => value }));
jest.mock('@/utils/erpAccounts', () => ({
  ERP_ACCOUNTS: [{ key: 'shanghai-chipmunk', name: '测试账套' }],
  isErpAccountAvailable: () => false,
}));
jest.mock('@/utils/syncConnection', () => {
  const snapshot = { status: 'idle', config: null };
  return { getSyncConnectionSnapshot: () => snapshot, subscribeSyncConnection: () => () => undefined };
});
jest.mock('expo-updates', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-intent-launcher', () => ({}));

let root: TestRenderer.ReactTestRenderer | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers();
  mockPush.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.useRealTimers();
});

const item = (title: string) => root!.root.findAllByType(UiListItem).find(node => node.props.title === title)!;
const press = (title: string) => item(title).findByType(TouchableOpacity).props.onPress();
const textVisible = (text: string) => root!.root.findAllByType(Text).some(node => node.props.children === text);

it('opens every settings group immediately, including after repeated cross-group and batched presses', async () => {
  await act(async () => { root = TestRenderer.create(<SettingsScreen />); });
  const titles = ['作业与物料', 'ERP对接', '扫码规则', '备份与恢复', '关于掌上仓库'];
  for (let round = 0; round < 5; round++) {
    for (const title of titles) {
      await act(async () => { press(title); });
      expect(item(title).props.expanded).toBe(true);
      const disclosures = root!.root.findAllByType(MotionCollapse).filter(node => node.props.open);
      expect(disclosures).toHaveLength(1);
      expect(disclosures[0].findAllByType(Text).length).toBeGreaterThan(0);
      await act(async () => { press(title); });
      expect(root!.root.findAllByType(MotionCollapse).every(node => !node.props.open)).toBe(true);
    }
  }
  // Do not advance timers or complete animations between presses.
  await act(async () => { for (let i = 0; i < 21; i++) press('扫码规则'); });
  expect(textVisible('解析规则')).toBe(true);
  await act(async () => { press('作业与物料'); });
  expect(textVisible('解析规则')).toBe(false);
  expect(textVisible('物料绑定')).toBe(true);
  await act(async () => { press('物料绑定'); });
  expect(mockPush).toHaveBeenCalledWith('/inventory-binding');
});
