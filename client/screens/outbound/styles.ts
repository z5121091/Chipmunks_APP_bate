import { Dimensions, StyleSheet } from 'react-native';
import { withAlpha } from '@/utils/colors';
import { Spacing, BorderRadius, Theme, Typography } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
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
    paddingHorizontal: isCompactScreen ? 10 : Spacing.md,
    paddingTop: isCompactScreen ? 6 : Spacing.xs + 2,
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
    paddingHorizontal: isCompactScreen ? 10 : Spacing.md,
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
    minHeight: isCompactScreen ? 40 : 42,
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
    backgroundColor: theme.backgroundTertiary,
    borderRadius: BorderRadius.md,
    minHeight: isCompactScreen ? 40 : 42,
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

  // 扫码框（包含输入框和 Toast）
  scanBox: {
    marginHorizontal: isCompactScreen ? 10 : Spacing.sm,
    height: isCompactScreen ? rf(56) : rf(60),
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
    marginTop: isCompactScreen ? Spacing.sm : Spacing.md,
    backgroundColor: theme.backgroundDefault,
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
    marginBottom: Spacing.xs,
    backgroundColor: theme.backgroundDefault,
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
