import { Dimensions, StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, BorderWidth, Theme, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { getUiRedesignShadow, UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme) => {
  const { width, height } = Dimensions.get('window');
  const isCompactScreen = width <= 390 || height <= 760;

  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.backgroundRoot,
  },

  topPanel: {
    marginHorizontal: isCompactScreen ? 10 : Spacing.sm,
    marginTop: isCompactScreen ? 10 : Spacing.sm,
    marginBottom: 0,
    borderRadius: UI_REDESIGN_TOKENS.radius.card,
    backgroundColor: theme.backgroundElevated,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    ...getUiRedesignShadow(theme),
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: isCompactScreen ? 10 : Spacing.md,
    paddingTop: isCompactScreen ? 8 : Spacing.sm,
    paddingBottom: Spacing.xs,
    backgroundColor: 'transparent',
  },

  backButton: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.backgroundTertiary,
  },

  headerTitle: {
    ...Typography.title,
    color: theme.textPrimary,
    textAlign: 'center',
    flex: 1,
  },

  headerMenuButton: {
    width: 38,
    height: 38,
    borderRadius: BorderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.backgroundTertiary,
  },

  // 顶栏
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: isCompactScreen ? 10 : Spacing.md,
    paddingTop: 0,
    paddingBottom: Spacing.sm,
    backgroundColor: 'transparent',
    gap: Spacing.xs,
  },

  warehouseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundDefault,
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    minWidth: 80,
    minHeight: isCompactScreen ? 42 : 46,
  },

  warehouseText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    maxWidth: 96,
    flexShrink: 1,
  },

  statusCard: {
    flex: 1,
    paddingVertical: Spacing.xs + 1,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    minHeight: isCompactScreen ? 44 : 46,
    justifyContent: 'center',
    gap: 2,
  },

  statusCardReady: {
    backgroundColor: withAlpha(theme.warning, theme.isDark ? 0.18 : 0.12),
  },

  statusCardComplete: {
    backgroundColor: withAlpha(theme.success, theme.isDark ? 0.2 : 0.12),
  },

  orderText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  orderTextActive: {
    color: theme.textPrimary,
  },

  orderTextComplete: {
    color: theme.textPrimary,
  },

  customerText: {
    ...Typography.caption,
    color: theme.textMuted,
    textAlign: 'center',
  },

  customerTextReady: {
    color: theme.warning,
  },

  // 步骤标签（topBar 替代原 statusCard）
  stepTag: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundDefault,
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    minHeight: isCompactScreen ? 42 : 46,
  },

  stepTagActive: {
    backgroundColor: withAlpha(theme.primary, theme.isDark ? 0.2 : 0.12),
  },

  stepText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },

  stepTextActive: {
    color: theme.primary,
    fontWeight: '600',
  },

  completionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginHorizontal: isCompactScreen ? 10 : Spacing.sm,
    marginBottom: isCompactScreen ? 6 : Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderWidth: BorderWidth.normal,
    borderColor: withAlpha(theme.success, 0.36),
    borderRadius: BorderRadius.md,
    backgroundColor: withAlpha(theme.success, theme.isDark ? 0.18 : 0.1),
  },

  completionBannerText: {
    ...Typography.captionMedium,
    flexShrink: 1,
    color: theme.success,
    textAlign: 'center',
  },

  // 列表
  listSection: {
    flex: 1,
    marginHorizontal: isCompactScreen ? 10 : Spacing.sm,
    marginTop: 0,
    marginBottom: isCompactScreen ? 10 : Spacing.sm,
    borderRadius: UI_REDESIGN_TOKENS.radius.card,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    backgroundColor: theme.backgroundDefault,
    overflow: 'hidden',
    ...getUiRedesignShadow(theme),
  },

  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
    gap: Spacing.sm,
  },

  listTitle: {
    ...Typography.captionMedium,
    color: theme.textSecondary,
  },

  listCount: {
    ...Typography.captionMedium,
    color: theme.primary,
    flexShrink: 1,
    textAlign: 'right',
  },

  list: {
    flex: 1,
  },

  listContent: {
    paddingBottom: isCompactScreen ? Spacing.sm : Spacing.md,
  },

  listEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  // 聚合项容器
  itemContainer: {
    marginHorizontal: isCompactScreen ? Spacing.xs : Spacing.sm,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.lg,
    backgroundColor: theme.backgroundDefault,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    overflow: 'hidden',
  },

  // 聚合项主行（两行布局：型号 + 版本/数量）
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: isCompactScreen ? Spacing.sm : Spacing.md,
    paddingHorizontal: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    backgroundColor: theme.backgroundDefault,
  },

  itemLeft: {
    flex: 1,
  },

  itemModel: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
  },

  itemBatch: {
    ...Typography.caption,
    color: theme.textSecondary,
    marginTop: 1,
  },

  itemRight: {
    alignItems: 'flex-end',
  },

  itemQty: {
    ...Typography.title,
    fontWeight: '700',
    color: theme.primary,
  },

  itemTime: {
    ...Typography.caption,
    color: theme.textMuted,
    marginTop: 1,
  },

  // 明细容器
  detailsContainer: {
    backgroundColor: theme.backgroundTertiary,
    marginLeft: isCompactScreen ? Spacing.lg : Spacing.xl,
    marginRight: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: isCompactScreen ? Spacing.xs : Spacing.sm,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    paddingVertical: isCompactScreen ? 6 : Spacing.xs,
  },

  detailItem: {
    paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    paddingHorizontal: isCompactScreen ? Spacing.sm : Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },

  detailText: {
    ...Typography.small,
    color: theme.textSecondary,
    lineHeight: Typography.small.lineHeight,
  },

  erpLineCard: {
    marginHorizontal: isCompactScreen ? Spacing.xs : Spacing.sm,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.lg,
    backgroundColor: theme.backgroundDefault,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    overflow: 'hidden',
  },

  erpLineMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: isCompactScreen ? Spacing.sm : Spacing.md,
    paddingHorizontal: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    gap: Spacing.xs,
  },

  erpLineContent: {
    flex: 1,
    minWidth: 0,
  },

  erpLineCode: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },

  erpLineMergeHint: {
    ...Typography.caption,
    color: theme.textSecondary,
    marginTop: 2,
  },

  erpLineProgressTrack: {
    height: 5,
    flexDirection: 'row',
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },

  erpLineProgressFill: {
    minWidth: 0,
  },

  erpLineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },

  erpLineMetaText: {
    ...Typography.caption,
    color: theme.textMuted,
    minWidth: 0,
    flexShrink: 1,
  },

  erpLineDetails: {
    backgroundColor: theme.backgroundTertiary,
    paddingHorizontal: isCompactScreen ? Spacing.xs : Spacing.sm,
    paddingVertical: isCompactScreen ? 6 : Spacing.xs,
  },

  erpLineDetailItem: {
    paddingVertical: isCompactScreen ? Spacing.xs + 2 : Spacing.sm,
    paddingHorizontal: isCompactScreen ? Spacing.xs : Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },

  erpLineEmptyText: {
    ...Typography.caption,
    color: theme.textMuted,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: isCompactScreen ? Spacing.md : Spacing.lg,
  },

  outboundUnpackModalContent: {
    width: '100%',
    maxWidth: APP_MODAL_MAX_WIDTH,
    maxHeight: '84%',
  },

  modalBody: {
    paddingBottom: 0,
  },

  modalActions: {
    marginTop: 0,
  },

  outboundUnpackBodyContent: {
    paddingBottom: Spacing['2xl'],
  },

  unpackTextInput: {
    ...Typography.body,
    color: theme.textPrimary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
  },

  readOnlyInputContent: {
    justifyContent: 'center',
  },

  unpackReadOnlyText: {
    ...Typography.small,
    color: theme.textSecondary,
    lineHeight: Typography.small.lineHeight,
  },

  unpackTraceText: {
    ...Typography.smallMedium,
    color: theme.primary,
    lineHeight: Typography.smallMedium.lineHeight,
  },

  unpackQuantityGrid: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },

  unpackQuantityCell: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.md,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    backgroundColor: theme.backgroundTertiary,
    alignItems: 'center',
    gap: 2,
  },

  unpackQuantityLabel: {
    ...Typography.caption,
    color: theme.textMuted,
  },

  unpackQuantityValue: {
    ...Typography.bodyMedium,
    color: theme.textPrimary,
    fontWeight: '700',
  },

  unpackQuantityValuePrimary: {
    ...Typography.bodyMedium,
    color: theme.primary,
    fontWeight: '800',
  },

  unpackNotesInput: {
    minHeight: 76,
    textAlignVertical: 'top',
  },

  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },

  emptyText: {
    ...Typography.body,
    color: theme.textMuted,
  },

  // 仓库选择器
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: isCompactScreen ? Spacing.md : Spacing.lg,
  },

  pickerBox: {
    width: '100%',
    maxWidth: APP_MODAL_MAX_WIDTH,
    backgroundColor: theme.backgroundDefault,
    borderRadius: BorderRadius.lg,
    padding: isCompactScreen ? Spacing.sm : Spacing.md,
  },

  pickerTitle: {
    fontSize: rf(15),
    fontWeight: '600',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },

  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },

  pickerItemActive: {
    backgroundColor: withAlpha(theme.primary, 0.06),
  },

  pickerItemText: {
    fontSize: rf(14),
    color: theme.textPrimary,
  },

  pickerClose: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },

  pickerCloseText: {
    fontSize: rf(14),
    color: theme.textSecondary,
  },
  });
};
