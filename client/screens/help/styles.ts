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
    
    // 模块块
    moduleBlock: {
      marginBottom: Spacing.xl,
      paddingBottom: Spacing.md,
      borderBottomWidth: BorderWidth.thin,
      borderBottomColor: theme.borderLight,
    },
    moduleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    moduleIcon: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.sm,
      backgroundColor: withAlpha(theme.primary, 0.08),
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.sm,
    },
    moduleTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.primary,
    },
    
    // 子项
    itemContainer: {
      marginBottom: Spacing.md,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    itemNumber: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.primary,
      marginRight: Spacing.xs,
      minWidth: 28,
      marginTop: 1,
    },
    itemContent: {
      flex: 1,
    },
    itemTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
      marginBottom: Spacing.xs,
    },
    itemDescription: {
      fontSize: 13,
      color: theme.textSecondary,
      lineHeight: 20,
    },
    
    // 提示框
    tipBox: {
      marginTop: Spacing.xs,
      padding: Spacing.sm,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.sm,
    },
    tipText: {
      fontSize: 12,
      color: theme.textMuted,
      lineHeight: 18,
    },
  });
};
