import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

type UiSwitchSize = 'default' | 'compact';

/** Shared appearance; the containing row or switch owns the single touch target. */
export function UiSwitchVisual({ value, size = 'default' }: { value: boolean; size?: UiSwitchSize }) {
  const { theme } = useTheme();
  const compact = size === 'compact';
  const width = compact ? 48 : 60;
  const height = compact ? 28 : 34;
  const thumb = height - 6;
  return <View pointerEvents="none" style={{ width: compact ? 52 : 64, height: compact ? 44 : 48,
    flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
    <View testID="ui-switch-track" style={{ width, height, borderRadius: height / 2, padding: 3,
      justifyContent: 'center', alignItems: value ? 'flex-end' : 'flex-start',
      backgroundColor: value ? theme.success : theme.tagGray }}>
      <View testID="ui-switch-thumb" style={{ width: thumb, height: thumb, borderRadius: thumb / 2,
        backgroundColor: theme.white, shadowColor: theme.shadowColor,
        shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.16, shadowRadius: 2, elevation: 1 }} />
    </View>
  </View>;
}

export function UiSwitch({ value, onValueChange, accessibilityLabel, size = 'default', disabled = false }: {
  value: boolean; onValueChange: (value: boolean) => void; accessibilityLabel: string;
  size?: UiSwitchSize; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled }} disabled={disabled}
    aria-checked={value} aria-disabled={disabled}
    onPress={() => { if (!disabled) onValueChange(!value); }}
    style={{ flexShrink: 0, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
    <UiSwitchVisual value={value} size={size} />
  </Pressable>;
}
