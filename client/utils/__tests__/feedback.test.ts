import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import {
  feedbackInboundStart,
  feedbackSuccess,
  feedbackQuerySuccess,
  feedbackQueryFailed,
  feedbackNotBound,
  feedbackClear,
  feedbackClearFailed,
  feedbackUnpackRequired,
  feedbackUnpackComplete,
  feedbackOutboundOrderComplete,
  setSoundEnabled,
} from '@/utils/feedback';

jest.mock('expo-haptics', () => ({
  AndroidHaptics: {
    Confirm: 'confirm',
    Context_Click: 'context-click',
    Reject: 'reject',
  },
  NotificationFeedbackType: {
    Error: 'error',
    Success: 'success',
    Warning: 'warning',
  },
  notificationAsync: jest.fn(async () => undefined),
  performAndroidHapticsAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-speech', () => ({
  getAvailableVoicesAsync: jest.fn(async () => []),
  speak: jest.fn((_text: string, options?: Record<string, () => void>) => {
    options?.onStart?.();
    options?.onDone?.();
  }),
  stop: jest.fn(async () => undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => 'true'),
  setItem: jest.fn(async () => undefined),
}));

describe('feedback speech scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSoundEnabled(true);
    jest.clearAllMocks();
  });

  it('keeps normal scan speech smooth and replaces it for inbound navigation', async () => {
    await feedbackSuccess();

    expect(Speech.stop).not.toHaveBeenCalled();
    expect(Speech.speak).toHaveBeenCalledWith(
      '扫码成功',
      expect.objectContaining({
        language: 'zh-CN',
        pitch: 1,
        rate: 1,
      })
    );

    await feedbackSuccess();
    expect(Speech.speak).toHaveBeenCalledTimes(2);

    await feedbackInboundStart();

    expect(Speech.stop).toHaveBeenCalledTimes(1);
    expect(Speech.speak).toHaveBeenLastCalledWith(
      '开始入库',
      expect.objectContaining({
        language: 'zh-CN',
      })
    );
    expect(
      (Haptics.performAndroidHapticsAsync as jest.Mock).mock.calls.length +
        (Haptics.notificationAsync as jest.Mock).mock.calls.length
    ).toBeGreaterThan(0);
  });

  it('speaks each query success and the specific query and clear outcomes', async () => {
    await feedbackQuerySuccess();
    await feedbackQuerySuccess();
    expect(Speech.speak).toHaveBeenCalledTimes(2);
    expect(Speech.stop).not.toHaveBeenCalled();
    await feedbackNotBound();
    await feedbackQueryFailed();
    await feedbackClear();
    await feedbackClearFailed();
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '查询成功', '查询成功', '未绑定', '查询失败', '已清空', '清空失败',
    ]);
  });

  it('announces every unpack stage without stopping or deduplicating scan feedback', async () => {
    await feedbackSuccess();
    await feedbackUnpackRequired();
    await feedbackUnpackComplete();
    await feedbackUnpackRequired();
    await feedbackUnpackComplete();
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '扫码成功', '需要拆包', '拆包完成', '需要拆包', '拆包完成',
    ]);
    expect(Speech.stop).not.toHaveBeenCalled();
  });

  it('announces a completed outbound order with one clear priority message', async () => {
    await feedbackOutboundOrderComplete();
    await feedbackOutboundOrderComplete(true);

    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '本单已扫完，可扫描下一单',
      '拆包完成，本单已扫完',
    ]);
    expect(Speech.stop).toHaveBeenCalledTimes(2);
  });

  it('respects the sound switch for query, clear and unpack announcements', async () => {
    setSoundEnabled(false);
    await feedbackQuerySuccess();
    await feedbackQueryFailed();
    await feedbackClear();
    await feedbackClearFailed();
    await feedbackUnpackRequired();
    await feedbackUnpackComplete();
    await feedbackOutboundOrderComplete();
    expect(Speech.speak).not.toHaveBeenCalled();
  });
});
