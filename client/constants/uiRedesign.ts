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
    card: BorderRadius.sm,
    control: BorderRadius.sm,
    pill: BorderRadius.full,
  },
  border: {
    width: BorderWidth.normal,
    thin: BorderWidth.thin,
  },
  spacing: {
    pageX: Spacing.sm,
    sectionGap: Spacing.sm,
    itemX: Spacing.md,
    itemY: Spacing.sm,
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
