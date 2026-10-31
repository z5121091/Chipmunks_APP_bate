import type { ReactNode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  BaseNavigationContainer,
  createNavigationContainerRef,
  createNavigatorFactory,
  DefaultTheme,
  StackActions,
  StackRouter,
  TabRouter,
  useNavigationBuilder,
} from 'expo-router/react-navigation';
import { WarehouseBottomNavigation } from '@/components/WarehouseBottomNavigation';
import { useSafeRouter, useSafeSearchParams } from '../useSafeRouter';

// The JS navigation container and routers are real. Only Expo's file-route adapter is
// replaced so these local fixture screens do not need Metro, native screens or ERP.
jest.mock('expo-router', () => {
  const navigation = jest.requireActual('expo-router/react-navigation') as typeof import('expo-router/react-navigation');
  return {
    useFocusEffect: navigation.useFocusEffect,
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
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

type NavigatorProps = { children: ReactNode; initialRouteName?: string };
function LocalStackNavigator({ children, initialRouteName }: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, { children, initialRouteName });
  return <NavigationContent>{state.routes.map(route => <View key={route.key}>{descriptors[route.key].render()}</View>)}</NavigationContent>;
}
function LocalTabNavigator({ children }: NavigatorProps) {
  const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    children, initialRouteName: 'index', backBehavior: 'history',
  });
  return <NavigationContent>
    {state.routes.map(route => <View key={route.key}>{descriptors[route.key].render()}</View>)}
    <WarehouseBottomNavigation state={state} navigation={navigation} descriptors={{}}
      insets={{ top: 0, bottom: 0, left: 0, right: 0 }} />
  </NavigationContent>;
}
const Stack = createNavigatorFactory(LocalStackNavigator)();
const Tabs = createNavigatorFactory(LocalTabNavigator)();
const ref = createNavigationContainerRef();
let root: TestRenderer.ReactTestRenderer;

function EmptyScreen() { return <View />; }
function DocumentsScreen() {
  const router = useSafeRouter();
  return <TouchableOpacity accessibilityLabel="打开单据详情" onPress={() => router.push('/detail', { id: 17, name: '型号 % / +' })} />;
}
function DetailScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams();
  return <>
    <Text accessibilityLabel="详情参数">{JSON.stringify(params)}</Text>
    <TouchableOpacity accessibilityLabel="返回单据" onPress={() => router.back()} />
  </>;
}
function MainTabs() {
  return <Tabs.Navigator>
    <Tabs.Screen name="index" component={EmptyScreen} />
    <Tabs.Screen name="document-management" component={DocumentsScreen} />
    <Tabs.Screen name="label-reprint" component={EmptyScreen} />
    <Tabs.Screen name="settings" component={EmptyScreen} />
  </Tabs.Navigator>;
}
const focusedTab = () => {
  const main = ref.getRootState().routes.find(route => route.name === 'main')?.state;
  return main?.routes[main.index || 0]?.name;
};
const topStack = () => ref.getRootState().routes.at(-1)?.name;
const pressNow = (label: string) => {
  const button = root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === label);
  if (!button) throw new Error(`Missing navigation control: ${label}`);
  button.props.onPress();
};
const press = async (label: string) => { await act(async () => { pressNow(label); }); };

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await act(async () => {
    root = TestRenderer.create(<BaseNavigationContainer ref={ref} theme={DefaultTheme}>
      <Stack.Navigator initialRouteName="main">
        <Stack.Screen name="main" component={MainTabs} />
        <Stack.Screen name="detail" component={DetailScreen} />
      </Stack.Navigator>
    </BaseNavigationContainer>);
  });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

it('returns from a child stack to Documents, then follows the real tab visit history', async () => {
  expect(ref.isReady()).toBe(true);
  await press('单据');
  await press('打开单据详情');
  expect(topStack()).toBe('detail');
  await press('返回单据');
  expect(topStack()).toBe('main');
  expect(focusedTab()).toBe('document-management');
  await press('设置');
  expect(focusedTab()).toBe('settings');
  await act(async () => { ref.goBack(); });
  expect(topStack()).toBe('main');
  expect(focusedTab()).toBe('document-management');
  await act(async () => { ref.goBack(); });
  expect(focusedTab()).toBe('index');
});

it('uses actual blur and refocus events to permit another guarded push after returning', async () => {
  await press('单据');
  await act(async () => { pressNow('打开单据详情'); pressNow('打开单据详情'); });
  expect(ref.getRootState().routes.map(route => route.name)).toEqual(['main', 'detail']);
  await press('返回单据');
  expect(focusedTab()).toBe('document-management');
  await press('打开单据详情');
  expect(ref.getRootState().routes.map(route => route.name)).toEqual(['main', 'detail']);
  await act(async () => { ref.dispatch(StackActions.pop()); });
  await press('打开单据详情');
  expect(ref.getRootState().routes).toHaveLength(2);
});

it('delivers encoded parameters through the real child stack without changing the tab instance', async () => {
  await press('单据');
  const mainKey = ref.getRootState().routes[0].key;
  await press('打开单据详情');
  const params = root.root.findAllByType(Text).find(item => item.props.accessibilityLabel === '详情参数')!.props.children;
  expect(JSON.parse(params)).toEqual({ id: 17, name: '型号 % / +' });
  await press('返回单据');
  expect(ref.getRootState().routes[0].key).toBe(mainKey);
  expect(focusedTab()).toBe('document-management');
});
