
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing } from '@/constants/theme';

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
        padding: Spacing.md,
        borderRadius: BorderRadius.xl,
        backgroundColor: theme.backgroundTertiary,
        borderWidth: BorderWidth.normal,
        borderColor: theme.border,
      }}
      activeOpacity={0.82}
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
            fontSize: 13,
            fontWeight: '700',
            color: theme.textPrimary,
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={{
              marginTop: 2,
              fontSize: 11,
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
