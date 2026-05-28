import React, { useMemo } from 'react';
import {
  TouchableOpacity,
  Animated,
  ViewStyle,
  StyleProp,
} from 'react-native';

interface AnimatedCardProps {
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  disablePressAnimation?: boolean;
}

export function AnimatedCard({
  onPress,
  onLongPress,
  children,
  style,
  disabled = false,
  disablePressAnimation = false,
}: AnimatedCardProps) {
  // 使用 useMemo 创建 Animated.Value，避免 ESLint 报错
  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const opacityAnim = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = () => {
    if (disablePressAnimation) return;

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0.978,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0.9,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    if (disablePressAnimation) return;

    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animatedStyle = disablePressAnimation ? null : {
    transform: [{ scale: scaleAnim }],
    opacity: opacityAnim,
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={disablePressAnimation ? undefined : handlePressIn}
        onPressOut={disablePressAnimation ? undefined : handlePressOut}
        activeOpacity={0.95}
        disabled={disabled || (!onPress && !onLongPress)}
        style={{ width: '100%' }}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}
