import React from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppPressable } from '@/components/AppPressable';
import { APP_MOTION } from '@/constants/motion';

interface AnimatedCardProps {
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  disablePressAnimation?: boolean;
}

export function AnimatedCard({ onPress, onLongPress, children, style, disabled = false,
  disablePressAnimation = false }: AnimatedCardProps) {
  if (disablePressAnimation) {
    // Expandable document cards must not fade or create animated transform layers
    // while their size changes; keep a plain touch target for press/long press.
    return <View style={style}>
      <AppPressable feedback="none" onPress={onPress} onLongPress={onLongPress}
        disabled={disabled || (!onPress && !onLongPress)} style={{ width: '100%' }}>
        {children}
      </AppPressable>
    </View>;
  }
  return <Animated.View style={style}>
    <AppPressable onPress={onPress} onLongPress={onLongPress}
      motionScale={APP_MOTION.cardScale}
      disabled={disabled || (!onPress && !onLongPress)} style={{ width: '100%' }}>
      {children}
    </AppPressable>
  </Animated.View>;
}
