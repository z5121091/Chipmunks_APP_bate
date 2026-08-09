import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Spacing } from '@/constants/theme';
import { rf } from '@/utils/responsive';

interface AppFormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function AppFormField({
  label,
  required = false,
  hint,
  children,
  style,
}: AppFormFieldProps) {
  const { theme } = useTheme();

  return (
    <View style={[{ marginBottom: Spacing.md }, style]}>
      <Text
        style={{
          marginBottom: Spacing.xs,
          fontSize: rf(13),
          fontWeight: '600',
          color: theme.textPrimary,
        }}
      >
        {label}
        {required ? <Text style={{ color: theme.error }}> *</Text> : null}
      </Text>
      {children}
      {hint ? (
        <Text
          style={{
            marginTop: Spacing.xs,
            fontSize: rf(11),
            lineHeight: rf(16),
            color: theme.textMuted,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
