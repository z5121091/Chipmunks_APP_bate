import React from 'react';
import { Text, Animated, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { AppPressable } from '@/components/AppPressable';
import { APP_MOTION } from '@/constants/motion';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

interface AnimatedButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
  activeScale?: number;
  activeOpacity?: number;
}

export function AnimatedButton({ onPress, children, style, containerStyle, textStyle, disabled = false,
  activeScale = APP_MOTION.buttonScale, activeOpacity = 0.86 }: AnimatedButtonProps) {
  return <Animated.View style={containerStyle}>
    <AppPressable style={[{ width: '100%', minHeight: MIN_TOUCH_TARGET }, style]}
      onPress={onPress} motionScale={activeScale} activeOpacity={activeOpacity}
      accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}>
      {typeof children === 'string' ? <Text style={textStyle}>{children}</Text> : children}
    </AppPressable>
  </Animated.View>;
}
