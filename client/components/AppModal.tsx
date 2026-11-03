import { Animated, Modal, type ModalProps } from 'react-native';
import { ModalMotionContext, useMotionPresence, useRetainedValue } from '@/components/AppMotion';
import { useOverlayPresence } from '@/hooks/useOverlayActivity';

/** Owns visual dismissal even when business state/selected record is cleared immediately. */
export function AppModal({ visible = true, children, animationType, onRequestClose, ...props }: ModalProps) {
  const { present, progress } = useMotionPresence(Boolean(visible));
  useOverlayPresence(present);
  const last = useRetainedValue(Boolean(visible) && children != null, children);
  if (!present) return null;
  return <Modal {...props} visible animationType="none"
    onRequestClose={event => { if (visible) onRequestClose?.(event); }}>
    <ModalMotionContext.Provider value={progress}>
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} style={{ flex: 1, opacity: progress,
        transform: animationType === 'slide' ? [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] : [] }}>
        {visible && children != null ? children : last}
      </Animated.View>
    </ModalMotionContext.Provider>
  </Modal>;
}
