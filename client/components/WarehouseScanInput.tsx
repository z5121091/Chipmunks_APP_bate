import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { useOverlayActivity } from '@/hooks/useOverlayActivity';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ComponentProps, type Ref } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import { ActivityIndicator, AppState, Platform, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSubmitEditingEventData, type TextInputProps, type ViewProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

export interface WarehouseScanInputHandle {
  focus: (delay?: number) => void;
  clear: (options?: { discardPendingSubmits?: boolean }) => void;
}

export interface WarehouseScanInputProps extends TextInputProps {
  inputRef?: Ref<WarehouseScanInputHandle>;
  active?: boolean;
  processing?: boolean;
  /** Keep hardware keyboard scanner input available while its accepted scans wait for processing. */
  acceptInputWhileProcessing?: boolean;
  /** For a scanner owned by a native Modal. Enable autoFocus after that Modal's onShow. */
  focusInModal?: boolean;
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
  acceptInputWhileProcessing = false,
  focusInModal = false,
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
  onChange,
  onChangeText,
  onSubmitEditing,
  placeholderTextColor,
  ...props
}: WarehouseScanInputProps) {
  const { theme } = useTheme();
  const disabled = actionDisabled || processing;
  const scannerRef = useRef<TextInput>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();
  const overlayActive = useOverlayActivity();
  const canEdit = (editable ?? true) && (!processing || acceptInputWhileProcessing);
  const canFocus = isFocused && autoFocus && canEdit && (focusInModal || !overlayActive);
  const canFocusRef = useRef(false);
  const windowFocusedRef = useRef(true);
  // 原生 clear 与 JS 回调异步执行。按事件序号过滤旧快照，避免清空后被写回。
  // 不按文本去重：不同包装可以有完全相同的二维码。
  const latestChangeCountRef = useRef(-1);
  const consumedChangeCountRef = useRef(-1);
  const ignoreChangeTextRef = useRef(false);
  const latestTextRef = useRef(typeof props.value === 'string' ? props.value : '');
  const consumedTextRef = useRef('');
  const deliveringSubmitRef = useRef<string | null>(null);
  // Some scanner IME Submit events overtake coalesced text changes. Keep those
  // real boundaries until their exact text arrives; never infer one from fields.
  const earlySubmitsRef = useRef<Array<{
    text: string; event: NativeSyntheticEvent<TextInputSubmitEditingEventData>;
  }>>([]);

  const deliverSubmit = (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    deliveringSubmitRef.current = event.nativeEvent.text;
    try { onSubmitEditing?.(event); }
    finally { deliveringSubmitRef.current = null; }
  };

  const cancelFocus = useCallback(() => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = null;
  }, []);
  const focusScanner = useCallback((delay = 0) => {
    if (!canFocusRef.current || !windowFocusedRef.current || focusTimer.current !== null) return;
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      // 延迟执行前再检查一次，等待期间可能已经打开弹窗或切换页面。
      if (!canFocusRef.current || !windowFocusedRef.current) return;
      if (AppState.currentState && AppState.currentState !== 'active') return;
      if (!scannerRef.current?.isFocused()) scannerRef.current?.focus();
    }, delay);
  }, []);

  useImperativeHandle(inputRef, () => ({
    focus: focusScanner,
    clear: (options) => {
      const text = deliveringSubmitRef.current ?? latestTextRef.current;
      const exactIndex = earlySubmitsRef.current.findIndex(item => item.text === text);
      const index = exactIndex >= 0 ? exactIndex : earlySubmitsRef.current.findIndex(item =>
        !!text && item.text.startsWith(text));
      consumedTextRef.current = index >= 0 ? earlySubmitsRef.current[index].text : text;
      if (options?.discardPendingSubmits) earlySubmitsRef.current = [];
      else if (index >= 0) earlySubmitsRef.current.splice(0, index + 1);
      else if (!text) earlySubmitsRef.current = [];
      latestTextRef.current = '';
      consumedChangeCountRef.current = latestChangeCountRef.current;
      scannerRef.current?.clear();
    },
  }), [focusScanner]);

  useLayoutEffect(() => {
    canFocusRef.current = canFocus;
    if (canFocus) focusScanner();
    else {
      earlySubmitsRef.current = [];
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
    // Android Activity window events do not describe the window of a native Modal.
    const tracksActivityWindow = Platform.OS === 'android' && !focusInModal;
    const windowBlur = tracksActivityWindow ? AppState.addEventListener('blur', () => {
      windowFocusedRef.current = false;
      cancelFocus();
    }) : undefined;
    const windowFocus = tracksActivityWindow ? AppState.addEventListener('focus', () => {
      windowFocusedRef.current = true;
      focusScanner();
    }) : undefined;
    return () => {
      cancelFocus();
      subscription.remove();
      windowBlur?.remove();
      windowFocus?.remove();
    };
  }, [cancelFocus, focusInModal, focusScanner]);

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
        editable={canEdit}
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
        onChange={event => {
          const count = event.nativeEvent.eventCount;
          const hasCount = Number.isFinite(count);
          ignoreChangeTextRef.current = hasCount && (
            count <= consumedChangeCountRef.current || count < latestChangeCountRef.current
          );
          if (ignoreChangeTextRef.current) return;
          if (hasCount) latestChangeCountRef.current = count;
          onChange?.(event);
        }}
        onChangeText={text => {
          // RN 先调用 onChange，再调用同一事件的 onChangeText。
          const ignored = ignoreChangeTextRef.current;
          ignoreChangeTextRef.current = false;
          if (ignored) return;
          latestTextRef.current = text;
          const pending = earlySubmitsRef.current.find(item => item.text === text);
          onChangeText?.(text);
          // The page can synchronously clear during change; that consumes the
          // matching boundary and must prevent a second delivery here.
          const index = pending ? earlySubmitsRef.current.indexOf(pending) : -1;
          if (index >= 0 && latestTextRef.current === text &&
              (latestChangeCountRef.current < 0 || latestChangeCountRef.current > consumedChangeCountRef.current)) {
            earlySubmitsRef.current.splice(0, index + 1);
            deliverSubmit(pending!.event);
          }
        }}
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
          if (!onChangeText) {
            deliverSubmit(event);
            focusScanner();
            return;
          }
          const text = event.nativeEvent.text;
          const current = latestTextRef.current;
          // A consumed-text Enter may also belong to a new identical package.
          // Keep it as a candidate, but require a fresh exact change before replay.
          const consumedCandidate = text && text === consumedTextRef.current && text !== current;
          if (text && text !== current) {
            const preceding = earlySubmitsRef.current.some(item => item.text !== text);
            if (!earlySubmitsRef.current.some(item => item.text === text)) {
              event.persist?.();
              if (earlySubmitsRef.current.length === 100) earlySubmitsRef.current.shift();
              earlySubmitsRef.current.push({ text, event });
            }
            // A first partial change keeps the page's existing native-snapshot
            // fallback; an empty JS buffer waits for a matching real change.
            if (current && text.startsWith(current) && !preceding && !consumedCandidate) deliverSubmit(event);
          } else {
            deliverSubmit(event);
          }
          focusScanner();
        }}
      />
      <TouchableOpacity
        style={[
          styles.actionButton,
          { backgroundColor: theme.primary },
          disabled && styles.actionButtonDisabled,
        ]}
        activeOpacity={0.86}
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
