import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { initDatabase } from '@/utils/database';
import { Provider } from '@/components/Provider';
import { logger } from '@/utils/logger';

export default function RootLayout() {
  useEffect(() => {
    const init = async () => {
      try {
        logger.log('[App] initializing database...');
        await initDatabase();
        logger.log('[App] database initialized');
      } catch (error) {
        logger.error('[App] database initialization failed:', error);
      }
    };

    void init();
  }, []);

  return (
    <Provider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="inbound" />
        <Stack.Screen name="outbound" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="document-management" />
        <Stack.Screen name="inbound-records" />
        <Stack.Screen name="inventory-records" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="warehouse-management" />
        <Stack.Screen name="rules" />
        <Stack.Screen name="custom-fields" />
        <Stack.Screen name="rule-prefixes" />
        <Stack.Screen name="rule-prefix-edit" />
        <Stack.Screen name="outbound-order-rules" />
        <Stack.Screen name="inventory-binding" />
        <Stack.Screen name="detail" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="help" />
        <Stack.Screen name="changelog" />
      </Stack>
    </Provider>
  );
}
