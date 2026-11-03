import { useMemo } from 'react';
import { Animated, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography, withAlpha } from '@/constants/theme';
import { rf } from '@/utils/responsive';
import { useMotionPresence, useRetainedValue } from '@/components/AppMotion';

export type AppPillToastType = 'success' | 'warning' | 'error' | 'info';

interface AppPillToastProps {
  text: string;
  type?: AppPillToastType;
  bottom?: number;
  style?: StyleProp<ViewStyle>;
  visible?: boolean;
}

export function AppPillToast({ text: inputText, type: inputType = 'success', bottom, style, visible = true }: AppPillToastProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { present, progress: anim } = useMotionPresence(visible && Boolean(inputText));
  const value = useMemo(() => ({ text: inputText, type: inputType }), [inputText, inputType]);
  const { text, type } = useRetainedValue(visible && Boolean(inputText), value);
  if (!present) return null;

  const color =
    type === 'error'
      ? theme.error
      : type === 'warning'
        ? theme.warning
        : type === 'info'
          ? theme.info
          : theme.success;
  const icon =
    type === 'error'
      ? 'x-circle'
      : type === 'warning'
        ? 'alert-circle'
        : type === 'info'
          ? 'info'
          : 'check-circle';
  // 浅色主题的状态色使用深字，深色主题使用深蓝字，保证所有状态提示都有足够对比度。
  const foregroundColor = theme.isDark ? theme.buttonPrimaryText : theme.black;
  const persistentError = type === 'error';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          bottom: bottom ?? insets.bottom + 28,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          persistentError && styles.persistentError,
          {
            backgroundColor: color,
            borderColor: withAlpha(foregroundColor, 0.18),
            shadowColor: theme.shadowColor,
          },
        ]}
      >
        <Feather
          name={icon}
          size={rf(16)}
          color={foregroundColor}
          style={persistentError ? styles.persistentErrorIcon : undefined}
        />
        <Text
          accessibilityRole={persistentError ? 'alert' : undefined}
          style={[
            styles.text,
            ...(persistentError ? [styles.persistentErrorText] : []),
            { color: foregroundColor },
          ]}
        >
          {text}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    alignItems: 'center',
    zIndex: 5000,
  },
  pill: {
    minWidth: rf(220),
    maxWidth: '100%',
    minHeight: 42,
    paddingHorizontal: rf(26),
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: BorderWidth.thin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  persistentError: {
    width: '100%',
    borderRadius: BorderRadius.xl,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  persistentErrorIcon: {
    marginTop: 2,
  },
  text: {
    ...Typography.feedback,
    textAlign: 'center',
    includeFontPadding: false,
  },
  persistentErrorText: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    textAlign: 'left',
  },
});
