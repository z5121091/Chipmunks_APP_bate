import { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Modal, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AppModal } from '@/components/AppModal';
import { AppModalCard } from '@/components/AppModalCard';
import { AppPressable } from '@/components/AppPressable';
import { CustomAlert } from '@/components/CustomAlert';
import { AppMotionProvider } from '@/hooks/useAppMotion';
import { useToast } from '@/utils/toast';
import { useOverlayActivity } from '@/hooks/useOverlayActivity';
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/utils/feedback', () => ({ feedbackCancel: jest.fn(), feedbackConfirm: jest.fn(), feedbackDeleted: jest.fn() }));

let root: TestRenderer.ReactTestRenderer | undefined;
let completions: ((value: { finished: boolean }) => void)[];
let durations: number[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  completions = []; durations = [];
  jest.spyOn(Animated, 'timing').mockImplementation((_value, config) => ({
    start: callback => { durations.push(config.duration || 0); if (callback) completions.push(callback); },
    stop: jest.fn(), reset: jest.fn(),
  }));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; jest.restoreAllMocks(); jest.useRealTimers();
});

it('does not schedule animation frames or mount a native modal for an initially hidden surface', async () => {
  await act(async () => { root = TestRenderer.create(<AppModal visible={false}><Text>hidden</Text></AppModal>); });
  expect(durations).toEqual([]);
  expect(root!.root.findAllByType(Modal)).toHaveLength(0);
});

it('keeps closing content after the selected record is cleared, disables it, then unmounts', async () => {
  await act(async () => { root = TestRenderer.create(<AppModal visible><Text>selected record</Text></AppModal>); });
  await act(async () => { root!.update(<AppModal visible={false}>{null}</AppModal>); });
  expect(root!.root.findByType(Text).props.children).toBe('selected record');
  expect(root!.root.findAllByProps({ pointerEvents: 'none', accessibilityElementsHidden: true }).length).toBeGreaterThan(0);
  await act(async () => { completions.at(-1)!({ finished: true }); });
  expect(root!.root.findAllByType(Modal)).toHaveLength(0);
});

it('ignores an obsolete exit completion after a rapid reopen', async () => {
  await act(async () => { root = TestRenderer.create(<AppModal visible><Text>A</Text></AppModal>); });
  await act(async () => { root!.update(<AppModal visible={false}>{null}</AppModal>); });
  const oldExit = completions.at(-1)!;
  await act(async () => { root!.update(<AppModal visible><Text>B</Text></AppModal>); });
  await act(async () => { oldExit({ finished: true }); });
  expect(root!.root.findByType(Modal).props.visible).toBe(true);
  expect(root!.root.findByType(Text).props.children).toBe('B');
});

it('does not replay whole-card entrance when its title changes', async () => {
  const surface = (title: string) => <AppModal visible><AppModalCard title={title}><Text>body</Text></AppModalCard></AppModal>;
  await act(async () => { root = TestRenderer.create(surface('选择供应商')); });
  const started = durations.length;
  await act(async () => { root!.update(surface('维护供应商')); });
  expect(durations).toHaveLength(started);
});

it('keeps scanner focus blocked until the final modal has completed dismissal', async () => {
  function Probe() { return <Text>{useOverlayActivity() ? 'blocked' : 'ready'}</Text>; }
  const surface = (visible: boolean) => <><Probe /><AppModal visible={visible}><Text>form</Text></AppModal></>;
  await act(async () => { root = TestRenderer.create(surface(true)); });
  expect(root!.root.findAllByType(Text)[0].props.children).toBe('blocked');
  await act(async () => { root!.update(surface(false)); });
  expect(root!.root.findAllByType(Text)[0].props.children).toBe('blocked');
  await act(async () => { completions.at(-1)!({ finished: true }); });
  expect(root!.root.findByType(Text).props.children).toBe('ready');
});

it('respects the system reduced-motion preference', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await act(async () => { root = TestRenderer.create(<AppMotionProvider><AppModal visible><Text>body</Text></AppModal></AppMotionProvider>); });
  expect(durations.at(-1)).toBe(0);
});

it('dispatches the button action immediately without waiting for press feedback', async () => {
  const action = jest.fn();
  await act(async () => { root = TestRenderer.create(<AppPressable onPress={action}><Text>scan</Text></AppPressable>); });
  const button = root!.root.findByType(TouchableOpacity);
  await act(async () => { button.props.onPressIn({}); button.props.onPress(); });
  expect(action).toHaveBeenCalledTimes(1);
});

it('uses no opacity or transform animation for document cards while retaining press and long press', async () => {
  const press = jest.fn();
  const longPress = jest.fn();
  await act(async () => {
    root = TestRenderer.create(<AnimatedCard disablePressAnimation onPress={press} onLongPress={longPress}>
      <Text>document</Text>
    </AnimatedCard>);
  });
  expect(root!.root.findByType(AppPressable).props.feedback).toBe('none');
  expect(root!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  // Native/Uniwind test wrappers need not retain the exported Pressable identity.
  const target = root!.root.findAll(node => node.props.onPress === press &&
    node.props.onLongPress === longPress && node.props.style?.width === '100%').at(-1)!;
  expect(target).toBeDefined();
  expect(target.props.accessibilityRole).toBeUndefined();
  expect(target.props.style).toEqual({ width: '100%' });
  await act(async () => {
    for (let i = 0; i < 30; i++) target.props.onPress();
    target.props.onLongPress();
  });
  expect(press).toHaveBeenCalledTimes(30);
  expect(longPress).toHaveBeenCalledTimes(1);
  expect(Animated.timing).not.toHaveBeenCalled();
});

it('keeps record press and long press without changing opacity or transform', async () => {
  const press = jest.fn();
  const longPress = jest.fn();
  const pressIn = jest.fn();
  const pressOut = jest.fn();
  await act(async () => {
    root = TestRenderer.create(<AppPressable feedback="none" onPress={press} onLongPress={longPress}
      onPressIn={pressIn} onPressOut={pressOut} accessibilityRole="button"
      accessibilityState={{ expanded: true }} style={{ minHeight: 44 }}>
      <Text style={{ color: '#123456', fontSize: 16 }} numberOfLines={1}>IO-2026-11-03-01</Text>
    </AppPressable>);
  });
  expect(root!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  const target = root!.root.findAll(node => node.props.onPress === press && node.props.onLongPress === longPress).at(-1)!;
  expect(target.props.android_ripple).toBeUndefined();
  expect(target.props.accessibilityState).toEqual({ expanded: true });
  expect(StyleSheet.flatten(target.props.style)).toEqual({ minHeight: 44 });
  const label = root!.root.findByType(Text);
  expect(label.props.numberOfLines).toBe(1);
  expect(StyleSheet.flatten(label.props.style)).toEqual({ color: '#123456', fontSize: 16 });
  await act(async () => {
    target.props.onPressIn({}); target.props.onPress(); target.props.onPressOut({});
    target.props.onLongPress();
  });
  expect(press).toHaveBeenCalledTimes(1);
  expect(longPress).toHaveBeenCalledTimes(1);
  expect(pressIn).toHaveBeenCalledTimes(1);
  expect(pressOut).toHaveBeenCalledTimes(1);
  expect(Animated.timing).not.toHaveBeenCalled();
});

it.each(['android', 'web', 'ios'] as const)('avoids Android native clickable decoration while preserving %s activation', async platform => {
  const originalPlatform = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
  const press = jest.fn();
  const longPress = jest.fn();
  try {
    await act(async () => {
      root = TestRenderer.create(<AnimatedCard disablePressAnimation onPress={press} onLongPress={longPress}>
        <Text>订单</Text>
      </AnimatedCard>);
    });
    const target = () => root!.root.findAll(node => node.props.onPress === press &&
      node.props.onLongPress === longPress && node.props.style?.width === '100%').at(-1)!;
    if (platform === 'android') {
      expect(target().props.focusable).toBe(false);
      expect(target().props.accessibilityActions).toEqual([{ name: 'activate' }, { name: 'longpress' }]);
      await act(async () => {
        target().props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
        target().props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
      });
      expect(press).toHaveBeenCalledTimes(1);
      expect(longPress).toHaveBeenCalledTimes(1);
      await act(async () => { root!.update(<AnimatedCard disablePressAnimation disabled onPress={press} onLongPress={longPress}><Text>订单</Text></AnimatedCard>); });
      target().props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
      expect(press).toHaveBeenCalledTimes(1);
    } else {
      expect(target().props.focusable).not.toBe(false);
      expect(target().props.onAccessibilityAction).toBeUndefined();
    }
    expect(Animated.timing).not.toHaveBeenCalled();
  } finally {
    await act(async () => root!.unmount()); root = undefined;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  }
});

it('preserves caller-defined roles without turning composite cards into nested buttons', async () => {
  const innerPress = jest.fn();
  await act(async () => { root = TestRenderer.create(<AppPressable onPress={jest.fn()}>
    <Text>document card</Text><AppPressable accessibilityRole="button" onPress={innerPress}><Text>sync</Text></AppPressable>
  </AppPressable>); });
  const controls = root!.root.findAllByType(TouchableOpacity);
  expect(controls[0].props.accessibilityRole).toBeUndefined();
  expect(controls[1].props.accessibilityRole).toBe('button');
  await act(async () => { controls[1].props.onPress(); });
  expect(innerPress).toHaveBeenCalledTimes(1);
});

it('closes an alert before dispatch and prevents two rapid confirmations', async () => {
  const order: string[] = [];
  const buttons = [{ text: '确认', onPress: () => order.push('confirm') }];
  await act(async () => { root = TestRenderer.create(<CustomAlert visible title="确认" buttons={buttons} onClose={() => order.push('close')} />); });
  const button = root!.root.findByType(TouchableOpacity);
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(order).toEqual(['close', 'confirm']);
});

it('retains persistent error feedback across parent rerenders and allows a subsequent result', async () => {
  jest.useFakeTimers();
  let show!: ReturnType<typeof useToast>['showToast'];
  let rerender!: () => void;
  function Harness() {
    const [, setCount] = useState(0);
    const { showToast, ToastContainer } = useToast({ persistentErrors: true }); show = showToast;
    rerender = () => setCount(value => value + 1);
    return <ToastContainer />;
  }
  await act(async () => { root = TestRenderer.create(<Harness />); });
  await act(async () => { show('完整的错误原因', 'error'); });
  await act(async () => { rerender(); jest.advanceTimersByTime(60_000); });
  expect(root!.root.findByType(Text).props.children).toBe('完整的错误原因');
  await act(async () => { show('下一张扫码成功', 'success'); });
  expect(root!.root.findByType(Text).props.children).toBe('下一张扫码成功');
});
