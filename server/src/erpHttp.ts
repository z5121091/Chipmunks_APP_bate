import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';

export const getErpKeepAliveTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const value = Number(env.CHANJET_HTTP_KEEP_ALIVE_MS?.trim() || 20_000);
  return Number.isFinite(value) && value >= 1000 && value <= 60_000 ? value : 20_000;
};

const agentOptions = {
  keepAlive: true,
  maxSockets: 16,
  maxTotalSockets: 32,
  maxFreeSockets: 4,
  // Keep connections across normal scan intervals; request deadlines remain independent.
  timeout: getErpKeepAliveTimeoutMs(),
};
const httpAgent = new HttpAgent(agentOptions);
const httpsAgent = new HttpsAgent(agentOptions);

export type ErpHttpResponse = { statusCode: number; text: string };

export const canReuseErpConnection = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.CHANJET_HTTP_TRANSPORT?.trim().toLowerCase() !== 'curl' &&
  // Keep curl's existing proxy and NO_PROXY behavior in development/sandbox environments.
  !['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
    .some((name) => env[name]?.trim());

export const requestErpRead = (
  url: URL,
  options: {
    body?: string;
    headers: Record<string, string>;
    method: 'GET' | 'POST';
    connectTimeoutMs: number;
    timeoutMs: number;
  }
): Promise<ErpHttpResponse> => new Promise((resolve, reject) => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    reject(new Error('Unsupported ERP URL protocol'));
    return;
  }
  const secure = url.protocol === 'https:';
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  const clearTimers = () => {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
  };
  const request = (secure ? httpsRequest : httpRequest)(url, {
    agent: secure ? httpsAgent : httpAgent,
    method: options.method,
    headers: {
      ...options.headers,
      ...(options.body === undefined ? {} : { 'Content-Length': Buffer.byteLength(options.body) }),
    },
  }, (response) => {
    clearTimeout(connectTimer);
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.once('error', (error) => {
      clearTimers();
      reject(error);
    });
    response.once('end', () => {
      clearTimers();
      resolve({ statusCode: response.statusCode || 502, text: Buffer.concat(chunks).toString('utf8') });
    });
  });
  const timeout = () => request.destroy(Object.assign(new Error('ERP request timed out'), {
    code: 'ETIMEDOUT',
  }));
  // The total deadline includes queueing and reading the full response, not only response headers.
  const totalTimer = setTimeout(timeout, options.timeoutMs);
  request.once('socket', (socket) => {
    if (socket.connecting) {
      connectTimer = setTimeout(timeout, options.connectTimeoutMs);
      socket.once(secure ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer));
    }
  });
  request.once('error', (error) => {
    clearTimers();
    reject(error);
  });
  request.end(options.body);
});
