import TestRenderer, { act } from 'react-test-renderer';
import { useEffect } from 'react';
import { CustomAlert, useCustomAlert } from '@/components/CustomAlert';
import type { FeedbackTimingOptions } from '@/utils/feedbackTiming';

jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'Icon' }));
jest.mock('@/utils/feedback', () => ({ feedbackCancel: jest.fn(), feedbackConfirm: jest.fn(), feedbackDeleted: jest.fn() }));
// Native modal animation is covered separately by motionLifecycle.test.tsx.
jest.mock('@/components/AppModal', () => ({ AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
  visible ? jest.requireActual('react').createElement('DialogHost', null, children) : null,
}));
jest.mock('@/components/AppPillToast', () => ({ AppPillToast: ({ text, visible }: { text: string; visible: boolean }) =>
  visible && text ? jest.requireActual('react').createElement('ToastMessage', null, text) : null,
}));

let root: TestRenderer.ReactTestRenderer;
let alert: ReturnType<typeof useCustomAlert>;
function Harness({ options }: { options?: FeedbackTimingOptions }) {
  const actions = useCustomAlert(options);
  useEffect(() => { alert = actions; }, [actions]);
  return actions.AlertComponent;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  jest.useRealTimers();
});

it.each(['无效的备份文件格式', '检查更新失败\n' + '这是完整的失败原因，'.repeat(20)])(
  'dismisses short and multiline settings errors without opening a confirmation dialog: %s', async message => {
    await act(async () => { root = TestRenderer.create(<Harness />); });
    await act(async () => { alert.showError(message); });
    expect(root.root.findByType('ToastMessage').children.join('')).toBe(message);
    expect(root.root.findByType(CustomAlert).props.visible).toBe(false);
    await act(async () => { jest.advanceTimersByTime(4999); });
    expect(root.root.findAllByType('ToastMessage')).toHaveLength(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(root.root.findAllByType('ToastMessage')).toHaveLength(0);
  },
);

it('retains scanner errors and lets a subsequent scan result replace the message immediately', async () => {
  await act(async () => { root = TestRenderer.create(<Harness options={{ persistentErrors: true }} />); });
  await act(async () => { alert.showError('扫码错误\n' + '完整失败原因'.repeat(20)); });
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(root.root.findByType('ToastMessage').children.join('')).toContain('完整失败原因');
  expect(root.root.findByType(CustomAlert).props.visible).toBe(false);
  await act(async () => { alert.showSuccess('下一张标签成功'); });
  expect(root.root.findByType('ToastMessage').children.join('')).toBe('下一张标签成功');
  await act(async () => { jest.advanceTimersByTime(2200); });
  expect(root.root.findAllByType('ToastMessage')).toHaveLength(0);
});

it('keeps explicit decisions open until the user chooses an action', async () => {
  await act(async () => { root = TestRenderer.create(<Harness />); });
  await act(async () => { alert.showConfirm('恢复数据库', '是否恢复？', jest.fn(), true); });
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(root.root.findByType(CustomAlert).props.visible).toBe(true);
  expect(root.root.findByType(CustomAlert).props.buttons).toHaveLength(2);
});
