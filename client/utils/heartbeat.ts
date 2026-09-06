/**
 * 同步服务连接检测工具
 */
import { NETWORK_CONFIG, SyncConfig } from '@/constants/config';

const SYNC_SERVICE_ID = 'palm-warehouse-sync';
const HEALTH_SUCCESS_CACHE_TTL_MS = 30_000;

const successfulHealthChecks = new Map<string, number>();

type SyncHealthResponse = {
  service?: string;
  serviceId?: string;
  status?: string;
};

export const normalizeSyncConfig = (config: SyncConfig): SyncConfig => ({
  ip: config.ip.trim(),
  port: config.port.trim() || NETWORK_CONFIG.DEFAULT_PORT,
});

export const getSyncConfigError = (config: SyncConfig): string => {
  const normalized = normalizeSyncConfig(config);

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

/**
 * 测试连接（单次）
 */
export const testConnection = async (
  config: SyncConfig,
  options: { force?: boolean } = {}
): Promise<boolean> => {
  if (getSyncConfigError(config)) return false;

  const baseUrl = getSyncServiceBaseUrl(config);
  const cachedUntil = successfulHealthChecks.get(baseUrl) || 0;
  if (!options.force && cachedUntil > Date.now()) {
    return true;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json().catch(() => null)) as SyncHealthResponse | null;

    const healthy = Boolean(
      payload &&
        payload.status === 'ok' &&
        (payload.serviceId === SYNC_SERVICE_ID || payload.service === '掌上仓库同步服务')
    );
    if (healthy) {
      successfulHealthChecks.set(baseUrl, Date.now() + HEALTH_SUCCESS_CACHE_TTL_MS);
    }
    return healthy;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};
