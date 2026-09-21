import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { canReuseErpConnection, getErpKeepAliveTimeoutMs, requestErpRead } from '../erpHttp.ts';
import { registerErpRoutes } from '../erp.ts';

const listen = async (server: Server, t: TestContext) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return new URL(`http://127.0.0.1:${address.port}`);
};

const requestOptions = {
  headers: { 'Content-Type': 'application/json' },
  method: 'POST' as const,
  connectTimeoutMs: 1000,
  timeoutMs: 3000,
};

test('retains curl for explicit rollback and existing proxy environments', () => {
  assert.equal(canReuseErpConnection({}), true);
  assert.equal(canReuseErpConnection({ CHANJET_HTTP_TRANSPORT: ' CURL ' }), false);
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    assert.equal(canReuseErpConnection({ [name]: 'http://127.0.0.1:1234' }), false);
  }
});

test('bounds configurable connection retention without changing request deadlines', () => {
  assert.equal(getErpKeepAliveTimeoutMs({}), 20_000);
  assert.equal(getErpKeepAliveTimeoutMs({ CHANJET_HTTP_KEEP_ALIVE_MS: '5000' }), 5000);
  for (const value of ['', 'invalid', 'Infinity', '-1', '0', '60001']) {
    assert.equal(getErpKeepAliveTimeoutMs({ CHANJET_HTTP_KEEP_ALIVE_MS: value }), 20_000);
  }
});

test('reuses a connection after a normal scan pause longer than five seconds', async (t) => {
  let connections = 0;
  const server = createServer((_req, res) => res.end('[]'));
  server.keepAliveTimeout = 30_000;
  server.on('connection', () => connections++);
  const url = await listen(server, t);
  assert.equal((await requestErpRead(url, requestOptions)).text, '[]');
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal((await requestErpRead(url, requestOptions)).text, '[]');
  assert.equal(connections, 1);
});

test('reuses a connection across 50 distinct queries and keeps payloads isolated', async (t) => {
  let connections = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      res.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), token: req.headers.opentoken }));
    });
  });
  server.on('connection', () => connections++);
  const url = await listen(server, t);
  const times: number[] = [];
  for (let index = 0; index < 50; index++) {
    const body = JSON.stringify({ voucherCode: `TEST-${index}`, name: '\u7269\u6599' });
    const start = performance.now();
    const response = await requestErpRead(url, {
      ...requestOptions, body, headers: { ...requestOptions.headers, openToken: `test-${index}` },
    });
    times.push(performance.now() - start);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.text), { body, token: `test-${index}` });
  }
  assert.equal(connections, 1);
  times.sort((a, b) => a - b);
  t.diagnostic(`Loopback only: 50 reads, ${connections} TCP connection, median=${times[25].toFixed(1)}ms, p95=${times[47].toFixed(1)}ms`);
});

test('enforces the deadline while waiting for response headers or body', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/body') {
      res.writeHead(200);
      res.write('{');
    }
  });
  const url = await listen(server, t);
  for (const phase of ['headers', 'body']) {
    await assert.rejects(requestErpRead(new URL(`/${phase}`, url), {
      ...requestOptions, timeoutMs: 100,
    }), { code: 'ETIMEDOUT' });
  }
});

test('rejects truncated responses without returning partial JSON', async (t) => {
  const url = await listen(createServer((_req, res) => {
    res.writeHead(200, { 'Content-Length': '100' });
    res.write('{');
    setTimeout(() => res.destroy(), 10);
  }), t);
  await assert.rejects(requestErpRead(url, requestOptions));
});

test('ERP routes preserve fresh reads, cache/account isolation, concurrency and curl fallback', async (t) => {
  const originalEnv = { ...process.env };
  const stateDir = await mkdtemp(path.join(tmpdir(), 'erp-http-test-'));
  t.after(async () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    await rm(stateDir, { recursive: true, force: true });
  });
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'CHANJET_SID']) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    CHANJET_STATE_DIR: stateDir,
    CHANJET_APP_KEY: 'test-app',
    CHANJET_APP_SECRET: 'test-secret',
    CHANJET_OPEN_TOKEN: 'test-token',
    CHANJET_ORG_ID: '',
    CHANJET_LOCAL_ACCOUNT_KEY: 'wuxi-duneng',
    CHANJET_AUTO_REFRESH_ENABLED: 'false',
    CHANJET_HTTP_TRANSPORT: 'auto',
  });
  const counts = new Map<string, number>();
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args.join(' ')); });
  const heldResponses = new Map<string, () => void>();
  const upstream = await listen(createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const input = JSON.parse(Buffer.concat(chunks).toString()) as { param?: { voucherCode: string } };
      const code = input.param?.voucherCode || 'AUTH-WRITE';
      const count = (counts.get(code) || 0) + 1;
      counts.set(code, count);
      if ((code === 'RESET' || code === 'RESET-THEN-ERROR') && count === 1) {
        req.socket.destroy();
        return;
      }
      const reply = () => {
        const status = ['HTTP-ERROR', 'AUTH-WRITE', 'RESET-THEN-ERROR'].includes(code) ? 503
          : ['RETRY-SHARED', 'CURL-RETRY'].includes(code) && count === 1 ? 503
          : code.startsWith('RETRY-') && count === 1 ? Number(code.slice(6))
          : code.startsWith('NO-RETRY-') ? Number(code.slice(9)) : 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        if (code.startsWith('ARRAY')) {
          res.end(JSON.stringify(code === 'ARRAY-EMPTY' ? [] : [{ Quantity: count }]));
          return;
        }
        res.end(JSON.stringify({
          code: code === 'ERP-ERROR' ? 123 : 0,
          data: { Code: code, count, token: req.headers.opentoken },
          privateDetails: 'PRIVATE-order-customer-credential',
        }));
      };
      if (code.startsWith('RACE-')) heldResponses.set(`${code}:${count}`, reply);
      else if (code === 'DEADLINE') { res.writeHead(200); res.write('{'); }
      else setTimeout(reply, 50);
    });
  }), t);
  process.env.CHANJET_OPENAPI_BASE_URL = upstream.toString();
  const app = express();
  app.use(express.json());
  registerErpRoutes(app, { enableTokenMaintenance: false });
  const backend = await listen(createServer(app), t);
  const query = async (code: string, bypass = true) => {
    const response = await fetch(new URL('/tplus/api/v2/SaleDispatchOpenApi/GetVoucherDTO', backend), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bypass ? { 'X-Erp-Cache-Mode': 'bypass' } : {}) },
      body: JSON.stringify({ param: { voucherCode: code } }),
    });
    const body = await response.json() as { success: boolean; data: { data: { count: number; token: string } } };
    return { response, body };
  };

  const first = await query('FRESH');
  assert.match(first.response.headers.get('server-timing') || '', /erp-token;dur=.*erp-query;dur=.*erp-total;dur=/);
  assert.equal(first.body.data.data.count, 1);
  assert.equal((await query('FRESH')).body.data.data.count, 2);
  assert.equal((await query('FRESH', false)).response.headers.get('x-cache'), 'HIT');
  assert.equal(counts.get('FRESH'), 2);

  for (const code of ['ARRAY-STOCK', 'ARRAY-EMPTY']) {
    const readArray = async (bypass = false) => {
      const response = await fetch(new URL('/api/erp/tplus/current-stock/query', backend), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(bypass ? { 'X-Erp-Cache-Mode': 'bypass' } : {}) },
        body: JSON.stringify({ param: { voucherCode: code } }),
      });
      const body = await response.json() as { data: { Quantity: number }[] };
      return { response, body };
    };
    const initial = await readArray();
    assert.equal(initial.response.headers.get('x-cache'), 'MISS');
    const cached = await readArray();
    assert.equal(cached.response.headers.get('x-cache'), 'HIT');
    assert.deepEqual(cached.body, initial.body);
    assert.equal(counts.get(code), 1);
    const fresh = await readArray(true);
    assert.equal(fresh.response.headers.get('x-cache'), 'REFRESH');
    assert.equal(counts.get(code), 2);
    assert.deepEqual(fresh.body.data, code === 'ARRAY-EMPTY' ? [] : [{ Quantity: 2 }]);
    process.env.CHANJET_LOCAL_ACCOUNT_KEY = 'shanghai-chipmunk';
    assert.equal((await readArray()).response.headers.get('x-cache'), 'MISS');
    assert.equal(counts.get(code), 3);
    process.env.CHANJET_LOCAL_ACCOUNT_KEY = 'wuxi-duneng';
  }

  const waitForResponse = async (key: string) => {
    for (let attempt = 0; attempt < 200 && !heldResponses.has(key); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(heldResponses.has(key), `upstream did not receive ${key}`);
  };
  for (const newerFirst of [true, false]) {
    const code = `RACE-${newerFirst}`;
    const oldRead = query(code, false);
    await waitForResponse(`${code}:1`);
    const refresh = query(code, true);
    await waitForResponse(`${code}:2`);
    if (newerFirst) {
      heldResponses.get(`${code}:2`)?.();
      assert.equal((await refresh).body.data.data.count, 2);
      heldResponses.get(`${code}:1`)?.();
      await oldRead;
    } else {
      heldResponses.get(`${code}:1`)?.();
      await oldRead;
      const joiningRead = query(code, false);
      heldResponses.get(`${code}:2`)?.();
      await refresh;
      assert.equal((await joiningRead).body.data.data.count, 2);
    }
    const cached = await query(code, false);
    assert.equal(cached.body.data.data.count, 2);
    assert.equal(cached.response.headers.get('x-cache'), 'HIT');
    assert.equal(counts.get(code), 2);
  }

  const concurrent = await Promise.all(Array.from({ length: 12 }, () => query('SAME')));
  assert.equal(counts.get('SAME'), 1);
  assert.ok(concurrent.every(({ body }) => body.data.data.count === 1));
  const distinct = await Promise.all(Array.from({ length: 40 }, (_, index) => query(`BATCH-${index}`)));
  assert.ok(distinct.every(({ response, body }) => response.ok && body.data.data.count === 1));

  process.env.CHANJET_LOCAL_ACCOUNT_KEY = 'shanghai-chipmunk';
  process.env.CHANJET_OPEN_TOKEN = 'second-account-token';
  const secondAccount = await query('FRESH', false);
  assert.equal(secondAccount.body.data.data.count, 3);
  assert.equal(secondAccount.body.data.data.token, 'second-account-token');
  process.env.CHANJET_LOCAL_ACCOUNT_KEY = 'wuxi-duneng';
  process.env.CHANJET_OPEN_TOKEN = 'test-token';

  const failed = await query('HTTP-ERROR');
  assert.equal(failed.response.status, 503);
  assert.equal(counts.get('HTTP-ERROR'), 2);
  const failureBody = failed.body as unknown as { requestId: string; details?: unknown };
  assert.match(failureBody.requestId, /^[a-f0-9]{24}$/);
  assert.equal(failed.response.headers.get('x-erp-request-id'), failureBody.requestId);
  assert.equal(failureBody.details, undefined);
  assert.ok(warnings.some(line => line.includes(failureBody.requestId) && line.includes('"source":"http"')));
  for (const status of [500, 502, 503, 504]) {
    assert.equal((await query(`RETRY-${status}`)).response.status, 200);
    assert.equal(counts.get(`RETRY-${status}`), 2);
  }
  for (const status of [400, 401, 403, 404, 429]) {
    assert.equal((await query(`NO-RETRY-${status}`)).response.status, status);
    assert.equal(counts.get(`NO-RETRY-${status}`), 1);
  }
  assert.equal((await query('RESET-THEN-ERROR')).response.status, 503);
  assert.equal(counts.get('RESET-THEN-ERROR'), 2);
  const retriedTogether = await Promise.all(Array.from({ length: 12 }, () => query('RETRY-SHARED')));
  assert.ok(retriedTogether.every(result => result.response.status === 200));
  assert.equal(counts.get('RETRY-SHARED'), 2);
  const authResponse = await fetch(new URL('/api/erp/auth/self-built-token', backend), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appTicket: 'private-ticket', certificate: 'private-certificate' }),
  });
  assert.equal(authResponse.status, 503);
  await authResponse.text();
  assert.equal(counts.get('AUTH-WRITE'), 1);
  process.env.CHANJET_HTTP_TIMEOUT_SECONDS = '5';
  const deadlineStart = performance.now();
  assert.equal((await query('DEADLINE')).response.status, 504);
  assert.equal(counts.get('DEADLINE'), 1);
  assert.ok(performance.now() - deadlineStart < 8000, 'retry must not restart the 5s deadline');
  delete process.env.CHANJET_HTTP_TIMEOUT_SECONDS;
  await query('ERP-ERROR', false);
  await query('ERP-ERROR', false);
  assert.equal(counts.get('ERP-ERROR'), 2);
  assert.equal((await query('RESET')).response.status, 200);
  assert.equal(counts.get('RESET'), 2);
  process.env.CHANJET_HTTP_TRANSPORT = 'curl';
  assert.equal((await query('CURL')).body.data.data.token, 'test-token');
  assert.equal(counts.get('CURL'), 1);
  assert.equal((await query('CURL-RETRY')).response.status, 200);
  assert.equal(counts.get('CURL-RETRY'), 2);
  assert.ok(!warnings.join('\n').match(/PRIVATE-order|test-token|test-secret|second-account-token|private-ticket|private-certificate/));
  for (const transport of ['auto', 'curl']) {
    process.env.CHANJET_HTTP_TRANSPORT = transport;
    const times: number[] = [];
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      assert.equal((await query(`BENCH-${transport}-${index}`)).body.data.data.count, 1);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    t.diagnostic(`Loopback ERP with 50ms simulated processing, ${transport}: median=${times[5].toFixed(1)}ms, p90=${times[8].toFixed(1)}ms`);
  }
});
