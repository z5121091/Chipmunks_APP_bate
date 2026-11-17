import { Dimensions, StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { scaleControlSize, rf } from '@/utils/responsive';

// 两部分均由末尾的完整输入缓存统一管理，避免基底复用旧窗口的 responsive tokens。
const getBaseStyles = (theme: Theme) => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xl,
    },
    settingsOverview: {
      gap: Spacing.sm,
    },
    settingsGroupPanel: {
      gap: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      paddingBottom: Spacing.xs,
    },
    autoBackupDiagnosticCard: {
      gap: Spacing.xs,
      padding: Spacing.md,
      borderRadius: BorderRadius.lg,
      backgroundColor: theme.backgroundDefault,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    autoBackupDiagnosticHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      marginBottom: 2,
    },
    autoBackupDiagnosticTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: rf(13),
      fontWeight: '800',
      color: theme.textPrimary,
    },
    autoBackupDiagnosticBadge: {
      minHeight: 26,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    autoBackupDiagnosticBadgeText: {
      fontSize: rf(11),
      fontWeight: '800',
    },
    autoBackupDiagnosticBadgeSuccess: {
      backgroundColor: withAlpha(theme.success, theme.isDark ? 0.2 : 0.12),
    },
    autoBackupDiagnosticBadgeWarning: {
      backgroundColor: withAlpha(theme.warning, theme.isDark ? 0.22 : 0.14),
    },
    autoBackupDiagnosticBadgeError: {
      backgroundColor: withAlpha(theme.error, theme.isDark ? 0.2 : 0.1),
    },
    autoBackupDiagnosticBadgeTextSuccess: {
      color: theme.success,
    },
    autoBackupDiagnosticBadgeTextWarning: {
      color: theme.warning,
    },
    autoBackupDiagnosticBadgeTextError: {
      color: theme.error,
    },
    autoBackupDiagnosticRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      paddingTop: 2,
    },
    autoBackupDiagnosticLabel: {
      width: 66,
      fontSize: rf(11),
      lineHeight: rf(17),
      fontWeight: '700',
      color: theme.textMuted,
    },
    autoBackupDiagnosticValue: {
      flex: 1,
      minWidth: 0,
      textAlign: 'right',
      fontSize: rf(12),
      lineHeight: rf(17),
      color: theme.textSecondary,
    },
    autoBackupDiagnosticValueError: {
      color: theme.error,
    },
    autoBackupDiagnosticDivider: {
      height: BorderWidth.thin,
      marginVertical: Spacing.xs,
      backgroundColor: theme.borderLight,
    },
    autoBackupProtectionBox: {
      gap: Spacing.xs,
      marginTop: Spacing.xs,
      padding: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: withAlpha(theme.primary, theme.isDark ? 0.16 : 0.08),
      borderWidth: BorderWidth.thin,
      borderColor: withAlpha(theme.primary, theme.isDark ? 0.26 : 0.16),
    },
    autoBackupProtectionTitle: {
      fontSize: rf(12),
      lineHeight: rf(18),
      fontWeight: '800',
      color: theme.textPrimary,
    },
    autoBackupProtectionText: {
      fontSize: rf(11),
      lineHeight: rf(17),
      color: theme.textSecondary,
    },
    autoBackupProtectionButton: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
      marginTop: 2,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.primary,
    },
    autoBackupProtectionButtonText: {
      fontSize: rf(12),
      fontWeight: '800',
      color: theme.buttonPrimaryText,
    },
    // 模块标题
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.xs,
      marginTop: Spacing.lg,
    },
    sectionTitle: {
      fontSize: rf(13),
      fontWeight: '800',
      color: theme.textPrimary,
    },
    addButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.sm,
    },
    addButtonText: {
      fontSize: rf(12),
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    // 导出卡片样式
    exportCard: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 58,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    exportCardContainer: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      overflow: 'hidden',
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.12 : 0.03,
      shadowRadius: 10,
      elevation: 2,
    },
    exportIcon: {
      width: scaleControlSize(38),
      height: scaleControlSize(38),
      borderRadius: BorderRadius.md,
      backgroundColor: withAlpha(theme.primary, 0.06),
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.sm,
    },
    exportInfo: {
      flex: 1,
    },
    exportTitle: {
      fontSize: rf(14),
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 1,
    },
    exportDesc: {
      fontSize: rf(11),
      color: theme.textMuted,
      lineHeight: rf(14),
    },
    rightText: {
      fontSize: rf(12),
      fontWeight: '600',
    },
    // 数据统计卡片样式
    statsCard: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      padding: Spacing.xl,
      marginBottom: Spacing.lg,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 16,
      elevation: 3,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    statsItem: {
      alignItems: 'center',
    },
    statsNumber: {
      fontSize: rf(28),
      fontWeight: '700',
      color: theme.primary,
    },
    statsLabel: {
      fontSize: rf(12),
      color: theme.textMuted,
      marginTop: Spacing.xs,
    },
    // 规则卡片 - 增加间距
    ruleItem: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      padding: Spacing.xl,
      marginBottom: Spacing.lg,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 16,
      elevation: 3,
    },
    ruleHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    ruleInfo: {
      flex: 1,
      marginRight: Spacing.md,
    },
    ruleName: {
      fontSize: rf(17),
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 4,
    },
    ruleSeparator: {
      fontSize: rf(13),
      color: theme.textSecondary,
      fontWeight: '500',
    },
    ruleFieldsPreview: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginBottom: Spacing.md,
    },
    fieldTag: {
      backgroundColor: withAlpha(theme.primary, 0.08),
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: BorderRadius.sm,
    },
    fieldTagText: {
      fontSize: rf(12),
      color: theme.primary,
      fontWeight: '500',
    },
    moreFieldsText: {
      fontSize: rf(12),
      color: theme.textSecondary,
      alignSelf: 'center',
    },
    ruleActions: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      paddingTop: Spacing.md,
    },
    ruleActionButton: {
      flex: 1,
      paddingVertical: Spacing.sm,
      alignItems: 'center',
    },
    ruleActionText: {
      fontSize: rf(14),
      fontWeight: '600',
      color: theme.textSecondary,
    },
    deleteAction: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.border,
    },
    deleteText: {
      color: theme.error,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: Spacing['4xl'],
    },
    emptyText: {
      fontSize: rf(14),
      color: theme.textMuted,
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
    modalBody: {
      paddingBottom: 0,
    },
    modalScrollArea: { flex: 1, minHeight: 0 },
    modalBodyContent: {
      paddingBottom: Spacing['3xl'],
    },
    modalActions: {
      marginTop: 0,
    },
    inputLabel: {
      fontSize: rf(14),
      fontWeight: '500',
      color: theme.textPrimary,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    textInput: {
      fontSize: rf(16),
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
      fontSize: rf(14),
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
      fontSize: rf(14),
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
      fontSize: rf(14),
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
      fontSize: rf(14),
      color: theme.textSecondary,
      width: 24,
    },
    selectedFieldName: {
      fontSize: rf(14),
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
      fontSize: rf(10),
      fontWeight: '500',
    },
    selectedFieldActions: {
      flexDirection: 'row',
      gap: Spacing.md,
    },
    moveBtn: {
      fontSize: rf(16),
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
      fontSize: rf(12),
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
      fontSize: rf(15),
      color: theme.textPrimary,
      flex: 1,
    },
    removeConditionBtn: {
      fontSize: rf(16),
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
      fontSize: rf(15),
      color: theme.textSecondary,
      width: 75,
      flexShrink: 0,
    },
    inputRowField: {
      flex: 1,
      fontSize: rf(15),
      color: theme.textPrimary,
    },
    conditionLabel: {
      fontSize: rf(15),
      color: theme.textSecondary,
      flexShrink: 0,
    },
    fieldSelectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    fieldSelectText: {
      fontSize: rf(15),
      color: theme.textPrimary,
      marginRight: 4,
    },
    conditionKeywordInput: {
      flex: 1,
      fontSize: rf(15),
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
      fontSize: rf(16),
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    noFieldsHint: {
      fontSize: rf(13),
      color: theme.textMuted,
      marginTop: Spacing.sm,
    },
    modalFooter: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xl,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
      gap: Spacing.md,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    cancelButtonText: {
      fontSize: rf(16),
      fontWeight: '600',
      color: theme.textPrimary,
    },
    saveButton: {
      flex: 1,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.md,
      backgroundColor: theme.primary,
    },
    saveButtonText: {
      fontSize: rf(16),
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    // 关于卡片样式
    aboutCard: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.thick,
      borderColor: theme.border,
      overflow: 'hidden',
      alignItems: 'center',
    },
    aboutAppSection: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    aboutLogo: {
      width: scaleControlSize(24),
      height: scaleControlSize(24),
      borderRadius: BorderRadius.sm,
      backgroundColor: withAlpha(theme.primary, 0.08),
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.xs,
    },
    aboutAppInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: Spacing.xs,
    },
    aboutAppName: {
      fontSize: rf(15),
      fontWeight: '700',
      color: theme.textPrimary,
      marginRight: Spacing.sm,
    },
    aboutVersion: {
      fontSize: rf(12),
      color: theme.textSecondary,
    },
    aboutVersionBadge: {
      backgroundColor: withAlpha(theme.primary, 0.08),
      paddingHorizontal: Spacing.lg,
      paddingVertical: 4,
      borderRadius: BorderRadius.sm,
    },
    aboutVersionText: {
      fontSize: rf(13),
      fontWeight: '600',
      color: theme.primary,
    },
    aboutDivider: {
      width: '100%',
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    aboutDetailsSection: {
      width: '100%',
      paddingHorizontal: Spacing.lg,
      paddingVertical: 4,
    },
    aboutDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 32,
      paddingVertical: 2,
    },
    aboutDetailIconWrapper: {
      width: scaleControlSize(20),
      alignItems: 'center',
      marginRight: Spacing.xs,
    },
    aboutDetailLabel: {
      fontSize: rf(13),
      color: theme.textSecondary,
      width: scaleControlSize(64),
    },
    aboutDetailRight: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    aboutDetailValue: {
      fontSize: rf(13),
      color: theme.textPrimary,
      fontWeight: '500',
      flex: 1,
      textAlign: 'center',
    },
    aboutDetailAccessorySpacer: {
      width: scaleControlSize(12),
    },
    // 使用说明和更新日志入口 - 水平排列
    helpRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
      gap: Spacing['2xl'],
    },
    helpEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 32,
      paddingVertical: 4,
    },
    helpIconWrapper: {
      marginRight: Spacing.xs,
    },
    helpText: {
      fontSize: rf(13),
      color: theme.textMuted,
      marginRight: Spacing.xs,
    },
    // 更新日志入口（旧样式，保留兼容）
    changelogEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.lg,
      marginTop: Spacing.sm,
    },
    changelogIconWrapper: {
      marginRight: Spacing.xs,
    },
    changelogText: {
      fontSize: rf(13),
      color: theme.textMuted,
      marginRight: Spacing.xs,
    },
    // 更新日志弹窗
    changelogModalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
    },
    changelogModalContent: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius['2xl'],
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
      maxHeight: '75%',
      shadowColor: theme.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
      overflow: 'hidden',
    },
    changelogModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
      backgroundColor: withAlpha(theme.primary, 0.05),
    },
    changelogModalTitle: {
      fontSize: rf(18),
      fontWeight: '700',
      color: theme.textPrimary,
      flex: 1,
      marginLeft: Spacing.sm,
    },
    changelogModalBody: {
      padding: Spacing.xl,
      maxHeight: 400,
    },
    changelogModalBodyContent: {
      paddingBottom: Spacing.xl,
    },
    changelogVersionBlock: {
      marginBottom: Spacing.xl,
      paddingBottom: Spacing.lg,
      borderBottomWidth: BorderWidth.thin,
      borderBottomColor: theme.borderLight,
    },
    changelogVersionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    changelogVersionText: {
      fontSize: rf(16),
      fontWeight: '700',
      color: theme.primary,
    },
    changelogDateText: {
      fontSize: rf(12),
      color: theme.textMuted,
      marginLeft: Spacing.sm,
    },
    changelogChangesList: {
      gap: Spacing.sm,
    },
    changelogChangeItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    changelogChangeTag: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.sm,
      minWidth: 40,
      alignItems: 'center',
    },
    changelogChangeTagText: {
      fontSize: rf(11),
      fontWeight: '600',
    },
    // 预定义标签样式（避免内联样式计算）
    tagFeat: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.sm,
      minWidth: 40,
      alignItems: 'center',
      backgroundColor: withAlpha(theme.primary, 0.08),
    },
    tagFix: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.sm,
      minWidth: 40,
      alignItems: 'center',
      backgroundColor: withAlpha(theme.success, 0.08),
    },
    tagImprove: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.sm,
      minWidth: 40,
      alignItems: 'center',
      backgroundColor: withAlpha(theme.accent, 0.08),
    },
    tagTextFeat: {
      fontSize: rf(11),
      fontWeight: '600',
      color: theme.primary,
    },
    tagTextFix: {
      fontSize: rf(11),
      fontWeight: '600',
      color: theme.success,
    },
    tagTextImprove: {
      fontSize: rf(11),
      fontWeight: '600',
      color: theme.accent,
    },
    changelogChangeText: {
      fontSize: rf(13),
      color: theme.textSecondary,
      flex: 1,
      lineHeight: 20,
    },
    changelogModalFooter: {
      padding: Spacing.lg,
      paddingHorizontal: Spacing.xl,
      backgroundColor: theme.backgroundTertiary,
    },
    changelogCloseBtn: {
      backgroundColor: theme.primary,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
    },
    changelogCloseBtnText: {
      fontSize: rf(15),
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    // 电脑同步样式
    syncConfigCard: {
      backgroundColor: theme.backgroundDefault,
      borderRadius: BorderRadius.lg,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.12 : 0.03,
      shadowRadius: 10,
      elevation: 2,
    },
    syncAssistantHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: Spacing.sm,
      marginBottom: Spacing.sm,
      borderBottomWidth: BorderWidth.normal,
      borderBottomColor: theme.border,
    },
    syncAssistantIcon: {
      width: scaleControlSize(40),
      height: scaleControlSize(40),
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.sm,
    },
    syncAssistantInfo: {
      flex: 1,
    },
    syncAssistantTitle: {
      fontSize: rf(14),
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 2,
    },
    syncAssistantDesc: {
      fontSize: rf(11),
      color: theme.textMuted,
      lineHeight: rf(15),
    },
    syncConfigRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    syncConfigLabel: {
      fontSize: rf(12),
      fontWeight: '600',
      color: theme.textSecondary,
      width: 58,
    },
    syncConfigInput: {
      flex: 1,
      fontSize: rf(14),
      color: theme.textPrimary,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs + 2,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    syncConfigButtons: {
      flexDirection: 'row',
      marginTop: Spacing.sm,
    },
    syncButtonWrap: {
      flex: 1,
    },
    syncButton: {
      flex: 1,
      minHeight: 42,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    syncButtonTest: {
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.primary,
    },
    syncButtonSuccess: {
      backgroundColor: withAlpha(theme.success, 0.08),
      borderColor: theme.success,
    },
    syncButtonError: {
      backgroundColor: withAlpha(theme.error, 0.08),
      borderColor: theme.error,
    },
    syncButtonTestText: {
      fontSize: rf(13),
      fontWeight: '600',
      color: theme.primary,
    },
    syncButtonSuccessText: {
      color: theme.success,
    },
    syncButtonErrorText: {
      color: theme.error,
    },
    syncButtonSave: {
      backgroundColor: theme.primary,
    },
    syncButtonSaveText: {
      fontSize: rf(14),
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    syncStatusHint: {
      fontSize: rf(11),
      color: theme.success,
      textAlign: 'center',
      marginTop: 4,
    },
    syncStatusHintError: {
      fontSize: rf(11),
      color: theme.error,
      textAlign: 'center',
      marginTop: 4,
    },
    syncStatusHintIdle: {
      fontSize: rf(11),
      color: theme.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
    // 导出卡片禁用状态
    exportCardDisabled: {
      opacity: 0.5,
    },
    // 在线更新模态框样式
    updateModalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    updateModalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    updateModalTitle: {
      fontSize: rf(18),
      fontWeight: '600',
      color: theme.textPrimary,
    },
    updateModalBodyContent: {
      paddingBottom: Spacing.sm,
    },
    updateModalFooter: {
      gap: Spacing.md,
    },
    // 版本信息
    updateVersionInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.lg,
    },
    updateVersionLabel: {
      fontSize: rf(16),
      color: theme.textMuted,
      marginRight: Spacing.sm,
    },
    updateVersionText: {
      fontSize: rf(28),
      fontWeight: '700',
      color: theme.success,
    },
    // 更新日志
    updateChangelogTitle: {
      fontSize: rf(14),
      fontWeight: '600',
      color: theme.textPrimary,
      marginBottom: Spacing.sm,
    },
    updateChangelogText: {
      fontSize: rf(14),
      color: theme.textSecondary,
      lineHeight: 22,
    },
    // 下载进度
    downloadProgress: {
      marginTop: Spacing.lg,
      alignItems: 'center',
    },
    progressBarContainer: {
      width: '100%',
      height: 8,
      backgroundColor: theme.backgroundTertiary,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressBar: {
      height: '100%',
      backgroundColor: theme.success,
      borderRadius: 4,
    },
    progressText: {
      marginTop: Spacing.sm,
      fontSize: rf(14),
      color: theme.textPrimary,
      fontWeight: '500',
    },
    updateButtons: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    updateButtonWrap: {
      flex: 1,
    },
    updateCancelBtn: {
      flex: 1,
      backgroundColor: theme.backgroundTertiary,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    updateCancelText: {
      fontSize: rf(15),
      color: theme.textPrimary,
      fontWeight: '500',
    },
    updateInstallBtn: {
      flex: 1,
      backgroundColor: theme.success,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    updateInstallText: {
      fontSize: rf(15),
      color: theme.white,
      fontWeight: '600',
    },
    // 重启弹窗样式
    restartModalOverlay: {
      flex: 1,
      backgroundColor: withAlpha(theme.textPrimary, 0.5),
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
    },
    restartModalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
    },
    restartModalBody: {
      alignItems: 'center',
    },
    restartModalIcon: {
      width: scaleControlSize(80),
      height: scaleControlSize(80),
      borderRadius: scaleControlSize(40),
      backgroundColor: withAlpha(theme.accent, 0.1),
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    restartModalTitle: {
      fontSize: rf(20),
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    restartModalMessage: {
      fontSize: rf(15),
      color: theme.textSecondary,
      marginBottom: Spacing.md,
      textAlign: 'center',
      lineHeight: rf(22),
    },
    restartModalWarningContainer: {
      backgroundColor: withAlpha(theme.warning, 0.1),
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      width: '100%',
      alignItems: 'center',
    },
    restartModalWarningTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    restartModalWarning: {
      fontSize: rf(17),
      color: theme.warning,
      fontWeight: '700',
      textAlign: 'center',
    },
    restartModalWarningSub: {
      fontSize: rf(14),
      color: theme.warning,
      textAlign: 'center',
      lineHeight: rf(20),
    },
  });

const getDynamicStyles = (
  screenWidth?: number,
  screenHeight?: number
) => {
  const sw = screenWidth ?? 0;
  const sh = screenHeight ?? 0;

  const isCompactScreen = sw <= 390 || sh <= 760;
  return {
    scrollContent: {
      paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
      paddingTop: isCompactScreen ? Spacing.xs : Spacing.sm,
      paddingBottom: Spacing.xl,
    },
    sectionHeader: {
      marginTop: Spacing.md,
    },
    exportCard: {
      minHeight: isCompactScreen ? 54 : 58,
      paddingVertical: isCompactScreen ? 6 : Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    exportIcon: {
      width: isCompactScreen ? scaleControlSize(32) : scaleControlSize(36),
      height: isCompactScreen ? scaleControlSize(32) : scaleControlSize(36),
    },
    statsCard: {
      padding: isCompactScreen ? Spacing.lg : Spacing.xl,
      marginBottom: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    ruleItem: {
      padding: isCompactScreen ? Spacing.md : Spacing.lg,
      marginBottom: isCompactScreen ? Spacing.sm : Spacing.md,
    },
    syncConfigCard: {
      padding: isCompactScreen ? Spacing.sm : Spacing.md,
    },
    syncAssistantIcon: {
      width: isCompactScreen ? scaleControlSize(36) : scaleControlSize(40),
      height: isCompactScreen ? scaleControlSize(36) : scaleControlSize(40),
    },
  } as const;

};

// 最终合并结果的缓存 key
interface StylesCache {
  theme: Theme;
  sw: number;
  sh: number;
  windowWidth: number;
  windowHeight: number;
  density: number;
  // 这里同时包含容器、文字和图片样式。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>;
}
let stylesCache: StylesCache | null = null;

export const createStyles = (
  theme: Theme,
  screenWidth?: number,
  screenHeight?: number
) => {
  const sw = screenWidth ?? 0;
  const sh = screenHeight ?? 0;
  const { width: windowWidth, height: windowHeight, scale: density } = Dimensions.get('window');

  // FontScale 由原生文字组件应用，工厂未额外乘该值；密度则会影响像素取整。
  // 参数尺寸、真实窗口和像素密度都影响结果，只保留这一层缓存，避免旧子缓存覆盖新输入。
  if (
    stylesCache &&
    stylesCache.theme === theme &&
    stylesCache.sw === sw &&
    stylesCache.sh === sh &&
    stylesCache.windowWidth === windowWidth &&
    stylesCache.windowHeight === windowHeight &&
    stylesCache.density === density
  ) {
    return stylesCache.result;
  }

  const base = getBaseStyles(theme);
  const dynamic = getDynamicStyles(screenWidth, screenHeight);

  // 保持和 React Native StyleSheet 运行时相同的合并结果。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged = { ...base } as Record<string, any>;
  for (const key of Object.keys(dynamic)) {
    if (key in merged) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      merged[key] = { ...merged[key], ...(dynamic as any)[key] };
    }
  }

  stylesCache = { theme, sw, sh, windowWidth, windowHeight, density, result: merged };
  return merged;
};
