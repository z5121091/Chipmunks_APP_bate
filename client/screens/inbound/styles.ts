import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, BorderWidth, Theme, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { getUiRedesignShadow, UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { withAlpha } from '@/utils/colors';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.backgroundRoot,
  },

  topPanel: {
    marginHorizontal: Spacing.sm,
    marginTop: Spacing.sm,
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
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
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
    paddingHorizontal: Spacing.md,
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
    minHeight: 46,
  },

  warehouseText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    maxWidth: 96,
    flexShrink: 1,
  },

  supplierTag: {
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
    minHeight: 46,
  },

  supplierTagActive: {
    backgroundColor: theme.backgroundTertiary,
  },

  supplierText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },

  supplierTextActive: {
    color: theme.textPrimary,
  },

  // 入库单标签
  inboundNoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.sm,
    marginTop: Spacing.sm,
  },

  inboundNoText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    marginRight: Spacing.xs,
  },

  // 列表
  listSection: {
    flex: 1,
    marginHorizontal: Spacing.sm,
    marginTop: 0,
    marginBottom: Spacing.sm,
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
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderLight,
  },

  listTitle: {
    ...Typography.captionMedium,
    color: theme.textSecondary,
  },

  listCount: {
    ...Typography.captionMedium,
    color: theme.primary,
  },

  list: {
    flex: 1,
  },

  listContent: {
    paddingBottom: Spacing.md,
  },

  listEmptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  // 空状态
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.xl * 2,
  },

  emptyText: {
    ...Typography.body,
    color: theme.textMuted,
    marginTop: Spacing.md,
  },

  // 已确认状态的样式
  itemConfirmed: {
    backgroundColor: withAlpha(theme.success, 0.15),
  },

  itemModelConfirmed: {
    color: theme.success,
  },

  itemTime: {
    ...Typography.caption,
    color: theme.textMuted,
    marginTop: 1,
  },

  // 聚合项容器
  itemContainer: {
    marginHorizontal: Spacing.sm,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.lg,
    backgroundColor: theme.backgroundDefault,
    borderWidth: BorderWidth.thin,
    borderColor: theme.borderLight,
    overflow: 'hidden',
  },

  // 聚合项主行（两行布局）
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundDefault,
  },

  // 左侧区域（勾选框 + 型号 + 版本号）
  itemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // 勾选框
  checkbox: {
    marginRight: rf(6),
  },

  // 型号内容区域
  modelContent: {
    flex: 1,
  },

  // 型号文字
  itemModel: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
  },

  // 版本号（第二行）
  itemBatch: {
    ...Typography.caption,
    color: theme.textSecondary,
    marginTop: 1,
  },

  // 数量（右侧）
  itemQty: {
    ...Typography.title,
    fontWeight: '700',
    color: theme.primary,
    marginLeft: Spacing.sm,
  },

  itemQtyConfirmed: {
    color: theme.success,
  },

  // 明细容器
  detailsContainer: {
    backgroundColor: theme.backgroundTertiary,
    marginLeft: Spacing.xl,
    marginRight: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },

  // 明细项
  detailItem: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginVertical: 2,
    borderRadius: BorderRadius.sm,
  },

  // 明细文本
  detailText: {
    ...Typography.small,
    color: theme.textSecondary,
    lineHeight: Typography.small.lineHeight,
  },

  erpLineCard: {
    marginHorizontal: Spacing.sm,
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
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
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
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },

  erpLineDetailItem: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: BorderWidth.thin,
    borderBottomColor: theme.borderLight,
  },

  erpLineEmptyText: {
    ...Typography.caption,
    color: theme.textMuted,
    paddingVertical: Spacing.xs,
    textAlign: 'center',
  },

  // 操作按钮
  actionBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: theme.backgroundDefault,
    borderTopWidth: 1,
    borderTopColor: theme.borderLight,
    gap: Spacing.sm,
  },

  clearBtn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
  },

  submitBtn: {
    flex: 2,
    flexBasis: 0,
    minWidth: 0,
  },

  actionButton: {
    width: '100%',
    minHeight: 56,
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
    padding: Spacing.md,
    zIndex: 100,
  },

  pickerBox: {
    width: '100%',
    maxWidth: APP_MODAL_MAX_WIDTH,
    maxHeight: '60%',
    backgroundColor: theme.backgroundDefault,
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    padding: Spacing.md,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: theme.isDark ? 0.28 : 0.12,
    shadowRadius: 24,
    elevation: 8,
  },

  pickerTitle: {
    fontSize: rf(16),
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },

  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
  },

  pickerItemActive: {
    backgroundColor: withAlpha(theme.primary, 0.1),
  },

  pickerItemText: {
    fontSize: rf(14),
    color: theme.textPrimary,
  },

  pickerClose: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.borderLight,
  },

  pickerCloseText: {
    fontSize: rf(14),
    color: theme.textSecondary,
  },

});
