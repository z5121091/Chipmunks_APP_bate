import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ComponentProps, type Ref } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  ActivityIndicator,
  AppState,
  Platform,
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

export interface WarehouseScanInputHandle {
  focus: (delay?: number) => void;
}

export interface WarehouseScanInputProps extends TextInputProps {
  inputRef?: Ref<WarehouseScanInputHandle>;
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
  autoFocus = true,
  showSoftInputOnFocus = false,
  onFocus,
  onBlur,
  onLayout,
  onSubmitEditing,
  placeholderTextColor,
  ...props
}: WarehouseScanInputProps) {
  const { theme } = useTheme();
  const disabled = actionDisabled || processing;
  const scannerRef = useRef<TextInput>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();
  const canFocus = isFocused && autoFocus && (editable ?? true) && !processing;
  const canFocusRef = useRef(false);
  const windowFocusedRef = useRef(true);

  const cancelFocus = useCallback(() => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = null;
  }, []);
  const focusScanner = useCallback((delay = 0) => {
    if (!canFocusRef.current || !windowFocusedRef.current || focusTimer.current !== null) return;
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      // Recheck at execution time: a dialog or navigation may have opened meanwhile.
      if (!canFocusRef.current || !windowFocusedRef.current) return;
      if (AppState.currentState && AppState.currentState !== 'active') return;
      if (!scannerRef.current?.isFocused()) scannerRef.current?.focus();
    }, delay);
  }, []);

  useImperativeHandle(inputRef, () => ({ focus: focusScanner }), [focusScanner]);

  useLayoutEffect(() => {
    canFocusRef.current = canFocus;
    if (canFocus) focusScanner();
    else {
      cancelFocus();
      if (scannerRef.current?.isFocused()) scannerRef.current.blur();
    }
    return () => {
      canFocusRef.current = false;
      cancelFocus();
    };
  }, [canFocus, cancelFocus, focusScanner]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') focusScanner();
      else cancelFocus();
    });
    const windowBlur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      windowFocusedRef.current = false;
      cancelFocus();
    }) : undefined;
    const windowFocus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => {
      windowFocusedRef.current = true;
      focusScanner();
    }) : undefined;
    return () => {
      cancelFocus();
      subscription.remove();
      windowBlur?.remove();
      windowFocus?.remove();
    };
  }, [cancelFocus, focusScanner]);

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
        ref={scannerRef}
        style={[styles.input, { color: theme.textPrimary }, style]}
        editable={(editable ?? true) && !processing}
        placeholderTextColor={placeholderTextColor || theme.textMuted}
        accessibilityLabel={
          statusLabel || (typeof props.placeholder === 'string' ? props.placeholder : undefined)
        }
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
        {...props}
        showSoftInputOnFocus={showSoftInputOnFocus}
        autoFocus={false}
        onFocus={event => {
          cancelFocus();
          onFocus?.(event);
        }}
        onLayout={event => {
          onLayout?.(event);
          focusScanner();
        }}
        onBlur={event => {
          onBlur?.(event);
          focusScanner();
        }}
        onSubmitEditing={event => {
          onSubmitEditing?.(event);
          focusScanner();
        }}
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
        onPress={() => {
          onActionPress();
          focusScanner();
        }}
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
