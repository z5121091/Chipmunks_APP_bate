import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { useToast } from '../toast';

jest.mock('@/components/AppPillToast', () => ({
  AppPillToast: ({ text, visible }: { text: string; visible: boolean }) =>
    visible && text ? jest.requireActual('react').createElement('ToastMessage', null, text) : null,
}));

describe('useToast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps errors visible until the next feedback and replaces them without blocking the caller', () => {
    let actions!: ReturnType<typeof useToast>;
    function Harness() {
      actions = useToast({ persistentErrors: true });
      const { ToastContainer } = actions;
      return <ToastContainer />;
    }

    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<Harness />); });
    act(() => { actions.showToast('出库单加载失败：网络连接暂时不可用，请检查同步助手后重试', 'error'); });
    expect(renderer.root.findByType('ToastMessage').children.join('')).toContain('同步助手后重试');

    act(() => { jest.advanceTimersByTime(60_000); });
    expect(renderer.root.findByType('ToastMessage').children.join('')).toContain('同步助手后重试');

    act(() => { actions.showToast('已扫码：TEST123', 'success'); });
    expect(renderer.root.findByType('ToastMessage').children.join('')).toBe('已扫码：TEST123');
    act(() => { jest.advanceTimersByTime(2200); });
    expect(renderer.root.findAllByType('ToastMessage')).toHaveLength(0);
    act(() => { renderer.unmount(); });
  });

  it('automatically dismisses settings feedback and gives a new error its own full delay', () => {
    let actions!: ReturnType<typeof useToast>;
    function Harness() {
      actions = useToast();
      return <actions.ToastContainer />;
    }
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<Harness />); });
    act(() => { actions.showToast('配置读取失败', 'error'); });
    act(() => { jest.advanceTimersByTime(4000); });
    act(() => { actions.showToast('新的配置错误\n完整原因', 'error'); });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(renderer.root.findByType('ToastMessage').children.join('')).toContain('完整原因');
    act(() => { jest.advanceTimersByTime(4000); });
    expect(renderer.root.findAllByType('ToastMessage')).toHaveLength(0);
    act(() => { renderer.unmount(); });
  });
});
