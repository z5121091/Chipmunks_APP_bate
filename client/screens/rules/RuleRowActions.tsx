import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { AppModal } from '@/components/AppModal';
import { AppModalViewport } from '@/components/AppModalViewport';
import { AppModalCard } from '@/components/AppModalCard';
import { useTheme } from '@/hooks/useTheme';
import { Spacing, Typography } from '@/constants/theme';

export function RuleRowActions({ visible, title, detail, options, onClose }: {
  visible: boolean; title: string; detail?: string;
  options: { value: string; label: string; selected?: boolean; danger?: boolean; disabled?: boolean; onPress: () => void }[];
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return <AppModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <AppModalViewport style={{ paddingHorizontal: Spacing.md, paddingTop: insets.top + Spacing.md,
      paddingBottom: insets.bottom + Spacing.md, backgroundColor: theme.overlay }}>
      <AppModalCard size="auto" title={title} onClose={onClose}>
        <View style={{ gap: Spacing.sm }}>
          {!!detail && <Text style={{ ...Typography.caption, color: theme.textSecondary }}>{detail}</Text>}
          {options.map(option => <AppPressable key={option.value} accessibilityRole="button"
            accessibilityLabel={option.label} accessibilityState={{ disabled: option.disabled, selected: option.selected }}
            disabled={option.disabled} onPress={option.onPress}
            style={{ minHeight: 48, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
              borderBottomWidth: 1, borderBottomColor: theme.border, opacity: option.disabled ? 0.5 : 1 }}>
            <Text style={{ ...Typography.smallMedium, color: option.danger ? theme.error : theme.textPrimary, flex: 1 }}>{option.label}</Text>
            {option.selected && <Feather name="check" size={18} color={theme.primary} />}
          </AppPressable>)}
        </View>
      </AppModalCard>
    </AppModalViewport>
  </AppModal>;
}
