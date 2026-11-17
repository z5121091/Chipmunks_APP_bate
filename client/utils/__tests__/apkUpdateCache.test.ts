jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///documents/' }));

import { createHash } from 'node:crypto';
import { createApkUpdateCache, type ApkCacheFileSystem, type ApkCacheTarget } from '../apkUpdateCache';

const root = 'file:///cache/apk-update-cache/';
const first = `${root}installer-1700000000000-1-1.apk`;
const second = `${root}installer-1700000000001-2-1.apk`;
const third = `${root}installer-1700000000002-3-1.apk`;
const record = `${root}completed.json`;
const target: ApkCacheTarget = {
  androidPackage: 'com.chipmunks.traceability', versionCode: 201, version: 'V1.02', artifactId: 'etag:build-a', expectedSize: 12,
};
const data = 'apk-contents';

function fixture() {
  const files = new Map<string, string>();
  const state = { failWrite: false, failMove: false, unreadableApk: false, undeletableApk: false };
  const fs: jest.Mocked<ApkCacheFileSystem> = {
    getInfoAsync: jest.fn(async (uri, options) => {
      if (state.unreadableApk && uri.endsWith('.apk')) throw new Error('private native path');
      const content = files.get(uri);
      if (content === undefined) return { exists: false };
      return {
        exists: true, isDirectory: false, size: Buffer.byteLength(content),
        ...(options?.md5 ? { md5: createHash('md5').update(content).digest('hex') } : {}),
      };
    }),
    makeDirectoryAsync: jest.fn(async () => undefined),
    readAsStringAsync: jest.fn(async uri => {
      const value = files.get(uri);
      if (value === undefined) throw new Error('missing');
      return value;
    }),
    writeAsStringAsync: jest.fn(async (uri, content) => {
      if (state.failWrite) throw new Error('private native path');
      files.set(uri, content);
    }),
    moveAsync: jest.fn(async ({ from, to }) => {
      if (state.failMove) throw new Error('private native path');
      const value = files.get(from);
      if (value === undefined) throw new Error('missing');
      files.set(to, value);
      files.delete(from);
    }),
    deleteAsync: jest.fn(async uri => {
      if (state.undeletableApk && uri.endsWith('.apk')) throw new Error('busy installer');
      files.delete(uri);
    }),
  };
  const make = () => createApkUpdateCache({ fileSystem: fs, cacheDirectory: 'file:///cache/' });
  return { files, state, fs, make, cache: make() };
}

it('uses an app-private subdirectory and returns the downloader base URI', async () => {
  const { cache, fs } = fixture();
  expect(await cache.getApkCacheDownloadUri()).toBe(`${root}installer.apk`);
  expect(fs.makeDirectoryAsync).toHaveBeenCalledWith(root, { intermediates: true });
});

it('falls back to its own document subdirectory when the cache directory is unavailable', async () => {
  const { fs } = fixture();
  const cache = createApkUpdateCache({ fileSystem: fs, cacheDirectory: null, documentDirectory: 'file:///documents/' });
  expect(await cache.getApkCacheDownloadUri()).toBe('file:///documents/apk-update-cache/installer.apk');
});

it('does not expose native errors when the cache directory cannot be created', async () => {
  const { cache, fs } = fixture();
  fs.makeDirectoryAsync.mockRejectedValueOnce(new Error('sensitive native location'));
  await expect(cache.getApkCacheDownloadUri()).rejects.toThrow('无法创建安装包缓存目录');
});

it('records only completed files and restores a verified APK after an app restart', async () => {
  const { cache, make, files, fs } = fixture();
  files.set(first, data);
  const remembered = await cache.rememberDownloadedApk(target, first);
  expect(remembered).toEqual({ uri: first, size: 12, md5: createHash('md5').update(data).digest('hex'), persisted: true });
  expect(await make().readCachedApk(target)).toEqual({ uri: first, size: 12, md5: remembered.md5 });
  expect(fs.getInfoAsync).toHaveBeenCalledWith(first, { md5: true });
  const index = JSON.parse(files.get(record)!);
  expect(index.current.fileName).toBe('installer-1700000000000-1-1.apk');
  expect(files.get(record)).not.toContain('file:///');
});

it('keeps a completed file reusable through repeated canceled installation attempts', async () => {
  const { cache, files } = fixture();
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  for (let attempt = 0; attempt < 4; attempt++) expect(await cache.readCachedApk(target)).toMatchObject({ uri: first });
  await cache.clearInstalledApkCache(target.androidPackage, 200);
  expect(await cache.readCachedApk(target)).toMatchObject({ uri: first });
  expect(files.has(first)).toBe(true);
});

it.each([
  ['a different package', { ...target, androidPackage: 'com.example.other' }],
  ['a different version code', { ...target, versionCode: 202 }],
  ['a different version label', { ...target, version: 'V1.03' }],
  ['a replacement at the same version', { ...target, artifactId: 'etag:build-b' }],
  ['an unknown remote artifact', { ...target, artifactId: undefined }],
  ['a changed content length', { ...target, expectedSize: 13 }],
])('retires the reference for %s without deleting a file the installer may still be reading', async (_name, changed) => {
  const { cache, make, files } = fixture();
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  expect(await cache.readCachedApk(changed)).toBeNull();
  expect(await make().readCachedApk(target)).toBeNull();
  expect(files.get(first)).toBe(data);
  expect(JSON.parse(files.get(record)!).retired).toEqual([
    { fileName: 'installer-1700000000000-1-1.apk', androidPackage: target.androidPackage, versionCode: target.versionCode },
  ]);
});

it.each(['missing', 'truncated', 'same-size corruption'])('invalidates a %s APK while preserving its cleanup metadata', async mode => {
  const { cache, files } = fixture();
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  if (mode === 'missing') files.delete(first);
  else files.set(first, mode === 'truncated' ? 'a' : 'APK-CONTENTS');
  expect(await cache.readCachedApk(target)).toBeNull();
  expect(JSON.parse(files.get(record)!).current).toBeNull();
  expect(JSON.parse(files.get(record)!).retired).toHaveLength(1);
});

it('preserves the record and APK on a transient filesystem read failure', async () => {
  const { cache, files, state } = fixture();
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  const originalRecord = files.get(record);
  state.unreadableApk = true;
  expect(await cache.readCachedApk(target)).toBeNull();
  expect(files.get(record)).toBe(originalRecord);
  state.unreadableApk = false;
  expect(await cache.readCachedApk(target)).toMatchObject({ uri: first });
});

it.each(['write', 'rename'])('retains the downloaded file after a metadata %s failure without claiming durable reuse', async mode => {
  const { cache, make, files, state } = fixture();
  files.set(first, data);
  if (mode === 'write') state.failWrite = true;
  else state.failMove = true;
  expect(await cache.rememberDownloadedApk(target, first)).toMatchObject({ uri: first, persisted: false });
  expect(files.get(first)).toBe(data);
  expect(await make().readCachedApk(target)).toBeNull();
  expect([...files.keys()].filter(uri => uri.endsWith('.tmp'))).toEqual([]);
});

it('does not claim reusable persistence when the server artifact identity is unavailable', async () => {
  const { cache, make, files } = fixture();
  files.set(first, data);
  expect(await cache.rememberDownloadedApk({ ...target, artifactId: undefined }, first)).toMatchObject({ persisted: false });
  expect(await make().readCachedApk(target)).toBeNull();
  expect(files.get(first)).toBe(data);
  await cache.clearInstalledApkCache(target.androidPackage, 201);
  expect(files.has(first)).toBe(false);
});

it('persists retirement across several replacements and cleans only confirmed installed versions', async () => {
  const { cache, make, files } = fixture();
  files.set(first, data);
  files.set(second, data);
  files.set(third, data);
  const newer = { ...target, versionCode: 202, artifactId: 'etag:b' };
  const newest = { ...target, versionCode: 203, artifactId: 'etag:c' };
  await cache.rememberDownloadedApk(target, first);
  await cache.rememberDownloadedApk(newer, second);
  await cache.rememberDownloadedApk(newest, third);
  expect(files.get(first)).toBe(data);
  await make().clearInstalledApkCache(target.androidPackage, 202);
  expect(files.has(first)).toBe(false);
  expect(files.has(second)).toBe(false);
  expect(files.get(third)).toBe(data);
  expect(await make().readCachedApk(newest)).toMatchObject({ uri: third });
  await make().clearInstalledApkCache(target.androidPackage, 203);
  expect(files.has(third)).toBe(false);
  expect(await make().readCachedApk(newest)).toBeNull();
});

it('does not clean a different application or a newer version, and retries failed cleanup later', async () => {
  const { cache, make, files, state } = fixture();
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  await cache.clearInstalledApkCache('com.example.other', 999);
  await cache.clearInstalledApkCache(target.androidPackage, 200);
  expect(files.get(first)).toBe(data);
  state.undeletableApk = true;
  await cache.clearInstalledApkCache(target.androidPackage, 201);
  expect(files.get(first)).toBe(data);
  expect(await cache.readCachedApk(target)).toBeNull();
  state.undeletableApk = false;
  await make().clearInstalledApkCache(target.androidPackage, 201);
  expect(files.has(first)).toBe(false);
});

it.each([
  'file:///documents/warehouse.db',
  'file:///cache/installer-1700000000000-1-1.apk',
  `${root}../installer-1700000000000-1-1.apk`,
  `${root}%2e%2e/installer-1700000000000-1-1.apk`,
  `${root}sub/installer-1700000000000-1-1.apk`,
  `${first}?fake=1`,
  `${root}installer.apk`,
  `${root}completed.json`,
])('rejects nonowned or aliased downloaded file URI %s without touching it', async uri => {
  const { cache, files, fs } = fixture();
  files.set(uri, data);
  await expect(cache.rememberDownloadedApk(target, uri)).rejects.toThrow();
  expect(files.get(uri)).toBe(data);
  expect(fs.deleteAsync).not.toHaveBeenCalledWith(uri, expect.anything());
});

it('does not rely on the React Native URL shim for cache file paths', async () => {
  const original = global.URL;
  global.URL = class { constructor() { throw new Error('file URL unsupported'); } } as unknown as typeof URL;
  try {
    const { cache, files } = fixture();
    files.set(first, data);
    expect(await cache.rememberDownloadedApk(target, first)).toMatchObject({ persisted: true });
    expect(await cache.readCachedApk(target)).toMatchObject({ uri: first });
  } finally { global.URL = original; }
});

it('discards poisoned metadata without reading or deleting a path outside its private directory', async () => {
  const { cache, files, fs } = fixture();
  const businessDb = 'file:///documents/SQLite/warehouse.db';
  files.set(businessDb, 'core business data');
  files.set(first, data);
  await cache.rememberDownloadedApk(target, first);
  const index = JSON.parse(files.get(record)!);
  index.current.fileName = '../../documents/SQLite/warehouse.db';
  files.set(record, JSON.stringify(index));
  expect(await cache.readCachedApk(target)).toBeNull();
  await cache.clearInstalledApkCache(target.androidPackage, 999);
  expect(files.get(businessDb)).toBe('core business data');
  expect(fs.getInfoAsync).not.toHaveBeenCalledWith(businessDb, expect.anything());
  expect(fs.deleteAsync).not.toHaveBeenCalledWith(businessDb, expect.anything());
});

it('cleans only indexed owned APKs, leaving unrelated cached files and unknown files intact', async () => {
  const { cache, files } = fixture();
  files.set(first, data);
  files.set(second, 'unknown orphan');
  files.set(`${root}notes.txt`, 'user text');
  files.set('file:///cache/warehouse.db', 'business data');
  await cache.rememberDownloadedApk(target, first);
  await cache.clearInstalledApkCache(target.androidPackage, 201);
  expect(files.has(first)).toBe(false);
  expect(files.get(second)).toBe('unknown orphan');
  expect(files.get(`${root}notes.txt`)).toBe('user text');
  expect(files.get('file:///cache/warehouse.db')).toBe('business data');
});

it('rejects empty files, mismatched server lengths, and files without a native checksum', async () => {
  const { cache, files, fs } = fixture();
  files.set(first, '');
  await expect(cache.rememberDownloadedApk(target, first)).rejects.toThrow('安装包不完整');
  files.set(first, 'short');
  await expect(cache.rememberDownloadedApk(target, first)).rejects.toThrow('安装包不完整');
  files.set(first, data);
  fs.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 12 });
  await expect(cache.rememberDownloadedApk(target, first)).rejects.toThrow('安装包不完整');
  expect(files.has(first)).toBe(true);
  expect(files.has(record)).toBe(false);
});

it('rejects credentials or URLs as an artifact identity', async () => {
  const { cache, files } = fixture();
  files.set(first, data);
  await expect(cache.rememberDownloadedApk({ ...target, artifactId: 'https://user:password@host/path.apk' }, first)).rejects.toThrow('缓存目标无效');
  expect(files.has(record)).toBe(false);
});

it('serializes simultaneous cache mutations without dropping the retired entry', async () => {
  const { cache, files } = fixture();
  files.set(first, data);
  files.set(second, data);
  await Promise.all([
    cache.rememberDownloadedApk(target, first),
    cache.rememberDownloadedApk({ ...target, versionCode: 202, artifactId: 'etag:b' }, second),
  ]);
  const index = JSON.parse(files.get(record)!);
  expect(index.current.fileName).toBe('installer-1700000000001-2-1.apk');
  expect(index.retired).toHaveLength(1);
});
