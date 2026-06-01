import { AuthProvider } from '@/contexts/AuthContext';
import { type ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ColorSchemeProvider } from '@/hooks/useColorScheme';
import { WebOnlyPrettyScrollbar } from './PrettyScrollbar';
import { HeroUINativeProvider } from '@/heroui';

function Provider({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ColorSchemeProvider>
        <WebOnlyPrettyScrollbar>
          <AuthProvider>
            <HeroUINativeProvider>
              {children}
            </HeroUINativeProvider>
          </AuthProvider>
        </WebOnlyPrettyScrollbar>
      </ColorSchemeProvider>
    </GestureHandlerRootView>
  );
}

export {
  Provider,
};
