import TestRenderer, { act } from 'react-test-renderer';
import { Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system/legacy';
import SettingsScreen from '../index';
import { ApkUpdateDialog } from '../SettingsDialogs';
import { AnimatedButton } from '@/components/AnimatedButton';
import { APK_UPDATE_ROUTES } from '@/utils/apkUpdateRoutes';
import { ApkDownloadError, downloadApkFromRoutes } from '@/utils/apkUpdateDownload';
import { clearInstalledApkCache, getApkCacheDownloadUri, readCachedApk, rememberDownloadedApk, type ApkCacheTarget } from '@/utils/apkUpdateCache';
import { artifactFromDownload, probeApkUpdateArtifact, readInstalledApkVersionCode } from '@/utils/apkUpdateArtifact';
import { AppModalActions } from '@/components/AppModalActions';
import { createRealtimeDatabaseBackupToNas } from '@/utils/nasBackup';
import { syncNativeNasBackupConfiguration } from '@/utils/nativeNasBackupConfig';
import * as update from '@/utils/update';
import { STORAGE_KEYS } from '@/constants/config';

// Render the real settings update branch, dialog and route helper. Native I/O,
// navigation focus work and the separately tested file transport are isolated.
const mockNavigation = { addListener: () => () => undefined };
const mockAlert = { showError: jest.fn(), showWarning: jest.fn(), showSuccess: jest.fn(), showConfirm: jest.fn(), AlertComponent: null };
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn(), useNavigation: () => mockNavigation }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppModal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible
    ? require('react').createElement(require('react-native').View, {}, children) : null,
}));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@/utils/toast', () => ({ useToast: () => ({ ToastContainer: () => null }) }));
jest.mock('@/utils/feedback', () => ({ initSoundSetting: jest.fn(), setSoundEnabled: jest.fn(), feedbackConfirm: jest.fn(), feedbackCancel: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/database', () => ({ STORAGE_KEYS: {} }));
jest.mock('@/utils/workDraftIsolation', () => ({}));
jest.mock('@/utils/nasBackup', () => ({ createRealtimeDatabaseBackupToNas: jest.fn() }));
jest.mock('@/utils/nativeNasBackupConfig', () => ({ syncNativeNasBackupConfiguration: jest.fn(async () => undefined) }));
jest.mock('@/utils/backupDiagnostic', () => ({}));
jest.mock('@/utils/heartbeat', () => ({}));
jest.mock('@/utils/backendApi', () => ({ buildErpProxyPath: (value: string) => value }));
jest.mock('@/utils/erpAccounts', () => ({ ERP_ACCOUNTS: [{ key: 'shanghai-chipmunk', name: '测试账套' }], isErpAccountAvailable: () => false }));
jest.mock('@/utils/syncConnection', () => {
  const snapshot = { status: 'idle', config: null };
  return { getSyncConnectionSnapshot: () => snapshot, subscribeSyncConnection: () => () => undefined };
});
jest.mock('@/utils/apkUpdateDownload', () => ({ ...jest.requireActual('@/utils/apkUpdateDownload'), downloadApkFromRoutes: jest.fn() }));
jest.mock('@/utils/apkUpdateCache', () => ({
  getApkCacheDownloadUri: jest.fn(), readCachedApk: jest.fn(), rememberDownloadedApk: jest.fn(), clearInstalledApkCache: jest.fn(),
}));
jest.mock('@/utils/apkUpdateArtifact', () => ({
  probeApkUpdateArtifact: jest.fn(), artifactFromDownload: jest.fn(), readInstalledApkVersionCode: jest.fn(),
}));
jest.mock('@/screens/app-updates', () => ({ OtaUpdatePanel: () => null }));
jest.mock('@/constants/version', () => ({ ...jest.requireActual('@/constants/version'), APP_VERSION: 'V1.00', ANDROID_VERSION_CODE: 100, SELF_UPDATE_ENABLED: true }));
jest.mock('expo-updates', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', documentDirectory: 'file:///documents/',
  getContentUriAsync: jest.fn(async () => 'content://warehouse/update.apk'),
}));

const relay = 'https://fixture-user:fixture-pass@dav.zx5121091.fnos.net/AppUpdate';
const primary = 'https://fixture-user:fixture-pass@zx5121091.pw:5006/AppUpdate';
const apkUri = 'file:///cache/apk-update-cache/installer-123-1-1.apk';
const apkDownloadUri = 'file:///cache/apk-update-cache/installer.apk';
const artifact = { artifactId: 'artifact-a', expectedSize: 100 };
const downloadMetadata = { headers: { etag: 'artifact-a', 'content-length': '100' }, size: 100 };
let cachedApk: { target: ApkCacheTarget; uri: string; size: number; md5: string } | null;
const manifest = {
  androidPackage: 'com.chipmunks.traceability', version: 'V1.01', versionCode: 200,
  downloadUrl: `${relay}/app-release.apk`, downloadUrls: [`${relay}/app-release.apk`], changelog: '更新测试',
};
const response = (body: unknown = manifest, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: jest.fn(async () => body),
}) as unknown as Response;
let root: TestRenderer.ReactTestRenderer | undefined;
let fetchMock: jest.SpyInstance;
const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await AsyncStorage.clear();
  await AsyncStorage.setItem(STORAGE_KEYS.UPDATE_SERVER_URL, relay);
  fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response());
  jest.spyOn(update, 'saveUpdateServer');
  cachedApk = null;
  jest.mocked(getApkCacheDownloadUri).mockResolvedValue(apkDownloadUri);
  jest.mocked(readInstalledApkVersionCode).mockReturnValue(100);
  jest.mocked(clearInstalledApkCache).mockResolvedValue(undefined);
  jest.mocked(probeApkUpdateArtifact).mockResolvedValue(artifact);
  jest.mocked(artifactFromDownload).mockImplementation(headers => {
    const etag = headers && Object.entries(headers).find(([name]) => name.toLowerCase() === 'etag')?.[1];
    return etag ? { artifactId: etag, expectedSize: 100 } : null;
  });
  jest.mocked(readCachedApk).mockImplementation(async target => cachedApk &&
    ['androidPackage', 'versionCode', 'version', 'artifactId', 'expectedSize'].every(key =>
      cachedApk!.target[key as keyof ApkCacheTarget] === target[key as keyof ApkCacheTarget])
    ? { uri: cachedApk.uri, size: cachedApk.size, md5: cachedApk.md5 } : null);
  jest.mocked(rememberDownloadedApk).mockImplementation(async (target, uri) => {
    if (!target.artifactId) return { uri, size: 100, md5: 'a'.repeat(32), persisted: false };
    cachedApk = { target: { ...target }, uri, size: 100, md5: 'a'.repeat(32) };
    return { uri, size: 100, md5: 'a'.repeat(32), persisted: true };
  });
  jest.mocked(downloadApkFromRoutes).mockImplementation(async (_urls, _uri, options) => {
    options?.onDownloaded?.(downloadMetadata);
    return apkUri;
  });
  jest.mocked(createRealtimeDatabaseBackupToNas).mockResolvedValue({ fileName: 'before-update.db' } as Awaited<ReturnType<typeof createRealtimeDatabaseBackupToNas>>);
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', platformDescriptor);
  jest.useRealTimers();
});

const checkButton = () => root!.root.findAllByType(AnimatedButton).find(button =>
  button.findAllByType(Text).some(text => ['检查 APK 更新', '检查中…'].includes(text.props.children)))!;
const checkHandler = () => checkButton().props.onPress as () => Promise<void>;
const dialog = () => root!.root.findByType(ApkUpdateDialog);
const downloadHandler = () => dialog().props.onDownload as () => Promise<void>;
const downloadLabel = () => dialog().findByType(AppModalActions).props.primaryLabel;
async function mount() { await act(async () => { root = TestRenderer.create(<SettingsScreen updatesOnly />); }); }
async function check() { await act(async () => { await checkHandler()(); }); }

async function expectBackupDestinationUnchanged() {
  expect(update.saveUpdateServer).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(STORAGE_KEYS.UPDATE_SERVER_URL)).toBe(relay);
  expect(syncNativeNasBackupConfiguration).toHaveBeenCalledWith(relay);
  expect(jest.mocked(syncNativeNasBackupConfiguration).mock.calls.every(([destination]) => destination === relay)).toBe(true);
}

it('uses the primary manifest despite saved relay settings and routes an absolute relay-only APK to primary first', async () => {
  await mount();
  await check();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = new URL(String(fetchMock.mock.calls[0][0]));
  expect(request.origin).toBe(new URL(APK_UPDATE_ROUTES.primaryBaseUrl).origin);
  expect(request.username).toBe('');
  expect(request.password).toBe('');
  expect(dialog().props.info).toMatchObject({ version: '1.01', changelog: '更新测试' });
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(jest.mocked(downloadApkFromRoutes).mock.calls[0][0]).toEqual([`${primary}/app-release.apk`, `${relay}/app-release.apk`]);
  await expectBackupDestinationUnchanged();
});

it.each([401, 404, 500])('falls back after primary HTTP %s and keeps primary-first APK candidates', async status => {
  fetchMock.mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response());
  await mount();
  await check();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(new URL(String(fetchMock.mock.calls[1][0])).hostname).toBe('dav.zx5121091.fnos.net');
  await act(async () => { await downloadHandler()(); });
  expect(jest.mocked(downloadApkFromRoutes).mock.calls[0][0]).toEqual([`${primary}/app-release.apk`, `${relay}/app-release.apk`]);
  await expectBackupDestinationUnchanged();
});

it('falls back after bad primary JSON without changing the saved NAS destination', async () => {
  const badJson = response();
  jest.mocked(badJson.json).mockRejectedValueOnce(new Error('HTML response'));
  fetchMock.mockResolvedValueOnce(badJson).mockResolvedValueOnce(response());
  await mount();
  await check();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(dialog().props.info.version).toBe('1.01');
  await expectBackupDestinationUnchanged();
});

it('falls back at five seconds when the primary request never settles', async () => {
  fetchMock.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(response());
  await mount();
  let checking!: Promise<void>;
  await act(async () => { checking = checkHandler()(); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(checkButton().props.disabled).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(5000); await checking; });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(dialog().props.info.version).toBe('1.01');
  expect(checkButton().props.disabled).toBe(false);
  await expectBackupDestinationUnchanged();
});

it('blocks duplicate check presses synchronously before React commits disabled state', async () => {
  await mount();
  const handler = checkHandler();
  await act(async () => { await Promise.all([handler(), handler(), handler()]); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(syncNativeNasBackupConfiguration).toHaveBeenCalledTimes(1);
  expect(dialog().props.info.version).toBe('1.01');
});

it('uses the shared download once, displays progress and backs up before invoking Android installation', async () => {
  let finish!: (uri: string) => void;
  let finishBackup!: (result: Awaited<ReturnType<typeof createRealtimeDatabaseBackupToNas>>) => void;
  jest.mocked(createRealtimeDatabaseBackupToNas).mockImplementationOnce(() => new Promise(resolve => { finishBackup = resolve; }));
  jest.mocked(downloadApkFromRoutes).mockImplementation((_urls, _uri, options) => {
    options?.onProgress?.(0.42);
    return new Promise(resolve => { finish = uri => { options?.onDownloaded?.(downloadMetadata); resolve(uri); }; });
  });
  await mount();
  await check();
  const handler = downloadHandler();
  let downloading!: Promise<void>;
  await act(async () => { downloading = handler(); void handler(); void handler(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(dialog().props).toMatchObject({ downloading: true, progress: 42 });
  expect(checkButton().props.disabled).toBe(true);
  expect(createRealtimeDatabaseBackupToNas).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  await act(async () => { finish(apkUri); });
  expect(dialog().props).toMatchObject({ downloading: true, progress: 100, installStage: 'backup' });
  const backupText = dialog().findAllByType(Text).map(text => text.props.children);
  expect(backupText).toContain('安装前正在备份最新数据库…');
  expect(backupText).not.toContain('下载中... 100%');
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  await act(async () => { finishBackup({ fileName: 'before-update.db' } as Awaited<ReturnType<typeof createRealtimeDatabaseBackupToNas>>); await downloading; });
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledWith({ timeoutMs: 15000, source: 'online-update' });
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(1);
  expect(jest.mocked(downloadApkFromRoutes).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(createRealtimeDatabaseBackupToNas).mock.invocationCallOrder[0]);
  expect(jest.mocked(createRealtimeDatabaseBackupToNas).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(IntentLauncher.startActivityAsync).mock.invocationCallOrder[0]);
  expect(FileSystem.getContentUriAsync).toHaveBeenCalledWith(apkUri);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
    data: 'content://warehouse/update.apk', type: 'application/vnd.android.package-archive', flags: 1,
  });
  expect(mockAlert.showSuccess).not.toHaveBeenCalled();
  expect(dialog().props).toMatchObject({ downloading: false, progress: 100, cachedReady: true });
  expect(downloadLabel()).toBe('继续安装');
  await expectBackupDestinationUnchanged();
});

it('never opens the installer after pre-install NAS backup fails and permits an explicit retry', async () => {
  jest.mocked(createRealtimeDatabaseBackupToNas).mockRejectedValueOnce(new Error('NAS暂时不可达'));
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(FileSystem.getContentUriAsync).not.toHaveBeenCalled();
  expect(mockAlert.showError).toHaveBeenCalledWith(expect.stringContaining('安装前 NAS 数据库备份失败'));
  expect(dialog().props.downloading).toBe(false);
  expect(dialog().props.cachedReady).toBe(true);
  expect(downloadLabel()).toBe('继续安装');
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  await expectBackupDestinationUnchanged();
});

it('reuses the completed APK after Android installation is cancelled but backs up current data again', async () => {
  jest.mocked(IntentLauncher.startActivityAsync).mockResolvedValue({ resultCode: 0 });
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(downloadLabel()).toBe('继续安装');
  expect(dialog().findAllByType(Text).some(text => text.props.children === '继续安装')).toBe(true);
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(rememberDownloadedApk).toHaveBeenCalledTimes(1);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(2);
  expect(mockAlert.showSuccess).not.toHaveBeenCalled();
  await expectBackupDestinationUnchanged();
});

it('restores Continue installing from persistent cache after the settings screen is remounted', async () => {
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  await act(async () => { root!.unmount(); });
  root = undefined;
  await mount();
  await check();
  expect(downloadLabel()).toBe('继续安装');
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
});

it('does not reuse the old APK when the manifest advances to another native version', async () => {
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  await act(async () => { dialog().props.onClose(); });
  fetchMock.mockResolvedValue(response({ ...manifest, version: 'V1.02', versionCode: 300 }));
  await check();
  expect(dialog().props.info).toMatchObject({ version: '1.02' });
  expect(downloadLabel()).toBe('下载更新');
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(2);
  expect(rememberDownloadedApk).toHaveBeenLastCalledWith(expect.objectContaining({ version: '1.02', versionCode: 300 }), apkUri);
});

it('ignores stale Continue presses while a fresh update check is still running', async () => {
  await mount();
  await check();
  let finishManifest!: (result: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishManifest = resolve; }));
  let checking!: Promise<void>;
  await act(async () => { checking = checkHandler()(); });
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  await act(async () => { finishManifest(response()); await checking; });
});

it('does not infer successful native installation from an OTA version or absent native version evidence', async () => {
  jest.mocked(readInstalledApkVersionCode).mockReturnValue(undefined);
  await mount();
  await check();
  expect(clearInstalledApkCache).not.toHaveBeenCalled();
  expect(dialog().props.info).toMatchObject({ version: '1.01' });
});

it('keeps completed cache after the installer fails to launch and retries installation without downloading', async () => {
  jest.mocked(IntentLauncher.startActivityAsync).mockRejectedValueOnce(new Error('permission denied'));
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(mockAlert.showError).toHaveBeenCalledWith(expect.stringContaining('安装程序打开失败'));
  expect(downloadLabel()).toBe('继续安装');
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(1);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(2);
});

it('downloads again when the cache manager rejects a missing or corrupt previously ready file', async () => {
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(downloadLabel()).toBe('继续安装');
  // The cache manager independently validates presence, length and MD5. A null
  // result here represents either rejection and exercises the screen fallback.
  cachedApk = null;
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(2);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(2);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
});

it('rechecks the remote artifact on Continue and never reuses a same-version replacement', async () => {
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  jest.mocked(probeApkUpdateArtifact).mockResolvedValue({ artifactId: 'artifact-b', expectedSize: 100 });
  jest.mocked(downloadApkFromRoutes).mockImplementation(async (_urls, _uri, options) => {
    options?.onDownloaded?.({ ...downloadMetadata, headers: { ...downloadMetadata.headers, etag: 'artifact-b' } });
    return apkUri;
  });
  await act(async () => { await downloadHandler()(); });
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(2);
  expect(rememberDownloadedApk).toHaveBeenLastCalledWith(expect.objectContaining({ artifactId: 'artifact-b' }), apkUri);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(2);
});

it('uses the identity of the actual successful download instead of the earlier primary HEAD response', async () => {
  jest.mocked(downloadApkFromRoutes).mockImplementation(async (_urls, _uri, options) => {
    options?.onDownloaded?.({ ...downloadMetadata, headers: { ...downloadMetadata.headers, etag: 'relay-artifact' } });
    return apkUri;
  });
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(rememberDownloadedApk).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'relay-artifact' }), apkUri);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
});

it('allows this installation but never advertises persisted reuse without actual download validators', async () => {
  jest.mocked(downloadApkFromRoutes).mockImplementation(async (_urls, _uri, options) => {
    options?.onDownloaded?.({ size: 100 });
    return apkUri;
  });
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(rememberDownloadedApk).toHaveBeenCalledWith(expect.not.objectContaining({ artifactId: expect.anything() }), apkUri);
  expect(dialog().props.cachedReady).toBe(false);
  expect(downloadLabel()).toBe('下载更新');
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
});

it('does not discard or install cached data when no current remote validator can be confirmed', async () => {
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(cachedApk).not.toBeNull();
  jest.mocked(probeApkUpdateArtifact).mockResolvedValue(null);
  const readsBeforeRetry = jest.mocked(readCachedApk).mock.calls.length;
  jest.mocked(downloadApkFromRoutes).mockRejectedValueOnce(new ApkDownloadError('timeout'));
  await act(async () => { await downloadHandler()(); });
  expect(readCachedApk).toHaveBeenCalledTimes(readsBeforeRetry);
  expect(downloadApkFromRoutes).toHaveBeenCalledTimes(2);
  expect(cachedApk).not.toBeNull();
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
});

it('keeps installation available when storing cache metadata fails, without promising restart reuse', async () => {
  jest.mocked(rememberDownloadedApk).mockResolvedValue({ uri: apkUri, size: 100, md5: 'a'.repeat(32), persisted: false });
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(dialog().props.cachedReady).toBe(false);
  expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  expect(createRealtimeDatabaseBackupToNas).toHaveBeenCalledTimes(1);
});

it('blocks installation when the completed APK fails the cache integrity validation', async () => {
  jest.mocked(rememberDownloadedApk).mockRejectedValueOnce(new Error('安装包完整性校验失败'));
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(createRealtimeDatabaseBackupToNas).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(dialog().props.cachedReady).toBe(false);
  expect(mockAlert.showError).toHaveBeenCalled();
});

it('displays safe transport errors without invoking backup or installation', async () => {
  const failure = new ApkDownloadError('timeout');
  jest.mocked(downloadApkFromRoutes).mockRejectedValueOnce(failure);
  await mount();
  await check();
  await act(async () => { await downloadHandler()(); });
  expect(mockAlert.showError).toHaveBeenCalledWith(failure.message);
  expect(createRealtimeDatabaseBackupToNas).not.toHaveBeenCalled();
  expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  expect(dialog().props.downloading).toBe(false);
});

it('retains the existing versionCode gate even when a valid manifest was read through the new route', async () => {
  fetchMock.mockResolvedValue(response({ ...manifest, versionCode: 100 }));
  await mount();
  await check();
  expect(mockAlert.showWarning).toHaveBeenCalledWith(expect.stringContaining('安装编号未高于当前版本'));
  expect(root!.root.findAllByType(ApkUpdateDialog)).toHaveLength(0);
  expect(downloadApkFromRoutes).not.toHaveBeenCalled();
});

it('shows the package mismatch warning when both routes serve another app', async () => {
  fetchMock.mockResolvedValue(response({ ...manifest, androidPackage: 'other.application' }));
  await mount();
  await check();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(mockAlert.showWarning).toHaveBeenCalledWith(expect.stringContaining('更新清单不是当前正式版'));
  expect(downloadApkFromRoutes).not.toHaveBeenCalled();
  expect(mockAlert.showError).not.toHaveBeenCalled();
});

it('shows a safe check failure and releases the check guard for a later retry', async () => {
  fetchMock.mockRejectedValue(new Error(`${relay} private native failure`));
  await mount();
  await check();
  expect(mockAlert.showError).toHaveBeenCalledWith(expect.stringContaining('无法读取APK更新清单'));
  expect(JSON.stringify(mockAlert.showError.mock.calls)).not.toContain('fixture-pass');
  expect(checkButton().props.disabled).toBe(false);
  fetchMock.mockResolvedValue(response());
  await check();
  expect(dialog().props.info.version).toBe('1.01');
  await expectBackupDestinationUnchanged();
});
