import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Spacing, Typography } from '@/constants/theme';

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
          ...Typography.formLabel,
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
            ...Typography.formHint,
            color: theme.textMuted,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
