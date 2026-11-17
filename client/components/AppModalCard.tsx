import React, { useContext, useState } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import { MotionSurface } from '@/components/AppMotion';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH, getAppModalAvailableHeight, getAppModalMaxHeight, getAppModalWidth } from '@/constants/modal';
import { AppModalAvailableHeight } from '@/components/AppModalViewport';
import { withAlpha } from '@/utils/colors';
import { AppModalHeader } from './AppModalHeader';

type AppModalCardSize = 'auto' | 'compact' | 'form' | 'largeForm' | 'list';

interface AppModalCardProps {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
  size?: AppModalCardSize;
  stretchBody?: boolean;
  /** With a bounded-height card, let inner content own scrolling without a same-axis ScrollView ancestor. */
  scrollMode?: 'card' | 'body';
  /** Optional measured scroll-content height for a compact list with default body padding. */
  bodyContentHeight?: number;
}

export function AppModalCard({
  title,
  subtitle,
  onClose,
  children,
  footer,
  style,
  bodyStyle,
  size = 'auto',
  stretchBody,
  scrollMode = 'card',
  bodyContentHeight,
}: AppModalCardProps) {
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const measuredHeight = useContext(AppModalAvailableHeight);
  const effectiveHeight = getAppModalAvailableHeight(windowHeight, measuredHeight);
  const maxHeight = getAppModalMaxHeight(effectiveHeight, StyleSheet.flatten(style)?.maxHeight);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);

  const modalWidth = getAppModalWidth(windowWidth);
  const bodyOwnsScroll = scrollMode === 'body';
  const listHeightLimit = Math.min(windowHeight * 0.82, 680, maxHeight);
  const measuredListHeight = typeof bodyContentHeight === 'number' && Number.isFinite(bodyContentHeight)
    ? Math.max(0, bodyContentHeight) + headerHeight + (footer ? footerHeight : 0) + Spacing.md
    : listHeightLimit;

  const computedSizeStyle: ViewStyle = (() => {
    switch (size) {
      case 'compact':
        return {
          width: modalWidth,
          height: Math.min(Math.max(windowHeight * 0.34, 252), 320, maxHeight),
        };
      case 'form':
        return {
          width: modalWidth,
          height: Math.min(Math.max(windowHeight * 0.5, 340), 460, maxHeight),
        };
      case 'largeForm':
        return {
          width: modalWidth,
          height: Math.min(Math.max(windowHeight * 0.66, 420), 620, maxHeight),
        };
      case 'list':
        return {
          width: modalWidth,
          maxHeight: listHeightLimit,
          // A list-owned body needs a definite viewport, not only an outer maximum.
          ...(bodyOwnsScroll ? { height: Math.min(listHeightLimit, measuredListHeight) } : null),
        };
      case 'auto':
      default:
        return {
          width: modalWidth,
        };
    }
  })();

  const shouldStretchBody = stretchBody ?? size !== 'auto';
  const ContentContainer = bodyOwnsScroll ? View : ScrollView;
  const cardHeightLimit = getAppModalMaxHeight(
    typeof computedSizeStyle.maxHeight === 'number' ? computedSizeStyle.maxHeight : maxHeight,
    computedSizeStyle.height ?? StyleSheet.flatten(style)?.height,
  );
  // Keep the tree stable when the physical window changes size. If fixed
  // chrome would crowd out the form, scroll the whole card so actions stay reachable.
  const cramped = headerHeight + (footer ? footerHeight : 0) + 96 > cardHeightLimit;
  const scrollWholeCard = cramped || scrollContentHeight > cardHeightLimit + 1;

  return (
    <MotionSurface
      style={[
        {
          width: modalWidth,
          maxWidth: APP_MODAL_MAX_WIDTH,
          backgroundColor: theme.backgroundElevated,
          borderRadius: BorderRadius.md,
          borderWidth: BorderWidth.normal,
          borderColor: theme.border,
          overflow: 'hidden',
          shadowColor: theme.shadowColor,
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: theme.isDark ? 0.28 : 0.12,
          shadowRadius: 22,
          elevation: 12,
        },
        style,
        computedSizeStyle,
        { width: modalWidth, maxWidth: APP_MODAL_MAX_WIDTH, maxHeight: computedSizeStyle.maxHeight ?? maxHeight },
      ]}
    >
      <ContentContainer
        testID={bodyOwnsScroll ? 'app-modal-card-body-frame' : 'app-modal-card-scroll'}
        style={bodyOwnsScroll ? { flex: 1, minHeight: 0 } : { flexShrink: 1 }}
        {...(bodyOwnsScroll ? {} : {
          contentContainerStyle: { flexGrow: 1 },
          onContentSizeChange: (_width: number, height: number) => setScrollContentHeight(height),
          scrollEnabled: scrollWholeCard,
          nestedScrollEnabled: scrollWholeCard,
          keyboardShouldPersistTaps: 'handled' as const,
          showsVerticalScrollIndicator: scrollWholeCard,
        })}
      >
        <View
          testID="app-modal-card-header"
          onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
          style={{
            flexShrink: 0,
            paddingHorizontal: Spacing.md,
            paddingTop: Spacing.md,
            paddingBottom: Spacing.sm,
          }}
        >
          <AppModalHeader title={title} subtitle={subtitle} onClose={onClose} />
        </View>

        <View
          testID="app-modal-card-body"
          style={[
            {
              minHeight: 0,
              flexShrink: 1,
              paddingHorizontal: Spacing.md,
              paddingBottom: Spacing.md,
            },
            shouldStretchBody
              ? {
                  flex: 1,
                }
              : null,
            bodyStyle,
            !bodyOwnsScroll && cramped ? {
              flex: undefined,
              flexGrow: 0,
              flexShrink: 0,
              ...(shouldStretchBody ? { height: 200 } : null),
            } : null,
          ]}
        >
          {children}
        </View>

        {footer ? (
          <View
            testID="app-modal-card-footer"
            onLayout={({ nativeEvent }) => setFooterHeight(nativeEvent.layout.height)}
            style={{
              flexShrink: 0,
              paddingHorizontal: Spacing.md,
              paddingTop: Spacing.sm,
              paddingBottom: Spacing.md,
              borderTopWidth: BorderWidth.normal,
              borderTopColor: theme.border,
              backgroundColor: withAlpha(theme.backgroundTertiary, theme.isDark ? 0.18 : 0.34),
            }}
          >
            {footer}
          </View>
        ) : null}
      </ContentContainer>
    </MotionSurface>
  );
}
