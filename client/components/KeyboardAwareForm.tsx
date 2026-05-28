import React from 'react';
import {
  FlatListProps,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import {
  KeyboardAwareFlatList,
  KeyboardAwareScrollView,
} from 'react-native-keyboard-aware-scroll-view';
import { APP_MODAL_MAX_WIDTH, getAppModalWidth } from '@/constants/modal';

type KeyboardAwareFormScrollViewProps = ScrollViewProps & {
  bottomOffset?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraHeight?: number;
  extraScrollHeight?: number;
};

type KeyboardAwareFormFlatListProps<ItemT> = FlatListProps<ItemT> & {
  bottomOffset?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraHeight?: number;
  extraScrollHeight?: number;
};

type KeyboardAwareModalContainerProps = {
  children: React.ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraScrollHeight?: number;
};

const FORM_EXTRA_HEIGHT = Platform.OS === 'android' ? 64 : 54;
const FORM_EXTRA_SCROLL_HEIGHT = Platform.OS === 'android' ? 10 : 8;
const MODAL_BOTTOM_OFFSET = Platform.OS === 'android' ? 14 : 12;

export function KeyboardAwareFormScrollView({
  bottomOffset = 24,
  contentContainerStyle,
  extraHeight = FORM_EXTRA_HEIGHT,
  extraScrollHeight = FORM_EXTRA_SCROLL_HEIGHT,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator = false,
  ...props
}: KeyboardAwareFormScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      {...props}
      enableOnAndroid
      enableAutomaticScroll
      extraHeight={extraHeight}
      extraScrollHeight={extraScrollHeight}
      keyboardDismissMode={keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: bottomOffset },
        contentContainerStyle,
      ]}
    />
  );
}

export function KeyboardAwareFormFlatList<ItemT>({
  bottomOffset = 24,
  contentContainerStyle,
  extraHeight = FORM_EXTRA_HEIGHT,
  extraScrollHeight = FORM_EXTRA_SCROLL_HEIGHT,
  keyboardDismissMode,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator = false,
  ...props
}: KeyboardAwareFormFlatListProps<ItemT>) {
  return (
    <KeyboardAwareFlatList
      {...props}
      enableOnAndroid
      enableAutomaticScroll
      extraHeight={extraHeight}
      extraScrollHeight={extraScrollHeight}
      keyboardDismissMode={keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      contentContainerStyle={[{ paddingBottom: bottomOffset }, contentContainerStyle]}
    />
  );
}

export function KeyboardAwareModalContainer({
  children,
  cardStyle,
  contentContainerStyle,
  extraScrollHeight = MODAL_BOTTOM_OFFSET,
}: KeyboardAwareModalContainerProps) {
  const { width } = useWindowDimensions();
  const modalWidth = getAppModalWidth(width);

  return (
    <KeyboardAvoidingView
      style={styles.modalAvoider}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.modalScroll}
        contentContainerStyle={[
          styles.modalScrollContent,
          { paddingBottom: extraScrollHeight },
          contentContainerStyle,
        ]}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.modalCardFrame, cardStyle, { width: modalWidth, maxWidth: APP_MODAL_MAX_WIDTH }]}>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modalAvoider: {
    flex: 1,
    width: '100%',
  },
  modalScroll: {
    width: '100%',
  },
  modalScrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  modalCardFrame: {
    alignSelf: 'center',
    maxWidth: APP_MODAL_MAX_WIDTH,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
