import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import {
  feedbackInboundStart,
  feedbackInboundComplete,
  feedbackSuccess,
  feedbackQuerySuccess,
  feedbackQueryFailed,
  feedbackNotBound,
  feedbackClear,
  feedbackClearFailed,
  feedbackUnpackRequired,
  feedbackUnpackComplete,
  feedbackOutboundOrderComplete,
  feedbackOutboundOrderReady,
  feedbackSalesReturnOrderReady,
  feedbackSalesReturnSaved,
  feedbackError,
  feedbackWarning,
  feedbackNewOrder,
  feedbackSwitchOrder,
  feedbackConfirm,
  feedbackCancel,
  feedbackDeleted,
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
      '成功',
      expect.objectContaining({
        language: 'zh-CN',
        pitch: 1,
        rate: 1.3,
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
        rate: 1,
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
    expect(jest.mocked(Speech.speak).mock.calls.map(([, options]) => options?.rate)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('announces every unpack stage without stopping or deduplicating scan feedback', async () => {
    await feedbackSuccess();
    await feedbackUnpackRequired();
    await feedbackUnpackComplete();
    await feedbackUnpackRequired();
    await feedbackUnpackComplete();
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '成功', '需要拆包', '拆包完成', '需要拆包', '拆包完成',
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

  it('distinguishes restored order states while retaining legacy order feedback', async () => {
    await feedbackOutboundOrderReady('loaded');
    await feedbackOutboundOrderReady('switched');
    await feedbackOutboundOrderReady('current');
    await feedbackOutboundOrderReady('complete');
    await feedbackOutboundOrderReady('verifying');
    await feedbackNewOrder();
    await feedbackSwitchOrder();

    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '订单已载入', '切换订单', '当前订单，请继续扫码', '本单已扫完', '订单正在核验，请稍候',
      '新订单', '切换订单',
    ]);
    expect(Speech.stop).toHaveBeenCalledTimes(7);
  });

  it('only speaks errors and warnings when their callers supply a message', async () => {
    await feedbackError();
    await feedbackWarning();
    expect(Speech.speak).not.toHaveBeenCalled();
    expect(Speech.stop).not.toHaveBeenCalled();

    await feedbackError('保存失败，请重扫');
    await feedbackWarning('请先扫描订单');
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '保存失败，请重扫', '请先扫描订单',
    ]);
    expect(Speech.stop).toHaveBeenCalledTimes(2);
  });

  it('speaks the order status and archive warehouse as a single utterance', async () => {
    await feedbackOutboundOrderReady('loaded', '苏州仓库');
    await feedbackOutboundOrderReady('switched', 'B仓');
    await feedbackSalesReturnOrderReady('complete', 'B仓');

    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '订单已载入，苏州仓库', '切换订单，B仓', '本单退货已收齐，B仓',
    ]);
  });

  it('uses dedicated return messages and announces a completed save only once', async () => {
    await feedbackSalesReturnOrderReady('loaded');
    await feedbackSalesReturnOrderReady('switched');
    await feedbackSalesReturnOrderReady('current');
    await feedbackSalesReturnOrderReady('complete');
    await feedbackSalesReturnSaved();
    await feedbackSalesReturnSaved(true);
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '销售退货单已载入', '切换退货单', '当前退货单，请继续扫码', '本单退货已收齐',
      '成功', '本单退货已收齐',
    ]);
    expect(jest.mocked(Speech.speak).mock.calls.map(([, options]) => options?.rate)).toEqual([1, 1, 1, 1, 1.3, 1]);
    expect(Speech.stop).toHaveBeenCalledTimes(5);
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
    await feedbackOutboundOrderReady('complete');
    await feedbackSalesReturnOrderReady('complete');
    await feedbackSalesReturnSaved(true);
    await feedbackError('保存失败，请重扫');
    await feedbackWarning('请先扫描订单');
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('uses the same sound switch for dialog actions and completed deletion', async () => {
    setSoundEnabled(false);
    await feedbackConfirm();
    await feedbackCancel();
    await feedbackDeleted();
    expect(Speech.speak).not.toHaveBeenCalled();

    setSoundEnabled(true);
    await feedbackCancel();
    await feedbackConfirm();
    await feedbackDeleted();
    expect(jest.mocked(Speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '已取消', '确认', '已删除',
    ]);
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

describe('feedback with delayed native operations', () => {
  let feedback: typeof import('@/utils/feedback');
  let speech: typeof import('expo-speech');
  let haptics: typeof import('expo-haptics');

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    feedback = require('@/utils/feedback');
    speech = require('expo-speech');
    haptics = require('expo-haptics');
    feedback.setSoundEnabled(true);
  });

  afterEach(async () => {
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  });

  it('does not announce an old success when its vibration finishes after a new error', async () => {
    const vibration = deferred<void>();
    jest.mocked(haptics.notificationAsync).mockImplementationOnce(() => vibration.promise);
    jest.mocked(haptics.performAndroidHapticsAsync).mockImplementationOnce(() => vibration.promise);

    const oldSuccess = feedback.feedbackSuccess();
    const error = feedback.feedbackError('保存失败，请重扫');
    await jest.runAllTimersAsync();
    await error;
    vibration.resolve();
    await oldSuccess;

    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual(['保存失败，请重扫']);
  });

  it('cancels an old success that is still waiting for the speech engine to warm up', async () => {
    const voices = deferred<Speech.Voice[]>();
    jest.mocked(speech.getAvailableVoicesAsync).mockImplementationOnce(() => voices.promise);
    const oldSuccess = feedback.feedbackSuccess();
    await Promise.resolve();
    expect(speech.getAvailableVoicesAsync).toHaveBeenCalledTimes(1);

    const warning = feedback.feedbackWarning('请先扫描订单');
    voices.resolve([]);
    await jest.runAllTimersAsync();
    await Promise.all([oldSuccess, warning]);

    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual(['请先扫描订单']);
  });

  it('serializes delayed stops and keeps only the latest competing priority event', async () => {
    const firstStop = deferred<void>();
    jest.mocked(speech.stop).mockImplementationOnce(() => firstStop.promise);
    const firstOrder = feedback.feedbackOutboundOrderReady('loaded');
    await Promise.resolve();
    expect(speech.stop).toHaveBeenCalledTimes(1);

    const secondOrder = feedback.feedbackOutboundOrderReady('switched');
    const latestError = feedback.feedbackError('订单加载失败');
    await jest.runAllTimersAsync();
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(speech.speak).not.toHaveBeenCalled();

    firstStop.resolve();
    await jest.runAllTimersAsync();
    await Promise.all([firstOrder, secondOrder, latestError]);
    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual(['订单加载失败']);
    expect(speech.stop).toHaveBeenCalledTimes(3);
  });

  it('bounds queued successes and clears the pending success when a later scan fails', async () => {
    const nativeQueue: string[] = [];
    jest.mocked(speech.speak).mockImplementation((text, options) => {
      nativeQueue.push(text);
      options?.onStart?.();
    });
    jest.mocked(speech.stop).mockImplementation(async () => { nativeQueue.length = 0; });

    const first = feedback.feedbackSuccess();
    const second = feedback.feedbackSuccess();
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all([first, second]);
    expect(nativeQueue).toEqual(['成功']);

    const error = feedback.feedbackError('保存失败，请重扫');
    await jest.runAllTimersAsync();
    await error;
    expect(nativeQueue).toEqual(['保存失败，请重扫']);
  });

  it('coalesces a fast batch into one active and one pending success while vibrating for every saved pack', async () => {
    const done: (() => void)[] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      done.push(() => options?.onDone?.());
    });
    const saves = Array.from({ length: 40 }, (_, index) => index % 2
      ? feedback.feedbackSalesReturnSaved(false) : feedback.feedbackSuccess());
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(jest.mocked(haptics.notificationAsync).mock.calls.length +
      jest.mocked(haptics.performAndroidHapticsAsync).mock.calls.length).toBe(40);
    expect(speech.stop).not.toHaveBeenCalled();

    // The caller's wait can expire while the native playback slot remains occupied.
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all(saves);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    done[0]();
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    done[1]();
    await jest.runAllTimersAsync();
    expect(speech.speak).toHaveBeenCalledTimes(2);
    expect(speech.stop).not.toHaveBeenCalled();
    expect(jest.mocked(speech.speak).mock.calls.map(([text, options]) => [text, options?.rate]))
      .toEqual([['成功', 1.3], ['成功', 1.3]]);
  });

  it('recovers a missing native completion after stopping the old playback and ignores its late callbacks', async () => {
    const stop = deferred<void>();
    const callbacks: Parameters<typeof speech.speak>[1][] = [];
    jest.mocked(speech.stop).mockReturnValueOnce(stop.promise);
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      callbacks.push(options);
    });

    void feedback.feedbackSuccess();
    void feedback.feedbackSuccess();
    await jest.advanceTimersByTimeAsync(4900);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.stop).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(600);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    stop.resolve(undefined);
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    void feedback.feedbackSuccess();
    callbacks[0]?.onDone?.();
    callbacks[0]?.onStopped?.();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    callbacks[1]?.onDone?.();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(3);
    callbacks[2]?.onDone?.();
    await jest.advanceTimersByTimeAsync(5500);
    expect(speech.stop).toHaveBeenCalledTimes(1);
  });

  it('reserves a playback slot during slow warmup instead of submitting every saved pack afterward', async () => {
    const voices = deferred<Speech.Voice[]>();
    const done: (() => void)[] = [];
    jest.mocked(speech.getAvailableVoicesAsync).mockImplementationOnce(() => voices.promise);
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      done.push(() => options?.onDone?.());
    });
    const saves = Array.from({ length: 20 }, () => feedback.feedbackSuccess());
    await jest.advanceTimersByTimeAsync(8000);
    await Promise.all(saves);
    expect(speech.speak).not.toHaveBeenCalled();
    voices.resolve([]);
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    done[0]();
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    done[1]();
  });

  it('waits for an already-playing order completion before stopping a stalled success', async () => {
    const recoveryStop = deferred<void>();
    jest.mocked(speech.stop).mockResolvedValueOnce(undefined).mockReturnValueOnce(recoveryStop.promise);
    const callbacks: Parameters<typeof speech.speak>[1][] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      callbacks.push(options);
    });
    void feedback.feedbackOutboundOrderComplete();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    void feedback.feedbackSuccess();
    void feedback.feedbackSuccess();
    void feedback.feedbackOutboundOrderReady('loaded');
    await jest.advanceTimersByTimeAsync(5500);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    expect(speech.stop).toHaveBeenCalledTimes(1);

    callbacks[0]?.onDone?.();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.stop).toHaveBeenCalledTimes(2);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    recoveryStop.resolve(undefined);
    await jest.advanceTimersByTimeAsync(500);
    expect(jest.mocked(speech.speak).mock.calls.slice(2).map(([text]) => text).sort())
      .toEqual(['成功', '订单已载入'].sort());
    callbacks[2]?.onDone?.();
    callbacks[3]?.onDone?.();
  });

  it('clears pending scan speech on a native submission failure and accepts a later fresh success', async () => {
    jest.mocked(speech.speak).mockImplementationOnce(() => { throw new Error('TTS unavailable'); });
    const saves = Array.from({ length: 10 }, () => feedback.feedbackSuccess());
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all(saves);
    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    const fresh = feedback.feedbackSuccess();
    await jest.runAllTimersAsync();
    await fresh;
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it.each(['done', 'stopped', 'error'] as const)('releases the scan slot on native %s and ignores a repeated old callback', async outcome => {
    const end: (() => void)[] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      end.push(() => {
        if (outcome === 'done') options?.onDone?.();
        else if (outcome === 'stopped') options?.onStopped?.();
        else options?.onError?.(new Error('native TTS error'));
      });
    });
    void feedback.feedbackSuccess();
    void feedback.feedbackSuccess();
    await jest.advanceTimersByTimeAsync(200);
    end[0]();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    void feedback.feedbackSuccess();
    end[0]();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(2);
    end[1]();
    await jest.advanceTimersByTimeAsync(500);
    expect(speech.speak).toHaveBeenCalledTimes(3);
    end[2]();
  });

  it.each(['error', 'warning', 'complete', 'order', 'sound-off', 'inactive', 'cleanup'] as const)(
    'discards old active and pending successes on %s without reviving them on late native callbacks',
    async outcome => {
      const done: (() => void)[] = [];
      jest.mocked(speech.speak).mockImplementation((_text, options) => {
        options?.onStart?.();
        done.push(() => options?.onDone?.());
      });
      const oldSaves = [feedback.feedbackSuccess(), feedback.feedbackSuccess(), feedback.feedbackSuccess()];
      await jest.advanceTimersByTimeAsync(200);
      const replacement = outcome === 'error' ? feedback.feedbackError('保存失败，请重扫')
        : outcome === 'warning' ? feedback.feedbackWarning('请先核对')
        : outcome === 'complete' ? feedback.feedbackOutboundOrderComplete()
        : outcome === 'order' ? feedback.feedbackOutboundOrderReady('switched')
        : outcome === 'inactive' ? feedback.pauseFeedbackForAppInactive()
        : outcome === 'cleanup' ? feedback.cleanupSounds()
        : feedback.setSoundEnabled(false);
      await jest.advanceTimersByTimeAsync(3000);
      await Promise.all([...oldSaves, replacement]);
      expect(speech.stop).toHaveBeenCalledTimes(1);
      done[0]();
      done[0]();
      await jest.advanceTimersByTimeAsync(500);
      expect(jest.mocked(speech.speak).mock.calls.filter(([text]) => text === '成功')).toHaveLength(1);
      done.slice(1).forEach(finish => finish());
    }
  );

  it('announces a new event even when it has the same wording as the current priority speech', async () => {
    jest.mocked(speech.speak).mockImplementation((_text, options) => { options?.onStart?.(); });
    const first = feedback.feedbackOutboundOrderReady('current');
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    const second = feedback.feedbackOutboundOrderReady('current');
    await jest.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '当前订单，请继续扫码', '当前订单，请继续扫码',
    ]);
    expect(speech.stop).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'lets an active completion finish before announcing the next completed order (from scan: %s)',
    async (fromMaterialScan) => {
      const done: (() => void)[] = [];
      jest.mocked(speech.speak).mockImplementation((_text, options) => {
        options?.onStart?.();
        done.push(() => options?.onDone?.());
      });

      const first = fromMaterialScan
        ? feedback.feedbackOutboundOrderComplete()
        : feedback.feedbackOutboundOrderReady('complete');
      await jest.advanceTimersByTimeAsync(200);
      const second = feedback.feedbackOutboundOrderReady('complete');
      // 即使普通反馈 Promise 超时，只要原生还没结束，第二单也不能截断第一句。
      await jest.advanceTimersByTimeAsync(3000);
      expect(speech.stop).toHaveBeenCalledTimes(1);
      expect(speech.speak).toHaveBeenCalledTimes(1);

      done[0]();
      await jest.advanceTimersByTimeAsync(200);
      expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
        fromMaterialScan ? '本单已扫完，可扫描下一单' : '本单已扫完', '本单已扫完',
      ]);
      expect(speech.stop).toHaveBeenCalledTimes(1);
      done[1]();
      await Promise.all([first, second]);
    }
  );

  it('still interrupts completion immediately for an error and discards the waiting order notice', async () => {
    const done: (() => void)[] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      done.push(() => options?.onDone?.());
    });
    const first = feedback.feedbackOutboundOrderReady('complete');
    await jest.advanceTimersByTimeAsync(200);
    const nextOrder = feedback.feedbackOutboundOrderReady('complete');
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    const error = feedback.feedbackError('订单加载失败');
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.stop).toHaveBeenCalledTimes(2);
    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '本单已扫完', '订单加载失败',
    ]);
    done.forEach((finish) => finish());
    await jest.runAllTimersAsync();
    await Promise.all([first, nextOrder, error]);
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it('keeps only the latest order notice while a completed order announcement is playing', async () => {
    const done: (() => void)[] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      done.push(() => options?.onDone?.());
    });
    const first = feedback.feedbackOutboundOrderReady('complete');
    await jest.advanceTimersByTimeAsync(200);
    const obsolete = feedback.feedbackOutboundOrderReady('complete');
    const latest = feedback.feedbackOutboundOrderReady('current');
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.speak).toHaveBeenCalledTimes(1);

    done[0]();
    await jest.advanceTimersByTimeAsync(200);
    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '本单已扫完', '当前订单，请继续扫码',
    ]);
    expect(speech.stop).toHaveBeenCalledTimes(1);
    done[1]();
    await Promise.all([first, obsolete, latest]);
  });

  it('cancels waiting feedback when the app goes inactive', async () => {
    const voices = deferred<Speech.Voice[]>();
    jest.mocked(speech.getAvailableVoicesAsync).mockImplementationOnce(() => voices.promise);
    const success = feedback.feedbackSuccess();
    await Promise.resolve();
    const paused = feedback.pauseFeedbackForAppInactive();
    voices.resolve([]);
    await jest.runAllTimersAsync();
    await Promise.all([success, paused]);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'protects return completion until native onDone before the next order (from save: %s)',
    async (fromSaved) => {
      const done: (() => void)[] = [];
      jest.mocked(speech.speak).mockImplementation((_text, options) => {
        options?.onStart?.();
        done.push(() => options?.onDone?.());
      });
      const first = fromSaved
        ? feedback.feedbackSalesReturnSaved(true)
        : feedback.feedbackSalesReturnOrderReady('complete');
      await jest.advanceTimersByTimeAsync(200);
      const nextOrder = feedback.feedbackOutboundOrderReady('loaded');
      await jest.advanceTimersByTimeAsync(3000);
      expect(speech.stop).toHaveBeenCalledTimes(1);
      expect(speech.speak).toHaveBeenCalledTimes(1);
      done[0]();
      await jest.advanceTimersByTimeAsync(200);
      expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
        '本单退货已收齐', '订单已载入',
      ]);
      expect(speech.stop).toHaveBeenCalledTimes(1);
      done[1]();
      await Promise.all([first, nextOrder]);
    }
  );

  it('lets an error interrupt return completion and cancels its waiting switch notice', async () => {
    const done: (() => void)[] = [];
    jest.mocked(speech.speak).mockImplementation((_text, options) => {
      options?.onStart?.();
      done.push(() => options?.onDone?.());
    });
    const first = feedback.feedbackSalesReturnSaved(true);
    await jest.advanceTimersByTimeAsync(200);
    const next = feedback.feedbackSalesReturnOrderReady('switched');
    await jest.advanceTimersByTimeAsync(200);
    const error = feedback.feedbackError('退货保存失败，请重扫');
    await jest.advanceTimersByTimeAsync(200);
    expect(speech.stop).toHaveBeenCalledTimes(2);
    expect(jest.mocked(speech.speak).mock.calls.map(([text]) => text)).toEqual([
      '本单退货已收齐', '退货保存失败，请重扫',
    ]);
    done.forEach(finish => finish());
    await jest.runAllTimersAsync();
    await Promise.all([first, next, error]);
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });
});


it.each([
  [true, '本单已入库完成'],
  [false, '本次入库已保存，本单尚未完成'],
] as const)('announces the saved inbound result once (complete=%s)', async (complete, message) => {
  setSoundEnabled(true);
  jest.clearAllMocks();
  await feedbackInboundComplete(complete);
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith(message, expect.any(Object));
});
