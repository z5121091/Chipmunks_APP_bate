import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, AppState, TextInput, TouchableOpacity, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { WarehouseScanInput, type WarehouseScanInputHandle, type WarehouseScanInputProps } from '../WarehouseScanInput';

jest.mock('expo-router/react-navigation', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  TextInput: { value: 'Input' },
  Platform: { value: { ...jest.requireActual('react-native').Platform, OS: 'android' } },
}));

it('rejects native snapshots from a consumed scan without dropping a fresh identical package', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const changed = jest.fn();
  const nativeChanged = jest.fn();
  const clear = jest.fn();
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  let root: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = TestRenderer.create(<WarehouseScanInput inputRef={inputRef} autoFocus={false}
        actionLabel="Scan" onActionPress={jest.fn()} onChange={nativeChanged}
        onChangeText={changed} />, {
        createNodeMock: node => node.type === TextInput ? { clear, isFocused: () => false } : null,
      });
    });
    const change = (text: string, eventCount: number) => {
      const input = root!.root.findByType(TextInput);
      input.props.onChange({ nativeEvent: { text, eventCount } });
      input.props.onChangeText(text);
    };
    await act(async () => {
      change('MODEL/LOT/100/TRACE-10', 80);
      inputRef.current!.clear();
      change('MODEL/LOT/100/TRACE-', 79);
      change('MODEL/LOT/100/TRACE-10', 80);
      change('MODEL', 81);
      change('MODEL/LOT/100/TRACE-10', 80);
      change('MODEL/LOT/100/TRACE-10', 82);
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls).toEqual([
      ['MODEL/LOT/100/TRACE-10'], ['MODEL'], ['MODEL/LOT/100/TRACE-10'],
    ]);
    expect(nativeChanged).toHaveBeenCalledTimes(3);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

it('focuses on entry, readiness and foreground, but pauses for dialogs and inactive screens', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const focus = jest.fn();
  const clear = jest.fn();
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  const onActionPress = jest.fn();
  const remove = jest.fn();
  let onAppState: (state: AppStateStatus) => void = () => undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') onAppState = handler;
    return { remove };
  });
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  let root: TestRenderer.ReactTestRenderer | undefined;
  const render = async (props: Partial<WarehouseScanInputProps> = {}) => {
    await act(async () => {
      const element = <WarehouseScanInput actionLabel="Scan" onActionPress={onActionPress} inputRef={inputRef} {...props} />;
      if (root) root.update(element);
      else root = TestRenderer.create(element, { createNodeMock: node => node.type === TextInput ? { focus, clear, isFocused: () => false } : null });
    });
  };
  const tick = async () => { await act(async () => { jest.advanceTimersByTime(200); }); };
  try {
    await render({ processing: true });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    await render();
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(typeof inputRef.current?.focus).toBe('function');
    inputRef.current?.clear();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(root!.root.findByType(TextInput).props.submitBehavior).toBe('submit');
    expect(root!.root.findByType(TextInput).props.showSoftInputOnFocus).toBe(false);

    focus.mockClear();
    await render({ autoFocus: false });
    await act(async () => { onAppState('active'); });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    await render();
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);

    focus.mockClear();
    jest.mocked(useIsFocused).mockReturnValue(false);
    await render();
    await act(async () => { onAppState('active'); });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    jest.mocked(useIsFocused).mockReturnValue(true);
    await render({ editable: false });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    await render();
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);

    focus.mockClear();
    AppState.currentState = 'background';
    await act(async () => { onAppState('background'); });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    AppState.currentState = 'active';
    await act(async () => { onAppState('active'); });
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockClear();
    await act(async () => { root!.root.findByType(TextInput).props.onBlur({}); });
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    await act(async () => { root!.root.findByType(TextInput).props.onBlur({}); });
    await act(async () => { root!.unmount(); });
    root = undefined;
    focus.mockClear();
    await tick();
    expect(focus).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    AppState.currentState = originalState;
    subscription.mockRestore();
    jest.useRealTimers();
  }
});

it('coalesces repeated focus requests, keeps the caret on repeated scans, and pauses for native windows', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  let focused = false;
  const focus = jest.fn(() => { focused = true; });
  const blur = jest.fn(() => { focused = false; });
  const native = { focus, blur, isFocused: () => focused };
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  const action = jest.fn();
  const submit = jest.fn();
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  const event = (name: 'focus' | 'blur') => subscription.mock.calls.find(([key]) => key === name)![1];
  let root: TestRenderer.ReactTestRenderer | undefined;
  const render = async (props: Partial<WarehouseScanInputProps> = {}) => {
    await act(async () => {
      const element = <WarehouseScanInput inputRef={inputRef} actionLabel="Scan" onActionPress={action} onSubmitEditing={submit} {...props} />;
      if (root) root.update(element);
      else root = TestRenderer.create(element, { createNodeMock: node => node.type === TextInput ? native : null });
    });
  };
  const tick = async (ms = 0) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
  try {
    await render();
    const input = () => root!.root.findByType(TextInput);
    // Page-level requests must not postpone the component's immediate entry focus.
    inputRef.current!.focus(120);
    inputRef.current!.focus(300);
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 10; index++) {
      await act(async () => {
        input().props.onSubmitEditing({ nativeEvent: { text: `QR/${index}` } });
        input().props.onLayout({});
        inputRef.current!.focus();
      });
      await tick();
    }
    expect(submit).toHaveBeenCalledTimes(10);
    expect(focus).toHaveBeenCalledTimes(1);

    focused = false;
    await act(async () => { root!.root.findByType(TouchableOpacity).props.onPress(); });
    await tick();
    expect(action).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);

    focused = false;
    await act(async () => { event('blur')('active'); input().props.onBlur({}); });
    inputRef.current!.focus();
    await tick(200);
    expect(focus).toHaveBeenCalledTimes(2);
    await act(async () => { event('focus')('active'); });
    await tick();
    expect(focus).toHaveBeenCalledTimes(3);

    // A delayed page callback cannot steal focus from a quantity/confirmation dialog.
    focused = false;
    inputRef.current!.focus(120);
    await render({ autoFocus: false });
    inputRef.current!.focus();
    await act(async () => { event('focus')('active'); });
    await tick(200);
    expect(focus).toHaveBeenCalledTimes(3);
    await render();
    await tick();
    expect(focus).toHaveBeenCalledTimes(4);
    await render({ processing: true });
    expect(blur).toHaveBeenCalledTimes(1);
    inputRef.current!.focus();
    await tick(200);
    expect(focus).toHaveBeenCalledTimes(4);
    await render();
    await tick();
    expect(focus).toHaveBeenCalledTimes(5);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    subscription.mockRestore();
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});

it('keeps busy hardware scan capture editable and focused only when explicitly enabled', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  let focused = false;
  const focus = jest.fn(() => { focused = true; });
  const blur = jest.fn(() => { focused = false; });
  const native = { focus, blur, isFocused: () => focused };
  const submit = jest.fn();
  const changed = jest.fn();
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  let root: TestRenderer.ReactTestRenderer | undefined;
  const render = async (props: Partial<WarehouseScanInputProps> = {}) => {
    await act(async () => {
      const element = <WarehouseScanInput actionLabel="Scan" onActionPress={jest.fn()} onSubmitEditing={submit} onChangeText={changed} {...props} />;
      if (root) root.update(element);
      else root = TestRenderer.create(element, { createNodeMock: node => node.type === TextInput ? native : null });
    });
    await act(async () => { jest.advanceTimersByTime(200); });
  };
  try {
    await render();
    expect(focus).toHaveBeenCalledTimes(1);

    await render({ processing: true, acceptInputWhileProcessing: true });
    const input = root!.root.findByType(TextInput);
    expect(input.props.editable).toBe(true);
    expect(blur).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(root!.root.findByType(TouchableOpacity).props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(root!.root.findByType(TouchableOpacity).props.disabled).toBe(true);
    expect(root!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    await act(async () => {
      input.props.onChangeText('Model A/100');
      input.props.onSubmitEditing({ nativeEvent: { text: 'Model A/100' } });
    });
    expect(changed).toHaveBeenCalledWith('Model A/100');
    expect(submit).toHaveBeenCalledTimes(1);

    await render({ processing: true });
    expect(root!.root.findByType(TextInput).props.editable).toBe(false);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);

    await render({ processing: true, acceptInputWhileProcessing: true, editable: false });
    expect(root!.root.findByType(TextInput).props.editable).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    subscription.mockRestore();
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});
