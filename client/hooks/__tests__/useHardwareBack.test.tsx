import TestRenderer, { act } from 'react-test-renderer';
import { BackHandler } from 'react-native';
import { useHardwareBack } from '../useHardwareBack';

let mockFocus: (() => void | (() => void)) | undefined;
let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(() => {
    mockFocus = callback;
    mockBlur = callback() || undefined;
    return () => mockBlur?.();
  }, [callback]),
}));

function Harness({ onBack }: { onBack: () => boolean }) { useHardwareBack(onBack); return null; }
let root: TestRenderer.ReactTestRenderer;
const listeners = new Set<() => boolean>();
const dispatch = () => [...listeners].reverse().some(listener => listener());
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  listeners.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    const callback = listener as () => boolean;
    listeners.add(callback);
    return { remove: () => { listeners.delete(callback); } };
  });
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
});

it('consumes a visible child layer first and then permits normal back', async () => {
  let open = true;
  const onBack = jest.fn(() => { if (!open) return false; open = false; return true; });
  await act(async () => { root = TestRenderer.create(<Harness onBack={onBack} />); });
  expect(dispatch()).toBe(true);
  expect(dispatch()).toBe(false);
});

it('uses the latest callback without leaking listeners on rerenders', async () => {
  const before = jest.fn(() => false);
  const after = jest.fn(() => true);
  await act(async () => { root = TestRenderer.create(<Harness onBack={before} />); });
  await act(async () => { root.update(<Harness onBack={after} />); });
  expect(listeners.size).toBe(1);
  expect(dispatch()).toBe(true);
  expect(before).not.toHaveBeenCalled();
  expect(after).toHaveBeenCalledTimes(1);
});

it('releases back handling on blur and restores it on focus', async () => {
  const onBack = jest.fn(() => true);
  await act(async () => { root = TestRenderer.create(<Harness onBack={onBack} />); });
  await act(async () => { mockBlur!(); });
  expect(dispatch()).toBe(false);
  await act(async () => { mockBlur = mockFocus!() || undefined; });
  expect(dispatch()).toBe(true);
  await act(async () => { root.unmount(); });
  expect(listeners.size).toBe(0);
});
