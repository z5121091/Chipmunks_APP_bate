export const ERP_ACCOUNT_HEADER = 'x-erp-account-key';

export const ERP_ACCOUNT_KEYS = ['wuxi-duneng', 'shanghai-chipmunk'] as const;

export type ErpAccountKey = (typeof ERP_ACCOUNT_KEYS)[number];

export type ServerErpAccountDefinition = {
  displayName: string;
  key: ErpAccountKey;
  proxyAccessKeyEnv: string;
  proxyTargetEnv: string;
};

export const DEFAULT_ERP_ACCOUNT_KEY: ErpAccountKey = 'wuxi-duneng';

export const SERVER_ERP_ACCOUNTS: Record<ErpAccountKey, ServerErpAccountDefinition> = {
  'wuxi-duneng': {
    displayName: '无锡笃能',
    key: 'wuxi-duneng',
    proxyAccessKeyEnv: 'BACKEND_PROXY_ACCESS_KEY_WUXI_DUNENG',
    proxyTargetEnv: 'CHANJET_PROXY_TARGET_WUXI_DUNENG',
  },
  'shanghai-chipmunk': {
    displayName: '上海花栗鼠',
    key: 'shanghai-chipmunk',
    proxyAccessKeyEnv: 'BACKEND_PROXY_ACCESS_KEY_SHANGHAI_CHIPMUNK',
    proxyTargetEnv: 'CHANJET_PROXY_TARGET_SHANGHAI_CHIPMUNK',
  },
};

export const parseErpAccountKey = (value: unknown): ErpAccountKey | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return ERP_ACCOUNT_KEYS.find((key) => key === normalized) || null;
};

export const resolveErpAccountKey = (
  value: unknown,
  fallback: ErpAccountKey = DEFAULT_ERP_ACCOUNT_KEY,
  settingName = 'ERP account key'
): ErpAccountKey => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const accountKey = parseErpAccountKey(value);
  if (!accountKey) {
    throw new Error(
      `${settingName} 配置无效：${String(value)}；可选值：${ERP_ACCOUNT_KEYS.join('、')}`
    );
  }

  return accountKey;
};
