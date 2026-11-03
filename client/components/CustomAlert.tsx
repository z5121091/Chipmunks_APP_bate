import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { AppModal as Modal } from '@/components/AppModal';
import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Spacing, BorderRadius, BorderWidth, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH, getAppModalWidth } from '@/constants/modal';
import { withAlpha } from '@/utils/colors';
import { AppPillToast, AppPillToastType } from './AppPillToast';
import { feedbackCancel, feedbackConfirm, feedbackDeleted } from '@/utils/feedback';
import { MotionSurface } from '@/components/AppMotion';
import { getFeedbackDuration, type FeedbackTimingOptions } from '@/utils/feedbackTiming';

export type AlertButtonType = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type AlertIconType = 'success' | 'warning' | 'error' | 'info' | 'question';

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButtonType[];
  icon?: AlertIconType;
  onClose: () => void;
}

export function CustomAlert({
  visible,
  title,
  message,
  buttons = [{ text: '确定', style: 'default' }],
  icon,
  onClose,
}: CustomAlertProps) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const modalWidth = getAppModalWidth(width);
  const shouldScrollMessage = Boolean(message && (message.includes('\n') || message.length > 96));
  const messageMaxHeight = Math.min(Math.max(height * 0.28, 96), 180);
  const pressed = useRef(false);
  useEffect(() => { pressed.current = false; }, [visible, title, buttons]);

  const getIconConfig = () => {
    switch (icon) {
      case 'success':
        return {
          name: 'check' as const,
          color: theme.success,
          bgColor: withAlpha(theme.success, 0.12),
        };
      case 'warning':
        return {
          name: 'triangle-exclamation' as const,
          color: theme.warning,
          bgColor: withAlpha(theme.warning, 0.12),
        };
      case 'error':
        return {
          name: 'xmark' as const,
          color: theme.error,
          bgColor: withAlpha(theme.error, 0.12),
        };
      case 'info':
        return {
          name: 'circle-info' as const,
          color: theme.info,
          bgColor: withAlpha(theme.info, 0.12),
        };
      case 'question':
        return {
          name: 'circle-question' as const,
          color: theme.primary,
          bgColor: withAlpha(theme.purple, 0.12),
        };
      default:
        return null;
    }
  };

  const handleButtonPress = (button: AlertButtonType) => {
    if (pressed.current || !visible) return;
    pressed.current = true;
    if (button.style === 'cancel' || button.text === '取消') {
      void feedbackCancel();
    } else if (button.text === '确认' || button.text === '确定') {
      void feedbackConfirm();
    }
    onClose();
    button.onPress?.();
  };

  const iconConfig = getIconConfig();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={{
        flex: 1,
        backgroundColor: theme.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
      }}>
        <MotionSurface style={{
          width: modalWidth,
          maxWidth: APP_MODAL_MAX_WIDTH,
          borderRadius: BorderRadius.md,
          padding: Spacing['2xl'],
          backgroundColor: theme.backgroundElevated,
          borderWidth: BorderWidth.normal,
          borderColor: theme.border,
          shadowColor: theme.shadowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: theme.isDark ? 0.24 : 0.14,
          shadowRadius: 18,
          elevation: 10,
        }}>
          {/* 图标 */}
          {iconConfig && (
            <View style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: Spacing.lg,
              alignSelf: 'center',
              backgroundColor: iconConfig.bgColor,
              borderWidth: BorderWidth.normal,
              borderColor: withAlpha(iconConfig.color, 0.16),
            }}>
              <FontAwesome6
                name={iconConfig.name}
                size={24}
                color={iconConfig.color}
              />
            </View>
          )}

          {/* 标题 */}
          <Text style={{
            ...Typography.dialogTitle,
            textAlign: 'center',
            marginBottom: message ? Spacing.sm : Spacing.lg,
            color: theme.textPrimary,
          }}>
            {title}
          </Text>

          {/* 消息内容 */}
          {message ? (
            <ScrollView
              style={shouldScrollMessage ? { alignSelf: 'stretch', maxHeight: messageMaxHeight } : undefined}
              contentContainerStyle={{ paddingHorizontal: Spacing.xs }}
              showsVerticalScrollIndicator={shouldScrollMessage}
              bounces={shouldScrollMessage}
            >
              <Text style={{
                ...Typography.dialogBody,
                textAlign: 'center',
                marginBottom: Spacing.xl,
                color: theme.textSecondary,
              }}>
                {message}
              </Text>
            </ScrollView>
          ) : null}

          {/* 按钮组 */}
          <View style={{
            flexDirection: buttons.length > 2 ? 'column' : 'row',
            gap: Spacing.md,
          }}>
            {buttons.map((button, index) => {
              const isDestructive = button.style === 'destructive';
              const isCancel = button.style === 'cancel';
              
              return (
                <TouchableOpacity
                  key={index}
                  style={{
                    flex: buttons.length <= 2 ? 1 : undefined,
                    width: buttons.length > 2 ? '100%' : undefined,
                    paddingVertical: Spacing.md,
                    borderRadius: BorderRadius.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 50,
                    backgroundColor: isDestructive 
                      ? theme.error 
                      : isCancel 
                        ? theme.backgroundTertiary 
                        : theme.primary,
                    borderWidth: isCancel ? BorderWidth.normal : 0,
                    borderColor: isCancel ? theme.border : 'transparent',
                  }}
                  onPress={() => handleButtonPress(button)}
                  activeOpacity={0.86}
                >
                  <Text style={{
                    ...Typography.dialogAction,
                    color: isCancel ? theme.textPrimary : theme.buttonPrimaryText,
                  }}>
                    {button.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </MotionSurface>
      </View>
    </Modal>
  );
}

// 页面调用弹窗时使用的 Hook。
export interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButtonType[];
  icon?: AlertIconType;
}

export function useCustomAlert({ duration, persistentErrors }: FeedbackTimingOptions = {}) {
  const [visible, setVisible] = useState(false);
  const [pill, setPill] = useState<{ text: string; type: AppPillToastType } | null>(null);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [config, setConfig] = useState<AlertConfig>({
    title: '',
    message: '',
    buttons: [{ text: '确定' }],
  });

  const showPill = useCallback((text: string, type: AppPillToastType) => {
    if (pillTimerRef.current) {
      clearTimeout(pillTimerRef.current);
    }
    pillTimerRef.current = null;

    setPill({ text, type });
    const delay = getFeedbackDuration(type, { duration, persistentErrors });
    if (delay !== null) {
      pillTimerRef.current = setTimeout(() => {
        setPill(null);
        pillTimerRef.current = null;
      }, delay);
    }
  }, [duration, persistentErrors]);

  useEffect(() => {
    return () => {
      if (pillTimerRef.current) {
        clearTimeout(pillTimerRef.current);
      }
    };
  }, []);

  const shouldUsePill = useCallback((message: string) => {
    return !message.includes('\n') && message.length <= 42;
  }, []);

  const showAlert = useCallback((
    title: string,
    message?: string,
    buttons?: AlertButtonType[],
    icon?: AlertIconType
  ) => {
    setConfig({
      title,
      message,
      buttons: buttons || [{ text: '确定' }],
      icon,
    });
    setVisible(true);
  }, []);

  const showConfirm = useCallback((
    title: string,
    message: string,
    onConfirm: () => void,
    isDanger: boolean = false,
    confirmLabel?: string
  ) => {
    setConfig({
      title,
      message,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: confirmLabel || (isDanger ? '删除' : '确认'),
          style: isDanger ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ],
      icon: isDanger ? 'error' : 'question',
    });
    setVisible(true);
  }, []);

  const showSuccess = useCallback((message: string) => {
    if (message.includes('已删除')) {
      void feedbackDeleted();
    }
    if (shouldUsePill(message)) {
      showPill(message, 'success');
      return;
    }

    setConfig({
      title: '成功',
      message,
      buttons: [{ text: '确定' }],
      icon: 'success',
    });
    setVisible(true);
  }, [shouldUsePill, showPill]);

  const showError = useCallback((message: string) => {
    // Long errors use the same wrapping, non-blocking feedback as short errors.
    // Only an explicit showAlert/showConfirm opens a decision dialog.
    setVisible(false);
    showPill(message, 'error');
  }, [showPill]);

  const showWarning = useCallback((message: string) => {
    if (shouldUsePill(message)) {
      showPill(message, 'warning');
      return;
    }

    setConfig({
      title: '提示',
      message,
      buttons: [{ text: '确定' }],
      icon: 'warning',
    });
    setVisible(true);
  }, [shouldUsePill, showPill]);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  // 直接渲染 AlertComponent，不再使用 useMemo 缓存
  // 因为 config.buttons.onPress 需要及时更新
  const AlertComponent = (
    <>
        <CustomAlert
          visible={visible}
          title={config.title}
          message={config.message}
          buttons={config.buttons}
          icon={config.icon}
          onClose={close}
        />
      <AppPillToast text={pill?.text || ''} type={pill?.type || 'success'} visible={Boolean(pill)} />
    </>
  );

  return {
    visible,
    config,
    showAlert,
    showConfirm,
    showSuccess,
    showError,
    showWarning,
    close,
    AlertComponent,
  };
}
