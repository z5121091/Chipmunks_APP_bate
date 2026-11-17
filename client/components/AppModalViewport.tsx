import { createContext, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Actual window height inside overlay padding; keyboard visibility does not change this frame. */
export const AppModalAvailableHeight = createContext<number | undefined>(undefined);

export function AppModalViewport({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [availableHeight, setAvailableHeight] = useState<number>();
  return (
    <View style={[{ flex: 1 }, style]}>
      <View
        testID="app-modal-viewport"
        style={{ flex: 1, minHeight: 0, width: '100%', alignItems: 'center', justifyContent: 'center' }}
        onLayout={({ nativeEvent }) => {
          const height = nativeEvent.layout.height;
          if (Number.isFinite(height) && height >= 0) setAvailableHeight(height);
        }}
      >
        <AppModalAvailableHeight.Provider value={availableHeight}>{children}</AppModalAvailableHeight.Provider>
      </View>
    </View>
  );
}
