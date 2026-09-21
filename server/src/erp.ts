import { createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import {
  DEFAULT_ERP_ACCOUNT_KEY,
  parseErpAccountKey,
  resolveErpAccountKey,
} from './erpAccounts.ts';
import { SERVER_RELEASE } from './release.ts';
import { canReuseErpConnection, requestErpRead, type ErpHttpResponse } from './erpHttp.ts';

const DEFAULT_OPENAPI_BASE_URL = 'https://openapi.chanjet.com';
const DEFAULT_MARKET_BASE_URL = 'https://market.chanjet.com';
const DEFAULT_SCOPE = 'auth_all';
const DEFAULT_APP_NAME = 'tpluscloud';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_OPEN_TOKEN_LIFETIME_MS = 6 * DAY_MS;
const REFRESH_TOKEN_LIFETIME_MS = 29 * DAY_MS;
const DEFAULT_TOKEN_REFRESH_LEAD_MS = DAY_MS;
const DEFAULT_TOKEN_REFRESH_MAX_AGE_MS = 5 * DAY_MS;
const DEFAULT_TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_START_DELAY_MS = 3 * 1000;
const TOKEN_REFRESH_LOCK_STALE_MS = 2 * 60 * 1000;
const TOKEN_REFRESH_LOCK_WAIT_MS = 25 * 1000;
const TOKEN_REFRESH_LOCK_RETRY_MS = 250;
const MAX_PURCHASE_RECEIVE_STATUS_COUNT = 1000;
const TPLUS_RESPONSE_CACHE_MAX = 200;
const TPLUS_CACHE_TTL_BY_PATH = new Map<string, number>([
  ['/tplus/api/v2/currentStock/Query', 15 * 1000],
  ['/tplus/api/v2/SaleDispatchOpenApi/GetVoucherDTO', 5 * 60 * 1000],
  ['/tplus/api/v2/PurchaseReceiveOpenApi/FindVoucherList', 30 * 1000],
  ['/tplus/api/v2/PurchaseReceiveOpenApi/GetVoucherDTO', 5 * 60 * 1000],
]);

const getLocalErpAccountKey = () =>
  resolveErpAccountKey(
    process.env.CHANJET_LOCAL_ACCOUNT_KEY,
    DEFAULT_ERP_ACCOUNT_KEY,
    'CHANJET_LOCAL_ACCOUNT_KEY'
  );

type JsonObject = Record<string, unknown>;
type HttpMethod = 'GET' | 'POST';
type ChanjetMessage = JsonObject & {
  bizContent?: JsonObject;
  id?: string;
  msgType?: string;
  orgId?: string;
  requestId?: string;
  time?: string;
};
type PurchaseReceiveVoucherStatus = {
  eventId?: string;
  messageTime?: string;
  orgId?: string;
  receivedAt: string;
  status: 'audited' | 'unaudited';
  voucherCode: string;
  voucherDate?: string;
  voucherId?: string;
};
export type ChanjetState = {
  accountKey?: string;
  appTicket?: string;
  appTicketReceivedAt?: string;
  lastMessageId?: string;
  lastMessageReceivedAt?: string;
  lastMessageTime?: string;
  lastMessageType?: string;
  openToken?: string;
  openTokenReceivedAt?: string;
  pendingOAuthReturnState?: string;
  pendingOAuthStateExpiresAt?: string;
  pendingOAuthStateHash?: string;
  purchaseReceiveVoucherStatuses?: Record<string, PurchaseReceiveVoucherStatus>;
  refreshToken?: string;
  refreshTokenExpiresIn?: unknown;
  refreshTokenReceivedAt?: string;
  lastTokenRefreshAttemptAt?: string;
  lastTokenRefreshError?: string;
  lastTokenRefreshErrorAt?: string;
  lastTokenRefreshReason?: string;
  lastTokenRefreshSucceededAt?: string;
  tokenExpiresIn?: unknown;
  tokenOrgId?: unknown;
  tokenUserId?: unknown;
};

type TokenPersistSource = 'authorization-code' | 'refresh-token' | 'self-built';
type TokenRefreshResult = {
  dueAt?: number;
  refreshed: boolean;
  state: ChanjetState;
};

class ErpConfigurationError extends Error {
  statusCode = 500;
}

class ErpInputError extends Error {
  statusCode = 400;
}

class ChanjetHttpError extends Error {
  readonly details: unknown;
  readonly statusCode: number;
  readonly failure?: { source: 'http' | 'network' | 'timeout' | 'protocol'; code?: string; requestId?: string; attempt?: number };

  constructor(message: string, statusCode: number, details: unknown,
    failure?: ChanjetHttpError['failure']) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.failure = failure;
  }
}

type ChanjetRequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  reuseConnection?: boolean;
  requestId?: string;
};

type AsyncRoute = (req: Request, res: Response) => Promise<void> | void;
type TplusCacheEntry = {
  data: unknown;
  expiresAt: number;
};

const tplusResponseCache = new Map<string, TplusCacheEntry>();
const pendingTplusRequests = new Map<string, Promise<unknown>>();
const latestTplusRequests = new Map<string, Promise<unknown>>();

const trimEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const readBoundedNumberEnv = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const configured = Number(trimEnv(name));
  return Number.isFinite(configured) && configured >= minimum && configured <= maximum
    ? configured
    : fallback;
};

const isTokenAutoRefreshEnabled = (): boolean =>
  trimEnv('CHANJET_AUTO_REFRESH_ENABLED')?.toLowerCase() !== 'false';

const getTokenRefreshLeadMs = (): number =>
  readBoundedNumberEnv(
    'CHANJET_AUTO_REFRESH_LEAD_HOURS',
    DEFAULT_TOKEN_REFRESH_LEAD_MS / (60 * 60 * 1000),
    1,
    120
  ) *
  60 *
  60 *
  1000;

const getTokenRefreshMaxAgeMs = (): number =>
  readBoundedNumberEnv(
    'CHANJET_AUTO_REFRESH_MAX_AGE_HOURS',
    DEFAULT_TOKEN_REFRESH_MAX_AGE_MS / (60 * 60 * 1000),
    24,
    24 * 20
  ) *
  60 *
  60 *
  1000;

const getTokenRefreshCheckIntervalMs = (): number =>
  readBoundedNumberEnv(
    'CHANJET_AUTO_REFRESH_CHECK_MINUTES',
    DEFAULT_TOKEN_REFRESH_CHECK_INTERVAL_MS / (60 * 1000),
    5,
    24 * 60
  ) *
  60 *
  1000;

const getChanjetConnectTimeoutSeconds = (): number =>
  readBoundedNumberEnv('CHANJET_HTTP_CONNECT_TIMEOUT_SECONDS', 5, 2, 15);

const getChanjetRequestTimeoutSeconds = (): number =>
  readBoundedNumberEnv('CHANJET_HTTP_TIMEOUT_SECONDS', 18, 5, 20);

const normalizeBaseUrl = (value: string): string => {
  return value.endsWith('/') ? value : `${value}/`;
};

const getOpenApiBaseUrl = (): string => {
  return normalizeBaseUrl(trimEnv('CHANJET_OPENAPI_BASE_URL') || DEFAULT_OPENAPI_BASE_URL);
};

const getMarketBaseUrl = (): string => {
  return normalizeBaseUrl(trimEnv('CHANJET_MARKET_BASE_URL') || DEFAULT_MARKET_BASE_URL);
};

const getPublicBaseUrl = (): string | undefined => {
  const configuredBaseUrl = trimEnv('CHANJET_PUBLIC_BASE_URL');
  if (!configuredBaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(configuredBaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('不支持的地址协议');
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new ErpConfigurationError(
      'CHANJET_PUBLIC_BASE_URL 必须是完整的 HTTP 或 HTTPS 地址'
    );
  }
};

const getRedirectUri = (): string | undefined => {
  const configuredRedirectUri = trimEnv('CHANJET_REDIRECT_URI');
  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  const publicBaseUrl = getPublicBaseUrl();
  return publicBaseUrl
    ? new URL('/api/erp/auth/callback', `${publicBaseUrl}/`).toString()
    : undefined;
};

const getDefaultAppName = (): string => {
  return trimEnv('CHANJET_APP_NAME') || DEFAULT_APP_NAME;
};

const getDefaultScope = (): string => {
  return trimEnv('CHANJET_SCOPE') || DEFAULT_SCOPE;
};

const getConfiguredAppKey = (): string | undefined => {
  return trimEnv('CHANJET_APP_KEY');
};

const getAppKey = (): string => {
  const appKey = getConfiguredAppKey();

  if (!appKey) {
    throw new ErpConfigurationError('后端缺少 CHANJET_APP_KEY 配置');
  }

  return appKey;
};

const getAppCredentials = (): { appKey: string; appSecret: string } => {
  const appKey = getAppKey();
  const appSecret = trimEnv('CHANJET_APP_SECRET');

  if (!appSecret) {
    throw new ErpConfigurationError('后端缺少 CHANJET_APP_SECRET 配置');
  }

  return { appKey, appSecret };
};

const getStatePath = (): string => {
  const stateRoot = trimEnv('CHANJET_STATE_DIR') || path.resolve(process.cwd(), 'sync-data');
  return path.join(stateRoot, getLocalErpAccountKey(), 'chanjet-state.json');
};

const getLegacyStatePath = (): string => {
  const stateRoot = trimEnv('CHANJET_STATE_DIR') || path.resolve(process.cwd(), 'sync-data');
  return path.join(stateRoot, 'chanjet-state.json');
};

const isObject = (value: unknown): value is JsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const readObjectBody = (req: Request): JsonObject => {
  if (!isObject(req.body)) {
    throw new ErpInputError('请求内容必须是 JSON 对象');
  }

  return req.body;
};

const requireString = (source: JsonObject, fieldName: string): string => {
  const value = source[fieldName];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ErpInputError(`缺少必填字段：${fieldName}`);
  }

  return value.trim();
};

const optionalString = (source: JsonObject, fieldName: string): string | undefined => {
  const value = source[fieldName];

  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim() || undefined;
};

const isFileNotFoundError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isFileExistsError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const readStateFile = async (statePath: string): Promise<ChanjetState> => {
  const text = await readFile(statePath, 'utf8');
  const payload: unknown = JSON.parse(text);
  if (!isObject(payload)) {
    throw new Error(`畅捷通状态文件格式无效：${statePath}`);
  }
  return payload;
};

const assertStateAccount = (state: ChanjetState, statePath: string): ChanjetState => {
  const savedAccountKey = state.accountKey?.trim();
  if (!savedAccountKey) {
    return state;
  }

  const parsedAccountKey = parseErpAccountKey(savedAccountKey);
  if (!parsedAccountKey) {
    throw new ErpConfigurationError(`状态文件中的ERP账套标识无效：${statePath}`);
  }

  if (parsedAccountKey !== getLocalErpAccountKey()) {
    throw new ErpConfigurationError(`ERP状态文件属于其他账套：${statePath}`);
  }

  return state;
};

const readChanjetState = async (): Promise<ChanjetState> => {
  const statePath = getStatePath();
  try {
    return assertStateAccount(await readStateFile(statePath), statePath);
  } catch (error) {
    const backupPath = `${statePath}.bak`;
    try {
      const backupState = assertStateAccount(await readStateFile(backupPath), backupPath);
      console.warn('[erp-state] Primary state is unavailable; using the last valid backup.');
      return backupState;
    } catch (backupError) {
      if (isFileNotFoundError(error) && isFileNotFoundError(backupError)) {
        const legacyStatePath = getLegacyStatePath();
        if (getLocalErpAccountKey() === DEFAULT_ERP_ACCOUNT_KEY && legacyStatePath !== statePath) {
          try {
            const legacyState = assertStateAccount(
              await readStateFile(legacyStatePath),
              legacyStatePath
            );
            console.warn(
              '[erp-state] Using legacy shared state once; the next state update will migrate it.'
            );
            return legacyState;
          } catch (legacyError) {
            if (!isFileNotFoundError(legacyError)) {
              throw legacyError;
            }
          }
        }

        return {};
      }

      throw error;
    }
  }
};

const writeChanjetState = async (state: ChanjetState): Promise<void> => {
  const statePath = getStatePath();
  const backupPath = `${statePath}.bak`;
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(statePath), { recursive: true });

  try {
    try {
      await readStateFile(statePath);
      await copyFile(statePath, backupPath);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        console.warn('[erp-state] Primary state is invalid; keeping the existing backup.');
      }
    }

    const stateWithAccount = {
      ...state,
      accountKey: getLocalErpAccountKey(),
    };
    await writeFile(temporaryPath, `${JSON.stringify(stateWithAccount, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o640,
    });
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

let chanjetStateUpdateQueue: Promise<void> = Promise.resolve();

const updateChanjetState = (
  patchOrFactory: ChanjetState | ((current: ChanjetState) => ChanjetState)
): Promise<ChanjetState> => {
  const update = chanjetStateUpdateQueue.then(async () => {
    const current = await readChanjetState();
    const patch = typeof patchOrFactory === 'function' ? patchOrFactory(current) : patchOrFactory;
    const state = {
      ...current,
      ...patch,
    };
    await writeChanjetState(state);
    return state;
  });

  chanjetStateUpdateQueue = update.then(
    () => undefined,
    () => undefined
  );
  return update;
};

type OAuthStateChallenge = {
  expiresAt: string;
  hash: string;
  value: string;
};

const hashOAuthState = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const createOAuthStateChallenge = (now = Date.now()): OAuthStateChallenge => {
  const value = randomBytes(32).toString('base64url');
  return {
    expiresAt: new Date(now + OAUTH_STATE_TTL_MS).toISOString(),
    hash: hashOAuthState(value),
    value,
  };
};

export const isOAuthStateChallengeValid = (
  value: string | undefined,
  expectedHash: string | undefined,
  expiresAt: string | undefined,
  now = Date.now()
): boolean => {
  if (!value || !expectedHash || !expiresAt || Date.parse(expiresAt) <= now) {
    return false;
  }

  const actual = Buffer.from(hashOAuthState(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const issueOAuthState = async (returnState?: string): Promise<string> => {
  const challenge = createOAuthStateChallenge();
  await updateChanjetState({
    pendingOAuthReturnState: returnState,
    pendingOAuthStateExpiresAt: challenge.expiresAt,
    pendingOAuthStateHash: challenge.hash,
  });
  return challenge.value;
};

const consumeOAuthState = async (value: string | undefined): Promise<string | undefined> => {
  let returnState: string | undefined;
  await updateChanjetState((current) => {
    if (
      !isOAuthStateChallengeValid(
        value,
        current.pendingOAuthStateHash,
        current.pendingOAuthStateExpiresAt
      )
    ) {
      throw new ErpInputError('授权 state 无效或已过期，请重新生成授权地址');
    }

    returnState = current.pendingOAuthReturnState;
    return {
      ...current,
      pendingOAuthReturnState: undefined,
      pendingOAuthStateExpiresAt: undefined,
      pendingOAuthStateHash: undefined,
    };
  });
  return returnState;
};

const acquireTokenRefreshFileLock = async (): Promise<() => Promise<void>> => {
  const lockPath = `${getStatePath()}.refresh.lock`;
  const startedAt = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });

  while (Date.now() - startedAt < TOKEN_REFRESH_LOCK_WAIT_MS) {
    try {
      const handle = await open(lockPath, 'wx', 0o640);
      try {
        await handle.writeFile(
          `${JSON.stringify({
            accountKey: getLocalErpAccountKey(),
            pid: process.pid,
            startedAt: new Date().toISOString(),
          })}\n`,
          'utf8'
        );
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      try {
        const lockStats = await stat(lockPath);
        if (Date.now() - lockStats.mtimeMs > TOKEN_REFRESH_LOCK_STALE_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (lockError) {
        if (isFileNotFoundError(lockError)) {
          continue;
        }
        throw lockError;
      }

      await new Promise((resolve) => setTimeout(resolve, TOKEN_REFRESH_LOCK_RETRY_MS));
    }
  }

  throw new ChanjetHttpError(
    '等待其他ERP进程完成Token续期超时，请稍后重试',
    503,
    null
  );
};

const decryptChanjetMessage = (encryptMsg: string): JsonObject => {
  const messageSecret = trimEnv('CHANJET_MESSAGE_SECRET');

  if (!messageSecret) {
    throw new ErpConfigurationError('后端缺少 CHANJET_MESSAGE_SECRET 配置');
  }

  if (Buffer.byteLength(messageSecret, 'utf8') !== 16) {
    throw new ErpConfigurationError('CHANJET_MESSAGE_SECRET 必须正好是16字节');
  }

  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(messageSecret, 'utf8'), null);
  const decrypted = `${decipher.update(encryptMsg, 'base64', 'utf8')}${decipher.final('utf8')}`;
  const payload: unknown = JSON.parse(decrypted);

  if (!isObject(payload)) {
    throw new ErpInputError('解密后的消息必须是 JSON 对象');
  }

  return payload;
};

const readChanjetMessage = (req: Request): ChanjetMessage => {
  const body = readObjectBody(req);
  const encryptMsg = optionalString(body, 'encryptMsg');
  const allowPlaintext =
    trimEnv('CHANJET_ALLOW_PLAINTEXT_MESSAGES') === 'true' &&
    trimEnv('NODE_ENV')?.toLowerCase() !== 'production';

  if (!encryptMsg && !allowPlaintext) {
    throw new ErpInputError('必须提供畅捷通加密消息');
  }

  const payload = encryptMsg ? decryptChanjetMessage(encryptMsg) : body;

  if (typeof payload.msgType !== 'string') {
    throw new ErpInputError('消息中缺少 msgType 字段');
  }

  return payload as ChanjetMessage;
};

const readPurchaseReceiveVoucherStatuses = (
  value: unknown
): Record<string, PurchaseReceiveVoucherStatus> => {
  if (!isObject(value)) {
    return {};
  }

  const statuses: Record<string, PurchaseReceiveVoucherStatus> = {};
  Object.entries(value).forEach(([key, candidate]) => {
    if (!isObject(candidate)) {
      return;
    }

    const voucherCode = optionalString(candidate, 'voucherCode');
    const receivedAt = optionalString(candidate, 'receivedAt');
    const status = candidate.status;
    if (!voucherCode || !receivedAt || (status !== 'audited' && status !== 'unaudited')) {
      return;
    }

    statuses[key] = {
      eventId: optionalString(candidate, 'eventId'),
      messageTime: optionalString(candidate, 'messageTime'),
      orgId: optionalString(candidate, 'orgId'),
      receivedAt,
      status,
      voucherCode,
      voucherDate: optionalString(candidate, 'voucherDate'),
      voucherId: optionalString(candidate, 'voucherId'),
    };
  });
  return statuses;
};

const getPurchaseReceiveMessageStatus = (
  messageType?: string
): PurchaseReceiveVoucherStatus['status'] | undefined => {
  if (messageType === 'PurchaseReceiveVoucher_Audit') {
    return 'audited';
  }
  if (messageType === 'PurchaseReceiveVoucher_UnAudit') {
    return 'unaudited';
  }
  return undefined;
};

const shouldReplacePurchaseReceiveStatus = (
  current: PurchaseReceiveVoucherStatus | undefined,
  nextMessageTime?: string,
  nextEventId?: string
): boolean => {
  if (!current) {
    return true;
  }

  if (current.eventId && nextEventId && current.eventId === nextEventId) {
    return false;
  }

  // A replay without an event time must not overwrite a known state. This is
  // common when a platform retry omits optional metadata.
  if (!nextMessageTime) {
    return false;
  }

  if (!current.messageTime) {
    return true;
  }

  const currentTime = Number(current.messageTime);
  const nextTime = Number(nextMessageTime);
  return !Number.isFinite(currentTime) || !Number.isFinite(nextTime) || nextTime >= currentTime;
};

const persistChanjetMessage = async (message: ChanjetMessage): Promise<ChanjetState> => {
  const now = new Date().toISOString();
  const appTicket =
    message.msgType === 'APP_TICKET' && isObject(message.bizContent)
      ? optionalString(message.bizContent, 'appTicket')
      : undefined;
  const purchaseReceiveStatus = getPurchaseReceiveMessageStatus(message.msgType);
  const voucherCode =
    purchaseReceiveStatus && isObject(message.bizContent)
      ? optionalString(message.bizContent, 'voucherCode')?.toUpperCase()
      : undefined;

  return updateChanjetState((current) => {
    const patch: ChanjetState = {
      lastMessageId:
        typeof message.requestId === 'string'
          ? message.requestId
          : typeof message.id === 'string'
            ? message.id
            : undefined,
      lastMessageReceivedAt: now,
      lastMessageTime: typeof message.time === 'string' ? message.time : undefined,
      lastMessageType: message.msgType,
    };

    if (appTicket) {
      patch.appTicket = appTicket;
      patch.appTicketReceivedAt = now;
    }

    if (purchaseReceiveStatus && voucherCode && isObject(message.bizContent)) {
      const statuses = readPurchaseReceiveVoucherStatuses(current.purchaseReceiveVoucherStatuses);
      const orgId =
        (typeof message.orgId === 'string' ? message.orgId.trim() : '') ||
        optionalString(message.bizContent, 'orgId') ||
        '';
      const statusKey = `${orgId || 'default'}:${voucherCode}`;
      const eventId =
        typeof message.requestId === 'string' ? message.requestId : message.id;
      if (shouldReplacePurchaseReceiveStatus(statuses[statusKey], message.time, eventId)) {
        statuses[statusKey] = {
          eventId,
          messageTime: typeof message.time === 'string' ? message.time : undefined,
          orgId: orgId || undefined,
          receivedAt: now,
          status: purchaseReceiveStatus,
          voucherCode,
          voucherDate: optionalString(message.bizContent, 'voucherDate'),
          voucherId:
            optionalString(message.bizContent, 'voucherID') ||
            optionalString(message.bizContent, 'voucherId'),
        };
      }

      patch.purchaseReceiveVoucherStatuses = Object.fromEntries(
        Object.entries(statuses)
          .sort(([, left], [, right]) => right.receivedAt.localeCompare(left.receivedAt))
          .slice(0, MAX_PURCHASE_RECEIVE_STATUS_COUNT)
      );
    }

    return patch;
  });
};

const persistTokenResponse = async (
  payload: unknown,
  source: TokenPersistSource,
  requireRefreshToken = false
): Promise<ChanjetState> => {
  if (!isObject(payload)) {
    throw new ChanjetHttpError('畅捷通Token响应结构无效', 502, null);
  }

  const value = isObject(payload.value)
    ? payload.value
    : isObject(payload.result)
      ? payload.result
      : isObject(payload.data)
        ? payload.data
        : payload;
  const readStringAlias = (...names: string[]): string | undefined => {
    for (const name of names) {
      const fieldValue = optionalString(value, name);
      if (fieldValue) {
        return fieldValue;
      }
    }
    return undefined;
  };
  const readValueAlias = (...names: string[]): unknown => {
    for (const name of names) {
      if (value[name] !== undefined) {
        return value[name];
      }
    }
    return undefined;
  };
  const accessToken = readStringAlias('accessToken', 'access_token');
  const refreshToken = readStringAlias('refreshToken', 'refresh_token');

  if (!accessToken) {
    const code = payload.code === undefined ? undefined : String(payload.code);
    const message = optionalString(payload, 'message') || optionalString(payload, 'msg');
    throw new ChanjetHttpError(
      `畅捷通Token响应中缺少 accessToken${message ? `：${message}` : ''}`,
      502,
      code ? { code } : null
    );
  }
  if (requireRefreshToken && !refreshToken) {
    throw new ChanjetHttpError('畅捷通续期响应中缺少 refreshToken', 502, null);
  }

  const expectedOrgId = trimEnv('CHANJET_ORG_ID');
  const responseOrgIdValue = readValueAlias('orgId', 'org_id');
  const responseOrgId =
    responseOrgIdValue === undefined || responseOrgIdValue === null
      ? ''
      : String(responseOrgIdValue).trim();
  if (expectedOrgId && responseOrgId && responseOrgId !== expectedOrgId) {
    throw new ErpConfigurationError('拒绝保存其他 CHANJET_ORG_ID 账套的Token');
  }

  const now = new Date().toISOString();
  const expiresIn = readValueAlias('expiresIn', 'expires_in');
  const refreshExpiresIn = readValueAlias('refreshExpiresIn', 'refresh_expires_in');
  const userId = readValueAlias('userId', 'user_id');
  const state = await updateChanjetState((current) => ({
    openToken: accessToken,
    openTokenReceivedAt: now,
    ...(refreshToken
      ? {
          refreshToken,
          refreshTokenReceivedAt: now,
        }
      : {}),
    ...(expiresIn === undefined ? {} : { tokenExpiresIn: expiresIn }),
    ...(refreshExpiresIn === undefined ? {} : { refreshTokenExpiresIn: refreshExpiresIn }),
    tokenOrgId: responseOrgId || current.tokenOrgId || expectedOrgId,
    ...(userId === undefined ? {} : { tokenUserId: userId }),
    ...(source === 'refresh-token'
      ? {
          lastTokenRefreshError: undefined,
          lastTokenRefreshErrorAt: undefined,
          lastTokenRefreshSucceededAt: now,
        }
      : {}),
  }));

  tplusResponseCache.clear();
  return state;
};

const requireObjectField = (source: JsonObject, fieldName: string): void => {
  if (!isObject(source[fieldName])) {
    throw new ErpInputError(`缺少必填对象字段：${fieldName}`);
  }
};

const requireVoucherListBody = (source: JsonObject): void => {
  if (!Number.isInteger(source.pageSize) || Number(source.pageSize) <= 0) {
    throw new ErpInputError('pageSize 字段缺失或无效');
  }
  if (!Number.isInteger(source.pageIndex) || Number(source.pageIndex) < 0) {
    throw new ErpInputError('pageIndex 字段缺失或无效');
  }
  if (!Array.isArray(source.selectFields)) {
    throw new ErpInputError('缺少必填数组字段：selectFields');
  }
  requireObjectField(source, 'paramDic');
};

const getQueryString = (req: Request, fieldName: string): string | undefined => {
  const value = req.query[fieldName];

  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim() || undefined;
  }

  return undefined;
};

const getHeaderString = (req: Request, headerName: string): string | undefined => {
  const value = req.headers[headerName.toLowerCase()];

  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim() || undefined;
  }

  return undefined;
};

const buildUrl = (path: string, query?: Record<string, string | number | undefined>): URL => {
  const url = new URL(path, getOpenApiBaseUrl());

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
};

const chanjetCurlRequest = async (
  options: ChanjetRequestOptions,
  timeoutSeconds = getChanjetRequestTimeoutSeconds()
): Promise<ErpHttpResponse> => {
  const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
  const args = [
    '--silent',
    '--show-error',
    '--connect-timeout',
    String(getChanjetConnectTimeoutSeconds()),
    '--max-time',
    String(timeoutSeconds),
    '--request',
    options.method,
    '--header',
    'Accept: application/json',
  ];

  Object.entries(options.headers || {}).forEach(([key, value]) => {
    args.push('--header', `${key}: ${value}`);
  });

  if (bodyText !== undefined) {
    args.push('--data-binary', '@-');
  }

  args.push('--write-out', '\n__HTTP_STATUS__:%{http_code}');
  args.push(buildUrl(options.path, options.query).toString());

  const output = await new Promise<string>((resolve, reject) => {
    const curl = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';

    curl.stdout.setEncoding('utf8');
    curl.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    curl.stderr.resume();
    curl.on('error', reject);
    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new ChanjetHttpError(code === 28 ? '畅捷通网络请求超时' : '畅捷通网络请求失败',
          code === 28 ? 504 : 502, null, { source: code === 28 ? 'timeout' : 'network', code: `CURL_${code}` }));
        return;
      }

      resolve(stdout);
    });

    if (bodyText !== undefined) {
      curl.stdin.end(bodyText);
    } else {
      curl.stdin.end();
    }
  });
  const statusMarker = '\n__HTTP_STATUS__:';
  const statusMarkerIndex = output.lastIndexOf(statusMarker);

  if (statusMarkerIndex < 0) {
    throw new ChanjetHttpError('畅捷通响应中缺少HTTP状态码', 502, null, { source: 'protocol' });
  }

  const text = output.slice(0, statusMarkerIndex);
  const statusCode = Number(output.slice(statusMarkerIndex + statusMarker.length).trim());
  return { text, statusCode };
};

const chanjetRequest = async (options: ChanjetRequestOptions): Promise<unknown> => {
  const startedAt = performance.now();
  const timeoutMs = getChanjetRequestTimeoutSeconds() * 1000;
  const requestId = options.requestId || randomBytes(12).toString('hex');
  const pooled = options.reuseConnection && canReuseErpConnection();
  // One shared deadline and at most two wire attempts, including curl fallback.
  const attempts = options.reuseConnection ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remainingMs = timeoutMs - (performance.now() - startedAt);
    let response: ErpHttpResponse;
    try {
      if (remainingMs <= 0) {
        throw new ChanjetHttpError('畅捷通网络请求超时', 504, null, { source: 'timeout', code: 'ETIMEDOUT' });
      }
      response = pooled && attempt === 1
        ? await requestErpRead(buildUrl(options.path, options.query), {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers: { Accept: 'application/json', ...options.headers },
          method: options.method,
          connectTimeoutMs: getChanjetConnectTimeoutSeconds() * 1000,
          timeoutMs: remainingMs,
        })
        : await chanjetCurlRequest(options, Math.max(0.001, remainingMs / 1000));
      const { text, statusCode } = response;
      let payload: unknown = null;
      if (text) {
        try { payload = JSON.parse(text); }
        catch { payload = text; }
      }
      if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 300) {
        throw new ChanjetHttpError(`畅捷通接口请求失败（状态码 ${statusCode}）`,
          Number.isFinite(statusCode) ? statusCode : 502, payload, { source: 'http' });
      }
      return payload;
    } catch (error) {
      const code = error instanceof ChanjetHttpError ? error.failure?.code
        : (error as NodeJS.ErrnoException)?.code;
      const safeCode = typeof code === 'string' && /^(?:E[A-Z_]{1,30}|CURL_\d{1,3})$/.test(code) ? code : 'OTHER';
      const failure = error instanceof ChanjetHttpError ? error
        : new ChanjetHttpError(safeCode === 'ETIMEDOUT' ? '畅捷通网络请求超时' : '畅捷通网络请求失败',
          safeCode === 'ETIMEDOUT' ? 504 : 502, null,
          { source: safeCode === 'ETIMEDOUT' ? 'timeout' : 'network', code: safeCode });
      const transient = failure.failure?.source === 'http'
        ? [500, 502, 503, 504].includes(failure.statusCode)
        : ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED',
          'CURL_5', 'CURL_6', 'CURL_7', 'CURL_28', 'CURL_52', 'CURL_55', 'CURL_56'].includes(safeCode);
      const retry = attempt < attempts && transient && timeoutMs - (performance.now() - startedAt) > 300;
      console.warn('[ERP upstream]', JSON.stringify({
        requestId, account: parseErpAccountKey(process.env.CHANJET_LOCAL_ACCOUNT_KEY) || 'unconfigured', path: options.path, attempt,
        transport: pooled && attempt === 1 ? 'pooled' : 'curl',
        source: failure.failure?.source || 'upstream', status: failure.statusCode,
        code: safeCode, elapsedMs: Math.round(performance.now() - startedAt), retry,
      }));
      if (!retry) {
        throw new ChanjetHttpError(failure.message, failure.statusCode, failure.details,
          { source: failure.failure?.source || 'network', code: safeCode, requestId, attempt });
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw new Error('ERP request attempts exhausted');
};

const getCredentialHeaders = (): Record<string, string> => {
  const { appKey, appSecret } = getAppCredentials();

  return {
    appKey,
    appSecret,
    'Content-Type': 'application/json',
  };
};

const parseStateTimestamp = (value?: string): number => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
};

export const getOpenTokenExpiresAtMs = (state: ChanjetState): number => {
  const receivedAt = parseStateTimestamp(state.openTokenReceivedAt);
  if (!Number.isFinite(receivedAt)) {
    return Number.NaN;
  }

  const expiresInSeconds = Number(state.tokenExpiresIn);
  const lifetimeMs =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : DEFAULT_OPEN_TOKEN_LIFETIME_MS;
  return receivedAt + lifetimeMs;
};

const getRefreshTokenReceivedAtMs = (state: ChanjetState): number => {
  const refreshReceivedAt = parseStateTimestamp(state.refreshTokenReceivedAt);
  return Number.isFinite(refreshReceivedAt)
    ? refreshReceivedAt
    : parseStateTimestamp(state.openTokenReceivedAt);
};

export const getRefreshTokenExpiresAtMs = (state: ChanjetState): number => {
  const receivedAt = getRefreshTokenReceivedAtMs(state);
  const expiresInSeconds = Number(state.refreshTokenExpiresIn);
  const lifetimeMs =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : REFRESH_TOKEN_LIFETIME_MS;
  return Number.isFinite(receivedAt) ? receivedAt + lifetimeMs : Number.NaN;
};

export const getTokenRefreshDueAtMs = (state: ChanjetState): number => {
  const candidates: number[] = [];
  const openTokenExpiresAt = getOpenTokenExpiresAtMs(state);
  if (Number.isFinite(openTokenExpiresAt)) {
    candidates.push(openTokenExpiresAt - getTokenRefreshLeadMs());
  }

  const refreshTokenReceivedAt = getRefreshTokenReceivedAtMs(state);
  if (Number.isFinite(refreshTokenReceivedAt)) {
    candidates.push(refreshTokenReceivedAt + getTokenRefreshMaxAgeMs());
  }

  return candidates.length > 0 ? Math.min(...candidates) : Number.NaN;
};

const getSafeTokenRefreshError = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 300) : 'Token自动续期发生未知错误';

const getOpenToken = (state: ChanjetState): string => {
  const expectedOrgId = trimEnv('CHANJET_ORG_ID');
  const tokenOrgId =
    state.tokenOrgId === undefined || state.tokenOrgId === null
      ? ''
      : String(state.tokenOrgId).trim();

  if (expectedOrgId && state.openToken?.trim() && tokenOrgId !== expectedOrgId) {
    throw new ErpConfigurationError('已保存的openToken不属于当前 CHANJET_ORG_ID 账套');
  }

  const openToken = state.openToken?.trim() || trimEnv('CHANJET_OPEN_TOKEN');

  if (!openToken) {
    throw new ErpInputError('缺少openToken，请先完成ERP账套授权');
  }

  return openToken;
};

let tokenRefreshInFlight: Promise<TokenRefreshResult> | null = null;
let tokenAutoRefreshStarted = false;

const refreshOpenToken = async (
  reason: string,
  options: { force?: boolean; refreshToken?: string } = {}
): Promise<TokenRefreshResult> => {
  if (!options.force && !isTokenAutoRefreshEnabled()) {
    return {
      refreshed: false,
      state: await readChanjetState(),
    };
  }

  if (tokenRefreshInFlight) {
    return tokenRefreshInFlight;
  }

  const refreshPromise = (async (): Promise<TokenRefreshResult> => {
    const releaseLock = await acquireTokenRefreshFileLock();

    try {
      // Re-read after acquiring the cross-process lock. Another process may
      // already have rotated both tokens while this process was waiting.
      const state = await readChanjetState();
      const refreshToken = options.refreshToken?.trim() || state.refreshToken?.trim();
      const dueAt = getTokenRefreshDueAtMs(state);
      if (!refreshToken) {
        if (options.force) {
          throw new ErpInputError(
            '缺少refreshToken，请重新授权ERP账套后再启用自动续期'
          );
        }
        return {
          dueAt: Number.isFinite(dueAt) ? dueAt : undefined,
          refreshed: false,
          state,
        };
      }

      if (!options.force && Number.isFinite(dueAt) && Date.now() < dueAt) {
        return {
          dueAt,
          refreshed: false,
          state,
        };
      }

      const attemptAt = new Date().toISOString();
      await updateChanjetState({
        lastTokenRefreshAttemptAt: attemptAt,
        lastTokenRefreshReason: reason,
      });

      try {
        const data = await chanjetRequest({
          headers: getCredentialHeaders(),
          method: 'GET',
          path: '/auth/v2/refreshToken',
          query: {
            grantType: 'refresh_token',
            refreshToken,
          },
        });
        const refreshedState = await persistTokenResponse(data, 'refresh-token', true);
        console.log(`[ERP token] refreshed account=${getLocalErpAccountKey()} reason=${reason}`);
        return {
          dueAt: getTokenRefreshDueAtMs(refreshedState),
          refreshed: true,
          state: refreshedState,
        };
      } catch (error) {
        const failedAt = new Date().toISOString();
        await updateChanjetState({
          lastTokenRefreshError: getSafeTokenRefreshError(error),
          lastTokenRefreshErrorAt: failedAt,
        }).catch(() => undefined);
        throw error;
      }
    } finally {
      await releaseLock();
    }
  })();

  tokenRefreshInFlight = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (tokenRefreshInFlight === refreshPromise) {
      tokenRefreshInFlight = null;
    }
  }
};

const getUsableOpenTokenState = async (): Promise<{
  openToken: string;
  state: ChanjetState;
}> => {
  const refreshResult = await refreshOpenToken('business-request');
  const { state } = refreshResult;
  const openToken = getOpenToken(state);
  const expiresAt = getOpenTokenExpiresAtMs(state);

  if (state.openToken?.trim() && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new ErpInputError(
      state.refreshToken?.trim()
        ? 'openToken已过期，并且自动续期未能完成，请检查续期状态'
        : 'openToken已过期且没有refreshToken，请重新授权当前ERP账套'
    );
  }

  return { openToken, state };
};

const startTokenAutoRefresh = (): void => {
  if (tokenAutoRefreshStarted) {
    return;
  }
  tokenAutoRefreshStarted = true;

  if (!isTokenAutoRefreshEnabled() || !getConfiguredAppKey() || !trimEnv('CHANJET_APP_SECRET')) {
    return;
  }

  const runRefreshCheck = (): void => {
    void refreshOpenToken('scheduled').catch((error) => {
      console.error(
        `[ERP token] auto refresh failed account=${getLocalErpAccountKey()}: ${getSafeTokenRefreshError(error)}`
      );
    });
  };

  const startupTimer = setTimeout(runRefreshCheck, TOKEN_REFRESH_START_DELAY_MS);
  startupTimer.unref();
  const interval = setInterval(runRefreshCheck, getTokenRefreshCheckIntervalMs());
  interval.unref();
};

const getSid = (): string | undefined => trimEnv('CHANJET_SID');

const getTplusHeaders = (openToken: string): Record<string, string> => {
  const headers: Record<string, string> = {
    ...getCredentialHeaders(),
    openToken,
  };
  const sid = getSid();

  if (sid) {
    headers.Cookie = `sid=${encodeURIComponent(sid)}`;
  }

  return headers;
};

const isSuccessfulTplusPayload = (value: unknown): boolean => {
  // Current-stock queries may return a bare array, including [] for no stock.
  if (Array.isArray(value)) return true;
  if (!isObject(value)) {
    return false;
  }

  if (value.success === false) {
    return false;
  }

  const code = value.code ?? value.Code;
  if (code === undefined || code === null || code === '') {
    return true;
  }

  const normalizedCode = String(code).trim().toLowerCase();
  return normalizedCode === '0' || normalizedCode === '200' || normalizedCode === 'success';
};

const isRejectedTokenPayload = (value: unknown): boolean => {
  if (!isObject(value) || isSuccessfulTplusPayload(value)) {
    return false;
  }

  const message = [value.message, value.msg, value.Message, value.Msg]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase();
  const mentionsToken = /open\s*token|opentoken|token|令牌/.test(message);
  const mentionsRejection = /expired|invalid|过期|失效|无效/.test(message);
  return mentionsToken && mentionsRejection;
};

const sendError = (res: Response, error: unknown): void => {
  const requestId = res.locals.erpRequestId as string;
  console.warn('[ERP request failed]', JSON.stringify({
    requestId, account: parseErpAccountKey(process.env.CHANJET_LOCAL_ACCOUNT_KEY) || 'unconfigured', path: res.locals.erpPath,
    source: error instanceof ChanjetHttpError ? error.failure?.source || 'upstream-business'
      : error instanceof ErpConfigurationError ? 'configuration' : error instanceof ErpInputError ? 'input' : 'local',
    ...(error instanceof ChanjetHttpError ? {
      status: error.statusCode, code: error.failure?.code, upstreamRequestId: error.failure?.requestId,
      attempts: error.failure?.attempt,
    } : {}),
  }));
  if (error instanceof ChanjetHttpError) {
    const responseStatus =
      error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502;
    res.status(responseStatus).json({
      success: false,
      message: error.message,
      upstreamStatus: error.statusCode,
      requestId,
    });
    return;
  }

  if (error instanceof ErpConfigurationError || error instanceof ErpInputError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      requestId,
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: 'ERP服务暂时不可用，请稍后重试',
    requestId,
  });
};

const route =
  (handler: AsyncRoute) =>
  async (req: Request, res: Response): Promise<void> => {
    res.locals.erpRequestId = randomBytes(12).toString('hex');
    res.locals.erpPath = typeof req.route?.path === 'string' ? req.route.path : 'erp-route';
    res.setHeader('X-Erp-Request-Id', res.locals.erpRequestId);
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };

const callTplus = async (req: Request, res: Response, path: string): Promise<void> => {
  res.locals.erpPath = path;
  const startedAt = performance.now();
  const body = readObjectBody(req);
  const tokenState = await getUsableOpenTokenState();
  const tokenMs = performance.now() - startedAt;
  const setTiming = (upstreamMs: number) => {
    const totalMs = performance.now() - startedAt;
    res.setHeader('Server-Timing',
      `erp-token;dur=${tokenMs.toFixed(1)}, erp-query;dur=${upstreamMs.toFixed(1)}, erp-total;dur=${totalMs.toFixed(1)}`);
    if (totalMs >= 1000) {
      console.log(`[ERP timing] requestId=${res.locals.erpRequestId} account=${getLocalErpAccountKey()} path=${path} tokenMs=${tokenMs.toFixed(1)} queryMs=${upstreamMs.toFixed(1)} totalMs=${totalMs.toFixed(1)}`);
    }
  };
  const { state } = tokenState;
  const openToken = tokenState.openToken;
  const cacheTtl = TPLUS_CACHE_TTL_BY_PATH.get(path) || 0;
  const bypassCache = getHeaderString(req, 'x-erp-cache-mode')?.toLowerCase() === 'bypass';
  const tokenHash = createHash('sha256').update(openToken).digest('hex').slice(0, 16);
  const tokenOrgId =
    state.tokenOrgId === undefined || state.tokenOrgId === null
      ? 'unknown-org'
      : String(state.tokenOrgId).trim() || 'unknown-org';
  const cacheKey =
    cacheTtl > 0
      ? `${getLocalErpAccountKey()}:${tokenOrgId}:${tokenHash}:${path}:${JSON.stringify(body)}`
      : '';
  const now = Date.now();

  const refreshKey = cacheKey ? `${cacheKey}:bypass` : '';
  if (cacheKey && !bypassCache && !pendingTplusRequests.has(refreshKey)) {
    const cached = tplusResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      tplusResponseCache.delete(cacheKey);
      tplusResponseCache.set(cacheKey, cached);
      res.setHeader('X-Cache', 'HIT');
      setTiming(0);
      res.status(200).json({
        success: true,
        data: cached.data,
      });
      return;
    }
    if (cached) {
      tplusResponseCache.delete(cacheKey);
    }
  }

  const requestKey = cacheKey
    ? (bypassCache || pendingTplusRequests.has(refreshKey) ? refreshKey : `${cacheKey}:default`)
    : '';
  const upstreamStartedAt = performance.now();
  let pendingRequest = requestKey ? pendingTplusRequests.get(requestKey) : undefined;
  if (!pendingRequest) {
    pendingRequest = (async () => {
      let data = await chanjetRequest({
        body,
        headers: getTplusHeaders(openToken),
        method: 'POST',
        path,
        reuseConnection: true,
        requestId: res.locals.erpRequestId,
      });

      if (isRejectedTokenPayload(data) && state.refreshToken?.trim()) {
        const refreshed = await refreshOpenToken('upstream-token-rejected', { force: true });
        const refreshedOpenToken = getOpenToken(refreshed.state);
        data = await chanjetRequest({
          body,
          headers: getTplusHeaders(refreshedOpenToken),
          method: 'POST',
          path,
          reuseConnection: true,
          requestId: res.locals.erpRequestId,
        });
      }

      return data;
    })();
    if (requestKey) {
      pendingTplusRequests.set(requestKey, pendingRequest);
      latestTplusRequests.set(cacheKey, pendingRequest);
    }
  }

  let data: unknown;
  try {
    data = await pendingRequest;
    // A slower, older read must not overwrite a refresh that started after it.
    if (cacheKey && latestTplusRequests.get(cacheKey) === pendingRequest && isSuccessfulTplusPayload(data)) {
      if (tplusResponseCache.size >= TPLUS_RESPONSE_CACHE_MAX) {
        const oldestKey = tplusResponseCache.keys().next().value as string | undefined;
        if (oldestKey) tplusResponseCache.delete(oldestKey);
      }
      tplusResponseCache.set(cacheKey, { data, expiresAt: Date.now() + cacheTtl });
    }
    if (cacheKey) res.setHeader('X-Cache', isSuccessfulTplusPayload(data) ? (bypassCache ? 'REFRESH' : 'MISS') : 'SKIP');
  } finally {
    setTiming(performance.now() - upstreamStartedAt);
    if (requestKey && pendingTplusRequests.get(requestKey) === pendingRequest) {
      pendingTplusRequests.delete(requestKey);
    }
    if (cacheKey && latestTplusRequests.get(cacheKey) === pendingRequest) {
      latestTplusRequests.delete(cacheKey);
    }
  }

  res.status(200).json({
    success: true,
    data,
  });
};

export const registerErpRoutes = (
  app: Express,
  options: { enableTokenMaintenance?: boolean } = {}
): void => {
  if (options.enableTokenMaintenance !== false) {
    startTokenAutoRefresh();
  }

  app.get(
    '/CHANJET_CHECK.txt',
    route((_req, res) => {
      const checkContent = trimEnv('CHANJET_CHECK_CONTENT');

      if (!checkContent) {
        throw new ErpConfigurationError('后端缺少 CHANJET_CHECK_CONTENT 配置');
      }

      res.type('text/plain').status(200).send(checkContent);
    })
  );

  app.get(
    '/api/erp/health',
    route(async (_req, res) => {
      const state = await readChanjetState();
      const now = Date.now();
      const configuredOpenToken = trimEnv('CHANJET_OPEN_TOKEN');
      const stateOpenTokenConfigured = Boolean(state.openToken?.trim());
      const tokenExpiresAtMs = getOpenTokenExpiresAtMs(state);
      const openTokenExpiresAt =
        stateOpenTokenConfigured && Number.isFinite(tokenExpiresAtMs)
          ? new Date(tokenExpiresAtMs).toISOString()
          : undefined;
      const openTokenExpired =
        stateOpenTokenConfigured && Number.isFinite(tokenExpiresAtMs)
          ? tokenExpiresAtMs <= now
          : false;
      const refreshTokenConfigured = Boolean(state.refreshToken?.trim());
      const refreshTokenExpiresAtMs = getRefreshTokenExpiresAtMs(state);
      const refreshTokenExpiresAt =
        refreshTokenConfigured && Number.isFinite(refreshTokenExpiresAtMs)
          ? new Date(refreshTokenExpiresAtMs).toISOString()
          : undefined;
      const refreshTokenExpired =
        refreshTokenConfigured && Number.isFinite(refreshTokenExpiresAtMs)
          ? refreshTokenExpiresAtMs <= now
          : false;
      const tokenRefreshDueAtMs = getTokenRefreshDueAtMs(state);
      const tokenRefreshDueAt =
        refreshTokenConfigured && Number.isFinite(tokenRefreshDueAtMs)
          ? new Date(tokenRefreshDueAtMs).toISOString()
          : undefined;
      const lastMessageReceivedAtMs = state.lastMessageReceivedAt
        ? Date.parse(state.lastMessageReceivedAt)
        : Number.NaN;
      const messageRecentlyReceived =
        Number.isFinite(lastMessageReceivedAtMs) && now - lastMessageReceivedAtMs <= 45 * 60_000;
      const appKeyConfigured = Boolean(getConfiguredAppKey());
      const appSecretConfigured = Boolean(trimEnv('CHANJET_APP_SECRET'));
      const messageSecretConfigured = Boolean(trimEnv('CHANJET_MESSAGE_SECRET'));
      const certificateConfigured = Boolean(trimEnv('CHANJET_CERTIFICATE'));
      const appTicketCached = Boolean(state.appTicket);
      const openTokenConfigured = Boolean(configuredOpenToken || state.openToken);
      const expectedOrgId = trimEnv('CHANJET_ORG_ID');
      const tokenOrgId =
        state.tokenOrgId === undefined || state.tokenOrgId === null
          ? ''
          : String(state.tokenOrgId).trim();
      const tokenOrgMatches =
        !expectedOrgId || !stateOpenTokenConfigured || tokenOrgId === expectedOrgId;
      const tokenAutoRefreshEnabled = isTokenAutoRefreshEnabled();
      const businessReady =
        appKeyConfigured &&
        appSecretConfigured &&
        openTokenConfigured &&
        !openTokenExpired &&
        tokenOrgMatches;
      const tokenRefreshReady =
        tokenAutoRefreshEnabled &&
        refreshTokenConfigured &&
        !refreshTokenExpired;
      const messageReady = messageSecretConfigured;

      res.status(200).json({
        success: true,
        accountKey: getLocalErpAccountKey(),
        ready: businessReady,
        businessReady,
        tokenRefreshReady,
        messageReady,
        provider: 'chanjet',
        appKeyConfigured,
        appSecretConfigured,
        domainCheckConfigured: Boolean(trimEnv('CHANJET_CHECK_CONTENT')),
        messageSecretConfigured,
        certificateConfigured,
        appTicketCached,
        openTokenConfigured,
        openTokenExpired,
        openTokenExpiresAt,
        tokenAutoRefreshEnabled,
        tokenRefreshDueAt,
        refreshTokenConfigured,
        refreshTokenExpired,
        refreshTokenExpiresAt,
        lastTokenRefreshAttemptAt: state.lastTokenRefreshAttemptAt,
        lastTokenRefreshSucceededAt: state.lastTokenRefreshSucceededAt,
        lastTokenRefreshErrorAt: state.lastTokenRefreshErrorAt,
        lastTokenRefreshError: state.lastTokenRefreshError,
        lastMessageReceivedAt: state.lastMessageReceivedAt,
        lastMessageType: state.lastMessageType,
        messageRecentlyReceived,
        tokenOrgId: state.tokenOrgId,
        expectedOrgId,
        tokenOrgMatches,
        defaultAppName: getDefaultAppName(),
        publicBaseUrlConfigured: Boolean(getPublicBaseUrl()),
        redirectUriConfigured: Boolean(getRedirectUri()),
        stateIsolation: 'account-key',
        backendRelease: SERVER_RELEASE,
        oauthStateProtection: 'one-time-persisted',
      });
    })
  );

  app.get(
    '/api/erp/auth/open-app-url',
    route(async (req, res) => {
      const url = new URL('/app/v2/openApp', getMarketBaseUrl());
      url.searchParams.set('appKey', getAppKey());

      const state = await issueOAuthState(getQueryString(req, 'state'));
      const orgId = getQueryString(req, 'orgId');
      url.searchParams.set('state', state);

      if (orgId) {
        url.searchParams.set('orgId', orgId);
      }

      res.status(200).json({
        success: true,
        url: url.toString(),
      });
    })
  );

  app.get(
    '/api/erp/auth/authorize-url',
    route(async (req, res) => {
      const orgId = getQueryString(req, 'orgId');

      if (!orgId) {
        throw new ErpInputError('请求参数中缺少 orgId');
      }

      const url = new URL('/user/v2/authorize', getMarketBaseUrl());
      url.searchParams.set('appKey', getAppKey());
      url.searchParams.set('orgId', orgId);
      url.searchParams.set('appName', getQueryString(req, 'appName') || getDefaultAppName());
      url.searchParams.set('scope', getQueryString(req, 'scope') || getDefaultScope());

      const state = await issueOAuthState(getQueryString(req, 'state'));
      url.searchParams.set('state', state);

      res.status(200).json({
        success: true,
        url: url.toString(),
      });
    })
  );

  app.get(
    '/api/erp/auth/callback',
    route(async (req, res) => {
      const code = getQueryString(req, 'code');
      const state = getQueryString(req, 'state');

      if (!code) {
        res.status(200).json({
          success: true,
          status: 'ready',
          message: '畅捷通授权回调地址已就绪',
        });
        return;
      }

      const returnState = await consumeOAuthState(state);

      if (trimEnv('CHANJET_EXCHANGE_ON_CALLBACK') !== 'true') {
        res.status(200).json({
          success: true,
          code,
          state: returnState,
          next: 'POST /api/erp/auth/exchange-code',
        });
        return;
      }

      const redirectUri = getRedirectUri();

      if (!redirectUri) {
        throw new ErpInputError(
          '后端缺少 CHANJET_REDIRECT_URI 或 CHANJET_PUBLIC_BASE_URL 配置'
        );
      }

      const data = await chanjetRequest({
        headers: getCredentialHeaders(),
        method: 'GET',
        path: '/auth/v2/getToken',
        query: {
          code,
          grantType: 'authorization_code',
          redirectUri,
        },
      });
      await persistTokenResponse(data, 'authorization-code');

      res.status(200).json({
        success: true,
        state: returnState,
        status: 'authorized',
      });
    })
  );

  app.post(
    '/api/erp/auth/exchange-code',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const redirectUri = optionalString(body, 'redirectUri') || getRedirectUri();

      if (!redirectUri) {
        throw new ErpInputError(
          '缺少redirectUri，请在请求中提供，或配置 CHANJET_REDIRECT_URI/CHANJET_PUBLIC_BASE_URL'
        );
      }

      const data = await chanjetRequest({
        headers: getCredentialHeaders(),
        method: 'GET',
        path: '/auth/v2/getToken',
        query: {
          code: requireString(body, 'code'),
          grantType: 'authorization_code',
          redirectUri,
        },
      });
      await persistTokenResponse(data, 'authorization-code');

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    '/api/erp/auth/refresh',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const result = await refreshOpenToken('manual', {
        force: true,
        refreshToken: optionalString(body, 'refreshToken'),
      });
      const openTokenExpiresAtMs = getOpenTokenExpiresAtMs(result.state);
      const refreshTokenExpiresAtMs = getRefreshTokenExpiresAtMs(result.state);

      res.status(200).json({
        success: true,
        accountKey: getLocalErpAccountKey(),
        refreshed: result.refreshed,
        openTokenExpiresAt: Number.isFinite(openTokenExpiresAtMs)
          ? new Date(openTokenExpiresAtMs).toISOString()
          : undefined,
        refreshTokenExpiresAt: Number.isFinite(refreshTokenExpiresAtMs)
          ? new Date(refreshTokenExpiresAtMs).toISOString()
          : undefined,
      });
    })
  );

  app.post(
    '/api/erp/auth/app-access-token',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const data = await chanjetRequest({
        body: {
          appTicket: requireString(body, 'appTicket'),
        },
        headers: getCredentialHeaders(),
        method: 'POST',
        path: '/auth/appAuth/getAppAccessToken',
      });

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    '/api/erp/auth/org-access-token',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const data = await chanjetRequest({
        body: {
          appAccessToken: requireString(body, 'appAccessToken'),
          permanentAuthCode: requireString(body, 'permanentAuthCode'),
        },
        headers: getCredentialHeaders(),
        method: 'POST',
        path: '/auth/orgAuth/getOrgAccessToken',
      });

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    '/api/erp/auth/token-by-permanent-code',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const data = await chanjetRequest({
        body: {
          orgAccessToken: requireString(body, 'orgAccessToken'),
          userAuthPermanentCode: requireString(body, 'userAuthPermanentCode'),
        },
        headers: getCredentialHeaders(),
        method: 'POST',
        path: '/auth/token/getTokenByPermanentCode',
      });

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    '/api/erp/auth/resend-app-ticket',
    route(async (_req, res) => {
      const data = await chanjetRequest({
        headers: getCredentialHeaders(),
        method: 'POST',
        path: '/auth/appTicket/resend',
      });

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    '/api/erp/auth/self-built-token',
    route(async (req, res) => {
      const body = readObjectBody(req);
      const state = await readChanjetState();
      const appTicket =
        optionalString(body, 'appTicket') || trimEnv('CHANJET_APP_TICKET') || state.appTicket;
      const certificate = optionalString(body, 'certificate') || trimEnv('CHANJET_CERTIFICATE');

      if (!appTicket) {
        throw new ErpInputError(
          '缺少appTicket，请配置消息接收地址并等待APP_TICKET，或重新发送AppTicket'
        );
      }

      if (!certificate) {
        throw new ErpInputError('缺少软证书，请在请求中提供或配置 CHANJET_CERTIFICATE');
      }

      const data = await chanjetRequest({
        body: {
          appTicket,
          certificate,
        },
        headers: getCredentialHeaders(),
        method: 'POST',
        path: '/v1/common/auth/selfBuiltApp/generateToken',
      });

      await persistTokenResponse(data, 'self-built');

      res.status(200).json({
        success: true,
        data,
      });
    })
  );

  app.post(
    ['/api/erp/messages', '/api/erp/chanjet/messages'],
    route(async (req, res) => {
      const message = readChanjetMessage(req);
      await persistChanjetMessage(message);

      res.status(200).json({
        result: 'success',
      });
    })
  );

  app.get(
    '/api/erp/messages/latest',
    route(async (_req, res) => {
      const state = await readChanjetState();
      const purchaseReceiveStatusCount = Object.keys(
        readPurchaseReceiveVoucherStatuses(state.purchaseReceiveVoucherStatuses)
      ).length;
      res.status(200).json({
        success: true,
        accountKey: getLocalErpAccountKey(),
        appTicketCached: Boolean(state.appTicket),
        appTicketReceivedAt: state.appTicketReceivedAt,
        lastMessageId: state.lastMessageId,
        lastMessageReceivedAt: state.lastMessageReceivedAt,
        lastMessageTime: state.lastMessageTime,
        lastMessageType: state.lastMessageType,
        purchaseReceiveStatusCount,
      });
    })
  );

  app.post(
    '/api/erp/tplus/purchase-receive/statuses',
    route(async (_req, res) => {
      const state = await readChanjetState();
      const activeOrgId =
        typeof state.tokenOrgId === 'string' || typeof state.tokenOrgId === 'number'
          ? String(state.tokenOrgId).trim()
          : '';
      const statuses = Object.values(
        readPurchaseReceiveVoucherStatuses(state.purchaseReceiveVoucherStatuses)
      )
        .filter((status) => !activeOrgId || status.orgId === activeOrgId)
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));

      res.status(200).json({
        success: true,
        statuses,
      });
    })
  );

  app.post(
    '/api/erp/tplus/inventory/query',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'param');
      await callTplus(req, res, '/tplus/api/v2/inventory/Query');
    })
  );

  app.post(
    '/api/erp/tplus/current-stock/query',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'param');
      await callTplus(req, res, '/tplus/api/v2/currentStock/Query');
    })
  );

  app.post(
    '/api/erp/tplus/current-stock/query-by-time',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'queryParam');
      await callTplus(req, res, '/tplus/api/v2/currentStock/QueryByTime');
    })
  );

  app.post(
    '/tplus/api/v2/SaleDispatchOpenApi/GetVoucherDTO',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'param');
      await callTplus(req, res, '/tplus/api/v2/SaleDispatchOpenApi/GetVoucherDTO');
    })
  );

  app.post(
    '/tplus/api/v2/PurchaseReceiveOpenApi/FindVoucherList',
    route(async (req, res) => {
      requireVoucherListBody(readObjectBody(req));
      await callTplus(req, res, '/tplus/api/v2/PurchaseReceiveOpenApi/FindVoucherList');
    })
  );

  app.post(
    '/tplus/api/v2/PurchaseArrivalOpenApi/GetVoucherDTO',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'param');
      await callTplus(req, res, '/tplus/api/v2/PurchaseArrivalOpenApi/GetVoucherDTO');
    })
  );

  app.post(
    '/tplus/api/v2/PurchaseArrivalOpenApi/FindVoucherList',
    route(async (req, res) => {
      requireVoucherListBody(readObjectBody(req));
      await callTplus(req, res, '/tplus/api/v2/PurchaseArrivalOpenApi/FindVoucherList');
    })
  );

  app.post(
    '/tplus/api/v2/PurchaseReceiveOpenApi/GetVoucherDTO',
    route(async (req, res) => {
      requireObjectField(readObjectBody(req), 'param');
      await callTplus(req, res, '/tplus/api/v2/PurchaseReceiveOpenApi/GetVoucherDTO');
    })
  );

  app.post(
    '/tplus/api/v2/SaleDispatchOpenApi/FindVoucherList',
    route(async (req, res) => {
      requireVoucherListBody(readObjectBody(req));
      await callTplus(req, res, '/tplus/api/v2/SaleDispatchOpenApi/FindVoucherList');
    })
  );
};
