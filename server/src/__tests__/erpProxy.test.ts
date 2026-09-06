import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { test, type TestContext } from 'node:test';
import { fetchProxyUpstream } from '../erpProxy.ts';

async function listen(handler: RequestListener, t: TestContext) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('configured-address fallback preserves host, body and ERP cache headers', async t => {
  const url = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      res.writeHead(200, {'Content-Type': 'application/json', 'X-Cache': 'HIT'});
      res.end(JSON.stringify({host: req.headers.host, path: req.url, mode: req.headers['x-erp-cache-mode'], body: Buffer.concat(chunks).toString()}));
    });
  }, t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('simulated DNS failure'); });
  const target = url.replace('127.0.0.1', 'erp.invalid');
  const result = await fetchProxyUpstream(`${target}/query?q=1`, 'POST', new Headers({'X-Erp-Cache-Mode':'bypass'}), Buffer.from('{"code":"AUDIT"}'), '127.0.0.1', AbortSignal.timeout(2000));
  assert.equal(result.usedAddressFallback, true);
  assert.equal(result.response.headers.get('x-cache'), 'HIT');
  assert.deepEqual(await result.response.json(), {host: new URL(target).host, path:'/query?q=1', mode:'bypass', body:'{"code":"AUDIT"}'});
});

test('DNS attempt and address fallback share the original cancellation signal', async t => {
  let fallbackReached = false;
  const controller = new AbortController();
  const url = await listen(() => { fallbackReached = true; controller.abort(); }, t);
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], options: RequestInit) => {
    assert.equal(options.signal, controller.signal);
    throw new Error('simulated connection reset');
  });
  await assert.rejects(fetchProxyUpstream(url, 'GET', new Headers(), undefined, '127.0.0.1', controller.signal));
  assert.equal(fallbackReached, true);
});

test('an expired total deadline does not start another address attempt', async t => {
  let fallbackReached = false;
  const url = await listen(() => { fallbackReached = true; }, t);
  const signal = AbortSignal.timeout(30);
  t.mock.method(globalThis, 'fetch', async () => {
    await new Promise(resolve => setTimeout(resolve, 60));
    signal.throwIfAborted();
    throw new Error('deadline was not reached');
  });
  await assert.rejects(fetchProxyUpstream(url, 'GET', new Headers(), undefined, '127.0.0.1', signal));
  assert.equal(fallbackReached, false);
});

test('the same deadline bounds streaming the primary response body', async t => {
  const url = await listen((_req, res) => { res.writeHead(200); res.write('{'); }, t);
  const signal = AbortSignal.timeout(300);
  await assert.rejects(async () => {
    const result = await fetchProxyUpstream(url, 'GET', new Headers(), undefined, '', signal);
    await result.response.text();
  });
  assert.equal(signal.aborted, true);
});
