import updateServerConfig from '../update-server.json';
import Constants from 'expo-constants';

/**
 * 应用配置常量
 * 
 * 统一管理所有存储键、网络配置、心跳参数等
 */

// ============== 存储键配置 ==============
export const STORAGE_KEYS = {
  // 应用配置与连接状态
  SYNC_CONFIG: '@sync_config',
  CONNECTION_STATUS: '@sync_connection_status',
  UPDATE_SERVER_URL: '@update_server_url',
  SOUND_ENABLED: '@settings_sound_enabled',
  OUTBOUND_ORDER_RULE: '@settings_outbound_order_rule',
  OUTBOUND_WAREHOUSE_ORDER_RULES: '@settings_outbound_warehouse_order_rules',

  // 当前仓库选择（盘点、出库、单据管理共享）
  GLOBAL_WAREHOUSE: '@global_current_warehouse',

  // 扫码出库作业草稿和兼容旧版草稿的暂存键
  OUTBOUND_WORK_DRAFT: '@outbound_work_draft',
  OUTBOUND_ORDER_NO: '@outbound_order_no',
  OUTBOUND_SCAN_RECORDS: '@outbound_scan_records',
} as const;

// ============== 网络配置 ==============
export const NETWORK_CONFIG = {
  DEFAULT_PORT: '8080',
  HEARTBEAT_INTERVAL: 10000,
  HEARTBEAT_TIMEOUT: 5000,
  MAX_FAILURE_COUNT: 2,
  SYNC_TIMEOUT: 30000,
} as const;

// ============== 更新服务器配置 ==============
const runtimeUpdateServer =
  typeof Constants.expoConfig?.extra?.updateServerUrl === 'string'
    ? Constants.expoConfig.extra.updateServerUrl.trim()
    : '';
const configuredUpdateServer =
  runtimeUpdateServer || updateServerConfig.defaultServer.trim();

export const UPDATE_CONFIG = {
  DEFAULT_SERVER: configuredUpdateServer.replace(/\/+$/, ''),
  DEFAULT_DOWNLOAD_URL: `${configuredUpdateServer.replace(/\/+$/, '')}/app-release.apk`,
  APK_FILE_NAME: 'app-release.apk',
};

// ============== Excel 导出配置 ==============
export const EXPORT_CONFIG = {
  TIMEOUT: 30000,
} as const;

// ============== 类型定义 ==============

/** 连接状态 */
export type ConnectionStatus = 'idle' | 'testing' | 'success' | 'disconnected' | 'error';

/** 同步配置 */
export interface SyncConfig {
  ip: string;
  port: string;
}

/** 导出计数器数据 */
export interface ExportCountData {
  date: string;
  inboundCount: number;
  outboundCount: number;
}

/** 导出类型 */
export type ExportType =
  | 'inbound'
  | 'outbound'
  | 'inventory'
  | 'inventory_whole'
  | 'inventory_partial'
  | 'inventory_complete';
