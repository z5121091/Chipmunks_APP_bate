import { useCallback, useLayoutEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** Consume Android back only while this screen is focused; false keeps normal navigation. */
export function useHardwareBack(handler: () => boolean) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => { handlerRef.current = handler; }, [handler]);
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => handlerRef.current());
    return () => subscription.remove();
  }, []));
}
