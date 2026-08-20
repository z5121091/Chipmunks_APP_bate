import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const normalizeBaseUrl = (value?: string): string => {
  return value?.trim().replace(/\/+$/, '') || '';
};

const normalizePath = (path: string): string => {
  return path.startsWith('/') ? path : `/${path}`;
};

const BACKEND_BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_BACKEND_BASE_URL);
const BACKEND_ACCESS_KEY = process.env.EXPO_PUBLIC_BACKEND_ACCESS_KEY?.trim() || '';
const configuredPublicGatewayMode =
  process.env.EXPO_PUBLIC_ERP_USE_PUBLIC_GATEWAY?.trim().toLowerCase();

export const resolveErpPublicGatewayMode = ({
  backendBaseUrl,
  cozeProjectId,
  configuredMode,
}: {
  backendBaseUrl?: string;
  cozeProjectId?: string;
  configuredMode?: string;
}): boolean => {
  const normalizedMode = configuredMode?.trim().toLowerCase();
  return (
    normalizedMode === 'true' ||
    (normalizedMode !== 'false' && (!backendBaseUrl?.trim() || Boolean(cozeProjectId?.trim())))
  );
};

const SHOULD_USE_ERP_PUBLIC_GATEWAY = resolveErpPublicGatewayMode({
  backendBaseUrl: BACKEND_BASE_URL,
  cozeProjectId: process.env.EXPO_PUBLIC_COZE_PROJECT_ID,
  configuredMode: configuredPublicGatewayMode,
});
const ERP_PUBLIC_GATEWAY_PREFIX = SHOULD_USE_ERP_PUBLIC_GATEWAY
  ? '/api/v1/tplus-proxy'
  : '';

type BackendUrlOptions = {
  baseUrl?: string;
  requireConfigured?: boolean;
};

type BackendJsonRequestOptions = BackendUrlOptions & {
  body?: unknown;
  erpAccountKey?: string;
  erpCacheMode?: 'bypass' | 'default';
  headers?: HeadersInit;
  method?: 'GET' | 'POST';
  signal?: AbortSignal;
  timeoutMs?: number;
};

// Keep the client timeout above the proxy and Chanjet upstream timeouts so the
// server can return a structured error before the app aborts the request.
const DEFAULT_BACKEND_TIMEOUT_MS = 25_000;

export class BackendApiError extends Error {
  readonly payload: unknown;
  readonly status: number;

  constructor(message: string, status: number, payload: unknown) {
    super(formatUserFacingErrorMessage(message, `后端接口请求失败（状态码 ${status}）`));
    this.name = 'BackendApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class BackendNetworkError extends Error {
  readonly originalCause: unknown;
  readonly url: string;

  constructor(url: string, cause: unknown) {
    const message =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      url.startsWith('http:')
        ? `浏览器拦截了HTTP后端请求：当前页面是HTTPS，后端地址是HTTP。请把后端改成HTTPS，或使用HTTPS代理。后端地址：${url}`
        : `无法连接后端接口：${url}`;

    const causeMessage = formatUserFacingErrorMessage(cause, '');
    super(causeMessage ? `${message}；原因：${causeMessage}` : message);
    this.name = 'BackendNetworkError';
    this.originalCause = cause;
    this.url = url;
  }
}

export const getBackendBaseUrl = (): string => {
  return BACKEND_BASE_URL;
};

export const requireBackendBaseUrl = (): string => {
  if (!BACKEND_BASE_URL) {
    throw new Error('应用未配置后端服务器地址，请联系管理员');
  }

  return BACKEND_BASE_URL;
};

export const buildBackendUrl = (path: string, options: BackendUrlOptions = {}): string => {
  const normalizedPath = normalizePath(path);
  const baseUrl =
    options.baseUrl !== undefined
      ? normalizeBaseUrl(options.baseUrl)
      : options.requireConfigured === false
        ? BACKEND_BASE_URL
        : requireBackendBaseUrl();

  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

export const buildErpProxyPath = (path: string): string => {
  const normalizedPath = normalizePath(path);
  return ERP_PUBLIC_GATEWAY_PREFIX
    ? `${ERP_PUBLIC_GATEWAY_PREFIX}${normalizedPath}`
    : normalizedPath;
};

export const shouldUseErpPublicGateway = (): boolean => SHOULD_USE_ERP_PUBLIC_GATEWAY;

const parseResponsePayload = async (response: Response): Promise<unknown> => {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const readBackendErrorMessage = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) {
    const primaryMessage = record.message.trim();
    const details = record.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const detailMessage = (details as Record<string, unknown>).message;
      if (typeof detailMessage === 'string' && detailMessage.trim()) {
        const translatedDetail = formatUserFacingErrorMessage(detailMessage, '');
        if (translatedDetail && translatedDetail !== primaryMessage) {
          return `${primaryMessage}：${translatedDetail}`;
        }
      }
    }
    return primaryMessage;
  }

  return '';
};

export const backendJsonRequest = async <T>(
  path: string,
  options: BackendJsonRequestOptions = {}
): Promise<T> => {
  const {
    body,
    erpAccountKey,
    erpCacheMode,
    headers,
    method = body === undefined ? 'GET' : 'POST',
    signal,
    timeoutMs = DEFAULT_BACKEND_TIMEOUT_MS,
  } = options;
  const url = buildBackendUrl(path, options);
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  const timeoutId =
    timeoutMs > 0 ? setTimeout(() => requestController.abort(), timeoutMs) : undefined;

  if (signal?.aborted) {
    requestController.abort();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(BACKEND_ACCESS_KEY ? { 'X-Backend-Access-Key': BACKEND_ACCESS_KEY } : {}),
        ...(erpAccountKey ? { 'X-Erp-Account-Key': erpAccountKey } : {}),
        ...(erpCacheMode === 'bypass' ? { 'X-Erp-Cache-Mode': 'bypass' } : {}),
        ...headers,
      },
      method,
      signal: requestController.signal,
    });
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      const payloadMessage = readBackendErrorMessage(payload);
      throw new BackendApiError(
        payloadMessage
          ? formatUserFacingErrorMessage(
              payloadMessage,
              `后端接口请求失败（状态码 ${response.status}）`
            )
          : `后端接口返回 ${response.status}：${method} ${url}`,
        response.status,
        payload
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof BackendApiError) {
      throw error;
    }

    const requestError =
      requestController.signal.aborted && !signal?.aborted
        ? new Error(`请求超时（${Math.ceil(timeoutMs / 1000)}秒）`)
        : error;
    throw new BackendNetworkError(url, requestError);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    signal?.removeEventListener('abort', abortFromCaller);
  }
};
