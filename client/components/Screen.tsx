import React from 'react';
import {
  Platform,
  StyleSheet,
  ScrollView,
  View,
  TouchableWithoutFeedback,
  Keyboard,
  ViewStyle,
  FlatList,
  SectionList,
  Modal,
} from 'react-native';
import { useSafeAreaInsets, Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAwareScrollView,
  KeyboardAwareFlatList,
  KeyboardAwareSectionList
} from 'react-native-keyboard-aware-scroll-view';

const SCREEN_KEYBOARD_EXTRA_HEIGHT = Platform.OS === 'android' ? 64 : 54;
const SCREEN_KEYBOARD_EXTRA_SCROLL_HEIGHT = Platform.OS === 'android' ? 8 : 6;

/** 页面通用容器，统一处理安全区、滚动区域和键盘遮挡。 */
interface ScreenProps {
  children: React.ReactNode;
  /** 页面背景色，默认 #fff */
  backgroundColor?: string;
  /**
   * 状态栏文字样式。
   * 深色背景使用 light，浅色背景使用 dark。
   */
  statusBarStyle?: 'auto' | 'inverted' | 'light' | 'dark';
  /**
   * 状态栏背景色，默认透明。
   */
  statusBarColor?: string;
  /**
   * 需要避让的安全区方向。
   * 沉浸式页头可去掉 top，自行处理底部留白时可去掉 bottom。
   */
  safeAreaEdges?: Edge[];
  /** 自定义容器样式 */
  style?: ViewStyle;
  /** 页面已经自行管理滚动时，禁用 Screen 自动包裹滚动容器 */
  disableAutoScroll?: boolean;
}

type KeyboardAwareProps = {
  element: ScreenElement;
  extraPadding: number;
  contentInsetBehaviorIOS: 'automatic' | 'never';
};

type ScreenElementProps = Record<string, unknown> & {
  children?: React.ReactNode;
  contentContainerStyle?: unknown;
  contentInsetAdjustmentBehavior?: 'automatic' | 'never';
  horizontal?: boolean;
  keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
  keyboardShouldPersistTaps?: boolean | 'always' | 'never' | 'handled';
};

type ScreenElement = React.ReactElement<ScreenElementProps>;

const KeyboardAwareScrollable = ({
  element,
  extraPadding,
  contentInsetBehaviorIOS,
}: KeyboardAwareProps) => {
  const childAttrs = element.props || {};
  const originStyle = childAttrs.contentContainerStyle as ViewStyle | ViewStyle[] | undefined;
  const merged = StyleSheet.flatten(originStyle) || {};
  const currentPB = typeof merged.paddingBottom === 'number' ? merged.paddingBottom : 0;

  // 在页面原有底部留白上加上安全区和键盘避让距离。
  const enhancedContentStyle = [{ ...merged, paddingBottom: currentPB + extraPadding }];

  const commonProps = {
    ...childAttrs,
    contentContainerStyle: enhancedContentStyle,
    keyboardShouldPersistTaps: childAttrs.keyboardShouldPersistTaps ?? 'handled',
    keyboardDismissMode: childAttrs.keyboardDismissMode ?? 'on-drag',
    enableOnAndroid: true,
    // 给输入框留出额外滚动距离，键盘弹出后仍能看到当前输入项。
    extraHeight: SCREEN_KEYBOARD_EXTRA_HEIGHT,
    extraScrollHeight: SCREEN_KEYBOARD_EXTRA_SCROLL_HEIGHT,
    // 关闭系统自动留白，统一使用页面计算的 padding。
    enableAutomaticScroll: true,
    ...(Platform.OS === 'ios'
      ? { contentInsetAdjustmentBehavior: childAttrs.contentInsetAdjustmentBehavior ?? contentInsetBehaviorIOS }
      : {}),
  };

  const t = element.type;

  // 保留原滚动组件类型，并补上键盘避让能力。
  // 直接使用可感知键盘的滚动容器，避免再套一层视图改变页面高度。
  if (t === ScrollView) {
    return <KeyboardAwareScrollView {...(commonProps as React.ComponentProps<typeof KeyboardAwareScrollView>)} />;
  }

  if (t === FlatList) {
    return <KeyboardAwareFlatList {...(commonProps as React.ComponentProps<typeof KeyboardAwareFlatList>)} />;
  }

  if (t === SectionList) {
    return <KeyboardAwareSectionList {...(commonProps as React.ComponentProps<typeof KeyboardAwareSectionList>)} />;
  }

  // 理论上不应运行到这里，如果是非标准组件则原样返回，仅修改样式
  return React.cloneElement(element, {
    contentContainerStyle: enhancedContentStyle,
    keyboardShouldPersistTaps: childAttrs.keyboardShouldPersistTaps ?? 'handled',
    keyboardDismissMode: childAttrs.keyboardDismissMode ?? 'on-drag',
  });
};

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
  const keyboardShown = false;

  // 页面里已有滚动列表时，不再套第二层滚动容器。
  const isNodeScrollable = (node: React.ReactNode): boolean => {
    const isScrollableElement = (el: unknown): boolean => {
      if (!React.isValidElement(el)) return false;
      const element = el as ScreenElement;
      const t = element.type;
      // 弹窗内的滚动区域不属于页面主体。
      if (t === Modal) return false;
      const props = element.props as Record<string, unknown> | undefined;
      // 仅识别“垂直”滚动容器；横向滚动不视为页面已处理垂直滚动
      // eslint-disable-next-line react/prop-types
      const isHorizontal = props?.horizontal === true;
      if ((t === ScrollView || t === FlatList || t === SectionList) && !isHorizontal) return true;
      const c: React.ReactNode | undefined = props && 'children' in props
        ? (props.children as React.ReactNode)
        : undefined;
      if (Array.isArray(c)) return c.some(isScrollableElement);
      return c ? isScrollableElement(c) : false;
    };
    if (Array.isArray(node)) return node.some(isScrollableElement);
    return isScrollableElement(node);
  };

  const childIsNativeScrollable = isNodeScrollable(children);

  // 说明：避免双重补白
  // 键盘高度由滚动容器处理，这里只计算页面安全区。

  // 解析安全区设置
  const hasTop = safeAreaEdges.includes('top');
  const hasBottom = safeAreaEdges.includes('bottom');
  const hasLeft = safeAreaEdges.includes('left');
  const hasRight = safeAreaEdges.includes('right');

  // iOS 也使用同一套手动留白，避免系统再次增加空白。
  const contentInsetBehaviorIOS = 'never';

  const wrapperStyle: ViewStyle = {
    flex: 1,
    backgroundColor,
    paddingTop: hasTop ? insets.top : 0,
    paddingLeft: hasLeft ? insets.left : 0,
    paddingRight: hasRight ? insets.right : 0,
    // 页面自己滚动时，由外层容器补底部安全区。
    paddingBottom: (childIsNativeScrollable && hasBottom)
      ? (keyboardShown ? 0 : insets.bottom)
      : 0,
  };

  // 普通页面内容过长时允许整页滚动。
  const useScrollContainer = !disableAutoScroll && !childIsNativeScrollable;

  // 页面本身能滚动时，只补齐安全区和键盘避让。
  // 需要整页滚动时使用带键盘避让的滚动容器。
  const Container = useScrollContainer ? KeyboardAwareScrollView : View;

  const containerProps = useScrollContainer ? {
    contentContainerStyle: {
      flexGrow: 1,
      // 滚动内容自行补底部安全区，避免被系统手势区域挡住。
      paddingBottom: hasBottom ? (keyboardShown ? 0 : insets.bottom) : 0,
    },
    keyboardShouldPersistTaps: 'handled' as const,
    showsVerticalScrollIndicator: false,
    keyboardDismissMode: 'on-drag' as const,
    enableOnAndroid: true,
    extraHeight: SCREEN_KEYBOARD_EXTRA_HEIGHT,
    extraScrollHeight: SCREEN_KEYBOARD_EXTRA_SCROLL_HEIGHT,
    // iOS 顶部白条修复：强制不自动添加顶部安全区
    ...(Platform.OS === 'ios'
      ? { contentInsetAdjustmentBehavior: contentInsetBehaviorIOS }
      : {}),
  } : {};

  // 只增强页面里的滚动区域，底部固定栏保持原位。
  const wrapScrollableWithKeyboardAvoid = (nodes: React.ReactNode): React.ReactNode => {
    const isVerticalScrollable = (el: ScreenElement): boolean => {
      const t = el.type;
      const elementProps = el.props || {};
      const isHorizontal = elementProps.horizontal === true;
      return (t === ScrollView || t === FlatList || t === SectionList) && !isHorizontal;
    };

    const wrapIfNeeded = (el: ScreenElement, idx?: number): React.ReactElement => {
      if (isVerticalScrollable(el)) {
        return (
          <KeyboardAwareScrollable
            key={el.key ?? idx}
            element={el}
            extraPadding={keyboardShown ? 0 : (hasBottom ? insets.bottom : 0)}
            contentInsetBehaviorIOS={contentInsetBehaviorIOS}
          />
        );
      }
      return el;
    };

    if (Array.isArray(nodes)) {
      return nodes.map((n, idx) => {
        if (React.isValidElement(n)) {
          return wrapIfNeeded(n as ScreenElement, idx);
        }
        return n;
      });
    }
    if (React.isValidElement(nodes)) {
      return wrapIfNeeded(nodes as ScreenElement, 0);
    }
    return nodes;
  };

  const managedChildren =
    childIsNativeScrollable && !disableAutoScroll
      ? wrapScrollableWithKeyboardAvoid(children)
      : children;

  return (
    // 用 padding 统一处理安全区，避免和页面自己的内边距重复。
    <View style={wrapperStyle}>
      <StatusBar
        style={statusBarStyle}
      />
      {/* 默认透出页面背景；仅显式指定颜色时绘制状态栏底色。 */}
      {hasTop && insets.top > 0 && statusBarColor !== 'transparent' && (
        <View testID="screen-status-bar-background" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: statusBarColor }} />
      )}

      {/* 键盘避让：仅当外层使用 ScrollView 时启用，避免固定底部栏随键盘上移 */}
      {useScrollContainer ? (
         // 表单页由滚动容器处理键盘遮挡。
         // 键盘避让由滚动容器内部处理。
        <Container style={[styles.innerContainer, style]} {...containerProps}>
          {children}
        </Container>
      ) : (
        // 页面自身已处理滚动，不启用全局键盘避让，保证固定底部栏不随键盘上移
        childIsNativeScrollable || disableAutoScroll ? (
          <View style={[styles.innerContainer, style]}>
            {managedChildren}
          </View>
        ) : (
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
            <View style={[styles.innerContainer, style]}>
              {children}
            </View>
          </TouchableWithoutFeedback>
        )
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  innerContainer: {
    flex: 1,
    // 确保内部容器透明，避免背景色遮挡
    backgroundColor: 'transparent',
  },
});
