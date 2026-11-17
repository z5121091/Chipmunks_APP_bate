import React from 'react';
import { Platform, StyleSheet, ScrollView, View, type ViewStyle, FlatList, SectionList, Modal } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppModal } from '@/components/AppModal';

/** 页面通用容器，只管理安全区和手动滚动，不跟随键盘抬升或缩窗。 */
interface ScreenProps {
  children: React.ReactNode;
  backgroundColor?: string;
  /** 深色背景使用 light，浅色背景使用 dark。 */
  statusBarStyle?: 'auto' | 'inverted' | 'light' | 'dark';
  statusBarColor?: string;
  /** 沉浸式页头可去掉 top，自行处理底部留白时可去掉 bottom。 */
  safeAreaEdges?: Edge[];
  style?: ViewStyle;
  /** 页面已经自行管理滚动时，不再包裹整页 ScrollView。与键盘无关。 */
  disableAutoScroll?: boolean;
}

type ScreenElementProps = {
  children?: React.ReactNode;
  horizontal?: boolean;
  keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
  keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
};
type ScreenElement = React.ReactElement<ScreenElementProps>;

function isVerticalScrollable(element: ScreenElement) {
  return (element.type === ScrollView || element.type === FlatList || element.type === SectionList) && element.props.horizontal !== true;
}

function containsScrollable(nodes: React.ReactNode): boolean {
  return React.Children.toArray(nodes).some(node => {
    if (!React.isValidElement(node)) return false;
    const element = node as ScreenElement;
    // 弹窗拥有独立视口，不能代替页面主体的滚动容器。
    if (element.type === Modal || element.type === AppModal) return false;
    return isVerticalScrollable(element) || containsScrollable(element.props.children);
  });
}

export const Screen = ({
  children,
  backgroundColor = '#fff',
  statusBarStyle = 'dark',
  statusBarColor = 'transparent',
  safeAreaEdges = ['top', 'left', 'right', 'bottom'],
  style,
  disableAutoScroll = false,
}: ScreenProps) => {
  const insets = useSafeAreaInsets();
  const hasTop = safeAreaEdges.includes('top');
  const hasBottom = safeAreaEdges.includes('bottom');
  const hasOwnScroll = containsScrollable(children);
  const useScrollContainer = !disableAutoScroll && !hasOwnScroll;
  const bottomInset = hasBottom ? insets.bottom : 0;

  // 保留原生组件及其 ref，只补普通点击/拖动行为，不替换成键盘感知组件。
  const managedChildren = hasOwnScroll && !disableAutoScroll ? React.Children.map(children, node => {
    if (!React.isValidElement(node)) return node;
    const element = node as ScreenElement;
    return isVerticalScrollable(element) ? React.cloneElement(element, {
      keyboardShouldPersistTaps: element.props.keyboardShouldPersistTaps ?? 'handled',
      keyboardDismissMode: element.props.keyboardDismissMode ?? 'on-drag',
    }) : node;
  }) : children;

  return (
    <View style={{
      flex: 1,
      backgroundColor,
      paddingTop: hasTop ? insets.top : 0,
      paddingLeft: safeAreaEdges.includes('left') ? insets.left : 0,
      paddingRight: safeAreaEdges.includes('right') ? insets.right : 0,
      paddingBottom: hasOwnScroll ? bottomInset : 0,
    }}>
      <StatusBar style={statusBarStyle} />
      {hasTop && insets.top > 0 && statusBarColor !== 'transparent' && (
        <View testID="screen-status-bar-background" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: statusBarColor }} />
      )}
      {useScrollContainer ? (
        <ScrollView
          style={[styles.innerContainer, style]}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={false}
          {...(Platform.OS === 'ios' ? { contentInsetAdjustmentBehavior: 'never' as const } : {})}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.innerContainer, style]}>{managedChildren}</View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  innerContainer: { flex: 1, backgroundColor: 'transparent' },
});
