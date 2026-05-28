/**
 * 统一颜色资源 - 模拟 Android @color
 * 所有颜色必须从此处引用，禁止硬编码
 * 
 * 使用方式：
 * - 静态引用: Colors.success, Colors.primary
 * - 半透明: withAlpha(Colors.success, 0.1)
 * - 主题色: useTheme().theme.success
 */

// ============================================
// 颜色定义
// ============================================

// 基础文字色
const textPrimary = {
  light: '#10233B',
  dark: '#F8FAFC',
} as const;

const textSecondary = {
  light: '#3C526E',
  dark: '#CBD5E1',
} as const;

const textMuted = {
  light: '#72839A',
  dark: '#94A3B8',
} as const;

// 主色调
const primary = {
  light: '#173A5E',
  dark: '#DCE9F8',
} as const;

const accent = {
  light: '#2F6FDD',
  dark: '#63A1FF',
} as const;

// 状态色
const success = {
  light: '#168A67',
  dark: '#3FC89A',
} as const;

const error = {
  light: '#D34B4B',
  dark: '#F07A7A',
} as const;

const warning = {
  light: '#C7862E',
  dark: '#E0A14C',
} as const;

const info = {
  light: '#2F6FDD',
  dark: '#63A1FF',
} as const;

// 功能色
const purple = {
  light: '#7663D7',
  dark: '#A895F2',
} as const;

const cyan = {
  light: '#198CA8',
  dark: '#46B9D6',
} as const;

// 背景色
const backgroundRoot = {
  light: '#EEF3F8',
  dark: '#07111D',
} as const;

const backgroundDefault = {
  light: '#FFFFFF',
  dark: '#102033',
} as const;

const backgroundTertiary = {
  light: '#F5F8FB',
  dark: '#17314C',
} as const;

const backgroundInset = {
  light: '#E4EBF3',
  dark: '#0B1828',
} as const;

const backgroundElevated = {
  light: '#FBFCFE',
  dark: '#14283F',
} as const;

// 边框色
const border = {
  light: '#D7E0EA',
  dark: '#28445F',
} as const;

const borderLight = {
  light: '#E7EEF5',
  dark: '#1D3650',
} as const;

// ============================================
// 颜色工具函数
// ============================================

// 颜色转换工具
const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
};

// ============================================
// 半透明颜色工厂函数
// ============================================

/**
 * 创建带透明度的颜色
 * @param hex 基础颜色（#RRGGBB 格式）
 * @param alpha 透明度（0-1）
 */
export const withAlpha = (hex: string, alpha: number): string => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * 创建白色带透明度
 */
export const whiteAlpha = (alpha: number): string => {
  return withAlpha('#FFFFFF', alpha);
};

/**
 * 创建黑色带透明度
 */
export const blackAlpha = (alpha: number): string => {
  return withAlpha('#000000', alpha);
};

/**
 * 创建主题色带透明度
 */
export const colorAlpha = (color: string, alpha: number): string => {
  return withAlpha(color, alpha);
};

// ============================================
// 颜色资源导出（静态值，用于 theme.ts）
// ============================================

// 浅色主题颜色
export const LightColors = {
  text: {
    primary: textPrimary.light,
    secondary: textSecondary.light,
    muted: textMuted.light,
  },
  primary: primary.light,
  accent: accent.light,
  success: success.light,
  error: error.light,
  warning: warning.light,
  info: info.light,
  purple: purple.light,
  cyan: cyan.light,
  background: {
    root: backgroundRoot.light,
    default: backgroundDefault.light,
    tertiary: backgroundTertiary.light,
    inset: backgroundInset.light,
    elevated: backgroundElevated.light,
  },
  border: {
    default: border.light,
    light: borderLight.light,
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: {
    light: 'rgba(11, 23, 37, 0.18)',
    dark: 'rgba(2, 8, 16, 0.72)',
    extraLight: 'rgba(11, 23, 37, 0.1)',
  },
  tag: {
    blue: info.light,
    green: success.light,
    orange: warning.light,
    purple: purple.light,
    cyan: cyan.light,
    gray: {
      light: '#6B7280',
      dark: '#9CA3AF',
    },
  },
  module: {
    inbound: '#198F6B',
    outbound: '#2F6FDD',
    orders: '#C7862E',
    inventory: '#C55B52',
    materials: '#198CA8',
    settings: {
      light: '#5F7187',
      dark: '#97A9C0',
    },
  },
  button: {
    primary: '#FFFFFF',
    secondary: textPrimary.light,
  },
  shadow: '#10233B',
} as const;

// 深色主题颜色
export const DarkColors = {
  text: {
    primary: textPrimary.dark,
    secondary: textSecondary.dark,
    muted: textMuted.dark,
  },
  primary: primary.dark,
  accent: accent.dark,
  success: success.dark,
  error: error.dark,
  warning: warning.dark,
  info: info.dark,
  purple: purple.dark,
  cyan: cyan.dark,
  background: {
    root: backgroundRoot.dark,
    default: backgroundDefault.dark,
    tertiary: backgroundTertiary.dark,
    inset: backgroundInset.dark,
    elevated: backgroundElevated.dark,
  },
  border: {
    default: border.dark,
    light: borderLight.dark,
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: {
    light: 'rgba(6, 11, 18, 0.36)',
    dark: 'rgba(2, 7, 13, 0.8)',
    extraLight: 'rgba(6, 11, 18, 0.18)',
  },
  tag: {
    blue: info.dark,
    green: success.dark,
    orange: warning.dark,
    purple: purple.dark,
    cyan: cyan.dark,
    gray: {
      light: '#6B7280',
      dark: '#9CA3AF',
    },
  },
  module: {
    inbound: '#3FC89A',
    outbound: '#63A1FF',
    orders: '#E0A14C',
    inventory: '#F07A7A',
    materials: '#46B9D6',
    settings: {
      light: '#6D8098',
      dark: '#A8B8CB',
    },
  },
  button: {
    primary: '#07111D',
    secondary: textPrimary.dark,
  },
  shadow: '#020814',
} as const;

// 默认导出浅色主题（运行时会被 useTheme 覆盖）
export const Colors = LightColors;

// ============================================
// 预设颜色组合
// ============================================

// 状态背景色（浅色背景配深色文字）
export const StatusBgColors = {
  success: withAlpha(success.light, 0.1),
  error: withAlpha(error.light, 0.1),
  warning: withAlpha(warning.light, 0.1),
  info: withAlpha(info.light, 0.1),
} as const;

// 状态边框色
export const StatusBorderColors = {
  success: withAlpha(success.light, 0.2),
  error: withAlpha(error.light, 0.2),
  warning: withAlpha(warning.light, 0.2),
  info: withAlpha(info.light, 0.2),
} as const;

// 类型导出
export type ColorKey = keyof typeof LightColors;
export type LightColorTheme = typeof LightColors;
export type DarkColorTheme = typeof DarkColors;
