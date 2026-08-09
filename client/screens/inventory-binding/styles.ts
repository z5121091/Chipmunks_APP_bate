import { Dimensions, StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, BorderWidth, Theme } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme) => {
  const { width, height } = Dimensions.get('window');
  const isCompactScreen = width <= 390 || height <= 760;

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: isCompactScreen ? 10 : Spacing.sm,
      paddingTop: isCompactScreen ? 10 : Spacing.sm,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 0,
      paddingBottom: Spacing['2xl'],
      gap: Spacing.xs,
    },
    emptyContainer: {
      flexGrow: 1,
    },
    backButton: {
      width: 34,
      height: 34,
      borderRadius: BorderRadius.md,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.borderLight,
    },
    // 顶部区域：统计 + 按钮
    topSection: {
      marginBottom: Spacing.xs,
    },
    toolbarCard: {
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
      paddingVertical: 0,
      gap: isCompactScreen ? Spacing.xs : Spacing.sm,
    },
    toolRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      width: '100%',
      gap: isCompactScreen ? 4 : 6,
      rowGap: isCompactScreen ? 5 : 6,
    },
    toolButtonWrap: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
    },
    toolButtonImportWrap: {
      flex: 1,
      flexBasis: 0,
      minWidth: 0,
    },
    toolButton: {
      width: '100%',
      paddingHorizontal: isCompactScreen ? 4 : 6,
    },
    // 列表区域
    listSection: {
      flex: 1,
    },
    searchBar: {
      minHeight: isCompactScreen ? 48 : 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: isCompactScreen ? 6 : Spacing.xs,
      paddingLeft: 6,
      paddingRight: 6,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: BorderRadius.lg,
      backgroundColor: theme.backgroundDefault,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.12 : 0.03,
      shadowRadius: 10,
      elevation: 2,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      fontSize: rf(14),
      color: theme.textPrimary,
    },
    searchIconBtn: {
      width: 30,
      height: 30,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.backgroundTertiary,
    },
    searchSubmitPill: {
      height: isCompactScreen ? 34 : 36,
      minWidth: isCompactScreen ? 54 : 60,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      borderRadius: BorderRadius.full,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchSubmitPillText: {
      fontSize: rf(12),
      fontWeight: '700',
      color: theme.buttonPrimaryText,
      includeFontPadding: false,
    },
    pageSummary: {
      fontSize: rf(12),
      color: theme.textMuted,
      marginBottom: Spacing.xs,
      paddingHorizontal: 2,
    },
    listContent: {
      gap: Spacing.xs,
    },
    paginationBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: isCompactScreen ? Spacing.xs : Spacing.sm,
      marginTop: isCompactScreen ? Spacing.sm : Spacing.md,
      marginBottom: isCompactScreen ? Spacing.md : Spacing.lg,
      paddingHorizontal: isCompactScreen ? Spacing.xs : Spacing.sm,
      paddingVertical: isCompactScreen ? 6 : Spacing.xs,
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
    },
    paginationBtnWrap: {
      flexShrink: 0,
    },
    paginationBtn: {
      minWidth: isCompactScreen ? 84 : 96,
      paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm + 2,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
    },
    paginationBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    paginationBtnDisabled: {
      opacity: 0.45,
    },
    paginationBtnText: {
      fontSize: rf(13),
      fontWeight: '600',
      color: theme.textPrimary,
    },
    paginationBtnTextDisabled: {
      color: theme.textMuted,
    },
    paginationInfo: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paginationInfoText: {
      fontSize: rf(14),
      fontWeight: '700',
      color: theme.textPrimary,
    },
    paginationInfoSubText: {
      marginTop: 2,
      fontSize: rf(11),
      color: theme.textMuted,
    },
    // 绑定卡片
    bindingCard: {
      overflow: 'hidden',
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.12 : 0.03,
      shadowRadius: 10,
      elevation: 2,
    },
    bindingHeaderRow: {
      minHeight: isCompactScreen ? 48 : 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      paddingVertical: isCompactScreen ? 8 : Spacing.sm,
    },
    bindingModel: {
      flex: 1,
      minWidth: 0,
      fontSize: rf(15),
      fontWeight: '800',
      color: theme.textPrimary,
      lineHeight: rf(21),
    },
    bindingExpandedContent: {
      borderTopWidth: BorderWidth.thin,
      borderTopColor: theme.borderLight,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      paddingTop: Spacing.xs,
      paddingBottom: isCompactScreen ? Spacing.sm : Spacing.md,
      gap: Spacing.xs,
    },
    bindingMetaRow: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
    },
    bindingMetaLabel: {
      fontSize: rf(11),
      color: theme.textMuted,
      fontWeight: '700',
      flexShrink: 0,
    },
    bindingMetaValue: {
      fontSize: rf(12),
      color: theme.textSecondary,
      fontWeight: '700',
      textAlign: 'right',
      flex: 1,
      minWidth: 0,
    },
    bindingFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: Spacing.xs,
      paddingTop: Spacing.xs,
    },
    actionBtn: {
      minWidth: isCompactScreen ? 56 : 64,
      minHeight: isCompactScreen ? 32 : 34,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.md,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.thin,
      borderColor: theme.borderLight,
    },
    actionBtnDanger: {
      backgroundColor: withAlpha(theme.error, theme.isDark ? 0.18 : 0.08),
      borderColor: withAlpha(theme.error, theme.isDark ? 0.28 : 0.18),
    },
    actionBtnText: {
      fontSize: rf(12),
      fontWeight: '700',
      color: theme.textSecondary,
    },
    actionBtnTextDanger: {
      color: theme.error,
    },
    // 空状态
    emptyState: {
      alignItems: 'center',
      paddingVertical: isCompactScreen ? Spacing.xl : Spacing['2xl'],
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
    },
    emptyTitle: {
      fontSize: rf(14),
      fontWeight: '600',
      color: theme.textSecondary,
      marginTop: Spacing.sm,
      marginBottom: 2,
    },
    emptyDesc: {
      fontSize: rf(12),
      color: theme.textMuted,
    },
    // Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    modalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
    },
    modalBody: {
      paddingBottom: Spacing.sm,
    },
    dataToolsBody: {
      gap: Spacing.sm,
      paddingBottom: Spacing.sm,
    },
    formGroupLast: {
      marginBottom: 0,
    },
    input: {
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: rf(14),
      color: theme.textPrimary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      minHeight: 44,
    },
    modalActions: {
      marginTop: 0,
    },
  });
};
