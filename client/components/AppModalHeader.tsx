
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';

interface AppModalHeaderProps {
  title: string;
  subtitle?: string;
  onClose?: () => void;
}

export function AppModalHeader({ title, subtitle, onClose }: AppModalHeaderProps) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: Spacing.md,
        marginBottom: Spacing.lg,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ ...Typography.h4, color: theme.textPrimary }}>{title}</Text>
        {subtitle ? (
          <Text
            style={{
              ...Typography.caption,
              color: theme.textSecondary,
              marginTop: 4,
              lineHeight: 18,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onClose ? (
        <TouchableOpacity
          style={{
            width: 36,
            height: 36,
            borderRadius: BorderRadius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.backgroundTertiary,
            borderWidth: BorderWidth.normal,
            borderColor: withAlpha(theme.textMuted, 0.12),
          }}
          activeOpacity={0.75}
          onPress={onClose}
        >
          <Feather name="x" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
