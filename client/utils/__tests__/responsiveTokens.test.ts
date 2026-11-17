import { Dimensions, type ScaledSize } from 'react-native';
import { AppComponentTokens, BorderRadius, BorderWidth, Colors, getIconSize, Spacing, Typography } from '@/constants/theme';
import { UI_REDESIGN_TOKENS } from '@/constants/uiRedesign';
import { createStyles as createSettingsStyles } from '@/screens/settings/styles';
import { hp, rf, rs, scaleControlSize, wp } from '../responsive';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const resize = (width: number, height: number, fontScale = 1) => {
  const viewport: ScaledSize = { width, height, scale: 1, fontScale };
  Dimensions.set({ window: viewport, screen: viewport });
};
const captureTokens = () => ({
  spacing: Spacing.md,
  radius: BorderRadius.md,
  border: BorderWidth.normal,
  font: Typography.smallMedium.fontSize,
  icon: getIconSize().xl,
  componentButtonFont: AppComponentTokens.typography.button.fontSize,
  redesignButtonFont: UI_REDESIGN_TOKENS.typography.button.fontSize,
  redesignSpacing: UI_REDESIGN_TOKENS.spacing.itemX,
  redesignRadius: UI_REDESIGN_TOKENS.radius.control,
  redesignBorder: UI_REDESIGN_TOKENS.border.width,
});

afterEach(() => { Dimensions.set({ window: originalWindow, screen: originalScreen }); });

it('recomputes shared and nested tokens on resize and returns to the original values', () => {
  resize(320, 640);
  const narrow = captureTokens();
  resize(1024, 1366);
  const wide = captureTokens();
  expect(wide.spacing).toBeGreaterThan(narrow.spacing);
  expect(wide.radius).toBeGreaterThan(narrow.radius);
  expect(wide.icon).toBeGreaterThan(narrow.icon);
  expect(wide.font).toBeGreaterThan(narrow.font);
  expect(wide.componentButtonFont).toBe(wide.font);
  expect(wide.redesignButtonFont).toBe(wide.font);
  expect(wide.redesignSpacing).toBe(wide.spacing);
  expect(wide.redesignRadius).toBe(BorderRadius.sm);
  expect(wide.redesignBorder).toBe(wide.border);
  resize(320, 640);
  expect(captureTokens()).toEqual(narrow);
});

it.each([320, 430, 768])('keeps controls and fonts stable when a keyboard reduces height at width %i', width => {
  resize(width, 640);
  const withoutKeyboard = captureTokens();
  const initialControl = scaleControlSize(24);
  const initialFont = rf(16);
  resize(width, 280);
  expect(captureTokens()).toEqual(withoutKeyboard);
  expect(scaleControlSize(24)).toBe(initialControl);
  expect(rf(16)).toBe(initialFont);
});

it('bounds tablet control sizes while preserving proportional canvas geometry', () => {
  resize(750, 1334);
  // A twice-sized canvas still doubles geometric units; touch controls stay near their design size.
  expect(wp(100)).toBe(200);
  expect(hp(100)).toBe(200);
  expect(rs(100)).toBe(200);
  expect(scaleControlSize(100)).toBeGreaterThanOrEqual(100);
  expect(scaleControlSize(100)).toBeLessThanOrEqual(115);
  resize(1500, 2668);
  expect(wp(100)).toBe(400);
  expect(hp(100)).toBe(400);
  expect(rs(100)).toBe(400);
  expect(scaleControlSize(100)).toBeLessThanOrEqual(115);
});

it('refreshes settings base and merged styles across resize without freezing the initial tokens', () => {
  resize(320, 640);
  const narrow = createSettingsStyles(Colors.light, 320, 640);
  expect(createSettingsStyles(Colors.light, 320, 640)).toBe(narrow);
  resize(1024, 1366);
  const wide = createSettingsStyles(Colors.light, 1024, 1366);
  expect(wide.autoBackupDiagnosticCard.padding).toBeGreaterThan(narrow.autoBackupDiagnosticCard.padding);
  expect(wide.autoBackupDiagnosticTitle.fontSize).toBeGreaterThan(narrow.autoBackupDiagnosticTitle.fontSize);
  expect(wide.autoBackupDiagnosticCard.padding).toBe(Spacing.md);
  resize(320, 640);
  expect(createSettingsStyles(Colors.light, 320, 640)).toEqual(narrow);
});

it('includes theme changes in the settings cache while leaving modal scrolling to the bounded body', () => {
  resize(430, 1000);
  const light = createSettingsStyles(Colors.light, 430, 1000);
  expect(createSettingsStyles(Colors.light, 430, 1000)).toBe(light);
  const dark = createSettingsStyles(Colors.dark, 430, 1000);
  expect(dark.container.backgroundColor).toBe(Colors.dark.backgroundRoot);
  expect(dark.container.backgroundColor).not.toBe(light.container.backgroundColor);
  expect(dark.modalScrollArea).toMatchObject({ flex: 1, minHeight: 0 });
  expect(dark.modalScrollArea.maxHeight).toBeUndefined();
  expect(createSettingsStyles(Colors.dark, 430, 1000)).toBe(dark);
});

it('invalidates settings pixel rounding on density changes without multiplying system font scale twice', () => {
  resize(320, 640);
  const initial = createSettingsStyles(Colors.light, 320, 640);
  const dense: ScaledSize = { width: 320, height: 640, scale: 3, fontScale: 1 };
  Dimensions.set({ window: dense, screen: dense });
  const rounded = createSettingsStyles(Colors.light, 320, 640);
  expect(rounded).not.toBe(initial);
  expect(rounded.autoBackupDiagnosticCard.padding).toBe(Spacing.md);
  expect(rounded.autoBackupDiagnosticCard.padding).not.toBe(initial.autoBackupDiagnosticCard.padding);
  Dimensions.set({ window: { ...dense, fontScale: 1.3 }, screen: { ...dense, fontScale: 1.3 } });
  expect(createSettingsStyles(Colors.light, 320, 640)).toBe(rounded);
});
