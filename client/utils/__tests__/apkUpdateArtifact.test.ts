jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('expo-constants', () => ({ default: { expoConfig: { android: { versionCode: 9999 } } } }));

import { requireOptionalNativeModule } from 'expo';
import { Base64 } from 'js-base64';
import { artifactFromDownload, probeApkUpdateArtifact, readInstalledApkVersionCode } from '../apkUpdateArtifact';

const primary = 'https://owner:private-pass@primary.invalid/AppUpdate/app-release.apk';
const fallback = 'https://owner:private-pass@relay.invalid/AppUpdate/app-release.apk';
const standardHeaders = { ETag: '"build-content"', 'Content-Length': '12345' };
const response = (headers: Record<string, string> = standardHeaders, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  json: jest.fn(() => { throw new Error('HEAD must not read the body'); }),
  text: jest.fn(() => { throw new Error('HEAD must not read the body'); }),
  arrayBuffer: jest.fn(() => { throw new Error('HEAD must not read the body'); }),
}) as unknown as Response;
const mockFetch = () => jest.fn() as jest.MockedFunction<typeof fetch>;

afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

describe('APK artifact identity', () => {
  it('matches native download and Fetch header case variants', () => {
    const expected = artifactFromDownload(standardHeaders);
    expect(expected).toEqual({ artifactId: JSON.stringify(['etag', Base64.encode('"build-content"'), 12345]), expectedSize: 12345 });
    expect(artifactFromDownload({ eTaG: ' "build-content" ', 'cOnTeNt-LeNgTh': '0012345' })).toEqual(expected);
    expect(artifactFromDownload({ get: name => ({ etag: '"build-content"', 'content-length': '12345' })[name] ?? null })).toEqual(expected);
  });

  it('separates the same version replaced with different content or length', () => {
    expect(artifactFromDownload({ ...standardHeaders, ETag: '"replacement"' }))
      .not.toEqual(artifactFromDownload(standardHeaders));
    expect(artifactFromDownload({ ...standardHeaders, 'Content-Length': '12346' }))
      .not.toEqual(artifactFromDownload(standardHeaders));
  });

  it('keeps a legal opaque URL-shaped ETag out of the persisted identity', () => {
    const result = artifactFromDownload({ ...standardHeaders, ETag: '"https://opaque.invalid/content"' });
    expect(result).not.toBeNull();
    expect(result?.artifactId).not.toContain('://');
    expect(result?.artifactId).not.toContain('opaque.invalid');
  });

  it('falls back to a normalized modification date and length', () => {
    const date = 'Sat, 14 Nov 2026 09:00:00 GMT';
    const headers = { 'Last-Modified': date, 'Content-Length': '12345' };
    expect(artifactFromDownload(headers)).toEqual({
      artifactId: JSON.stringify(['modified', Date.parse(date), 12345]), expectedSize: 12345,
    });
    expect(artifactFromDownload({ ...headers, ETag: 'W/"weak"' })).toEqual(artifactFromDownload(headers));
    expect(artifactFromDownload({ ...headers, ETag: '"strong"' })).not.toEqual(artifactFromDownload(headers));
  });

  it.each([
    undefined, null, {}, { 'Content-Length': '12345' }, { ETag: '"valid"' },
    { ...standardHeaders, 'Content-Length': '0' }, { ...standardHeaders, 'Content-Length': '-5' },
    { ...standardHeaders, 'Content-Length': '1.5' }, { ...standardHeaders, 'Content-Length': '1e5' },
    { ...standardHeaders, 'Content-Length': '9007199254740992' },
    { ...standardHeaders, ETag: 'W/"weak"' }, { ...standardHeaders, ETag: 'invalid-unquoted' },
    { ...standardHeaders, 'Content-Encoding': 'gzip' },
    { ...standardHeaders, ETag: '"first", "second"' },
    { ...standardHeaders, ETag: `"${'a'.repeat(1025)}"` },
    { ...standardHeaders, ETag: '"first"', etag: '"second"' },
    { 'Content-Length': '12345', 'Last-Modified': 'not a date' },
    { 'Content-Length': '12345', 'Last-Modified': '123' },
  ])('declines unreliable metadata: %p', headers => {
    expect(artifactFromDownload(headers)).toBeNull();
  });

  it('contains only response validators and size, never request credentials or endpoint', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(response());
    const result = await probeApkUpdateArtifact([primary], { fetchImpl });
    expect(JSON.stringify(result)).not.toMatch(/primary\.invalid|owner|private-pass|Authorization/);
    expect(result).toEqual(artifactFromDownload(standardHeaders));
  });
});

describe('bounded read-only artifact probing', () => {
  it('performs HEAD without reading any response body, stripping userinfo into Basic authentication', async () => {
    const result = response();
    const fetchImpl = mockFetch().mockResolvedValue(result);
    expect(await probeApkUpdateArtifact(['https://owner%40x:p%3Ass@primary.invalid/file.apk#fragment'], { fetchImpl }))
      .toEqual(artifactFromDownload(standardHeaders));
    expect(fetchImpl).toHaveBeenCalledWith('https://primary.invalid/file.apk', expect.objectContaining({
      method: 'HEAD', redirect: 'error', headers: expect.objectContaining({ Authorization: `Basic ${Base64.encode('owner@x:p:ss')}` }),
    }));
    expect(result.json).not.toHaveBeenCalled();
    expect(result.text).not.toHaveBeenCalled();
    expect(result.arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([401, 404, 405, 500])('uses fallback after HTTP %s', async status => {
    const fetchImpl = mockFetch().mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response());
    expect(await probeApkUpdateArtifact([primary, fallback], { fetchImpl })).toEqual(artifactFromDownload(standardHeaders));
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://primary.invalid/AppUpdate/app-release.apk', 'https://relay.invalid/AppUpdate/app-release.apk',
    ]);
  });

  it('uses fallback after missing validators or network failure without surfacing private errors', async () => {
    const fetchImpl = mockFetch()
      .mockRejectedValueOnce(new Error(`private network error ${primary}`))
      .mockResolvedValueOnce(response({ 'Content-Length': '12345' }))
      .mockResolvedValueOnce(response());
    await expect(probeApkUpdateArtifact([primary, fallback, 'https://third.invalid/file.apk'], { fetchImpl }))
      .resolves.toEqual(artifactFromDownload(standardHeaders));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('has a 2.5 second deadline even if fetch ignores abort and later completes', async () => {
    jest.useFakeTimers();
    let late!: (value: Response) => void;
    const fetchImpl = mockFetch()
      .mockImplementationOnce(() => new Promise(resolve => { late = resolve; }))
      .mockResolvedValueOnce(response({ ETag: '"relay-content"', 'Content-Length': '12345' }));
    const pending = probeApkUpdateArtifact([primary, fallback], { fetchImpl });
    await jest.advanceTimersByTimeAsync(2499);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    const expected = artifactFromDownload({ ETag: '"relay-content"', 'Content-Length': '12345' });
    await expect(pending).resolves.toEqual(expected);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    late(response());
    await Promise.resolve();
    await expect(pending).resolves.toEqual(expected);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds every failed route and returns null without any usable validator', async () => {
    jest.useFakeTimers();
    const fetchImpl = mockFetch().mockImplementation(() => new Promise(() => undefined));
    const pending = probeApkUpdateArtifact([primary, fallback], { fetchImpl, timeoutMs: 20 });
    await jest.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('skips malformed/non-HTTP routes and never transfers credentials to another URL', async () => {
    const fetchImpl = mockFetch().mockResolvedValue(response());
    await expect(probeApkUpdateArtifact(['file:///cache/app.apk', 'broken private-pass', 'https://%zz:pass@bad.invalid/file.apk', 'https://cdn.invalid/file.apk'], { fetchImpl }))
      .resolves.toEqual(artifactFromDownload(standardHeaders));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });

  it('returns null if all routes fail or are empty', async () => {
    const fetchImpl = mockFetch().mockRejectedValue(new Error(`network ${primary}`));
    await expect(probeApkUpdateArtifact([primary, fallback], { fetchImpl })).resolves.toBeNull();
    await expect(probeApkUpdateArtifact([], { fetchImpl })).resolves.toBeNull();
  });
});

describe('APK-installed version source', () => {
  const native = requireOptionalNativeModule as jest.Mock;

  it('reads embedded native JSON instead of the OTA-selected expo config', () => {
    native.mockReturnValue({ manifest: JSON.stringify({ android: { versionCode: 200 } }), expoConfig: { android: { versionCode: 9999 } } });
    expect(readInstalledApkVersionCode()).toBe(200);
    expect(native).toHaveBeenCalledWith('ExponentConstants');
  });

  it('accepts an object returned by the native module', () => {
    native.mockReturnValue({ manifest: { android: { versionCode: 201 } } });
    expect(readInstalledApkVersionCode()).toBe(201);
  });

  it.each([
    null, {}, { manifest: '{}' }, { manifest: 'not JSON' }, { manifest: '[]' },
    { manifest: { android: { versionCode: '200' } } }, { manifest: { android: { versionCode: 0 } } },
    { manifest: { android: { versionCode: 1.5 } } }, { manifest: { android: { versionCode: Number.POSITIVE_INFINITY } } },
    { expoConfig: { android: { versionCode: 9999 } } },
  ])('returns unknown when native version is unavailable or invalid: %p', module => {
    native.mockReturnValue(module);
    expect(readInstalledApkVersionCode()).toBeUndefined();
  });

  it('returns unknown when the optional native bridge throws', () => {
    native.mockImplementationOnce(() => { throw new Error('native module unavailable'); });
    expect(readInstalledApkVersionCode()).toBeUndefined();
  });
});
