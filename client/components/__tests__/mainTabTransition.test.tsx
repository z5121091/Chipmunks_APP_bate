import { useState, type ReactNode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Tabs as ExpoTabs } from 'expo-router';
import {
  BaseNavigationContainer, createNavigationContainerRef, createNavigatorFactory,
  DefaultTheme, StackRouter, TabRouter, useNavigationBuilder,
} from 'expo-router/react-navigation';
import MainTabLayout from '@/app/(tabs)/_layout';
import { MainTabScene } from '@/components/MainTabScene';
import { Colors } from '@/constants/theme';
import { APP_MOTION } from '@/constants/motion';
import { useAppMotion } from '@/hooks/useAppMotion';

jest.mock('expo-router', () => ({ Tabs: Object.assign(
  (props: { children: React.ReactNode }) => jest.requireActual('react').createElement('TabsHost', props, props.children),
  { Screen: 'TabScreen' },
) }));
jest.mock('@/components/WarehouseBottomNavigation', () => ({ WarehouseBottomNavigation: 'TabBar' }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@/hooks/useAppMotion', () => ({ useAppMotion: jest.fn(() => false) }));

const names = ['index', 'document-management', 'label-reprint', 'settings'];
function TabNavigator({ children }: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    children, initialRouteName: 'index', backBehavior: 'history',
    screenLayout: ({ route, children: content }) => <MainTabScene routeKey={route.key}>{content}</MainTabScene>,
  });
  return <NavigationContent>{state.routes.map(route => <View key={route.key}>{descriptors[route.key].render()}</View>)}</NavigationContent>;
}
function StackNavigator({ children }: { children: ReactNode }) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, { children });
  return <NavigationContent>{state.routes.map(route => <View key={route.key}>{descriptors[route.key].render()}</View>)}</NavigationContent>;
}
const Tabs = createNavigatorFactory(TabNavigator)();
const Stack = createNavigatorFactory(StackNavigator)();
function Page() {
  const [count, setCount] = useState(0);
  return <Text onPress={() => setCount(count + 1)}>{count}</Text>;
}
function Main() {
  return <Tabs.Navigator>{names.map(name => <Tabs.Screen key={name} name={name} component={Page} />)}</Tabs.Navigator>;
}
let root: TestRenderer.ReactTestRenderer;
let ref: ReturnType<typeof createNavigationContainerRef>;
let running: { value: Animated.Value; stop: jest.Mock }[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useAppMotion).mockReturnValue(false);
  running = [];
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    expect(config.duration).toBe(APP_MOTION.content);
    expect(config.toValue).toBe(0);
    const stop = jest.fn();
    running.push({ value: value as Animated.Value, stop });
    return { start: jest.fn(), stop, reset: jest.fn() };
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  jest.restoreAllMocks();
});
async function mount() {
  ref = createNavigationContainerRef();
  await act(async () => {
    root = TestRenderer.create(<BaseNavigationContainer ref={ref} theme={DefaultTheme}>
      <Stack.Navigator><Stack.Screen name="main" component={Main} /><Stack.Screen name="detail" component={Page} /></Stack.Navigator>
    </BaseNavigationContainer>);
  });
}
const scenes = () => root.root.findAllByType(View).filter(node => node.props.testID === 'main-tab-scene');
const go = async (name: string) => { await act(async () => { ref.navigate(name as never); }); };

it('disables native whole-scene alpha transitions and detaches inactive screens', async () => {
  await act(async () => { root = TestRenderer.create(<MainTabLayout />); });
  const props = root.root.findByType(ExpoTabs).props;
  expect(props.screenOptions.animation).toBe('none');
  expect(props.screenOptions.transitionSpec).toBeUndefined();
  expect(props.screenOptions.sceneStyleInterpolator).toBeUndefined();
  expect(props.detachInactiveScreens).toBe(true);
  expect(props.screenLayout({ route: { key: 'test' }, children: <Text>page</Text> }).type).toBe(MainTabScene);
});

it('isolates every directed tab switch while only the plain cover fades; preserves page state', async () => {
  await mount();
  await act(async () => { scenes()[0].findByType(Text).props.onPress(); });
  // All 12 directed pairs, including the reported paths and immediate reversals.
  for (const from of names) {
    for (const to of names.filter(name => name !== from)) {
      await go(from);
      const previous = running.at(-1)!;
      await go(to);
      expect(previous.stop).toHaveBeenCalled();
      const current = running.at(-1)!;
      for (const alpha of [1, 0.5, 0]) {
        await act(async () => { current.value.setValue(alpha); });
        scenes().forEach((scene, index) => {
          const style = StyleSheet.flatten(scene.props.style);
          expect(style.display).toBe(names[index] === to ? 'flex' : 'none');
          expect(style.opacity).toBeUndefined();
          expect(style.backgroundColor).toBe(Colors.light.backgroundRoot);
          expect(scene.props.pointerEvents).toBe(names[index] === to ? 'auto' : 'none');
          const cover = scene.findAllByProps({ testID: 'main-tab-reveal-cover' })[0];
          expect(cover.props.pointerEvents).toBe('none');
          if (names[index] === to) expect(StyleSheet.flatten(cover.props.style).opacity).toBe(current.value);
        });
      }
    }
  }
  await go('index');
  expect(scenes()[0].findByType(Text).props.children).toBe(1);
});

it('does not blank or replay the underlying tab when a child stack opens and returns', async () => {
  await mount();
  await go('settings');
  const count = running.length;
  await go('detail');
  expect(StyleSheet.flatten(scenes()[3].props.style).display).toBe('flex');
  await act(async () => { ref.goBack(); });
  expect(StyleSheet.flatten(scenes()[3].props.style).display).toBe('flex');
  expect(running).toHaveLength(count);
});

it('omits the cover and animation when reduced motion is enabled', async () => {
  jest.mocked(useAppMotion).mockReturnValue(true);
  await mount();
  await go('settings');
  expect(running).toHaveLength(0);
  expect(root.root.findAllByProps({ testID: 'main-tab-reveal-cover' })).toHaveLength(0);
});
