import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useMemo } from 'react';

enum COLOR_SCHEME_CHOICE {
  FOLLOW_SYSTEM = 'follow-system', // 跟随系统自动变化
  DARK = 'dark', // 固定为 dark 主题，不随系统变化
  LIGHT = 'light', // 固定为 light 主题，不随系统变化
};

const userPreferColorScheme: COLOR_SCHEME_CHOICE = COLOR_SCHEME_CHOICE.FOLLOW_SYSTEM;

function useTheme() {
  const systemColorScheme = useColorScheme()
  const colorScheme = userPreferColorScheme === COLOR_SCHEME_CHOICE.FOLLOW_SYSTEM ?
    systemColorScheme :
    userPreferColorScheme;
  
  const isDark = colorScheme === 'dark';
  
  const theme = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  
  return {
    theme,
    isDark,
  };
}

export {
  useTheme,
}
