import TestRenderer, { act } from 'react-test-renderer';
import { Animated, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppModalCard } from '@/components/AppModalCard';
import { Spacing } from '@/constants/theme';
import LabelReprintScreen from '../index';
import {
  applyLabelQuantityCorrection, getLabelCorrectionTraceNo, IgnoredLabelReprintScan,
  parseLabelCorrectionQuantity, prepareLabelReprint, submitLabelReprint, type LabelReprintTask,
} from '@/utils/labelReprint';

let mockFocus: () => (() => void) | undefined;
let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => require('react').useEffect(() => {
    mockFocus = callback;
    mockBlur = callback();
    return () => mockBlur?.();
  }, [callback]),
}));
jest.mock('@/hooks/useTheme', () => {
  const theme = require('@/constants/theme').Colors.light;
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/CustomAlert', () => ({ CustomAlert: 'Alert' }));
jest.mock('@/components/UiRedesign', () => ({ UiToolbarButton: 'Button', UiInput: 'Input' }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'Scanner' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/labelReprint', () => ({
  prepareLabelReprint: jest.fn(), submitLabelReprint: jest.fn(),
  parseLabelCorrectionQuantity: jest.fn(), getLabelCorrectionTraceNo: jest.fn(), applyLabelQuantityCorrection: jest.fn(),
  LabelReprintValidationError: class extends Error { title = '无法补打'; },
  IgnoredLabelReprintScan: class extends Error {},
}));

const task = (id: string, overrides: Partial<LabelReprintTask> = {}): LabelReprintTask => ({
  id, model: id, version: 'V1', batch: 'LOT-1', quantity: 250, traceNo: 'TRACE-1', boxNo: '',
  supplier: '南京沁恒微电子股份有限公司', sourceQr: ` ${id},250,TRACE-1 `,
  createdAt: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:00.000Z',
  status: 'pending', lastError: '', lastMessage: '', attemptCount: 0,
  record: { model: id, version: 'V1', batch: 'LOT-1', quantity: 250, production_date: '',
    trace_no: 'TRACE-1', source_no: '', supplier: '南京沁恒微电子股份有限公司', package: '', source_qr: ` ${id},250,TRACE-1 ` },
  ...overrides,
});

const defer = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

describe('label reprint page visit', () => {
  let root: TestRenderer.ReactTestRenderer;
  let windowDimensionsSpy: jest.SpyInstance;
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    jest.clearAllMocks();
    windowDimensionsSpy = jest.spyOn(require('react-native'), 'useWindowDimensions')
      .mockReturnValue({ width: 320, height: 480, scale: 1, fontScale: 1 });
    jest.mocked(prepareLabelReprint).mockImplementation(async (raw) => task(raw.trim()));
    jest.mocked(submitLabelReprint).mockImplementation(async (prepared) => ({ ...prepared, status: 'submitted' }));
    jest.mocked(parseLabelCorrectionQuantity).mockImplementation((raw) => {
      const value = Number(raw);
      if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value <= 0) throw new Error('请输入大于 0 的整数');
      return value;
    });
    jest.mocked(getLabelCorrectionTraceNo).mockImplementation((original, quantity) => {
      if (quantity === original.quantity || !original.traceNo) return original.traceNo;
      const suffix = /-(\d+)$/.exec(original.traceNo);
      return suffix ? original.traceNo.replace(/-\d+$/, `-${Number(suffix[1]) + 1}`) : `${original.traceNo}-1`;
    });
    jest.mocked(applyLabelQuantityCorrection).mockImplementation(async (original, quantity) => {
      const traceNo = getLabelCorrectionTraceNo(original, quantity);
      const sourceQr = `${original.model},${quantity},${traceNo}`;
      return { ...original, quantity, traceNo, sourceQr,
        record: { ...original.record, quantity, trace_no: traceNo, source_qr: sourceQr } };
    });
    await act(async () => { root = TestRenderer.create(<LabelReprintScreen />); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    windowDimensionsSpy.mockRestore();
    jest.useRealTimers();
  });
  const scanner = () => root.root.findByType('Scanner' as unknown as React.ElementType);
  const buttons = (label: string) => root.root.findAllByType('Button' as unknown as React.ElementType)
    .filter((node) => node.props.label === label);
  const text = () => root.root.findAllByType(Text).map((node) => node.props.children).flat().join('');
  const scan = async (raw: string) => {
    await act(async () => { scanner().props.onChangeText(raw); });
    await act(async () => { scanner().props.onSubmitEditing({ nativeEvent: { text: raw } }); });
  };
  const quantityInput = () => root.root.findByType('Input' as unknown as React.ElementType);
  const openQuantityDialog = async (raw = 'CORRECT-ME') => {
    await act(async () => { buttons('修改数量')[0].props.onPress(); });
    await scan(raw);
  };

  it('waits for quantity confirmation, prints a larger positive integer, then returns to ordinary reprint', async () => {
    await openQuantityDialog();
    expect(quantityInput().props.value).toBe('');
    expect(submitLabelReprint).not.toHaveBeenCalled();
    expect(scanner().props.editable).toBe(false);
    expect(scanner().props.autoFocus).toBe(false);
    await act(async () => { quantityInput().props.onChangeText('1000'); });
    expect(text()).toContain('新追溯码：TRACE-2');
    await act(async () => { buttons('确认打印')[0].props.onPress(); });
    const edited = jest.mocked(submitLabelReprint).mock.calls[0][0];
    expect(edited).toMatchObject({ id: 'CORRECT-ME', quantity: 1000, traceNo: 'TRACE-2',
      record: { quantity: 1000, trace_no: 'TRACE-2' } });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
    expect(buttons('修改数量')).toHaveLength(1);
    await scan('NEXT-ORDINARY');
    expect(applyLabelQuantityCorrection).toHaveBeenCalledTimes(1);
    expect(jest.mocked(submitLabelReprint).mock.calls[1][0]).toMatchObject({ quantity: 250, traceNo: 'TRACE-1' });
  });

  it.each(['', '0', '-1', '1.2', '1.2.3.4', '2e3'])('keeps invalid quantity %j in the dialog without printing', async (value) => {
    await openQuantityDialog();
    await act(async () => { quantityInput().props.onChangeText(value); });
    await act(async () => { buttons('确认打印')[0].props.onPress(); });
    expect(text()).toContain('请输入大于 0 的整数');
    expect(applyLabelQuantityCorrection).not.toHaveBeenCalled();
    expect(submitLabelReprint).not.toHaveBeenCalled();
    expect(root.root.findAllByType(Modal)).toHaveLength(1);
    await act(async () => { quantityInput().props.onChangeText('56'); });
    await act(async () => { buttons('确认打印')[0].props.onPress(); });
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
  });

  it('cancels a draft with no task and rejects a second scan while the first correction prepares', async () => {
    const slowPrepare = defer<LabelReprintTask>();
    jest.mocked(prepareLabelReprint).mockReturnValueOnce(slowPrepare.promise);
    await act(async () => { buttons('修改数量')[0].props.onPress(); });
    await scan('FIRST-CORRECTION');
    await scan('MUST-NOT-PRINT');
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    await act(async () => { slowPrepare.resolve(task('FIRST-CORRECTION')); });
    await scan('ALSO-MUST-NOT-PRINT');
    await act(async () => { buttons('取消')[0].props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(submitLabelReprint).not.toHaveBeenCalled();
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    expect(text()).toContain('等待扫码');
    await scan('NEW-ORDINARY');
    expect(prepareLabelReprint).toHaveBeenCalledTimes(2);
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
  });

  it('retries the already corrected task without applying the trace increment again', async () => {
    jest.mocked(submitLabelReprint).mockImplementationOnce(async (prepared) => ({
      ...prepared, status: 'failed', lastError: '同步助手未连接', retryAllowed: true,
    })).mockImplementationOnce(async (prepared) => ({ ...prepared, status: 'submitted', lastError: '' }));
    await openQuantityDialog();
    await act(async () => { quantityInput().props.onChangeText('40'); });
    await act(async () => { buttons('确认打印')[0].props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findByType(AppModalCard).props.title).toBe('补打标签任务');
    const corrected = jest.mocked(submitLabelReprint).mock.calls[0][0];
    await act(async () => { buttons('核对后重试')[0].props.onPress(); });
    const alert = root.root.findByType('Alert' as unknown as React.ElementType);
    await act(async () => {
      alert.props.buttons.find((button: { text: string }) => button.text === '核对并提交').onPress();
      alert.props.onClose();
    });
    expect(applyLabelQuantityCorrection).toHaveBeenCalledTimes(1);
    expect(jest.mocked(submitLabelReprint).mock.calls[1][0]).toMatchObject({
      id: corrected.id, quantity: 40, traceNo: 'TRACE-2', sourceQr: corrected.sourceQr, record: corrected.record,
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
  });

  it('constrains the real animated button wrappers for the header and quantity modal on a small PDA', async () => {
    const ActualUiToolbarButton = jest.requireActual('@/components/UiRedesign').UiToolbarButton;
    const assertRealButtonBounds = async (props: Record<string, unknown>) => {
      let rendered!: TestRenderer.ReactTestRenderer;
      await act(async () => { rendered = TestRenderer.create(<ActualUiToolbarButton {...props} />); });
      try {
        expect(StyleSheet.flatten(rendered.root.findByType(Animated.View).props.style))
          .toMatchObject({ flex: 1, flexBasis: 0, minWidth: 0 });
        const touchStyle = StyleSheet.flatten(rendered.root.findByType(TouchableOpacity).props.style);
        expect(touchStyle).toMatchObject({ width: '100%', minWidth: 0, justifyContent: 'center' });
        expect(touchStyle.flex).toBeUndefined();
      } finally {
        await act(async () => { rendered.unmount(); });
      }
    };
    const headerActions = buttons('修改数量')[0].parent!;
    expect(StyleSheet.flatten(headerActions.props.style))
      .toMatchObject({ flexDirection: 'row', width: 200, maxWidth: '100%', flexShrink: 0 });
    expect(StyleSheet.flatten(headerActions.props.style).flexWrap).not.toBe('wrap');
    await assertRealButtonBounds(buttons('修改数量')[0].props);
    await assertRealButtonBounds(buttons('打印任务')[0].props);
    await act(async () => { buttons('修改数量')[0].props.onPress(); });
    await scan('TEST-QUANTITY');
    const card = root.root.findByType(AppModalCard);
    const form = card.findByProps({ testID: 'label-quantity-form' });
    expect(form.findAllByType('Button' as unknown as React.ElementType)).toHaveLength(0);
    await assertRealButtonBounds(buttons('取消')[0].props);
    await assertRealButtonBounds(buttons('确认打印')[0].props);
  });

  it('keeps quantity confirmation outside the scroll area when the keyboard reduces the modal viewport', async () => {
    await openQuantityDialog();
    const viewport = root.root.findByProps({ testID: 'label-quantity-viewport' });
    await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height: 240 } } }); });
    const card = root.root.findByType(AppModalCard);
    expect(card.props.style.height).toBe(240);
    expect(card.props.stretchBody).toBe(true);
    const form = card.findByProps({ testID: 'label-quantity-form' });
    expect(StyleSheet.flatten(form.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(form.findAllByType('Button' as unknown as React.ElementType)).toHaveLength(0);
    expect(buttons('取消')).toHaveLength(1);
    expect(buttons('确认打印')).toHaveLength(1);
    await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height: 0 } } }); });
    expect(root.root.findByType(AppModalCard).props.style.height).toBe(240);
  });

  it('consumes one input only once across stability timer and Enter, and allows a deliberate rescan', async () => {
    const raw = ' CH334U,250,TRACE-1 ';
    await act(async () => { scanner().props.onChangeText(raw); });
    await act(async () => { await jest.advanceTimersByTimeAsync(150); });
    await act(async () => { scanner().props.onSubmitEditing({ nativeEvent: { text: raw } }); });
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    expect(prepareLabelReprint).toHaveBeenCalledWith(raw);
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
    expect(scanner().props.value).toBe('');
    await scan(raw);
    expect(prepareLabelReprint).toHaveBeenCalledTimes(2);
    expect(submitLabelReprint).toHaveBeenCalledTimes(2);
  });

  it.each(['\r\n', '\n'])('keeps embedded %j in a streamed QR intact until the final Enter and does not submit a partial line', async ending => {
    const pieces = [
      'SYNTHETIC BRAND/', 'PART NO.:MODEL-X/', 'PACKAGE:DFN8/', 'QUANTITY:250/',
      'LOT ID:TEST-LOT/', 'DATE CODE:2614/', 'MSL3/', 'Track ID:TEST-BOX',
    ];
    const raw = pieces.join(ending);
    const prepared = task('MODEL-X', {
      sourceQr: raw,
      record: { ...task('MODEL-X').record, source_qr: raw },
    });
    jest.mocked(prepareLabelReprint).mockResolvedValueOnce(prepared);
    for (let index = 0; index < pieces.length - 1; index += 1) {
      const partial = pieces.slice(0, index + 1).join(ending) + ending;
      await act(async () => { scanner().props.onChangeText(partial); });
      await act(async () => { await jest.advanceTimersByTimeAsync(149); });
      expect(scanner().props.value).toBe(partial);
      expect(prepareLabelReprint).not.toHaveBeenCalled();
      expect(submitLabelReprint).not.toHaveBeenCalled();
    }
    await act(async () => { scanner().props.onChangeText(raw); });
    await act(async () => { await jest.advanceTimersByTimeAsync(149); });
    expect(prepareLabelReprint).not.toHaveBeenCalled();
    await act(async () => { scanner().props.onSubmitEditing({ nativeEvent: { text: raw } }); });
    await act(async () => { await jest.advanceTimersByTimeAsync(150); });

    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    expect(prepareLabelReprint).toHaveBeenCalledWith(raw);
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
    expect(submitLabelReprint).toHaveBeenCalledWith(prepared, expect.any(Object));
    expect(jest.mocked(submitLabelReprint).mock.calls[0][0].record.source_qr).toBe(raw);
    expect(scanner().props.value).toBe('');
    expect(root.root.findByType('Alert' as unknown as React.ElementType).props.visible).toBe(false);
  });

  it('silently ignores a 1D field scan, creates no task and accepts the next QR normally', async () => {
    jest.mocked(prepareLabelReprint).mockRejectedValueOnce(new IgnoredLabelReprintScan());
    await scan('LX32F003F6P6');
    expect(submitLabelReprint).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
    expect(root.root.findByType('Alert' as unknown as React.ElementType).props.visible).toBe(false);
    expect(text()).toContain('等待扫码');
    expect(text()).not.toContain('LX32F003F6P6');
    expect(scanner().props.value).toBe('');
    expect(scanner().props.processing).toBe(false);
    await scan('CH334U,250,TRACE-1');
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
    expect(text()).toContain('CH334U,250,TRACE-1');
  });

  it('continues to show an unknown structured QR error without printing', async () => {
    jest.mocked(prepareLabelReprint).mockRejectedValueOnce(new Error('未匹配到二维码解析规则'));
    await scan('UNKNOWN/100/LOT');
    expect(submitLabelReprint).not.toHaveBeenCalled();
    const alert = root.root.findByType('Alert' as unknown as React.ElementType);
    expect(alert.props.visible).toBe(true);
    expect(alert.props.message).toBe('未匹配到二维码解析规则');
  });

  it('retries the same task and closes the task modal after submission succeeds', async () => {
    const failed = task('CH334U', { status: 'failed', lastError: '同步助手未连接', retryAllowed: true });
    jest.mocked(submitLabelReprint).mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ ...failed, status: 'submitted', lastError: '' });
    await scan('CH334U');
    expect(root.root.findAllByType(Modal)).toHaveLength(1);
    await act(async () => { buttons('核对后重试')[0].props.onPress(); });
    const alert = root.root.findByType('Alert' as unknown as React.ElementType);
    expect(alert.props.visible).toBe(true);
    await act(async () => {
      alert.props.buttons.find((button: { text: string }) => button.text === '核对并提交').onPress();
      alert.props.onClose();
    });
    expect(submitLabelReprint).toHaveBeenNthCalledWith(2, failed,
      expect.objectContaining({ retryConfirmed: true, shouldContinue: expect.any(Function) }));
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
    expect(text()).toContain('已提交同步助手');
  });

  it('does not offer retry when no matching template exists', async () => {
    jest.mocked(submitLabelReprint).mockResolvedValue(task('CH334U', {
      status: 'failed', lastError: '没有对应模板，本次未打印', errorCode: 'NO_TEMPLATE', retryAllowed: false,
    }));
    await scan('CH334U');
    expect(buttons('核对后重试')).toHaveLength(0);
    expect(text()).toContain('本次未打印');
  });

  it.each([0, 3, 8])('keeps the close action outside the scrollable body with %i task receipts on a small PDA', async (count) => {
    for (let index = 0; index < count; index += 1) {
      await scan(`TASK-${index}`);
    }
    await act(async () => { buttons('打印任务')[0].props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });

    const card = root.root.findByType(AppModalCard);
    const renderedCard = card.findAllByType(View).find((node) =>
      StyleSheet.flatten(node.props.style)?.overflow === 'hidden');
    expect(renderedCard).toBeDefined();
    expect(StyleSheet.flatten(renderedCard!.props.style)?.height).toBeCloseTo(393.6);
    const taskScroll = card.findByProps({ testID: 'label-reprint-task-list' });
    expect(StyleSheet.flatten(taskScroll.props.style)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(taskScroll.props.showsVerticalScrollIndicator).toBe(true);
    expect(taskScroll.findAllByType('Button' as unknown as React.ElementType)
      .filter((node) => node.props.label === '稍后')).toHaveLength(0);
    expect(card.props.stretchBody).toBe(true);
    expect(card.props.bodyStyle).toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(card.findAllByType(ScrollView)).toHaveLength(1);
    expect(buttons('稍后')).toHaveLength(1);
    if (count > 0) {
      expect(taskScroll.findAllByType(Text).filter((node) =>
        typeof node.props.children === 'string' && /^TASK-\d+$/.test(node.props.children)))
        .toHaveLength(count);
    } else {
      expect(text()).toContain('暂无补打任务');
    }
    const submitCount = jest.mocked(submitLabelReprint).mock.calls.length;
    await act(async () => { buttons('稍后')[0].props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
    expect(submitLabelReprint).toHaveBeenCalledTimes(submitCount);
  });

  it('shrinks the card to the visible modal viewport while leaving the footer outside the task list', async () => {
    await act(async () => { buttons('打印任务')[0].props.onPress(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    const viewport = root.root.findByProps({ testID: 'label-reprint-task-viewport' });
    await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height: 300 } } }); });
    expect(root.root.findByType(AppModalCard).props.style).toEqual({ height: 300 });
    expect(buttons('稍后')).toHaveLength(1);
    await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height: 436 } } }); });
    expect(root.root.findByType(AppModalCard).props.style.height).toBeCloseTo(393.6);

    // A zero-height transient layout must not hide the controls while the modal mounts.
    await act(async () => { viewport.props.onLayout({ nativeEvent: { layout: { height: 0 } } }); });
    expect(root.root.findByType(AppModalCard).props.style.height).toBeCloseTo(393.6);
    windowDimensionsSpy.mockReturnValue({ width: 320, height: 240, scale: 1, fontScale: 1 });
    await act(async () => { root.update(<LabelReprintScreen />); });
    // The safe-area padding also bounds the card before the next native layout event arrives.
    expect(root.root.findByType(AppModalCard).props.style.height)
      .toBe(240 - Math.max(Spacing.md, 24) - Math.max(Spacing.md, 20));
  });

  it('clears all visit state and rejects old prepare results after leaving and returning', async () => {
    const oldPrepare = defer<LabelReprintTask>();
    const currentSubmit = defer<LabelReprintTask>();
    jest.mocked(prepareLabelReprint).mockReturnValueOnce(oldPrepare.promise)
      .mockResolvedValueOnce(task('NEW-TASK'));
    jest.mocked(submitLabelReprint).mockReturnValueOnce(currentSubmit.promise);
    await scan('OLD-TASK');
    await act(async () => { mockBlur?.(); mockBlur = mockFocus?.(); });
    expect(text()).toContain('等待扫码');
    await scan('NEW-TASK');
    expect(scanner().props.processing).toBe(true);
    await act(async () => { oldPrepare.resolve(task('OLD-TASK')); });
    expect(submitLabelReprint).toHaveBeenCalledTimes(1);
    expect(scanner().props.processing).toBe(true);
    expect(text()).not.toContain('OLD-TASK');
    await act(async () => { currentSubmit.resolve(task('NEW-TASK', { status: 'submitted' })); });
    expect(text()).toContain('NEW-TASK');
    await act(async () => { mockBlur?.(); mockBlur = mockFocus?.(); });
    expect(text()).toContain('等待扫码');
    expect(text()).not.toContain('NEW-TASK');
  });

  it('queues scans in memory, pauses at a failure modal, and discards queued scans on exit', async () => {
    const firstSubmit = defer<LabelReprintTask>();
    jest.mocked(submitLabelReprint).mockReturnValueOnce(firstSubmit.promise);
    await scan('FIRST');
    await scan('SECOND');
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    await act(async () => { firstSubmit.resolve(task('FIRST', { status: 'failed', retryAllowed: true })); });
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    await scan('WHILE-MODAL');
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    await act(async () => { mockBlur?.(); mockBlur = mockFocus?.(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(500); });
    expect(prepareLabelReprint).toHaveBeenCalledTimes(1);
    expect(text()).toContain('等待扫码');
  });

  it('aborts an old submission and ignores its late receipt while the new visit remains busy', async () => {
    const oldSubmission = defer<LabelReprintTask>();
    const newSubmission = defer<LabelReprintTask>();
    jest.mocked(submitLabelReprint).mockReturnValueOnce(oldSubmission.promise)
      .mockReturnValueOnce(newSubmission.promise);
    await scan('OLD-SUBMIT');
    const oldOptions = jest.mocked(submitLabelReprint).mock.calls[0][1];
    await act(async () => { mockBlur?.(); mockBlur = mockFocus?.(); });
    expect(oldOptions?.signal?.aborted).toBe(true);
    expect(oldOptions?.shouldContinue?.()).toBe(false);
    await scan('NEW-SUBMIT');
    await act(async () => { oldSubmission.resolve(task('OLD-SUBMIT', { status: 'failed', retryAllowed: true })); });
    expect(scanner().props.processing).toBe(true);
    await act(async () => { await jest.advanceTimersByTimeAsync(220); });
    expect(root.root.findAllByType(Modal)).toHaveLength(0);
    expect(text()).not.toContain('OLD-SUBMIT');
    await act(async () => { newSubmission.resolve(task('NEW-SUBMIT', { status: 'submitted' })); });
    expect(text()).toContain('NEW-SUBMIT');
    expect(scanner().props.processing).toBe(false);
  });
});
