import { NETWORK_CONFIG } from '@/constants/config';
import { assertDongweiSixPrintSupported } from '../dongweiPrintCompatibility';

const config = { ip: '127.0.0.1', port: '8080' };
const ready = { status: 'ok', serviceId: 'palm-warehouse-sync', dongweiLabelFieldCounts: [6, 7] };
const response = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
}) as Response;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => { mockFetch.mockReset(); global.fetch = mockFetch; });
afterEach(() => { jest.useRealTimers(); });
afterAll(() => { global.fetch = originalFetch; });

it('authenticates the capability request and accepts numeric six-field support', async () => {
  mockFetch.mockResolvedValue(response({ ...ready, pairingRequired: true, pairingAuthenticated: true }));
  await expect(assertDongweiSixPrintSupported({ ...config, pairingKey: ' pair-key ' })).resolves.toBeUndefined();
  expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:8080/health', expect.objectContaining({
    method: 'GET', headers: { 'X-Sync-Pairing-Key': 'pair-key' }, signal: expect.any(AbortSignal),
  }));
});

it('reuses an already fetched health response without another request', async () => {
  await expect(assertDongweiSixPrintSupported(config, ready)).resolves.toBeUndefined();
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([undefined, null, '6', ['6', '7'], [7], [], [6, '7'], { six: true }])(
  'blocks unsupported or malformed capability %p with an update instruction', async capability => {
    await expect(assertDongweiSixPrintSupported(config, { ...ready, dongweiLabelFieldCounts: capability }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_HELPER', message: expect.stringContaining('请更新电脑端同步助手') });
    expect(mockFetch).not.toHaveBeenCalled();
  }
);

it.each([401, 403])('does not bypass authentication HTTP %i', async status => {
  mockFetch.mockResolvedValue(response(ready, status));
  await expect(assertDongweiSixPrintSupported(config)).rejects.toMatchObject({ code: 'SYNC_PAIRING_REQUIRED' });
});

it('does not accept an unauthenticated health payload even if it declares six fields', async () => {
  await expect(assertDongweiSixPrintSupported(config, { ...ready, pairingRequired: true }))
    .rejects.toMatchObject({ code: 'SYNC_PAIRING_REQUIRED' });
});

it.each([null, {}, { ...ready, serviceId: 'other-service' }, { ...ready, pairingRequired: 'true' }])(
  'rejects invalid service health %p', async payload => {
    mockFetch.mockResolvedValue(response(payload));
    await expect(assertDongweiSixPrintSupported(config)).rejects.toMatchObject({ code: 'SYNC_UNAVAILABLE' });
  }
);

it('reports network failure without exposing raw errors or credentials', async () => {
  mockFetch.mockRejectedValue(new Error('secret transport details'));
  await expect(assertDongweiSixPrintSupported(config)).rejects.toMatchObject({
    code: 'SYNC_UNAVAILABLE', message: '未连接到同步助手，请确认电脑端已开启同步助手及网络连接。',
  });
});

it('aborts a stalled health request after the existing heartbeat timeout', async () => {
  jest.useFakeTimers();
  mockFetch.mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const result = expect(assertDongweiSixPrintSupported(config)).rejects.toMatchObject({ code: 'SYNC_UNAVAILABLE' });
  await jest.advanceTimersByTimeAsync(NETWORK_CONFIG.HEARTBEAT_TIMEOUT);
  await result;
});

it('validates connection settings before any request or reused capability', async () => {
  await expect(assertDongweiSixPrintSupported({ ...config, ip: '' }, ready))
    .rejects.toMatchObject({ code: 'NO_SYNC_CONFIG' });
  expect(mockFetch).not.toHaveBeenCalled();
});
