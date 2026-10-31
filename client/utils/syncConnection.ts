import AsyncStorage from '@react-native-async-storage/async-storage';
import { NETWORK_CONFIG, STORAGE_KEYS, type ConnectionStatus, type SyncConfig } from '@/constants/config';
import { getSyncConfigError, normalizeSyncConfig, testConnection } from '@/utils/heartbeat';
import { logger } from '@/utils/logger';

export interface SyncConnectionSnapshot {
  readonly config: SyncConfig | null;
  readonly status: ConnectionStatus;
}

interface SyncConnectionDependencies {
  storage: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
  };
  checkHealth: (config: SyncConfig, options: { force: boolean }) => Promise<boolean>;
  onError?: (error: unknown) => void;
}

const sameTarget = (left: SyncConfig | null, right: SyncConfig | null): boolean =>
  left === right || Boolean(left && right && left.ip === right.ip && left.port === right.port &&
    (left.pairingKey || '') === (right.pairingKey || ''));

const readSavedConfig = (serialized: string | null): SyncConfig | null => {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return null;
    const config = value as Partial<SyncConfig>;
    if (typeof config.ip !== 'string' || typeof config.port !== 'string') return null;
    const normalized = normalizeSyncConfig(config as SyncConfig);
    return getSyncConfigError(normalized) ? null : normalized;
  } catch {
    return null;
  }
};

/** One foreground monitor shared by the settings screen and operation results. */
export const createSyncConnectionMonitor = (dependencies: SyncConnectionDependencies) => {
  let snapshot: SyncConnectionSnapshot = Object.freeze({ config: null, status: 'idle' });
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let failureCount = 0;
  let confirmedOnline = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let pending = false;
  let pendingTesting = false;
  let writes: Promise<void> = Promise.resolve();
  const refreshWaiters: Array<() => void> = [];

  const publish = (config: SyncConfig | null, status: ConnectionStatus): boolean => {
    const unchangedTarget = sameTarget(snapshot.config, config);
    if (unchangedTarget && snapshot.status === status) return false;
    snapshot = Object.freeze({
      config: unchangedTarget ? snapshot.config : config ? Object.freeze({ ...config }) : null,
      status,
    });
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        dependencies.onError?.(error);
      }
    });
    return true;
  };

  const queueWrite = (write: () => Promise<void>): Promise<void> => {
    const task = writes.then(write);
    // A rejected save is returned to its caller, but must not block future saves.
    writes = task.catch(() => undefined);
    return task;
  };

  const persistStatus = async (expectedGeneration: number) => {
    const status = snapshot.status;
    try {
      await queueWrite(async () => {
        if (generation === expectedGeneration && snapshot.status === status) {
          await dependencies.storage.setItem(STORAGE_KEYS.CONNECTION_STATUS, status);
        }
      });
    } catch (error) {
      dependencies.onError?.(error);
    }
  };

  const checkOnce = async (showTesting: boolean) => {
    let expectedGeneration = generation;
    await writes;
    if (!active || generation !== expectedGeneration) return;

    let config: SyncConfig | null;
    try {
      // Imports/restores also write this key, so do not retain an in-memory address forever.
      config = readSavedConfig(await dependencies.storage.getItem(STORAGE_KEYS.SYNC_CONFIG));
    } catch (error) {
      if (active && generation === expectedGeneration) {
        confirmedOnline = false;
        failureCount = 0;
        if (publish(snapshot.config, snapshot.config ? 'disconnected' : 'idle')) {
          await persistStatus(expectedGeneration);
        }
      }
      dependencies.onError?.(error);
      return;
    }
    if (!active || generation !== expectedGeneration) return;

    if (!sameTarget(snapshot.config, config)) {
      generation += 1;
      expectedGeneration = generation;
      failureCount = 0;
      confirmedOnline = false;
      publish(config, config ? 'testing' : 'idle');
    } else if (config && showTesting) {
      publish(config, 'testing');
    }
    if (!config) {
      publish(null, 'idle');
      return;
    }
    if (!active || generation !== expectedGeneration) return;

    let healthy = false;
    try {
      healthy = await dependencies.checkHealth(config, { force: true });
    } catch (error) {
      dependencies.onError?.(error);
    }
    if (!active || generation !== expectedGeneration) return;

    // An import may replace storage without calling saveConfig while HTTP is pending.
    // Confirm the target again before publishing that response.
    let latestConfig: SyncConfig | null;
    try {
      latestConfig = readSavedConfig(await dependencies.storage.getItem(STORAGE_KEYS.SYNC_CONFIG));
    } catch (error) {
      dependencies.onError?.(error);
      return;
    }
    if (!active || generation !== expectedGeneration) return;
    if (!sameTarget(config, latestConfig)) {
      generation += 1;
      failureCount = 0;
      confirmedOnline = false;
      publish(latestConfig, latestConfig ? 'testing' : 'idle');
      pending = true;
      pendingTesting = true;
      return;
    }

    if (healthy) {
      failureCount = 0;
      confirmedOnline = true;
    } else {
      failureCount += 1;
      if (failureCount >= NETWORK_CONFIG.MAX_FAILURE_COUNT) confirmedOnline = false;
    }
    const status: ConnectionStatus = healthy || confirmedOnline ? 'success' : 'disconnected';
    if (publish(config, status)) await persistStatus(expectedGeneration);
  };

  const drainChecks = async () => {
    running = true;
    try {
      while (active && pending) {
        const showTesting = pendingTesting;
        pending = false;
        pendingTesting = false;
        await checkOnce(showTesting);
      }
    } catch (error) {
      dependencies.onError?.(error);
    } finally {
      running = false;
      if (active && pending) {
        void drainChecks();
      } else {
        refreshWaiters.splice(0).forEach((resolve) => resolve());
      }
    }
  };

  const requestCheck = (showTesting = false): Promise<void> => {
    if (!active) return Promise.resolve();
    pending = true;
    pendingTesting ||= showTesting;
    const result = new Promise<void>((resolve) => refreshWaiters.push(resolve));
    if (!running) void drainChecks();
    return result;
  };

  const setActive = (nextActive: boolean) => {
    if (active === nextActive) return;
    active = nextActive;
    generation += 1;
    if (timer) clearInterval(timer);
    timer = null;
    pending = false;
    pendingTesting = false;
    if (active) {
      if (snapshot.config) publish(snapshot.config, 'testing');
      void requestCheck(true);
      timer = setInterval(() => void requestCheck(), NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    }
  };

  const saveConfig = async (config: SyncConfig): Promise<void> => {
    const normalized = normalizeSyncConfig(config);
    const configError = getSyncConfigError(normalized);
    if (configError) throw new Error(configError);

    // Invalidate the old target before an asynchronous storage write can yield.
    generation += 1;
    const savedGeneration = generation;
    failureCount = 0;
    confirmedOnline = false;
    publish(normalized, active ? 'testing' : 'idle');
    await queueWrite(() => dependencies.storage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(normalized)));
    if (generation === savedGeneration) await requestCheck(true);
  };

  const reportResult = async (
    config: SyncConfig,
    status: 'success' | 'disconnected'
  ): Promise<void> => {
    const normalized = normalizeSyncConfig(config);
    if (getSyncConfigError(normalized)) return;
    const expectedGeneration = generation;
    await writes;
    if (generation !== expectedGeneration) return;
    let savedConfig: SyncConfig | null;
    try {
      savedConfig = readSavedConfig(await dependencies.storage.getItem(STORAGE_KEYS.SYNC_CONFIG));
    } catch (error) {
      dependencies.onError?.(error);
      return;
    }
    if (generation !== expectedGeneration) return;
    if (!sameTarget(snapshot.config, savedConfig)) {
      generation += 1;
      failureCount = 0;
      confirmedOnline = false;
      publish(savedConfig, savedConfig && active ? 'testing' : 'idle');
      await requestCheck(true);
      return;
    }
    if (!sameTarget(savedConfig, normalized)) return;
    // A completed POST is newer evidence than an already-running health check.
    generation += 1;
    confirmedOnline = status === 'success';
    failureCount = status === 'success' ? 0 : NETWORK_CONFIG.MAX_FAILURE_COUNT;
    publish(snapshot.config, status);
    await persistStatus(generation);
  };

  return {
    getSyncConnectionSnapshot: () => snapshot,
    subscribeSyncConnection: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setSyncConnectionActive: setActive,
    refreshSyncConnection: () => requestCheck(),
    saveSyncConnectionConfig: saveConfig,
    reportSyncConnectionResult: reportResult,
  };
};

const monitor = createSyncConnectionMonitor({
  storage: AsyncStorage,
  checkHealth: testConnection,
  onError: (error) => logger.warn('[同步助手] 连接监测失败:', error),
});

export const getSyncConnectionSnapshot = monitor.getSyncConnectionSnapshot;
export const subscribeSyncConnection = monitor.subscribeSyncConnection;
export const setSyncConnectionActive = monitor.setSyncConnectionActive;
export const refreshSyncConnection = monitor.refreshSyncConnection;
export const saveSyncConnectionConfig = monitor.saveSyncConnectionConfig;
export const reportSyncConnectionResult = monitor.reportSyncConnectionResult;
