import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { AppPressable } from '@/components/AppPressable';
import { useTheme } from '@/hooks/useTheme';

export default function NotFoundScreen() {
  const { theme, isDark } = useTheme();
  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}><View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-lg font-semibold text-foreground">页面不存在</Text>
      <Link href="/" asChild>
        <AppPressable accessibilityLabel="返回首页" style={{ minHeight: 48, justifyContent: 'center', marginTop: 32 }}>
          <Text className="text-base font-medium text-accent">返回首页</Text>
        </AppPressable>
      </Link>
    </View></Screen>
  );
}
