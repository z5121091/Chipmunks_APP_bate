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
const pendingPrioritySpeechTexts = new Set<string>();

const SPEECH_MIN_INTERVAL_MS = 120;
const SPEECH_STOP_SETTLE_MS = Platform.OS === 'android' ? 120 : 40;
const SPEECH_RESUME_SETTLE_MS = Platform.OS === 'android' ? 350 : 120;
const SPEECH_FINISH_TIMEOUT_MS = 2500;
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

const resetSpeechSession = async (
  reason: string,
  settleMs = SPEECH_STOP_SETTLE_MS
) => {
  if (isWebPlatform) {
    return;
  }

  try {
    await Speech.stop();
  } catch (error) {
    logger.warn(`[Feedback] 停止语音失败(${reason}):`, error);
  }

  speechReadyAt = Math.max(speechReadyAt, Date.now() + settleMs);
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
  pendingPrioritySpeechTexts.clear();
  return resetSpeechSession(reason, settleMs);
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
async function speakChinese(text: string, mode: 'enqueue' | 'replace' = 'enqueue') {
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

  const trackPendingSpeech = mode === 'replace';
  if (trackPendingSpeech && pendingPrioritySpeechTexts.has(normalizedText)) {
    return;
  }

  if (mode === 'replace') {
    await cancelSpeechSession(`priority:${normalizedText}`);
  }

  if (trackPendingSpeech) {
    pendingPrioritySpeechTexts.add(normalizedText);
  }
  const generation = speechSessionGeneration;
  try {
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
      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = setTimeout(resolveOnce, SPEECH_FINISH_TIMEOUT_MS);

      Speech.speak(normalizedText, {
        language: 'zh-CN',
        pitch: 1.0,
        rate: 1.0,
        onStart: () => {
          if (generation === speechSessionGeneration) {
            lastSpeechStartedAt = Date.now();
          }
        },
        onDone: resolveOnce,
        onStopped: resolveOnce,
        onError: (error) => {
          logger.error('播放语音失败:', error);
          speechReadyAt = Math.max(speechReadyAt, Date.now() + SPEECH_RESUME_SETTLE_MS);
          resolveOnce();
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
  } finally {
    if (trackPendingSpeech) {
      pendingPrioritySpeechTexts.delete(normalizedText);
    }
  }
}

/**
 * 扫码成功反馈 - 震动 + "扫码成功"语音
 */
export async function feedbackSuccess() {
  logger.log('[Feedback] feedbackSuccess 触发');
  
  // 震动
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('扫码成功');
}

/**
 * 扫码重复反馈 - 震动一次 + "扫码重复"语音
 */
export async function feedbackDuplicate() {
  logger.log('[Feedback] feedbackDuplicate 触发');
  
  // 震动一次
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('扫码重复', 'replace');
}

/**
 * 确认反馈 - 只播放"确认"语音，不震动
 */
export async function feedbackConfirm() {
  logger.log('[Feedback] feedbackConfirm 触发');
  await speakChinese('确认', 'replace');
}

/**
 * 进入采购入库扫码反馈 - 震动 + "开始入库"语音
 */
export async function feedbackInboundStart() {
  logger.log('[Feedback] feedbackInboundStart 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('开始入库', 'replace');
}

/**
 * 入库确认完成反馈 - 震动 + "入库完成"语音
 */
export async function feedbackInboundComplete() {
  logger.log('[Feedback] feedbackInboundComplete 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('入库完成', 'replace');
}

/**
 * 盘点确认完成反馈 - 震动 + "盘点完成"语音
 */
export async function feedbackInventoryComplete() {
  logger.log('[Feedback] feedbackInventoryComplete 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('盘点完成', 'replace');
}

/**
 * 错误反馈（单次）
 */
export async function feedbackError() {
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 错误震动失败:', e);
  }
}

/**
 * 警告反馈（单次）
 */
export async function feedbackWarning() {
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 警告震动失败:', e);
  }
}

/**
 * 清空记录成功反馈 - 震动 + "已清空"语音
 */
export async function feedbackClear() {
  logger.log('[Feedback] feedbackClear 触发');
  
  // 震动
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('已清空', 'replace');
}

/**
 * 新订单反馈 - 震动 + "新订单"语音
 */
export async function feedbackNewOrder() {
  logger.log('[Feedback] feedbackNewOrder 触发');
  
  // 震动
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('新订单', 'replace');
}

/**
 * 切换订单反馈 - 震动 + "切换订单"语音
 */
export async function feedbackSwitchOrder() {
  logger.log('[Feedback] feedbackSwitchOrder 触发');
  
  // 震动
  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('切换订单', 'replace');
}

/**
 * 未绑定存货编码反馈 - 震动 + "未绑定"语音
 */
export async function feedbackNotBound() {
  logger.log('[Feedback] feedbackNotBound 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('未绑定', 'replace');
}

/**
 * 不在本单反馈 - 震动 + "不在本单"语音
 */
export async function feedbackNotInOrder() {
  logger.log('[Feedback] feedbackNotInOrder 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('不在本单', 'replace');
}

/**
 * 超量反馈 - 震动 + "超量了"语音
 */
export async function feedbackOverQuantity() {
  logger.log('[Feedback] feedbackOverQuantity 触发');

  try {
    await performNotificationHaptic(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('超量了', 'replace');
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
// React Hook - 自动清理
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
