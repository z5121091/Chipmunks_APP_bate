import { Dimensions, PixelRatio } from 'react-native';

// 基准设计尺寸（以 iPhone SE 375x667 为基准）
const BASE_WIDTH = 375;
const BASE_HEIGHT = 667;

/**
 * 动态获取当前屏幕尺寸
 * 每次调用都会获取最新尺寸，支持屏幕旋转等场景
 */
const getScreenDimensions = () => {
  const { width, height } = Dimensions.get('window');
  return {
    screenWidth: width,
    screenHeight: height,
    scaleWidth: width / BASE_WIDTH,
    scaleHeight: height / BASE_HEIGHT,
    scale: Math.min(width / BASE_WIDTH, height / BASE_HEIGHT),
  };
};

/**
 * 响应式尺寸转换 - 宽度
 * 基于375px设计稿，根据设备宽度自动缩放
 */
export const wp = (width: number): number => {
  const { scaleWidth } = getScreenDimensions();
  return PixelRatio.roundToNearestPixel(width * scaleWidth);
};

/**
 * 响应式尺寸转换 - 高度
 * 基于667px设计稿，根据设备高度自动缩放
 */
export const hp = (height: number): number => {
  const { scaleHeight } = getScreenDimensions();
  return PixelRatio.roundToNearestPixel(height * scaleHeight);
};

/**
 * 响应式尺寸转换 - 统一缩放
 * 使用较小的缩放比例，保持比例一致性
 */
export const rs = (size: number): number => {
  const { scale } = getScreenDimensions();
  return PixelRatio.roundToNearestPixel(size * scale);
};

/**
 * 响应式字体大小
 * - 小屏（≤375px）：缩小至0.9倍，最小不低于0.80倍
 * - 大屏（≥430px）：放大至1.2倍，最大不高于1.30倍
 * - 中等屏幕：按比例缩放
 */
export const rf = (fontSize: number): number => {
  const { scale, screenWidth } = getScreenDimensions();
  const scaledSize = fontSize * scale;
  
  // 小屏幕（≤375px）：确保最小可读性
  if (screenWidth <= 375) {
    const minSize = fontSize * 0.80;  // 最小不低于80%
    return PixelRatio.roundToNearestPixel(Math.max(scaledSize, minSize));
  }
  
  // 大屏幕（≥430px）：适度放大
  if (screenWidth >= 430) {
    const maxSize = fontSize * 1.30;  // 最大不高于130%
    return PixelRatio.roundToNearestPixel(Math.min(scaledSize, maxSize));
  }
  
  // 中等屏幕：按正常比例缩放
  return PixelRatio.roundToNearestPixel(scaledSize);
};

/**
 * 获取当前设备信息
 */
export const getDeviceInfo = () => {
  const { screenWidth, screenHeight, scale, scaleWidth, scaleHeight } = getScreenDimensions();
  return {
    screenWidth,
    screenHeight,
    pixelRatio: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
    scale,
    scaleWidth,
    scaleHeight,
    isSmallDevice: screenWidth < 360,
    isMediumDevice: screenWidth >= 360 && screenWidth < 414,
    isLargeDevice: screenWidth >= 414,
    // iPhone 15 是 390x844
    isIPhone15: screenWidth === 390 && screenHeight === 844,
  };
};

/**
 * 根据设备尺寸返回不同值
 */
export const deviceValue = <T>(options: {
  small?: T;
  medium?: T;
  large?: T;
  default: T;
}): T => {
  const { isSmallDevice, isMediumDevice } = getDeviceInfo();
  if (isSmallDevice && options.small !== undefined) return options.small;
  if (isMediumDevice && options.medium !== undefined) return options.medium;
  if (!isSmallDevice && !isMediumDevice && options.large !== undefined) return options.large;
  return options.default;
};

// 便捷导出
export const getScreenWidth = () => getScreenDimensions().screenWidth;
export const getScreenHeight = () => getScreenDimensions().screenHeight;
