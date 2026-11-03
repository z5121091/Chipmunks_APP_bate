import { Tabs } from 'expo-router';
import { Platform, View, type ViewStyle } from 'react-native';
import { WarehouseBottomNavigation } from '@/components/WarehouseBottomNavigation';
import { BorderWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { MainTabScene } from '@/components/MainTabScene';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function MainTabLayout() {
  const { theme } = useTheme();
  let tabBarStyle: ViewStyle = {
    backgroundColor: theme.backgroundDefault,
    borderTopWidth: BorderWidth.normal,
    borderTopColor: theme.border,
  };
  if (Platform.OS === 'web') {
    tabBarStyle = { ...tabBarStyle, height: 'auto' };
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        tabBar={(props) => <WarehouseBottomNavigation {...props} />}
        detachInactiveScreens
        screenLayout={({ route, children }) => <MainTabScene routeKey={route.key}>{children}</MainTabScene>}
        screenOptions={{
          headerShown: false,
          // Detach the old native screen immediately. MainTabScene supplies the
          // short reveal without making an entire screen hierarchy translucent.
          animation: 'none',
          lazy: true,
          freezeOnBlur: false,
          sceneStyle: { backgroundColor: theme.backgroundRoot },
          tabBarStyle,
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textMuted,
        }}
      >
        <Tabs.Screen name="index" options={{ title: '工作台' }} />
        <Tabs.Screen name="document-management" options={{ title: '单据' }} />
        <Tabs.Screen name="label-reprint" options={{ title: '标签补打' }} />
        <Tabs.Screen name="settings" options={{ title: '设置' }} />
      </Tabs>
    </View>
  );
}
