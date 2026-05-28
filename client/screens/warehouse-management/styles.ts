import { StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme) => {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing["4xl"],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
      padding: Spacing.lg,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: theme.isDark ? 0.2 : 0.08,
      shadowRadius: 18,
      elevation: 4,
    },
    backButton: {
      padding: Spacing.sm,
      marginRight: Spacing.sm,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerContent: {
      flex: 1,
    },
    title: {
      fontSize: rf(20),
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: rf(12),
      color: theme.textSecondary,
      marginTop: 2,
    },
    sectionHeader: {
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: rf(12),
      fontWeight: '600',
      color: theme.textMuted,
      textTransform: 'uppercase' as const,
      letterSpacing: 1,
    },
    // 仓库卡片
    warehouseCard: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 14,
      elevation: 3,
    },
    warehouseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    warehouseInfo: {
      flex: 1,
    },
    warehouseName: {
      fontSize: rf(14),
      fontWeight: '600',
      color: theme.textPrimary,
      marginBottom: 2,
    },
    warehouseDesc: {
      fontSize: rf(12),
      color: theme.textMuted,
    },
    warehouseActions: {
      flexDirection: 'row',
      gap: Spacing.xs,
    },
    actionButtonWrap: {
      width: 30,
      height: 30,
    },
    actionButton: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.backgroundTertiary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionButtonDisabled: {
      opacity: 0.35,
    },
    defaultBadge: {
      backgroundColor: withAlpha(theme.primary, 0.08),
      paddingHorizontal: Spacing.sm,
      paddingVertical: 1,
      borderRadius: BorderRadius.sm,
      marginLeft: Spacing.xs,
    },
    defaultBadgeText: {
      fontSize: rf(10),
      color: theme.primary,
      fontWeight: '600',
    },
    // 添加按钮
    addButton: {
      backgroundColor: theme.primary,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.sm + 2,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 148,
    },
    addButtonWrap: {
      alignSelf: 'center',
      marginTop: Spacing.sm,
    },
    addButtonText: {
      color: theme.buttonPrimaryText,
      fontSize: rf(13),
      fontWeight: '700',
    },
    // Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
    },
    modalCardFrame: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
      alignSelf: 'center',
    },
    modalBody: {
      paddingBottom: Spacing.md,
    },
    modalActions: {
      marginTop: 0,
    },
    input: {
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm + 2,
      fontSize: rf(14),
      color: theme.textPrimary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      minHeight: 46,
    },
    // 空状态
    emptyState: {
      alignItems: 'center',
      paddingVertical: Spacing["2xl"],
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.backgroundTertiary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      fontSize: rf(14),
      color: theme.textMuted,
      marginTop: Spacing.sm,
    },
    emptyTitle: {
      fontSize: rf(16),
      fontWeight: '600',
      color: theme.textPrimary,
      marginTop: Spacing.md,
    },
    emptyDesc: {
      fontSize: rf(13),
      color: theme.textMuted,
      marginTop: Spacing.xs,
      textAlign: 'center',
    },
  });
};
