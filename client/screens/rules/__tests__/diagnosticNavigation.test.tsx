import { useEffect, useState, type ReactNode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList, Modal, TextInput, TouchableOpacity, View } from 'react-native';
import {
  BaseNavigationContainer,
  createNavigationContainerRef,
  createNavigatorFactory,
  DefaultTheme,
  StackRouter,
  useNavigationBuilder,
} from 'expo-router/react-navigation';
import { AppModalActions } from '@/components/AppModalActions';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import * as database from '@/utils/database';
import RulesScreen from '../index';

// Keep the installed navigation container, focus events and usePreventRemove real.
// Only Expo's file-route adapter and unavailable OS/data services are replaced.
jest.mock('expo-router', () => {
  const navigation = jest.requireActual('expo-router/react-navigation') as typeof import('expo-router/react-navigation');
  return {
    useFocusEffect: navigation.useFocusEffect,
    useNavigation: navigation.useNavigation,
    useRouter: () => {
      const current = navigation.useNavigation();
      const nameOf = (pathname: string) => pathname.replace(/^\//, '');
      return {
        push: ({ pathname, params }: { pathname: string; params: object }) => current.dispatch(navigation.StackActions.push(nameOf(pathname), params)),
        replace: ({ pathname, params }: { pathname: string; params: object }) => current.dispatch(navigation.StackActions.replace(nameOf(pathname), params)),
        navigate: ({ pathname, params }: { pathname: string; params: object }) => current.dispatch(navigation.CommonActions.navigate(nameOf(pathname), params)),
        back: () => current.goBack(),
        canGoBack: () => current.canGoBack(),
        setParams: (params: object) => current.setParams(params),
      };
    },
    useLocalSearchParams: () => navigation.useRoute().params || {},
  };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/screens/inventory-binding/SupplierManager', () => ({ SupplierManager: 'SupplierPanel' }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Scroll' }));
jest.mock('../RuleSamplePanel', () => ({ RuleSamplePanel: 'Sample' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
const mockShowToast = jest.fn();
const mockShowError = jest.fn();
jest.mock('@/utils/toast', () => {
  const toast = { showToast: (...args: unknown[]) => mockShowToast(...args), ToastContainer: () => null };
  return { useToast: () => toast };
});
jest.mock('@/components/CustomAlert', () => {
  const alert = {
    showAlert: jest.fn(), showConfirm: jest.fn(), showError: (...args: unknown[]) => mockShowError(...args),
    showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null,
  };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({
  ...jest.requireActual('@/utils/database'),
  getAllRules: jest.fn(), addRule: jest.fn(), updateRule: jest.fn(), deleteRule: jest.fn(), setRulesDisplayOrder: jest.fn(),
}));

function LocalStackNavigator({ children }: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, { children, initialRouteName: 'home' });
  return <NavigationContent>{state.routes.map(route => <View key={route.key}>{descriptors[route.key].render()}</View>)}</NavigationContent>;
}
const Stack = createNavigatorFactory(LocalStackNavigator)();
const ref = createNavigationContainerRef();
const rule: database.QRCodeRule = {
  id: 'test-rule', name: '极海规则', description: '', separator: '/', fieldOrder: ['model', 'quantity'],
  isActive: true, created_at: '', updated_at: '',
};
let diagnosisMounts = 0;
let root: TestRenderer.ReactTestRenderer;
const backHandlers = new Set<() => boolean | null | undefined>();
const routes = () => ref.getRootState().routes.map(route => route.name);
const hardwareBack = () => Array.from(backHandlers).reverse().some(handler => handler());

function HomeFixture() {
  const router = useSafeRouter();
  return <TouchableOpacity accessibilityLabel="进入解析诊断" onPress={() => router.push('/rule-diagnostics')} />;
}
function DiagnosisFixture() {
  const router = useSafeRouter();
  const [sample, setSample] = useState('');
  useEffect(() => { diagnosisMounts += 1; }, []);
  return <>
    <TextInput accessibilityLabel="诊断保留样本" value={sample} onChangeText={setSample} />
    <TouchableOpacity accessibilityLabel="编辑诊断规则" onPress={() => router.push('/rules', {
      editRuleId: rule.id, returnTo: 'rule-diagnostics',
    })} />
  </>;
}
const pressNow = (label: string) => {
  const button = root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === label);
  if (!button) throw new Error(`Missing navigation control: ${label}`);
  button.props.onPress();
};
const press = async (label: string) => { await act(async () => { pressNow(label); }); };
const actions = () => root.root.findByType(AppModalActions);
const preservedSample = () => root.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === '诊断保留样本')!.props.value;
const openEditor = async () => {
  await press('进入解析诊断');
  await act(async () => {
    root.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === '诊断保留样本')!.props.onChangeText('APM32F103/960');
  });
  const diagnosisKey = ref.getRootState().routes[1].key;
  await press('编辑诊断规则');
  expect(routes()).toEqual(['home', 'rule-diagnostics', 'rules']);
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(root.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === '规则名称')!.props.value).toBe(rule.name);
  return diagnosisKey;
};
const expectOriginalDiagnosis = (key: string) => {
  expect(routes()).toEqual(['home', 'rule-diagnostics']);
  expect(ref.getRootState().routes[1].key).toBe(key);
  expect(diagnosisMounts).toBe(1);
  expect(preservedSample()).toBe('APM32F103/960');
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  diagnosisMounts = 0;
  backHandlers.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.add(handler);
    return { remove: () => backHandlers.delete(handler) };
  });
  jest.mocked(database.getAllRules).mockResolvedValue([rule]);
  jest.mocked(database.updateRule).mockResolvedValue();
  await act(async () => {
    root = TestRenderer.create(<BaseNavigationContainer ref={ref} theme={DefaultTheme}>
      <Stack.Navigator>
        <Stack.Screen name="home" component={HomeFixture} />
        <Stack.Screen name="rule-diagnostics" component={DiagnosisFixture} />
        <Stack.Screen name="rules" component={RulesScreen} />
      </Stack.Navigator>
    </BaseNavigationContainer>);
  });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
});

it('cancels the inline diagnosis editor once and keeps the original diagnosis instance and sample', async () => {
  const diagnosisKey = await openEditor();
  const cancel = actions().props.onSecondaryPress;
  await act(async () => { cancel(); cancel(); });
  expectOriginalDiagnosis(diagnosisKey);
  expect(database.updateRule).not.toHaveBeenCalled();
  await press('编辑诊断规则');
  expect(routes()).toEqual(['home', 'rule-diagnostics', 'rules']);
});

it('blocks external back during a slow save but lets successful completion resume the actual prevented pop', async () => {
  const diagnosisKey = await openEditor();
  let resolveSave!: () => void;
  jest.mocked(database.updateRule).mockImplementationOnce(() => new Promise<void>(resolve => { resolveSave = resolve; }));
  let save: Promise<void>;
  await act(async () => { save = actions().props.onPrimaryPress(); });
  expect(database.updateRule).toHaveBeenCalledTimes(1);
  expect(actions().props.primaryDisabled).toBe(true);
  await act(async () => { ref.goBack(); });
  expect(routes()).toEqual(['home', 'rule-diagnostics', 'rules']);
  expect(mockShowToast).toHaveBeenCalledWith('正在保存规则，请稍候', 'warning');
  await act(async () => { resolveSave(); await save!; });
  expectOriginalDiagnosis(diagnosisKey);
  expect(mockShowError).not.toHaveBeenCalled();
});

it('retains the editor after a failed save and permits cancellation after unlocking', async () => {
  const diagnosisKey = await openEditor();
  jest.mocked(database.updateRule).mockRejectedValueOnce(new Error('磁盘写入失败'));
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(routes()).toEqual(['home', 'rule-diagnostics', 'rules']);
  expect(actions().props.primaryDisabled).toBe(false);
  expect(mockShowError).toHaveBeenCalledWith('磁盘写入失败');
  await act(async () => { actions().props.onSecondaryPress(); });
  expectOriginalDiagnosis(diagnosisKey);
});

it('consumes hardware back in a nested editor section before returning to the original diagnosis', async () => {
  const diagnosisKey = await openEditor();
  await press('识别条件');
  expect(root.root.findAllByType(TextInput).some(item => item.props.accessibilityLabel === '规则名称')).toBe(false);
  await act(async () => { expect(hardwareBack()).toBe(true); });
  expect(routes()).toEqual(['home', 'rule-diagnostics', 'rules']);
  expect(root.root.findAllByType(TextInput).some(item => item.props.accessibilityLabel === '规则名称')).toBe(true);
  await act(async () => { expect(hardwareBack()).toBe(true); });
  expectOriginalDiagnosis(diagnosisKey);
  expect(backHandlers.size).toBe(0);
});
