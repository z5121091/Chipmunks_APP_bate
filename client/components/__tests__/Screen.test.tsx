import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Screen } from '../Screen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 32, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }));

describe('Screen edge-to-edge layout', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterEach(async () => {
    if (renderer) await act(async () => { renderer.unmount(); });
  });

  it.each([
    ['#edf4f8', 'dark'],
    ['#18232b', 'light'],
  ] as const)('extends %s behind the status bar without a contrasting strip', async (backgroundColor, statusBarStyle) => {
    await act(async () => {
      renderer = TestRenderer.create(
        <Screen disableAutoScroll backgroundColor={backgroundColor} statusBarStyle={statusBarStyle}>
          <Text>Content</Text>
        </Screen>
      );
    });
    expect(StyleSheet.flatten(renderer.root.findAllByType(View)[0].props.style))
      .toMatchObject({ backgroundColor, paddingTop: 32 });
    expect(renderer.root.findAllByProps({ testID: 'screen-status-bar-background' })).toHaveLength(0);
    expect(renderer.root.findByType(StatusBar).props.style).toBe(statusBarStyle);
  });

  it('preserves explicit status bar colors and does not intercept touch', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<Screen disableAutoScroll statusBarColor="#123456"><Text>Content</Text></Screen>);
    });
    const background = renderer.root.findAllByType(View).find(node => node.props.testID === 'screen-status-bar-background');
    expect(background?.props.pointerEvents).toBe('none');
    expect(background?.props.style).toMatchObject({ height: 32, backgroundColor: '#123456' });
  });

  it('leaves custom immersive headers in control of their own top inset', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<Screen disableAutoScroll safeAreaEdges={['left', 'right', 'bottom']}><Text>Content</Text></Screen>);
    });
    expect(StyleSheet.flatten(renderer.root.findAllByType(View)[0].props.style).paddingTop).toBe(0);
    expect(renderer.root.findAllByProps({ testID: 'screen-status-bar-background' })).toHaveLength(0);
  });

  it('keeps long plain content manually scrollable without automatic keyboard offsets', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<Screen><TextInput value="仓库备注" /><Text>长正文</Text></Screen>);
    });
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props).toMatchObject({ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag', automaticallyAdjustKeyboardInsets: false });
    expect(scroll.props.enableAutomaticScroll).toBeUndefined();
    expect(scroll.props.extraHeight).toBeUndefined();
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({ flexGrow: 1, paddingBottom: 24 });
  });

  it('preserves the native scroll owner, ref and caller options next to a fixed footer', async () => {
    const scrollRef = React.createRef<ScrollView>();
    await act(async () => {
      renderer = TestRenderer.create(<Screen>
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 12 }} keyboardDismissMode="none"><TextInput value="V1" /></ScrollView>
        <Text>固定操作区</Text>
      </Screen>);
    });
    const scroll = renderer.root.findByType(ScrollView);
    expect(renderer.root.findAllByType(ScrollView)).toHaveLength(1);
    expect(scrollRef.current).toBeTruthy();
    expect(scroll.props.keyboardDismissMode).toBe('none');
    expect(scroll.props.contentContainerStyle.paddingBottom).toBe(12);
    expect(StyleSheet.flatten(renderer.root.findAllByType(View)[0].props.style).paddingBottom).toBe(24);
    expect(scroll.parent?.type).not.toBe(ScrollView);
  });

  it('detects lists nested in page content while treating modal lists as separate windows', async () => {
    await act(async () => {
      renderer = TestRenderer.create(<Screen><View><FlatList data={[]} renderItem={() => null} /></View></Screen>);
    });
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(1);
    let ancestor = renderer.root.findByType(FlatList).parent;
    while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
    await act(async () => {
      renderer.update(<Screen><Text>页面正文</Text><Modal visible><FlatList data={[]} renderItem={() => null} /></Modal></Screen>);
    });
    const pageScrolls = renderer.root.findAllByType(ScrollView).filter(scroll =>
      scroll.findAllByType(Text).some(text => text.props.children === '页面正文'));
    expect(pageScrolls).toHaveLength(1);
  });
});
