import { NETWORK_CONFIG, type SyncConfig } from '@/constants/config';
import {
  getSyncConfigError,
  getSyncPairingHeaders,
  getSyncServiceBaseUrl,
} from '@/utils/heartbeat';

type CompatibilityCode = 'NO_SYNC_CONFIG' | 'SYNC_UNAVAILABLE' | 'SYNC_PAIRING_REQUIRED' | 'UNSUPPORTED_HELPER';

export class DongweiPrintCompatibilityError extends Error {
  constructor(message: string, public readonly code: CompatibilityCode) {
    super(message);
    this.name = 'DongweiPrintCompatibilityError';
  }
}

const unavailable = () => new DongweiPrintCompatibilityError(
  '未连接到同步助手，请确认电脑端已开启同步助手及网络连接。', 'SYNC_UNAVAILABLE'
);
const pairingFailed = () => new DongweiPrintCompatibilityError(
  '同步助手配对失败，请在设置中核对配对密钥。本次未提交打印。', 'SYNC_PAIRING_REQUIRED'
);

const assertHealth = (value: unknown): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const health = value as Record<string, unknown>;
  if (health.status !== 'ok' || health.serviceId !== 'palm-warehouse-sync' ||
      (health.pairingRequired !== undefined && typeof health.pairingRequired !== 'boolean') ||
      (health.pairingAuthenticated !== undefined && typeof health.pairingAuthenticated !== 'boolean')) throw unavailable();
  if (health.pairingRequired === true && health.pairingAuthenticated !== true) throw pairingFailed();
  if (!Array.isArray(health.dongweiLabelFieldCounts) ||
      !health.dongweiLabelFieldCounts.every(count => typeof count === 'number' && Number.isSafeInteger(count)) ||
      !health.dongweiLabelFieldCounts.includes(6)) {
    throw new DongweiPrintCompatibilityError(
      '请更新电脑端同步助手，当前版本不支持东微六段无箱号标签。本次未提交打印。', 'UNSUPPORTED_HELPER'
    );
  }
};

/** Reprints can reuse the health payload already fetched for the same submission. */
export const assertDongweiSixPrintSupported = async (
  config: SyncConfig,
  verifiedHealth?: unknown
): Promise<void> => {
  const configError = getSyncConfigError(config);
  if (configError) {
    throw new DongweiPrintCompatibilityError(
      `同步助手配置无效：${configError}。请在设置中核对后重试。`, 'NO_SYNC_CONFIG'
    );
  }
  if (verifiedHealth !== undefined) {
    assertHealth(verifiedHealth);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);
  try {
    const response = await fetch(`${getSyncServiceBaseUrl(config)}/health`, {
      method: 'GET',
      ...(config.pairingKey?.trim() ? { headers: getSyncPairingHeaders(config) } : {}),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw pairingFailed();
    if (!response.ok) throw unavailable();
    assertHealth(await response.json().catch(() => null));
  } catch (error) {
    if (error instanceof DongweiPrintCompatibilityError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timeout);
  }
};
