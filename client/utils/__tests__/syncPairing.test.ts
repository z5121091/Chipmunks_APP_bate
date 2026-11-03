import { parseSyncPairingCode, verifySyncPairingConnection } from '../syncPairing';
const config = { ip: '192.168.1.8', port: '8080' };
const payload = { type: 'palm-warehouse-sync', v: 1, ip: config.ip, port: 8080 };
it('accepts scanner terminators and round trips punctuation in a key', () => {
  expect(parseSyncPairingCode(JSON.stringify({ ...payload, key: 'abc";\\=+' }) + '\r\n')).toEqual({ ...config, pairingKey: 'abc";\\=+' });
  expect(parseSyncPairingCode(JSON.stringify(payload))).toEqual(config);
});
it.each(['MATERIAL/A/10', '{}', 'null', JSON.stringify({ ...payload, v: 2 }),
  JSON.stringify({ ...payload, ip: '192.168.1.8/path' }), JSON.stringify({ ...payload, ip: '999.1.1.1' }),
  JSON.stringify({ ...payload, port: 70000 }), JSON.stringify({ ...payload, key: '\r\n' }),
])('rejects invalid pairing data: %s', raw => expect(() => parseSyncPairingCode(raw)).toThrow());
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
it('checks the service and sends the key only in the header', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', serviceId: 'palm-warehouse-sync', pairingRequired: true, pairingAuthenticated: true }) });
  global.fetch = fetchMock;
  await verifySyncPairingConnection({ ...config, pairingKey: 'secret' });
  expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.8:8080/health', expect.objectContaining({ headers: { 'X-Sync-Pairing-Key': 'secret' } }));
});
it.each([
  [{ ok: false, status: 403 }, '配对密钥不匹配'],
  [{ ok: true, json: async () => ({ status: 'ok', serviceId: 'other' }) }, '不是掌上仓库'],
  [{ ok: true, json: async () => ({ status: 'ok', serviceId: 'palm-warehouse-sync', pairingRequired: true, pairingAuthenticated: false }) }, '配对密钥不匹配'],
])('rejects unavailable or unauthenticated services', async (response, message) => {
  global.fetch = jest.fn().mockResolvedValue(response);
  await expect(verifySyncPairingConnection(config)).rejects.toThrow(message);
});
