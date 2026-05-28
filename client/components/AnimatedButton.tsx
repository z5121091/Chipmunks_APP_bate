import React, { useMemo } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';

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

export function AnimatedButton({
  onPress,
  children,
  style,
  containerStyle,
  textStyle,
  disabled = false,
  activeScale = 0.965,
  activeOpacity = 0.9,
}: AnimatedButtonProps) {
  // 使用 useMemo 创建 Animated.Value，避免 ESLint 报错
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: activeScale,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, containerStyle]}>
      <TouchableOpacity
        style={[styles.button, style]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={activeOpacity}
        disabled={disabled}
      >
        {typeof children === 'string' ? (
          <Text style={[styles.text, textStyle]}>{children}</Text>
        ) : (
          children
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
  },
  text: {},
});
