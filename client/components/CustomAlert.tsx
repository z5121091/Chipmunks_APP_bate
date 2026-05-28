import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, useWindowDimensions } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Spacing, BorderRadius, BorderWidth, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH, getAppModalWidth } from '@/constants/modal';
import { withAlpha } from '@/utils/colors';
import { rf } from '@/utils/responsive';
import { AppPillToast, AppPillToastType } from './AppPillToast';

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
  const { width } = useWindowDimensions();
  const modalWidth = getAppModalWidth(width);

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
    if (button.onPress) {
      button.onPress();
    }
    onClose();
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
        <View style={{
          width: modalWidth,
          maxWidth: APP_MODAL_MAX_WIDTH,
          borderRadius: BorderRadius['3xl'],
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
            ...Typography.h4,
            fontSize: rf(19),
            lineHeight: rf(27),
            fontWeight: '800',
            textAlign: 'center',
            marginBottom: message ? Spacing.sm : Spacing.lg,
            color: theme.textPrimary,
            letterSpacing: 0,
          }}>
            {title}
          </Text>

          {/* 消息内容 */}
          {message && (
            <Text style={{
              ...Typography.body,
              fontSize: rf(15),
              lineHeight: rf(24),
              textAlign: 'center',
              marginBottom: Spacing.xl,
              color: theme.textSecondary,
              paddingHorizontal: Spacing.xs,
            }}>
              {message}
            </Text>
          )}

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
                    borderRadius: BorderRadius.lg,
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
                  activeOpacity={0.7}
                >
                  <Text style={{
                    ...Typography.bodyMedium,
                    fontSize: rf(15),
                    lineHeight: rf(22),
                    fontWeight: '700',
                    color: isCancel ? theme.textPrimary : theme.buttonPrimaryText,
                  }}>
                    {button.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Hook for easy usage
export interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButtonType[];
  icon?: AlertIconType;
}

export function useCustomAlert() {
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

    setPill({ text, type });
    pillTimerRef.current = setTimeout(() => {
      setPill(null);
      pillTimerRef.current = null;
    }, type === 'error' ? 2800 : type === 'warning' ? 2400 : 2200);
  }, []);

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
    isDanger: boolean = false
  ) => {
    setConfig({
      title,
      message,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: isDanger ? '删除' : '确认',
          style: isDanger ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ],
      icon: isDanger ? 'error' : 'question',
    });
    setVisible(true);
  }, []);

  const showSuccess = useCallback((message: string) => {
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
    if (shouldUsePill(message)) {
      showPill(message, 'error');
      return;
    }

    setConfig({
      title: '错误',
      message,
      buttons: [{ text: '确定', style: 'destructive' }],
      icon: 'error',
    });
    setVisible(true);
  }, [shouldUsePill, showPill]);

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
  const AlertComponent = visible || pill ? (
    <>
      {visible ? (
        <CustomAlert
          visible={visible}
          title={config.title}
          message={config.message}
          buttons={config.buttons}
          icon={config.icon}
          onClose={close}
        />
      ) : null}
      {pill ? <AppPillToast text={pill.text} type={pill.type} /> : null}
    </>
  ) : null;

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
