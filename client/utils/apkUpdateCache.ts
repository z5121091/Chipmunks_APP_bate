import * as FileSystem from 'expo-file-system/legacy';

export type ApkCacheTarget = {
  androidPackage: string;
  versionCode: number;
  version: string;
  /** Remote hash/ETag identity only. Never put an authenticated download URL here. */
  artifactId?: string;
  expectedSize?: number;
};

export type CachedApk = { uri: string; size: number; md5: string };
export type RememberedApk = CachedApk & { persisted: boolean };

export type ApkCacheFileSystem = {
  getInfoAsync(uri: string, options?: { md5: boolean }): Promise<{
    exists: boolean; isDirectory?: boolean; size?: number; md5?: string;
  }>;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, content: string): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
};

type RetiredApk = { fileName: string; androidPackage: string; versionCode: number };
type CacheEntry = RetiredApk & { target: ApkCacheTarget; size: number; md5: string };
type CacheIndex = { schemaVersion: 1; current: CacheEntry | null; retired: RetiredApk[] };
type CacheOptions = {
  fileSystem?: ApkCacheFileSystem;
  cacheDirectory?: string | null;
  documentDirectory?: string | null;
};

const OWN_APK_NAME = /^installer-\d+-\d+-\d+\.apk$/;
const MD5 = /^[a-f0-9]{32}$/i;
let writeSequence = 0;
const emptyIndex = (): CacheIndex => ({ schemaVersion: 1, current: null, retired: [] });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isPackage = (value: unknown): value is string => typeof value === 'string' && /^[a-z]\w*(?:\.[a-z]\w*)+$/i.test(value);
const isCode = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isSize = isCode;
const validTarget = (value: unknown): value is ApkCacheTarget => isObject(value)
  && isPackage(value.androidPackage) && isCode(value.versionCode)
  && typeof value.version === 'string' && value.version.trim().length > 0 && value.version.length <= 120
  && (value.artifactId === undefined || (typeof value.artifactId === 'string' && value.artifactId.trim().length > 0
    && value.artifactId.length <= 2048 && !/:\/{2}|[\r\n\0]/.test(value.artifactId)))
  && (value.expectedSize === undefined || isSize(value.expectedSize));

function copyTarget(value: ApkCacheTarget): ApkCacheTarget {
  if (!validTarget(value)) throw new Error('安装包缓存目标无效，请重新检查更新');
  return {
    androidPackage: value.androidPackage, versionCode: value.versionCode, version: value.version,
    ...(value.artifactId ? { artifactId: value.artifactId } : {}),
    ...(value.expectedSize ? { expectedSize: value.expectedSize } : {}),
  };
}

function validRetired(value: unknown): value is RetiredApk {
  return isObject(value) && typeof value.fileName === 'string' && OWN_APK_NAME.test(value.fileName)
    && isPackage(value.androidPackage) && isCode(value.versionCode);
}

function validEntry(value: unknown): value is CacheEntry {
  if (!isObject(value)) return false;
  const row: Record<string, unknown> = value;
  return validRetired(value) && validTarget(row.target)
    && row.target.androidPackage === value.androidPackage && row.target.versionCode === value.versionCode
    && isSize(row.size) && typeof row.md5 === 'string' && MD5.test(row.md5);
}

/** RN's URL shim cannot safely parse file:// paths. Reject aliases and traversal directly. */
function localPath(uri: string): string {
  if (!/^file:\/\/\//i.test(uri) || /[?#]/.test(uri)) throw new Error('安装包缓存路径无效');
  let decoded: string;
  try { decoded = decodeURIComponent(uri.slice('file://'.length)); }
  catch { throw new Error('安装包缓存路径无效'); }
  if (/[\0\\?#]/.test(decoded) || decoded.startsWith('//')
    || decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('安装包缓存路径无效');
  return /^\/[a-z]:\//i.test(decoded) ? decoded.toLowerCase() : decoded;
}

/**
 * Only completed installer files are reusable. This index never touches business data.
 * Changing targets retires references, preserving files an Android installer may still read.
 */
export function createApkUpdateCache(options: CacheOptions = {}) {
  const fs = options.fileSystem ?? FileSystem;
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => undefined);
    return result;
  };
  const root = () => {
    const base = options.cacheDirectory === undefined ? FileSystem.cacheDirectory : options.cacheDirectory;
    const fallback = options.documentDirectory === undefined ? FileSystem.documentDirectory : options.documentDirectory;
    const directory = base || fallback;
    if (!directory) throw new Error('当前设备没有可用的安装包缓存目录');
    const uri = `${directory.replace(/\/+$/, '')}/apk-update-cache/`;
    localPath(uri);
    return uri;
  };
  const ownedName = (uri: string): string => {
    const path = localPath(uri);
    const directory = localPath(root());
    const name = path.slice(directory.length);
    if (!path.startsWith(directory) || !OWN_APK_NAME.test(name)) throw new Error('安装包不是本应用下载的缓存文件');
    return name;
  };
  const safeDelete = async (uri: string) => {
    try { await fs.deleteAsync(uri, { idempotent: true }); return true; }
    catch { return false; }
  };
  const load = async (): Promise<CacheIndex> => {
    const record = `${root()}completed.json`;
    let source: string;
    try {
      if (!(await fs.getInfoAsync(record)).exists) return emptyIndex();
      source = await fs.readAsStringAsync(record);
    } catch { return emptyIndex(); }
    try {
      const value: unknown = JSON.parse(source);
      if (!isObject(value) || value.schemaVersion !== 1 || (value.current !== null && !validEntry(value.current))
        || !Array.isArray(value.retired) || !value.retired.every(validRetired)) throw new Error('invalid index');
      return value as unknown as CacheIndex;
    } catch {
      // A poisoned record must never supply an arbitrary file path for deletion.
      await safeDelete(record);
      return emptyIndex();
    }
  };
  const save = async (index: CacheIndex): Promise<boolean> => {
    const directory = root();
    const temporary = `${directory}completed-${Date.now()}-${++writeSequence}.tmp`;
    try {
      await fs.makeDirectoryAsync(directory, { intermediates: true });
      await fs.writeAsStringAsync(temporary, JSON.stringify(index));
      await fs.moveAsync({ from: temporary, to: `${directory}completed.json` });
      return true;
    } catch {
      // In particular, do not delete the fully downloaded APK on metadata failure.
      return false;
    } finally { await safeDelete(temporary); }
  };
  const retire = (index: CacheIndex) => {
    if (!index.current) return;
    const { fileName, androidPackage, versionCode } = index.current;
    if (!index.retired.some(item => item.fileName === fileName)) index.retired.push({ fileName, androidPackage, versionCode });
    index.current = null;
  };

  return {
    getApkCacheDownloadUri: () => serial(async () => {
      const directory = root();
      try { await fs.makeDirectoryAsync(directory, { intermediates: true }); }
      catch { throw new Error('无法创建安装包缓存目录，请检查存储空间'); }
      return `${directory}installer.apk`;
    }),
    readCachedApk: (input: ApkCacheTarget): Promise<CachedApk | null> => serial(async () => {
      const target = copyTarget(input);
      const index = await load();
      const entry = index.current;
      if (!entry) return null;
      const saved = entry.target;
      if (!target.artifactId || !saved.artifactId || target.androidPackage !== saved.androidPackage
        || target.versionCode !== saved.versionCode || target.version !== saved.version || target.artifactId !== saved.artifactId
        || (target.expectedSize !== undefined && target.expectedSize !== entry.size)) {
        retire(index);
        await save(index);
        return null;
      }
      const uri = `${root()}${entry.fileName}`;
      let info: Awaited<ReturnType<ApkCacheFileSystem['getInfoAsync']>>;
      try { info = await fs.getInfoAsync(uri, { md5: true }); }
      catch { return null; }
      if (!info.exists || info.isDirectory || info.size !== entry.size || !info.md5 || info.md5.toLowerCase() !== entry.md5.toLowerCase()) {
        retire(index);
        await save(index);
        return null;
      }
      return { uri, size: entry.size, md5: entry.md5 };
    }),
    rememberDownloadedApk: (input: ApkCacheTarget, uri: string): Promise<RememberedApk> => serial(async () => {
      const target = copyTarget(input);
      const fileName = ownedName(uri);
      let info: Awaited<ReturnType<ApkCacheFileSystem['getInfoAsync']>>;
      try { info = await fs.getInfoAsync(uri, { md5: true }); }
      catch { throw new Error('无法校验已下载的安装包，请重新下载'); }
      if (!info.exists || info.isDirectory || !isSize(info.size) || !info.md5 || !MD5.test(info.md5)
        || (target.expectedSize !== undefined && target.expectedSize !== info.size)) {
        throw new Error('已下载的安装包不完整，请重新下载');
      }
      const index = await load();
      retire(index);
      index.retired = index.retired.filter(item => item.fileName !== fileName);
      const item = { fileName, androidPackage: target.androidPackage, versionCode: target.versionCode };
      if (target.artifactId) index.current = { ...item, target, size: info.size, md5: info.md5.toLowerCase() };
      else index.retired.push(item);
      const persisted = await save(index);
      return { uri, size: info.size, md5: info.md5.toLowerCase(), persisted: !!target.artifactId && persisted };
    }),
    /** Pass the actual native installed build, never a version supplied by OTA JavaScript. */
    clearInstalledApkCache: (androidPackage: string, nativeVersionCode: number): Promise<void> => serial(async () => {
      if (!isPackage(androidPackage) || !isCode(nativeVersionCode)) return;
      const index = await load();
      if (index.current?.androidPackage === androidPackage && index.current.versionCode <= nativeVersionCode) retire(index);
      const retained: RetiredApk[] = [];
      for (const item of index.retired) {
        if (item.androidPackage !== androidPackage || item.versionCode > nativeVersionCode
          || !await safeDelete(`${root()}${item.fileName}`)) retained.push(item);
      }
      index.retired = retained;
      await save(index);
    }),
  };
}

const defaultCache = createApkUpdateCache();
export const { getApkCacheDownloadUri, readCachedApk, rememberDownloadedApk, clearInstalledApkCache } = defaultCache;
