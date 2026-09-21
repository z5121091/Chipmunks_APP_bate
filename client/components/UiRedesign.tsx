import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedButton } from '@/components/AnimatedButton';
import { UiAssetIcon, type UiAssetIconName } from '@/components/UiAssetIcon';
import { useTheme } from '@/hooks/useTheme';
import { BorderWidth, Spacing, type Theme } from '@/constants/theme';
import {
  getUiRedesignIconBackground,
  getUiRedesignShadow,
  UI_REDESIGN_TOKENS,
} from '@/constants/uiRedesign';
import { rf } from '@/utils/responsive';

type IconName = keyof typeof Feather.glyphMap;
type UiButtonVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'text';
type UiButtonSize = 'default' | 'compact';

interface UiListSectionProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface UiSafeBottomBarProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface UiListItemProps {
  title: string;
  subtitle?: string;
  icon: IconName;
  color: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  rightText?: string;
  metaText?: string;
  expanded?: boolean;
  compact?: boolean;
  danger?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
}

interface UiToolbarButtonProps {
  label: string;
  icon?: IconName;
  assetIcon?: UiAssetIconName;
  color?: string;
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  compact?: boolean;
  primary?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

interface UiTagProps {
  label: string;
  color: string;
  icon?: IconName;
  tone?: 'solid' | 'soft';
  style?: StyleProp<ViewStyle>;
}

interface UiInputProps extends TextInputProps {
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  active?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

interface UiWorkflowSummaryItem {
  key: string;
  label: string;
  value: string;
  icon?: IconName;
  color: string;
  onPress?: () => void;
}

interface UiWorkflowSummaryProps {
  items: UiWorkflowSummaryItem[];
  style?: StyleProp<ViewStyle>;
}

interface UiPageHeaderProps {
  title: string;
  onBack: () => void;
  backLabel?: string;
  backIcon?: IconName;
  rightIcon?: IconName;
  rightLabel?: string;
  rightDisabled?: boolean;
  rightLoading?: boolean;
  onRightPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function UiListSection({ children, style }: UiListSectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return <View style={[styles.section, style]}>{children}</View>;
}

export function UiSafeBottomBar({ children, style }: UiSafeBottomBarProps) {
  const insets = useSafeAreaInsets();
  const bottomInset =
    Platform.OS === 'web'
      ? 0
      : Math.max(insets.bottom, Platform.OS === 'android' ? Spacing.xl : 0);

  return (
    <View style={[style, { paddingBottom: Spacing.sm + bottomInset }]}>
      {children}
    </View>
  );
}

export function UiPageHeader({
  title,
  onBack,
  backLabel = '返回',
  backIcon = 'arrow-left',
  rightIcon,
  rightLabel,
  rightDisabled,
  rightLoading = false,
  onRightPress,
  style,
}: UiPageHeaderProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.pageHeader, style]}>
      <TouchableOpacity
        style={styles.pageHeaderAction}
        activeOpacity={0.72}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
      >
        <Feather name={backIcon} size={20} color={theme.textPrimary} />
      </TouchableOpacity>

      <Text style={styles.pageHeaderTitle} numberOfLines={1}>
        {title}
      </Text>

      {rightIcon && onRightPress ? (
        <TouchableOpacity
          style={[styles.pageHeaderAction, (rightDisabled || rightLoading) && styles.itemDisabled]}
          activeOpacity={0.72}
          disabled={rightDisabled || rightLoading}
          onPress={onRightPress}
          accessibilityRole="button"
          accessibilityLabel={rightLabel || title}
          accessibilityState={{ disabled: Boolean(rightDisabled || rightLoading), busy: rightLoading }}
        >
          {rightLoading ? (
            <ActivityIndicator size="small" color={theme.textPrimary} />
          ) : (
            <Feather name={rightIcon} size={19} color={theme.textPrimary} />
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.pageHeaderActionSpacer} />
      )}
    </View>
  );
}

export function UiListItem({
  title,
  subtitle,
  icon,
  color,
  onPress,
  disabled,
  loading,
  rightText,
  metaText,
  expanded,
  compact,
  danger,
  switchValue,
  onSwitchChange,
}: UiListItemProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isSwitch = typeof switchValue === 'boolean' && onSwitchChange;
  const isDisabled = disabled || loading;
  const handlePress = () => {
    if (isSwitch) {
      onSwitchChange(!switchValue);
      return;
    }
    onPress?.();
  };

  return (
    <AnimatedButton
      style={[styles.item, compact && styles.itemCompact, isDisabled && styles.itemDisabled]}
      onPress={handlePress}
      disabled={isDisabled || (!onPress && !isSwitch)}
      activeScale={0.985}
      activeOpacity={0.9}
    >
      <View
        style={[
          styles.iconBox,
          compact && styles.iconBoxCompact,
          { backgroundColor: getUiRedesignIconBackground(theme, color) },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Feather name={icon} size={compact ? 15 : 18} color={color} />
        )}
      </View>

      <View style={styles.textBlock}>
        <Text style={[styles.title, danger && styles.titleDanger]} numberOfLines={1}>
          {loading ? '处理中...' : title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={compact ? 1 : 2}>
            {subtitle}
          </Text>
        ) : null}
        {metaText ? (
          <Text style={[styles.metaText, { color }]} numberOfLines={1}>
            {metaText}
          </Text>
        ) : null}
      </View>

      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ false: theme.border, true: `${color}80` }}
          thumbColor={switchValue ? color : theme.textMuted}
        />
      ) : rightText ? (
        <Text style={[styles.rightText, { color }]} numberOfLines={1}>
          {rightText}
        </Text>
      ) : (
        <Feather
          name={expanded ? 'chevron-down' : 'chevron-right'}
          size={16}
          color={theme.textMuted}
        />
      )}
    </AnimatedButton>
  );
}

export function UiToolbarButton({
  label,
  icon,
  assetIcon,
  color,
  variant,
  size = 'default',
  compact,
  primary,
  danger,
  loading,
  disabled,
  onPress,
  style,
}: UiToolbarButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const resolvedVariant: UiButtonVariant =
    variant ?? (danger ? 'danger' : primary ? 'primary' : 'secondary');
  const isCompact = compact || size === 'compact';
  const variantColor =
    color ||
    {
      primary: theme.accent,
      secondary: theme.accent,
      success: theme.success,
      warning: theme.warning,
      danger: theme.error,
      text: theme.accent,
    }[resolvedVariant];
  const isFilled =
    resolvedVariant === 'primary' ||
    resolvedVariant === 'success' ||
    resolvedVariant === 'warning' ||
    resolvedVariant === 'danger';
  const isText = resolvedVariant === 'text';
  const contentColor = isFilled ? theme.buttonPrimaryText : variantColor;
  const iconSize = isCompact ? 14 : 16;

  return (
    <AnimatedButton
      style={[
        styles.toolbarButton,
        isCompact ? styles.toolbarButtonCompact : styles.toolbarButtonDefault,
        {
          backgroundColor: isFilled
            ? variantColor
            : isText
              ? 'transparent'
              : theme.backgroundDefault,
          borderColor: isText ? 'transparent' : variantColor,
        },
        disabled && styles.itemDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeScale={0.96}
      activeOpacity={0.9}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : assetIcon ? (
        <UiAssetIcon name={assetIcon} size={isCompact ? 15 : 17} />
      ) : icon ? (
        <Feather name={icon} size={iconSize} color={contentColor} />
      ) : null}
      <Text
        style={[
          styles.toolbarButtonText,
          isCompact && styles.toolbarButtonTextCompact,
          { color: contentColor },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
      >
        {label}
      </Text>
    </AnimatedButton>
  );
}

export function UiTag({ label, color, icon, tone = 'soft', style }: UiTagProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isSolid = tone === 'solid';

  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: isSolid ? color : getUiRedesignIconBackground(theme, color),
          borderColor: isSolid ? color : `${color}26`,
        },
        style,
      ]}
    >
      {icon ? <Feather name={icon} size={11} color={isSolid ? theme.white : color} /> : null}
      <Text style={[styles.tagText, { color: isSolid ? theme.white : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function UiInput({
  leftElement,
  rightElement,
  active,
  containerStyle,
  style,
  placeholderTextColor,
  ...props
}: UiInputProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.inputShell, active && styles.inputShellActive, containerStyle]}>
      {leftElement}
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={placeholderTextColor || theme.textMuted}
        {...props}
      />
      {rightElement}
    </View>
  );
}

export function UiWorkflowSummary({ items, style }: UiWorkflowSummaryProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.workflowSummary, style]}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const content = (
          <>
            <Text style={styles.workflowLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.workflowValueBlock}>
              <Text style={styles.workflowValue} numberOfLines={1} ellipsizeMode="tail">
                {item.value}
              </Text>
              {item.onPress ? (
                <Feather name="chevron-right" size={14} color={theme.textMuted} />
              ) : null}
            </View>
          </>
        );

        if (item.onPress) {
          return (
            <AnimatedButton
              key={item.key}
              style={[styles.workflowItem, !isLast && styles.workflowItemSeparated]}
              onPress={item.onPress}
              activeScale={0.985}
              activeOpacity={0.9}
            >
              {content}
            </AnimatedButton>
          );
        }

        return (
          <View key={item.key} style={[styles.workflowItem, !isLast && styles.workflowItemSeparated]}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    section: {
      gap: UI_REDESIGN_TOKENS.spacing.sectionGap,
    },
    pageHeader: {
      minHeight: 50,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: UI_REDESIGN_TOKENS.spacing.pageX,
      paddingVertical: Spacing.xs,
      gap: Spacing.sm,
    },
    pageHeaderAction: {
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: UI_REDESIGN_TOKENS.radius.control,
      backgroundColor: theme.backgroundTertiary,
      borderWidth: UI_REDESIGN_TOKENS.border.thin,
      borderColor: theme.borderLight,
    },
    pageHeaderActionSpacer: {
      width: 38,
      height: 38,
    },
    pageHeaderTitle: {
      flex: 1,
      minWidth: 0,
      ...UI_REDESIGN_TOKENS.typography.title,
      fontWeight: '800',
      color: theme.textPrimary,
      textAlign: 'center',
      includeFontPadding: false,
    },
    item: {
      minHeight: UI_REDESIGN_TOKENS.size.listItemMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: UI_REDESIGN_TOKENS.spacing.itemX,
      paddingVertical: UI_REDESIGN_TOKENS.spacing.itemY,
      borderRadius: UI_REDESIGN_TOKENS.radius.card,
      backgroundColor: theme.backgroundDefault,
      borderWidth: UI_REDESIGN_TOKENS.border.width,
      borderColor: theme.border,
      ...getUiRedesignShadow(theme),
    },
    itemCompact: {
      minHeight: 52,
      paddingVertical: 7,
      shadowOpacity: 0,
      elevation: 0,
      borderWidth: BorderWidth.thin,
    },
    itemDisabled: {
      opacity: 0.5,
    },
    toolbarButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: UI_REDESIGN_TOKENS.radius.control,
      borderWidth: UI_REDESIGN_TOKENS.border.thin,
    },
    toolbarButtonDefault: {
      height: UI_REDESIGN_TOKENS.size.buttonHeight,
      minHeight: UI_REDESIGN_TOKENS.size.buttonHeight,
      paddingHorizontal: Spacing.md,
    },
    toolbarButtonCompact: {
      height:
        Platform.OS === 'web'
          ? UI_REDESIGN_TOKENS.size.buttonHeightCompact
          : UI_REDESIGN_TOKENS.size.buttonHeightCompactSmall,
      minHeight:
        Platform.OS === 'web'
          ? UI_REDESIGN_TOKENS.size.buttonHeightCompact
          : UI_REDESIGN_TOKENS.size.buttonHeightCompactSmall,
      gap: 4,
      paddingHorizontal: 6,
    },
    toolbarButtonText: {
      ...UI_REDESIGN_TOKENS.typography.button,
      fontWeight: '700',
      includeFontPadding: false,
      flexShrink: 1,
    },
    toolbarButtonTextCompact: {
      ...UI_REDESIGN_TOKENS.typography.button,
    },
    tag: {
      minHeight: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: UI_REDESIGN_TOKENS.radius.pill,
      borderWidth: UI_REDESIGN_TOKENS.border.thin,
      flexShrink: 0,
    },
    tagText: {
      ...UI_REDESIGN_TOKENS.typography.tag,
      fontWeight: '800',
      includeFontPadding: false,
    },
    inputShell: {
      minHeight: UI_REDESIGN_TOKENS.size.inputHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: UI_REDESIGN_TOKENS.radius.card,
      backgroundColor: theme.backgroundDefault,
      borderWidth: UI_REDESIGN_TOKENS.border.width,
      borderColor: theme.border,
      ...getUiRedesignShadow(theme),
    },
    inputShellActive: {
      borderColor: theme.primary,
      backgroundColor: getUiRedesignIconBackground(theme, theme.primary),
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      ...UI_REDESIGN_TOKENS.typography.input,
      color: theme.textPrimary,
    },
    workflowSummary: {
      marginHorizontal: UI_REDESIGN_TOKENS.spacing.pageX,
      marginBottom: 0,
      overflow: 'hidden',
      borderRadius: UI_REDESIGN_TOKENS.radius.card,
      backgroundColor: theme.backgroundDefault,
      borderWidth: UI_REDESIGN_TOKENS.border.thin,
      borderColor: theme.borderLight,
      ...getUiRedesignShadow(theme),
    },
    workflowItem: {
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingVertical: 1,
      gap: Spacing.md,
      backgroundColor: theme.backgroundDefault,
    },
    workflowItemSeparated: {
      borderBottomWidth: UI_REDESIGN_TOKENS.border.thin,
      borderBottomColor: theme.borderLight,
    },
    workflowLabel: {
      minWidth: 68,
      fontSize: rf(10),
      lineHeight: rf(15),
      fontWeight: '700',
      color: theme.textMuted,
      includeFontPadding: false,
    },
    workflowValueBlock: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Spacing.xs,
    },
    workflowValue: {
      flexShrink: 1,
      minWidth: 0,
      textAlign: 'right',
      fontSize: rf(11),
      lineHeight: rf(16),
      fontWeight: '700',
      color: theme.textPrimary,
      includeFontPadding: false,
    },
    iconBox: {
      width: UI_REDESIGN_TOKENS.size.listIcon,
      height: UI_REDESIGN_TOKENS.size.listIcon,
      borderRadius: UI_REDESIGN_TOKENS.radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    iconBoxCompact: {
      width: UI_REDESIGN_TOKENS.size.listIconSmall,
      height: UI_REDESIGN_TOKENS.size.listIconSmall,
    },
    textBlock: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: rf(14),
      lineHeight: rf(20),
      fontWeight: '700',
      color: theme.textPrimary,
    },
    titleDanger: {
      color: theme.error,
    },
    subtitle: {
      marginTop: 2,
      fontSize: rf(11),
      lineHeight: rf(15),
      color: theme.textMuted,
    },
    metaText: {
      marginTop: 2,
      fontSize: rf(11),
      lineHeight: rf(15),
      fontWeight: '700',
    },
    rightText: {
      maxWidth: 72,
      fontSize: rf(12),
      fontWeight: '700',
      flexShrink: 0,
    },
  });
