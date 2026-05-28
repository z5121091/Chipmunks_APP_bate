import { StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { rs, rf } from '@/utils/responsive';

// 动态计算更新弹窗内容区域的最大高度
const calculateUpdateModalBodyMaxHeight = (screenHeight: number, insets: { top: number; bottom: number }): number => {
  // 计算各部分高度：
  // - Header: 约 70px (paddingVertical: 16 + 内容约 38px)
  // - Footer: 约 120px (padding: 16 + 内容约 104px)
  // - 弹窗overlay padding: 24 (上下各24 = 48px)
  // - safeAreaInsets: top + bottom
  const headerHeight = 70;
  const footerHeight = 120;
  const modalPadding = 48;
  const safeAreaHeight = insets.top + insets.bottom;

  // 计算可用高度
  const availableHeight = screenHeight - headerHeight - footerHeight - modalPadding - safeAreaHeight;

  // 确保最小高度为 200px
  return Math.max(availableHeight, 200);
};

// 模块级缓存：静态样式仅在 theme 变化时重建，不受屏幕尺寸变化影响
let cachedBaseTheme: Theme | null = null;
let cachedBaseStyles: ReturnType<typeof StyleSheet.create> | null = null;

const getBaseStyles = (theme: Theme) => {
  if (cachedBaseTheme === theme && cachedBaseStyles) {
    return cachedBaseStyles;
  }
  cachedBaseTheme = theme;
  cachedBaseStyles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      padding: Spacing.md,
      paddingBottom: 150,
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
    // 模块标题
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
      marginTop: Spacing.lg,
    },
    sectionTitle: {
      fontSize: rf(13),
      fontWeight: '600',
      color: theme.textSecondary,
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
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    exportCardContainer: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      paddingVertical: Spacing.xs,
      overflow: 'hidden',
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 16,
      elevation: 3,
    },
    exportIcon: {
      width: rs(36),
      height: rs(36),
      borderRadius: BorderRadius.sm,
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
      fontWeight: '600',
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
      paddingVertical: Spacing["4xl"],
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
    customFieldsSection: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
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
      paddingVertical: Spacing.md,
    },
    aboutLogo: {
      width: rs(24),
      height: rs(24),
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
      paddingVertical: Spacing.md,
    },
    aboutDetailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    aboutDetailIconWrapper: {
      width: rs(20),
      alignItems: 'center',
      marginRight: Spacing.xs,
    },
    aboutDetailLabel: {
      fontSize: rf(13),
      color: theme.textSecondary,
      width: 50,
    },
    aboutDetailRight: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    aboutDetailValue: {
      fontSize: rf(13),
      color: theme.textPrimary,
      fontWeight: '500',
      flex: 1,
    },
    // 使用说明和更新日志入口 - 水平排列
    helpRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.lg,
      gap: Spacing['2xl'],
    },
    helpEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.md,
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
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.thick,
      borderColor: theme.border,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.06,
      shadowRadius: 16,
      elevation: 3,
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
      width: rs(40),
      height: rs(40),
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
    updateModalBody: {
      maxHeight: 525,
      paddingTop: 0,
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
    },
    restartModalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
    },
    restartModalBody: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    restartModalIcon: {
      width: rs(80),
      height: rs(80),
      borderRadius: rs(40),
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
      marginBottom: Spacing.xl,
      alignItems: 'center',
    },
    restartModalWarning: {
      fontSize: rf(17),
      color: theme.warning,
      fontWeight: '700',
      marginBottom: Spacing.xs,
      textAlign: 'center',
    },
    restartModalWarningSub: {
      fontSize: rf(14),
      color: theme.warning,
      textAlign: 'center',
      lineHeight: rf(20),
    },

  });
  return cachedBaseStyles!;
};

// 模块级缓存：动态样式基于屏幕尺寸缓存，避免每次调用都重建
interface DynamicStylesCache {
  screenWidth: number;
  screenHeight: number;
  styles: ReturnType<typeof StyleSheet.create>;
}
let dynamicCache: DynamicStylesCache | null = null;

const getDynamicStyles = (
  theme: Theme,
  screenWidth?: number,
  screenHeight?: number,
  insets?: { top: number; bottom: number }
) => {
  const sw = screenWidth ?? 0;
  const sh = screenHeight ?? 0;

  // 屏幕尺寸未变化时复用缓存
  if (dynamicCache && dynamicCache.screenWidth === sw && dynamicCache.screenHeight === sh) {
    return dynamicCache.styles;
  }

  const isCompactScreen = sw <= 390 || sh <= 760;
  const styles = {
    scrollContent: {
      padding: isCompactScreen ? Spacing.sm : Spacing.md,
      paddingBottom: isCompactScreen ? 120 : 150,
    },
    header: {
      marginBottom: isCompactScreen ? Spacing.sm : Spacing.md,
      padding: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    sectionHeader: {
      marginTop: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    exportCard: {
      paddingVertical: isCompactScreen ? 4 : Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    exportIcon: {
      width: isCompactScreen ? rs(32) : rs(36),
      height: isCompactScreen ? rs(32) : rs(36),
    },
    statsCard: {
      padding: isCompactScreen ? Spacing.lg : Spacing.xl,
      marginBottom: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    ruleItem: {
      padding: isCompactScreen ? Spacing.lg : Spacing.xl,
      marginBottom: isCompactScreen ? Spacing.md : Spacing.lg,
    },
    syncConfigCard: {
      padding: isCompactScreen ? Spacing.sm : Spacing.md,
    },
    syncAssistantIcon: {
      width: isCompactScreen ? rs(36) : rs(40),
      height: isCompactScreen ? rs(36) : rs(40),
    },
    updateModalBody: {
      maxHeight: screenHeight && insets
        ? calculateUpdateModalBodyMaxHeight(screenHeight, insets)
        : 525,
      paddingTop: 0,
    },
  } as const;

  dynamicCache = { screenWidth: sw, screenHeight: sh, styles };
  return styles;
};

// 最终合并结果的缓存 key
interface StylesCache {
  theme: Theme;
  sw: number;
  sh: number;
  result: Record<string, any>;
}
let stylesCache: StylesCache | null = null;

export const createStyles = (
  theme: Theme,
  screenWidth?: number,
  screenHeight?: number,
  insets?: { top: number; bottom: number }
) => {
  const sw = screenWidth ?? 0;
  const sh = screenHeight ?? 0;

  // theme + 屏幕尺寸均未变化时直接返回缓存的合并结果，避免对象合并开销
  if (
    stylesCache &&
    stylesCache.theme === theme &&
    stylesCache.sw === sw &&
    stylesCache.sh === sh
  ) {
    return stylesCache.result;
  }

  const base = getBaseStyles(theme);
  const dynamic = getDynamicStyles(theme, screenWidth, screenHeight, insets);

  const merged = { ...base } as Record<string, any>;
  for (const key of Object.keys(dynamic)) {
    if (key in merged) {
      merged[key] = { ...merged[key], ...(dynamic as any)[key] };
    }
  }

  stylesCache = { theme, sw, sh, result: merged };
  return merged;
};
