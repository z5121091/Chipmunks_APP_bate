import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Colors, Typography } from '@/constants/theme';
import { AppFormField } from '../AppFormField';
import { AppPillToast } from '../AppPillToast';
import { CustomAlert } from '../CustomAlert';
import { UiListItem, UiPageHeader, UiToolbarButton } from '../UiRedesign';
import { AnimatedButton } from '../AnimatedButton';
import { UiSwitch, UiSwitchVisual } from '../UiSwitch';

jest.mock('@/hooks/useTheme', () => ({ useTheme: jest.fn() }));
jest.mock('@/utils/feedback', () => ({
  feedbackCancel: jest.fn(),
  feedbackConfirm: jest.fn(),
  feedbackDeleted: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

const setTheme = (colorScheme: 'light' | 'dark') => {
  jest.mocked(useTheme).mockReturnValue({
    theme: Colors[colorScheme],
    isDark: colorScheme === 'dark',
    colorScheme,
  });
};

const getTextContent = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(getTextContent).join('');
  }

  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const findText = (root: TestRenderer.ReactTestRenderer, value: string) =>
  root.root
    .findAll((node) => getTextContent(node.props.children) === value)
    .find((node) => node.props.style !== undefined);

describe('shared UI visual contracts', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    setTheme('light');
  });

  it('bounds toolbar padding in a fixed-width modal when a small window grows to tablet size', async () => {
    const originalWindow = Dimensions.get('window');
    const originalScreen = Dimensions.get('screen');
    let root: TestRenderer.ReactTestRenderer | undefined;
    const resize = (width: number, height: number) => {
      const viewport = { width, height, scale: 1, fontScale: 1.3 };
      Dimensions.set({ window: viewport, screen: viewport });
    };
    try {
      resize(320, 640);
      const outer = { flex: 1, minWidth: 0 };
      await act(async () => {
        root = TestRenderer.create(<UiToolbarButton label="确认另建并打印" icon="printer" onPress={jest.fn()} containerStyle={outer} />);
      });
      const narrow = StyleSheet.flatten(root!.root.findByType(AnimatedButton).props.style).paddingHorizontal;
      await act(async () => { resize(1024, 1366); });
      const button = root!.root.findByType(AnimatedButton);
      const wide = StyleSheet.flatten(button.props.style);
      expect(wide.paddingHorizontal).toBeGreaterThanOrEqual(narrow);
      expect(wide.paddingHorizontal).toBeLessThanOrEqual(16);
      expect(wide.height).toBe(44);
      expect(button.props.containerStyle).toBe(outer);
      expect(root!.root.findAllByType(Text).some(node => node.props.children === '确认另建并打印')).toBe(true);
      await act(async () => { resize(320, 640); });
      expect(StyleSheet.flatten(root!.root.findByType(AnimatedButton).props.style).paddingHorizontal).toBe(narrow);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
      Dimensions.set({ window: originalWindow, screen: originalScreen });
    }
  });

  it('keeps feedback text legible in light and dark themes', async () => {
    let root: TestRenderer.ReactTestRenderer | undefined;

    try {
      await act(async () => {
        root = TestRenderer.create(<AppPillToast text="扫码成功" type="success" />);
      });
      const lightText = findText(root!, '扫码成功');
      expect(lightText).toBeDefined();
      expect(lightText!.props.style[1].color).toBe(Colors.light.black);

      setTheme('dark');
      await act(async () => {
        root!.update(<AppPillToast text="扫码成功" type="success" />);
      });
      const darkText = findText(root!, '扫码成功');
      expect(darkText!.props.style[1].color).toBe(Colors.dark.buttonPrimaryText);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });

  it('keeps long error feedback fully wrapped instead of truncating it', async () => {
    let root: TestRenderer.ReactTestRenderer | undefined;
    const message = '扫码失败：二维码无法解析，请检查识别规则与物料绑定后重新扫描。'.repeat(3);

    try {
      await act(async () => {
        root = TestRenderer.create(<AppPillToast text={message} type="error" />);
      });
      const errorText = findText(root!, message);
      expect(errorText).toBeDefined();
      expect(errorText!.props.numberOfLines).toBeUndefined();
      expect(errorText!.props.style).toContainEqual(expect.objectContaining({ flexShrink: 1, textAlign: 'left' }));
      expect(root!.root.findAllByProps({ pointerEvents: 'none' }).length).toBeGreaterThan(0);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });

  it('uses semantic typography in form fields and long dialogs', async () => {
    let root: TestRenderer.ReactTestRenderer | undefined;

    try {
      await act(async () => {
        root = TestRenderer.create(
          <AppFormField label="型号" hint="用于匹配物料绑定">
            <Text>输入框</Text>
          </AppFormField>
        );
      });
      const label = findText(root!, '型号');
      const hint = findText(root!, '用于匹配物料绑定');
      expect(label!.props.style).toMatchObject(Typography.formLabel);
      expect(hint!.props.style).toMatchObject(Typography.formHint);

      await act(async () => {
        root!.update(
          <CustomAlert
            visible
            title="确认操作"
            message={'这是一段需要滚动查看的提示内容。'.repeat(12)}
            onClose={jest.fn()}
          />
        );
      });
      const scrollableMessage = root!.root
        .findAllByType(ScrollView)
        .find((node) => node.props.showsVerticalScrollIndicator);
      expect(scrollableMessage).toBeDefined();
      expect(scrollableMessage!.props.style).toMatchObject({ maxHeight: expect.any(Number) });
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });

  it('keeps header loading feedback accessible and prevents duplicate presses', async () => {
    let root: TestRenderer.ReactTestRenderer | undefined;

    try {
      await act(async () => {
        root = TestRenderer.create(
          <UiPageHeader
            title="采购入库"
            onBack={jest.fn()}
            rightIcon="refresh-cw"
            rightLabel="刷新"
            rightLoading
            onRightPress={jest.fn()}
          />
        );
      });
      const refreshAction = root!.root
        .findAllByType(TouchableOpacity)
        .find((node) => node.props.accessibilityLabel === '刷新');

      expect(refreshAction).toBeDefined();
      expect(refreshAction!.props.disabled).toBe(true);
      expect(refreshAction!.props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(root!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });

  it('uses a larger green/gray switch with a white thumb and one accessible toggle action', async () => {
    let root: TestRenderer.ReactTestRenderer | undefined;
    const change = jest.fn();
    const content = (checked: boolean, disabled = false) => <UiListItem
      title="操作提示音" icon="radio" color={Colors.light.primary} compact
      switchValue={checked} onSwitchChange={change} disabled={disabled} />;
    const control = () => root!.root.findAll(node => node.props.accessibilityRole === 'switch' &&
      typeof node.props.onPress === 'function').at(-1)!;
    const track = () => StyleSheet.flatten(root!.root.findByProps({ testID: 'ui-switch-track' }).props.style);
    const thumb = () => StyleSheet.flatten(root!.root.findByProps({ testID: 'ui-switch-thumb' }).props.style);
    try {
      await act(async () => { root = TestRenderer.create(content(false)); });
      expect(track()).toMatchObject({ width: 60, height: 34, borderRadius: 17,
        backgroundColor: Colors.light.tagGray, alignItems: 'flex-start' });
      expect(thumb()).toMatchObject({ width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.light.white });
      expect(control().props.accessibilityState).toEqual({ checked: false, disabled: false });
      expect(control().props['aria-checked']).toBe(false);
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(1);
      expect(change).toHaveBeenLastCalledWith(true);
      setTheme('dark');
      await act(async () => { root!.update(content(true)); });
      expect(track()).toMatchObject({ backgroundColor: Colors.dark.success, alignItems: 'flex-end' });
      expect(thumb().backgroundColor).toBe(Colors.dark.white);
      expect(control().props.accessibilityState.checked).toBe(true);
      expect(control().props['aria-checked']).toBe(true);
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(2);
      expect(change).toHaveBeenLastCalledWith(false);
      await act(async () => { root!.update(content(true, true)); });
      expect(control().props['aria-disabled']).toBe(true);
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(2);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });

  it.each(['light', 'dark'] as const)('keeps the compact %s switch easy to touch and toggles once without a nested visual action', async scheme => {
    setTheme(scheme);
    const change = jest.fn();
    let root: TestRenderer.ReactTestRenderer | undefined;
    const content = (value: boolean, disabled = false) => <UiSwitch size="compact" value={value}
      onValueChange={change} accessibilityLabel="启用规则测试" disabled={disabled} />;
    const control = () => root!.root.findAll(node => node.props.accessibilityRole === 'switch' &&
      typeof node.props.onPress === 'function').at(-1)!;
    const track = () => StyleSheet.flatten(root!.root.findByProps({ testID: 'ui-switch-track' }).props.style);
    try {
      await act(async () => { root = TestRenderer.create(content(false)); });
      const visual = root!.root.findByType(UiSwitchVisual).findAllByType(View)[0];
      expect(visual.props.pointerEvents).toBe('none');
      expect(StyleSheet.flatten(visual.props.style)).toMatchObject({ width: 52, height: 44, flexShrink: 0 });
      expect(track()).toMatchObject({ width: 48, height: 28, borderRadius: 14,
        backgroundColor: Colors[scheme].tagGray, alignItems: 'flex-start' });
      expect(StyleSheet.flatten(root!.root.findByProps({ testID: 'ui-switch-thumb' }).props.style))
        .toMatchObject({ width: 22, height: 22, borderRadius: 11, backgroundColor: Colors[scheme].white });
      expect(control().props.accessibilityState).toEqual({ checked: false, disabled: false });
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(1);
      expect(change).toHaveBeenLastCalledWith(true);
      await act(async () => { root!.update(content(true)); });
      expect(track()).toMatchObject({ backgroundColor: Colors[scheme].success, alignItems: 'flex-end' });
      expect(control().props.accessibilityState.checked).toBe(true);
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(2);
      expect(change).toHaveBeenLastCalledWith(false);
      await act(async () => { root!.update(content(true, true)); });
      await act(async () => { control().props.onPress(); });
      expect(change).toHaveBeenCalledTimes(2);
    } finally {
      if (root) await act(async () => { root!.unmount(); });
    }
  });
});
