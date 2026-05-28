/**
 * 颜色工具函数 - 兼容所有Android版本
 */

/**
 * 将hex颜色转换为带透明度的rgba格式
 * @param hex - 十六进制颜色，如 '#FF5733'
 * @param alpha - 透明度，0-1 之间
 */
export const withAlpha = (hex: string, alpha: number): string => {
  // 移除 # 符号
  const cleanHex = hex.replace('#', '');
  
  // 解析RGB值
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  
  // 限制透明度范围
  const validAlpha = Math.max(0, Math.min(1, alpha));
  
  return `rgba(${r}, ${g}, ${b}, ${validAlpha})`;
};

/**
 * 创建带透明度的浅色背景（用于标签、徽章等）
 * @param hex - 十六进制颜色
 * @param intensity - 强度，可选值: 'light'(0.1), 'medium'(0.15), 'dark'(0.2)
 */
export const lightBg = (hex: string, intensity: 'light' | 'medium' | 'dark' = 'medium'): string => {
  const alphaMap = {
    light: 0.08,
    medium: 0.12,
    dark: 0.2,
  };
  return withAlpha(hex, alphaMap[intensity]);
};

/**
 * 创建带透明度的边框颜色
 * @param hex - 十六进制颜色
 */
export const lightBorder = (hex: string): string => {
  return withAlpha(hex, 0.25);
};
