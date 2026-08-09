import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderWidth, Spacing, Typography } from '@/constants/theme';
import { UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { withAlpha } from '@/utils/colors';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

interface AppSegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
}

interface AppSegmentedOptionsProps<T extends string> {
  options: AppSegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function AppSegmentedOptions<T extends string>({
  options,
  value,
  onChange,
}: AppSegmentedOptionsProps<T>) {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: Spacing.xs,
        padding: 4,
        borderRadius: UI_REDESIGN_TOKENS.radius.card,
        backgroundColor: theme.backgroundTertiary,
        borderWidth: BorderWidth.normal,
        borderColor: theme.border,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <TouchableOpacity
            key={option.value}
            style={{
              flex: 1,
              minHeight: MIN_TOUCH_TARGET,
              paddingHorizontal: Spacing.sm,
              paddingVertical: Spacing.sm - 1,
              borderRadius: UI_REDESIGN_TOKENS.radius.control,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              backgroundColor: active ? theme.backgroundElevated : 'transparent',
              borderWidth: active ? BorderWidth.normal : 0,
              borderColor: active ? withAlpha(theme.primary, 0.26) : 'transparent',
            }}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
          >
            {option.icon ? (
              <Feather
                name={option.icon}
                size={15}
                color={active ? theme.primary : theme.textSecondary}
              />
            ) : null}
            <Text
              style={{
                ...Typography.captionMedium,
                fontWeight: active ? '700' : '600',
                color: active ? theme.primary : theme.textPrimary,
              }}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
