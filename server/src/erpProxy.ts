import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

type ProxyFetchResult = {
  response: globalThis.Response;
  usedAddressFallback: boolean;
};

const readNetworkErrorCode = (error: unknown): string => {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (typeof record.code === 'string' && record.code.trim()) {
        return record.code.trim().toUpperCase();
      }
      if (typeof record.name === 'string' && record.name === 'TimeoutError') {
        return 'TIMEOUT';
      }
      current = record.cause;
      continue;
    }
    break;
  }

  return error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
};

export class ErpProxyConnectionError extends Error {
  constructor(targetHost: string, primaryError: unknown, fallbackError?: unknown) {
    const primaryCode = readNetworkErrorCode(primaryError);
    const fallbackSuffix = fallbackError
      ? `，备用地址连接：${readNetworkErrorCode(fallbackError)}`
      : '';
    super(`无法连接ERP后端（${targetHost}；域名连接：${primaryCode}${fallbackSuffix}）`);
    this.name = 'ErpProxyConnectionError';
  }
}

const buildResponseFromIncomingMessage = async (
  incoming: IncomingMessage
): Promise<globalThis.Response> => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const responseHeaders = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index];
    const value = incoming.rawHeaders[index + 1];
    if (name && value !== undefined) {
      responseHeaders.append(name, value);
    }
  }

  return new Response(Buffer.concat(chunks), {
    headers: responseHeaders,
    status: incoming.statusCode || 502,
    statusText: incoming.statusMessage,
  });
};

const fetchUsingConfiguredAddress = (
  urlValue: string,
  address: string,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  signal: AbortSignal
): Promise<globalThis.Response> => {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(urlValue);
    const outgoingHeaders = Object.fromEntries(headers.entries());
    outgoingHeaders.host = targetUrl.host;
    const commonOptions = {
      headers: outgoingHeaders,
      hostname: address,
      method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      signal,
    };
    const handleResponse = (incoming: IncomingMessage) => {
      void buildResponseFromIncomingMessage(incoming).then(resolve, reject);
    };
    const request =
      targetUrl.protocol === 'https:'
        ? httpsRequest(
            {
              ...commonOptions,
              servername: targetUrl.hostname,
            },
            handleResponse
          )
        : httpRequest(commonOptions, handleResponse);

    request.once('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
};

export const fetchProxyUpstream = async (
  urlValue: string,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  fallbackAddress: string,
  signal: AbortSignal
): Promise<ProxyFetchResult> => {
  try {
    return {
      response: await fetch(urlValue, {
        body,
        headers,
        method,
        redirect: 'manual',
        signal,
      }),
      usedAddressFallback: false,
    };
  } catch (primaryError) {
    const targetHost = new URL(urlValue).hostname;
    if (signal.aborted || !fallbackAddress) {
      throw new ErpProxyConnectionError(targetHost, primaryError);
    }

    console.warn(
      `[Coze ERP proxy] domain connection failed for ${targetHost} (${readNetworkErrorCode(primaryError)}); retrying configured address`
    );
    try {
      return {
        response: await fetchUsingConfiguredAddress(
          urlValue,
          fallbackAddress,
          method,
          headers,
          body,
          signal
        ),
        usedAddressFallback: true,
      };
    } catch (fallbackError) {
      throw new ErpProxyConnectionError(targetHost, primaryError, fallbackError);
    }
  }
};
