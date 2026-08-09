
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderWidth, Spacing, Typography } from '@/constants/theme';
import { UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

interface AppToggleRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}

export function AppToggleRow({ title, description, checked, onPress }: AppToggleRowProps) {
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        minHeight: MIN_TOUCH_TARGET,
        padding: Spacing.md,
        borderRadius: UI_REDESIGN_TOKENS.radius.card,
        backgroundColor: theme.backgroundTertiary,
        borderWidth: BorderWidth.normal,
        borderColor: theme.border,
      }}
      activeOpacity={0.82}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? theme.primary : theme.border,
          backgroundColor: checked ? theme.primary : 'transparent',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {checked ? <Feather name="check" size={13} color={theme.buttonPrimaryText} /> : null}
      </View>

      <View style={{ flex: 1, paddingTop: 1 }}>
        <Text
          style={{
            ...Typography.captionMedium,
            fontWeight: '700',
            color: theme.textPrimary,
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={{
              ...Typography.caption,
              marginTop: 2,
              lineHeight: 16,
              color: theme.textSecondary,
            }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
