import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { APP_MOTION } from '@/constants/motion';
import { useAppMotion } from '@/hooks/useAppMotion';
import { useOverlayPresence } from '@/hooks/useOverlayActivity';

export const ModalMotionContext = createContext<Animated.Value | null>(null);

/** Retain a committed surface while its owner clears the selected business record. */
export function useRetainedValue<T>(visible: boolean, value: T): T {
  const [retained, setRetained] = useState(() => value);
  if (visible && retained !== value) setRetained(() => value);
  return visible ? value : retained;
}

export function MotionSurface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useContext(ModalMotionContext);
  return <Animated.View style={[style, progress && { transform: [
    { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
  ] }]}>{children}</Animated.View>;
}

/** Reversible presence. Interrupted exits cannot unmount a newly reopened surface. */
export function useMotionPresence(visible: boolean) {
  const reduced = useAppMotion();
  const [closed, setClosed] = useState(!visible);
  if (visible && closed) setClosed(false);
  const [progress] = useState(() => new Animated.Value(visible && reduced ? 1 : 0));
  useLayoutEffect(() => {
    if (!visible && closed) return;
    let active = true;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduced ? 0 : visible ? APP_MOTION.enter : APP_MOTION.exit,
      easing: APP_MOTION.easing, useNativeDriver: true,
    });
    animation.start(({ finished }) => { if (active && finished && !visible) setClosed(true); });
    return () => { active = false; animation.stop(); };
  }, [visible, closed, progress, reduced]);
  return { present: !closed || visible, progress };
}

export function MotionPresence({ visible, children, style, overlay = false }: {
  visible: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; overlay?: boolean;
}) {
  const { present, progress } = useMotionPresence(visible);
  useOverlayPresence(overlay && present);
  const last = useRetainedValue(visible, children);
  if (!present) return null;
  return <Animated.View pointerEvents={visible ? 'box-none' : overlay ? 'box-only' : 'none'} accessibilityElementsHidden={!visible} style={[
    style, { opacity: progress },
    !overlay && { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
  ]}>{visible ? children : last}</Animated.View>;
}

/** Only local content animates. Does not transform camera geometry or whole native-stack pages. */
export function MotionContent({ children, contentKey, style, direction = 'forward' }: {
  children: ReactNode; contentKey: string | number | boolean; style?: StyleProp<ViewStyle>;
  direction?: 'forward' | 'back' | 'fade';
}) {
  const reduced = useAppMotion();
  const progress = useMemo(() => new Animated.Value(1), []);
  const previous = useRef(contentKey);
  useLayoutEffect(() => {
    if (previous.current === contentKey) { if (reduced) progress.setValue(1); return; }
    previous.current = contentKey;
    progress.stopAnimation();
    progress.setValue(reduced ? 1 : 0);
    const animation = Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : APP_MOTION.content,
      easing: APP_MOTION.easing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [contentKey, progress, reduced]);
  return <Animated.View style={[style, { opacity: progress }, direction !== 'fade' && {
    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [direction === 'back' ? -12 : 12, 0] }) }],
  }]}>{children}</Animated.View>;
}

export { MotionCollapse } from '@/components/MotionCollapse';

export function MotionChevron({ expanded, color, size = 18, collapsed = 'right' }: {
  expanded: boolean; color: string; size?: number; collapsed?: 'right' | 'down';
}) {
  // Disclosure indicators follow the same immediate state as their content.
  const name = collapsed === 'down'
    ? expanded ? 'chevron-up' : 'chevron-down'
    : expanded ? 'chevron-down' : 'chevron-right';
  return <Feather name={name} size={size} color={color} />;
}

export function MotionSelection({ selected, style }: { selected: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useAppMotion();
  const [opacity] = useState(() => new Animated.Value(selected ? 1 : 0));
  const previous = useRef(selected);
  useEffect(() => {
    if (reduced) { opacity.setValue(selected ? 1 : 0); previous.current = selected; return; }
    if (previous.current === selected) return;
    previous.current = selected;
    const animation = Animated.timing(opacity, { toValue: selected ? 1 : 0, duration: reduced ? 0 : APP_MOTION.content,
      easing: APP_MOTION.easing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, opacity]);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, style, { opacity }]} />;
}
