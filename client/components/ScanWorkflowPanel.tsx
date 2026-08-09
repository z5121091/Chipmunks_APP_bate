
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
}

export function ScanWorkflowPanel({
  steps,
  metrics = [],
}: ScanWorkflowPanelProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(), []);

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
    <View style={styles.container}>
      <View style={styles.stepRow}>
        {(steps ?? []).map((step, index) => {
          const colors = getStepColors(step.status);
          const stepIndex = index + 1;
          return (
            <View
              key={step.key}
              style={[
                styles.stepCard,
                {
                  borderColor: colors.cardBorder,
                  backgroundColor: colors.cardBg,
                },
              ]}
            >
              <View style={[styles.stepBadge, { backgroundColor: colors.badgeBg }]}>
                <Text style={[styles.stepBadgeText, { color: colors.badgeText }]}>
                  {stepIndex}
                </Text>
              </View>
              <Text
                style={[styles.stepLabel, { color: colors.text }]}
                numberOfLines={2}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>

      {metrics.length > 0 ? (
        <View style={styles.metricRow}>
          {metrics.map((metric) => {
            const colors = getMetricColors(metric.tone);
            return (
              <View
                key={metric.key}
                style={[
                  styles.metricChip,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.bg,
                  },
                ]}
              >
                <View style={[styles.metricDot, { backgroundColor: colors.text }]} />
                <Text
                  style={[styles.metricLabel, { color: colors.label }]}
                  numberOfLines={2}
                >
                  {metric.label}
                </Text>
                <Text
                  style={[styles.metricValue, { color: colors.text }]}
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

const createStyles = () => StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  stepCard: {
    flex: 1,
    minHeight: rf(46),
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  stepBadge: {
    width: rf(18),
    height: rf(18),
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    ...Typography.tiny,
    fontSize: rf(9),
    lineHeight: rf(12),
    fontWeight: '900',
    includeFontPadding: false,
  },
  stepLabel: {
    ...Typography.captionMedium,
    fontSize: rf(11),
    lineHeight: rf(15),
    textAlign: 'center',
    flexShrink: 1,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  metricChip: {
    paddingVertical: 5,
    paddingHorizontal: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: BorderWidth.normal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    flexShrink: 1,
  },
  metricDot: {
    width: 6,
    height: 6,
    borderRadius: BorderRadius.full,
  },
  metricLabel: {
    ...Typography.caption,
    fontSize: rf(10),
    lineHeight: rf(14),
    flexShrink: 0,
  },
  metricValue: {
    ...Typography.captionMedium,
    fontSize: rf(10),
    lineHeight: rf(14),
    flexShrink: 1,
  },
});
