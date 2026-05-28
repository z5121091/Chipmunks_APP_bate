
import { Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { rf, rs } from '@/utils/responsive';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH, getAppModalWidth } from '@/constants/modal';
import { withAlpha } from '@/utils/colors';

interface GuideStep {
  title: string;
  description: string;
  icon?: keyof typeof Feather.glyphMap;
}

const STEPS: GuideStep[] = [
  {
    title: '\u6b22\u8fce\u4f7f\u7528 Chipmunks \u638c\u4e0a\u4ed3\u5e93',
    description:
      '\u8bf7\u5148\u521b\u5efa\u4ed3\u5e93\uff0c\u518d\u5f00\u59cb\u5165\u5e93\u3001\u51fa\u5e93\u548c\u76d8\u70b9\u4f5c\u4e1a\u3002',
    icon: 'package',
  },
];

interface WarehouseGuideProps {
  visible: boolean;
  onSkip: () => void;
  onGoToSettings: () => void;
}

export function WarehouseGuide({ visible, onSkip, onGoToSettings }: WarehouseGuideProps) {
  const step = STEPS[0];
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const modalWidth = getAppModalWidth(width);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <SafeAreaView style={[styles.container, { width: modalWidth }]}>
          <View
            style={[
              styles.content,
              {
                backgroundColor: theme.backgroundElevated,
                borderColor: theme.border,
                shadowColor: theme.shadowColor,
              },
            ]}
          >
            <View style={[styles.iconContainer, { backgroundColor: withAlpha(theme.accent, 0.12) }]}>
              <Feather name={step.icon || 'package'} size={rs(56)} color={theme.accent} />
            </View>

            <Text style={[styles.title, { color: theme.textPrimary }]}>{step.title}</Text>
            <Text style={[styles.description, { color: theme.textSecondary }]}>{step.description}</Text>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[
                  styles.skipButton,
                  {
                    backgroundColor: theme.backgroundTertiary,
                    borderColor: theme.border,
                  },
                ]}
                onPress={onSkip}
                activeOpacity={0.7}
              >
                <Text style={[styles.skipButtonText, { color: theme.textSecondary }]}>
                  {'\u8df3\u8fc7\u5e76\u7ee7\u7eed'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.nextButton, { backgroundColor: theme.primary, shadowColor: theme.shadowColor }]}
                onPress={onGoToSettings}
                activeOpacity={0.7}
              >
                <Text style={[styles.nextButtonText, { color: theme.buttonPrimaryText }]}>
                  {'\u53bb\u5efa\u4ed3\u5e93'}
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.skipHint,
                {
                  backgroundColor: theme.backgroundTertiary,
                  borderColor: theme.border,
                },
              ]}
            >
              <Feather name="info" size={14} color={theme.textMuted} />
              <Text style={[styles.skipHintText, { color: theme.textSecondary }]}>
                跳过后系统会自动创建“默认仓库”，后续可在仓库档案中修改名称和说明。
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export async function shouldShowWarehouseGuide(options: {
  hasBusinessData: boolean;
  hasWarehouseConfig: boolean;
}): Promise<boolean> {
  return !options.hasBusinessData && !options.hasWarehouseConfig;
}

export async function markWarehouseGuideShown(): Promise<void> {
  return;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    maxWidth: APP_MODAL_MAX_WIDTH,
  },
  content: {
    borderRadius: BorderRadius['3xl'],
    padding: Spacing['2xl'],
    alignItems: 'center',
    borderWidth: BorderWidth.normal,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
  },
  iconContainer: {
    width: rs(88),
    height: rs(88),
    borderRadius: BorderRadius['2xl'],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: rf(20),
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  description: {
    fontSize: rf(14),
    lineHeight: rf(22),
    textAlign: 'center',
    marginBottom: Spacing['2xl'],
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: Spacing.sm,
  },
  skipHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    gap: Spacing.xs,
  },
  skipHintText: {
    flex: 1,
    fontSize: rf(12),
    lineHeight: rf(18),
  },
  skipButton: {
    flex: 1,
    minHeight: rs(50),
    paddingVertical: rs(12),
    paddingHorizontal: rs(20),
    borderRadius: BorderRadius.lg,
    borderWidth: BorderWidth.normal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: rf(14),
    fontWeight: '600',
  },
  nextButton: {
    flex: 1,
    minHeight: rs(50),
    paddingVertical: rs(12),
    paddingHorizontal: rs(20),
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    fontSize: rf(14),
    fontWeight: '700',
  },
});
