import http from 'node:http';
import https from 'node:https';
import { Buffer } from 'node:buffer';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const targetBaseUrl = (
  args.get('--target') ||
  process.env.CHANJET_PROXY_TARGET_WUXI_DUNENG ||
  process.env.CHANJET_PROXY_TARGET ||
  'http://localhost:8080'
).replace(/\/+$/, '');
const port = Number(args.get('--port') || 19007);
const backendAccessKey =
  args.get('--access-key') ||
  process.env.BACKEND_ACCESS_KEY ||
  process.env.EXPO_PUBLIC_BACKEND_ACCESS_KEY ||
  '';

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

const setCorsHeaders = (request, response) => {
  const origin = request.headers.origin || '*';
  const requestedHeaders = request.headers['access-control-request-headers'];

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    requestedHeaders || 'Content-Type,x-chanjet-open-token,x-chanjet-sid'
  );
};

const copyResponseHeaders = (upstreamResponse, response) => {
  Object.entries(upstreamResponse.headers).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'access-control-allow-origin' ||
      normalizedKey === 'access-control-allow-methods' ||
      normalizedKey === 'access-control-allow-headers' ||
      normalizedKey === 'connection' ||
      normalizedKey === 'keep-alive' ||
      normalizedKey === 'transfer-encoding'
    ) {
      return;
    }

    if (value !== undefined) {
      response.setHeader(key, value);
    }
  });
};

const requestUpstream = (targetUrl, options) =>
  new Promise((resolve, reject) => {
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const request = transport.request(
      targetUrl,
      {
        headers: options.headers,
        method: options.method,
        timeout: 65000,
      },
      (upstreamResponse) => {
        const chunks = [];
        upstreamResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        upstreamResponse.on('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: upstreamResponse.headers,
            statusCode: upstreamResponse.statusCode || 502,
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Upstream request timed out'));
    });
    request.on('error', reject);

    if (options.body?.length) {
      request.write(options.body);
    }

    request.end();
  });

const server = http.createServer(async (request, response) => {
  setCorsHeaders(request, response);

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const targetUrl = new URL(request.url || '/', targetBaseUrl);
    const headers = new Headers();

    Object.entries(request.headers).forEach(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === 'host' ||
        normalizedKey === 'connection' ||
        normalizedKey === 'content-length' ||
        normalizedKey === 'origin' ||
        normalizedKey === 'referer' ||
        normalizedKey.startsWith('access-control-request-') ||
        normalizedKey.startsWith('sec-')
      ) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => headers.append(key, item));
        return;
      }

      if (value !== undefined) {
        headers.set(key, value);
      }
    });

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readRequestBody(request);

    const upstreamHeaders = Object.fromEntries(headers.entries());
    if (backendAccessKey && !upstreamHeaders['x-backend-access-key']) {
      upstreamHeaders['x-backend-access-key'] = backendAccessKey;
    }
    if (body?.length) {
      upstreamHeaders['content-length'] = String(body.length);
    }

    const upstreamResponse = await requestUpstream(targetUrl, {
      body,
      headers: upstreamHeaders,
      method: request.method,
    });

    response.statusCode = upstreamResponse.statusCode;
    copyResponseHeaders(upstreamResponse, response);
    setCorsHeaders(request, response);
    response.end(upstreamResponse.body);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Local proxy request failed',
        targetBaseUrl,
      })
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local backend proxy listening on http://localhost:${port}`);
  console.log(`Forwarding to ${targetBaseUrl}`);
});
