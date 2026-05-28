import { Dimensions } from 'react-native';
import { rs, rf, getDeviceInfo } from '@/utils/responsive';

import {
  LightColors,
  DarkColors,
  withAlpha,
  StatusBgColors,
  StatusBorderColors,
} from '@/resources/colors';

export {
  LightColors,
  DarkColors,
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

// 首页模块主题色
export const ModuleColors = {
  light: {
    inbound: "#198F6B",
    outbound: "#2F6FDD",
    orders: "#C7862E",
    inventory: "#C55B52",
    materials: "#198CA8",
    settings: "#5F7187",
  },
  dark: {
    inbound: "#3FC89A",
    outbound: "#63A1FF",
    orders: "#E0A14C",
    inventory: "#F07A7A",
    materials: "#46B9D6",
    settings: "#A8B8CB",
  },
};

// 边框宽度常量 - 使用函数动态获取
export const getBorderWidth = () => ({
  thin: Math.max(1, rs(1)),
  normal: Math.max(1, rs(1.5)),
  thick: Math.max(1.5, rs(2)),
});

// 判断是否为小屏幕PDA（4寸屏等）
const isSmallScreen = (() => {
  const { width } = Dimensions.get('window');
  return width <= 410;
})();

// 间距常量 - 使用函数动态获取，小屏幕适当缩小
export const getSpacing = () => {
  const scale = isSmallScreen ? 0.9 : 1;
  return {
    xs: rs(6 * scale),
    sm: rs(10 * scale),
    md: rs(16 * scale),
    lg: rs(20 * scale),
    xl: rs(24 * scale),
    "2xl": rs(30 * scale),
    "3xl": rs(38 * scale),
    "4xl": rs(48 * scale),
    "5xl": rs(58 * scale),
    "6xl": rs(72 * scale),
  };
};

// 圆角常量 - 使用函数动态获取
export const getBorderRadius = () => ({
  xs: rs(4),
  sm: rs(8),
  md: rs(12),
  lg: rs(18),
  xl: rs(24),
  "2xl": rs(28),
  "3xl": rs(34),
  "4xl": rs(40),
  full: 9999,
});

// 图标尺寸 - 使用函数动态获取
export const getIconSize = () => ({
  xs: rs(12),
  sm: rs(14),
  md: rs(16),
  lg: rs(20),
  xl: rs(24),
  "2xl": rs(28),
  "3xl": rs(32),
  "4xl": rs(36),
  "5xl": rs(40),
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

// 为了兼容现有代码，导出静态版本（但会在首次访问时计算）
// 注意：这些值在模块加载时计算，不会响应屏幕变化
// 新代码应该使用 getSpacing()、getBorderRadius() 等函数

let _spacing: ReturnType<typeof getSpacing> | null = null;
let _borderRadius: ReturnType<typeof getBorderRadius> | null = null;
let _borderWidth: ReturnType<typeof getBorderWidth> | null = null;
let _typography: ReturnType<typeof getTypography> | null = null;

export const Spacing = new Proxy({} as ReturnType<typeof getSpacing>, {
  get(_, prop) {
    if (!_spacing) _spacing = getSpacing();
    return _spacing[prop as keyof typeof _spacing];
  }
});

export const BorderRadius = new Proxy({} as ReturnType<typeof getBorderRadius>, {
  get(_, prop) {
    if (!_borderRadius) _borderRadius = getBorderRadius();
    return _borderRadius[prop as keyof typeof _borderRadius];
  }
});

export const BorderWidth = new Proxy({} as ReturnType<typeof getBorderWidth>, {
  get(_, prop) {
    if (!_borderWidth) _borderWidth = getBorderWidth();
    return _borderWidth[prop as keyof typeof _borderWidth];
  }
});

export const Typography = new Proxy({} as ReturnType<typeof getTypography>, {
  get(_, prop) {
    if (!_typography) _typography = getTypography();
    return _typography[prop as keyof typeof _typography];
  }
});

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
