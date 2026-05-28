/**
 * 同步服务连接检测工具
 */
import { NETWORK_CONFIG, SyncConfig } from '@/constants/config';

/**
 * 测试连接（单次）
 */
export const testConnection = async (config: SyncConfig): Promise<boolean> => {
  if (!config.ip) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);

  try {
    const response = await fetch(
      `http://${config.ip}:${config.port || NETWORK_CONFIG.DEFAULT_PORT}/health`,
      {
        method: 'GET',
        signal: controller.signal,
      }
    );

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};
