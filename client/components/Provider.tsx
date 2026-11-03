import { type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ColorSchemeProvider } from '@/hooks/useColorScheme';
import { WebOnlyPrettyScrollbar } from './PrettyScrollbar';
import { HeroUINativeProvider } from '@/heroui';
import { AppMotionProvider } from '@/hooks/useAppMotion';

function Provider({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppMotionProvider><ColorSchemeProvider>
        <WebOnlyPrettyScrollbar>
          <HeroUINativeProvider>
            {children}
          </HeroUINativeProvider>
        </WebOnlyPrettyScrollbar>
      </ColorSchemeProvider></AppMotionProvider>
    </GestureHandlerRootView>
  );
}

export {
  Provider,
};
