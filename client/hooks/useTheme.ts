import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useMemo } from 'react';

function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = useMemo(() => Colors[colorScheme], [colorScheme]);

  return {
    theme,
    isDark,
    colorScheme,
  };
}

export { useTheme };
