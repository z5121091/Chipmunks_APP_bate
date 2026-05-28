
import { Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing, Typography } from '@/constants/theme';
import { withAlpha } from '@/utils/colors';
import { rf } from '@/utils/responsive';

export type WorkflowStepStatus = 'complete' | 'active' | 'pending';
export type WorkflowMetricTone = 'default' | 'accent' | 'success' | 'warning';

export interface WorkflowStep {
  key: string;
  label: string;
  status: WorkflowStepStatus;
}

export interface WorkflowMetric {
  key: string;
  label: string;
  value: string;
  tone?: WorkflowMetricTone;
}

interface ScanWorkflowPanelProps {
  steps?: WorkflowStep[];
  metrics?: WorkflowMetric[];
  hint?: string;
}

export function ScanWorkflowPanel({
  steps,
  metrics = [],
  hint,
}: ScanWorkflowPanelProps) {
  const { theme } = useTheme();

  const getStepColors = (status: WorkflowStepStatus) => {
    switch (status) {
      case 'complete':
        return {
          cardBg: withAlpha(theme.success, theme.isDark ? 0.24 : 0.12),
          cardBorder: withAlpha(theme.success, 0.24),
          badgeBg: theme.success,
          badgeText: theme.white,
          text: theme.textPrimary,
        };
      case 'active':
        return {
          cardBg: withAlpha(theme.primary, theme.isDark ? 0.2 : 0.1),
          cardBorder: withAlpha(theme.primary, 0.22),
          badgeBg: theme.primary,
          badgeText: theme.buttonPrimaryText,
          text: theme.textPrimary,
        };
      case 'pending':
      default:
        return {
          cardBg: theme.backgroundTertiary,
          cardBorder: withAlpha(theme.textMuted, 0.08),
          badgeBg: withAlpha(theme.textMuted, 0.12),
          badgeText: theme.textMuted,
          text: theme.textSecondary,
        };
    }
  };

  const getMetricColors = (tone: WorkflowMetricTone = 'default') => {
    switch (tone) {
      case 'accent':
        return {
          bg: withAlpha(theme.primary, theme.isDark ? 0.2 : 0.1),
          border: withAlpha(theme.primary, 0.18),
          text: theme.primary,
          label: theme.textSecondary,
        };
      case 'success':
        return {
          bg: withAlpha(theme.success, theme.isDark ? 0.18 : 0.1),
          border: withAlpha(theme.success, 0.18),
          text: theme.success,
          label: theme.textSecondary,
        };
      case 'warning':
        return {
          bg: withAlpha(theme.warning, theme.isDark ? 0.18 : 0.1),
          border: withAlpha(theme.warning, 0.18),
          text: theme.warning,
          label: theme.textSecondary,
        };
      case 'default':
      default:
        return {
          bg: theme.backgroundTertiary,
          border: withAlpha(theme.textMuted, 0.08),
          text: theme.textPrimary,
          label: theme.textSecondary,
        };
    }
  };

  return (
    <View
      style={{
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.xs,
        gap: Spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
        {(steps ?? []).map((step) => {
          const colors = getStepColors(step.status);
          return (
            <View
              key={step.key}
              style={{
                flex: 1,
                minHeight: rf(40),
                borderRadius: BorderRadius.md,
                borderWidth: BorderWidth.normal,
                borderColor: colors.cardBorder,
                backgroundColor: colors.cardBg,
                paddingVertical: Spacing.xs,
                paddingHorizontal: Spacing.xs + 2,
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  ...Typography.captionMedium,
                  fontSize: rf(11),
                  lineHeight: rf(16),
                  color: colors.text,
                  textAlign: 'center',
                  flexShrink: 1,
                }}
                numberOfLines={2}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      {metrics.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
          {metrics.map((metric) => {
            const colors = getMetricColors(metric.tone);
            return (
              <View
                key={metric.key}
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: Spacing.xs + 2,
                  borderRadius: BorderRadius.full,
                  borderWidth: BorderWidth.normal,
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: '100%',
                  flexShrink: 1,
                }}
              >
                <Text
                  style={{
                    ...Typography.caption,
                    fontSize: rf(10),
                    lineHeight: rf(14),
                    color: colors.label,
                    flexShrink: 0,
                  }}
                  numberOfLines={2}
                >
                  {metric.label}
                </Text>
                <Text
                  style={{
                    ...Typography.captionMedium,
                    fontSize: rf(10),
                    lineHeight: rf(14),
                    color: colors.text,
                    flexShrink: 1,
                  }}
                  numberOfLines={2}
                  ellipsizeMode="middle"
                >
                  {metric.value}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
