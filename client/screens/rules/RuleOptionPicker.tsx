import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppModalHeader } from '@/components/AppModalHeader';
import { Typography } from '@/constants/theme';

export interface RuleChoice { value: string; label: string; disabled?: boolean }

export function RuleOptionPicker({ title, options, value, onSelect, onClose, detail, onPrevious }: {
  title: string; options: RuleChoice[]; value?: string;
  onSelect: (value: string) => void; onClose: () => void;
  detail?: string; onPrevious?: () => void;
}) {
  const { theme, isDark } = useTheme();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'} safeAreaEdges={['top', 'bottom', 'left', 'right']} disableAutoScroll>
        <View style={{ flex: 1, padding: 16, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <AppModalHeader title={title} onClose={onClose} />
          <ScrollView key={title} keyboardShouldPersistTaps="handled">
            {detail !== undefined && <Text selectable style={{ ...Typography.small, color: theme.textPrimary,
              padding: 12, marginBottom: 12, backgroundColor: theme.backgroundDefault, borderRadius: 8,
              borderWidth: 1, borderColor: theme.border }}>{detail || '【空字段】'}</Text>}
            {options.map(option => (
              <TouchableOpacity key={option.value} accessibilityRole="radio"
                accessibilityState={{ checked: option.value === value, disabled: option.disabled }}
                disabled={option.disabled} onPress={() => onSelect(option.value)}
                style={{ minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
                  borderBottomWidth: 1, borderBottomColor: theme.border, opacity: option.disabled ? 0.4 : 1 }}>
                <Feather name={option.value === '__ignore__' ? 'minus-circle' : 'circle'} size={16} color={theme.textMuted} />
                <Text style={{ ...Typography.small, flex: 1, color: theme.textPrimary }}>{option.label}</Text>
                {option.value === value && <Feather name="check" size={18} color={theme.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          {onPrevious && <TouchableOpacity accessibilityRole="button" accessibilityLabel="上一段" onPress={onPrevious}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Feather name="arrow-left" size={18} color={theme.primary} />
            <Text style={{ ...Typography.smallMedium, color: theme.primary }}>上一段</Text>
          </TouchableOpacity>}
        </View>
      </Screen>
    </Modal>
  );
}
