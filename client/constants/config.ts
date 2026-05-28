/**
 * 应用配置常量
 * 
 * 统一管理所有存储键、网络配置、心跳参数等
 */

// ============== 存储键配置 ==============
export const STORAGE_KEYS = {
  // 业务数据
  ORDERS: '@warehouse_orders',
  MATERIALS: '@warehouse_materials',
  RULES: '@warehouse_qrcode_rules',
  CUSTOM_FIELDS: '@warehouse_custom_fields',
  UNPACK_RECORDS: '@warehouse_unpack_records',
  PRINT_HISTORY: '@warehouse_print_history',
  WAREHOUSES: '@warehouse_warehouses',
  INVENTORY_BINDINGS: '@warehouse_inventory_bindings',
  INBOUND_RECORDS: '@warehouse_inbound_records',
  INVENTORY_RECORDS: '@warehouse_inventory_records',
  
  // 应用配置
  DATA_VERSION: '@warehouse_data_version',
  SYNC_CONFIG: '@sync_config',
  CONNECTION_STATUS: '@sync_connection_status',
  UPDATE_SERVER_URL: '@update_server_url',
  SOUND_ENABLED: '@settings_sound_enabled',
  OUTBOUND_ORDER_RULE: '@settings_outbound_order_rule',
  OUTBOUND_WAREHOUSE_ORDER_RULES: '@settings_outbound_warehouse_order_rules',
  EXPORT_COUNT: '@warehouse_export_count',
  WAREHOUSE_GUIDE_SHOWN: '@warehouse_guide_shown',
  
  // 临时数据
  INBOUND_SCAN_RECORDS: '@inbound_scan_records',
  INBOUND_PENDING_DATA: '@inbound_pending_data',
  INVENTORY_CHECK_RECORDS: '@inventory_check_records',
  INVENTORY_CHECK_TYPE: '@inventory_check_type',

  // 全局仓库配置（所有模块共享）
  GLOBAL_WAREHOUSE: '@global_current_warehouse',

  // 扫码出库持久化数据（已废弃，改用 GLOBAL_WAREHOUSE）
  OUTBOUND_WORK_DRAFT: '@outbound_work_draft',
  OUTBOUND_ORDER_NO: '@outbound_order_no',
  OUTBOUND_SCAN_RECORDS: '@outbound_scan_records',
  OUTBOUND_WAREHOUSE: '@outbound_warehouse',

  // 订单管理页面独立仓库选择（已废弃，改用 GLOBAL_WAREHOUSE）
  ORDERS_WAREHOUSE: '@orders_warehouse',
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
export const UPDATE_CONFIG = {
  DEFAULT_SERVER: 'https://zx5121091:zx5121091Z..@dav.zx5121091.fnos.net:443/AppUpdate',
  DEFAULT_DOWNLOAD_URL: 'https://zx5121091:zx5121091Z..@dav.zx5121091.fnos.net:443/AppUpdate/app-release.apk',
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
