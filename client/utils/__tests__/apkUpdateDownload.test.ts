jest.mock('expo-file-system/legacy', () => ({}));

import { Base64 } from 'js-base64';
import { ApkDownloadError, downloadApkFromRoutes, type ApkDownloadFileSystem } from '../apkUpdateDownload';

type Result = { uri: string; status: number } | undefined;
type Progress = { totalBytesWritten: number; totalBytesExpectedToWrite: number };
const primary = 'https://user:pass@primary.invalid/AppUpdate/app-release.apk';
const relay = 'https://user:pass@relay.invalid/AppUpdate/app-release.apk';
const target = 'file:///cache/update.apk';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Plan = {
  pending?: ReturnType<typeof deferred<Result>>;
  status?: number;
  error?: unknown;
  size?: number;
  exists?: boolean;
  returnedUri?: string;
  cancel?: ReturnType<typeof deferred<void>>;
  headers?: Record<string, string>;
};
type Entry = {
  uri: string;
  progress: (progress: Progress) => void;
  cancel: jest.Mock<Promise<void>, []>;
};

function fixture(plans: Plan[]) {
  const entries: Entry[] = [];
  const metadata = new Map<string, { exists: boolean; size: number }>();
  const fs: jest.Mocked<ApkDownloadFileSystem> = {
    createDownloadResumable: jest.fn((url, uri, options, progress) => {
      const plan = plans.shift() || {};
      const cancel = jest.fn(() => plan.cancel?.promise || Promise.resolve());
      entries.push({ uri, progress, cancel });
      metadata.set(uri, { exists: plan.exists ?? true, size: plan.size ?? 100 });
      return {
        downloadAsync: () => plan.error ? Promise.reject(plan.error)
          : plan.pending?.promise || Promise.resolve({ uri: plan.returnedUri || uri, status: plan.status ?? 200, headers: plan.headers }),
        cancelAsync: cancel,
      };
    }),
    getInfoAsync: jest.fn(async uri => metadata.get(uri) || { exists: false, size: 0 }),
    deleteAsync: jest.fn(async () => undefined),
  };
  return { fs, entries };
}

async function flush() {
  for (let count = 0; count < 15; count++) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('downloads the primary route into its own APK file, with credentials only in the authorization header', async () => {
  const { fs, entries } = fixture([{}]);
  const progress = jest.fn();
  const uri = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs, onProgress: progress });
  expect(fs.createDownloadResumable).toHaveBeenCalledTimes(1);
  expect(fs.createDownloadResumable.mock.calls[0][0]).toBe('https://primary.invalid/AppUpdate/app-release.apk');
  expect(fs.createDownloadResumable.mock.calls[0][2]).toEqual({ headers: { Authorization: `Basic ${Base64.encode('user:pass')}` } });
  expect(uri).toBe(entries[0].uri);
  expect(uri).toMatch(/^file:\/\/\/cache\/update-.+\.apk$/);
  expect(uri).not.toBe(target);
  expect(progress).toHaveBeenCalledWith(0);
  expect(fs.deleteAsync).not.toHaveBeenCalledWith(uri, expect.anything());
  expect(jest.getTimerCount()).toBe(0);
});

it('cancels and clears a failed primary task before trying the relay', async () => {
  const { fs, entries } = fixture([{ error: new Error(`secret ${primary}`) }, {}]);
  const result = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs });
  expect(result).toBe(entries[1].uri);
  expect(entries[0].cancel).toHaveBeenCalledTimes(1);
  expect(fs.deleteAsync).toHaveBeenCalledWith(entries[0].uri, { idempotent: true });
  expect(entries[1].uri).not.toBe(entries[0].uri);
  expect(entries[0].cancel.mock.invocationCallOrder[0]).toBeLessThan(fs.createDownloadResumable.mock.invocationCallOrder[1]);
});

it('reports only the actual successful route metadata, after checking its complete file', async () => {
  const headers = { ETag: 'relay-current', 'Content-Length': '100' };
  const { fs, entries } = fixture([{ status: 500, headers: { ETag: 'primary-old' } }, { headers }]);
  const onDownloaded = jest.fn();
  const uri = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs, onDownloaded });
  expect(uri).toBe(entries[1].uri);
  expect(onDownloaded).toHaveBeenCalledTimes(1);
  expect(onDownloaded).toHaveBeenCalledWith({ headers, size: 100 });
  expect(fs.getInfoAsync.mock.invocationCallOrder.at(-1)).toBeLessThan(onDownloaded.mock.invocationCallOrder[0]);
});

it('rejects a truncated successful response before reporting it for caching', async () => {
  const { fs, entries } = fixture([{ size: 80, headers: { 'cOnTeNt-LeNgTh': '100' } }, { size: 100 }]);
  const onDownloaded = jest.fn();
  const uri = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs, onDownloaded });
  expect(uri).toBe(entries[1].uri);
  expect(fs.deleteAsync).toHaveBeenCalledWith(entries[0].uri, { idempotent: true });
  expect(onDownloaded).toHaveBeenCalledTimes(1);
  expect(onDownloaded).toHaveBeenCalledWith({ headers: undefined, size: 100 });
});

it('does not compare compressed wire length with an uncompressed local file', async () => {
  const { fs } = fixture([{ size: 100, headers: { 'Content-Length': '80', 'Content-Encoding': 'gzip' } }]);
  await expect(downloadApkFromRoutes([primary], target, { fileSystem: fs })).resolves.toBeDefined();
});

it('keeps a complete file installable when cache metadata callback fails', async () => {
  const { fs, entries } = fixture([{}]);
  const onDownloaded = jest.fn(() => { throw new Error('metadata unavailable'); });
  const uri = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs, onDownloaded });
  expect(uri).toBe(entries[0].uri);
  expect(fs.createDownloadResumable).toHaveBeenCalledTimes(1);
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 500])('falls back after HTTP %s without exposing credentials', async status => {
  const { fs, entries } = fixture([{ status }, {}]);
  await expect(downloadApkFromRoutes([primary, relay], target, { fileSystem: fs }))
    .resolves.toBeDefined();
  expect(entries).toHaveLength(2);
  expect(entries[0].cancel).toHaveBeenCalledTimes(1);
});

it.each([
  { size: 0 }, { size: -1 }, { size: Number.NaN }, { size: Number.POSITIVE_INFINITY }, { exists: false },
])('rejects missing/empty/invalid file metadata %p and retries the next route', async invalid => {
  const { fs, entries } = fixture([invalid, {}]);
  const uri = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs });
  expect(uri).toBe(entries[1].uri);
  expect(fs.deleteAsync).toHaveBeenCalledWith(entries[0].uri, { idempotent: true });
});

it('returns only a white-listed transport error even when native network and cleanup errors contain secrets', async () => {
  const { fs } = fixture([{ error: new Error(`native failed ${primary}`) }]);
  fs.deleteAsync.mockRejectedValue(new Error(`cleanup ${primary}`));
  const error = await downloadApkFromRoutes([primary], target, { fileSystem: fs }).catch(value => value);
  expect(error).toBeInstanceOf(ApkDownloadError);
  expect(error.message).toBe('安装包下载失败，请检查网络后重试');
  expect(String(error)).not.toMatch(/primary|user|pass|secret/);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps an HTTP failure status but never the URL or arbitrary response text', async () => {
  const { fs } = fixture([{ status: 404 }]);
  const error = await downloadApkFromRoutes([primary], target, { fileSystem: fs }).catch(value => value);
  expect(error).toBeInstanceOf(ApkDownloadError);
  expect(error.reason).toBe('http');
  expect(error.message).toContain('HTTP 404');
  expect(String(error)).not.toContain('primary');
});

it('cancels the native task after 12 seconds without the first byte and moves to the relay', async () => {
  const pending = deferred<Result>();
  const { fs, entries } = fixture([{ pending }, {}]);
  const result = downloadApkFromRoutes([primary, relay], target, { fileSystem: fs });
  await flush();
  await jest.advanceTimersByTimeAsync(11_999);
  expect(entries).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBe(entries[1].uri);
  expect(entries[0].cancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('switches to the 20-second idle deadline after the first received bytes, ignoring duplicate progress', async () => {
  const pending = deferred<Result>();
  const { fs, entries } = fixture([{ pending }, {}]);
  const result = downloadApkFromRoutes([primary, relay], target, { fileSystem: fs });
  await flush();
  await jest.advanceTimersByTimeAsync(5_000);
  entries[0].progress({ totalBytesWritten: 10, totalBytesExpectedToWrite: 100 });
  await jest.advanceTimersByTimeAsync(19_999);
  entries[0].progress({ totalBytesWritten: 10, totalBytesExpectedToWrite: 100 });
  expect(entries).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBe(entries[1].uri);
  expect(entries[0].cancel).toHaveBeenCalledTimes(1);
});

it('does not abort a slow long download while fresh bytes keep arriving', async () => {
  const pending = deferred<Result>();
  const { fs, entries } = fixture([{ pending }]);
  const progress = jest.fn();
  const result = downloadApkFromRoutes([primary, relay], target, { fileSystem: fs, onProgress: progress });
  await flush();
  for (let block = 1; block <= 7; block++) {
    await jest.advanceTimersByTimeAsync(10_000);
    entries[0].progress({ totalBytesWritten: block * 10, totalBytesExpectedToWrite: 70 });
  }
  expect(entries).toHaveLength(1);
  expect(entries[0].cancel).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith(0.99);
  pending.resolve({ uri: entries[0].uri, status: 200 });
  expect(await result).toBe(entries[0].uri);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps receiving bytes alive when the server does not report its content length', async () => {
  const pending = deferred<Result>();
  const { fs, entries } = fixture([{ pending }]);
  const result = downloadApkFromRoutes([primary], target, { fileSystem: fs });
  await flush();
  for (let block = 1; block <= 4; block++) {
    await jest.advanceTimersByTimeAsync(10_000);
    entries[0].progress({ totalBytesWritten: block * 10, totalBytesExpectedToWrite: -1 });
  }
  pending.resolve({ uri: entries[0].uri, status: 200 });
  await expect(result).resolves.toBe(entries[0].uri);
});

it('isolates stale progress and eventual completion when native cancellation is delayed', async () => {
  const first = deferred<Result>();
  const cancellation = deferred<void>();
  const second = deferred<Result>();
  const { fs, entries } = fixture([{ pending: first, cancel: cancellation }, { pending: second }]);
  const progress = jest.fn();
  const result = downloadApkFromRoutes([primary, relay], target, {
    fileSystem: fs, onProgress: progress, firstProgressTimeoutMs: 120, idleTimeoutMs: 200, cancelTimeoutMs: 20,
  });
  await flush();
  await jest.advanceTimersByTimeAsync(140);
  expect(entries).toHaveLength(2);
  expect(entries[0].cancel).toHaveBeenCalledTimes(1);
  entries[1].progress({ totalBytesWritten: 30, totalBytesExpectedToWrite: 100 });
  const count = progress.mock.calls.length;
  entries[0].progress({ totalBytesWritten: 99, totalBytesExpectedToWrite: 100 });
  expect(progress).toHaveBeenCalledTimes(count);
  first.resolve({ uri: entries[0].uri, status: 200 });
  cancellation.resolve();
  await flush();
  second.resolve({ uri: entries[1].uri, status: 200 });
  expect(await result).toBe(entries[1].uri);
  expect(fs.deleteAsync).toHaveBeenCalledWith(entries[0].uri, { idempotent: true });
  expect(fs.deleteAsync).not.toHaveBeenCalledWith(entries[1].uri, expect.anything());
  expect(jest.getTimerCount()).toBe(0);
});

it('creates different cache files for concurrent invocations that share the caller filename', async () => {
  const { fs, entries } = fixture([{}, {}]);
  const result = await Promise.all([
    downloadApkFromRoutes([primary], target, { fileSystem: fs }),
    downloadApkFromRoutes([primary], target, { fileSystem: fs }),
  ]);
  expect(new Set(result).size).toBe(2);
  expect(entries[0].uri).not.toBe(entries[1].uri);
});

it('rejects an unexpected returned URI without inspecting or deleting somebody else\'s file', async () => {
  const foreign = 'file:///private/database.db';
  const { fs, entries } = fixture([{ returnedUri: foreign }, {}]);
  const result = await downloadApkFromRoutes([primary, relay], target, { fileSystem: fs });
  expect(result).toBe(entries[1].uri);
  expect(fs.getInfoAsync).not.toHaveBeenCalledWith(foreign);
  expect(fs.deleteAsync).not.toHaveBeenCalledWith(foreign, expect.anything());
});

it('reports no routes with a safe explicit error and never starts a native task', async () => {
  const { fs } = fixture([]);
  await expect(downloadApkFromRoutes([], target, { fileSystem: fs })).rejects.toThrow('没有可用的安装包下载线路');
  expect(fs.createDownloadResumable).not.toHaveBeenCalled();
});

it('still uses the next route if native cancellation rejects with a credential-bearing exception', async () => {
  const pending = deferred<Result>();
  const cancellation = deferred<void>();
  const { fs, entries } = fixture([{ pending, cancel: cancellation }, {}]);
  const result = downloadApkFromRoutes([primary, relay], target, {
    fileSystem: fs, firstProgressTimeoutMs: 120,
  });
  await flush();
  await jest.advanceTimersByTimeAsync(120);
  cancellation.reject(new Error(`native cancel ${primary}`));
  await flush();
  expect(await result).toBe(entries[1].uri);
  pending.reject(new Error(`late network ${primary}`));
  await flush();
  expect(jest.getTimerCount()).toBe(0);
});

it('sanitizes synchronous filesystem cleanup failures and does not lose fallback', async () => {
  const { fs, entries } = fixture([{ error: new Error(primary) }, {}]);
  fs.deleteAsync.mockImplementation(() => { throw new Error(`cleanup ${primary}`); });
  await expect(downloadApkFromRoutes([primary, relay], target, { fileSystem: fs })).resolves.toBeDefined();
  expect(entries).toHaveLength(2);
});

it('finishes and clears watchdogs even if a UI progress callback throws', async () => {
  const pending = deferred<Result>();
  const { fs, entries } = fixture([{ pending }]);
  const result = downloadApkFromRoutes([primary], target, {
    fileSystem: fs, onProgress: () => { throw new Error('UI disappeared'); },
  });
  await flush();
  entries[0].progress({ totalBytesWritten: 30, totalBytesExpectedToWrite: 100 });
  pending.resolve({ uri: entries[0].uri, status: 200 });
  expect(await result).toBe(entries[0].uri);
  expect(jest.getTimerCount()).toBe(0);
});
