jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

jest.mock('../../update-server.json', () => ({
  defaultServer: 'http://updates.example.test',
}));

type HeartbeatModule = typeof import('../heartbeat');

const config = { ip: '192.0.2.10', port: '8080' };
const healthyPayload = { status: 'ok', serviceId: 'palm-warehouse-sync' };
const response = (payload: unknown = healthyPayload, ok = true): Response => ({
  ok,
  json: jest.fn().mockResolvedValue(payload),
} as unknown as Response);

const originalFetch = global.fetch;
let heartbeat: HeartbeatModule;
let fetchMock: jest.Mock;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-13T00:00:00Z'));
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  heartbeat = require('../heartbeat') as HeartbeatModule;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('sync helper health requests', () => {
  it('sends the pairing key and keeps authentication caches separate per key', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...healthyPayload, pairingRequired: true, pairingAuthenticated: true }))
      .mockResolvedValueOnce(response({ ...healthyPayload, pairingRequired: true, pairingAuthenticated: false }));
    expect(await heartbeat.testConnection({ ...config, pairingKey: ' correct-key ' })).toBe(true);
    expect(await heartbeat.testConnection({ ...config, pairingKey: 'wrong-key' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Sync-Pairing-Key': 'correct-key' });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'X-Sync-Pairing-Key': 'wrong-key' });
  });

  it('does not report an unpaired device as connected when the helper requires pairing', async () => {
    fetchMock.mockResolvedValue(response({ ...healthyPayload, pairingRequired: true, pairingAuthenticated: false }));
    expect(await heartbeat.testConnection(config)).toBe(false);
  });

  it('rejects malformed pairing keys before sending a request', async () => {
    expect(await heartbeat.testConnection({ ...config, pairingKey: 'bad\r\nheader' })).toBe(false);
    expect(await heartbeat.testConnection({ ...config, pairingKey: 'x'.repeat(129) })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a real success for 30 seconds for repeated synchronization', async () => {
    fetchMock.mockResolvedValue(response());

    expect(await heartbeat.testConnection(config)).toBe(true);
    jest.advanceTimersByTime(29_999);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('http://192.0.2.10:8080/health', {
      method: 'GET',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ['HTTP failure', () => Promise.resolve(response({}, false))],
    ['wrong service identity', () => Promise.resolve(response({ status: 'ok', serviceId: 'another-service' }))],
    ['unhealthy status', () => Promise.resolve(response({ status: 'error', serviceId: 'palm-warehouse-sync' }))],
    ['invalid JSON', () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('Invalid JSON')) } as Response)],
    ['network failure', () => Promise.reject(new Error('Connection refused'))],
  ])('drops the success cache after a forced %s so the next check retries', async (_label, failedRequest) => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(failedRequest)
      .mockResolvedValueOnce(response());

    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(await heartbeat.testConnection(config, { force: true })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an explicit wrong service ID despite the legacy display name', async () => {
    fetchMock.mockResolvedValue(response({
      status: 'ok',
      serviceId: 'another-service',
      service: '掌上仓库同步服务',
    }));

    expect(await heartbeat.testConnection(config)).toBe(false);
    expect(await heartbeat.testConnection(config)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts the legacy helper display name when no service ID is present', async () => {
    fetchMock.mockResolvedValue(response({ status: 'ok', service: '掌上仓库同步服务' }));

    expect(await heartbeat.testConnection(config)).toBe(true);
  });

  it('shares one pending real health request across ordinary and forced checks for one URL', async () => {
    let finishRequest!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
      finishRequest = resolve;
    }));

    const ordinaryCheck = heartbeat.testConnection(config);
    const forcedCheck = heartbeat.testConnection(config, { force: true });
    const normalizedCheck = heartbeat.testConnection({ ip: ' 192.0.2.10 ', port: ' 8080 ' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishRequest(response());
    expect(await Promise.all([ordinaryCheck, forcedCheck, normalizedCheck])).toEqual([true, true, true]);
  });

  it('uses a forced request already in progress instead of returning an older cached success', async () => {
    let finishRequest!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finishRequest = resolve;
    }));

    expect(await heartbeat.testConnection(config)).toBe(true);
    const forcedCheck = heartbeat.testConnection(config, { force: true });
    const ordinaryCheck = heartbeat.testConnection(config);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finishRequest(response({}, false));
    expect(await Promise.all([forcedCheck, ordinaryCheck])).toEqual([false, false]);
  });

  it('keeps pending checks and cached successes independent for different URLs', async () => {
    const otherConfig = { ip: config.ip, port: '8081' };
    const pendingRequests = new Map<string, (value: Response) => void>();
    fetchMock.mockImplementation((url: string) => new Promise<Response>((resolve) => {
      pendingRequests.set(url, resolve);
    }));

    const firstCheck = heartbeat.testConnection(config);
    const otherCheck = heartbeat.testConnection(otherConfig);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    pendingRequests.get('http://192.0.2.10:8080/health')!(response());
    pendingRequests.get('http://192.0.2.10:8081/health')!(response({}, false));
    expect(await Promise.all([firstCheck, otherCheck])).toEqual([true, false]);

    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(response());
    expect(await heartbeat.testConnection(otherConfig)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts after five seconds and allows a new request after timeout', async () => {
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    })).mockResolvedValueOnce(response());

    const pendingCheck = heartbeat.testConnection(config);
    jest.advanceTimersByTime(4_999);
    expect(requestSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(requestSignal?.aborted).toBe(true);
    expect(await pendingCheck).toBe(false);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the matching health cache when an actual upload fails', async () => {
    const otherConfig = { ip: '192.0.2.11', port: config.port };
    fetchMock.mockResolvedValue(response());
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(await heartbeat.testConnection(otherConfig)).toBe(true);

    heartbeat.invalidateSuccessfulHealthCheck({ ip: ' 192.0.2.10 ', port: ' 8080 ' });
    expect(await heartbeat.testConnection(otherConfig)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let an older pending health success overwrite an actual upload failure', async () => {
    let finishRequest!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      finishRequest = resolve;
    })).mockResolvedValueOnce(response());

    const olderHealthCheck = heartbeat.testConnection(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    heartbeat.invalidateSuccessfulHealthCheck(config);

    finishRequest(response());
    expect(await olderHealthCheck).toBe(false);
    expect(await heartbeat.testConnection(config)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid configuration without making a network request', async () => {
    expect(await heartbeat.testConnection({ ip: '', port: '8080' })).toBe(false);
    expect(await heartbeat.testConnection({ ip: config.ip, port: '65536' }, { force: true })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
