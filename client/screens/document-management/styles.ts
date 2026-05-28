import { StyleSheet } from 'react-native';
import { BorderRadius, BorderWidth, Spacing, Theme, Typography } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      padding: Spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.lg,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: theme.isDark ? 0.22 : 0.08,
      shadowRadius: 18,
      elevation: 4,
      marginBottom: Spacing.md,
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: BorderRadius.lg,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.backgroundTertiary,
    },
    headerTextBlock: {
      flex: 1,
    },
    title: {
      ...Typography.h4,
      color: theme.textPrimary,
    },
    subtitle: {
      marginTop: 4,
      ...Typography.caption,
      color: theme.textSecondary,
      lineHeight: 18,
    },
    cardList: {
      gap: Spacing.sm,
    },
    card: {
      minHeight: 96,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      backgroundColor: theme.backgroundElevated,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 14,
      elevation: 3,
    },
    cardPrimary: {
      borderColor: withAlpha(theme.primary, theme.isDark ? 0.42 : 0.28),
      backgroundColor: theme.backgroundElevated,
    },
    cardMuted: {
      opacity: 0.94,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: BorderRadius.lg,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: BorderWidth.normal,
    },
    iconBoxPrimary: {
      backgroundColor: withAlpha(theme.primary, theme.isDark ? 0.18 : 0.1),
      borderColor: withAlpha(theme.primary, theme.isDark ? 0.32 : 0.18),
    },
    iconBoxMuted: {
      backgroundColor: theme.backgroundTertiary,
      borderColor: theme.border,
    },
    cardTextBlock: {
      flex: 1,
    },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    cardTitle: {
      ...Typography.bodyMedium,
      fontWeight: '800',
      color: theme.textPrimary,
    },
    cardDescription: {
      marginTop: 6,
      ...Typography.caption,
      color: theme.textSecondary,
      lineHeight: 18,
    },
  });
