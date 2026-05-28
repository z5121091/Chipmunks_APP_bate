import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, BorderWidth, Theme, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
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
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
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

  supplierTag: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    minHeight: 42,
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

  // 扫码框（包含输入框和 Toast）
  scanBox: {
    marginHorizontal: Spacing.sm,
    height: rf(60),
    backgroundColor: theme.backgroundDefault,
    borderWidth: 2,
    borderColor: theme.primary,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
  },

  scanBoxActive: {
    borderColor: theme.success,
    backgroundColor: withAlpha(theme.success, 0.06),
  },

  scanInput: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
    color: theme.textPrimary,
    textAlign: 'center',
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
    marginBottom: Spacing.xs,
    backgroundColor: theme.backgroundDefault,
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

  // 操作按钮
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    backgroundColor: theme.backgroundDefault,
    borderTopWidth: 1,
    borderTopColor: theme.borderLight,
    gap: Spacing.sm,
  },

  clearBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: rf(60),
    paddingVertical: Spacing.md,
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.lg,
  },

  clearBtnText: {
    fontSize: rf(16),
    fontWeight: '600',
    color: theme.textSecondary,
  },

  submitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: rf(60),
    paddingVertical: Spacing.md,
    backgroundColor: theme.primary,
    borderRadius: BorderRadius.lg,
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
