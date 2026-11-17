import { useMemo } from 'react';
import { useWindowDimensions, type ScaledSize } from 'react-native';

/** Style factories read current responsive tokens/Dimensions. Rebuild their snapshot
 * on window and accessibility changes without changing business/theme identities. */
export function useResponsiveStyles<TTheme, TStyles>(
  theme: TTheme,
  createStyles: (theme: TTheme, viewport: ScaledSize) => TStyles,
): TStyles {
  const { width, height, scale, fontScale } = useWindowDimensions();
  return useMemo(() => createStyles(theme, { width, height, scale, fontScale }),
    [theme, createStyles, width, height, scale, fontScale]);
}
