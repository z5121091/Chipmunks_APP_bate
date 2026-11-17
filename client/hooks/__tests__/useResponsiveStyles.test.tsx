import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, type ScaledSize } from 'react-native';
import { Colors, type Theme } from '@/constants/theme';
import { createStyles as createOrderStyles } from '@/screens/orders/styles';
import { createStyles as createBindingStyles } from '@/screens/inventory-binding/styles';
import { useResponsiveStyles } from '../useResponsiveStyles';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const theme = Colors.light;
const setViewport = (width: number, height: number, fontScale = 1, scale = 1) => {
  const viewport: ScaledSize = { width, height, fontScale, scale };
  Dimensions.set({ window: viewport, screen: viewport });
};
let root: TestRenderer.ReactTestRenderer;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setViewport(320, 640);
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

it('subscribes to dimension and font changes while memoizing an unchanged viewport', async () => {
  const createStyles = jest.fn((currentTheme: Theme, viewport: ScaledSize) => ({ currentTheme, viewport }));
  let latest!: ReturnType<typeof createStyles>;
  function Harness({ revision: _revision }: { revision: number }) {
    latest = useResponsiveStyles(theme, createStyles);
    return null;
  }
  await act(async () => { root = TestRenderer.create(<Harness revision={0} />); });
  const initial = latest;
  expect(createStyles).toHaveBeenCalledTimes(1);
  await act(async () => { root.update(<Harness revision={1} />); });
  expect(latest).toBe(initial);
  expect(createStyles).toHaveBeenCalledTimes(1);

  await act(async () => { setViewport(1024, 1366); });
  expect(latest).not.toBe(initial);
  expect(latest.viewport).toEqual({ width: 1024, height: 1366, fontScale: 1, scale: 1 });
  expect(latest.currentTheme).toBe(theme);
  const resized = latest;
  await act(async () => { setViewport(1024, 1366, 1.3); });
  expect(latest).not.toBe(resized);
  expect(latest.viewport.fontScale).toBe(1.3);
  const largeFont = latest;
  await act(async () => { root.update(<Harness revision={2} />); setViewport(1024, 1366, 1.3); });
  expect(latest).toBe(largeFont);

  await act(async () => { setViewport(1024, 280, 1.3); });
  expect(latest).not.toBe(largeFont);
  expect(latest.viewport.height).toBe(280);
  expect(latest.currentTheme).toBe(theme);
});

it('switches real order and material-binding compact layouts in both resize directions', async () => {
  const createStyles = (currentTheme: Theme, viewport: ScaledSize) => ({
    orders: createOrderStyles(currentTheme, viewport),
    binding: createBindingStyles(currentTheme, viewport),
  });
  let latest!: ReturnType<typeof createStyles>;
  function Harness() { latest = useResponsiveStyles(theme, createStyles); return null; }
  await act(async () => { root = TestRenderer.create(<Harness />); });
  expect(latest.orders.scrollContent.paddingBottom).toBe(84);
  expect(latest.binding.searchBar.minHeight).toBe(48);
  const narrowOrders = latest.orders;
  const narrowBinding = latest.binding;

  await act(async () => { setViewport(1024, 1366); });
  expect(latest.orders.scrollContent.paddingBottom).toBe(100);
  expect(latest.binding.searchBar.minHeight).toBe(52);

  await act(async () => { setViewport(320, 640); });
  expect(latest.orders).toEqual(narrowOrders);
  expect(latest.binding).toEqual(narrowBinding);
});
