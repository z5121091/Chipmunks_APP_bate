import { StyleSheet } from 'react-native';
import {
  BorderRadius,
  BorderWidth,
  Theme,
  Typography,
} from '@/constants/theme';
import { rf } from '@/utils/responsive';

export const createStyles = (theme: Theme, screenWidth: number, screenHeight: number) => {
  const isCompact = screenWidth <= 390 || screenHeight <= 760;
  const isSmall = screenWidth <= 360 || screenHeight <= 680;
  const isLarge = screenWidth >= 430 || screenHeight >= 850;
  const horizontalPadding = isCompact ? 12 : 16;
  const cardHeight = isSmall ? 102 : isLarge ? 120 : 110;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scroll: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      gap: isSmall ? 10 : 14,
      paddingHorizontal: horizontalPadding,
      paddingTop: isCompact ? 10 : 14,
      paddingBottom: isCompact ? 12 : 16,
    },
    header: {
      minHeight: isSmall ? 43 : 50,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    appName: {
      ...Typography.h3,
      color: theme.textPrimary,
      fontWeight: '800',
      lineHeight: rf(25),
    },
    todayText: {
      ...Typography.caption,
      color: theme.textSecondary,
      marginTop: 1,
    },
    headerStatus: {
      minHeight: 27,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 9,
      borderRadius: BorderRadius.sm,
      borderWidth: BorderWidth.thin,
      borderColor: theme.border,
      backgroundColor: theme.backgroundDefault,
    },
    headerStatusDot: {
      width: 6,
      height: 6,
      borderRadius: BorderRadius.full,
      backgroundColor: theme.success,
    },
    headerStatusText: {
      ...Typography.tiny,
      color: theme.textSecondary,
      fontWeight: '700',
    },
    section: {
      gap: isSmall ? 7 : 9,
    },
    sectionHeading: {
      minHeight: 27,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    sectionTitle: {
      ...Typography.smallMedium,
      color: theme.textPrimary,
      fontWeight: '800',
    },
    sectionHint: {
      ...Typography.tiny,
      color: theme.textMuted,
    },
    sectionAction: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingLeft: 8,
    },
    sectionActionText: {
      ...Typography.captionMedium,
      color: theme.primary,
      fontWeight: '700',
    },
    operationGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: isSmall ? 8 : 10,
    },
    operationCard: {
      width: isSmall ? '48.7%' : '48.6%',
      minWidth: 0,
      minHeight: cardHeight,
      justifyContent: 'space-between',
      padding: isSmall ? 10 : 12,
      borderRadius: BorderRadius.sm,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      backgroundColor: theme.backgroundDefault,
    },
    operationTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    operationIcon: {
      width: isSmall ? 40 : 46,
      height: isSmall ? 40 : 46,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: BorderRadius.sm,
    },
    operationBadge: {
      minWidth: 23,
      minHeight: 23,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
      borderRadius: BorderRadius.full,
    },
    operationBadgeText: {
      ...Typography.tiny,
      fontWeight: '800',
    },
    operationTitle: {
      ...Typography.smallMedium,
      color: theme.textPrimary,
      fontWeight: '800',
      marginTop: isSmall ? 3 : 5,
    },
    operationStatus: {
      ...Typography.tiny,
      color: theme.textSecondary,
      marginTop: 1,
    },
    recentList: {
      overflow: 'hidden',
      borderRadius: BorderRadius.sm,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      backgroundColor: theme.backgroundDefault,
    },
    recentRow: {
      minHeight: isSmall ? 50 : isLarge ? 60 : 55,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: isSmall ? 10 : 12,
      paddingVertical: 7,
    },
    rowDivider: {
      borderTopWidth: BorderWidth.thin,
      borderTopColor: theme.borderLight,
    },
    recentMarker: {
      width: 4,
      height: isSmall ? 30 : 34,
      flexShrink: 0,
      borderRadius: BorderRadius.full,
    },
    recentBody: {
      flex: 1,
      minWidth: 0,
    },
    recentTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    recentNo: {
      ...Typography.captionMedium,
      flexShrink: 1,
      color: theme.textPrimary,
      fontWeight: '800',
    },
    recentType: {
      ...Typography.tiny,
      flexShrink: 0,
      fontWeight: '800',
    },
    recentMeta: {
      ...Typography.tiny,
      color: theme.textSecondary,
      marginTop: 2,
    },
    recentEmpty: {
      minHeight: isSmall ? 53 : 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
    },
    recentEmptyText: {
      flex: 1,
      minWidth: 0,
    },
    recentEmptyTitle: {
      ...Typography.captionMedium,
      color: theme.textPrimary,
      fontWeight: '700',
    },
    recentEmptySubtitle: {
      ...Typography.tiny,
      color: theme.textMuted,
      marginTop: 2,
    },
    bottomNav: {
      minHeight: isCompact ? 60 : 66,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: horizontalPadding,
      paddingTop: 5,
      paddingBottom: isCompact ? 6 : 8,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
      backgroundColor: theme.backgroundDefault,
    },
    bottomNavItem: {
      position: 'relative',
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    bottomNavIndicator: {
      position: 'absolute',
      top: -5,
      width: 26,
      height: 3,
      borderRadius: BorderRadius.full,
      backgroundColor: 'transparent',
    },
    bottomNavIndicatorActive: {
      backgroundColor: theme.primary,
    },
    bottomNavLabel: {
      ...Typography.navLabel,
      color: theme.textMuted,
      fontWeight: '600',
      includeFontPadding: false,
    },
    bottomNavLabelActive: {
      color: theme.primary,
      fontWeight: '800',
    },
  });
};
