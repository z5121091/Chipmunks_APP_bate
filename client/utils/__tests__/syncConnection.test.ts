import { NETWORK_CONFIG, STORAGE_KEYS, type SyncConfig } from '@/constants/config';
import { createSyncConnectionMonitor } from '../syncConnection';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('../logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

const FIRST_CONFIG: SyncConfig = { ip: '192.168.1.10', port: '8080' };
const SECOND_CONFIG: SyncConfig = { ip: '192.168.1.11', port: '8081' };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushPromises = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

const createFixture = (config: SyncConfig | null = FIRST_CONFIG, historicalStatus?: string) => {
  const values = new Map<string, string>();
  if (config) values.set(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(config));
  if (historicalStatus) values.set(STORAGE_KEYS.CONNECTION_STATUS, historicalStatus);
  const storage = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  const checkHealth = jest.fn<Promise<boolean>, [SyncConfig, { force: boolean }]>().mockResolvedValue(true);
  const onError = jest.fn();
  const monitor = createSyncConnectionMonitor({ storage, checkHealth, onError });
  return { monitor, storage, values, checkHealth, onError };
};

describe('shared sync assistant connection monitor', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('recovers when the assistant starts after the APK and continues probing while disconnected', async () => {
    const { monitor, checkHealth, values } = createFixture();
    checkHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('disconnected');

    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    expect(values.get(STORAGE_KEYS.CONNECTION_STATUS)).toBe('success');
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(checkHealth).toHaveBeenLastCalledWith(FIRST_CONFIG, { force: true });
    monitor.setSyncConnectionActive(false);
  });

  it('requires two consecutive failures after success and then recovers without manual testing', async () => {
    const { monitor, checkHealth } = createFixture();
    checkHealth.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('disconnected');
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    monitor.setSyncConnectionActive(false);
  });

  it.each(['error', 'disconnected', 'success'])('does not trust historical %s status on startup', async (status) => {
    const { monitor, checkHealth, storage } = createFixture(FIRST_CONFIG, status);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    expect(checkHealth).toHaveBeenCalledTimes(1);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    expect(storage.getItem.mock.calls.every(([key]) => key === STORAGE_KEYS.SYNC_CONFIG)).toBe(true);
    monitor.setSyncConnectionActive(false);
  });

  it('discards an in-flight response while paused and immediately tests on foreground resume', async () => {
    const { monitor, checkHealth } = createFixture();
    const initial = deferred<boolean>();
    checkHealth.mockReturnValueOnce(initial.promise).mockResolvedValueOnce(true);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('testing');
    monitor.setSyncConnectionActive(false);
    initial.resolve(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('testing');
    await jest.advanceTimersByTimeAsync(3 * NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    await monitor.refreshSyncConnection();
    expect(checkHealth).toHaveBeenCalledTimes(1);

    monitor.setSyncConnectionActive(true);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('testing');
    await flushPromises();
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    monitor.setSyncConnectionActive(false);
  });

  it('queues concurrent refreshes into one additional probe and waits for its result', async () => {
    const { monitor, checkHealth } = createFixture();
    const initial = deferred<boolean>();
    const next = deferred<boolean>();
    checkHealth.mockReturnValueOnce(initial.promise).mockReturnValueOnce(next.promise);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    let firstFinished = false;
    let secondFinished = false;
    const firstRefresh = monitor.refreshSyncConnection().then(() => { firstFinished = true; });
    const secondRefresh = monitor.refreshSyncConnection().then(() => { secondFinished = true; });
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(checkHealth).toHaveBeenCalledTimes(1);
    initial.resolve(false);
    await flushPromises();
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(firstFinished).toBe(false);
    expect(secondFinished).toBe(false);
    next.resolve(true);
    await Promise.all([firstRefresh, secondRefresh]);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    expect(checkHealth).toHaveBeenCalledTimes(2);
    monitor.setSyncConnectionActive(false);
  });

  it('invalidates the old address before saving yields and prevents its health result from overwriting the new one', async () => {
    const { monitor, checkHealth, storage, values } = createFixture();
    const oldProbe = deferred<boolean>();
    const newProbe = deferred<boolean>();
    const configWrite = deferred<void>();
    checkHealth.mockReturnValueOnce(oldProbe.promise).mockReturnValueOnce(newProbe.promise);
    const originalWrite = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation(async (key, value) => {
      if (key === STORAGE_KEYS.SYNC_CONFIG) await configWrite.promise;
      await originalWrite(key, value);
    });
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    const save = monitor.saveSyncConnectionConfig(SECOND_CONFIG);
    expect(monitor.getSyncConnectionSnapshot().config).toEqual(SECOND_CONFIG);
    oldProbe.resolve(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('testing');
    expect(values.get(STORAGE_KEYS.CONNECTION_STATUS)).not.toBe('success');
    expect(checkHealth).toHaveBeenCalledTimes(1);

    configWrite.resolve();
    await flushPromises();
    expect(checkHealth).toHaveBeenLastCalledWith(SECOND_CONFIG, { force: true });
    expect(checkHealth).toHaveBeenCalledTimes(2);
    newProbe.resolve(false);
    await save;
    expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: SECOND_CONFIG, status: 'disconnected' });
    monitor.setSyncConnectionActive(false);
  });

  it('detects configuration imported outside the monitor on the next periodic check', async () => {
    const { monitor, checkHealth, values } = createFixture();
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    values.set(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(SECOND_CONFIG));
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: SECOND_CONFIG, status: 'success' });
    expect(checkHealth).toHaveBeenLastCalledWith(SECOND_CONFIG, { force: true });
    monitor.setSyncConnectionActive(false);
  });

  it('discards the old health response if an import changes storage during the request', async () => {
    const { monitor, checkHealth, values } = createFixture();
    const oldProbe = deferred<boolean>();
    const newProbe = deferred<boolean>();
    checkHealth.mockReturnValueOnce(oldProbe.promise).mockReturnValueOnce(newProbe.promise);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    values.set(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(SECOND_CONFIG));
    oldProbe.resolve(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: SECOND_CONFIG, status: 'testing' });
    expect(values.get(STORAGE_KEYS.CONNECTION_STATUS)).not.toBe('success');
    expect(checkHealth).toHaveBeenLastCalledWith(SECOND_CONFIG, { force: true });
    newProbe.resolve(false);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('disconnected');
    monitor.setSyncConnectionActive(false);
  });

  it.each([null, 'not json', JSON.stringify({ ip: '', port: '8080' })])(
    'does not send requests with missing or invalid configuration %s', async (saved) => {
      const { monitor, checkHealth, values } = createFixture(null);
      if (saved) values.set(STORAGE_KEYS.SYNC_CONFIG, saved);
      monitor.setSyncConnectionActive(true);
      await flushPromises();
      await jest.advanceTimersByTimeAsync(2 * NETWORK_CONFIG.HEARTBEAT_INTERVAL);
      expect(checkHealth).not.toHaveBeenCalled();
      expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: null, status: 'idle' });
      monitor.setSyncConnectionActive(false);
    }
  );

  it('keeps the same snapshot and does not notify subscribers for repeated healthy periodic probes', async () => {
    const { monitor } = createFixture();
    const listener = jest.fn();
    const unsubscribe = monitor.subscribeSyncConnection(listener);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    const snapshot = monitor.getSyncConnectionSnapshot();
    listener.mockClear();
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await monitor.reportSyncConnectionResult(FIRST_CONFIG, 'disconnected');
    expect(listener).not.toHaveBeenCalled();
    monitor.setSyncConnectionActive(false);
  });

  it('accepts operation results only for the current address and invalidates an older health response', async () => {
    const { monitor, checkHealth, values } = createFixture();
    const probe = deferred<boolean>();
    checkHealth.mockReturnValueOnce(probe.promise);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    await monitor.reportSyncConnectionResult(SECOND_CONFIG, 'success');
    expect(monitor.getSyncConnectionSnapshot().status).toBe('testing');
    await monitor.reportSyncConnectionResult(FIRST_CONFIG, 'disconnected');
    expect(values.get(STORAGE_KEYS.CONNECTION_STATUS)).toBe('disconnected');
    probe.resolve(true);
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot().status).toBe('disconnected');
    await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_INTERVAL);
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    monitor.setSyncConnectionActive(false);
  });

  it('ignores an old POST result after a configuration import and refreshes the saved target', async () => {
    const { monitor, checkHealth, storage, values } = createFixture();
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    const newProbe = deferred<boolean>();
    checkHealth.mockReturnValueOnce(newProbe.promise);
    values.set(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(SECOND_CONFIG));
    storage.setItem.mockClear();
    const report = monitor.reportSyncConnectionResult(FIRST_CONFIG, 'disconnected');
    await flushPromises();
    expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: SECOND_CONFIG, status: 'testing' });
    expect(checkHealth).toHaveBeenLastCalledWith(SECOND_CONFIG, { force: true });
    expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.CONNECTION_STATUS, 'disconnected');
    newProbe.resolve(true);
    await report;
    expect(monitor.getSyncConnectionSnapshot()).toEqual({ config: SECOND_CONFIG, status: 'success' });
    monitor.setSyncConnectionActive(false);
  });

  it('normalizes saved configuration and waits for persistence before the first health check', async () => {
    const { monitor, checkHealth, values } = createFixture(null);
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    await monitor.saveSyncConnectionConfig({ ip: ' 192.168.1.10 ', port: ' ' });
    expect(values.get(STORAGE_KEYS.SYNC_CONFIG)).toBe(JSON.stringify(FIRST_CONFIG));
    expect(checkHealth).toHaveBeenCalledWith(FIRST_CONFIG, { force: true });
    expect(monitor.getSyncConnectionSnapshot().status).toBe('success');
    monitor.setSyncConnectionActive(false);
  });

  it('rejects invalid saved addresses without altering the current target', async () => {
    const { monitor, checkHealth } = createFixture();
    monitor.setSyncConnectionActive(true);
    await flushPromises();
    const snapshot = monitor.getSyncConnectionSnapshot();
    await expect(monitor.saveSyncConnectionConfig({ ip: 'http://bad', port: '8080' })).rejects.toThrow();
    expect(monitor.getSyncConnectionSnapshot()).toBe(snapshot);
    expect(checkHealth).toHaveBeenCalledTimes(1);
    monitor.setSyncConnectionActive(false);
  });
});
