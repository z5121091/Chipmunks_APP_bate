import { Easing } from 'react-native';
import timing from '@/constants/motionTiming.json';

/** One rhythm for navigation, local disclosure and feedback. Business work never waits for it. */
export const APP_MOTION = {
  // Also read by the Expo plugin that writes Android's native slide durations.
  ...timing,
  buttonScale: 0.985,
  cardScale: 0.992,
  sortSpring: { damping: 22, stiffness: 300, mass: 0.8 },
  sortReturnSpring: { damping: 22, stiffness: 280, mass: 0.8 },
  sortLayout: { damping: 160, stiffness: 2000, mass: 4 },
  swipe: { bounciness: 2, speed: 18 },
  easing: Easing.out(Easing.cubic),
} as const;
