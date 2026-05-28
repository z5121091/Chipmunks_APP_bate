import { StyleSheet } from 'react-native';
import { BorderRadius, BorderWidth, Spacing, Theme } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';
import { rf, rs } from '@/utils/responsive';

export const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.backgroundRoot,
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
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: theme.isDark ? 0.2 : 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  backButton: {
    width: rs(44),
    height: rs(44),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
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
  listContent: {
    padding: Spacing.md,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  ruleCard: {
    padding: Spacing.lg,
    backgroundColor: theme.backgroundElevated,
    borderRadius: BorderRadius.xl,
    borderWidth: BorderWidth.normal,
    borderColor: theme.border,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: theme.isDark ? 0.18 : 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ruleTitleWrap: {
    flex: 1,
  },
  ruleName: {
    fontSize: rf(16),
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 3,
  },
  ruleDescription: {
    fontSize: rf(12),
    lineHeight: rf(17),
    color: theme.textMuted,
  },
  ruleMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: theme.backgroundTertiary,
  },
  metaText: {
    fontSize: rf(11),
    color: theme.textSecondary,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  disabledBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    backgroundColor: withAlpha(theme.warning, 0.12),
  },
  disabledBadgeText: {
    fontSize: rf(11),
    fontWeight: '600',
    color: theme.warning,
  },
  prefixBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    backgroundColor: withAlpha(theme.success, 0.12),
  },
  prefixBadgeText: {
    fontSize: rf(11),
    fontWeight: '600',
    color: theme.success,
  },
  itemGap: {
    height: Spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing['4xl'],
  },
  emptyIcon: {
    width: rs(64),
    height: rs(64),
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.backgroundTertiary,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: rf(16),
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptyText: {
    fontSize: rf(13),
    color: theme.textMuted,
  },
});
