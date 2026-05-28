import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';

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
        borderRadius: BorderRadius.xl,
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
              minHeight: 42,
              paddingHorizontal: Spacing.sm,
              paddingVertical: Spacing.sm - 1,
              borderRadius: BorderRadius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              backgroundColor: active ? theme.backgroundElevated : 'transparent',
              borderWidth: active ? BorderWidth.normal : 0,
              borderColor: active ? withAlpha(theme.primary, 0.26) : 'transparent',
            }}
            activeOpacity={0.82}
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
                fontSize: 13,
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
