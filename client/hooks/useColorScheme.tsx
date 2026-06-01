import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import {
  ColorSchemeName,
  Platform,
  useColorScheme as useReactNativeColorScheme,
} from 'react-native';
import { Uniwind } from 'uniwind';
import { DEFAULT_THEME, type AppThemePreference } from '@/components/ColorSchemeUpdater';

type AppColorScheme = 'light' | 'dark';

const ColorSchemeContext = createContext<AppColorScheme>('light');

const normalizeColorScheme = (value: ColorSchemeName): AppColorScheme | null => {
  return value === 'light' || value === 'dark' ? value : null;
};

const resolveColorScheme = (
  themePreference: AppThemePreference,
  systemColorScheme: ColorSchemeName,
  workbenchColorScheme: ColorSchemeName
): AppColorScheme => {
  const normalizedWorkbenchColorScheme = normalizeColorScheme(workbenchColorScheme);
  if (normalizedWorkbenchColorScheme) {
    return normalizedWorkbenchColorScheme;
  }

  if (themePreference === 'light' || themePreference === 'dark') {
    return themePreference;
  }

  return normalizeColorScheme(systemColorScheme) || 'light';
};

const ColorSchemeProvider = function ({ children }: { children?: ReactNode }) {
  const systemColorScheme = useReactNativeColorScheme();
  const [workbenchColorScheme, setWorkbenchColorScheme] = useState<ColorSchemeName>(null);

  const colorScheme = useMemo(
    () => resolveColorScheme(DEFAULT_THEME, systemColorScheme, workbenchColorScheme),
    [systemColorScheme, workbenchColorScheme]
  );

  useEffect(() => {
    Uniwind.setTheme(workbenchColorScheme || DEFAULT_THEME);
  }, [workbenchColorScheme]);

  useEffect(() => {
    function handleMessage(
      e: MessageEvent<{ event: string; colorScheme: ColorSchemeName } | undefined>
    ) {
      if (e.data?.event === 'coze.workbench.colorScheme') {
        setWorkbenchColorScheme(normalizeColorScheme(e.data.colorScheme));
      }
    }

    if (Platform.OS === 'web') {
      window.addEventListener('message', handleMessage, false);
    }

    return () => {
      if (Platform.OS === 'web') {
        window.removeEventListener('message', handleMessage, false);
      }
    };
  }, []);

  return <ColorSchemeContext.Provider value={colorScheme}>{children}</ColorSchemeContext.Provider>;
};

function useColorScheme() {
  return useContext(ColorSchemeContext);
}

export { ColorSchemeProvider, useColorScheme };
