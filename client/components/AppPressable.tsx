import { useEffect, useMemo } from 'react';
import { Animated, Platform, Pressable, StyleSheet, TouchableOpacity, type AccessibilityActionEvent, type GestureResponderEvent, type TouchableOpacityProps } from 'react-native';
import { APP_MOTION } from '@/constants/motion';
import { useAppMotion } from '@/hooks/useAppMotion';

const AnimatedTouch = Animated.createAnimatedComponent(TouchableOpacity);

/** Keeps the native touch target and flex layout; no extra measuring/layout wrapper. */
export function AppPressable({
  style, onPressIn, onPressOut, disabled, activeOpacity = 0.86, motionScale = APP_MOTION.buttonScale, accessibilityRole,
  feedback = 'animated',
  ...props
}: TouchableOpacityProps & { motionScale?: number; feedback?: 'animated' | 'none' }) {
  const reduced = useAppMotion();
  const scale = useMemo(() => new Animated.Value(1), []);
  const originalTransform = StyleSheet.flatten(style)?.transform;
  useEffect(() => {
    if (disabled || reduced) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [disabled, reduced, scale]);
  // Read-only record rows need a real touch target without an animated opacity
  // layer, transform, native ripple, or press-dependent background.
  if (feedback === 'none') {
    // Android's focusable prop installs a native OnClickListener, independently
    // of JS Pressability. That native clickable view can draw OEM focus/pressed
    // decoration even when our animated feedback is off. Keep touch gestures in
    // Pressability and expose screen-reader activation explicitly instead.
    const android = Platform.OS === 'android';
    const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
      if (disabled || props.accessibilityState?.disabled || props['aria-disabled'] === true) return;
      // Accessibility activation has no pointer coordinates, just like the
      // native accessibility click Pressability normally forwards to onPress.
      const pressEvent = event as unknown as GestureResponderEvent;
      if (event.nativeEvent.actionName === 'activate') props.onPress?.(pressEvent);
      else if (event.nativeEvent.actionName === 'longpress') props.onLongPress?.(pressEvent);
    };
    const actions = [
      ...(props.onPress ? [{ name: 'activate' as const }] : []),
      ...(props.onLongPress ? [{ name: 'longpress' as const }] : []),
    ];
    return <Pressable {...props} disabled={disabled} accessibilityRole={accessibilityRole}
      focusable={android ? false : props.focusable}
      accessibilityActions={android ? props.accessibilityActions ?? actions : props.accessibilityActions}
      onAccessibilityAction={android ? props.onAccessibilityAction ?? handleAccessibilityAction : props.onAccessibilityAction}
      style={style} onPressIn={onPressIn} onPressOut={onPressOut} />;
  }
  const animate = (pressed: boolean) => {
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: pressed && !reduced ? motionScale : 1,
      duration: reduced ? 0 : pressed ? APP_MOTION.pressIn : APP_MOTION.pressOut,
      easing: APP_MOTION.easing, useNativeDriver: true,
    }).start();
  };
  // Preserve the caller's semantics: composite rows/cards can contain their own
  // buttons, so assigning a default button role creates nested HTML buttons on Web.
  return <AnimatedTouch {...props} disabled={disabled} accessibilityRole={accessibilityRole} activeOpacity={activeOpacity}
    style={[style, { transform: [...(Array.isArray(originalTransform) ? originalTransform : []), { scale }] }]}
    onPressIn={event => { animate(true); onPressIn?.(event); }}
    onPressOut={event => { animate(false); onPressOut?.(event); }} />;
}
