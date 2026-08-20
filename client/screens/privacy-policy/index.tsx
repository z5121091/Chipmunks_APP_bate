import { createElement, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Screen } from '@/components/Screen';
import { UiPageHeader } from '@/components/UiRedesign';
import { BorderRadius, Spacing, Typography, type Theme } from '@/constants/theme';
import { PRIVACY_POLICY_URL } from '@/constants/version';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { shouldLoadPrivacyPolicyInsideApp } from '@/utils/privacyPolicyNavigation';
import { logger } from '@/utils/logger';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';

export default function PrivacyPolicyScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(() => Date.now());
  const policyUrl = `${PRIVACY_POLICY_URL}?app=${reloadKey}`;

  const retry = () => {
    setLoadFailed(false);
    setReloadKey(Date.now());
  };

  const errorContent = (
    <View style={styles.messageContainer}>
      <Feather name="wifi-off" size={28} color={theme.textMuted} />
      <Text style={styles.messageTitle}>隐私政策加载失败</Text>
      <Text style={styles.messageText}>请检查网络后重试</Text>
      <TouchableOpacity
        style={styles.retryButton}
        activeOpacity={0.75}
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="重新加载隐私政策"
      >
        <Feather name="refresh-cw" size={16} color={theme.buttonPrimaryText} />
        <Text style={styles.retryText}>重新加载</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      disableAutoScroll
      style={{ paddingBottom: insets.bottom }}
    >
      <UiPageHeader
        title="隐私政策"
        backIcon="x"
        backLabel="关闭"
        onBack={() => router.back()}
      />

      {Platform.OS === 'web' ? (
        createElement('iframe', {
          key: reloadKey,
          src: policyUrl,
          title: '隐私政策',
          referrerPolicy: 'no-referrer',
          style: styles.webFrame,
        })
      ) : loadFailed ? (
        errorContent
      ) : (
        <WebView
          key={reloadKey}
          source={{ uri: policyUrl }}
          style={styles.webView}
          cacheEnabled={false}
          cacheMode="LOAD_NO_CACHE"
          javaScriptEnabled={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          )}
          onError={() => setLoadFailed(true)}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 400) setLoadFailed(true);
          }}
          onShouldStartLoadWithRequest={({ url }) => {
            if (shouldLoadPrivacyPolicyInsideApp(url, PRIVACY_POLICY_URL)) return true;
            if (/^https?:\/\//i.test(url)) {
              void Linking.openURL(url).catch((error) => {
                logger.warn('[PrivacyPolicy] 无法打开外部链接:', error);
              });
            }
            return false;
          }}
        />
      )}
    </Screen>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    webView: {
      flex: 1,
      backgroundColor: theme.backgroundDefault,
    },
    webFrame: {
      width: '100%',
      height: '100%',
      borderWidth: 0,
      backgroundColor: theme.backgroundDefault,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.backgroundDefault,
    },
    messageContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
    },
    messageTitle: {
      ...Typography.title,
      color: theme.textPrimary,
      textAlign: 'center',
    },
    messageText: {
      ...Typography.small,
      color: theme.textSecondary,
      textAlign: 'center',
    },
    retryButton: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
      paddingHorizontal: Spacing.lg,
      borderRadius: BorderRadius.sm,
      backgroundColor: theme.primary,
    },
    retryText: {
      ...Typography.smallMedium,
      color: theme.buttonPrimaryText,
    },
  });
