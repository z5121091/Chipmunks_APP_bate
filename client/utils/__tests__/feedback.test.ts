import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import {
  feedbackInboundStart,
  feedbackSuccess,
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
});
