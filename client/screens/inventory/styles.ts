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
    marginBottom: 0,
    borderRadius: BorderRadius.xl,
    backgroundColor: theme.backgroundElevated,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: theme.isDark ? 0.18 : 0.06,
    shadowRadius: 14,
    elevation: 3,
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
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: 0,
    paddingBottom: Spacing.sm,
    backgroundColor: 'transparent',
    gap: Spacing.xs,
  },

  // 盘点类型选择器
  typeSelector: {
    flexDirection: 'row',
    flex: 1,
    gap: 4,
    padding: 4,
    borderRadius: BorderRadius.xl,
    backgroundColor: theme.backgroundTertiary,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
  },

  typeBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    backgroundColor: 'transparent',
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    borderColor: 'transparent',
  },

  typeBtnActive: {
    backgroundColor: theme.primary,
    borderColor: withAlpha(theme.primary, theme.isDark ? 0.48 : 0.3),
  },

  typeBtnText: {
    ...Typography.captionMedium,
    flexShrink: 1,
    color: theme.textPrimary,
  },

  typeBtnTextActive: {
    color: theme.buttonPrimaryText,
  },

  // 仓库按钮
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

  // 列表
  listSection: {
    flex: 1,
    marginHorizontal: Spacing.sm,
    marginTop: 0,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.xl,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    backgroundColor: theme.backgroundDefault,
    overflow: 'hidden',
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: theme.isDark ? 0.16 : 0.05,
    shadowRadius: 14,
    elevation: 2,
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
    marginHorizontal: Spacing.sm,
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
    alignItems: 'stretch',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.borderLight,
  },

  clearBtn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
  },

  submitBtn: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
  },

  actionButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: BorderRadius.lg,
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
