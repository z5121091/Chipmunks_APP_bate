import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { rf } from '@/utils/responsive';
import { withAlpha } from '@/utils/colors';

export const createStyles = (theme: Theme) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      padding: Spacing.md,
      paddingBottom: 100,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: Spacing.md,
      marginTop: Spacing.sm,
      marginBottom: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.lg,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      gap: Spacing.sm,
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
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 12,
      color: theme.textSecondary,
      marginTop: 2,
    },
    addButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
    },
    addButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: Spacing["4xl"],
      paddingHorizontal: Spacing.xl,
    },
    emptyIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.backgroundTertiary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.textPrimary,
      marginBottom: Spacing.sm,
    },
    emptyText: {
      fontSize: 14,
      color: theme.textMuted,
      textAlign: 'center',
      lineHeight: 20,
    },
    // 规则卡片（紧凑版）
    ruleItem: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      padding: Spacing.lg,
      paddingRight: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: rf(56),
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 16,
      elevation: 3,
    },
    ruleContent: {
      flex: 1,
      justifyContent: 'center',
    },
    ruleSwitch: {
      marginLeft: Spacing.sm,
      justifyContent: 'center',
    },
    ruleName: {
      fontSize: rf(16),
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: rf(2),
    },
    ruleSeparator: {
      fontSize: rf(13),
      color: theme.textSecondary,
    },
    ruleFields: {
      fontSize: rf(12),
      color: theme.accent,
      marginTop: rf(2),
    },
    // 弹窗样式
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
      maxHeight: '85%',
    },
    ruleEditorScreen: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    ruleEditorHeader: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    ruleEditorBody: {
      flex: 1,
    },
    ruleEditorBodyContent: {
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing['3xl'],
    },
    ruleEditorFooter: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      backgroundColor: withAlpha(theme.backgroundTertiary, theme.isDark ? 0.26 : 0.42),
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
    },
    ruleEditorActions: {
      marginTop: 0,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.lg,
      borderBottomWidth: BorderWidth.normal,
      borderBottomColor: theme.border,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    modalClose: {
      fontSize: 20,
      color: theme.textSecondary,
    },
    modalBody: {
      paddingBottom: 0,
    },
    modalBodyContent: {
      paddingBottom: Spacing['3xl'],
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.textPrimary,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    textInput: {
      fontSize: 16,
      color: theme.textPrimary,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.md,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    textArea: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    separatorOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    separatorBtn: {
      minWidth: 44,
      height: 40,
      paddingHorizontal: Spacing.sm,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    separatorBtnActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    separatorBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    separatorBtnTextActive: {
      color: theme.buttonPrimaryText,
    },
    fieldOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    fieldBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    fieldBtnActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    fieldBtnText: {
      fontSize: 14,
      color: theme.textPrimary,
    },
    fieldBtnTextActive: {
      color: theme.buttonPrimaryText,
      fontWeight: '600',
    },
    selectedFieldsContainer: {
      marginTop: Spacing.lg,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    selectedFieldsLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.textPrimary,
      marginBottom: Spacing.sm,
    },
    selectedFieldItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.xs,
    },
    selectedFieldIndex: {
      fontSize: 14,
      color: theme.textSecondary,
      width: 24,
    },
    selectedFieldName: {
      fontSize: 14,
      color: theme.textPrimary,
      flex: 1,
    },
    customTag: {
      paddingHorizontal: Spacing.xs,
      paddingVertical: 2,
      borderRadius: BorderRadius.sm,
      marginLeft: Spacing.xs,
    },
    customTagText: {
      fontSize: 10,
      fontWeight: '500',
    },
    selectedFieldActions: {
      flexDirection: 'row',
      gap: Spacing.md,
    },
    moveBtn: {
      fontSize: 16,
      color: theme.textSecondary,
      paddingHorizontal: Spacing.sm,
    },
    // 识别条件样式
    sectionContainer: {
      marginTop: Spacing.xl,
      paddingTop: Spacing.lg,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
    },
    sectionHint: {
      fontSize: 12,
      color: theme.textMuted,
      marginBottom: Spacing.lg,
      marginTop: Spacing.xs,
    },
    conditionsList: {
      marginBottom: Spacing.md,
    },
    conditionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.thick,
      borderColor: theme.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: 12,
      marginBottom: Spacing.sm,
    },
    conditionText: {
      fontSize: 15,
      color: theme.textPrimary,
      flex: 1,
    },
    removeConditionBtn: {
      fontSize: 16,
      color: theme.error,
      width: 28,
      textAlign: 'center',
    },
    addConditionContainer: {
      marginTop: Spacing.sm,
      position: 'relative',
    },
    conditionInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.thick,
      borderColor: theme.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: 12,
      marginBottom: Spacing.sm,
    },
    inputRowLabel: {
      fontSize: 15,
      color: theme.textSecondary,
      width: 75,
      flexShrink: 0,
    },
    inputRowField: {
      flex: 1,
      fontSize: 15,
      color: theme.textPrimary,
    },
    conditionLabel: {
      fontSize: 15,
      color: theme.textSecondary,
      flexShrink: 0,
    },
    fieldSelectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    fieldSelectText: {
      fontSize: 15,
      color: theme.textPrimary,
      marginRight: 4,
    },
    conditionKeywordInput: {
      flex: 1,
      fontSize: 15,
      color: theme.textPrimary,
    },
    addConditionBtn: {
      width: 28,
      height: 28,
      backgroundColor: theme.primary,
      borderRadius: 6,
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 0,
      marginLeft: Spacing.sm,
    },
    addConditionBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    noFieldsHint: {
      fontSize: 13,
      color: theme.textMuted,
      marginTop: Spacing.sm,
    },
    customFieldsSection: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
    },
    modalFooter: {
      gap: Spacing.md,
    },
    modalActions: {
      marginTop: 0,
    },
    // 提示文字
    hint: {
      fontSize: 13,
      color: theme.textMuted,
      marginTop: Spacing.sm,
    },
  });
};
