/**
 * 扫码反馈工具
 * 提供震动反馈和中文语音播报
 */

import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { STORAGE_KEYS } from '@/constants/config';
import { logger } from './logger';

// 声音开关状态缓存（同步访问）
let soundEnabled: boolean = true;
let lastSuccessFeedbackAt = 0;

const SUCCESS_FEEDBACK_MIN_INTERVAL = 180;

/**
 * 初始化声音开关状态
 */
export async function initSoundSetting() {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED);
    soundEnabled = value === null || value === 'true';
    logger.log('[Feedback] 声音开关状态:', soundEnabled);
  } catch {
    soundEnabled = true;
  }
}

/**
 * 设置声音开关状态（设置页面调用）
 */
export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  AsyncStorage.setItem(STORAGE_KEYS.SOUND_ENABLED, String(enabled)).catch(logger.error);
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
async function speakChinese(text: string) {
  if (!soundEnabled) {
    logger.log('[Feedback] 声音已关闭，跳过语音');
    return;
  }
  
  try {
    // 停止之前的语音
    await Speech.stop();
    
    // 播放中文语音
    Speech.speak(text, {
      language: 'zh-CN',
      pitch: 1.0,
      rate: 1.0,
    });
    logger.log('[Feedback] 播放语音:', text);
  } catch (error) {
    logger.error('播放语音失败:', error);
  }
}

/**
 * 扫码成功反馈 - 震动 + "扫码成功"语音
 */
export async function feedbackSuccess() {
  logger.log('[Feedback] feedbackSuccess 触发');
  const now = Date.now();
  if (now - lastSuccessFeedbackAt < SUCCESS_FEEDBACK_MIN_INTERVAL) {
    return;
  }
  lastSuccessFeedbackAt = now;
  
  // 震动
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('扫码成功');
}

/**
 * 客户识别成功反馈 - 震动 + "客户已识别"语音
 */
export async function feedbackCustomerSuccess() {
  logger.log('[Feedback] feedbackCustomerSuccess 触发');
  const now = Date.now();
  if (now - lastSuccessFeedbackAt < SUCCESS_FEEDBACK_MIN_INTERVAL) {
    return;
  }
  lastSuccessFeedbackAt = now;
  
  // 震动
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('客户已识别');
}

/**
 * 扫码重复反馈 - 震动一次 + "扫码重复"语音
 */
export async function feedbackDuplicate() {
  logger.log('[Feedback] feedbackDuplicate 触发');
  
  // 震动一次
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('扫码重复');
}

/**
 * 确认反馈 - 只播放"确认"语音，不震动
 */
export async function feedbackConfirm() {
  logger.log('[Feedback] feedbackConfirm 触发');
  await speakChinese('确认');
}

/**
 * 入库确认完成反馈 - 震动 + "入库完成"语音
 */
export async function feedbackInboundComplete() {
  logger.log('[Feedback] feedbackInboundComplete 触发');

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('入库完成');
}

/**
 * 盘点确认完成反馈 - 震动 + "盘点完成"语音
 */
export async function feedbackInventoryComplete() {
  logger.log('[Feedback] feedbackInventoryComplete 触发');

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese('盘点完成');
}

/**
 * 错误反馈（单次）
 */
export async function feedbackError() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

/**
 * 警告反馈（单次）
 */
export async function feedbackWarning() {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

/**
 * 清空记录成功反馈 - 震动 + "已清空"语音
 */
export async function feedbackClear() {
  logger.log('[Feedback] feedbackClear 触发');
  
  // 震动
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('已清空');
}

/**
 * 新订单反馈 - 震动 + "新订单"语音
 */
export async function feedbackNewOrder() {
  logger.log('[Feedback] feedbackNewOrder 触发');
  
  // 震动
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('新订单');
}

/**
 * 切换订单反馈 - 震动 + "切换订单"语音
 */
export async function feedbackSwitchOrder() {
  logger.log('[Feedback] feedbackSwitchOrder 触发');
  
  // 震动
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }
  
  // 语音
  await speakChinese('切换订单');
}

/**
 * 扫描订单后提醒继续扫描客户名称
 */
export async function feedbackNeedCustomerName(isNewOrder = false) {
  logger.log('[Feedback] feedbackNeedCustomerName 触发:', { isNewOrder });

  try {
    await Haptics.notificationAsync(
      isNewOrder
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning
    );
  } catch (e) {
    logger.error('[Feedback] 震动失败:', e);
  }

  await speakChinese(isNewOrder ? '新订单，请扫描客户名称' : '请扫描客户名称');
}

/**
 * 清理语音资源
 */
export function cleanupSounds() {
  Speech.stop();
}

// ============================================================================
// React Hook - 自动清理
// ============================================================================

/**
 * 自动清理反馈资源的 Hook
 */
export function useFeedbackCleanup() {
  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);
}


