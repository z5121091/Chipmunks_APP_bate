/**
 * 统一尺寸资源 - 模拟 Android @dimen
 * 所有尺寸必须从此处引用，禁止硬编码
 */

import { Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 基准设计尺寸（以 iPhone SE 375x667 为基准）
const BASE_WIDTH = 375;
const BASE_HEIGHT = 667;

// 屏幕尺寸判断
export const isSmallScreen = SCREEN_WIDTH <= 375;
export const isMediumScreen = SCREEN_WIDTH > 375 && SCREEN_WIDTH <= 414;
export const isLargeScreen = SCREEN_WIDTH >= 430;

// 屏幕尺寸
export const ScreenSize = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  isSmall: isSmallScreen,
  isMedium: isMediumScreen,
  isLarge: isLargeScreen,
} as const;

// 尺寸缩放因子
const getScaleFactor = () => {
  const scale = Math.min(SCREEN_WIDTH / BASE_WIDTH, SCREEN_HEIGHT / BASE_HEIGHT);
  if (isSmallScreen) {
    return Math.max(scale, 0.85); // 小屏最小 85%
  }
  if (isLargeScreen) {
    return Math.min(scale, 1.15); // 大屏最大 115%
  }
  return scale;
};

const scaleFactor = getScaleFactor();

// 安全尺寸转换（响应式）
const rs = (size: number): number => {
  return PixelRatio.roundToNearestPixel(size * scaleFactor);
};

// ============================================
// 间距尺寸
// ============================================
export const Spacing = {
  // 基础间距
  xs: rs(4),    // 极小间距
  sm: rs(8),    // 小间距
  md: rs(14),   // 中等间距
  lg: rs(18),   // 大间距
  xl: rs(22),   // 较大间距
  xxl: rs(28),  // 双倍间距

  // 页面级间距
  pagePadding: rs(16),   // 页面内边距
  sectionGap: rs(20),    // 区块间距
  itemGap: rs(12),       // 列表项间距

  // 小屏适配
  ...(isSmallScreen && {
    pagePadding: rs(12),
    sectionGap: rs(16),
    itemGap: rs(10),
  }),
} as const;

// ============================================
// 圆角尺寸
// ============================================
export const Radius = {
  xs: rs(3),    // 极小圆角
  sm: rs(6),    // 小圆角
  md: rs(10),   // 中等圆角
  lg: rs(14),   // 大圆角
  xl: rs(18),   // 较大圆角
  xxl: rs(22),  // 双倍圆角
  full: 9999,   // 完全圆角
} as const;

// ============================================
// 字体尺寸
// ============================================
export const FontSize = {
  // 标题类
  h1: rs(28),     // 一级标题
  h2: rs(24),     // 二级标题
  h3: rs(20),     // 三级标题
  h4: rs(18),     // 四级标题

  // 正文类
  body: rs(15),   // 正文
  bodyMedium: rs(15),
  bodySmall: rs(14),

  // 辅助类
  caption: rs(12),  // 辅助说明
  captionSmall: rs(11),
  tiny: rs(10),    // 极小文字

  // 特殊类
  button: rs(14),   // 按钮文字
  input: rs(15),    // 输入框
  tab: rs(10),      // Tab 标签

  // 大屏放大
  ...(isLargeScreen && {
    h1: rs(32),
    h2: rs(28),
    h3: rs(24),
    h4: rs(20),
    body: rs(17),
    bodyMedium: rs(17),
    bodySmall: rs(16),
    caption: rs(14),
  }),
} as const;

// ============================================
// 图标尺寸
// ============================================
export const IconSize = {
  xs: rs(12),   // 极小图标
  sm: rs(14),   // 小图标
  md: rs(16),   // 中等图标
  lg: rs(20),   // 大图标
  xl: rs(24),   // 特大图标
  xxl: rs(28),  // 双倍图标
  xxxl: rs(32), // 三倍图标

  // 模块图标
  moduleIcon: rs(28),  // 首页模块图标
  moduleIconSmall: rs(24),
} as const;

// ============================================
// 组件尺寸
// ============================================
export const ComponentSize = {
  // 按钮
  buttonHeight: rs(44),      // 按钮高度
  buttonHeightSmall: rs(36), // 小按钮高度
  buttonHeightLarge: rs(52),  // 大按钮高度

  // 输入框
  inputHeight: rs(44),       // 输入框高度
  inputHeightLarge: rs(52),  // 大输入框

  // 列表项
  listItemHeight: rs(56),    // 列表项高度
  listItemPadding: rs(12),  // 列表项内边距

  // 头像
  avatarSmall: rs(32),
  avatarMedium: rs(44),
  avatarLarge: rs(64),

  // 图标容器
  iconContainer: rs(44),     // 图标容器大小
  iconContainerSmall: rs(36),

  // Tab Bar
  tabBarHeight: rs(50),

  // 状态栏
  statusBarHeight: rs(44),
} as const;

// ============================================
// 阴影配置
// ============================================
export const Shadow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;

// ============================================
// 边框宽度
// ============================================
export const BorderWidth = {
  thin: Math.max(1, rs(1)),
  normal: Math.max(1, rs(1.5)),
  thick: Math.max(1.5, rs(2)),
} as const;

// ============================================
// 动画配置
// ============================================
export const Animation = {
  fast: 150,    // 快速动画
  normal: 250,  // 正常动画
  slow: 350,    // 慢速动画

  // 弹性动画参数
  spring: {
    damping: 15,
    stiffness: 300,
  },
} as const;

// 类型导出
export type SpacingKey = keyof typeof Spacing;
export type RadiusKey = keyof typeof Radius;
export type FontSizeKey = keyof typeof FontSize;
export type IconSizeKey = keyof typeof IconSize;
