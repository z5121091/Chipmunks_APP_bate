import { requireOptionalNativeModule } from 'expo';
import { Base64 } from 'js-base64';

export type ApkUpdateArtifact = { artifactId: string; expectedSize: number };

type ArtifactHeaders = Record<string, string> | Pick<Headers, 'get'> | undefined | null;

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Both native download headers and Fetch Headers are supported, without retaining URLs. */
export function artifactFromDownload(headers: ArtifactHeaders): ApkUpdateArtifact | null {
  try {
    const read = (name: string): string | undefined => {
      if (!headers) return undefined;
      if (typeof headers.get === 'function') return headers.get(name)?.trim() || undefined;
      const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
      if (entries.length !== 1 || typeof entries[0][1] !== 'string') return undefined;
      return entries[0][1].trim() || undefined;
    };
    const length = read('content-length');
    if (!length || !/^\d+$/.test(length)) return null;
    const expectedSize = Number(length);
    if (!positiveInteger(expectedSize)) return null;

    // A compressed response length does not identify the uncompressed APK on disk.
    const encoding = read('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') return null;

    const etag = read('etag');
    // Weak ETags permit different bytes; they cannot validate an executable cache.
    if (etag && etag.length <= 1024 && /^"[\x21\x23-\x7e\x80-\xff]+"$/.test(etag)) {
      // Encode the opaque server token: even a legal URL-shaped ETag must not
      // turn the persisted identity into something resembling an endpoint.
      return { artifactId: JSON.stringify(['etag', Base64.encode(etag), expectedSize]), expectedSize };
    }
    const modified = read('last-modified');
    const modifiedAt = modified ? Date.parse(modified) : Number.NaN;
    if (Number.isFinite(modifiedAt) && new Date(modifiedAt).toUTCString() === modified) {
      return { artifactId: JSON.stringify(['modified', modifiedAt, expectedSize]), expectedSize };
    }
  } catch {
    // Native header or parser errors may contain private endpoint information.
  }
  return null;
}

export type ProbeApkUpdateArtifactOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** A bounded HEAD request only; missing validators safely disable cache reuse. */
export async function probeApkUpdateArtifact(
  urls: readonly string[],
  { fetchImpl = globalThis.fetch, timeoutMs = 2500 }: ProbeApkUpdateArtifactOptions = {},
): Promise<ApkUpdateArtifact | null> {
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2500;
  for (const value of urls) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = new URL(value);
      if (!['http:', 'https:'].includes(request.protocol)) continue;
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
      if (request.username || request.password) {
        headers.Authorization = `Basic ${Base64.encode(`${decodeURIComponent(request.username)}:${decodeURIComponent(request.password)}`)}`;
      }
      request.username = '';
      request.password = '';
      request.hash = '';
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
      const expired = new Promise<null>(resolve => {
        timer = setTimeout(() => {
          resolve(null);
          try { controller?.abort(); } catch { /* The independent deadline still settles. */ }
        }, boundedTimeout);
      });
      const probe = async () => {
        const response = await fetchImpl(request.toString(), {
          method: 'HEAD', headers, redirect: 'error', ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response.ok) return null;
        return artifactFromDownload(response.headers);
      };
      const artifact = await Promise.race([probe(), expired]);
      if (artifact) return artifact;
    } catch {
      // No native exception or authenticated URL is exposed by this optional probe.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return null;
}

/** Read the APK-embedded native config, never the OTA-selected Expo config or JS version. */
export function readInstalledApkVersionCode(): number | undefined {
  try {
    const native = requireOptionalNativeModule<{ manifest?: unknown }>('ExponentConstants');
    const manifest: unknown = typeof native?.manifest === 'string' ? JSON.parse(native.manifest) : native?.manifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined;
    const android = (manifest as { android?: unknown }).android;
    if (!android || typeof android !== 'object' || Array.isArray(android)) return undefined;
    const versionCode = (android as { versionCode?: unknown }).versionCode;
    return positiveInteger(versionCode) ? versionCode : undefined;
  } catch {
    return undefined;
  }
}
