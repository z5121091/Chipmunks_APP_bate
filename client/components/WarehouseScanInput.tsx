import type { ComponentProps, Ref } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

export interface WarehouseScanInputProps extends TextInputProps {
  inputRef?: Ref<TextInput>;
  active?: boolean;
  processing?: boolean;
  statusLabel?: string;
  containerProps?: ViewProps;
  actionIcon?: FeatherIconName;
  actionLabel: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onActionPress: () => void;
}

/** Shared scan or lookup input used by all warehouse operation screens. */
export function WarehouseScanInput({
  inputRef,
  active,
  processing = false,
  statusLabel,
  containerProps,
  actionIcon = 'maximize',
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onActionPress,
  style,
  editable,
  placeholderTextColor,
  ...props
}: WarehouseScanInputProps) {
  const { theme } = useTheme();
  const disabled = actionDisabled || processing;

  return (
    <View
      {...containerProps}
      style={[
        styles.container,
        {
          backgroundColor: theme.backgroundElevated,
          borderColor: active ? theme.primary : theme.border,
        },
        containerProps?.style,
      ]}
    >
      <TextInput
        ref={inputRef}
        style={[styles.input, { color: theme.textPrimary }, style]}
        editable={(editable ?? true) && !processing}
        placeholderTextColor={placeholderTextColor || theme.textMuted}
        accessibilityLabel={
          statusLabel || (typeof props.placeholder === 'string' ? props.placeholder : undefined)
        }
        autoCorrect={false}
        returnKeyType="done"
        {...props}
      />
      <TouchableOpacity
        style={[
          styles.actionButton,
          { backgroundColor: theme.primary },
          disabled && styles.actionButtonDisabled,
        ]}
        activeOpacity={0.76}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled, busy: actionLoading || processing }}
        disabled={disabled}
        onPress={onActionPress}
      >
        {actionLoading || processing ? (
          <ActivityIndicator size="small" color={theme.buttonPrimaryText} />
        ) : (
          <Feather name={actionIcon} size={19} color={theme.buttonPrimaryText} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginHorizontal: Spacing.sm,
    marginVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.xs,
    ...Typography.smallMedium,
    includeFontPadding: false,
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
  },
  actionButtonDisabled: {
    opacity: 0.48,
  },
});
