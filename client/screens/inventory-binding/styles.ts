import { Dimensions, StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, BorderWidth, Theme } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';

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
      paddingBottom: Spacing["2xl"],
    },
    emptyContainer: {
      flexGrow: 1,
    },
    // 头部
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: isCompactScreen ? Spacing.xs : Spacing.sm,
      gap: Spacing.sm,
      padding: isCompactScreen ? Spacing.md : Spacing.lg,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: theme.isDark ? 0.2 : 0.08,
      shadowRadius: 18,
      elevation: 4,
    },
    backButton: {
      padding: Spacing.sm,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerContent: {
      flex: 1,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.textPrimary,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 12,
      color: theme.textSecondary,
      marginTop: 2,
    },
    // 顶部区域：统计 + 按钮
    topSection: {
      marginBottom: Spacing.xs,
    },
    toolbarCard: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.xl,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      paddingVertical: isCompactScreen ? Spacing.sm : Spacing.md,
      gap: isCompactScreen ? Spacing.xs : Spacing.sm,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.14 : 0.04,
      shadowRadius: 12,
      elevation: 2,
    },
    toolbarHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    toolbarTitleWrap: {
      flex: 1,
    },
    toolbarTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    toolbarSubtitle: {
      marginTop: 2,
      fontSize: 12,
      color: theme.textMuted,
    },
    toolbarMeta: {
      flex: 1,
      fontSize: 12,
      color: theme.textSecondary,
      marginRight: Spacing.sm,
    },
    countChip: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: withAlpha(theme.primary, 0.1),
    },
    countChipText: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.primary,
    },
    toolRow: {
      gap: isCompactScreen ? 6 : Spacing.xs,
      paddingRight: Spacing.xs,
    },
    toolButtonWrap: {
      width: 'auto',
    },
    toolButton: {
      minWidth: isCompactScreen ? 74 : 82,
      paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
    },
    toolButtonActive: {
      backgroundColor: withAlpha(theme.primary, 0.14),
    },
    toolButtonPrimary: {
      backgroundColor: theme.primary,
    },
    toolButtonInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    toolButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.primary,
    },
    toolButtonTextMuted: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    toolButtonTextPrimary: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.buttonPrimaryText,
    },
    // 列表区域
    listSection: {
      flex: 1,
    },
    searchPanel: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.lg,
      padding: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
      gap: isCompactScreen ? Spacing.xs : Spacing.sm,
      borderWidth: 1,
      borderColor: theme.border,
    },
    searchInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    searchInput: {
      flex: 1,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
      fontSize: 14,
      color: theme.textPrimary,
    },
    searchActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: Spacing.sm,
    },
    searchActionWrap: {
      width: 'auto',
    },
    searchClearBtn: {
      minWidth: 76,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchClearBtnText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    searchSubmitBtn: {
      minWidth: 88,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.primary,
    },
    searchSubmitInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    searchSubmitBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    pageSummary: {
      fontSize: 12,
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
      fontSize: 13,
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
      fontSize: 14,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    paginationInfoSubText: {
      marginTop: 2,
      fontSize: 11,
      color: theme.textMuted,
    },
    // 绑定卡片
    bindingCard: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.md,
      paddingVertical: isCompactScreen ? Spacing.sm : Spacing.sm + 2,
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
    },
    bindingMain: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    bindingInfo: {
      flex: 1,
    },
    // 型号行
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: isCompactScreen ? Spacing.xs : Spacing.sm,
    },
    bindingModel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
      flex: 1,
    },
    supplierBadge: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 1,
      borderRadius: 4,
      maxWidth: 100,
    },
    supplierBadgeText: {
      fontSize: 10,
      fontWeight: '500',
    },
    // 编码行
    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    // 供应商行
    supplierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    supplierText: {
      fontSize: 11,
      color: theme.accent,
      flex: 1,
    },
    bindingCode: {
      fontSize: 13,
      color: theme.primary,
      fontWeight: '500',
      flex: 1,
    },
    // 操作列
    actionColumn: {
      flexDirection: 'row',
      gap: 4,
    },
    iconBtn: {
      width: isCompactScreen ? 30 : 32,
      height: isCompactScreen ? 30 : 32,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.backgroundTertiary,
    },
    // 空状态
    emptyState: {
      alignItems: 'center',
      paddingVertical: isCompactScreen ? Spacing.xl : Spacing["2xl"],
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
      marginTop: Spacing.sm,
      marginBottom: 2,
    },
    emptyDesc: {
      fontSize: 12,
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
    formGroupLast: {
      marginBottom: 0,
    },
    input: {
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: 14,
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
