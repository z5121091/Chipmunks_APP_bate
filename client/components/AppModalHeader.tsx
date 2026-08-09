
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

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
        gap: Spacing.sm,
        marginBottom: Spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ ...Typography.title, color: theme.textPrimary }}>{title}</Text>
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
            width: MIN_TOUCH_TARGET,
            height: MIN_TOUCH_TARGET,
            borderRadius: BorderRadius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.backgroundTertiary,
            borderWidth: BorderWidth.normal,
            borderColor: withAlpha(theme.textMuted, 0.12),
          }}
          activeOpacity={0.75}
          accessibilityLabel="关闭"
          accessibilityRole="button"
          onPress={onClose}
        >
          <Feather name="x" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
