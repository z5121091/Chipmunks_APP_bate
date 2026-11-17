import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useEffect, useState } from 'react';
import { AppModalCard } from '../AppModalCard';
import { AppModalViewport } from '../AppModalViewport';
import { getAppModalAvailableHeight, getAppModalMaxHeight, getAppModalWidth } from '@/constants/modal';

jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('../AppMotion', () => ({ MotionSurface: 'ModalSurface' }));
jest.mock('../AppModalHeader', () => ({ AppModalHeader: 'ModalHeader' }));

let root: TestRenderer.ReactTestRenderer | undefined;
let dimensions: ReturnType<typeof useWindowDimensions>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dimensions = { width: 360, height: 640, scale: 1, fontScale: 1 };
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => dimensions);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

const card = () => root!.root.findByType('ModalSurface' as React.ElementType);
const cardStyle = () => StyleSheet.flatten(card().props.style);
const form = (size: React.ComponentProps<typeof AppModalCard>['size'] = 'largeForm', style = {}) => (
  <AppModalViewport style={{ flex: 1, padding: 20 }}>
    <AppModalCard title="编辑绑定" size={size} style={style} footer={<Text>保存</Text>}>
      <Text>可滚动正文</Text>
    </AppModalCard>
  </AppModalViewport>
);
async function layout(height: number) {
  const viewport = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-viewport')!;
  await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height } } }); });
}

it.each(['compact', 'form', 'largeForm', 'list', 'auto'] as const)('caps %s cards to the usable short window', async size => {
  dimensions.height = 320;
  await act(async () => { root = TestRenderer.create(form(size, size === 'auto' ? { height: 600 } : {})); });
  expect(cardStyle().maxHeight).toBeLessThanOrEqual(280);
  await layout(248);
  expect(cardStyle().maxHeight).toBeLessThanOrEqual(248);
  if (size !== 'auto' && size !== 'list') expect(cardStyle().height).toBeLessThanOrEqual(248);
});

it('has no keyboard avoidance wrapper while still responding to physical window resizing', async () => {
  await act(async () => { root = TestRenderer.create(form()); });
  const preferredHeight = cardStyle().height;
  expect(root!.root.findAllByType(KeyboardAvoidingView)).toHaveLength(0);
  await layout(256);
  expect(cardStyle()).toMatchObject({ height: 256, maxHeight: 256 });
  const sections = card().findAllByType(View);
  expect(sections.map(section => StyleSheet.flatten(section.props.style))).toEqual(expect.arrayContaining([
    expect.objectContaining({ flexShrink: 0 }),
    expect.objectContaining({ minHeight: 0, flex: 1 }),
  ]));
  await layout(600);
  expect(cardStyle().height).toBe(preferredHeight);
});

it('honors tighter caller bounds and updates after a window resize', async () => {
  await act(async () => { root = TestRenderer.create(form('largeForm', { maxHeight: 220 })); });
  expect(cardStyle()).toMatchObject({ height: 220, maxHeight: 220 });
  dimensions = { ...dimensions, width: 1024, height: 1366 };
  await act(async () => { root!.update(form('largeForm', { maxHeight: 220 })); });
  expect(cardStyle()).toMatchObject({ width: 400, height: 220, maxHeight: 220 });
});

it('retains caller-controlled auto height while bounding its rendered maximum', async () => {
  await act(async () => { root = TestRenderer.create(form('auto', { height: 380 })); });
  await layout(300);
  expect(cardStyle()).toMatchObject({ height: 380, maxHeight: 300 });
});

it('keeps the modal within narrow widths, zero-height overlays, and tighter percentage limits', () => {
  expect(getAppModalWidth(240)).toBe(200);
  expect(getAppModalWidth(1024)).toBe(400);
  expect(getAppModalAvailableHeight(320)).toBe(280);
  expect(getAppModalAvailableHeight(640, 0)).toBe(0);
  expect(getAppModalMaxHeight(300, '84%')).toBe(252);
  expect(getAppModalMaxHeight(300, 800)).toBe(300);
});

async function measureSection(testID: string, height: number) {
  const section = root!.root.findAllByType(View).find(node => node.props.testID === testID)!;
  await act(async () => { section.props.onLayout({ nativeEvent: { layout: { height } } }); });
}

it('allows the entire card to scroll to its actions in a cramped viewport without remounting inputs', async () => {
  const mounted = jest.fn();
  const unmounted = jest.fn();
  function FormInput() {
    const [value, setValue] = useState('V1');
    useEffect(() => { mounted(); return unmounted; }, []);
    return <TextInput value={value} onChangeText={setValue} />;
  }
  await act(async () => {
    root = TestRenderer.create(
      <AppModalViewport style={{ flex: 1 }}>
        <AppModalCard title="维护供应商" size="largeForm" footer={<Text>完成</Text>}>
          <FormInput />
        </AppModalCard>
      </AppModalViewport>,
    );
  });
  await measureSection('app-modal-card-header', 140);
  await measureSection('app-modal-card-footer', 100);
  const input = root!.root.findByType(TextInput);
  await act(async () => { input.props.onChangeText('V2'); });
  expect(root!.root.findByType(ScrollView).props.scrollEnabled).toBe(false);
  await layout(180);
  expect(root!.root.findByType(ScrollView).props).toMatchObject({ scrollEnabled: true, keyboardShouldPersistTaps: 'handled' });
  const body = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-card-body')!;
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ height: 200, flexShrink: 0 });
  expect(root!.root.findAllByType(Text).some(node => node.props.children === '完成')).toBe(true);
  await layout(600);
  expect(root!.root.findByType(ScrollView).props.scrollEnabled).toBe(false);
  expect(root!.root.findByType(TextInput)).toBe(input);
  expect(input.props.value).toBe('V2');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

it('uses the compact preset height to decide whether fixed sections need whole-card scrolling', async () => {
  await act(async () => { root = TestRenderer.create(form('compact')); });
  await measureSection('app-modal-card-header', 120);
  await measureSection('app-modal-card-footer', 80);
  expect(cardStyle().height).toBe(252);
  expect(root!.root.findByType(ScrollView).props.scrollEnabled).toBe(true);
});

it('scrolls an auto-sized form when its full content overflows despite short header and footer', async () => {
  await act(async () => { root = TestRenderer.create(form('auto')); });
  await measureSection('app-modal-card-header', 68);
  await measureSection('app-modal-card-footer', 64);
  await layout(300);
  const scroll = root!.root.findByType(ScrollView);
  expect(scroll.props.scrollEnabled).toBe(false);
  await act(async () => { scroll.props.onContentSizeChange(280, 410); });
  expect(scroll.props.scrollEnabled).toBe(true);
  await layout(600);
  expect(root!.root.findByType(ScrollView)).toBe(scroll);
  expect(scroll.props.scrollEnabled).toBe(false);
  expect(cardStyle().height).toBeUndefined();
});

it('gives a list-owned body a bounded flex frame without a vertical ScrollView ancestor', async () => {
  await act(async () => {
    root = TestRenderer.create(
      <AppModalViewport style={{ flex: 1 }}>
        <AppModalCard title="未绑定供应商的物料" size="largeForm" scrollMode="body" footer={<Text>返回维护</Text>}>
          <FlatList data={['物料1', '物料2', '物料3', '物料4', '物料5', '物料6', '物料7']}
            style={{ flex: 1, minHeight: 0 }} renderItem={({ item }) => <Text>{item}</Text>} />
        </AppModalCard>
      </AppModalViewport>,
    );
  });
  const list = root!.root.findByType(FlatList);
  let ancestor = list.parent;
  while (ancestor) {
    expect(ancestor.type).not.toBe(ScrollView);
    ancestor = ancestor.parent;
  }
  expect(root!.root.findAllByProps({ testID: 'app-modal-card-scroll' })).toHaveLength(0);
  const frame = root!.root.findByProps({ testID: 'app-modal-card-body-frame' });
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  const body = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-card-body')!;
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  expect(list.props.data).toHaveLength(7);
});

it('keeps list-owned scrolling during a short viewport instead of restoring the outer scroll wrapper', async () => {
  dimensions = { width: 320, height: 480, scale: 1, fontScale: 1.3 };
  await act(async () => {
    root = TestRenderer.create(
      <AppModalViewport style={{ flex: 1 }}>
        <AppModalCard title="分配供应商" size="largeForm" scrollMode="body" footer={<Text>保存分配</Text>}>
          <FlatList data={Array.from({ length: 18 }, (_, i) => `供应商${i + 1}`)}
            style={{ flex: 1, minHeight: 0 }} renderItem={({ item }) => <Text>{item}</Text>} />
        </AppModalCard>
      </AppModalViewport>,
    );
  });
  await measureSection('app-modal-card-header', 120);
  await measureSection('app-modal-card-footer', 80);
  await layout(280);
  expect(cardStyle()).toMatchObject({ height: 280, maxHeight: 280 });
  expect(root!.root.findAllByProps({ testID: 'app-modal-card-scroll' })).toHaveLength(0);
  const body = root!.root.findAllByType(View).find(node => node.props.testID === 'app-modal-card-body')!;
  const bodyStyle = StyleSheet.flatten(body.props.style);
  expect(bodyStyle).toMatchObject({ flex: 1, minHeight: 0 });
  expect(bodyStyle.height).toBeUndefined();
  expect(root!.root.findByType(FlatList).props.data).toHaveLength(18);
  expect(root!.root.findAllByType(Text).some(node => node.props.children === '保存分配')).toBe(true);
});

it('gives the list preset a definite body viewport and keeps default card sizing unchanged', async () => {
  await act(async () => { root = TestRenderer.create(form('list')); });
  expect(cardStyle().height).toBeUndefined();
  await act(async () => {
    root!.update(<AppModalViewport style={{ flex: 1 }}>
      <AppModalCard title="标签任务" size="list" scrollMode="body">
        <ScrollView style={{ flex: 1, minHeight: 0 }}><Text>最后一项</Text></ScrollView>
      </AppModalCard>
    </AppModalViewport>);
  });
  expect(cardStyle().height).toBeGreaterThan(0);
  expect(cardStyle().height).toBeLessThanOrEqual(cardStyle().maxHeight);
  await layout(240);
  expect(cardStyle()).toMatchObject({ height: 240, maxHeight: 240 });
  expect(root!.root.findAllByProps({ testID: 'app-modal-card-scroll' })).toHaveLength(0);
});

it('keeps short list dialogs compact while capping long content to the available viewport', async () => {
  const list = (height: number) => <AppModalViewport style={{ flex: 1 }}>
    <AppModalCard title="标签任务" size="list" scrollMode="body" bodyContentHeight={height}>
      <ScrollView style={{ flex: 1, minHeight: 0 }}><Text>任务</Text></ScrollView>
    </AppModalCard>
  </AppModalViewport>;
  await act(async () => { root = TestRenderer.create(list(90)); });
  await measureSection('app-modal-card-header', 80);
  const compactHeight = cardStyle().height;
  expect(compactHeight).toBeGreaterThan(90);
  expect(compactHeight).toBeLessThan(300);
  await act(async () => { root!.update(list(900)); });
  expect(cardStyle().height).toBeGreaterThan(compactHeight);
  expect(cardStyle().height).toBeLessThanOrEqual(cardStyle().maxHeight);
  await layout(240);
  expect(cardStyle()).toMatchObject({ height: 240, maxHeight: 240 });
});
