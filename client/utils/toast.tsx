/**
 * Toast 提示工具
 * 统一的提示反馈组件
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rf } from '@/utils/responsive';

// Toast 类型
type ToastType = 'success' | 'warning' | 'error';

// 主题色
const ToastColors = {
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  white: '#FFFFFF',
};

// ============================================================================
// Toast Hook - 页面使用
// ============================================================================

interface ToastOptions {
  duration?: number; // 显示时长，默认 500ms
  animationDuration?: number; // 动画时长，默认 100ms
}

interface UseToastReturn {
  showToast: (text: string, type?: ToastType) => void;
  ToastContainer: React.FC;
}

/**
 * Toast Hook
 * 
 * @example
 * function MyScreen() {
 *   const { showToast, ToastContainer } = useToast();
 *   
 *   const handleClick = () => {
 *     showToast('操作成功', 'success');
 *   };
 *   
 *   return (
 *     <View>
 *       <Button title="点击" onPress={handleClick} />
 *       <ToastContainer />
 *     </View>
 *   );
 * }
 */
export function useToast(options: ToastOptions = {}): UseToastReturn {
  const { duration, animationDuration = 120 } = options;
  const insets = useSafeAreaInsets();
  
  const [text, setText] = useState('');
  const [type, setType] = useState<ToastType>('success');
  const [visible, setVisible] = useState(false);
  const animRef = useRef(new Animated.Value(0));
  const anim = animRef.current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: animationDuration,
      useNativeDriver: false,
    }).start(() => {
      setVisible(false);
      setText('');
    });
  }, [anim, animationDuration]);

  const showToast = useCallback((msg: string, toastType: ToastType = 'success') => {
    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setText(msg);
    setType(toastType);
    setVisible(true);
    
    Animated.timing(anim, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: false,
    }).start();

    const displayDuration =
      duration ?? (toastType === 'error' ? 2800 : toastType === 'warning' ? 2400 : 2200);
    timerRef.current = setTimeout(hideToast, displayDuration);
  }, [anim, duration, animationDuration, hideToast]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const ToastContainer: React.FC = useCallback(() => {
    if (!visible) return null;

    const backgroundColor = ToastColors[type];

    return (
      <View pointerEvents="none" style={[styles.toastRoot, { bottom: insets.bottom + 28 }]}>
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: anim,
              transform: [
                {
                  translateY: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.toastPill, { backgroundColor }]}>
            <Text numberOfLines={2} style={styles.toastText}>{text}</Text>
          </View>
        </Animated.View>
      </View>
    );
  }, [visible, type, text, anim, insets.bottom]);

  return { showToast, ToastContainer };
}

// ============================================================================
// 全局 Toast（可选，不推荐使用）
// ============================================================================

// 全局状态（简单实现）
let globalShowToast: ((text: string, type?: ToastType) => void) | null = null;

/**
 * 设置全局 Toast 函数
 * 用于无法使用 Hook 的场景（如回调函数）
 */
export function setGlobalToast(showFn: (text: string, type?: ToastType) => void) {
  globalShowToast = showFn;
}

/**
 * 显示全局 Toast
 */
export function toast(text: string, type: ToastType = 'success') {
  if (globalShowToast) {
    globalShowToast(text, type);
  }
}

// ============================================================================
// 样式
// ============================================================================

const styles = StyleSheet.create({
  toastRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    pointerEvents: 'none',
  },
  toastContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: rf(8),
    pointerEvents: 'none',
  },
  toastPill: {
    minHeight: rf(38),
    minWidth: rf(220),
    maxWidth: '98%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: rf(26),
    paddingVertical: rf(8),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
  toastText: {
    color: ToastColors.white,
    fontSize: rf(14),
    lineHeight: rf(20),
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
