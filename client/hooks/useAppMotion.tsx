import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

const MotionContext = createContext(false);

export function AppMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    let eventReceived = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      eventReceived = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !eventReceived) setReduced(value);
    }).catch(() => undefined);
    return () => { active = false; subscription.remove(); };
  }, []);
  return <MotionContext.Provider value={reduced}>{children}</MotionContext.Provider>;
}

export const useAppMotion = () => useContext(MotionContext);
