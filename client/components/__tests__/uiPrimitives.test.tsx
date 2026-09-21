import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Colors, Typography } from '@/constants/theme';
import { AppFormField } from '../AppFormField';
import { AppPillToast } from '../AppPillToast';
import { CustomAlert } from '../CustomAlert';
import { UiPageHeader } from '../UiRedesign';

jest.mock('@/hooks/useTheme', () => ({ useTheme: jest.fn() }));
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
});
