import { Dimensions } from 'react-native';
import { scaleControlSize, rf, getDeviceInfo } from '@/utils/responsive';

import {
  LightColors,
  DarkColors,
  ModuleColors,
  withAlpha,
  StatusBgColors,
  StatusBorderColors,
} from '@/resources/colors';

export {
  LightColors,
  DarkColors,
  ModuleColors,
  withAlpha,
  StatusBgColors,
  StatusBorderColors,
};

// 保持向后兼容：直接使用资源中的颜色值
export const Colors = {
  light: {
    // 基础文字色
    textPrimary: LightColors.text.primary,
    textSecondary: LightColors.text.secondary,
    textMuted: LightColors.text.muted,
    // 主色调
    primary: LightColors.primary,
    accent: LightColors.accent,
    // 状态色
    success: LightColors.success,
    error: LightColors.error,
    warning: LightColors.warning,
    info: LightColors.info,
    // 功能色
    purple: LightColors.purple,
    cyan: LightColors.cyan,
    // 背景色
    backgroundRoot: LightColors.background.root,
    backgroundDefault: LightColors.background.default,
    backgroundTertiary: LightColors.background.tertiary,
    backgroundInset: LightColors.background.inset,
    backgroundElevated: LightColors.background.elevated,
    // 按钮文字
    buttonPrimaryText: LightColors.button.primary,
    // TabBar
    tabIconSelected: LightColors.primary,
    // 边框色
    border: LightColors.border.default,
    borderLight: LightColors.border.light,
    // 特殊
    white: LightColors.white,
    black: LightColors.black,
    overlay: LightColors.overlay.light,
    shadowColor: LightColors.shadow,
    // 标签状态
    tagBlue: LightColors.tag.blue,
    tagGreen: LightColors.tag.green,
    tagOrange: LightColors.tag.orange,
    tagPurple: LightColors.tag.purple,
    tagCyan: LightColors.tag.cyan,
    tagGray: LightColors.tag.gray.light,
    // 是否深色模式（用于组件内判断）
    isDark: false,
  },
  dark: {
    // 基础文字色
    textPrimary: DarkColors.text.primary,
    textSecondary: DarkColors.text.secondary,
    textMuted: DarkColors.text.muted,
    // 主色调
    primary: DarkColors.primary,
    accent: DarkColors.accent,
    // 状态色
    success: DarkColors.success,
    error: DarkColors.error,
    warning: DarkColors.warning,
    info: DarkColors.info,
    // 功能色
    purple: DarkColors.purple,
    cyan: DarkColors.cyan,
    // 背景色
    backgroundRoot: DarkColors.background.root,
    backgroundDefault: DarkColors.background.default,
    backgroundTertiary: DarkColors.background.tertiary,
    backgroundInset: DarkColors.background.inset,
    backgroundElevated: DarkColors.background.elevated,
    // 按钮文字
    buttonPrimaryText: DarkColors.button.primary,
    // TabBar
    tabIconSelected: DarkColors.primary,
    // 边框色
    border: DarkColors.border.default,
    borderLight: DarkColors.border.light,
    // 特殊
    white: DarkColors.white,
    black: DarkColors.black,
    overlay: DarkColors.overlay.dark,
    shadowColor: DarkColors.shadow,
    // 标签状态
    tagBlue: DarkColors.tag.blue,
    tagGreen: DarkColors.tag.green,
    tagOrange: DarkColors.tag.orange,
    tagPurple: DarkColors.tag.purple,
    tagCyan: DarkColors.tag.cyan,
    tagGray: DarkColors.tag.gray.dark,
    // 是否深色模式
    isDark: true,
  },
};

// 边框宽度常量 - 使用函数动态获取
export const getBorderWidth = () => ({
  thin: Math.max(1, scaleControlSize(1)),
  normal: Math.max(1, scaleControlSize(1.5)),
  thick: Math.max(1.5, scaleControlSize(2)),
});

// 间距常量 - 使用函数动态获取，小屏幕适当缩小
export const getSpacing = () => {
  const scale = Dimensions.get('window').width <= 410 ? 0.9 : 1;
  return {
    xs: scaleControlSize(6 * scale),
    sm: scaleControlSize(10 * scale),
    md: scaleControlSize(16 * scale),
    lg: scaleControlSize(20 * scale),
    xl: scaleControlSize(24 * scale),
    "2xl": scaleControlSize(30 * scale),
    "3xl": scaleControlSize(38 * scale),
    "4xl": scaleControlSize(48 * scale),
    "5xl": scaleControlSize(58 * scale),
    "6xl": scaleControlSize(72 * scale),
  };
};

// 圆角常量 - 使用函数动态获取
export const getBorderRadius = () => ({
  xs: scaleControlSize(4),
  sm: scaleControlSize(8),
  md: scaleControlSize(12),
  lg: scaleControlSize(18),
  xl: scaleControlSize(24),
  "2xl": scaleControlSize(28),
  "3xl": scaleControlSize(34),
  "4xl": scaleControlSize(40),
  full: 9999,
});

// 图标尺寸 - 使用函数动态获取
export const getIconSize = () => ({
  xs: scaleControlSize(12),
  sm: scaleControlSize(14),
  md: scaleControlSize(16),
  lg: scaleControlSize(20),
  xl: scaleControlSize(24),
  "2xl": scaleControlSize(28),
  "3xl": scaleControlSize(32),
  "4xl": scaleControlSize(36),
  "5xl": scaleControlSize(40),
});

// 排版常量 - 使用函数动态获取
export const getTypography = () => ({
  display: {
    fontSize: rf(96),
    lineHeight: rf(96),
    fontWeight: "200" as const,
    letterSpacing: 0,
  },
  displayLarge: {
    fontSize: rf(96),
    lineHeight: rf(96),
    fontWeight: "200" as const,
    letterSpacing: 0,
  },
  displayMedium: {
    fontSize: rf(40),
    lineHeight: rf(48),
    fontWeight: "200" as const,
  },
  h1: {
    fontSize: rf(30),
    lineHeight: rf(38),
    fontWeight: "800" as const,
  },
  h2: {
    fontSize: rf(25),
    lineHeight: rf(33),
    fontWeight: "800" as const,
  },
  h3: {
    fontSize: rf(21),
    lineHeight: rf(29),
    fontWeight: "700" as const,
  },
  h4: {
    fontSize: rf(18),
    lineHeight: rf(25),
    fontWeight: "700" as const,
  },
  title: {
    fontSize: rf(17),
    lineHeight: rf(24),
    fontWeight: "700" as const,
  },
  body: {
    fontSize: rf(15),
    lineHeight: rf(23),
    fontWeight: "400" as const,
  },
  bodyMedium: {
    fontSize: rf(15),
    lineHeight: rf(23),
    fontWeight: "500" as const,
  },
  small: {
    fontSize: rf(14),
    lineHeight: rf(21),
    fontWeight: "400" as const,
  },
  smallMedium: {
    fontSize: rf(14),
    lineHeight: rf(21),
    fontWeight: "600" as const,
  },
  formLabel: {
    fontSize: rf(13),
    lineHeight: rf(18),
    fontWeight: "600" as const,
    letterSpacing: 0,
  },
  formHint: {
    fontSize: rf(11),
    lineHeight: rf(16),
    fontWeight: "400" as const,
    letterSpacing: 0,
  },
  caption: {
    fontSize: rf(12),
    lineHeight: rf(18),
    fontWeight: "400" as const,
  },
  captionMedium: {
    fontSize: rf(12),
    lineHeight: rf(18),
    fontWeight: "600" as const,
  },
  label: {
    fontSize: rf(12),
    lineHeight: rf(16),
    fontWeight: "500" as const,
    letterSpacing: 0,
    textTransform: "uppercase" as const,
  },
  labelSmall: {
    fontSize: rf(10),
    lineHeight: rf(14),
    fontWeight: "500" as const,
    letterSpacing: 0,
    textTransform: "uppercase" as const,
  },
  labelTitle: {
    fontSize: rf(12),
    lineHeight: rf(16),
    fontWeight: "700" as const,
    letterSpacing: 0,
    textTransform: "uppercase" as const,
  },
  dialogTitle: {
    fontSize: rf(19),
    lineHeight: rf(27),
    fontWeight: "800" as const,
    letterSpacing: 0,
  },
  dialogBody: {
    fontSize: rf(15),
    lineHeight: rf(24),
    fontWeight: "400" as const,
    letterSpacing: 0,
  },
  dialogAction: {
    fontSize: rf(15),
    lineHeight: rf(22),
    fontWeight: "700" as const,
    letterSpacing: 0,
  },
  dialogNote: {
    fontSize: rf(14),
    lineHeight: rf(22),
    fontWeight: "400" as const,
    letterSpacing: 0,
  },
  feedback: {
    fontSize: rf(14),
    lineHeight: rf(20),
    fontWeight: "800" as const,
    letterSpacing: 0,
  },
  link: {
    fontSize: rf(15),
    lineHeight: rf(22),
    fontWeight: "400" as const,
  },
  stat: {
    fontSize: rf(26),
    lineHeight: rf(32),
    fontWeight: "300" as const,
  },
  tiny: {
    fontSize: rf(10),
    lineHeight: rf(14),
    fontWeight: "400" as const,
  },
  navLabel: {
    fontSize: rf(10),
    lineHeight: rf(14),
    fontWeight: "500" as const,
  },
});

// Read the current width when accessed; preserve object identity until the width/density changes.
// Consumers cache StyleSheet snapshots through useResponsiveStyles, never at module load.
function responsiveTokens<T extends object>(create: () => T): T {
  let key = '';
  let cached: T;
  return new Proxy({} as T, {
    get(_, prop) {
      const { width, scale } = Dimensions.get('window');
      const nextKey = `${width}:${scale}`;
      if (!cached || key !== nextKey) {
        cached = create();
        key = nextKey;
      }
      return cached[prop as keyof T];
    },
  });
}

export const Spacing = responsiveTokens(getSpacing);
export const BorderRadius = responsiveTokens(getBorderRadius);
export const BorderWidth = responsiveTokens(getBorderWidth);
export const Typography = responsiveTokens(getTypography);

// 公共业务组件的稳定尺寸和排版。页面组件应优先引用这里，避免另起一套字号与高度。
export const AppComponentTokens = {
  size: {
    buttonHeight: 44,
    buttonHeightCompact: 44,
    buttonHeightCompactSmall: 44,
    inputHeight: 52,
    inputHeightSmall: 48,
    scanBoxHeight: 52,
    scanBoxHeightSmall: 50,
    listItemMinHeight: 58,
    listIcon: 38,
    listIconSmall: 34,
  },
  typography: {
    get button() { return Typography.smallMedium; },
    get dialogAction() { return Typography.dialogAction; },
    get dialogNote() { return Typography.dialogNote; },
    get formHint() { return Typography.formHint; },
    get formLabel() { return Typography.formLabel; },
    get input() { return Typography.small; },
    get tag() { return Typography.labelSmall; },
    get title() { return Typography.smallMedium; },
    get subtitle() { return Typography.caption; },
  },
} as const;

// Theme 类型定义 - 使用 string 类型支持浅色/深色主题
export interface Theme {
  // 基础文字色
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // 主色调
  primary: string;
  accent: string;
  // 状态色
  success: string;
  error: string;
  warning: string;
  info: string;
  // 功能色
  purple: string;
  cyan: string;
  // 背景色
  backgroundRoot: string;
  backgroundDefault: string;
  backgroundTertiary: string;
  backgroundInset: string;
  backgroundElevated: string;
  // 按钮文字
  buttonPrimaryText: string;
  // TabBar
  tabIconSelected: string;
  // 边框色
  border: string;
  borderLight: string;
  // 特殊
  white: string;
  black: string;
  overlay: string;
  shadowColor: string;
  // 标签状态
  tagBlue: string;
  tagGreen: string;
  tagOrange: string;
  tagPurple: string;
  tagCyan: string;
  tagGray: string;
  // 是否深色模式
  isDark: boolean;
}

// 导出设备信息函数
export { getDeviceInfo };
