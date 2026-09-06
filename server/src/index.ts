import 'dotenv/config';
import cors, { type CorsOptions } from 'cors';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { inflateSync, strFromU8 } from 'fflate';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import {
  DEFAULT_ERP_ACCOUNT_KEY,
  ERP_ACCOUNT_HEADER,
  type ErpAccountKey,
  parseErpAccountKey,
  resolveErpAccountKey,
  SERVER_ERP_ACCOUNTS,
} from './erpAccounts.ts';
import { registerErpRoutes } from './erp.ts';
import { ErpProxyConnectionError, fetchProxyUpstream } from './erpProxy.ts';
import { HOME_PAGE_HTML, PRIVACY_POLICY_HTML } from './publicPages.ts';
import { SERVER_RELEASE } from './release.ts';

type ErpProxyFileConfig = {
  backendAccessKey?: string;
  backendAccessKeys?: Partial<Record<ErpAccountKey, string>>;
  clientAccessKey?: string;
  hostAccounts?: Record<string, ErpAccountKey>;
  target?: string;
  targetAddress?: string;
  targetAddresses?: Partial<Record<ErpAccountKey, string>>;
  targets?: Partial<Record<ErpAccountKey, string>>;
};

const normalizeProxyHost = (value: string): string =>
  value.split(',')[0]?.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') || '';

const readErpProxyFileConfig = (): ErpProxyFileConfig => {
  const configPath =
    process.env.CHANJET_PROXY_CONFIG_PATH?.trim() ||
    path.resolve(process.cwd(), 'erp-proxy.config.json');

  try {
    const configText = readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const value: unknown = JSON.parse(configText);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('代理配置文件根节点必须是对象');
    }

    const record = value as Record<string, unknown>;
    const rawTargets =
      record.targets && typeof record.targets === 'object' && !Array.isArray(record.targets)
        ? (record.targets as Record<string, unknown>)
        : {};
    const rawTargetAddresses =
      record.targetAddresses &&
      typeof record.targetAddresses === 'object' &&
      !Array.isArray(record.targetAddresses)
        ? (record.targetAddresses as Record<string, unknown>)
        : {};
    const rawBackendAccessKeys =
      record.backendAccessKeys &&
      typeof record.backendAccessKeys === 'object' &&
      !Array.isArray(record.backendAccessKeys)
        ? (record.backendAccessKeys as Record<string, unknown>)
        : {};
    const rawHostAccounts =
      record.hostAccounts &&
      typeof record.hostAccounts === 'object' &&
      !Array.isArray(record.hostAccounts)
        ? (record.hostAccounts as Record<string, unknown>)
        : {};
    const hostAccounts = Object.fromEntries(
      Object.entries(rawHostAccounts).flatMap(([rawHost, rawAccountKey]) => {
        const normalizedHost = normalizeProxyHost(rawHost);
        const accountKey = parseErpAccountKey(rawAccountKey);
        return normalizedHost && accountKey ? [[normalizedHost, accountKey]] : [];
      })
    );
    return {
      backendAccessKey:
        typeof record.backendAccessKey === 'string' ? record.backendAccessKey.trim() : '',
      backendAccessKeys: {
        'wuxi-duneng':
          typeof rawBackendAccessKeys['wuxi-duneng'] === 'string'
            ? rawBackendAccessKeys['wuxi-duneng'].trim()
            : '',
        'shanghai-chipmunk':
          typeof rawBackendAccessKeys['shanghai-chipmunk'] === 'string'
            ? rawBackendAccessKeys['shanghai-chipmunk'].trim()
            : '',
      },
      clientAccessKey:
        typeof record.clientAccessKey === 'string' ? record.clientAccessKey.trim() : '',
      hostAccounts,
      target: typeof record.target === 'string' ? record.target.trim() : '',
      targetAddress:
        typeof record.targetAddress === 'string' ? record.targetAddress.trim() : '',
      targetAddresses: {
        'wuxi-duneng':
          typeof rawTargetAddresses['wuxi-duneng'] === 'string'
            ? rawTargetAddresses['wuxi-duneng'].trim()
            : '',
        'shanghai-chipmunk':
          typeof rawTargetAddresses['shanghai-chipmunk'] === 'string'
            ? rawTargetAddresses['shanghai-chipmunk'].trim()
            : '',
      },
      targets: {
        'wuxi-duneng':
          typeof rawTargets['wuxi-duneng'] === 'string'
            ? rawTargets['wuxi-duneng'].trim()
            : '',
        'shanghai-chipmunk':
          typeof rawTargets['shanghai-chipmunk'] === 'string'
            ? rawTargets['shanghai-chipmunk'].trim()
            : '',
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        '[Coze ERP proxy] ignored invalid erp-proxy.config.json:',
        error instanceof Error ? error.message : error
      );
    }
    return {};
  }
};

const erpProxyFileConfig = readErpProxyFileConfig();
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST?.trim() || '0.0.0.0';
const configuredErpProxyTimeoutMs = Number(process.env.ERP_PROXY_TIMEOUT_MS);
const erpProxyTimeoutMs =
  Number.isFinite(configuredErpProxyTimeoutMs) &&
  configuredErpProxyTimeoutMs >= 5_000 &&
  configuredErpProxyTimeoutMs <= 24_000
    ? configuredErpProxyTimeoutMs
    : 22_000;
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`服务端口配置无效：${process.env.PORT || ''}`);
}
const uploadDir = path.resolve(
  process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), 'sync-data', 'uploads')
);
const cozeErpProxyPrefix = '/api/v1/tplus-proxy';
const legacyCozeErpProxyTarget =
  process.env.CHANJET_PROXY_TARGET?.trim() || erpProxyFileConfig.target || '';
const localErpAccountKey = resolveErpAccountKey(
  process.env.CHANJET_LOCAL_ACCOUNT_KEY,
  DEFAULT_ERP_ACCOUNT_KEY,
  'CHANJET_LOCAL_ACCOUNT_KEY'
);
const configuredCozeErpProxyTargets: Record<ErpAccountKey, string> = {
  'wuxi-duneng':
    process.env[SERVER_ERP_ACCOUNTS['wuxi-duneng'].proxyTargetEnv]?.trim() ||
    erpProxyFileConfig.targets?.['wuxi-duneng'] ||
    '',
  'shanghai-chipmunk':
    process.env[SERVER_ERP_ACCOUNTS['shanghai-chipmunk'].proxyTargetEnv]?.trim() ||
    erpProxyFileConfig.targets?.['shanghai-chipmunk'] ||
    '',
};
const cozeErpProxyTargets: Record<ErpAccountKey, string> = {
  'wuxi-duneng': (
    configuredCozeErpProxyTargets['wuxi-duneng'] ||
    legacyCozeErpProxyTarget
  ).replace(/\/+$/, ''),
  'shanghai-chipmunk': configuredCozeErpProxyTargets['shanghai-chipmunk'].replace(/\/+$/, ''),
};
const legacyCozeErpProxyAddress =
  process.env.CHANJET_PROXY_ADDRESS?.trim() || erpProxyFileConfig.targetAddress || '';
const configuredCozeErpProxyAddresses: Record<ErpAccountKey, string> = {
  'wuxi-duneng':
    process.env.CHANJET_PROXY_ADDRESS_WUXI_DUNENG?.trim() ||
    erpProxyFileConfig.targetAddresses?.['wuxi-duneng'] ||
    legacyCozeErpProxyAddress,
  'shanghai-chipmunk':
    process.env.CHANJET_PROXY_ADDRESS_SHANGHAI_CHIPMUNK?.trim() ||
    erpProxyFileConfig.targetAddresses?.['shanghai-chipmunk'] ||
    '',
};
const cozeErpProxyAddresses: Record<ErpAccountKey, string> = {
  'wuxi-duneng': isIP(configuredCozeErpProxyAddresses['wuxi-duneng'])
    ? configuredCozeErpProxyAddresses['wuxi-duneng']
    : '',
  'shanghai-chipmunk': isIP(configuredCozeErpProxyAddresses['shanghai-chipmunk'])
    ? configuredCozeErpProxyAddresses['shanghai-chipmunk']
    : '',
};
const legacyCozeErpProxyAccessKey =
  process.env.BACKEND_PROXY_ACCESS_KEY?.trim() ||
  erpProxyFileConfig.backendAccessKey ||
  '';
const cozeErpProxyAccessKeys: Record<ErpAccountKey, string> = {
  'wuxi-duneng':
    process.env[SERVER_ERP_ACCOUNTS['wuxi-duneng'].proxyAccessKeyEnv]?.trim() ||
    erpProxyFileConfig.backendAccessKeys?.['wuxi-duneng'] ||
    legacyCozeErpProxyAccessKey,
  'shanghai-chipmunk':
    process.env[SERVER_ERP_ACCOUNTS['shanghai-chipmunk'].proxyAccessKeyEnv]?.trim() ||
    erpProxyFileConfig.backendAccessKeys?.['shanghai-chipmunk'] ||
    legacyCozeErpProxyAccessKey,
};
const hasLocalChanjetCredentials = Boolean(
  process.env.CHANJET_APP_KEY?.trim() && process.env.CHANJET_APP_SECRET?.trim()
);
const isCozeRuntime = Boolean(
  process.env.COZE_PROJECT_ID?.trim() ||
  process.env.EXPO_PUBLIC_COZE_PROJECT_ID?.trim() ||
  process.env.COZE_PROJECT_DOMAIN_DEFAULT?.trim()
);
const configuredProxyMode = process.env.CHANJET_PROXY_MODE?.trim().toLowerCase();
const shouldProxyCozeErp =
  configuredProxyMode === 'true' ||
  (configuredProxyMode !== 'false' && (isCozeRuntime || !hasLocalChanjetCredentials));
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowLocalhostCors = process.env.CORS_ALLOW_LOCALHOST !== 'false';
const allowCozeCors = process.env.CORS_ALLOW_COZE !== 'false';
const allowedUploadContentTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitEntries = new Map<string, RateLimitEntry>();
const backendAccessKey = process.env.BACKEND_ACCESS_KEY?.trim() || '';
const backendAdminKey = process.env.BACKEND_ADMIN_KEY?.trim() || '';
const cozeProxyClientAccessKey =
  process.env.COZE_PROXY_CLIENT_ACCESS_KEY?.trim() ||
  erpProxyFileConfig.clientAccessKey ||
  '';
const allowCozeKeylessCompatibility =
  shouldProxyCozeErp && process.env.COZE_PROXY_ALLOW_KEYLESS_COMPATIBILITY !== 'false';

const readRateLimitSetting = (
  envName: string,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const value = Number(process.env[envName]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
};

const cozeKeylessRateLimitMax = readRateLimitSetting(
  'COZE_PROXY_KEYLESS_RATE_LIMIT_MAX',
  120,
  30,
  1_000
);
const cozeKeylessRateLimitWindowMs = readRateLimitSetting(
  'COZE_PROXY_KEYLESS_RATE_LIMIT_WINDOW_MS',
  60 * 60_000,
  60_000,
  24 * 60 * 60_000
);

const readHeader = (req: Request, name: string): string => {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value.trim() : '';
};

const readRequestedErpAccountKey = (req: Request): ErpAccountKey | null => {
  const requestedKey = readHeader(req, ERP_ACCOUNT_HEADER);
  if (requestedKey) {
    return parseErpAccountKey(requestedKey);
  }

  if (shouldProxyCozeErp) {
    const requestHost = normalizeProxyHost(
      readHeader(req, 'x-forwarded-host') || readHeader(req, 'host')
    );
    const hostAccountKey = requestHost ? erpProxyFileConfig.hostAccounts?.[requestHost] : undefined;
    if (hostAccountKey) {
      return hostAccountKey;
    }
  }

  // A direct account instance already has an unambiguous identity. Proxy mode
  // keeps the Wuxi fallback for compatibility with older clients and the
  // current single-domain test deployment.
  return shouldProxyCozeErp ? DEFAULT_ERP_ACCOUNT_KEY : localErpAccountKey;
};

const secureEqual = (left: string, right: string): boolean => {
  if (!left || !right) {
    return false;
  }

  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
};

const isLoopbackAddress = (address: string | undefined): boolean => {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

const isLocalDevelopmentRequest = (req: Request): boolean => {
  if (process.env.NODE_ENV === 'production' || !isLoopbackAddress(req.socket.remoteAddress)) {
    return false;
  }

  return !readHeader(req, 'x-forwarded-for') && !readHeader(req, 'x-real-ip');
};

const requireKey = (
  configuredKey: string,
  headerName: string,
  label: string
): RequestHandler => {
  return (req, res, next) => {
    if (!configuredKey) {
      if (isLocalDevelopmentRequest(req)) {
        next();
        return;
      }

      res.status(503).json({
        success: false,
        message: `后端缺少必要配置：${label}`,
      });
      return;
    }

    if (!secureEqual(readHeader(req, headerName), configuredKey)) {
      res.status(401).json({
        success: false,
        message: '后端拒绝访问，请检查应用访问密钥',
      });
      return;
    }

    next();
  };
};

const getRateLimitAddress = (req: Request): string => {
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const isLoopback =
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1';

  if (isLoopback) {
    const realIp = readHeader(req, 'x-real-ip');
    if (realIp) {
      return realIp;
    }

    const forwardedFor = readHeader(req, 'x-forwarded-for').split(',')[0]?.trim();
    if (forwardedFor) {
      return forwardedFor;
    }
  }

  return remoteAddress;
};

const createRateLimiter = (
  scope: string,
  maxRequests: number,
  windowMs: number
): RequestHandler => {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${scope}:${getRateLimitAddress(req)}`;
    const current = rateLimitEntries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count - 1)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count >= maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
      });
      return;
    }

    entry.count += 1;
    rateLimitEntries.set(key, entry);
    next();
  };
};

const requireBackendAdminKey = requireKey(
  backendAdminKey,
  'x-backend-admin-key',
  'BACKEND_ADMIN_KEY'
);
const requireBackendAccessKey = requireKey(
  backendAccessKey,
  'x-backend-access-key',
  'BACKEND_ACCESS_KEY'
);
const requireCozeProxyClientAccessKey = requireKey(
  cozeProxyClientAccessKey,
  'x-backend-access-key',
  'COZE_PROXY_CLIENT_ACCESS_KEY'
);
const businessRateLimiter = createRateLimiter('business', 120, 60_000);
const cozeKeylessRateLimiter = createRateLimiter(
  'coze-keyless-business',
  cozeKeylessRateLimitMax,
  cozeKeylessRateLimitWindowMs
);
const adminRateLimiter = createRateLimiter('admin', 20, 15 * 60_000);
const messageRateLimiter = createRateLimiter('message', 300, 15 * 60_000);
const uploadRateLimiter = createRateLimiter('upload', 30, 60 * 60_000);

const cleanupRateLimitEntries = setInterval(() => {
  const now = Date.now();
  rateLimitEntries.forEach((entry, key) => {
    if (entry.resetAt <= now) {
      rateLimitEntries.delete(key);
    }
  });
}, 5 * 60_000);
cleanupRateLimitEntries.unref();

const isLocalhostOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
      (url.protocol === 'http:' || url.protocol === 'https:')
    );
  } catch {
    return false;
  }
};

const isCozeOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (hostname === 'coze.site' ||
        hostname.endsWith('.coze.site') ||
        hostname === 'coze.cn' ||
        hostname.endsWith('.coze.cn'))
    );
  } catch {
    return false;
  }
};

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowLocalhostCors && isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    if (allowCozeCors && isCozeOrigin(origin)) {
      callback(null, true);
      return;
    }

    if (configuredCorsOrigins.length === 0) {
      callback(null, process.env.NODE_ENV !== 'production');
      return;
    }

    callback(null, configuredCorsOrigins.includes(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'X-Backend-Access-Key',
    'X-Backend-Admin-Key',
    'X-Chanjet-Open-Token',
    'X-Chanjet-Sid',
    'X-Erp-Account-Key',
    'X-Erp-Cache-Mode',
  ],
  exposedHeaders: [
    'RateLimit-Remaining',
    'Server-Timing',
    'X-Cache',
    'X-Erp-Account-Key',
    'X-Proxy-Auth-Mode',
    'X-Proxy-Network-Mode',
  ],
};

class ProxyRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_ERP_PROXY_BODY_BYTES = 5 * 1024 * 1024;

const readProxyRequestBody = async (req: Request): Promise<Buffer | undefined> => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }

  const declaredLength = Number(readHeader(req, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ERP_PROXY_BODY_BYTES) {
    throw new ProxyRequestError('ERP代理请求内容过大', 413);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_ERP_PROXY_BODY_BYTES) {
      throw new ProxyRequestError('ERP代理请求内容过大', 413);
    }
    chunks.push(buffer);
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const proxyCozeErpRequest = async (
  req: Request,
  res: Response,
  downstreamPath: string,
  accountKey: ErpAccountKey,
  proxyTarget: string
): Promise<void> => {
  const requestStartedAt = Date.now();
  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableFinished) controller.abort();
  };
  req.once('aborted', abortUpstream);
  res.once('close', abortUpstream);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(erpProxyTimeoutMs)]);
  try {
    const body = await readProxyRequestBody(req);
    signal.throwIfAborted();
    res.setHeader('X-Erp-Account-Key', accountKey);
    const headers = new Headers();
    Object.entries(req.headers).forEach(([name, value]) => {
      const normalizedName = name.toLowerCase();
      if (
        normalizedName === 'host' ||
        normalizedName === 'connection' ||
        normalizedName === 'content-length' ||
        normalizedName === 'origin' ||
        normalizedName === 'referer' ||
        normalizedName === 'transfer-encoding' ||
        normalizedName.startsWith('access-control-') ||
        normalizedName.startsWith('sec-')
      ) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => headers.append(name, item));
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    });

    const proxyAccessKey = cozeErpProxyAccessKeys[accountKey];
    if (proxyAccessKey) {
      headers.set('x-backend-access-key', proxyAccessKey);
    } else {
      headers.delete('x-backend-access-key');
    }
    headers.set(ERP_ACCOUNT_HEADER, accountKey);

    const upstreamResult = await fetchProxyUpstream(
      `${proxyTarget}${downstreamPath}`,
      req.method,
      headers,
      body,
      cozeErpProxyAddresses[accountKey],
      signal
    );
    const upstreamResponse = upstreamResult.response;
    res.setHeader(
      'X-Proxy-Network-Mode',
      upstreamResult.usedAddressFallback ? 'configured-address' : 'dns'
    );

    // 复制响应头
    ['cache-control', 'content-disposition', 'content-type', 'x-cache', 'ratelimit-limit',
      'ratelimit-remaining', 'ratelimit-reset'].forEach((name) => {
      const value = upstreamResponse.headers.get(name);
      if (value) {
        res.setHeader(name, value);
      }
    });

    const upstreamTiming = upstreamResponse.headers.get('server-timing');
    res.setHeader('Server-Timing', [
      upstreamTiming,
      `erp-proxy;dur=${Date.now() - requestStartedAt}`,
    ].filter(Boolean).join(', '));

    // Cache ownership stays with the ERP service; proxies never restart its TTL.
    res.status(upstreamResponse.status);
    if (upstreamResponse.body) {
      const reader = upstreamResponse.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          signal.throwIfAborted();
          if (!res.write(Buffer.from(value))) {
            await new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                res.off('drain', onDrain);
                signal.removeEventListener('abort', onAbort);
              };
              const onDrain = () => { cleanup(); resolve(); };
              const onAbort = () => { cleanup(); reject(signal.reason); };
              res.once('drain', onDrain);
              signal.addEventListener('abort', onAbort, { once: true });
              if (signal.aborted) onAbort();
            });
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    res.end();
  } catch (error) {
    console.error(
      '[Coze ERP proxy] request failed:',
      error instanceof Error ? error.message : error
    );
    if (res.destroyed) return;
    if (!res.headersSent) {
      const statusCode = error instanceof ProxyRequestError ? error.statusCode : 502;
      res.status(statusCode).json({
        success: false,
        message:
          error instanceof ProxyRequestError || error instanceof ErpProxyConnectionError
            ? error.message
            : 'ERP代理请求失败，请检查后端服务',
      });
    } else {
      res.end();
    }
  } finally {
    req.off('aborted', abortUpstream);
    res.off('close', abortUpstream);
  }
};

const rawExcelParser = express.raw({
  type: Array.from(allowedUploadContentTypes),
  limit: '50mb',
});

const getProxyPathname = (downstreamPath: string): string => {
  try {
    return new URL(downstreamPath, 'http://erp-proxy.local').pathname;
  } catch {
    return downstreamPath.split('?')[0] || '/';
  }
};

const guardAndProxyCozeErpRequest = (
  req: Request,
  res: Response,
  downstreamPath: string,
  accountKey: ErpAccountKey,
  proxyTarget: string,
  isPrefixedCozePath: boolean
): void => {
  const pathname = getProxyPathname(downstreamPath);
  const forwardRequest = () => {
    void proxyCozeErpRequest(req, res, downstreamPath, accountKey, proxyTarget);
  };
  const isMessageCallback =
    pathname === '/api/erp/messages' ||
    pathname === '/api/erp/chanjet/messages';
  if (isMessageCallback) {
    messageRateLimiter(req, res, forwardRequest);
    return;
  }

  const isAuthPath =
    pathname === '/api/erp/auth' || pathname.startsWith('/api/erp/auth/');
  if (isAuthPath) {
    adminRateLimiter(req, res, () => {
      if (req.method === 'GET' && pathname === '/api/erp/auth/callback') {
        forwardRequest();
        return;
      }
      requireBackendAdminKey(req, res, forwardRequest);
    });
    return;
  }

  const applyBusinessRateLimit = () => {
    businessRateLimiter(req, res, forwardRequest);
  };

  if (!isPrefixedCozePath) {
    requireBackendAccessKey(req, res, applyBusinessRateLimit);
    return;
  }

  if (cozeProxyClientAccessKey) {
    requireCozeProxyClientAccessKey(req, res, applyBusinessRateLimit);
    return;
  }

  const isLocalStatePath =
    pathname === '/api/erp/health' ||
    pathname === '/api/erp/messages/latest' ||
    pathname === '/api/erp/tplus/purchase-receive/statuses';
  if (allowCozeKeylessCompatibility && isLocalStatePath) {
    res.setHeader('X-Proxy-Auth-Mode', 'coze-keyless-local-state');
    applyBusinessRateLimit();
    return;
  }

  if (allowCozeKeylessCompatibility) {
    res.setHeader('X-Proxy-Auth-Mode', 'coze-keyless-rate-limited');
    cozeKeylessRateLimiter(req, res, applyBusinessRateLimit);
    return;
  }

  res.status(503).json({
    success: false,
    message:
      '扣子代理访问密钥未配置；无密钥访问仅允许使用扣子兼容接口路径',
  });
};

const sendPublicPage = (
  res: Response,
  html: string,
  frameAncestors = "'none'",
  cacheControl = 'public, max-age=300'
): void => {
  if (frameAncestors !== "'none'") {
    res.removeHeader('X-Frame-Options');
  }
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors ${frameAncestors}; form-action 'none'`
  );
  res.setHeader('Cache-Control', cacheControl);
  res.status(200).type('html').send(html);
};

app.get('/', (_req, res) => sendPublicPage(res, HOME_PAGE_HTML));
app.get(['/privacy', '/privacy-policy'], (_req, res) =>
  sendPublicPage(
    res,
    PRIVACY_POLICY_HTML,
    "'self' https: http://localhost:* http://127.0.0.1:*",
    'no-store'
  )
);

app.use(cors(corsOptions));
app.use((req, res, next) => {
  const isCozeErpProxyPath =
    req.url.startsWith(`${cozeErpProxyPrefix}/api/erp/`) ||
    req.url.startsWith(`${cozeErpProxyPrefix}/tplus/api/v2/`);
  const isDirectErpProxyPath =
    shouldProxyCozeErp &&
    (req.url.startsWith('/api/erp/') || req.url.startsWith('/tplus/api/v2/'));

  if (!isCozeErpProxyPath && !isDirectErpProxyPath) {
    next();
    return;
  }

  const accountKey = readRequestedErpAccountKey(req);
  if (!accountKey) {
    res.status(400).json({
      success: false,
      message: `ERP账套标识无效：${ERP_ACCOUNT_HEADER}`,
    });
    return;
  }

  const downstreamPath = isCozeErpProxyPath
    ? req.url.slice(cozeErpProxyPrefix.length)
    : req.url;
  if (!shouldProxyCozeErp) {
    if (accountKey !== localErpAccountKey) {
      res.status(409).json({
        success: false,
        message: `ERP账套不匹配：当前服务器属于${SERVER_ERP_ACCOUNTS[localErpAccountKey].displayName}`,
      });
      return;
    }
    req.url = downstreamPath;
    next();
    return;
  }

  const proxyTarget = cozeErpProxyTargets[accountKey];
  if (!proxyTarget) {
    res.status(503).json({
      success: false,
      message: `${SERVER_ERP_ACCOUNTS[accountKey].displayName} ERP后端尚未配置`,
    });
    return;
  }

  guardAndProxyCozeErpRequest(
    req,
    res,
    downstreamPath,
    accountKey,
    proxyTarget,
    isCozeErpProxyPath
  );
});
app.use(['/api/erp/messages', '/api/erp/chanjet/messages'], messageRateLimiter);
app.use('/api/erp/auth', adminRateLimiter, (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' && req.path === '/callback') {
    next();
    return;
  }

  requireBackendAdminKey(req, res, next);
});
app.use(
  ['/api/erp/health', '/api/erp/messages/latest', '/api/erp/tplus', '/tplus/api/v2'],
  requireBackendAccessKey,
  (req: Request, res: Response, next: NextFunction) => {
    const accountKey = readRequestedErpAccountKey(req);
    if (!accountKey) {
      res.status(400).json({
        success: false,
        message: `ERP账套标识无效：${ERP_ACCOUNT_HEADER}`,
      });
      return;
    }
    if (!shouldProxyCozeErp && accountKey !== localErpAccountKey) {
      res.status(409).json({
        success: false,
        message: `ERP账套不匹配：当前服务器属于${SERVER_ERP_ACCOUNTS[localErpAccountKey].displayName}`,
      });
      return;
    }
    res.setHeader('X-Erp-Account-Key', accountKey);
    next();
  },
  businessRateLimiter
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

registerErpRoutes(app, { enableTokenMaintenance: !shouldProxyCozeErp });

const sanitizeFileName = (value?: string) => {
  if (!value) {
    return '';
  }

  return Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
};

const sanitizeSegment = (value?: string) => {
  return sanitizeFileName(value).replace(/\s+/g, '');
};

const buildFileName = (prefix: string, nameSuffix?: string, exactFileName?: string) => {
  const sanitizedFileName = sanitizeFileName(exactFileName);
  if (sanitizedFileName) {
    return sanitizedFileName.toLowerCase().endsWith('.xlsx')
      ? `${sanitizedFileName.slice(0, -5)}.xlsx`
      : `${sanitizedFileName}.xlsx`;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = sanitizeSegment(nameSuffix);
  return suffix ? `${prefix}_${suffix}_${timestamp}.xlsx` : `${prefix}_${timestamp}.xlsx`;
};

const getRawBody = (body: Request['body']): Buffer | null => {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  return null;
};

const hasAllowedContentType = (contentTypeHeader?: string): boolean => {
  if (!contentTypeHeader) {
    return false;
  }

  const contentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase();
  return allowedUploadContentTypes.has(contentType);
};

const hasZipSignature = (rawBody: Buffer): boolean => {
  if (rawBody.length < 4) {
    return false;
  }

  const signatures = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ];

  return signatures.some((signature) => rawBody.subarray(0, 4).equals(signature));
};

const XLSX_REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
];

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const MAX_XLSX_CENTRAL_DIRECTORY_SIZE = 2 * 1024 * 1024;
const MAX_XLSX_CENTRAL_DIRECTORY_ENTRIES = 1024;
const MAX_XLSX_XML_ENTRY_COMPRESSED_SIZE = 256 * 1024;
const MAX_XLSX_XML_ENTRY_UNCOMPRESSED_SIZE = 512 * 1024;

type ZipEntryMetadata = {
  compressedSize: number;
  compressionMethod: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

const findEndOfCentralDirectoryOffset = (rawBody: Buffer): number => {
  const searchStart = Math.max(
    0,
    rawBody.length - ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH - ZIP_MAX_COMMENT_LENGTH
  );

  for (
    let offset = rawBody.length - ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH;
    offset >= searchStart;
    offset -= 1
  ) {
    if (rawBody.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return -1;
};

const parseZipCentralDirectory = (rawBody: Buffer): Map<string, ZipEntryMetadata> | null => {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectoryOffset(rawBody);
  if (endOfCentralDirectoryOffset < 0) {
    return null;
  }

  const entryCount = rawBody.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectorySize = rawBody.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = rawBody.readUInt32LE(endOfCentralDirectoryOffset + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    return null;
  }

  if (
    entryCount === 0 ||
    entryCount > MAX_XLSX_CENTRAL_DIRECTORY_ENTRIES ||
    centralDirectorySize === 0 ||
    centralDirectorySize > MAX_XLSX_CENTRAL_DIRECTORY_SIZE
  ) {
    return null;
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset < 0 ||
    centralDirectoryOffset >= rawBody.length ||
    centralDirectoryEnd > rawBody.length
  ) {
    return null;
  }

  const entries = new Map<string, ZipEntryMetadata>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd) {
      return null;
    }

    if (rawBody.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      return null;
    }

    const flags = rawBody.readUInt16LE(cursor + 8);
    const compressionMethod = rawBody.readUInt16LE(cursor + 10);
    const compressedSize = rawBody.readUInt32LE(cursor + 20);
    const uncompressedSize = rawBody.readUInt32LE(cursor + 24);
    const fileNameLength = rawBody.readUInt16LE(cursor + 28);
    const extraFieldLength = rawBody.readUInt16LE(cursor + 30);
    const commentLength = rawBody.readUInt16LE(cursor + 32);
    const localHeaderOffset = rawBody.readUInt32LE(cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > centralDirectoryEnd) {
      return null;
    }

    const name = rawBody.toString('utf8', fileNameStart, fileNameEnd);
    entries.set(name, {
      compressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    });

    cursor = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
};

const extractZipEntryText = (
  rawBody: Buffer,
  entry: ZipEntryMetadata
): string | null => {
  if (entry.flags & 0x1) {
    return null;
  }

  if (
    entry.compressedSize > MAX_XLSX_XML_ENTRY_COMPRESSED_SIZE ||
    entry.uncompressedSize > MAX_XLSX_XML_ENTRY_UNCOMPRESSED_SIZE
  ) {
    return null;
  }

  if (entry.localHeaderOffset + 30 > rawBody.length) {
    return null;
  }

  if (rawBody.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    return null;
  }

  const localFileNameLength = rawBody.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraFieldLength = rawBody.readUInt16LE(entry.localHeaderOffset + 28);
  const payloadStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const payloadEnd = payloadStart + entry.compressedSize;

  if (payloadEnd > rawBody.length) {
    return null;
  }

  const payload = rawBody.subarray(payloadStart, payloadEnd);

  try {
    if (entry.compressionMethod === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        return null;
      }
      return strFromU8(payload);
    }

    if (entry.compressionMethod === 8) {
      const inflated = inflateSync(new Uint8Array(payload), {
        out: new Uint8Array(entry.uncompressedSize),
      });
      return strFromU8(inflated);
    }

    return null;
  } catch (error) {
    console.error(`[xlsx] 解压条目失败: ${entry.name}`, error);
    return null;
  }
};

const hasValidXlsxSignature = (rawBody: Buffer): boolean => {
  if (!hasZipSignature(rawBody)) {
    return false;
  }

  try {
    const archiveEntries = parseZipCentralDirectory(rawBody);
    if (!archiveEntries) {
      return false;
    }

    const requiredEntries = XLSX_REQUIRED_ENTRIES.map((entryName) => archiveEntries.get(entryName));
    if (requiredEntries.some((entry) => !entry)) {
      return false;
    }

    const contentTypesXml = extractZipEntryText(rawBody, requiredEntries[0]!);
    const rootRelationshipsXml = extractZipEntryText(rawBody, requiredEntries[1]!);
    const workbookXml = extractZipEntryText(rawBody, requiredEntries[2]!);

    if (!contentTypesXml || !rootRelationshipsXml || !workbookXml) {
      return false;
    }

    return (
      contentTypesXml.includes('<Types') &&
      contentTypesXml.includes('/xl/workbook.xml') &&
      rootRelationshipsXml.includes('<Relationships') &&
      rootRelationshipsXml.includes('officeDocument') &&
      rootRelationshipsXml.includes('xl/workbook.xml') &&
      workbookXml.includes('<workbook')
    );
  } catch (error) {
    console.error('[xlsx] 文件结构校验失败:', error);
    return false;
  }
};

const handleExcelUpload =
  (prefix: string, successMessage: string) => async (req: Request, res: Response) => {
    try {
      const contentTypeHeader = req.headers['content-type'];
      const normalizedContentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : contentTypeHeader;

      if (!hasAllowedContentType(normalizedContentType)) {
        res.status(415).json({
          success: false,
          message: '仅支持上传 Excel 文件',
        });
        return;
      }

      const rawBody = getRawBody(req.body);

      if (!rawBody || rawBody.length === 0) {
        res.status(400).json({
          success: false,
          message: '上传内容为空',
        });
        return;
      }

      if (!hasValidXlsxSignature(rawBody)) {
        res.status(400).json({
          success: false,
          message: '文件内容不是有效的 Excel xlsx 文件',
        });
        return;
      }

      await mkdir(uploadDir, { recursive: true });

      const nameSuffix =
        typeof req.query.name_suffix === 'string' ? req.query.name_suffix : undefined;
      const exactFileName =
        typeof req.query.file_name === 'string' ? req.query.file_name : undefined;
      const fileName = buildFileName(prefix, nameSuffix, exactFileName);
      const filePath = path.join(uploadDir, fileName);

      await writeFile(filePath, rawBody);

      res.status(200).json({
        success: true,
        message: successMessage,
        fileName,
        count: 1,
      });
    } catch (error) {
      console.error(`[${prefix}] 上传失败:`, error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : '服务器处理失败',
      });
    }
  };

const handleServiceHealth: RequestHandler = (_req, res) => {
  const proxyAccounts = shouldProxyCozeErp
    ? Object.entries(cozeErpProxyTargets)
        .filter(([, target]) => Boolean(target))
        .map(([accountKey]) => accountKey)
    : [];
  const proxyAddressFallbackAccounts = shouldProxyCozeErp
    ? Object.entries(cozeErpProxyAddresses)
        .filter(([, address]) => Boolean(address))
        .map(([accountKey]) => accountKey)
    : [];

  res.status(200).json({
    success: true,
    status: 'ok',
    backendRelease: SERVER_RELEASE,
    host,
    port,
    deploymentMode: shouldProxyCozeErp ? 'erp-proxy' : 'erp-account',
    accountKey: shouldProxyCozeErp ? undefined : localErpAccountKey,
    accountName: shouldProxyCozeErp
      ? undefined
      : SERVER_ERP_ACCOUNTS[localErpAccountKey].displayName,
    proxyAccounts,
    proxyAddressFallbackAccounts,
  });
};

app.get('/health', handleServiceHealth);
app.get('/api/v1/health', handleServiceHealth);

app.post('/inbound', uploadRateLimiter, requireBackendAccessKey, rawExcelParser, handleExcelUpload('inbound', '入库数据同步成功'));
app.post('/outbound', uploadRateLimiter, requireBackendAccessKey, rawExcelParser, handleExcelUpload('outbound', '出库数据同步成功'));
app.post('/inventory', uploadRateLimiter, requireBackendAccessKey, rawExcelParser, handleExcelUpload('inventory', '盘点数据同步成功'));
app.post('/labels', uploadRateLimiter, requireBackendAccessKey, rawExcelParser, handleExcelUpload('labels', '标签数据同步成功'));
app.post('/materials', uploadRateLimiter, requireBackendAccessKey, rawExcelParser, handleExcelUpload('materials', '物料数据同步成功'));

app.listen(port, host, () => {
  console.log(`Server listening at http://${host}:${port}/`);
  if (shouldProxyCozeErp) {
    const configuredAccounts = Object.entries(cozeErpProxyTargets)
      .filter(([, target]) => Boolean(target))
      .map(([accountKey]) => accountKey)
      .join(', ');
    const configuredAddressFallbackAccounts = Object.entries(cozeErpProxyAddresses)
      .filter(([, address]) => Boolean(address))
      .map(([accountKey]) => accountKey)
      .join(', ');
    console.log(`[ERP deployment] mode=proxy accounts=${configuredAccounts || 'none'}`);
    console.log(
      `[ERP proxy network] address-fallback-accounts=${configuredAddressFallbackAccounts || 'none'}`
    );
    console.log(
      `[ERP proxy access] mode=${
        cozeProxyClientAccessKey
          ? 'access-key'
          : allowCozeKeylessCompatibility
            ? 'coze-keyless-rate-limited'
            : 'blocked'
      }`
    );
    return;
  }

  console.log(
    `[ERP deployment] mode=account account=${localErpAccountKey} name=${SERVER_ERP_ACCOUNTS[localErpAccountKey].displayName}`
  );
  if (hasLocalChanjetCredentials && !process.env.CHANJET_LOCAL_ACCOUNT_KEY?.trim()) {
    console.warn(
      '[ERP deployment] CHANJET_LOCAL_ACCOUNT_KEY is not set; using the legacy Wuxi default.'
    );
  }
});
