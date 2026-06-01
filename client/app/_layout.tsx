import '../global.css';
import { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  ActivityIndicator,
  AppState,
  Text,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from 'react-native';
import { checkpointDatabaseToDisk, initDatabase } from '@/utils/database';
import { Provider } from '@/components/Provider';
import { logger } from '@/utils/logger';

void SplashScreen.preventAutoHideAsync().catch((error) => {
  logger.warn('[App] prevent splash auto hide failed:', error);
});

const STACK_ROUTES = [
  'index',
  'inbound',
  'outbound',
  'inventory',
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
] as const;

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error || '未知错误');
};

export default function RootLayout() {
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseInitError, setDatabaseInitError] = useState<unknown>(null);
  const [databaseInitializing, setDatabaseInitializing] = useState(true);

  const initializeDatabase = useCallback(async () => {
    try {
      logger.log('[App] initializing database...');
      await initDatabase();
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
    let lastCheckpointAt = 0;

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

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const shouldCheckpoint = currentAppState !== nextAppState && nextAppState !== 'active';
      currentAppState = nextAppState;

      if (shouldCheckpoint) {
        void runLifecycleCheckpoint(nextAppState);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [databaseReady]);

  if (!databaseReady) {
    return (
      <Provider>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: 24,
            backgroundColor: '#F6F8FB',
          }}
        >
          {databaseInitializing ? (
            <View style={{ alignItems: 'center', gap: 14 }}>
              <ActivityIndicator size="large" color="#2F6FDD" />
              <Text style={{ color: '#10233B', fontSize: 16, fontWeight: '700' }}>
                正在初始化数据库
              </Text>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <Text style={{ color: '#10233B', fontSize: 20, fontWeight: '800' }}>
                数据库初始化失败
              </Text>
              <Text style={{ color: '#526579', fontSize: 14, lineHeight: 22 }}>
                {getErrorMessage(databaseInitError)}
              </Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={retryInitializeDatabase}
                style={{
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  borderRadius: 10,
                  backgroundColor: '#2F6FDD',
                  paddingHorizontal: 18,
                  paddingVertical: 11,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                  重试初始化
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
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
