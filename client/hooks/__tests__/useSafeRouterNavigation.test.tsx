import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { CommonActions, StackActions, StackRouter } from 'expo-router/build/react-navigation/routers';
import { useSafeRouter } from '../useSafeRouter';

let mockFocus: (() => void | (() => void)) | undefined;
const mockNative = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockNative,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(() => {
    mockFocus = callback;
    return callback();
  }, [callback]),
}));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));

function Harness({ params = {} }: { params?: Record<string, unknown> }) {
  const router = useSafeRouter();
  return <>
    <TouchableOpacity accessibilityLabel="订单" onPress={() => router.push('/orders', params)} />
    <TouchableOpacity accessibilityLabel="规则" onPress={() => router.push('/rules')} />
    <TouchableOpacity accessibilityLabel="替换" onPress={() => router.replace('/rules')} />
    <TouchableOpacity accessibilityLabel="当前页" onPress={() => router.navigate('/home')} />
  </>;
}

let root: TestRenderer.ReactTestRenderer;
const stack = StackRouter({ initialRouteName: 'home' });
const config = { routeNames: ['home', 'orders', 'rules'], routeParamList: {}, routeGetIdList: {} };
let state = stack.getInitialState(config);
const press = (label: string) => root.root.findAllByType(TouchableOpacity)
  .find(button => button.props.accessibilityLabel === label)!.props.onPress();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  state = stack.getInitialState(config);
  mockNative.push.mockImplementation(({ pathname, params }) => {
    const next = stack.getStateForAction(state, StackActions.push(pathname.slice(1), params), config);
    if (!next) throw new Error('Unhandled push');
    state = next;
  });
  mockNative.replace.mockImplementation(({ pathname, params }) => {
    const next = stack.getStateForAction(state, StackActions.replace(pathname.slice(1), params), config);
    if (!next) throw new Error('Unhandled replace');
    state = next;
  });
  await act(async () => { root = TestRenderer.create(<Harness />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

it('accepts the first tap immediately and ignores rapid repeated stack entry taps', async () => {
  await act(async () => { press('订单'); press('订单'); press('规则'); });
  expect(state.routes.map(route => route.name)).toEqual(['home', 'orders']);
  expect(mockNative.push).toHaveBeenCalledTimes(1);
});

it('does not unlock on rerender, but permits reopening after a real return and refocus', async () => {
  await act(async () => { press('订单'); root.update(<Harness />); });
  await act(async () => { press('订单'); });
  expect(mockNative.push).toHaveBeenCalledTimes(1);
  const previous = stack.getStateForAction(state, CommonActions.goBack(), config);
  if (!previous) throw new Error('Back should return home');
  state = previous;
  await act(async () => { mockFocus!(); press('订单'); });
  expect(mockNative.push).toHaveBeenCalledTimes(2);
  expect(state.routes.map(route => route.name)).toEqual(['home', 'orders']);
});

it('unlocks after a navigation exception so a retry is usable', async () => {
  mockNative.push.mockImplementationOnce(() => { throw new Error('route unavailable'); });
  await act(async () => { expect(() => press('订单')).toThrow('route unavailable'); });
  await act(async () => { press('订单'); });
  expect(state.routes.map(route => route.name)).toEqual(['home', 'orders']);
});

it('keeps a no-op navigate from disabling the next stack entry', async () => {
  await act(async () => { press('当前页'); press('订单'); });
  expect(mockNative.navigate).toHaveBeenCalledTimes(1);
  expect(mockNative.push).toHaveBeenCalledTimes(1);
});

it('guards repeated replacements as one transition', async () => {
  await act(async () => { press('替换'); press('替换'); });
  expect(mockNative.replace).toHaveBeenCalledTimes(1);
  expect(state.routes.map(route => route.name)).toEqual(['rules']);
});

it('preserves safely encoded route parameters during a guarded push', async () => {
  const params = { name: '测试 % & + /', selection: { id: 3 }, enabled: true };
  await act(async () => { root.update(<Harness params={params} />); });
  await act(async () => { press('订单'); });
  const payload = state.routes[1].params as { __safeRouterPayload__: string };
  expect(JSON.parse(Buffer.from(payload.__safeRouterPayload__, 'base64').toString('utf8'))).toEqual(params);
});
