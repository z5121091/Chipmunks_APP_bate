/**
 * 同步服务连接检测工具
 */
import { NETWORK_CONFIG, SyncConfig } from '@/constants/config';

const SYNC_SERVICE_ID = 'palm-warehouse-sync';
const HEALTH_SUCCESS_CACHE_TTL_MS = 30_000;

const successfulHealthChecks = new Map<string, number>();
const inFlightHealthChecks = new Map<string, Promise<boolean>>();
const healthCacheGenerations = new Map<string, number>();

type SyncHealthResponse = {
  service?: string;
  serviceId?: string;
  status?: string;
  pairingRequired?: boolean;
  pairingAuthenticated?: boolean;
};

export const normalizeSyncConfig = (config: SyncConfig): SyncConfig => ({
  ip: config.ip.trim(),
  port: config.port.trim() || NETWORK_CONFIG.DEFAULT_PORT,
  ...(typeof config.pairingKey === 'string' && config.pairingKey.trim()
    ? { pairingKey: config.pairingKey.trim() } : {}),
});

export const getSyncPairingHeaders = (config: SyncConfig): Record<string, string> => {
  const key = normalizeSyncConfig(config).pairingKey;
  return key ? { 'X-Sync-Pairing-Key': key } : {};
};

const getHealthCacheKey = (config: SyncConfig): string =>
  JSON.stringify([getSyncServiceBaseUrl(config), normalizeSyncConfig(config).pairingKey || '']);

export const getSyncConfigError = (config: SyncConfig): string => {
  const normalized = normalizeSyncConfig(config);

  if (config.pairingKey !== undefined && (typeof config.pairingKey !== 'string' ||
    (config.pairingKey.trim() !== '' && !/^[\x21-\x7e]{1,128}$/.test(config.pairingKey.trim())))) {
    return '配对密钥需为1至128位英文字母、数字或符号；未启用配对时留空';
  }

  if (!normalized.ip) {
    return '请输入电脑IP或主机名';
  }
  if (/[\s/?#]/.test(normalized.ip) || normalized.ip.includes(':')) {
    return '电脑地址只填写IP或主机名，不要包含 http、端口或路径';
  }
  if (!/^\d{1,5}$/.test(normalized.port)) {
    return '端口必须是1到65535之间的数字';
  }

  const port = Number(normalized.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return '端口必须是1到65535之间的数字';
  }

  return '';
};

export const getSyncServiceBaseUrl = (config: SyncConfig): string => {
  const normalized = normalizeSyncConfig(config);
  return `http://${normalized.ip}:${normalized.port}`;
};

export const invalidateSuccessfulHealthCheck = (config: SyncConfig): void => {
  const key = getHealthCacheKey(config);
  successfulHealthChecks.delete(key);
  healthCacheGenerations.set(key, (healthCacheGenerations.get(key) || 0) + 1);
};

/**
 * 测试连接（单次）
 */
export const testConnection = async (
  config: SyncConfig,
  options: { force?: boolean } = {}
): Promise<boolean> => {
  if (getSyncConfigError(config)) return false;

  const baseUrl = getSyncServiceBaseUrl(config);
  const cacheKey = getHealthCacheKey(config);
  const activeCheck = inFlightHealthChecks.get(cacheKey);
  if (activeCheck) return activeCheck;

  const cachedUntil = successfulHealthChecks.get(cacheKey) || 0;
  if (!options.force && cachedUntil > Date.now()) {
    return true;
  }

  const cacheGeneration = healthCacheGenerations.get(cacheKey) || 0;
  const checkTask = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);
    let healthy = false;
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        ...(config.pairingKey?.trim() ? { headers: getSyncPairingHeaders(config) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) return false;

      const payload = (await response.json().catch(() => null)) as SyncHealthResponse | null;
      healthy = Boolean(
        payload &&
          (healthCacheGenerations.get(cacheKey) || 0) === cacheGeneration &&
          payload.status === 'ok' &&
          (payload.pairingRequired !== true || payload.pairingAuthenticated === true) &&
          (payload.serviceId === SYNC_SERVICE_ID ||
            (payload.serviceId === undefined && payload.service === '掌上仓库同步服务'))
      );
      if (healthy) {
        successfulHealthChecks.set(cacheKey, Date.now() + HEALTH_SUCCESS_CACHE_TTL_MS);
      }
      return healthy;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
      if (!healthy) successfulHealthChecks.delete(cacheKey);
    }
  })();
  inFlightHealthChecks.set(cacheKey, checkTask);
  try {
    return await checkTask;
  } finally {
    if (inFlightHealthChecks.get(cacheKey) === checkTask) {
      inFlightHealthChecks.delete(cacheKey);
    }
  }
};
