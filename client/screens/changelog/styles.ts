import { StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';

export const createStyles = (theme: Theme) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      padding: Spacing.md,
      paddingBottom: Spacing["4xl"],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    backButton: {
      padding: Spacing.sm,
      marginRight: Spacing.sm,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    versionBlock: {
      marginBottom: Spacing.xl,
      paddingBottom: Spacing.md,
      borderBottomWidth: BorderWidth.thin,
      borderBottomColor: theme.borderLight,
    },
    versionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    versionText: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.primary,
    },
    dateText: {
      fontSize: 12,
      color: theme.textMuted,
      marginLeft: Spacing.sm,
    },
    changeItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: Spacing.sm,
    },
    changeTag: {
      paddingHorizontal: Spacing.xs,
      paddingVertical: 1,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.sm,
      minWidth: 36,
      alignItems: 'center',
    },
    tagFeat: {
      backgroundColor: withAlpha(theme.success, 0.08),
    },
    tagFix: {
      backgroundColor: withAlpha(theme.error, 0.08),
    },
    tagImprove: {
      backgroundColor: withAlpha(theme.primary, 0.08),
    },
    tagTextFeat: {
      fontSize: 10,
      fontWeight: '600',
      color: theme.success,
    },
    tagTextFix: {
      fontSize: 10,
      fontWeight: '600',
      color: theme.error,
    },
    tagTextImprove: {
      fontSize: 10,
      fontWeight: '600',
      color: theme.primary,
    },
    changeText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
    },
  });
};
