import { StyleSheet } from 'react-native';
import { BorderRadius, BorderWidth, Spacing, Theme, Typography } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';

export const createStyles = (theme: Theme, screenWidth: number, screenHeight: number) => {
  const isSmallScreen = screenWidth <= 410;
  const isCompactScreen = screenWidth <= 390 || screenHeight <= 760;
  const horizontalPadding = isCompactScreen ? 12 : isSmallScreen ? 14 : 18;
  const contentTop = isCompactScreen ? 8 : 14;
  const contentBottom = isCompactScreen ? 18 : 28;
  const headerBottom = isCompactScreen ? 10 : 14;
  const sectionGap = isCompactScreen ? 12 : 16;
  const sectionPadding = isCompactScreen ? 12 : 16;
  const primaryGap = isCompactScreen ? 10 : 14;
  const secondaryGap = isCompactScreen ? 10 : 12;
  const primaryCardMinHeight = isCompactScreen ? 136 : 164;
  const secondaryCardMinHeight = isCompactScreen ? 86 : 104;
  const primaryIconSize = isCompactScreen ? 70 : screenHeight >= 900 ? 96 : 84;
  const secondaryIconSize = isCompactScreen ? 46 : screenHeight >= 900 ? 64 : 54;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    content: {
      flex: 1,
      paddingHorizontal: horizontalPadding,
      paddingTop: contentTop,
      paddingBottom: contentBottom,
    },
    header: {
      minHeight: isCompactScreen ? 50 : 58,
      marginBottom: headerBottom,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    appName: {
      ...Typography.h2,
      color: theme.textPrimary,
    },
    appSubtitle: {
      ...Typography.caption,
      color: theme.textSecondary,
      marginTop: 2,
    },
    headerBadge: {
      minHeight: 30,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: BorderRadius.full,
      borderWidth: BorderWidth.thin,
      borderColor: withAlpha(theme.success, theme.isDark ? 0.32 : 0.24),
      backgroundColor: withAlpha(theme.success, theme.isDark ? 0.16 : 0.1),
    },
    headerBadgeText: {
      ...Typography.captionMedium,
      color: theme.textPrimary,
    },
    workbench: {
      flex: 1,
      gap: sectionGap,
    },
    sectionSurface: {
      minHeight: 0,
      padding: sectionPadding,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: theme.isDark ? 0.22 : 0.08,
      shadowRadius: 20,
      elevation: 5,
    },
    primarySurface: {
      flex: isCompactScreen ? 1.02 : 1.08,
    },
    secondarySurface: {
      flex: 1,
    },
    primarySection: {
      flex: 1,
    },
    secondarySection: {
      flex: 1,
    },
    sectionLabel: {
      ...Typography.labelSmall,
      color: theme.textSecondary,
      marginBottom: isCompactScreen ? Spacing.sm : Spacing.md,
      letterSpacing: 0.8,
    },
    primaryGrid: {
      flexDirection: 'row',
      flex: 1,
      gap: primaryGap,
    },
    primaryCard: {
      flex: 1,
      minHeight: primaryCardMinHeight,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      backgroundColor: theme.backgroundDefault,
      overflow: 'hidden',
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.24 : 0.1,
      shadowRadius: 16,
      elevation: 4,
    },
    primaryCardWrapper: {
      flex: 1,
    },
    primaryCardInner: {
      flex: 1,
      padding: isCompactScreen ? Spacing.sm + 2 : Spacing.md + 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryIconContainer: {
      width: primaryIconSize,
      height: primaryIconSize,
      borderRadius: primaryIconSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.md,
    },
    primaryTitle: {
      ...Typography.h4,
      color: theme.textPrimary,
      textAlign: 'center',
    },
    primaryFooter: {
      marginTop: isCompactScreen ? Spacing.sm : Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      gap: 6,
      paddingVertical: isCompactScreen ? 6 : 7,
      paddingHorizontal: isCompactScreen ? 10 : 12,
      borderRadius: BorderRadius.full,
      backgroundColor: theme.backgroundTertiary,
    },
    primaryAction: {
      ...Typography.captionMedium,
      color: theme.textPrimary,
    },
    primaryAccent: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 5,
    },
    secondaryGrid: {
      flex: 1,
      gap: secondaryGap,
    },
    secondaryRow: {
      flex: 1,
      flexDirection: 'row',
      gap: secondaryGap,
    },
    secondaryCard: {
      minHeight: secondaryCardMinHeight,
      flex: 1,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      backgroundColor: theme.backgroundDefault,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 14,
      elevation: 3,
    },
    secondaryCardWrapper: {
      flex: 1,
    },
    secondaryCardInner: {
      flex: 1,
      padding: isCompactScreen ? Spacing.sm + 2 : Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryIconContainer: {
      width: secondaryIconSize,
      height: secondaryIconSize,
      borderRadius: BorderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.sm,
    },
    secondaryTitle: {
      ...Typography.smallMedium,
      color: theme.textPrimary,
      textAlign: 'center',
    },
    secondaryFooter: {
      marginTop: isCompactScreen ? 6 : Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    secondaryAction: {
      ...Typography.caption,
      color: theme.textSecondary,
    },
  });
};
