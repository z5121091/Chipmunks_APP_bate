import { StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, BorderWidth, Theme, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.backgroundRoot,
  },

  topPanel: {
    marginHorizontal: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs + 2,
    paddingBottom: 2,
    backgroundColor: 'transparent',
  },

  backButton: {
    padding: Spacing.xs + 2,
    minWidth: 38,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },

  headerTitle: {
    ...Typography.h4,
    color: theme.textPrimary,
  },

  // 顶栏
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    backgroundColor: 'transparent',
    gap: Spacing.xs,
  },

  // 盘点类型选择器
  typeSelector: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexShrink: 1,
  },

  typeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    minHeight: 42,
  },

  typeBtnActive: {
    backgroundColor: theme.success,
  },

  typeBtnText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
  },

  typeBtnTextActive: {
    color: theme.white,
  },

  // 仓库按钮
  warehouseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    minWidth: 80,
    minHeight: 42,
  },

  warehouseText: {
    ...Typography.smallMedium,
    color: theme.textPrimary,
    maxWidth: 96,
    flexShrink: 1,
  },

  // 扫码框（包含输入框和 Toast）
  scanBox: {
    marginHorizontal: Spacing.sm,
    height: rf(60),
    backgroundColor: theme.backgroundDefault,
    borderWidth: 2,
    borderColor: theme.primary,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden', // 隐藏超出的内容
  },

  scanBoxActive: {
    borderColor: theme.success,
    backgroundColor: withAlpha(theme.success, 0.06),
  },

  scanInput: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent', // 透明，让容器背景显示
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
    color: theme.textPrimary,
    textAlign: 'center',
  },

  // 列表
  listSection: {
    flex: 1,
    marginTop: Spacing.md,
    backgroundColor: theme.backgroundDefault,
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

  // 聚合项容器
  itemContainer: {
    marginBottom: Spacing.xs,
    backgroundColor: theme.backgroundDefault,
  },

  // 聚合项主行（两行布局：型号 + 版本/数量）
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundDefault,
  },

  itemLeft: {
    flex: 1,
  },

  itemModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
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

  itemCode: {
    ...Typography.caption,
    color: theme.textMuted,
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

  itemQtyLabel: {
    ...Typography.caption,
    color: theme.textMuted,
  },

  quantityRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },

  actualRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 1,
  },

  actualLabel: {
    ...Typography.caption,
    color: theme.textMuted,
  },

  actualQty: {
    ...Typography.smallMedium,
    fontWeight: '700',
    color: theme.accent,
  },

  itemTime: {
    ...Typography.caption,
    color: theme.textMuted,
    marginTop: 1,
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

  detailActualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: 2,
  },

  // 明细文本
  detailText: {
    ...Typography.small,
    color: theme.textSecondary,
    lineHeight: Typography.small.lineHeight,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },

  emptyText: {
    ...Typography.body,
    color: theme.textMuted,
  },

  // 操作按钮
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.borderLight,
  },

  clearBtn: {
    flex: 1,
    minHeight: rf(60),
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: theme.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  clearBtnText: {
    fontSize: rf(16),
    fontWeight: '600',
    color: theme.textSecondary,
  },

  submitBtn: {
    flex: 1,
    minHeight: rf(60),
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  submitBtnText: {
    fontSize: rf(16),
    fontWeight: '600',
    color: theme.buttonPrimaryText,
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
  },

  pickerBox: {
    width: '100%',
    maxWidth: APP_MODAL_MAX_WIDTH,
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
    fontSize: rf(13),
    color: theme.textSecondary,
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
  modalBody: {
    paddingBottom: 0,
  },
  modalActions: {
    marginTop: 0,
  },

  modalInput: {
    fontSize: rf(14),
    fontWeight: '500',
    color: theme.textPrimary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    minHeight: 46,
  },

});
