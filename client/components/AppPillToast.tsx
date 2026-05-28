import { useEffect, useState } from 'react';
import { Animated, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography, withAlpha } from '@/constants/theme';
import { rf } from '@/utils/responsive';

export type AppPillToastType = 'success' | 'warning' | 'error' | 'info';

interface AppPillToastProps {
  text: string;
  type?: AppPillToastType;
  bottom?: number;
  style?: StyleProp<ViewStyle>;
}

export function AppPillToast({ text, type = 'success', bottom, style }: AppPillToastProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 210,
      mass: 0.9,
    }).start();
  }, [anim]);

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
          {
            backgroundColor: color,
            borderColor: withAlpha(theme.white, 0.24),
            shadowColor: theme.shadowColor,
          },
        ]}
      >
        <Feather name={icon} size={rf(16)} color={theme.buttonPrimaryText} />
        <Text numberOfLines={2} style={[styles.text, { color: theme.buttonPrimaryText }]}>
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
  text: {
    ...Typography.bodyMedium,
    fontSize: rf(14),
    lineHeight: rf(20),
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
