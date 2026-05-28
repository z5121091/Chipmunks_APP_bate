import React from 'react';
import { Dimensions, StyleProp, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { BorderRadius, BorderWidth, Spacing } from '@/constants/theme';
import { APP_MODAL_MAX_WIDTH, getAppModalWidth } from '@/constants/modal';
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
}: AppModalCardProps) {
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const screenHeight = Dimensions.get('screen').height;
  const effectiveHeight = Math.max(windowHeight, screenHeight);

  const modalWidth = getAppModalWidth(windowWidth);

  const computedSizeStyle: ViewStyle = (() => {
    switch (size) {
      case 'compact':
        return {
          width: modalWidth,
          height: Math.min(Math.max(effectiveHeight * 0.34, 252), 320),
        };
      case 'form':
        return {
          width: modalWidth,
          height: Math.min(Math.max(effectiveHeight * 0.5, 340), 460),
        };
      case 'largeForm':
        return {
          width: modalWidth,
          height: Math.min(Math.max(effectiveHeight * 0.66, 420), 620),
        };
      case 'list':
        return {
          width: modalWidth,
          maxHeight: Math.min(effectiveHeight * 0.82, 680),
        };
      case 'auto':
      default:
        return {
          width: modalWidth,
        };
    }
  })();

  const shouldStretchBody = stretchBody ?? size !== 'auto';

  return (
    <View
      style={[
        {
          width: modalWidth,
          maxWidth: APP_MODAL_MAX_WIDTH,
          backgroundColor: theme.backgroundElevated,
          borderRadius: BorderRadius['3xl'],
          borderWidth: BorderWidth.normal,
          borderColor: theme.border,
          overflow: 'hidden',
          shadowColor: theme.shadowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: theme.isDark ? 0.24 : 0.14,
          shadowRadius: 18,
          elevation: 10,
        },
        style,
        computedSizeStyle,
        { width: modalWidth, maxWidth: APP_MODAL_MAX_WIDTH },
      ]}
    >
      <View
        style={{
          paddingHorizontal: Spacing.lg,
          paddingTop: Spacing.lg,
          paddingBottom: Spacing.sm,
        }}
      >
        <AppModalHeader title={title} subtitle={subtitle} onClose={onClose} />
      </View>

      <View
        style={[
          {
            paddingHorizontal: Spacing.lg,
            paddingBottom: Spacing.lg,
          },
          shouldStretchBody
            ? {
                flex: 1,
              }
            : null,
          bodyStyle,
        ]}
      >
        {children}
      </View>

      {footer ? (
        <View
          style={{
            paddingHorizontal: Spacing.md,
            paddingTop: Spacing.sm,
            paddingBottom: Spacing.lg,
            borderTopWidth: BorderWidth.normal,
            borderTopColor: theme.border,
            backgroundColor: withAlpha(theme.backgroundTertiary, theme.isDark ? 0.26 : 0.42),
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
