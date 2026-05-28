import { Platform, StyleSheet } from 'react-native';
import { Spacing, BorderRadius, Theme, BorderWidth } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH } from '@/constants/modal';
import { withAlpha } from '@/utils/colors';

export const createStyles = (theme: Theme) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.backgroundRoot,
    },
    scrollContent: {
      padding: Spacing.md,
      paddingBottom: 96,
    },
    header: {
      marginBottom: Spacing.md,
      padding: Spacing.lg,
      borderRadius: BorderRadius['2xl'],
      backgroundColor: theme.backgroundElevated,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: theme.isDark ? 0.22 : 0.1,
      shadowRadius: 20,
      elevation: 5,
    },
    title: {
      fontSize: 24,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.6,
    },
    card: {
      backgroundColor: theme.backgroundElevated,
      borderRadius: BorderRadius.xl,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      shadowColor: theme.shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.18 : 0.08,
      shadowRadius: 16,
      elevation: 3,
    },
    cardTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: Spacing.md,
    },
    fieldRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    fieldColumn: {
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    fieldRowLast: {
      borderBottomWidth: 0,
    },
    fieldLabel: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: Spacing.xs,
    },
    fieldValue: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
      flex: 1,
      textAlign: 'right',
    },
    fieldValueLong: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textPrimary,
      lineHeight: 20,
    },
    modelValue: {
      fontSize: 19,
      fontWeight: '800',
      color: theme.textPrimary,
    },
    rawContentCard: {
      marginTop: Spacing.md,
    },
    rawContentText: {
      fontSize: 11,
      color: theme.textMuted,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 16,
    },
    noDataText: {
      fontSize: 13,
      color: theme.textMuted,
      textAlign: 'center',
      paddingVertical: Spacing.md,
    },
    actionsContainer: {
      marginTop: Spacing.lg,
    },
    button: {
      backgroundColor: theme.primary,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      marginBottom: Spacing.sm,
      minHeight: 50,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    secondaryButton: {
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      marginBottom: Spacing.sm,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
      minHeight: 50,
    },
    secondaryButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    dangerButton: {
      backgroundColor: theme.error,
    },
    dangerButtonText: {
      color: theme.white,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.md,
    },
    errorText: {
      fontSize: 14,
      color: theme.error,
      textAlign: 'center',
      marginBottom: Spacing.md,
    },
    backButton: {
      backgroundColor: theme.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    backButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.buttonPrimaryText,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    // Modal样式
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.md,
    },
    modalContent: {
      width: '100%',
      maxWidth: APP_MODAL_MAX_WIDTH,
    },
    modalBodyContent: {
      paddingBottom: Spacing.md,
    },
    formInput: {
      backgroundColor: theme.backgroundTertiary,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm + 2,
      fontSize: 14,
      color: theme.textPrimary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    optionsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    optionButton: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.md,
      backgroundColor: theme.backgroundTertiary,
      borderWidth: BorderWidth.normal,
      borderColor: theme.border,
    },
    optionButtonActive: {
      backgroundColor: withAlpha(theme.primary, 0.08),
      borderColor: theme.primary,
    },
    optionButtonText: {
      fontSize: 13,
      color: theme.textPrimary,
    },
    optionButtonTextActive: {
      color: theme.primary,
      fontWeight: '600',
    },
    modalActions: {
      marginTop: 0,
    },
  });
};
