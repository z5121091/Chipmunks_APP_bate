import { useEffect, useState } from 'react';
import { Animated, Image, View, StyleSheet } from 'react-native';

interface SplashTransitionProps {
  onFinish: () => void;
  duration?: number;
  fadeDuration?: number;
}

export default function SplashTransition({
  onFinish,
  duration = 1500,
  fadeDuration = 400,
}: SplashTransitionProps) {
  const [visible, setVisible] = useState(true);
  const [fadeAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: fadeDuration,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        onFinish();
      });
    }, duration);

    return () => clearTimeout(timer);
  }, [fadeAnim, duration, fadeDuration, onFinish]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Image
        source={require('@/assets/images/splash-universal.png')}
        style={styles.image}
        resizeMode="contain"
      />
      <View style={styles.overlay} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#EBF5FB',
    opacity: 0,
  },
});
