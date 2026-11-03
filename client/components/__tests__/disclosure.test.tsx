import { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MotionCollapse, MotionChevron } from '@/components/AppMotion';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));

let root: TestRenderer.ReactTestRenderer | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.spyOn(Animated, 'timing');
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

it('renders open content in normal flow without waiting for layout or animation completion', async () => {
  const action = jest.fn();
  await act(async () => {
    root = TestRenderer.create(<MotionCollapse open style={{ marginTop: 12 }}>
      <TouchableOpacity onPress={action}><Text>visible now</Text></TouchableOpacity>
    </MotionCollapse>);
  });
  const view = root!.root.findByType(View);
  expect(StyleSheet.flatten(view.props.style)).toEqual({ marginTop: 12 });
  expect(view.props.onLayout).toBeUndefined();
  expect(view.props.pointerEvents).toBeUndefined();
  await act(async () => { root!.root.findByType(TouchableOpacity).props.onPress(); });
  expect(action).toHaveBeenCalledTimes(1);
  expect(Animated.timing).not.toHaveBeenCalled();
  await act(async () => { root!.update(<MotionCollapse open={false}><Text>hidden</Text></MotionCollapse>); });
  expect(root!.toJSON()).toBeNull();
});

it('follows the last click across 100 rapid close/reopen cycles without timers or retained content', async () => {
  function Disclosure() {
    const [open, setOpen] = useState(false);
    return <>
      <TouchableOpacity accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} />
      <MotionCollapse open={open}><Text>details</Text></MotionCollapse>
    </>;
  }
  await act(async () => { root = TestRenderer.create(<Disclosure />); });
  const button = () => root!.root.findByType(TouchableOpacity);
  for (let i = 0; i < 100; i++) {
    await act(async () => { button().props.onPress(); });
    expect(button().props.accessibilityState.expanded).toBe(true);
    expect(root!.root.findByType(Text).props.children).toBe('details');
    await act(async () => { button().props.onPress(); });
    expect(button().props.accessibilityState.expanded).toBe(false);
    expect(root!.root.findAllByType(Text)).toHaveLength(0);
  }
  // Batched presses also use the latest state, rather than an animation lock.
  await act(async () => { for (let i = 0; i < 21; i++) button().props.onPress(); });
  expect(root!.root.findByType(Text).props.children).toBe('details');
  expect(Animated.timing).not.toHaveBeenCalled();
});

it('accepts asynchronous content and nested expansion without height constraints or stale rows', async () => {
  const content = (outer: boolean, inner: boolean, label: string) => <MotionCollapse open={outer}>
    <Text>{label}</Text><MotionCollapse open={inner}><Text>nested rows</Text></MotionCollapse>
  </MotionCollapse>;
  await act(async () => { root = TestRenderer.create(content(true, false, 'loading')); });
  await act(async () => { root!.update(content(true, true, 'loaded rows')); });
  expect(root!.root.findAllByType(Text).map(node => node.props.children)).toEqual(['loaded rows', 'nested rows']);
  for (const view of root!.root.findAllByType(View)) {
    const style = StyleSheet.flatten(view.props.style);
    expect(style?.height).toBeUndefined();
    expect(style?.position).toBeUndefined();
    expect(style?.opacity).toBeUndefined();
    expect(style?.overflow).toBeUndefined();
    expect(view.props.onLayout).toBeUndefined();
  }
  await act(async () => { root!.update(content(false, true, 'old rows')); });
  expect(root!.toJSON()).toBeNull();
  await act(async () => { root!.update(content(true, false, 'new rows')); });
  expect(root!.root.findAllByType(Text).map(node => node.props.children)).toEqual(['new rows']);
  expect(Animated.timing).not.toHaveBeenCalled();
});

it.each(['right', 'down'] as const)('switches the %s disclosure indicator immediately with its content', async collapsed => {
  for (let i = 0; i < 30; i++) {
    const expanded = i % 2 === 0;
    await act(async () => {
      const indicator = <MotionChevron expanded={expanded} collapsed={collapsed} color="black" />;
      if (root) root.update(indicator); else root = TestRenderer.create(indicator);
    });
    expect(root!.toJSON()).toMatchObject({ props: {
      name: collapsed === 'down' ? expanded ? 'chevron-up' : 'chevron-down' : expanded ? 'chevron-down' : 'chevron-right',
    } });
  }
  expect(Animated.timing).not.toHaveBeenCalled();
});
