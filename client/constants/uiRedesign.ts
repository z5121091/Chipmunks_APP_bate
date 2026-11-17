import {
  AppComponentTokens,
  BorderRadius,
  BorderWidth,
  Spacing,
  type Theme,
} from '@/constants/theme';
import { withAlpha } from '@/utils/colors';

export const UI_REDESIGN_TOKENS = {
  radius: {
    get card() { return BorderRadius.sm; },
    get control() { return BorderRadius.sm; },
    get pill() { return BorderRadius.full; },
  },
  border: {
    get width() { return BorderWidth.normal; },
    get thin() { return BorderWidth.thin; },
  },
  spacing: {
    get pageX() { return Spacing.sm; },
    get sectionGap() { return Spacing.sm; },
    get itemX() { return Spacing.md; },
    get itemY() { return Spacing.sm; },
  },
  size: AppComponentTokens.size,
  typography: AppComponentTokens.typography,
} as const;

export const getUiRedesignShadow = (theme: Theme) => ({
  shadowColor: theme.shadowColor,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: theme.isDark ? 0.12 : 0.03,
  shadowRadius: 10,
  elevation: 2,
});

export const getUiRedesignIconBackground = (theme: Theme, color: string) =>
  withAlpha(color, theme.isDark ? 0.18 : 0.1);
