import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Shared disclosure boundary. Keep the existing export for callers, but render
 * in normal layout immediately: no measurements, retained children or animation
 * callbacks may control whether expanded content is visible or interactive. */
export function MotionCollapse({ open, children, style }: {
  open: boolean; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  if (!open) return null;
  return <View style={style}>{children}</View>;
}
