import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { CommonActions, TabRouter } from 'expo-router/build/react-navigation/routers';
import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { WarehouseBottomNavigation, type WarehouseBottomNavigationProps } from '../WarehouseBottomNavigation';

jest.mock('@/hooks/useTheme', () => ({ useTheme: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));

describe('main tab navigation', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.mocked(useTheme).mockReturnValue({ theme: Colors.light, isDark: false, colorScheme: 'light' });
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer!.unmount(); });
    renderer = undefined;
  });

  const createNavigator = async () => {
    const router = TabRouter({ initialRouteName: 'index', backBehavior: 'history' });
    const config = {
      routeNames: ['index', 'document-management', 'label-reprint', 'settings'],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(config);
    const emit = jest.fn(() => ({ defaultPrevented: false }));
    const applyAction = (action: Parameters<typeof router.getStateForAction>[1]) => {
      const next = router.getStateForAction(state, action, config);
      if (!next || next.stale) throw new Error('The main tab router did not handle the action');
      state = next;
    };
    const navigate = jest.fn((name: string, params?: object) => applyAction(CommonActions.navigate(name, params)));
    const navigation = { emit, navigate } as unknown as WarehouseBottomNavigationProps['navigation'];
    const renderBar = () => (
      <WarehouseBottomNavigation state={state} navigation={navigation} descriptors={{}}
        insets={{ top: 0, bottom: 24, left: 0, right: 0 }} />
    );
    await act(async () => { renderer = TestRenderer.create(renderBar()); });
    const buttons = () => renderer!.root.findAllByType(TouchableOpacity);
    const press = async (label: string) => {
      const button = buttons().find((item) => item.props.accessibilityLabel === label);
      if (!button) throw new Error(`Missing main navigation item: ${label}`);
      await act(async () => {
        button.props.onPress();
        renderer!.update(renderBar());
      });
    };
    return { buttons, press, emit, navigate, state: () => state, applyAction, renderBar };
  };

  it('switches repeatedly between the same four pages and returns through visited tabs on back', async () => {
    const nav = await createNavigator();
    const originalKeys = nav.state().routes.map((route) => route.key);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const [label, name] of [
        ['单据', 'document-management'], ['标签补打', 'label-reprint'],
        ['设置', 'settings'], ['工作台', 'index'],
      ]) {
        await nav.press(label);
        expect(nav.state().routes[nav.state().index].name).toBe(name);
        expect(nav.state().routes.map((route) => route.key)).toEqual(originalKeys);
        expect(nav.buttons().filter((button) => button.props.accessibilityState.selected)
          .map((button) => button.props.accessibilityLabel)).toEqual([label]);
      }
    }
    await nav.press('单据');
    await nav.press('标签补打');
    await nav.press('设置');
    await act(async () => {
      nav.applyAction(CommonActions.goBack());
      renderer!.update(nav.renderBar());
    });
    expect(nav.state().routes[nav.state().index].name).toBe('label-reprint');
    await act(async () => {
      nav.applyAction(CommonActions.goBack());
      renderer!.update(nav.renderBar());
    });
    expect(nav.state().routes[nav.state().index].name).toBe('document-management');
    await act(async () => {
      nav.applyAction(CommonActions.goBack());
      renderer!.update(nav.renderBar());
    });
    expect(nav.state().routes[nav.state().index].name).toBe('index');
  });

  it('does not navigate again when the selected page is tapped repeatedly', async () => {
    const nav = await createNavigator();
    await nav.press('工作台');
    await nav.press('工作台');
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(nav.emit).toHaveBeenCalledWith({
      type: 'tabPress', target: nav.state().routes[0].key, canPreventDefault: true,
    });
    await nav.press('单据');
    await nav.press('单据');
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('document-management', undefined);
  });

  it('respects a prevented tab press instead of bypassing the navigator guard', async () => {
    const nav = await createNavigator();
    nav.emit.mockReturnValueOnce({ defaultPrevented: true });
    await nav.press('标签补打');
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(nav.state().routes[nav.state().index].name).toBe('index');
  });
});
