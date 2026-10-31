import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
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
});
