import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, AppState, TextInput, TouchableOpacity, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { WarehouseScanInput, type WarehouseScanInputHandle, type WarehouseScanInputProps } from '../WarehouseScanInput';
import { useOverlayPresence } from '@/hooks/useOverlayActivity';
import { GEEHY_SCAN_SAMPLES } from '@/utils/testFixtures/geehyScans';

jest.mock('expo-router/react-navigation', () => ({ useIsFocused: jest.fn() }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  TextInput: { value: 'Input' },
  Platform: { value: { ...jest.requireActual('react-native').Platform, OS: 'android' } },
}));

it('discards buffered native boundaries on an explicit account or session reset', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  const submit = jest.fn();
  let root: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = TestRenderer.create(<WarehouseScanInput inputRef={inputRef} autoFocus={false}
        actionLabel="Scan" onActionPress={jest.fn()} onChangeText={jest.fn()} onSubmitEditing={submit} />,
      { createNodeMock: node => node.type === TextInput ? { clear: jest.fn(), isFocused: () => false } : null });
    });
    const input = () => root!.root.findByType(TextInput).props;
    const [previous, sample] = GEEHY_SCAN_SAMPLES;
    await act(async () => {
      input().onChange({ nativeEvent: { text: previous.raw.slice(0, -8), eventCount: 1 } });
      input().onChangeText(previous.raw.slice(0, -8));
      input().onSubmitEditing({ nativeEvent: { text: previous.raw } });
      input().onSubmitEditing({ nativeEvent: { text: sample.raw } });
    });
    submit.mockClear();
    await act(async () => { inputRef.current!.clear({ discardPendingSubmits: true }); });
    await act(async () => {
      input().onChange({ nativeEvent: { text: sample.raw, eventCount: 2 } });
      input().onChangeText(sample.raw);
    });
    expect(submit).not.toHaveBeenCalled();
    // A new scan of the same label in the new account can still submit normally.
    await act(async () => { input().onSubmitEditing({ nativeEvent: { text: sample.raw } }); });
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    if (root) await act(async () => root!.unmount());
  }
});

it('retains an early native Submit until its full change arrives for 30 distinct Geehy packs', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  const saved: string[] = [];
  let pending = '';
  let root: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = TestRenderer.create(<WarehouseScanInput inputRef={inputRef} autoFocus={false}
        actionLabel="Scan" onActionPress={jest.fn()}
        onChangeText={text => { pending = text; }}
        onSubmitEditing={event => {
          if (!pending || pending !== event.nativeEvent.text) return;
          saved.push(pending); pending = ''; inputRef.current!.clear();
        }} />, { createNodeMock: node => node.type === TextInput ? { clear: jest.fn(), isFocused: () => false } : null });
    });
    let count = 0;
    for (const sample of GEEHY_SCAN_SAMPLES) {
      const input = () => root!.root.findByType(TextInput).props;
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: sample.raw } }); });
      await act(async () => {
        input().onChange({ nativeEvent: { text: sample.raw, eventCount: ++count } });
        input().onChangeText(sample.raw);
      });
      expect(pending).toBe('');
      expect(saved.at(-1)).toBe(sample.raw);
      // A second native Enter for this consumed frame cannot create another save.
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: sample.raw } }); });
    }
    expect(saved).toEqual(GEEHY_SCAN_SAMPLES.map(sample => sample.raw));
  } finally {
    if (root) await act(async () => root!.unmount());
  }
});

it.each(['partial', 'two-ahead', 'change-clears'] as const)('keeps native boundaries safe when %s events arrive out of order', async mode => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const inputRef = { current: null as WarehouseScanInputHandle | null };
  let current = '';
  const saved: string[] = [];
  const persist = () => { saved.push(current); current = ''; inputRef.current!.clear(); };
  let root: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = TestRenderer.create(<WarehouseScanInput inputRef={inputRef} autoFocus={false}
        actionLabel="Scan" onActionPress={jest.fn()}
        onChangeText={text => { current = text; if (mode === 'change-clears') persist(); }}
        onSubmitEditing={event => { if (current && current === event.nativeEvent.text) persist(); }} />,
      { createNodeMock: node => node.type === TextInput ? { clear: jest.fn(), isFocused: () => false } : null });
    });
    const [a, b] = GEEHY_SCAN_SAMPLES;
    const input = () => root!.root.findByType(TextInput).props;
    let count = 0;
    const change = async (text: string) => act(async () => {
      input().onChange({ nativeEvent: { text, eventCount: ++count } });
      input().onChangeText(text);
    });
    if (mode === 'partial') await change(a.raw.slice(0, -8));
    await act(async () => { input().onSubmitEditing({ nativeEvent: { text: a.raw } }); });
    if (mode === 'two-ahead') await act(async () => { input().onSubmitEditing({ nativeEvent: { text: b.raw } }); });
    await change(a.raw);
    expect(saved).toEqual([a.raw]);
    if (mode === 'two-ahead') {
      await change(b.raw);
      expect(saved).toEqual([a.raw, b.raw]);
    } else if (mode === 'partial') {
      await change(b.raw.slice(0, 7));
      // The previous Enter must not turn the second pack's prefix into a frame.
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: a.raw } }); });
      expect(saved).toEqual([a.raw]);
      await change(b.raw);
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: b.raw } }); });
      expect(saved).toEqual([a.raw, b.raw]);
      // Separate no-trace/identical physical packs still have fresh native events.
      await change(b.raw);
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: b.raw } }); });
      expect(saved).toEqual([a.raw, b.raw, b.raw]);
      // The next identical physical pack can also deliver Submit before change.
      await act(async () => { input().onSubmitEditing({ nativeEvent: { text: b.raw } }); });
      // Re-delivery of the consumed event is still stale, even with a candidate Submit.
      await act(async () => {
        input().onChange({ nativeEvent: { text: b.raw, eventCount: count } });
        input().onChangeText(b.raw);
      });
      expect(saved).toHaveLength(3);
      await change(b.raw);
      expect(saved).toEqual([a.raw, b.raw, b.raw, b.raw]);
    }
  } finally {
    if (root) await act(async () => root!.unmount());
  }
});

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
  let onWindowBlur: (state: AppStateStatus) => void = () => undefined;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') onAppState = handler;
    if (event === 'blur') onWindowBlur = handler;
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
  const tick = async () => { await act(async () => { jest.advanceTimersByTime(0); }); };
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
    await act(async () => { onWindowBlur('active'); });
    AppState.currentState = 'background';
    await act(async () => { onAppState('background'); });
    await tick();
    expect(focus).not.toHaveBeenCalled();
    AppState.currentState = 'active';
    await act(async () => { onAppState('active'); });
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    await act(async () => { root!.root.findByType(TextInput).props.onFocus({}); });
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
    await act(async () => { input().props.onFocus({}); });
    for (let index = 0; index < 10; index++) {
      await act(async () => {
        input().props.onSubmitEditing({ nativeEvent: { text: `QR/${index}` } });
        input().props.onLayout({});
        inputRef.current!.focus();
      });
      await tick();
    }
    expect(submit).toHaveBeenCalledTimes(10);
    await tick(1000);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();

    focused = false;
    await act(async () => { root!.root.findByType(TouchableOpacity).props.onPress(); });
    await tick();
    expect(action).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);
    await act(async () => { input().props.onFocus({}); });

    focused = false;
    await act(async () => { event('blur')('active'); input().props.onBlur({}); });
    inputRef.current!.focus();
    await tick(200);
    expect(focus).toHaveBeenCalledTimes(2);
    await act(async () => { event('focus')('active'); });
    await tick();
    expect(focus).toHaveBeenCalledTimes(3);
    await act(async () => { input().props.onFocus({}); });

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

it('retries an unacknowledged Android focus once after the input becomes editable again', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  let requestedFocus = false;
  const focus = jest.fn(() => { requestedFocus = true; });
  const blur = jest.fn(() => { requestedFocus = false; });
  // React Native caches the command immediately, even if Android could not focus the view.
  const native = { focus, blur, isFocused: () => requestedFocus };
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  let root: TestRenderer.ReactTestRenderer | undefined;
  const render = async (processing: boolean) => {
    await act(async () => {
      const element = <WarehouseScanInput processing={processing} actionLabel="Scan" onActionPress={jest.fn()} />;
      if (root) root.update(element);
      else root = TestRenderer.create(element, { createNodeMock: node => node.type === TextInput ? native : null });
    });
  };
  const tick = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); };
  try {
    await render(true);
    await tick(1000);
    expect(focus).not.toHaveBeenCalled();
    await render(false);
    await tick(0);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(blur).not.toHaveBeenCalled();
    await tick(1000);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(focus).toHaveBeenCalledTimes(2);

    await render(true);
    await render(false);
    await tick(0);
    expect(focus).toHaveBeenCalledTimes(3);
    await render(true);
    await tick(1000);
    expect(focus).toHaveBeenCalledTimes(3);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    subscription.mockRestore();
    AppState.currentState = originalState;
    jest.useRealTimers();
  }
});

it('hands scanner focus to a shown modal while the page scanner remains blocked', async () => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(useIsFocused).mockReturnValue(true);
  const originalState = AppState.currentState;
  AppState.currentState = 'active';
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  const reprintFocus = jest.fn();
  const stockCodeFocus = jest.fn();
  const action = jest.fn();
  let root: TestRenderer.ReactTestRenderer | undefined;

  function ScannerPair({ dialogOpen, dialogShown }: { dialogOpen: boolean; dialogShown: boolean }) {
    useOverlayPresence(dialogOpen);
    return <>
      <WarehouseScanInput accessibilityLabel="Reprint" actionLabel="Reprint" onActionPress={action} />
      {dialogOpen && <WarehouseScanInput accessibilityLabel="Stock code" actionLabel="Lookup" onActionPress={action}
        focusInModal autoFocus={dialogShown} />}
    </>;
  }

  const render = async (dialogOpen: boolean, dialogShown = false) => {
    await act(async () => {
      const element = <ScannerPair dialogOpen={dialogOpen} dialogShown={dialogShown} />;
      if (root) root.update(element);
      else root = TestRenderer.create(element, { createNodeMock: node => node.type === TextInput ? {
        focus: node.props.accessibilityLabel === 'Reprint' ? reprintFocus : stockCodeFocus,
        isFocused: () => false,
      } : null });
    });
  };
  const emit = async (type: 'blur' | 'change', state: AppStateStatus) => {
    await act(async () => {
      for (const [event, handler] of subscription.mock.calls) {
        if (event === type) handler(state);
      }
    });
  };
  const tick = async () => { await act(async () => { jest.advanceTimersByTime(0); }); };

  try {
    await render(false);
    await tick();
    expect(reprintFocus).toHaveBeenCalledTimes(1);
    reprintFocus.mockClear();

    await render(true);
    await emit('blur', 'active');
    await tick();
    expect(reprintFocus).not.toHaveBeenCalled();
    expect(stockCodeFocus).not.toHaveBeenCalled();

    await render(true, true);
    await tick();
    expect(stockCodeFocus).toHaveBeenCalledTimes(1);
    expect(reprintFocus).not.toHaveBeenCalled();
    stockCodeFocus.mockClear();

    jest.mocked(useIsFocused).mockReturnValue(false);
    await render(true, true);
    await emit('change', 'active');
    await tick();
    expect(stockCodeFocus).not.toHaveBeenCalled();

    AppState.currentState = 'background';
    jest.mocked(useIsFocused).mockReturnValue(true);
    await render(true, true);
    await tick();
    expect(stockCodeFocus).not.toHaveBeenCalled();
    expect(reprintFocus).not.toHaveBeenCalled();
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
    await act(async () => { jest.advanceTimersByTime(0); });
  };
  try {
    await render();
    expect(focus).toHaveBeenCalledTimes(1);
    await act(async () => { root!.root.findByType(TextInput).props.onFocus({}); });

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
