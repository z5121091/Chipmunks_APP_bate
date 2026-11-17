import { Base64 } from 'js-base64';

const PRIMARY_HOST = 'zx5121091.pw';
const RELAY_HOST = 'dav.zx5121091.fnos.net';

/** Verified protocol, port and base path; callers may override these endpoints in tests. */
export interface ApkUpdateRouteConfig {
  primaryBaseUrl: string;
  fallbackBaseUrl: string;
}

// Both paths were verified to serve the same manifest/APK. Credentials remain
// in the user's private NAS configuration and are never embedded here.
export const APK_UPDATE_ROUTES: ApkUpdateRouteConfig = Object.freeze({
  primaryBaseUrl: 'https://zx5121091.pw:5006/AppUpdate',
  fallbackBaseUrl: 'https://dav.zx5121091.fnos.net/AppUpdate',
});

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function knownHost(url: URL) {
  return url.hostname.toLowerCase() === PRIMARY_HOST || url.hostname.toLowerCase() === RELAY_HOST;
}

function withCredentials(target: URL, source: URL) {
  // Never inherit credentials into a third-party server. Explicit destination
  // credentials win; the two known NAS routes may share the configured account.
  if (knownHost(target) && knownHost(source) && !target.username && !target.password) {
    target.username = source.username;
    target.password = source.password;
  }
  return target;
}

function baseUrl(url: URL) {
  const result = new URL(url.toString());
  result.pathname = result.pathname.replace(/\/+$/, '') || '/';
  result.hash = '';
  return result;
}

function directoryUrl(url: URL) {
  const result = baseUrl(url);
  result.pathname = `${result.pathname.replace(/\/+$/, '')}/`;
  return result;
}

function unique(urls: string[]) {
  return [...new Set(urls)];
}

/** Read-only routing: it never writes or migrates the saved NAS/backup destination. */
export function getApkUpdateServers(configuredBase: string, routes: ApkUpdateRouteConfig = APK_UPDATE_ROUTES): string[] {
  const configured = parseHttpUrl(configuredBase);
  if (!configured) throw new Error('APK更新服务器地址无效');
  if (!routes || !knownHost(configured)) return [baseUrl(configured).toString()];

  const primary = parseHttpUrl(routes.primaryBaseUrl);
  const fallback = parseHttpUrl(routes.fallbackBaseUrl);
  if (primary?.hostname.toLowerCase() !== PRIMARY_HOST || fallback?.hostname.toLowerCase() !== RELAY_HOST) {
    throw new Error('APK更新线路配置无效');
  }
  return unique([primary, fallback].map(candidate => withCredentials(baseUrl(candidate), configured).toString()));
}

/**
 * Known NAS routes are grouped primary -> relay, even when a relay manifest
 * contains only absolute relay links. Custom servers keep the manifest order.
 */
export function resolveApkDownloadUrls(
  downloadUrl: unknown,
  downloadUrls: unknown,
  manifestBase: string,
  originalConfiguredBase: string,
  routes: ApkUpdateRouteConfig = APK_UPDATE_ROUTES,
): string[] {
  const manifest = parseHttpUrl(manifestBase);
  const original = parseHttpUrl(originalConfiguredBase);
  if (!manifest || !original) throw new Error('APK更新服务器地址无效');

  const grouped = Boolean(routes && knownHost(original) && knownHost(manifest));
  const servers = grouped ? getApkUpdateServers(originalConfiguredBase, routes).map(value => new URL(value)) : [baseUrl(manifest)];
  const buckets: string[][] = grouped ? [[], [], []] : [[]];
  const append = (candidate: URL) => {
    const rank = grouped ? candidate.hostname.toLowerCase() === PRIMARY_HOST ? 0
      : candidate.hostname.toLowerCase() === RELAY_HOST ? 1 : 2 : 0;
    buckets[rank].push(candidate.toString());
  };

  for (const candidate of [...(Array.isArray(downloadUrls) ? downloadUrls : []), downloadUrl, 'app-release.apk']) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate.trim(), directoryUrl(manifest));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }

    if (grouped && knownHost(parsed)) {
      for (const server of servers) {
        const mirror = new URL(server.toString());
        // Keep the file path/query from an absolute link. Relative links resolve
        // independently against each route's own base directory.
        const absolute = /^[a-z][a-z\d+.-]*:|^\/\//i.test(candidate.trim());
        if (absolute) {
          mirror.pathname = parsed.pathname;
          mirror.search = parsed.search;
          mirror.hash = parsed.hash;
          if (mirror.hostname.toLowerCase() === parsed.hostname.toLowerCase() && (parsed.username || parsed.password)) {
            mirror.username = parsed.username;
            mirror.password = parsed.password;
          } else {
            withCredentials(mirror, parsed);
          }
          append(withCredentials(mirror, manifest));
        } else {
          append(withCredentials(new URL(candidate.trim(), directoryUrl(server)), manifest));
        }
      }
    } else {
      // URL resolution already inherits credentials for same-origin relative
      // links, but absolute third-party links receive no NAS credentials.
      append(parsed);
    }
  }
  return unique(buckets.flat());
}

export interface ApkUpdateManifest {
  androidPackage: string;
  version: string;
  downloadUrl?: unknown;
  downloadUrls?: unknown;
  [field: string]: unknown;
}

type FailureReason = 'timeout' | 'network' | 'http' | 'json' | 'structure' | 'package';
export interface ApkManifestFailure {
  route: 'primary' | 'relay' | 'custom';
  reason: FailureReason;
  status?: number;
}

class ManifestFailure extends Error {
  constructor(readonly reason: FailureReason, readonly status?: number) {
    super(reason);
  }
}

export class ApkUpdateManifestError extends Error {
  constructor(readonly failures: ApkManifestFailure[]) {
    super('无法读取APK更新清单，请检查网络或更新服务器配置');
    this.name = 'ApkUpdateManifestError';
  }
}

export interface FetchApkUpdateManifestOptions {
  androidPackage: string;
  routes?: ApkUpdateRouteConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Each route gets one bounded request, including JSON parsing; no slow-speed probing. */
export async function fetchApkUpdateManifest(
  configuredBase: string,
  { androidPackage, routes = APK_UPDATE_ROUTES, fetchImpl = globalThis.fetch, timeoutMs = 5000 }: FetchApkUpdateManifestOptions,
): Promise<{ data: ApkUpdateManifest; manifestBaseUrl: string }> {
  const failures: ApkManifestFailure[] = [];
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
  for (const server of getApkUpdateServers(configuredBase, routes)) {
    const base = new URL(server);
    const request = new URL('version.json', directoryUrl(base));
    const headers: Record<string, string> = { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
    if (request.username || request.password) {
      try {
        headers.Authorization = `Basic ${Base64.encode(`${decodeURIComponent(request.username)}:${decodeURIComponent(request.password)}`)}`;
      } catch {
        throw new Error('APK更新服务器认证配置无效');
      }
      request.username = '';
      request.password = '';
    }
    request.searchParams.set('t', String(Date.now()));
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ManifestFailure('timeout'));
          try { controller?.abort(); } catch { /* A timeout still releases this route if cancellation is unsupported. */ }
        }, boundedTimeout);
      });
      const read = async () => {
        const response = await fetchImpl(request.toString(), { method: 'GET', headers, ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) throw new ManifestFailure('http', response.status);
        let data: unknown;
        try { data = await response.json(); } catch { throw new ManifestFailure('json'); }
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
          typeof (data as ApkUpdateManifest).version !== 'string' || !(data as ApkUpdateManifest).version.trim()) {
          throw new ManifestFailure('structure');
        }
        if ((data as ApkUpdateManifest).androidPackage !== androidPackage) throw new ManifestFailure('package');
        return data as ApkUpdateManifest;
      };
      const data = await Promise.race([read(), deadline]);
      return { data, manifestBaseUrl: server };
    } catch (error) {
      const failure = error instanceof ManifestFailure ? error : new ManifestFailure('network');
      failures.push({
        route: base.hostname.toLowerCase() === PRIMARY_HOST ? 'primary' : base.hostname.toLowerCase() === RELAY_HOST ? 'relay' : 'custom',
        reason: failure.reason,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw new ApkUpdateManifestError(failures);
}
