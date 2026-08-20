import '../global.css';
import { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from 'react-native';
import {
  checkpointDatabaseToDisk,
  ensureDatabaseConnectionReady,
  initDatabase,
} from '@/utils/database';
import { Provider } from '@/components/Provider';
import { BorderRadius, Spacing, Typography } from '@/constants/theme';
import { logger } from '@/utils/logger';
import {
  initSoundSetting,
  pauseFeedbackForAppInactive,
  resumeFeedbackAfterAppActive,
} from '@/utils/feedback';
import { useTheme } from '@/hooks/useTheme';
import { MIN_TOUCH_TARGET } from '@/utils/responsive';
import {
  AUTO_NAS_BACKUP_CHECK_INTERVAL_MS,
  maybeRunAutoNasBackup,
} from '@/utils/autoNasBackup';

void SplashScreen.preventAutoHideAsync().catch((error) => {
  logger.warn('[App] prevent splash auto hide failed:', error);
});

const STACK_ROUTES = [
  'index',
  'inbound',
  'purchase-receive',
  'outbound',
  'inventory',
  'stock-query',
  'document-management',
  'inbound-records',
  'inventory-records',
  'orders',
  'warehouse-management',
  'rules',
  'custom-fields',
  'rule-prefixes',
  'rule-prefix-edit',
  'outbound-order-rules',
  'inventory-binding',
  'detail',
  'settings',
  'help',
  'changelog',
  'privacy-policy',
] as const;

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error || '未知错误');
};

type DatabaseGateScreenProps = {
  databaseInitializing: boolean;
  databaseInitError: unknown;
  onRetryInitializeDatabase: () => void;
};

function DatabaseGateScreen({
  databaseInitializing,
  databaseInitError,
  onRetryInitializeDatabase,
}: DatabaseGateScreenProps) {
  const { theme } = useTheme();

  return (
    <View style={[databaseGateStyles.container, { backgroundColor: theme.backgroundRoot }]}>
      {databaseInitializing ? (
        <View style={databaseGateStyles.centerContent}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[databaseGateStyles.initializingText, { color: theme.textPrimary }]}>
            正在初始化数据库
          </Text>
        </View>
      ) : (
        <View style={databaseGateStyles.errorContent}>
          <Text style={[databaseGateStyles.errorTitle, { color: theme.textPrimary }]}>
            数据库初始化失败
          </Text>
          <Text style={[databaseGateStyles.errorMessage, { color: theme.textSecondary }]}>
            {getErrorMessage(databaseInitError)}
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onRetryInitializeDatabase}
            style={[databaseGateStyles.retryButton, { backgroundColor: theme.primary }]}
          >
            <Text style={[databaseGateStyles.retryText, { color: theme.buttonPrimaryText }]}>
              重试初始化
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const databaseGateStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  centerContent: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  errorContent: {
    gap: Spacing.sm,
  },
  initializingText: {
    ...Typography.bodyMedium,
    fontWeight: '700',
  },
  errorTitle: {
    ...Typography.h4,
    fontWeight: '800',
  },
  errorMessage: {
    ...Typography.small,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: {
    ...Typography.smallMedium,
    fontWeight: '700',
  },
});

export default function RootLayout() {
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseInitError, setDatabaseInitError] = useState<unknown>(null);
  const [databaseInitializing, setDatabaseInitializing] = useState(true);

  const initializeDatabase = useCallback(async () => {
    try {
      logger.log('[App] initializing database...');
      await Promise.all([initDatabase(), initSoundSetting()]);
      logger.log('[App] database initialized');
      setDatabaseReady(true);
    } catch (error) {
      setDatabaseReady(false);
      setDatabaseInitError(error);
      logger.error('[App] database initialization failed:', error);
    } finally {
      setDatabaseInitializing(false);
      try {
        await SplashScreen.hideAsync();
        logger.log('[App] splash hidden');
      } catch (splashError) {
        logger.warn('[App] hide splash failed:', splashError);
      }
    }
  }, []);

  const retryInitializeDatabase = useCallback(() => {
    setDatabaseInitializing(true);
    setDatabaseInitError(null);
    void initializeDatabase();
  }, [initializeDatabase]);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      void initializeDatabase();
    }, 0);

    return () => {
      clearTimeout(initTimer);
    };
  }, [initializeDatabase]);

  useEffect(() => {
    if (!databaseReady) {
      return undefined;
    }

    let currentAppState = AppState.currentState;
    let checkpointInFlight = false;
    let resumeCheckInFlight = false;
    let lastCheckpointAt = 0;
    let lastResumeCheckAt = 0;
    const runAutoNasBackupCheck = (trigger: string) => {
      void maybeRunAutoNasBackup(trigger)
        .then((result) => {
          if (result.status === 'failed') {
            logger.warn(`[App] ${trigger} auto NAS backup failed:`, result.message);
            return;
          }

          if (result.status === 'skipped' && result.reason !== 'not-due') {
            logger.log(`[App] ${trigger} auto NAS backup skipped:`, result.reason);
          }
        })
        .catch((error) => {
          logger.warn(`[App] ${trigger} auto NAS backup check crashed:`, error);
        });
    };

    runAutoNasBackupCheck('app-ready');

    const runLifecycleCheckpoint = async (nextAppState: AppStateStatus) => {
      const now = Date.now();
      if (checkpointInFlight || now - lastCheckpointAt < 2000) {
        return;
      }

      checkpointInFlight = true;
      try {
        logger.log(`[App] lifecycle checkpoint before ${nextAppState}`);
        await checkpointDatabaseToDisk();
        lastCheckpointAt = Date.now();
        logger.log('[App] lifecycle checkpoint completed');
      } catch (error) {
        logger.warn('[App] lifecycle checkpoint failed:', error);
      } finally {
        checkpointInFlight = false;
      }
    };

    const runLifecycleResumeCheck = async () => {
      const now = Date.now();
      if (resumeCheckInFlight || now - lastResumeCheckAt < 1000) {
        return;
      }

      resumeCheckInFlight = true;
      try {
        logger.log('[App] lifecycle resume check started');
        await ensureDatabaseConnectionReady('[App] resume database check');
        await resumeFeedbackAfterAppActive();
        lastResumeCheckAt = Date.now();
        runAutoNasBackupCheck('app-active');
        logger.log('[App] lifecycle resume check completed');
      } catch (error) {
        logger.warn('[App] lifecycle resume check failed:', error);
      } finally {
        resumeCheckInFlight = false;
      }
    };

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousAppState = currentAppState;
      const appStateChanged = previousAppState !== nextAppState;
      const shouldCheckpoint = appStateChanged && nextAppState !== 'active';
      const shouldResumeCheck = appStateChanged && nextAppState === 'active';
      currentAppState = nextAppState;

      if (shouldCheckpoint) {
        void pauseFeedbackForAppInactive();
        runAutoNasBackupCheck(`app-${nextAppState}`);
        void runLifecycleCheckpoint(nextAppState);
      }
      if (shouldResumeCheck) {
        void runLifecycleResumeCheck();
      }
    });

    const autoBackupTimer = setInterval(() => {
      if (currentAppState === 'active') {
        runAutoNasBackupCheck('app-active-interval');
      }
    }, AUTO_NAS_BACKUP_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(autoBackupTimer);
      subscription.remove();
    };
  }, [databaseReady]);

  if (!databaseReady) {
    return (
      <Provider>
        <DatabaseGateScreen
          databaseInitializing={databaseInitializing}
          databaseInitError={databaseInitError}
          onRetryInitializeDatabase={retryInitializeDatabase}
        />
      </Provider>
    );
  }

  return (
    <Provider>
      <Stack screenOptions={{ headerShown: false }}>
        {STACK_ROUTES.map((routeName) => (
          <Stack.Screen key={routeName} name={routeName} />
        ))}
      </Stack>
    </Provider>
  );
}
