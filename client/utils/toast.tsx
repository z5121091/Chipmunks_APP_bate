/**
 * Toast 提示工具
 * 统一的提示反馈组件
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AppPillToast } from '@/components/AppPillToast';

// Toast 类型
type ToastType = 'success' | 'warning' | 'error';

// ============================================================================
// Toast Hook - 页面使用
// ============================================================================

interface ToastOptions {
  duration?: number; // 显示时长，默认 500ms
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
  const { duration } = options;
  const [toastState, setToastState] = useState<{
    id: number;
    text: string;
    type: ToastType;
  } | null>(null);
  const toastIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    setToastState(null);
  }, []);

  const showToast = useCallback((msg: string, toastType: ToastType = 'success') => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 使用公共提示组件，保证扫码主流程与记录页的主题色、图标和深色模式一致。
    setToastState({
      id: ++toastIdRef.current,
      text: msg,
      type: toastType,
    });

    const displayDuration =
      duration ?? (toastType === 'error' ? 2800 : toastType === 'warning' ? 2400 : 2200);
    timerRef.current = setTimeout(hideToast, displayDuration);
  }, [duration, hideToast]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const ToastContainer: React.FC = useCallback(() => {
    if (!toastState) return null;

    return (
      <AppPillToast
        key={toastState.id}
        text={toastState.text}
        type={toastState.type}
      />
    );
  }, [toastState]);

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
