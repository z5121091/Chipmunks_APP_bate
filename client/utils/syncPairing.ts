import { NETWORK_CONFIG, type SyncConfig } from '@/constants/config';
import { getSyncConfigError, getSyncPairingHeaders, getSyncServiceBaseUrl } from '@/utils/heartbeat';

/** Shared wire format for the desktop connection QR. Never treat arbitrary URLs as pairing codes. */
export function parseSyncPairingCode(raw: string): SyncConfig {
  if (raw.length > 1024) throw new Error('连接二维码内容过长，请重新打开电脑端二维码');
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw.trim()); }
  catch { throw new Error('这不是完整的同步助手连接二维码，请重新扫描'); }
  if (!data || data.type !== 'palm-warehouse-sync' || data.v !== 1) {
    throw new Error('这不是支持的同步助手连接二维码，请使用电脑端最新的连接码');
  }
  if (typeof data.ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(data.ip) ||
      data.ip.split('.').some(part => Number(part) > 255) ||
      !['string', 'number'].includes(typeof data.port) ||
      !/^\d{1,5}$/.test(String(data.port)) ||
      (data.key !== undefined && (typeof data.key !== 'string' || (data.key !== '' && !/^[\x21-\x7e]{1,128}$/.test(data.key))))) {
    throw new Error('连接二维码中的地址、端口或密钥无效，请在电脑端重新生成');
  }
  const config: SyncConfig = { ip: data.ip, port: String(data.port), ...(data.key ? { pairingKey: String(data.key) } : {}) };
  const error = getSyncConfigError(config);
  if (error || !config.port) throw new Error(error || '连接二维码缺少端口');
  return config;
}

/** Validate a candidate before replacing the working saved connection. */
export async function verifySyncPairingConnection(config: SyncConfig): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);
  try {
    const response = await fetch(`${getSyncServiceBaseUrl(config)}/health`, {
      headers: getSyncPairingHeaders(config), signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error('配对密钥不匹配，请重新扫描电脑端当前的连接二维码');
    if (!response.ok) throw new Error('电脑同步助手暂时无法响应，请稍后重试');
    const data = await response.json().catch(() => null);
    if (!data || data.status !== 'ok' || !(data.serviceId === 'palm-warehouse-sync' ||
      (data.serviceId === undefined && data.service === '掌上仓库同步服务'))) {
      throw new Error('该地址不是掌上仓库同步助手，请核对电脑端服务地址');
    }
    if (data.pairingRequired === true && data.pairingAuthenticated !== true) {
      throw new Error('配对密钥不匹配，请重新扫描电脑端当前的连接二维码');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('配对密钥')) throw error;
    if (error instanceof Error && (error.message.startsWith('该地址') || error.message.startsWith('电脑同步'))) throw error;
    throw new Error('无法连接电脑，请确认同步助手已启动，且手机与电脑在同一网络');
  } finally { clearTimeout(timer); }
}
