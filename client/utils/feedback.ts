/**
 * 扫码反馈工具
 * 提供震动反馈和中文语音播报
 */

import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { STORAGE_KEYS } from '@/constants/config';
import { logger } from './logger';

// 声音开关状态缓存（同步访问）
let soundEnabled: boolean = true;
let speechSessionGeneration = 0;
let speechReadyAt = 0;
let lastSpeechStartedAt = 0;
let speechWarmupPromise: Promise<void> | null = null;
let speechResetPromise: Promise<void> = Promise.resolve();
let latestOrderReadyRequest = 0;
type SpeechMode = 'enqueue' | 'replace' | 'order-ready';
type ActiveCompletionSpeech = { finished: Promise<void>; finish: () => void };
let activeCompletionSpeech: ActiveCompletionSpeech | null = null;

const SPEECH_MIN_INTERVAL_MS = 120;
const SPEECH_STOP_SETTLE_MS = Platform.OS === 'android' ? 120 : 40;
const SPEECH_RESUME_SETTLE_MS = Platform.OS === 'android' ? 350 : 120;
const SPEECH_FINISH_TIMEOUT_MS = 2500;
const COMPLETION_CALLBACK_TIMEOUT_MS = 10000;
const isWebPlatform = Platform.OS === 'web';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getAndroidHapticType = (type: Haptics.NotificationFeedbackType): Haptics.AndroidHaptics => {
  switch (type) {
    case Haptics.NotificationFeedbackType.Success:
      return Haptics.AndroidHaptics.Confirm;
    case Haptics.NotificationFeedbackType.Error:
      return Haptics.AndroidHaptics.Reject;
    case Haptics.NotificationFeedbackType.Warning:
    default:
      return Haptics.AndroidHaptics.Context_Click;
  }
};

const performNotificationHaptic = async (type: Haptics.NotificationFeedbackType): Promise<void> => {
  if (Platform.OS === 'android') {
    await Haptics.performAndroidHapticsAsync(getAndroidHapticType(type));
    return;
  }

  await Haptics.notificationAsync(type);
};

const waitForSpeechReady = async (): Promise<void> => {
  const waitMs = speechReadyAt - Date.now();
  if (waitMs > 0) {
    await delay(waitMs);
  }

  const sinceLastSpeech = Date.now() - lastSpeechStartedAt;
  if (sinceLastSpeech < SPEECH_MIN_INTERVAL_MS) {
    await delay(SPEECH_MIN_INTERVAL_MS - sinceLastSpeech);
  }
};

const resetSpeechSession = (
  reason: string,
  settleMs = SPEECH_STOP_SETTLE_MS
): Promise<void> => {
  if (isWebPlatform) {
    return Promise.resolve();
  }

  // 串行停止，避免较早的异步 stop 在新提示开始后才返回。
  speechResetPromise = speechResetPromise.then(async () => {
    try {
      await Speech.stop();
    } catch (error) {
      logger.warn(`[Feedback] 停止语音失败(${reason}):`, error);
    }

    speechReadyAt = Math.max(speechReadyAt, Date.now() + settleMs);
  });
  return speechResetPromise;
};

const warmupSpeechEngine = (reason: string): Promise<void> => {
  if (isWebPlatform || !soundEnabled) {
    return Promise.resolve();
  }

  if (!speechWarmupPromise) {
    speechWarmupPromise = Speech.getAvailableVoicesAsync()
      .then(() => undefined)
      .catch((error) => {
        speechWarmupPromise = null;
        logger.warn(`[Feedback] 预热语音引擎失败(${reason}):`, error);
      });
  }

  return speechWarmupPromise;
};

const cancelSpeechSession = (
  reason: string,
  settleMs = SPEECH_STOP_SETTLE_MS
): Promise<void> => {
  speechSessionGeneration += 1;
  activeCompletionSpeech?.finish();
  return resetSpeechSession(reason, settleMs);
};

const trackCompletionPlayback = (): ActiveCompletionSpeech => {
  // 以原生 onStart/onDone 为准，不能把反馈 Promise 的 2.5 秒超时当成语音播放结束。
  activeCompletionSpeech?.finish();
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const playback: ActiveCompletionSpeech = {
    finished,
    finish: () => {
      clearTimeout(timeout);
      if (activeCompletionSpeech === playback) activeCompletionSpeech = null;
      resolveFinished();
    },
  };
  // 原生回调丢失时解除等待；接续提示仍采用 enqueue，不会主动截断正在播放的语音。
  const timeout = setTimeout(playback.finish, COMPLETION_CALLBACK_TIMEOUT_MS);
  activeCompletionSpeech = playback;
  return playback;
};

/**
 * 初始化声音开关状态
 */
export async function initSoundSetting() {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED);
    soundEnabled = value !== 'false';
    logger.log('[Feedback] 声音开关状态:', soundEnabled);
    if (soundEnabled) {
      void warmupSpeechEngine('sound-setting');
    }
  } catch {
    soundEnabled = true;
    void warmupSpeechEngine('sound-setting-fallback');
  }
}

/**
 * 设置声音开关状态（设置页面调用）
 */
export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  AsyncStorage.setItem(STORAGE_KEYS.SOUND_ENABLED, String(enabled)).catch(logger.error);
  if (!enabled && !isWebPlatform) {
    void cancelSpeechSession('sound-disabled');
  }
  logger.log('[Feedback] 设置声音开关:', enabled);
}

/**
 * 获取声音开关状态
 */
export function isSoundEnabled(): boolean {
  return soundEnabled;
}

/**
 * 播放中文语音
 */
async function speakChinese(
  text: string,
  mode: SpeechMode = 'enqueue',
  isOrderCompletion = false
) {
  if (!soundEnabled) {
    logger.log('[Feedback] 声音已关闭，跳过语音');
    return;
  }

  if (isWebPlatform) {
    logger.log('[Feedback] Web 预览跳过语音:', text);
    return;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }

  const orderReadyRequest = mode === 'order-ready' ? ++latestOrderReadyRequest : null;
  const precedingCompletion = mode === 'order-ready' ? activeCompletionSpeech : null;
  // 只保护已经开始播放的本单完成提示；其它优先事件仍立即停止旧语音。
  const shouldReplace = mode === 'replace' || (mode === 'order-ready' && !precedingCompletion);
  const resetPromise = shouldReplace
    ? cancelSpeechSession(`priority:${normalizedText}`)
    : speechResetPromise;
  const generation = speechSessionGeneration;
  try {
    await resetPromise;
    if (precedingCompletion) {
      await precedingCompletion.finished;
      if (orderReadyRequest !== latestOrderReadyRequest) return;
    }
    if (!soundEnabled || generation !== speechSessionGeneration) {
      return;
    }

    await warmupSpeechEngine('before-speak');
    await waitForSpeechReady();
    if (!soundEnabled || generation !== speechSessionGeneration) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let completionPlayback: ActiveCompletionSpeech | null = null;
      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const finishPlayback = () => {
        completionPlayback?.finish();
        resolveOnce();
      };
      const timeoutId = setTimeout(resolveOnce, SPEECH_FINISH_TIMEOUT_MS);

      Speech.speak(normalizedText, {
        language: 'zh-CN',
        pitch: 1.0,
        rate: 1.0,
        onStart: () => {
          if (generation === speechSessionGeneration) {
            lastSpeechStartedAt = Date.now();
            if (isOrderCompletion) completionPlayback = trackCompletionPlayback();
          }
        },
        onDone: finishPlayback,
        onStopped: finishPlayback,
        onError: (error) => {
          logger.error('播放语音失败:', error);
          speechReadyAt = Math.max(speechReadyAt, Date.now() + SPEECH_RESUME_SETTLE_MS);
          finishPlayback();
        },
      });
    });

    if (generation === speechSessionGeneration) {
      logger.log('[Feedback] 播放语音:', normalizedText);
    }
  } catch (error) {
    logger.error('播放语音失败:', error);
    if (generation === speechSessionGeneration) {
      await resetSpeechSession('speak-error', SPEECH_RESUME_SETTLE_MS);
      await warmupSpeechEngine('speak-error');
    }
  }
}

const notifyWithSpeech = async (
  text: string,
  type: Haptics.NotificationFeedbackType,
  mode: SpeechMode = 'enqueue',
  isOrderCompletion = false
): Promise<void> => {
  // 语音先登记，震动独立执行；慢震动不能让旧成功提示越过新的错误提示。
  const speech = speakChinese(text, mode, isOrderCompletion);
  try {
    await performNotificationHaptic(type);
  } catch (error) {
    logger.error('[Feedback] 震动失败:', error);
  }
  await speech;
};

/**
 * 扫码成功反馈 - 震动 + "扫码成功"语音
 */
export async function feedbackSuccess() {
  logger.log('[Feedback] feedbackSuccess 触发');
  await notifyWithSpeech('扫码成功', Haptics.NotificationFeedbackType.Success);
}

/**
 * 扫码重复反馈 - 震动一次 + "扫码重复"语音
 */
export async function feedbackDuplicate() {
  logger.log('[Feedback] feedbackDuplicate 触发');
  await notifyWithSpeech('扫码重复', Haptics.NotificationFeedbackType.Error, 'replace');
}

/**
 * 确认反馈 - 只播放"确认"语音，不震动
 */
export async function feedbackConfirm() {
  logger.log('[Feedback] feedbackConfirm 触发');
  await speakChinese('确认', 'replace');
}

export async function feedbackCancel() {
  await speakChinese('已取消', 'replace');
}

export async function feedbackDeleted() {
  await speakChinese('已删除', 'replace');
}

/**
 * 进入采购入库扫码反馈 - 震动 + "开始入库"语音
 */
export async function feedbackInboundStart() {
  logger.log('[Feedback] feedbackInboundStart 触发');
  await notifyWithSpeech('开始入库', Haptics.NotificationFeedbackType.Success, 'replace');
}

/**
 * 入库保存结果反馈：整单完成与部分入库使用不同语音
 */
export async function feedbackInboundComplete(complete = true) {
  logger.log('[Feedback] feedbackInboundComplete 触发');
  await notifyWithSpeech(complete ? '本单已入库完成' : '本次入库已保存，本单尚未完成', Haptics.NotificationFeedbackType.Success, 'replace', true);
}

/**
 * 盘点确认完成反馈 - 震动 + "盘点完成"语音
 */
export async function feedbackInventoryComplete() {
  logger.log('[Feedback] feedbackInventoryComplete 触发');
  await notifyWithSpeech('盘点完成', Haptics.NotificationFeedbackType.Success, 'replace');
}

/**
 * 错误反馈（单次）；传入文案时，停止旧语音并明确播报错误。
 */
export async function feedbackError(message?: string) {
  if (message?.trim()) {
    await notifyWithSpeech(message, Haptics.NotificationFeedbackType.Error, 'replace');
    return;
  }
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 错误震动失败:', e);
  }
}

export async function feedbackQuerySuccess() {
  await notifyWithSpeech('查询成功', Haptics.NotificationFeedbackType.Success);
}

export async function feedbackQueryFailed() {
  await feedbackError('查询失败');
}

export async function feedbackClearFailed() {
  await feedbackError('清空失败');
}

/**
 * 警告反馈（单次）；省略文案时保留原来的仅震动行为。
 */
export async function feedbackWarning(message?: string) {
  if (message?.trim()) {
    await notifyWithSpeech(message, Haptics.NotificationFeedbackType.Warning, 'replace');
    return;
  }
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 警告震动失败:', e);
  }
}

export async function feedbackUnpackRequired() {
  await notifyWithSpeech('需要拆包', Haptics.NotificationFeedbackType.Warning);
}

export async function feedbackUnpackComplete() {
  await notifyWithSpeech('拆包完成', Haptics.NotificationFeedbackType.Success);
}

/**
 * 出库单在本次扫码后刚好全部完成时的专用反馈。
 * 使用一条完整语音，避免与普通“扫码成功”或“拆包完成”相互抢占。
 */
export async function feedbackOutboundOrderComplete(afterUnpack = false) {
  await notifyWithSpeech(
    afterUnpack ? '拆包完成，本单已扫完' : '本单已扫完，可扫描下一单',
    Haptics.NotificationFeedbackType.Success,
    'replace',
    true
  );
}

/** 扫描订单并恢复界面后的提示，与物料保存成功分开。 */
export async function feedbackOutboundOrderReady(
  status: 'loaded' | 'switched' | 'current' | 'complete' | 'verifying'
) {
  const messages = {
    loaded: '订单已载入',
    switched: '切换订单',
    current: '当前订单，请继续扫码',
    complete: '本单已扫完',
    verifying: '订单正在核验，请稍候',
  };
  const haptic = status === 'switched' || status === 'verifying'
    ? Haptics.NotificationFeedbackType.Warning
    : Haptics.NotificationFeedbackType.Success;
  await notifyWithSpeech(messages[status], haptic, 'order-ready', status === 'complete');
}

/** 销售退货使用专用文案，复用订单切换与原生完成播报的保护逻辑。 */
export async function feedbackSalesReturnOrderReady(
  status: 'loaded' | 'switched' | 'current' | 'complete'
) {
  const messages = {
    loaded: '销售退货单已载入',
    switched: '切换退货单',
    current: '当前退货单，请继续扫码',
    complete: '本单退货已收齐',
  };
  const haptic = status === 'switched'
    ? Haptics.NotificationFeedbackType.Warning
    : Haptics.NotificationFeedbackType.Success;
  await notifyWithSpeech(messages[status], haptic, 'order-ready', status === 'complete');
}

/** 仅在退货记录保存成功之后调用；收齐时只播报一条完成提示。 */
export async function feedbackSalesReturnSaved(complete = false) {
  await notifyWithSpeech(
    complete ? '本单退货已收齐' : '退货扫码成功',
    Haptics.NotificationFeedbackType.Success,
    complete ? 'replace' : 'enqueue',
    complete
  );
}

/**
 * 清空记录成功反馈 - 震动 + "已清空"语音
 */
export async function feedbackClear() {
  logger.log('[Feedback] feedbackClear 触发');
  await notifyWithSpeech('已清空', Haptics.NotificationFeedbackType.Warning, 'replace');
}

/**
 * 新订单反馈 - 震动 + "新订单"语音
 */
export async function feedbackNewOrder() {
  logger.log('[Feedback] feedbackNewOrder 触发');
  await notifyWithSpeech('新订单', Haptics.NotificationFeedbackType.Success, 'replace');
}

/**
 * 切换订单反馈 - 震动 + "切换订单"语音
 */
export async function feedbackSwitchOrder() {
  logger.log('[Feedback] feedbackSwitchOrder 触发');
  await notifyWithSpeech('切换订单', Haptics.NotificationFeedbackType.Warning, 'replace');
}

/**
 * 未绑定存货编码反馈 - 震动 + "未绑定"语音
 */
export async function feedbackNotBound() {
  logger.log('[Feedback] feedbackNotBound 触发');
  await notifyWithSpeech('未绑定', Haptics.NotificationFeedbackType.Error, 'replace');
}

/**
 * 不在本单反馈 - 震动 + "不在本单"语音
 */
export async function feedbackNotInOrder() {
  logger.log('[Feedback] feedbackNotInOrder 触发');
  await notifyWithSpeech('不在本单', Haptics.NotificationFeedbackType.Error, 'replace');
}

/**
 * 超量反馈 - 震动 + "超量了"语音
 */
export async function feedbackOverQuantity() {
  logger.log('[Feedback] feedbackOverQuantity 触发');
  await notifyWithSpeech('超量了', Haptics.NotificationFeedbackType.Warning, 'replace');
}

/**
 * 清理语音资源
 */
export function cleanupSounds() {
  if (isWebPlatform) {
    return;
  }

  void cancelSpeechSession('cleanup');
}

export async function pauseFeedbackForAppInactive() {
  await cancelSpeechSession('app-inactive', SPEECH_RESUME_SETTLE_MS);
}

export async function resumeFeedbackAfterAppActive() {
  try {
    await initSoundSetting();
  } catch (error) {
    logger.warn('[Feedback] 恢复声音设置失败:', error);
  }

  speechReadyAt = Math.max(speechReadyAt, Date.now() + SPEECH_STOP_SETTLE_MS);
  await warmupSpeechEngine('app-active');
}

// ============================================================================
// 页面卸载时自动释放语音资源。
// ============================================================================

/**
 * 自动清理反馈资源的 Hook
 */
export function useFeedbackCleanup() {
  useEffect(() => {
    // 页面切换不停止全局语音；应用进入后台时由根布局统一清理。
    return undefined;
  }, []);
}
