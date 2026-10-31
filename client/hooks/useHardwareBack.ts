import { useCallback, useLayoutEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** Consume Android back only while this screen is focused; false keeps normal navigation. */
export function useHardwareBack(handler: () => boolean) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => { handlerRef.current = handler; }, [handler]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => handlerRef.current());
    return () => subscription.remove();
  }, []));
}
