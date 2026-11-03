import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useNavigationState } from 'expo-router/react-navigation';
import { APP_MOTION } from '@/constants/motion';
import { useAppMotion } from '@/hooks/useAppMotion';
import { useTheme } from '@/hooks/useTheme';

/** Reveal an opaque page; never fade its overlapping cards/backgrounds individually. */
export function MainTabScene({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  // Local tab selection stays true while a child stack screen covers this tab.
  // Global focus would blank the underlying page during a stack push/back gesture.
  const selected = useNavigationState(state => state.routes[state.index]?.key === routeKey);
  const reduced = useAppMotion();
  const { theme } = useTheme();
  const [coverOpacity] = useState(() => new Animated.Value(reduced ? 0 : 1));

  useLayoutEffect(() => {
    coverOpacity.stopAnimation();
    coverOpacity.setValue(reduced ? 0 : 1);
    if (!selected || reduced) return;
    const animation = Animated.timing(coverOpacity, {
      toValue: 0, duration: APP_MOTION.content,
      easing: APP_MOTION.easing, useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [selected, reduced, coverOpacity]);

  return <View testID="main-tab-scene" collapsable={false}
    pointerEvents={selected ? 'auto' : 'none'}
    accessibilityElementsHidden={!selected}
    importantForAccessibility={selected ? 'auto' : 'no-hide-descendants'}
    style={{ flex: 1, overflow: 'hidden', backgroundColor: theme.backgroundRoot, display: selected ? 'flex' : 'none' }}>
    <View collapsable={false} style={styles.content}>{children}</View>
    {!reduced && <Animated.View testID="main-tab-reveal-cover" pointerEvents="none"
      accessible={false} importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: theme.backgroundRoot, opacity: coverOpacity }]} />}
  </View>;
}

const styles = StyleSheet.create({
  content: { flex: 1, zIndex: 0 },
  // Above the page content, without applying alpha to any card, border or shadow.
  cover: { zIndex: 1 },
});
