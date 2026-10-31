import { useMemo, type ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BorderRadius, BorderWidth, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

const ITEMS = [
  { name: 'index', label: '工作台', icon: 'home' },
  { name: 'document-management', label: '单据', icon: 'file-text' },
  { name: 'label-reprint', label: '标签补打', icon: 'printer' },
  { name: 'settings', label: '设置', icon: 'settings' },
] as const;

export type WarehouseBottomNavigationProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>['tabBar']>
>[0];

/** One persistent bar for the four main tabs; operation pages live outside it. */
export function WarehouseBottomNavigation({ state, navigation, insets }: WarehouseBottomNavigationProps) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const isCompact = width <= 390 || height <= 760;
  const styles = useMemo(() => StyleSheet.create({
    bar: {
      minHeight: (isCompact ? 60 : 66) + insets.bottom,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: (isCompact ? 12 : 16) + insets.left,
      paddingRight: (isCompact ? 12 : 16) + insets.right,
      paddingTop: 5,
      paddingBottom: (isCompact ? 6 : 8) + insets.bottom,
      borderTopWidth: BorderWidth.normal,
      borderTopColor: theme.border,
      backgroundColor: theme.backgroundDefault,
    },
    item: {
      position: 'relative',
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    indicator: {
      position: 'absolute',
      top: -5,
      width: 26,
      height: 3,
      borderRadius: BorderRadius.full,
    },
    label: {
      ...Typography.navLabel,
      fontWeight: '600',
      includeFontPadding: false,
    },
  }), [insets.bottom, insets.left, insets.right, isCompact, theme]);

  return (
    <View style={styles.bar} accessibilityLabel="主页面导航">
      {ITEMS.map((item) => {
        const route = state.routes.find((candidate) => candidate.name === item.name);
        if (!route) return null;
        const selected = state.routes[state.index]?.key === route.key;
        const color = selected ? theme.primary : theme.textMuted;
        return (
          <TouchableOpacity key={route.key} style={styles.item} activeOpacity={0.78}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            accessibilityRole="tab" accessibilityLabel={item.label}
            accessibilityState={{ selected }}>
            <View style={[styles.indicator, { backgroundColor: selected ? theme.primary : 'transparent' }]} />
            <Feather name={item.icon} size={19} color={color} />
            <Text style={[styles.label, { color, fontWeight: selected ? '800' : '600' }]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
