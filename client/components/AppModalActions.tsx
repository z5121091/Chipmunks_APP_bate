
import { StyleProp, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

interface AppModalActionsProps {
  primaryLabel: string;
  onPrimaryPress: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  primaryDisabled?: boolean;
  secondaryDisabled?: boolean;
  primaryVariant?: 'primary' | 'danger';
  secondaryVariant?: 'secondary' | 'danger';
  containerStyle?: StyleProp<ViewStyle>;
}

export function AppModalActions({
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
  primaryDisabled = false,
  secondaryDisabled = !onSecondaryPress,
  primaryVariant = 'primary',
  secondaryVariant = 'secondary',
  containerStyle,
}: AppModalActionsProps) {
  const { theme } = useTheme();
  const secondaryColors =
    secondaryVariant === 'danger'
      ? {
          backgroundColor: theme.error,
          borderColor: theme.error,
          textColor: theme.buttonPrimaryText,
        }
      : {
          backgroundColor: theme.backgroundTertiary,
          borderColor: theme.border,
          textColor: theme.textSecondary,
        };
  const primaryColors =
    primaryVariant === 'danger'
      ? { backgroundColor: theme.error, textColor: theme.buttonPrimaryText }
      : { backgroundColor: theme.primary, textColor: theme.buttonPrimaryText };

  return (
    <View
      style={[
        {
          width: '100%',
          alignSelf: 'stretch',
          flexDirection: 'row',
          gap: Spacing.sm,
          marginTop: Spacing.lg,
        },
        containerStyle,
      ]}
    >
      {secondaryLabel ? (
        <TouchableOpacity
          style={{
            flex: 1,
            minHeight: MIN_TOUCH_TARGET,
            borderRadius: BorderRadius.md,
            borderWidth: BorderWidth.normal,
            borderColor: secondaryColors.borderColor,
            backgroundColor: secondaryColors.backgroundColor,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: Spacing.md,
            opacity: secondaryDisabled ? 0.55 : 1,
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: secondaryDisabled }}
          disabled={secondaryDisabled}
          onPress={onSecondaryPress}
        >
          <Text style={{ ...Typography.bodyMedium, color: secondaryColors.textColor }}>
            {secondaryLabel}
          </Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={{
          flex: 1,
          minHeight: MIN_TOUCH_TARGET,
          borderRadius: BorderRadius.md,
          backgroundColor: primaryDisabled ? theme.textMuted : primaryColors.backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.md,
          opacity: primaryDisabled ? 0.65 : 1,
          shadowColor: primaryColors.backgroundColor,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: primaryDisabled ? 0 : theme.isDark ? 0.16 : 0.18,
          shadowRadius: 10,
          elevation: primaryDisabled ? 0 : 2,
        }}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityState={{ disabled: primaryDisabled }}
        disabled={primaryDisabled}
        onPress={onPrimaryPress}
      >
        <Text style={{ ...Typography.dialogAction, color: primaryColors.textColor }}>
          {primaryLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
