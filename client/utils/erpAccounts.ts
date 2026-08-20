import { shouldUseErpPublicGateway } from '@/utils/backendApi';

export type ErpAccountKey = 'wuxi-duneng' | 'shanghai-chipmunk';

export interface ErpAccountConfig {
  backendBaseUrl: string;
  erpEnabled: boolean;
  expectedWarehouseName: string;
  key: ErpAccountKey;
  name: string;
  sequenceLength: number;
}

// 读取环境变量，APK 构建时如果扣子没注入 EXPO_PUBLIC_* 变量，就走下方的默认值
const getEnv = (key: string): string =>
  (process.env as Record<string, string | undefined>)[key]?.trim() || '';

const getEnvBool = (key: string): boolean | null => {
  const val = (process.env as Record<string, string | undefined>)[key]?.trim().toLowerCase();
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
};

// APK 构建没有注入 EXPO_PUBLIC_* 时使用稳定的 HTTPS 域名。
// 后续迁移服务器只需要修改 DNS，不需要为了更换 IP 重新打包 APK。
const DEFAULT_BACKEND_BASE_URL = 'https://erp.chipmunks.fun';

const COMMON_BACKEND_BASE_URL = getEnv('EXPO_PUBLIC_BACKEND_BASE_URL') || DEFAULT_BACKEND_BASE_URL;
const ERP_PUBLIC_GATEWAY_BASE_URL =
  process.env.EXPO_PUBLIC_ERP_PUBLIC_GATEWAY_BASE_URL?.trim() || DEFAULT_BACKEND_BASE_URL;
const USE_ERP_PUBLIC_GATEWAY = shouldUseErpPublicGateway();

const normalizeBaseUrl = (value?: string): string => value?.trim().replace(/\/+$/, '') || '';

const WUXI_DUNENG_BASE_URL =
  (USE_ERP_PUBLIC_GATEWAY
    ? ERP_PUBLIC_GATEWAY_BASE_URL
    : getEnv('EXPO_PUBLIC_ERP_WUXI_DUNENG_BASE_URL')) || COMMON_BACKEND_BASE_URL;
const SHANGHAI_CHIPMUNK_BASE_URL =
  (USE_ERP_PUBLIC_GATEWAY
    ? getEnv('EXPO_PUBLIC_ERP_SHANGHAI_CHIPMUNK_PUBLIC_GATEWAY_BASE_URL')
    : getEnv('EXPO_PUBLIC_ERP_SHANGHAI_CHIPMUNK_BASE_URL')) || COMMON_BACKEND_BASE_URL;

const WUXI_DUNENG_ENABLED = getEnvBool('EXPO_PUBLIC_ERP_WUXI_DUNENG_ENABLED') ?? true;
const SHANGHAI_CHIPMUNK_ENABLED = getEnvBool('EXPO_PUBLIC_ERP_SHANGHAI_CHIPMUNK_ENABLED') ?? false;

export const ERP_ACCOUNTS: ErpAccountConfig[] = [
  {
    backendBaseUrl: normalizeBaseUrl(WUXI_DUNENG_BASE_URL),
    erpEnabled: WUXI_DUNENG_ENABLED,
    expectedWarehouseName: '无锡仓库',
    key: 'wuxi-duneng',
    name: '无锡笃能',
    sequenceLength: 3,
  },
  {
    backendBaseUrl: normalizeBaseUrl(SHANGHAI_CHIPMUNK_BASE_URL),
    erpEnabled: SHANGHAI_CHIPMUNK_ENABLED,
    expectedWarehouseName: '无锡总仓',
    key: 'shanghai-chipmunk',
    name: '上海花栗鼠',
    sequenceLength: 2,
  },
];

const OUTBOUND_ORDER_NO_REGEX = /^IO[-/_]\d{4}[-/_]\d{2}[-/_]\d{2}[-/_](\d+)$/;

export const getOutboundOrderSequenceLength = (orderNo: string): number | null => {
  const normalizedOrderNo = orderNo.trim().replace(/\s+/g, '').toUpperCase();
  const match = OUTBOUND_ORDER_NO_REGEX.exec(normalizedOrderNo);

  return match ? match[1].length : null;
};

export const getErpAccountByOutboundOrderNo = (orderNo: string): ErpAccountConfig | null => {
  const sequenceLength = getOutboundOrderSequenceLength(orderNo);

  if (!sequenceLength) {
    return null;
  }

  return ERP_ACCOUNTS.find((account) => account.sequenceLength === sequenceLength) || null;
};

export const getErpAccountByKey = (accountKey: ErpAccountKey): ErpAccountConfig | null =>
  ERP_ACCOUNTS.find((account) => account.key === accountKey) || null;

export const isErpAccountAvailable = (account: ErpAccountConfig): boolean =>
  account.erpEnabled && Boolean(account.backendBaseUrl);

export const requireErpAccountBackend = (account: ErpAccountConfig): string => {
  if (!account.erpEnabled) {
    throw new Error(`${account.name}账套暂未开放`);
  }

  if (!account.backendBaseUrl) {
    throw new Error(`请配置 ${account.name} 的后端地址`);
  }

  return account.backendBaseUrl;
};
