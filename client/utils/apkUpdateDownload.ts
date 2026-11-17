import * as FileSystem from 'expo-file-system/legacy';
import { Base64 } from 'js-base64';

type DownloadProgress = { totalBytesWritten: number; totalBytesExpectedToWrite: number };
type DownloadResult = { uri: string; status: number; headers?: Record<string, string> };
type DownloadTask = {
  downloadAsync(): Promise<DownloadResult | undefined>;
  cancelAsync(): Promise<void>;
};

export type ApkDownloadFileSystem = {
  createDownloadResumable(
    url: string,
    uri: string,
    options: { headers: Record<string, string> },
    onProgress: (progress: DownloadProgress) => void
  ): DownloadTask;
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number }>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
};

type FailureReason = 'unavailable' | 'network' | 'timeout' | 'http' | 'empty' | 'invalid-result';
const FAILURE_MESSAGES: Record<FailureReason, string> = {
  unavailable: '没有可用的安装包下载线路，请重新检查更新',
  network: '安装包下载失败，请检查网络后重试',
  timeout: '安装包下载连接超时或长时间没有进度，请检查网络后重试',
  http: '安装包下载服务器返回错误，请稍后重试',
  empty: '下载的安装包为空，请重新检查更新',
  'invalid-result': '安装包下载结果无效，请重新检查更新',
};

/** Only allowlisted messages cross the transport boundary; never expose native URL-bearing errors. */
export class ApkDownloadError extends Error {
  readonly reason: FailureReason;
  readonly status?: number;

  constructor(reason: FailureReason, status?: number) {
    const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status : undefined;
    super(reason === 'http' && safeStatus
      ? `${FAILURE_MESSAGES.http}（HTTP ${safeStatus}）`
      : FAILURE_MESSAGES[reason]);
    this.name = 'ApkDownloadError';
    this.reason = reason;
    this.status = safeStatus;
  }
}

export type ApkDownloadOptions = {
  /** A fraction from 0 to 0.99; installation/backup remains the caller's responsibility. */
  onProgress?: (progress: number) => void;
  /** Metadata from the actual successful route, never from a preceding HEAD request. */
  onDownloaded?: (result: { headers?: Record<string, string>; size: number }) => void;
  fileSystem?: ApkDownloadFileSystem;
  firstProgressTimeoutMs?: number;
  idleTimeoutMs?: number;
  cancelTimeoutMs?: number;
};

let downloadSequence = 0;
const positiveTimeout = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const resolveRequest = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new ApkDownloadError('unavailable');
  const headers: Record<string, string> = {};
  if (url.username || url.password) {
    headers.Authorization = `Basic ${Base64.encode(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`)}`;
  }
  url.username = '';
  url.password = '';
  return { url: url.toString(), headers };
};

/** Download through ordered routes; each native task owns an isolated cache file. */
export async function downloadApkFromRoutes(
  urls: readonly string[],
  apkUri: string,
  options: ApkDownloadOptions = {}
): Promise<string> {
  const fs = options.fileSystem || FileSystem;
  const firstProgressTimeout = positiveTimeout(options.firstProgressTimeoutMs, 12_000);
  const idleTimeout = positiveTimeout(options.idleTimeoutMs, 20_000);
  const cancelTimeout = positiveTimeout(options.cancelTimeoutMs, 2_000);
  const operationId = `${Date.now()}-${++downloadSequence}`;
  const uriBase = apkUri.replace(/\.apk$/i, '');
  let lastError = new ApkDownloadError('unavailable');

  const notify = (value: number) => {
    try { options.onProgress?.(value); } catch { /* A UI callback must not leave a native download running. */ }
  };

  for (let index = 0; index < urls.length; index++) {
    const attemptUri = `${uriBase}-${operationId}-${index + 1}.apk`;
    let task: DownloadTask | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let failed = false;
    let lastBytes = 0;
    const cleanup = async () => {
      try { await fs.deleteAsync(attemptUri, { idempotent: true }); }
      catch { /* Cache cleanup must not expose a native path/URL-bearing exception. */ }
    };
    const clearWatchdog = () => { if (watchdog !== undefined) clearTimeout(watchdog); };

    try {
      const request = resolveRequest(urls[index]);
      notify(0);
      let rejectTimeout: (error: ApkDownloadError) => void = () => undefined;
      const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
      const armWatchdog = (duration: number) => {
        clearWatchdog();
        watchdog = setTimeout(() => {
          active = false;
          rejectTimeout(new ApkDownloadError('timeout'));
        }, duration);
      };
      task = fs.createDownloadResumable(request.url, attemptUri, { headers: request.headers }, progress => {
        if (!active || !Number.isFinite(progress.totalBytesWritten) || progress.totalBytesWritten <= lastBytes) return;
        lastBytes = progress.totalBytesWritten;
        // Only newly received bytes renew the deadline; duplicate progress cannot mask a stalled connection.
        armWatchdog(idleTimeout);
        if (Number.isFinite(progress.totalBytesExpectedToWrite) && progress.totalBytesExpectedToWrite > 0) {
          notify(Math.min(0.99, lastBytes / progress.totalBytesExpectedToWrite));
        }
      });
      armWatchdog(firstProgressTimeout);
      const currentTask = task;
      const nativeDownload = Promise.resolve().then(() => currentTask.downloadAsync());
      // Cancellation may itself be delayed. Any eventual native completion still cleans only its own file.
      void nativeDownload.then(
        () => { if (failed) void cleanup(); },
        () => { if (failed) void cleanup(); }
      );
      const result = await Promise.race([nativeDownload, timeout]);
      active = false;
      clearWatchdog();
      if (!result) throw new ApkDownloadError('invalid-result');
      if (!Number.isInteger(result.status) || result.status < 200 || result.status >= 300) {
        throw new ApkDownloadError('http', result.status);
      }
      // Never inspect, install or delete a URI unexpectedly returned outside this task's own cache file.
      if (result.uri !== attemptUri) throw new ApkDownloadError('invalid-result');
      const info = await fs.getInfoAsync(attemptUri);
      if (!info.exists || typeof info.size !== 'number' || !Number.isFinite(info.size) || info.size <= 0) {
        throw new ApkDownloadError('empty');
      }
      const header = (name: string) => Object.entries(result.headers || {})
        .find(([key]) => key.toLowerCase() === name)?.[1];
      const contentLength = header('content-length')?.trim();
      const encoding = header('content-encoding')?.trim().toLowerCase();
      if ((!encoding || encoding === 'identity') && contentLength && /^\d+$/.test(contentLength) &&
        Number(contentLength) !== info.size) {
        throw new ApkDownloadError('invalid-result');
      }
      try { options.onDownloaded?.({ headers: result.headers, size: info.size }); }
      catch { /* Cache bookkeeping must not turn a complete download into another network attempt. */ }
      return attemptUri;
    } catch (error) {
      active = false;
      failed = true;
      clearWatchdog();
      lastError = error instanceof ApkDownloadError ? error : new ApkDownloadError('network');
      if (task) {
        let cancelTimer: ReturnType<typeof setTimeout> | undefined;
        const currentTask = task;
        const cancellation = Promise.resolve().then(() => currentTask.cancelAsync());
        // Do invoke native cancellation, rather than abandoning an active task after Promise.race.
        // The bounded wait and per-task URI also protect fallback when the native bridge is unresponsive.
        try {
          await Promise.race([
            cancellation,
            new Promise<void>(resolve => { cancelTimer = setTimeout(resolve, cancelTimeout); }),
          ]);
        } catch { /* Native errors can contain the authenticated URL; the public error stays allowlisted. */ }
        finally { if (cancelTimer !== undefined) clearTimeout(cancelTimer); }
        void cancellation.then(() => cleanup(), () => cleanup());
      }
      await cleanup();
    } finally {
      active = false;
      clearWatchdog();
    }
  }
  throw lastError;
}
