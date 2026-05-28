/**
 * 统一资源导出 - Android @string/@dimen/@color 模拟
 * 
 * 使用规范：
 * - 字符串: Str.xxx
 * - 尺寸: Spacing.xxx, FontSize.xxx, Radius.xxx
 * - 颜色: Colors.xxx (在 useTheme 中通过 theme.xxx 访问)
 */

// 字符串资源
export { Str, getString, type StrKey } from './strings';

// 尺寸资源
export {
  Spacing,
  Radius,
  FontSize,
  IconSize,
  ComponentSize,
  Shadow,
  BorderWidth,
  Animation,
  ScreenSize,
  type SpacingKey,
  type RadiusKey,
  type FontSizeKey,
  type IconSizeKey,
} from './dimens';

// 颜色资源
export {
  Colors,
  LightColors,
  DarkColors,
  withAlpha,
  whiteAlpha,
  blackAlpha,
  colorAlpha,
  StatusBgColors,
  StatusBorderColors,
  type ColorKey,
  type LightColorTheme,
  type DarkColorTheme,
} from './colors';
