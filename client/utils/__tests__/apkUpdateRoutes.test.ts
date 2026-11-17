import { Base64 } from 'js-base64';
import {
  ApkUpdateManifestError,
  APK_UPDATE_ROUTES,
  fetchApkUpdateManifest,
  getApkUpdateServers,
  resolveApkDownloadUrls,
  type ApkUpdateRouteConfig,
} from '../apkUpdateRoutes';

// Deliberately nonstandard fixture ports: production protocol/port is provided
// by the caller after verification rather than inferred by the routing helper.
const routes: ApkUpdateRouteConfig = {
  primaryBaseUrl: 'https://zx5121091.pw:9443/AppUpdate',
  fallbackBaseUrl: 'https://dav.zx5121091.fnos.net/AppUpdate',
};
const configured = 'https://user:test-pass@dav.zx5121091.fnos.net/AppUpdate';
const primary = 'https://user:test-pass@zx5121091.pw:9443/AppUpdate';
const packageName = 'com.chipmunks.traceability';
const manifest = { androidPackage: packageName, version: 'V1.01', versionCode: 200, downloadUrl: 'app-release.apk' };
const response = (body: unknown = manifest, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: jest.fn(async () => body),
}) as unknown as Response;
const mockFetch = () => jest.fn() as jest.MockedFunction<typeof fetch>;

afterEach(() => { jest.useRealTimers(); });

describe('read-only APK server routing', () => {
  it.each([configured, primary])('prioritizes the verified primary for either known saved route', input => {
    expect(getApkUpdateServers(input, routes)).toEqual([primary, configured]);
  });

  it('uses the verified default HTTPS port when the saved configuration still points at relay', () => {
    expect(APK_UPDATE_ROUTES).toEqual({
      primaryBaseUrl: 'https://zx5121091.pw:5006/AppUpdate',
      fallbackBaseUrl: 'https://dav.zx5121091.fnos.net/AppUpdate',
    });
    expect(getApkUpdateServers(configured)).toEqual([
      'https://user:test-pass@zx5121091.pw:5006/AppUpdate', configured,
    ]);
  });

  it('preserves each endpoint explicit credentials ahead of inherited shared credentials', () => {
    expect(getApkUpdateServers(configured, {
      primaryBaseUrl: 'https://primary:primary-pass@zx5121091.pw:9443/AppUpdate/',
      fallbackBaseUrl: 'https://relay:relay-pass@dav.zx5121091.fnos.net/AppUpdate/',
    })).toEqual([
      'https://primary:primary-pass@zx5121091.pw:9443/AppUpdate',
      'https://relay:relay-pass@dav.zx5121091.fnos.net/AppUpdate',
    ]);
  });

  it.each(['https://custom.invalid/AppUpdate', 'https://zx5121091.pw.evil.invalid/AppUpdate'])('leaves an arbitrary custom server independent', input => {
    expect(getApkUpdateServers(input, routes)).toEqual([input]);
  });

  it('rejects malformed and non-HTTP bases with a credential-free error', () => {
    for (const value of ['not a url private-password', 'file:///AppUpdate', 'ftp://user:private-password@nas.invalid']) {
      expect(() => getApkUpdateServers(value, routes)).toThrow('APK更新服务器地址无效');
    }
  });

  it('refuses to forward configured credentials when a known-route definition is replaced by a third party', () => {
    expect(() => getApkUpdateServers(configured, { ...routes, primaryBaseUrl: 'https://other.invalid/AppUpdate' }))
      .toThrow('APK更新线路配置无效');
  });
});

describe('APK download route ordering and authentication isolation', () => {
  it.each(['app-release.apk', `${configured}/app-release.apk`])('defaults relative and relay-only manifests to verified primary first: %s', source => {
    expect(resolveApkDownloadUrls(source, [source], configured, configured)).toEqual([
      'https://user:test-pass@zx5121091.pw:5006/AppUpdate/app-release.apk', `${configured}/app-release.apk`,
    ]);
  });
  it('mirrors an absolute relay-only manifest to primary first and deduplicates the repeated downloadUrl', () => {
    const absolute = `${configured}/app-release.apk`;
    expect(resolveApkDownloadUrls(absolute, [absolute], configured, configured, routes)).toEqual([
      `${primary}/app-release.apk`, `${configured}/app-release.apk`,
    ]);
  });

  it('keeps primary first even after only the relay manifest could be read', () => {
    expect(resolveApkDownloadUrls('app-release.apk', [], configured, configured, routes)).toEqual([
      `${primary}/app-release.apk`, `${configured}/app-release.apk`,
    ]);
  });

  it('resolves relative links against each endpoint base path and preserves their credentials', () => {
    const endpoints = { ...routes, primaryBaseUrl: 'https://main:main-pass@zx5121091.pw:9443/fast/AppUpdate' };
    expect(resolveApkDownloadUrls('./releases/new.apk?build=201', [], configured, configured, endpoints)).toEqual([
      'https://main:main-pass@zx5121091.pw:9443/fast/AppUpdate/releases/new.apk?build=201',
      'https://main:main-pass@zx5121091.pw:9443/fast/AppUpdate/app-release.apk',
      `${configured}/releases/new.apk?build=201`, `${configured}/app-release.apk`,
    ]);
  });

  it('preserves absolute file paths and queries while using the verified destination protocol and port', () => {
    expect(resolveApkDownloadUrls('https://dav.zx5121091.fnos.net/files/build.apk?token=abc', [], configured, configured, routes))
      .toEqual([
        'https://user:test-pass@zx5121091.pw:9443/files/build.apk?token=abc', `${primary}/app-release.apk`,
        'https://user:test-pass@dav.zx5121091.fnos.net/files/build.apk?token=abc', `${configured}/app-release.apk`,
      ]);
  });

  it('does not strip credentials declared by the absolute relay link or overwrite the primary own credentials', () => {
    const endpoints = { ...routes, primaryBaseUrl: 'https://main:main-pass@zx5121091.pw:9443/AppUpdate' };
    const result = resolveApkDownloadUrls('https://relay:relay-pass@dav.zx5121091.fnos.net/app.apk', [], configured, configured, endpoints);
    expect(result[0]).toBe('https://main:main-pass@zx5121091.pw:9443/app.apk');
    expect(result).toContain('https://relay:relay-pass@dav.zx5121091.fnos.net/app.apk');
  });

  it('uses credentials from the successful manifest for relatives when the original configuration had none', () => {
    const bare = 'https://dav.zx5121091.fnos.net/AppUpdate';
    expect(resolveApkDownloadUrls('app-release.apk', [], configured, bare, routes)).toEqual([
      `${primary}/app-release.apk`, `${configured}/app-release.apk`,
    ]);
  });

  it('never inherits NAS credentials into absolute or protocol-relative third-party URLs', () => {
    const result = resolveApkDownloadUrls('https://cdn.invalid/app.apk', ['//zx5121091.pw.evil.invalid/app.apk'], configured, configured, routes);
    expect(result).toContain('https://cdn.invalid/app.apk');
    expect(result).toContain('https://zx5121091.pw.evil.invalid/app.apk');
    for (const value of result.filter(url => url.includes('invalid'))) {
      expect(new URL(value).username).toBe('');
      expect(new URL(value).password).toBe('');
    }
  });

  it('keeps custom-server manifest order and explicit foreign authentication without known-domain remapping', () => {
    const custom = 'https://owner:custom-pass@custom.invalid/updates';
    expect(resolveApkDownloadUrls('relative.apk', ['https://cdn:cdn-pass@cdn.invalid/file.apk'], custom, custom, routes)).toEqual([
      'https://cdn:cdn-pass@cdn.invalid/file.apk', 'https://owner:custom-pass@custom.invalid/updates/relative.apk',
      'https://owner:custom-pass@custom.invalid/updates/app-release.apk',
    ]);
  });

  it('ignores invalid protocol/field types while retaining a valid default APK candidate', () => {
    expect(resolveApkDownloadUrls(27, ['file:///private.apk', null, 'javascript:alert(1)'], configured, configured, routes)).toEqual([
      `${primary}/app-release.apk`, `${configured}/app-release.apk`,
    ]);
  });
});

describe('bounded APK manifest failover', () => {
  it('uses the verified default primary even when all optional route settings are omitted', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(response());
    const result = await fetchApkUpdateManifest(configured, { androidPackage: packageName, fetchImpl });
    expect(result.manifestBaseUrl).toBe('https://user:test-pass@zx5121091.pw:5006/AppUpdate');
    expect(new URL(String(fetchImpl.mock.calls[0][0])).origin).toBe('https://zx5121091.pw:5006');
  });
  it('uses primary once and returns immediately without fetching relay after a valid manifest', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(response());
    const result = await fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl });
    expect(result).toEqual({ data: manifest, manifestBaseUrl: primary });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(request.origin).toBe('https://zx5121091.pw:9443');
    expect(request.pathname).toBe('/AppUpdate/version.json');
    expect(request.username).toBe('');
    expect(request.password).toBe('');
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Basic ${Base64.encode('user:test-pass')}` });
  });

  it.each([401, 404, 500])('falls back after HTTP %s without retrying the failed host', async status => {
    const fetchImpl = mockFetch().mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response());
    const result = await fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl });
    expect(result.manifestBaseUrl).toBe(configured);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).hostname).toBe('dav.zx5121091.fnos.net');
  });

  it.each([null, [], {}, { ...manifest, version: '' }, { ...manifest, version: '   ' }, { ...manifest, androidPackage: 'wrong.package' }])('falls back when a primary manifest has invalid structure/version/package: %j', async body => {
      const fetchImpl = mockFetch().mockResolvedValueOnce(response(body)).mockResolvedValueOnce(response());
      const result = await fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl });
      expect(result.data).toEqual(manifest);
      expect(result.manifestBaseUrl).toBe(configured);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

  it('falls back on JSON parsing failure and on network failure', async () => {
    const badJson = response();
    jest.mocked(badJson.json).mockRejectedValueOnce(new Error('HTML body with private-password'));
    for (const failure of [badJson, new Error('private-password network detail')]) {
      const fetchImpl = mockFetch();
      if (failure instanceof Error) fetchImpl.mockRejectedValueOnce(failure);
      else fetchImpl.mockResolvedValueOnce(failure);
      fetchImpl.mockResolvedValueOnce(response());
      expect((await fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl })).manifestBaseUrl).toBe(configured);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it('fails over at the deadline even if fetch ignores cancellation', async () => {
    jest.useFakeTimers();
    const fetchImpl = mockFetch().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(response());
    const pending = fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl, timeoutMs: 5000 });
    await jest.advanceTimersByTimeAsync(4999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect((await pending).manifestBaseUrl).toBe(configured);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out without AbortController and ignores a late successful primary response', async () => {
    jest.useFakeTimers();
    const originalController = globalThis.AbortController;
    let finish!: (value: Response) => void;
    try {
      Object.assign(globalThis, { AbortController: undefined });
      const fetchImpl = mockFetch().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response());
      const pending = fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl, timeoutMs: 20 });
      await jest.advanceTimersByTimeAsync(20);
      const result = await pending;
      expect(result.manifestBaseUrl).toBe(configured);
      finish(response({ ...manifest, version: 'V9.0' }));
      await Promise.resolve();
      expect(result.data.version).toBe('V1.01');
      expect(jest.getTimerCount()).toBe(0);
    } finally { Object.assign(globalThis, { AbortController: originalController }); }
  });

  it('bounds a stuck JSON body as well as a stuck initial connection', async () => {
    jest.useFakeTimers();
    const stuck = response();
    jest.mocked(stuck.json).mockImplementationOnce(() => new Promise(() => undefined));
    const fetchImpl = mockFetch().mockResolvedValueOnce(stuck).mockResolvedValueOnce(response());
    const pending = fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl, timeoutMs: 20 });
    await jest.advanceTimersByTimeAsync(20);
    expect((await pending).manifestBaseUrl).toBe(configured);
  });

  it('returns only whitelisted diagnostics when all routes fail, without exposing credentials or raw errors', async () => {
    const fetchImpl = mockFetch().mockRejectedValue(new Error(`${configured} private-password`));
    try {
      await fetchApkUpdateManifest(configured, { routes, androidPackage: packageName, fetchImpl });
      throw new Error('Expected routing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApkUpdateManifestError);
      expect((error as ApkUpdateManifestError).failures).toEqual([
        { route: 'primary', reason: 'network' }, { route: 'relay', reason: 'network' },
      ]);
      expect(String(error)).not.toContain('private-password');
      expect(JSON.stringify(error)).not.toContain('test-pass');
      expect(JSON.stringify(error)).not.toContain('user:');
    }
  });

  it('keeps custom-server checks single-route and does not enforce versionCode business policy', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(response({ ...manifest, versionCode: 0 }));
    const result = await fetchApkUpdateManifest('https://custom.invalid/updates', { routes, androidPackage: packageName, fetchImpl });
    expect(result.data.versionCode).toBe(0);
    expect(result.manifestBaseUrl).toBe('https://custom.invalid/updates');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
});
