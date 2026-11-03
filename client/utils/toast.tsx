/**
 * Toast 提示工具
 * 统一的提示反馈组件
 */

import { useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppPillToast } from '@/components/AppPillToast';
import { getFeedbackDuration, type FeedbackTimingOptions } from '@/utils/feedbackTiming';

// 页面提示类型
type ToastType = 'success' | 'warning' | 'error';

// ============================================================================
// 页面内提示
// ============================================================================

type ToastOptions = FeedbackTimingOptions;

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
type ToastState = { text: string; type: ToastType } | null;
function createToastStore() {
  let value: ToastState = null;
  const listeners = new Set<() => void>();
  return { get: () => value, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, set: (next: ToastState) => { value = next; listeners.forEach(listener => listener()); } };
}

export function useToast(options: ToastOptions = {}): UseToastReturn {
  const { duration, persistentErrors } = options;
  const [store] = useState(createToastStore);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string, type: ToastType = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    store.set({ text, type });
    const delay = getFeedbackDuration(type, { duration, persistentErrors });
    if (delay !== null) timerRef.current = setTimeout(() => {
      store.set(null);
      timerRef.current = null;
    }, delay);
  }, [duration, persistentErrors, store]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const ToastContainer = useMemo(() => function ToastHost() {
    const value = useSyncExternalStore(store.subscribe, store.get, store.get);
    return <AppPillToast text={value?.text || ''} type={value?.type || 'success'} visible={Boolean(value)} />;
  }, [store]);
  return { showToast, ToastContainer };
}

// ============================================================================
// 兼容仍在使用全局提示的旧页面。
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
