
import { StyleProp, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';

interface AppModalActionsProps {
  primaryLabel: string;
  onPrimaryPress: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  primaryDisabled?: boolean;
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
            minHeight: 46,
            borderRadius: BorderRadius.lg,
            borderWidth: BorderWidth.normal,
            borderColor: secondaryColors.borderColor,
            backgroundColor: secondaryColors.backgroundColor,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: Spacing.md,
          }}
          activeOpacity={0.8}
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
          minHeight: 46,
          borderRadius: BorderRadius.lg,
          backgroundColor: primaryDisabled ? theme.textMuted : primaryColors.backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.md,
          opacity: primaryDisabled ? 0.65 : 1,
        }}
        activeOpacity={0.82}
        disabled={primaryDisabled}
        onPress={onPrimaryPress}
      >
        <Text style={{ ...Typography.bodyMedium, color: primaryColors.textColor, fontWeight: '700' }}>
          {primaryLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
