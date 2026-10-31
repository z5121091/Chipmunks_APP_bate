import TestRenderer, { act } from 'react-test-renderer';
import { useConfirmedRouteExit } from '../useConfirmedRouteExit';

let mockBlocked = false;
let mockRemove: (event: { data: { action: { type: string } } }) => void;
const mockDispatch = jest.fn();
const mockNavigation = { dispatch: mockDispatch };
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (enabled: boolean, callback: typeof mockRemove) => {
    mockBlocked = enabled;
    mockRemove = callback;
  },
}));
function Harness({ request }: { request: (proceed: () => void) => void }) {
  useConfirmedRouteExit(true, request);
  return null;
}
let root: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  mockDispatch.mockImplementation(() => { expect(mockBlocked).toBe(false); });
});
afterEach(async () => { await act(async () => root.unmount()); });
it('keeps the native action blocked while work is busy or the user cancels', async () => {
  const request = jest.fn();
  await act(async () => { root = TestRenderer.create(<Harness request={request} />); });
  await act(async () => { mockRemove({ data: { action: { type: 'POP' } } }); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(mockBlocked).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
});
it('replays the exact native action after confirmation and after disabling protection', async () => {
  let confirm!: () => void;
  const request = (proceed: () => void) => { confirm = proceed; };
  const action = { type: 'POP', payload: { count: 1 }, target: 'original-stack' };
  await act(async () => { root = TestRenderer.create(<Harness request={request} />); });
  await act(async () => { mockRemove({ data: { action } }); });
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => { confirm(); });
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith(action);
  // If a parent refuses the action, the remaining screen is protected again.
  expect(mockBlocked).toBe(true);
});
