
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { withAlpha } from '@/utils/colors';

interface AppEmptyStateProps {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppEmptyState({
  icon = 'inbox',
  title,
  description,
  loading = false,
  compact = false,
  style,
}: AppEmptyStateProps) {
  const { theme } = useTheme();
  const iconSize = compact ? 24 : 30;
  const iconWrapSize = compact ? 56 : 72;

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: compact ? Spacing.lg : Spacing.xl,
      paddingVertical: compact ? Spacing.xl : Spacing['4xl'],
    },
    iconWrap: {
      width: iconWrapSize,
      height: iconWrapSize,
      borderRadius: compact ? BorderRadius.lg : BorderRadius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: compact ? Spacing.md : Spacing.lg,
      backgroundColor: withAlpha(theme.primary, compact ? 0.08 : 0.1),
      borderWidth: BorderWidth.normal,
      borderColor: withAlpha(theme.primary, compact ? 0.12 : 0.16),
    },
    title: {
      ...(compact ? Typography.bodyMedium : Typography.h4),
      color: theme.textPrimary,
      textAlign: 'center',
      marginBottom: description ? 6 : 0,
    },
    description: {
      ...(compact ? Typography.caption : Typography.body),
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: compact ? 18 : 22,
      maxWidth: compact ? 260 : 320,
    },
  });

  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWrap}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <Feather name={icon} size={iconSize} color={theme.primary} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}
