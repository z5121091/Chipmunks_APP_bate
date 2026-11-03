import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

const overlays = new Set<symbol>();
const listeners = new Set<() => void>();
const snapshot = () => overlays.size > 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const notifyChange = (previous: boolean) => {
  if (previous !== snapshot()) listeners.forEach(listener => listener());
};

/** Includes closing surfaces so a scanner cannot steal focus from an exiting form. */
export function useOverlayPresence(present: boolean) {
  const [id] = useState(() => Symbol('overlay'));
  useLayoutEffect(() => {
    if (!present) return;
    const previous = snapshot();
    overlays.add(id); notifyChange(previous);
    return () => {
      const wasActive = snapshot();
      overlays.delete(id); notifyChange(wasActive);
    };
  }, [id, present]);
}

export const useOverlayActivity = () => useSyncExternalStore(subscribe, snapshot, snapshot);
