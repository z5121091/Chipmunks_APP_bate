import { OtaUpdatePanel } from '@/screens/app-updates';
import { UiPageHeader } from '@/components/UiRedesign';
import { MotionCollapse } from '@/components/AppMotion';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { AppModal as Modal } from '@/components/AppModal';
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, View, Text, useWindowDimensions, Platform, Linking, InteractionManager, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import * as Updates from 'expo-updates';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { logger } from '@/utils/logger';
import {
  exportBackupData,
  importBackupData,
  getConfigStats,
  importDatabaseFile,
  BackupData,
  isBackupDataShape,
  STORAGE_KEYS,
} from '@/utils/database';
import { formatDateTimeExport } from '@/utils/time';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalViewport } from '@/components/AppModalViewport';
import { ApkUpdateDialog, DraftArchiveDialog, type ApkInstallStage } from './SettingsDialogs';
import { UiListItem, UiListSection } from '@/components/UiRedesign';
import { createStyles } from './styles';
import { AnimatedButton } from '@/components/AnimatedButton';
import { Spacing } from '@/constants/theme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { scaleControlSize } from '@/utils/responsive';
import {
  APP_VERSION,
  ANDROID_PACKAGE,
  ANDROID_VERSION_CODE,
  APP_NAME,
  COMPANY_NAME,
  COMPANY_WEBSITE,
  AUTHOR,
  ICP_FILING_NUMBER,
  ICP_FILING_URL,
  SELF_UPDATE_ENABLED,
} from '@/constants/version';
import { setSoundEnabled as setSoundEnabledFn, initSoundSetting } from '@/utils/feedback';
import { safeJsonParseNullable } from '@/utils/json';
import {
  getSyncConfigError,
} from '@/utils/heartbeat';
import {
  getSyncConnectionSnapshot,
  refreshSyncConnection,
  subscribeSyncConnection,
} from '@/utils/syncConnection';
import { NETWORK_CONFIG, SyncConfig } from '@/constants/config';
import { compareVersions, getUpdateServer } from '@/utils/update';
import { ApkUpdateManifestError, fetchApkUpdateManifest, resolveApkDownloadUrls } from '@/utils/apkUpdateRoutes';
import { ApkDownloadError, downloadApkFromRoutes } from '@/utils/apkUpdateDownload';
import {
  clearInstalledApkCache, getApkCacheDownloadUri, readCachedApk, rememberDownloadedApk, type ApkCacheTarget,
} from '@/utils/apkUpdateCache';
import { artifactFromDownload, probeApkUpdateArtifact, readInstalledApkVersionCode } from '@/utils/apkUpdateArtifact';
import * as IntentLauncher from 'expo-intent-launcher';
import { useToast } from '@/utils/toast';
import {
  listIsolatedWorkDrafts, restoreIsolatedWorkDraft, type IsolatedWorkDraft,
} from '@/utils/workDraftIsolation';
import {
  createRealtimeDatabaseBackupFile,
  createRealtimeDatabaseBackupToNas,
  uploadDatabaseBackupToNas,
} from '@/utils/nasBackup';
import { describeBackupDiagnostic, readBackupDiagnostic, type BackupDiagnostic } from '@/utils/backupDiagnostic';
import { backendJsonRequest, buildErpProxyPath } from '@/utils/backendApi';
import {
  ERP_ACCOUNTS,
  isErpAccountAvailable,
  type ErpAccountConfig,
  type ErpAccountKey,
} from '@/utils/erpAccounts';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const FileSystem = FileSystemLegacy;

const isSyncConfig = (value: unknown): value is SyncConfig => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SyncConfig).ip === 'string' &&
    typeof (value as SyncConfig).port === 'string' &&
    ((value as SyncConfig).pairingKey === undefined || typeof (value as SyncConfig).pairingKey === 'string')
  );
};

type SettingsGroupId = 'system' | 'erp' | 'rules' | 'backup' | 'about';

type ErpConnectionStatus = 'idle' | 'checking' | 'connected' | 'warning' | 'error' | 'unavailable';

type ErpConnectionState = {
  message: string;
  status: ErpConnectionStatus;
  tokenExpiryText?: string;
};
type ErpConnectionStates = Record<ErpAccountKey, ErpConnectionState>;

type ErpHealthResponse = {
  accountKey?: ErpAccountKey;
  appKeyConfigured?: boolean;
  appSecretConfigured?: boolean;
  appTicketCached?: boolean;
  businessReady?: boolean;
  lastTokenRefreshError?: string;
  lastTokenRefreshErrorAt?: string;
  lastTokenRefreshSucceededAt?: string;
  messageReady?: boolean;
  messageSecretConfigured?: boolean;
  messageRecentlyReceived?: boolean;
  lastMessageReceivedAt?: string;
  openTokenConfigured?: boolean;
  openTokenExpired?: boolean;
  openTokenExpiresAt?: string;
  ready?: boolean;
  refreshTokenConfigured?: boolean;
  refreshTokenExpired?: boolean;
  refreshTokenExpiresAt?: string;
  success?: boolean;
  tokenAutoRefreshEnabled?: boolean;
  tokenOrgMatches?: boolean;
  tokenRefreshReady?: boolean;
};

const ERP_HEALTH_PATH = buildErpProxyPath('/api/erp/health');
const ERP_AUTO_CHECK_TTL_MS = 5 * 60 * 1000;
const ERP_HEALTH_CHECK_TIMEOUT_MS = 8_000;
let cachedErpConnectionStates: ErpConnectionStates | null = null;
let lastErpConnectionCheckAt = 0;

const getUpdateRequestErrorMessage = (error: unknown): string => {
  return formatUserFacingErrorMessage(error, '检查更新失败，请稍后重试');
};

const backupDatabaseToNasForUpdate = async (stage: string) => {
  const backupResult = await createRealtimeDatabaseBackupToNas({
    timeoutMs: 15000,
    source: 'online-update',
  });
  logger.log(`[update] ${stage} 数据库已备份到 NAS:`, backupResult.fileName);
  return backupResult;
};

const getNextDatedFileName = async (
  directory: string | null | undefined,
  prefix: string,
  dateStr: string,
  extension: string
): Promise<string> => {
  const fallbackSequence = '01';

  if (!directory) {
    return `${prefix}_${dateStr}_${fallbackSequence}.${extension}`;
  }

  try {
    const files = await FileSystem.readDirectoryAsync(directory);
    const sequencePrefix = `${prefix}_${dateStr}_`;
    const sequenceSuffix = `.${extension}`;
    const maxSequence = files.reduce((max: number, fileName: string) => {
      if (!fileName.startsWith(sequencePrefix) || !fileName.endsWith(sequenceSuffix)) {
        return max;
      }

      const sequenceText = fileName.slice(sequencePrefix.length, -sequenceSuffix.length);
      const sequence = Number(sequenceText);
      return Number.isInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
    const nextSequence = String(maxSequence + 1).padStart(2, '0');
    return `${prefix}_${dateStr}_${nextSequence}.${extension}`;
  } catch (error) {
    logger.warn('读取备份目录失败，使用默认序号:', error);
    return `${prefix}_${dateStr}_${fallbackSequence}.${extension}`;
  }
};

export default function SettingsScreen({ updatesOnly = false }: { updatesOnly?: boolean }) {
  const { theme, isDark } = useTheme();
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const showSettingsLoadError = alert.showError;
  const { ToastContainer } = useToast();

  // 窗口及像素密度变化都必须使包含响应式 token 的样式快照失效。
  const { width: screenWidth, height: screenHeight, scale: screenScale } = useWindowDimensions();

  useEffect(() => {
    // 延迟初始化声音设置，避免阻塞页面渲染
    const timer = setTimeout(() => {
      initSoundSetting();
    }, 100); // 延迟 100ms，先完成页面渲染

    return () => {
      clearTimeout(timer); // 清理定时器
    };
  }, []);

  // 根据屏幕尺寸动态创建样式
  const styles = useMemo(
    () => createStyles(theme, screenWidth, screenHeight),
    // createStyles reads pixel density via Dimensions for token rounding; it is an indirect dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, screenWidth, screenHeight, screenScale]
  );

  // 配置统计
  const [configStats, setConfigStats] = useState({
    rules: 0,
    customFields: 0,
    inventoryBindings: 0,
    warehouses: 0,
  });
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [dbBackupLoading, setDbBackupLoading] = useState(false);
  const [dbRestoreLoading, setDbRestoreLoading] = useState(false);
  const [backupDiagnostic, setBackupDiagnostic] = useState<BackupDiagnostic | null>(null);
  const [expandedSettingsGroup, setExpandedSettingsGroup] = useState<SettingsGroupId | null>(null);
  useEffect(() => navigation.addListener('blur', () => {
    setExpandedSettingsGroup(null);
  }), [navigation]);
  const [erpConnectionStates, setErpConnectionStates] = useState<
    Record<ErpAccountKey, ErpConnectionState>
  >(() =>
    cachedErpConnectionStates ?? Object.fromEntries(
      ERP_ACCOUNTS.map((account) => [
        account.key,
        isErpAccountAvailable(account)
          ? { message: '正在检测后端', status: 'checking' as const }
          : { message: '账套尚未开放', status: 'unavailable' as const },
      ])
    ) as Record<ErpAccountKey, ErpConnectionState>
  );
  const erpCheckController = useRef<AbortController | null>(null);

  // 数据库恢复后的重启提示弹窗
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restartMessage, setRestartMessage] = useState('数据库已恢复到备份状态，需要立即重启应用后才能继续安全使用。');
  const [draftArchives, setDraftArchives] = useState<IsolatedWorkDraft[]>([]);
  const [draftArchiveModalVisible, setDraftArchiveModalVisible] = useState(false);
  const [selectedDraftArchiveId, setSelectedDraftArchiveId] = useState<string | null>(null);
  const [restoringDraftArchive, setRestoringDraftArchive] = useState(false);

  // 电脑同步配置
  const syncConnection = useSyncExternalStore(
    subscribeSyncConnection,
    getSyncConnectionSnapshot,
    getSyncConnectionSnapshot
  );
  const connectionStatus = syncConnection.status;
  const syncConfig = syncConnection.config || { ip: '', port: NETWORK_CONFIG.DEFAULT_PORT };

  // 声音开关
  const [soundEnabled, setSoundEnabled] = useState(true);

  // 各数据类型的同步状态

  // 在线更新相关状态
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkingUpdateRef = useRef(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const downloadingRef = useRef(false);
  const [cachedApkReady, setCachedApkReady] = useState(false);
  const [apkInstallStage, setApkInstallStage] = useState<ApkInstallStage>('checking');
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    downloadUrls: string[];
    changelog: string;
    forceUpdate: boolean;
    cacheTarget: ApkCacheTarget;
  } | null>(null);

  // 加载数据
  const loadData = useCallback(async () => {
    await listIsolatedWorkDrafts().then(setDraftArchives).catch(error => {
      logger.warn('[设置] 读取恢复前作业副本失败:', error);
    });
    const [stats, savedSyncConfig, savedSoundEnabled] = await Promise.all([
      getConfigStats(),
      AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG),
      AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED),
    ]);
    setConfigStats(stats);

    const nextSoundEnabled = savedSoundEnabled !== 'false';
    setSoundEnabled(nextSoundEnabled);
    setSoundEnabledFn(nextSoundEnabled);

    if (!savedSyncConfig) {
      await refreshSyncConnection();
      return;
    }

    const config = safeJsonParseNullable<SyncConfig>(
      savedSyncConfig,
      'settings.syncConfig',
      isSyncConfig
    );
    if (!config || getSyncConfigError(config)) {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.SYNC_CONFIG),
        AsyncStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS),
      ]);
      await refreshSyncConnection();
      return;
    }

    // 检查真实服务状态；历史失败状态不阻止重连。
    await refreshSyncConnection();
  }, []);

  const loadAutoBackupStatus = useCallback(async () => {
    setBackupDiagnostic(await readBackupDiagnostic());
  }, []);

  const checkErpConnections = useCallback(
    async (options: { force?: boolean } = {}): Promise<void> => {
      if (erpCheckController.current) return;
      if (
        !options.force &&
        cachedErpConnectionStates &&
        !Object.values(cachedErpConnectionStates).some(state => state.status === 'error') &&
        Date.now() - lastErpConnectionCheckAt < ERP_AUTO_CHECK_TTL_MS
      ) {
        setErpConnectionStates(cachedErpConnectionStates);
        return;
      }

      setErpConnectionStates(
        Object.fromEntries(
          ERP_ACCOUNTS.map((account) => [
            account.key,
            isErpAccountAvailable(account)
              ? { message: '正在检测后端', status: 'checking' as const }
              : { message: '账套尚未开放', status: 'unavailable' as const },
          ])
        ) as ErpConnectionStates
      );

      const controller = new AbortController();
      erpCheckController.current = controller;
      try {
        const checkAccount = async (account: ErpAccountConfig): Promise<[ErpAccountKey, ErpConnectionState]> => {
          if (!isErpAccountAvailable(account)) {
            return [account.key, { message: '账套尚未开放', status: 'unavailable' }];
          }

          try {
            const health = await backendJsonRequest<ErpHealthResponse>(ERP_HEALTH_PATH, {
              baseUrl: account.backendBaseUrl,
              erpAccountKey: account.key,
              method: 'GET',
              signal: controller.signal,
              timeoutMs: ERP_HEALTH_CHECK_TIMEOUT_MS,
              settleOnAbort: true,
            });
            if (health.accountKey && health.accountKey !== account.key) {
              throw new Error(
                `后端账套不匹配：请求 ${account.name}，服务器返回 ${health.accountKey}`
              );
            }
            if (!health.success) {
              throw new Error('后端健康检查未通过');
            }

            const businessIssues: string[] = [];
            if (!health.appKeyConfigured || !health.appSecretConfigured) {
              businessIssues.push('应用凭据');
            }
            if (!health.openTokenConfigured) {
              businessIssues.push('Token');
            } else if (health.openTokenExpired) {
              businessIssues.push('Token已过期');
            }
            if (health.tokenOrgMatches === false) {
              businessIssues.push('Token账套不匹配');
            }

            const maintenanceIssues: string[] = [];
            if (health.tokenAutoRefreshEnabled === false) {
              maintenanceIssues.push('自动续期未开启');
            } else if (health.tokenAutoRefreshEnabled === true) {
              if (!health.refreshTokenConfigured) {
                maintenanceIssues.push('缺少刷新Token');
              } else if (health.refreshTokenExpired) {
                maintenanceIssues.push('刷新Token已过期');
              }
            }

            const refreshErrorAt = health.lastTokenRefreshErrorAt
              ? Date.parse(health.lastTokenRefreshErrorAt)
              : Number.NaN;
            const refreshSucceededAt = health.lastTokenRefreshSucceededAt
              ? Date.parse(health.lastTokenRefreshSucceededAt)
              : Number.NaN;
            if (
              health.lastTokenRefreshError &&
              Number.isFinite(refreshErrorAt) &&
              (!Number.isFinite(refreshSucceededAt) || refreshErrorAt > refreshSucceededAt)
            ) {
              maintenanceIssues.push('最近自动续期失败');
            }

            const messageReady = health.messageReady ?? health.messageSecretConfigured;
            const messageIssue = messageReady === false ? '消息密钥未配置' : '';
            const messageWaitingForTicket =
              messageReady === true && !health.appTicketCached && !health.messageRecentlyReceived;

            const tokenExpiry = health.openTokenExpiresAt
              ? new Date(health.openTokenExpiresAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';
            const tokenExpiryText =
              health.openTokenConfigured && tokenExpiry
                ? `Token${health.openTokenExpired ? '已到期' : '到期'}：${tokenExpiry}`
                : undefined;

            if (businessIssues.length > 0) {
              return [
                account.key,
                {
                  message: `业务待完善：${businessIssues.join('、')}`,
                  status: 'warning',
                  tokenExpiryText,
                },
              ];
            }

            if (maintenanceIssues.length > 0 || messageIssue) {
              return [
                account.key,
                {
                  message: `业务可用 · ${[...maintenanceIssues, messageIssue]
                    .filter(Boolean)
                    .join('、')}`,
                  status: 'warning',
                  tokenExpiryText,
                },
              ];
            }

            const readyParts = ['业务正常'];
            if (
              health.tokenAutoRefreshEnabled === true &&
              health.tokenRefreshReady !== false
            ) {
              readyParts.push('续期正常');
            }
            readyParts.push(
              messageWaitingForTicket ? '等待AppTicket' : '消息正常'
            );

            return [
              account.key,
              {
                message: readyParts.join(' · '),
                status: 'connected',
                tokenExpiryText,
              },
            ];
          } catch (error) {
            if (!controller.signal.aborted) logger.warn(`[ERP对接] ${account.name} 健康检查失败:`, error);
            return [
              account.key,
              {
                message: formatUserFacingErrorMessage(error, '无法连接后端'),
                status: 'error',
              },
            ];
          }
        };
        const entries = await Promise.all(ERP_ACCOUNTS.map(checkAccount));

        if (erpCheckController.current !== controller || controller.signal.aborted) return;
        const nextStates = Object.fromEntries(entries) as ErpConnectionStates;
        cachedErpConnectionStates = nextStates;
        lastErpConnectionCheckAt = Date.now();
        setErpConnectionStates(nextStates);
      } finally {
        if (erpCheckController.current === controller) erpCheckController.current = null;
      }
    },
    []
  );

  useFocusEffect(useCallback(() => {
    if (updatesOnly) return;
    const cancelCheck = () => {
      const controller = erpCheckController.current;
      erpCheckController.current = null;
      controller?.abort();
      return Boolean(controller);
    };
    let lastAppState = AppState.currentState ?? 'active';
    if (lastAppState === 'active') void checkErpConnections();
    const subscription = AppState.addEventListener('change', nextState => {
      const resumed = nextState === 'active' && lastAppState !== 'active';
      lastAppState = nextState;
      if (resumed) void checkErpConnections({ force: cancelCheck() });
    });
    return () => {
      subscription.remove();
      cancelCheck();
    };
  }, [checkErpConnections, updatesOnly]));

  // 切换声音开关
  const toggleSound = useCallback((value: boolean) => {
    setSoundEnabled(value);
    setSoundEnabledFn(value);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        void loadData().catch((error) => {
          logger.error('[设置] 加载设置数据失败:', error);
          if (active) showSettingsLoadError('设置数据加载失败，请重新进入页面');
        });
        void loadAutoBackupStatus().catch((error) => {
          logger.error('[设置] 加载自动备份状态失败:', error);
        });
      });
      return () => {
        active = false;
        task.cancel();
      };
    }, [loadAutoBackupStatus, loadData, showSettingsLoadError])
  );

  // ==================== 在线更新功能 ====================

  // 检查更新
  const checkForUpdate = async () => {
    if (checkingUpdateRef.current || downloadingRef.current) return;
    checkingUpdateRef.current = true;
    setCheckingUpdate(true);
    setDownloadProgress(0);
    try {
      // An installer result (including cancel) cannot prove installation. Only
      // the version embedded in the running native APK may retire cached files.
      if (Platform.OS === 'android') {
        const installedCode = readInstalledApkVersionCode();
        if (installedCode !== undefined) {
          await clearInstalledApkCache(ANDROID_PACKAGE, installedCode).catch(() => {
            logger.warn('[update] 已安装APK缓存清理暂未完成');
          });
        }
      }
      // Keep the persistent NAS backup destination unchanged; APK routing is read-only.
      const baseUrl = (await getUpdateServer()).trim().replace(/\/+$/, '');
      const { data, manifestBaseUrl } = await fetchApkUpdateManifest(baseUrl, { androidPackage: ANDROID_PACKAGE });

      // 比较版本号
      const currentVersion = APP_VERSION.replace(/^V/, '');
      const latestVersion = (data.version || '0.0.0').replace(/^V/, '');

      const isNewVersion = compareVersions(latestVersion, currentVersion) > 0;

      if (isNewVersion) {
        if (typeof data.versionCode !== 'number' || !Number.isInteger(data.versionCode) || data.versionCode <= ANDROID_VERSION_CODE) {
          alert.showWarning('NAS 上的安装编号未高于当前版本，请核对 version.json 和 APK 后重试。');
          return;
        }
        // 处理 changelog：可能是数组（旧格式）或对象数组（新格式）
        let changelogText = '优化用户体验';
        if (Array.isArray(data.changelog)) {
          // 新格式：数组 [{version, date, changes}]
          changelogText =
            data.changelog[0]?.changes
              ?.map((c: { type: string; text: string }) => `${c.text}`)
              .join('\n') || '优化用户体验';
        } else if (typeof data.changelog === 'string') {
          // 旧格式：字符串
          changelogText = data.changelog;
        }

        const downloadUrls = resolveApkDownloadUrls(data.downloadUrl, data.downloadUrls, manifestBaseUrl, baseUrl);
        const artifact = Platform.OS === 'android' ? await probeApkUpdateArtifact(downloadUrls) : null;
        const cacheTarget: ApkCacheTarget = {
          androidPackage: ANDROID_PACKAGE, versionCode: data.versionCode, version: latestVersion,
          ...(artifact || {}),
        };
        // A transient HEAD failure preserves the cache registry; it cannot
        // establish that a previously downloaded file is still the same APK.
        const cachedApk = artifact ? await readCachedApk(cacheTarget).catch(() => null) : null;
        setCachedApkReady(Boolean(cachedApk));
        setUpdateInfo({
          version: latestVersion,
          downloadUrls,
          changelog: changelogText,
          forceUpdate: data.forceUpdate === true,
          cacheTarget,
        });
        setUpdateModalVisible(true);
      } else {
        alert.showSuccess(`当前已是最新版本 (${APP_VERSION})`);
      }
    } catch (error) {
      if (error instanceof ApkUpdateManifestError && error.failures.every(failure => failure.reason === 'package')) {
        alert.showWarning('NAS 上的更新清单不是当前正式版。请先上传包含正确包名的 version.json 和对应 APK，再检查更新。');
      } else {
        const errorMessage = getUpdateRequestErrorMessage(error);
        logger.error('检查更新失败:', errorMessage);
        alert.showError(`检查更新失败：${errorMessage}。请确认网络可访问更新服务器。`);
      }
    } finally {
      checkingUpdateRef.current = false;
      setCheckingUpdate(false);
    }
  };

  // 下载并安装更新
  const downloadAndInstall = async () => {
    if (!updateInfo || downloadingRef.current || checkingUpdateRef.current) return;

    // Android 平台检查
    if (Platform.OS !== 'android') {
      alert.showError('目前仅支持 Android 系统更新');
      return;
    }

    downloadingRef.current = true;
    setDownloading(true);
    setDownloadProgress(0);
    setApkInstallStage('checking');

    let openingInstaller = false;
    try {
      const artifact = await probeApkUpdateArtifact(updateInfo.downloadUrls);
      const cacheTarget: ApkCacheTarget = {
        androidPackage: updateInfo.cacheTarget.androidPackage,
        versionCode: updateInfo.cacheTarget.versionCode,
        version: updateInfo.cacheTarget.version,
        ...(artifact || {}),
      };
      const cachedApk = artifact ? await readCachedApk(cacheTarget).catch(() => null) : null;
      setCachedApkReady(Boolean(cachedApk));
      let downloadedApkUri = cachedApk?.uri;
      if (!downloadedApkUri) {
        const apkUri = await getApkCacheDownloadUri();
        setApkInstallStage('downloading');
        let downloadedArtifact: ReturnType<typeof artifactFromDownload> = null;
        downloadedApkUri = await downloadApkFromRoutes(updateInfo.downloadUrls, apkUri, {
          onProgress: fraction => setDownloadProgress(Math.round(fraction * 100)),
          onDownloaded: result => {
            const identity = artifactFromDownload(result.headers);
            downloadedArtifact = identity?.expectedSize === result.size ? identity : null;
          },
        });
        // Register completion before backup/installation so either may be
        // retried after cancellation or restart without downloading again.
        // Never assign primary HEAD metadata to a fallback route's bytes.
        const completedTarget: ApkCacheTarget = {
          androidPackage: cacheTarget.androidPackage, versionCode: cacheTarget.versionCode, version: cacheTarget.version,
          ...(downloadedArtifact || {}),
        };
        const remembered = await rememberDownloadedApk(completedTarget, downloadedApkUri);
        setCachedApkReady(remembered.persisted === true);
      }

      setDownloadProgress(100);
      setApkInstallStage('backup');
      try {
        // Reusing an APK never reuses a database backup: work may have been
        // recorded since the last time the user cancelled the installer.
        await backupDatabaseToNasForUpdate('安装前');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        alert.showError(
          `安装前 NAS 数据库备份失败：${message}。请稍后再试，避免覆盖安装时丢失当前出库数据。`
        );
        return;
      }

      setApkInstallStage('installer');
      openingInstaller = true;
      const installUri =
        typeof FileSystem.getContentUriAsync === 'function'
          ? await FileSystem.getContentUriAsync(downloadedApkUri)
          : downloadedApkUri;

      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: installUri,
        type: 'application/vnd.android.package-archive',
        flags: 1,
      });
      // Returning here also includes cancelling/backgrounding the installer.
      // Retain the APK and show Continue Install; do not announce installation.
    } catch (error) {
      if (error instanceof ApkDownloadError) {
        alert.showError(error.message);
        return;
      }
      if (!openingInstaller) {
        logger.warn('[update] 安装包准备或完整性校验失败');
        alert.showError('安装包准备或完整性校验失败，请重新检查更新后重试，并确认存储空间充足。');
        return;
      }
      logger.error('安装程序打开失败:', getUpdateRequestErrorMessage(error));
      const message = error instanceof Error ? error.message : String(error || '');
      const installHint = message ? `\n原因：${message}` : '';
      alert.showError(`安装程序打开失败，请确认已允许本应用安装未知来源应用${installHint}`);
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  };

  // 数据备份
  const handleBackup = async () => {
    if (backupLoading) return;

    setBackupLoading(true);
    try {
      const backupData = await exportBackupData();
      const backupJson = JSON.stringify(backupData, null, 2);

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const fileName = await getNextDatedFileName(
        FileSystem.cacheDirectory,
        '掌上仓库备份',
        dateStr,
        'json'
      );

      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, backupJson, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/json',
          dialogTitle: '保存配置备份',
          UTI: 'public.json',
        });
        alert.showSuccess(
          `已备份配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 出库单号规则: ${Object.keys(backupData.outboundWarehouseOrderRules || {}).length} 条\n• 操作提示音: ${backupData.soundEnabled === false ? '关闭' : '开启'}\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}\n\n物料绑定可用 Excel 导入或导出。内部标签包号和打印任务请用「备份数据库」保存。`
        );
      } else {
        alert.showError('当前设备不支持文件分享，未能导出配置备份');
      }
    } catch (error) {
      logger.error('备份失败:', error);
      alert.showError('请重试');
    } finally {
      setBackupLoading(false);
    }
  };

  // 数据恢复
  const handleRestore = async () => {
    if (restoreLoading) return;

    try {
      // Android 7.0 及以下不支持 application/json 类型，使用 */* 替代
      const isAndroid7OrBelow =
        Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version <= 24;
      const documentType = isAndroid7OrBelow ? '*/*' : 'application/json';

      const result = await DocumentPicker.getDocumentAsync({
        type: documentType,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const fileUri = result.assets[0].uri;

      // 如果选择的是所有文件，需要检查扩展名
      if (isAndroid7OrBelow && !fileUri.toLowerCase().endsWith('.json')) {
        alert.showWarning('请选择 .json 格式的备份文件');
        return;
      }

      const fileContent = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const parsedBackupData = safeJsonParseNullable<BackupData>(
        fileContent,
        'settings.backupFile',
        isBackupDataShape
      );

      if (!parsedBackupData) {
        alert.showError('无效的备份文件格式');
        return;
      }
      const backupData = parsedBackupData;

      alert.showConfirm(
        '确认恢复配置',
        `备份时间: ${formatDateTimeExport(backupData.backupTime)}\n\n即将恢复以下配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 出库单号规则: ${Object.keys(backupData.outboundWarehouseOrderRules || {}).length} 条\n• 操作提示音: ${backupData.soundEnabled === undefined ? '沿用当前设置' : backupData.soundEnabled ? '开启' : '关闭'}\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}\n\n[说明] 旧规则中的占位段将自动转换为忽略段。物料绑定不会恢复或覆盖，请在物料绑定页面使用 Excel 导入。\n[注意] 恢复前会替换上述配置数据，业务数据（订单、物料、拆包记录等）不受影响；被历史业务引用的仓库会保留。此操作不可撤销！`,
        async () => {
          setRestoreLoading(true);
          try {
            const result = await importBackupData(backupData);
            if (result.success) {
              const syncConfigStatus = !result.stats?.hasSyncConfig
                ? '未配置'
                : result.stats?.syncConfigRestored
                  ? '已恢复'
                  : '恢复失败';
              const summary = `备份时间: ${formatDateTimeExport(backupData.backupTime)}\n\n恢复成功:\n• 解析规则: ${result.stats?.rules || 0} 条\n• 仓库: ${result.stats?.warehouses || 0} 个\n• 出库单号规则: ${result.stats?.outboundWarehouseOrderRules || 0} 条\n• 同步服务器: ${syncConfigStatus}\n\n物料绑定保持当前数据不变。`;

              if (result.warnings?.length) {
                alert.showWarning(`${summary}\n\n注意:\n• ${result.warnings.join('\n• ')}`);
              } else {
                alert.showSuccess(summary);
              }
              await loadData();
              await getUpdateServer();
            } else {
              alert.showError(result.message);
            }
          } catch (error) {
            logger.error('恢复失败:', error);
            alert.showError('请重试');
          } finally {
            setRestoreLoading(false);
          }
        },
        true,
        '确认恢复'
      );
    } catch (error) {
      logger.error('选择文件失败:', error);
      alert.showError('无法读取备份文件');
    }
  };

  // 处理数据库文件备份
  const handleDatabaseBackup = async () => {
    // Web 平台不支持数据库文件备份
    if (Platform.OS === 'web') {
      alert.showError('Web 平台不支持数据库文件备份，请在 Android 设备上使用此功能');
      return;
    }

    alert.showConfirm(
      '备份数据库文件',
      '即将备份完整的数据库文件（.db）。\n\n• 配置数据：规则、字段、绑定、仓库\n• 业务数据：订单、物料、盘点、拆包记录、内部标签包号和打印任务',
      async () => {
        setDbBackupLoading(true);
        try {
          const { localFilePath } = await createRealtimeDatabaseBackupFile({
            timeoutMs: 15000,
          });

          let nasBackupFileName: string | null = null;
          let nasBackupError: string | null = null;

          try {
            const nasBackupResult = await uploadDatabaseBackupToNas(localFilePath, {
              source: 'manual-export',
            });
            nasBackupFileName = nasBackupResult.fileName;
            void loadAutoBackupStatus();
          } catch (error) {
            nasBackupError = error instanceof Error ? error.message : 'NAS 云端备份失败';
            logger.error('NAS 数据库备份失败:', error);
          }

          const sharingAvailable = await Sharing.isAvailableAsync();
          if (sharingAvailable) {
            await Sharing.shareAsync(localFilePath, {
              mimeType: 'application/x-sqlite3',
              dialogTitle: '保存数据库备份',
            });
          }
          if (nasBackupError) {
            if (sharingAvailable) {
              alert.showWarning(`数据库文件已本地导出，但 NAS 云端备份失败：${nasBackupError}`);
            } else {
              alert.showError(`设备不支持文件分享，且 NAS 云端备份失败：${nasBackupError}`);
            }
          } else {
            alert.showSuccess(
              nasBackupFileName
                ? `数据库已备份到 NAS：${nasBackupFileName}${sharingAvailable ? '\n本地分享窗口也已打开' : ''}`
                : sharingAvailable
                  ? '数据库文件已打开分享窗口'
                  : '数据库备份文件已生成，但设备不支持分享'
            );
          }
        } catch (error) {
          logger.error('数据库备份失败:', error);
          const message = error instanceof Error ? error.message : '备份失败，请重试';
          alert.showError(message);
        } finally {
          setDbBackupLoading(false);
        }
      },
      false
    );
  };

  // 处理数据库文件恢复
  const handleDatabaseRestore = async () => {
    // Web 平台不支持数据库文件恢复
    if (Platform.OS === 'web') {
      alert.showError('Web 平台不支持数据库文件恢复，请在 Android 设备上使用此功能');
      return;
    }

    alert.showAlert(
      '恢复数据库文件',
      '数据库将替换为备份时的状态。已有内部标签按该备份中的包号和版本识别，请先核对备份时间。\n\n恢复前会备份当前数据库，并将未完成作业保存为独立副本。作业副本可在设置中核对后恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '导入',
          style: 'default',
          onPress: async () => {
            setDbRestoreLoading(true);
            try {
              const result = await importDatabaseFile();
              if (result.success) {
                // 检查是否需要重启应用
                if (result.needRestart) {
                  setRestartMessage('数据库已恢复。恢复前的未完成作业已单独保留，可重启后在设置的“恢复前作业副本”中核对。');
                  setShowRestartModal(true);
                } else {
                  alert.showSuccess(
                    `数据库文件恢复成功！\n\n恢复后的数据统计：\n• 订单: ${result.stats?.orders || 0} 条\n• 物料: ${result.stats?.materials || 0} 条\n• 规则: ${result.stats?.rules || 0} 条\n• 仓库: ${result.stats?.warehouses || 0} 个`
                  );
                  await loadData();
                }
              } else {
                if (result.needRestart) {
                  setRestartMessage(result.message);
                  setShowRestartModal(true);
                } else alert.showError(result.message);
              }
            } catch (error) {
              logger.error('数据库恢复失败:', error);
              alert.showError('恢复失败，请重试');
            } finally {
              setDbRestoreLoading(false);
            }
          },
        },
      ],
      'error'
    );
  };

  const handleRestoreDraftArchive = () => {
    const archive = draftArchives.find(item => item.id === selectedDraftArchiveId);
    if (!archive || restoringDraftArchive) return;
    alert.showConfirm('核对后恢复未完成作业',
      `副本时间：${formatDateTimeExport(archive.createdAt)}\n对应恢复文件：${archive.databaseFileName}\n\n这份作业可能晚于当前数据库备份。请核对原单、实物和数量。恢复后仍需在作业页按现行规则处理，不会直接生成正式业务记录。`,
      async () => {
        setRestoringDraftArchive(true);
        try {
          await restoreIsolatedWorkDraft(archive.id);
          setDraftArchives(previous => previous.filter(item => item.id !== archive.id));
          setDraftArchiveModalVisible(false);
          setRestartMessage('未完成作业副本已恢复。请先重启应用，清除旧页面和待核对队列的内存状态，再进入原作业页核对后继续。');
          setShowRestartModal(true);
        } catch (error) {
          alert.showError(error instanceof Error ? error.message : '恢复作业副本失败，原副本仍保留');
        } finally { setRestoringDraftArchive(false); }
      }, false, '确认恢复');
  };

  // 是否可以同步
  const syncTarget = syncConfig.ip
    ? `${syncConfig.ip}:${syncConfig.port || NETWORK_CONFIG.DEFAULT_PORT}`
    : '未配置';
  const syncAssistantStatus = useMemo(() => {
    if (connectionStatus === 'success') {
      return {
        title: '同步助手已连接',
        desc: `电脑端 ${syncTarget} 可接收 Excel 文件`,
        color: theme.success,
        icon: 'check-circle' as keyof typeof Feather.glyphMap,
      };
    }

    if (connectionStatus === 'testing') {
      return {
        title: '正在连接同步助手',
        desc: `正在检测 ${syncTarget}`,
        color: theme.primary,
        icon: 'loader' as keyof typeof Feather.glyphMap,
      };
    }

    if (connectionStatus === 'error' || connectionStatus === 'disconnected') {
      return {
        title: '同步助手未连接',
        desc: '正在自动重试，请确认同步助手已启动，且手机和电脑在同一网络',
        color: theme.error,
        icon: 'alert-circle' as keyof typeof Feather.glyphMap,
      };
    }

    return {
      title: '配置本地同步助手',
      desc: '填写电脑 IP 和端口，连接成功后可同步 Excel 到电脑',
      color: theme.textMuted,
      icon: 'monitor' as keyof typeof Feather.glyphMap,
    };
  }, [connectionStatus, syncTarget, theme.error, theme.primary, theme.success, theme.textMuted]);

  const erpChecking = Object.values(erpConnectionStates).some(item => item.status === 'checking');
  const erpConnectionSummary = useMemo(() => {
    const availableAccounts = ERP_ACCOUNTS.filter(isErpAccountAvailable);
    const connectedCount = availableAccounts.filter(
      (account) => erpConnectionStates[account.key].status === 'connected'
    ).length;
    if (erpChecking) {
      return '正在检测ERP后端';
    }
    if (availableAccounts.length === 0) {
      return '尚未开放ERP账套';
    }
    return `${connectedCount}/${availableAccounts.length} 套已就绪`;
  }, [erpConnectionStates, erpChecking]);

  const erpConnectionGroupColor = useMemo(() => {
    const statuses = Object.values(erpConnectionStates).map((item) => item.status);

    if (statuses.includes('error')) {
      return theme.error;
    }
    if (statuses.includes('warning')) {
      return theme.warning;
    }
    if (statuses.includes('checking')) {
      return theme.primary;
    }
    if (statuses.includes('connected')) {
      return theme.success;
    }
    return theme.textMuted;
  }, [
    erpConnectionStates,
    theme.error,
    theme.primary,
    theme.success,
    theme.textMuted,
    theme.warning,
  ]);

  const getErpConnectionVisual = useCallback(
    (status: ErpConnectionStatus) => {
      switch (status) {
        case 'connected':
          return { color: theme.success, icon: 'check-circle' as const, label: '正常' };
        case 'checking':
          return { color: theme.primary, icon: 'loader' as const, label: '检测中' };
        case 'warning':
          return { color: theme.warning, icon: 'alert-triangle' as const, label: '待配置' };
        case 'error':
          return { color: theme.error, icon: 'x-circle' as const, label: '异常' };
        case 'unavailable':
          return { color: theme.textMuted, icon: 'slash' as const, label: '未开放' };
        default:
          return { color: theme.textMuted, icon: 'clock' as const, label: '未检测' };
      }
    },
    [theme.error, theme.primary, theme.success, theme.textMuted, theme.warning]
  );

  const toggleSettingsGroup = useCallback((group: SettingsGroupId) => {
    setExpandedSettingsGroup((current) => (current === group ? null : group));
  }, []);

  // 渲染菜单卡片
  const renderMenuCard = useCallback(
    (
      title: string,
      desc: string,
      iconName: keyof typeof Feather.glyphMap,
      color: string,
      onPress: () => void,
      disabled?: boolean,
      loading?: boolean,
      rightText?: string
    ) => (
      <UiListItem
        title={title}
        subtitle={desc}
        icon={iconName}
        color={color}
        onPress={onPress}
        disabled={disabled || loading}
        loading={loading}
        rightText={rightText}
        compact
      />
    ),
    []
  );

  // 渲染开关设置项
  const renderSwitchCard = useCallback(
    (
      title: string,
      desc: string,
      iconName: keyof typeof Feather.glyphMap,
      color: string,
      value: boolean,
      onValueChange: (value: boolean) => void
    ) => (
      <UiListItem
        title={title}
        subtitle={desc}
        icon={iconName}
        color={color}
        switchValue={value}
        onSwitchChange={onValueChange}
        compact
      />
    ),
    []
  );


  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      safeAreaEdges={['top', 'left', 'right']}
      disableAutoScroll
    >
      {updatesOnly ? <>
        <UiPageHeader title="应用更新" onBack={() => router.back()} />
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[{ flexGrow: 1 }, { padding: 16 }]}>
          <View style={{ backgroundColor: theme.backgroundDefault, padding: 18, borderRadius: 16, marginBottom: 16 }}>
            <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '700' }}>APK 版本</Text>
            <Text style={{ color: theme.textSecondary, marginVertical: 10 }}>当前安装版本：{APP_VERSION}</Text>
            {SELF_UPDATE_ENABLED && <AnimatedButton disabled={checkingUpdate || downloading} onPress={checkForUpdate} style={{ backgroundColor: theme.primary, padding: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: theme.buttonPrimaryText }}>{checkingUpdate ? '检查中…' : '检查 APK 更新'}</Text>
            </AnimatedButton>}
          </View>
          <OtaUpdatePanel />
        </ScrollView>
      </> :       <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        style={styles.container}
        contentContainerStyle={[{ flexGrow: 1 }, styles.scrollContent]}
        scrollEventThrottle={16} // 控制滚动事件频率（16ms ≈ 60fps）
        decelerationRate="normal" // 正常减速率，改善滑动手感
        directionalLockEnabled={true} // 锁定滚动方向，提升跟手性
      >
        <UiListSection style={styles.settingsOverview}>
          <UiListItem
            title="作业与物料"
            subtitle="仓库、物料对应关系与扫码反馈"
            icon="box"
            color={theme.primary}
            onPress={() => toggleSettingsGroup('system')}
            expanded={expandedSettingsGroup === 'system'}
          />
          {<MotionCollapse open={Boolean(expandedSettingsGroup === 'system')}>{expandedSettingsGroup === 'system' && (
            <View style={styles.settingsGroupPanel}>
              {renderMenuCard('仓库档案', '维护仓库与默认仓库', 'box', theme.primary, () =>
                router.push('/warehouse-management')
              )}
              {renderMenuCard(
                '物料绑定',
                '维护型号、版本与ERP存货编码',
                'link-2',
                theme.success,
                () => router.push('/inventory-binding'),
                false,
                false,
                `${configStats.inventoryBindings} 条`
              )}
              {renderSwitchCard(
                '操作提示音',
                '扫码、确认、取消和删除等语音反馈',
                'radio',
                theme.primary,
                soundEnabled,
                toggleSound
              )}
            </View>
          )}</MotionCollapse>}

          <UiListItem
            title="ERP对接"
            subtitle={erpConnectionSummary}
            icon="cloud"
            color={erpConnectionGroupColor}
            onPress={() => toggleSettingsGroup('erp')}
            expanded={expandedSettingsGroup === 'erp'}
          />
          {<MotionCollapse open={Boolean(expandedSettingsGroup === 'erp')}>{expandedSettingsGroup === 'erp' && (
            <View style={styles.settingsGroupPanel}>
              {ERP_ACCOUNTS.map((account) => {
                const connection = erpConnectionStates[account.key];
                const visual = getErpConnectionVisual(connection.status);
                return (
                  <UiListItem
                    key={account.key}
                    title={account.name}
                    subtitle={connection.message}
                    metaText={connection.tokenExpiryText}
                    icon={visual.icon}
                    color={visual.color}
                    rightText={visual.label}
                    compact
                  />
                );
              })}
              <UiListItem
                title="重新检测ERP"
                subtitle="仅检查后端配置，不消耗ERP业务接口次数"
                icon="refresh-cw"
                color={theme.primary}
                onPress={() => { void checkErpConnections({ force: true }); }}
                disabled={erpChecking}
                loading={erpChecking}
                compact
              />
            </View>
          )}</MotionCollapse>}

          <UiListItem
            title="同步助手"
            subtitle="连接电脑，导出记录与打印标签"
            icon="monitor"
            color={syncAssistantStatus.color}
            rightText={connectionStatus === 'success' ? '已连接' : connectionStatus === 'testing' ? '检测中' : syncConfig.ip ? '未连接' : '未配置'}
            onPress={() => router.push('/settings-tools', { section: 'sync' })}
          />

          <UiListItem
            title="扫码规则"
            subtitle="条码规则、字段、前缀、出库单号"
            icon="file-text"
            color={theme.accent}
            onPress={() => toggleSettingsGroup('rules')}
            expanded={expandedSettingsGroup === 'rules'}
          />
          {<MotionCollapse open={Boolean(expandedSettingsGroup === 'rules')}>{expandedSettingsGroup === 'rules' && (
            <View style={styles.settingsGroupPanel}>
              {renderMenuCard(
                '解析规则',
                '按分隔符识别二维码字段',
                'sliders',
                theme.accent,
                () => router.push('/rules'),
                false,
                false,
                `${configStats.rules} 条`
              )}
              {renderMenuCard(
                '解析诊断',
                '检查规则冲突、优先级与供应商归属',
                'activity',
                theme.warning,
                () => router.push('/rule-diagnostics')
              )}
              {renderMenuCard(
                '前缀配置',
                '自动去除 PART NO.、QTY 等前缀',
                'type',
                theme.success,
                () => router.push('/rule-prefixes')
              )}
              {renderMenuCard('出库单号规则', '配置订单格式与仓库绑定', 'hash', theme.primary, () =>
                router.push('/outbound-order-rules')
              )}
            </View>
          )}</MotionCollapse>}

          <UiListItem
            title="备份与恢复"
            subtitle="配置备份、数据库备份与恢复"
            icon="archive"
            color={theme.cyan}
            onPress={() => toggleSettingsGroup('backup')}
            expanded={expandedSettingsGroup === 'backup'}
          />
          {<MotionCollapse open={Boolean(expandedSettingsGroup === 'backup')}>{expandedSettingsGroup === 'backup' && (
            <View style={styles.settingsGroupPanel}>
              {renderMenuCard(
                '备份配置',
                '备份规则、字段、仓库、单号规则、声音与服务器',
                'save',
                theme.cyan,
                handleBackup,
                false,
                backupLoading
              )}
              {renderMenuCard(
                '恢复配置',
                '从配置备份恢复设置',
                'rotate-ccw',
                theme.purple,
                handleRestore,
                false,
                restoreLoading
              )}
              {renderMenuCard(
                '备份数据库',
                '导出完整数据库，含内部包号和打印任务',
                'database',
                theme.success,
                handleDatabaseBackup,
                false,
                dbBackupLoading
              )}
              {renderMenuCard(
                '恢复数据库',
                '用数据库备份替换当前数据',
                'hard-drive',
                theme.warning,
                handleDatabaseRestore,
                false,
                dbRestoreLoading
              )}
              {draftArchives.length > 0 && renderMenuCard(
                '恢复前作业副本',
                `${draftArchives.length} 份副本，核对后恢复未完成作业`,
                'archive', theme.warning,
                () => {
                  setSelectedDraftArchiveId(draftArchives[0]?.id || null);
                  setDraftArchiveModalVisible(true);
                }
              )}
              {renderMenuCard(
                'NAS 备份诊断', '', 'activity', theme.primary,
                () => router.push('/settings-tools', { section: 'nas' }), false, false,
                backupDiagnostic ? describeBackupDiagnostic(backupDiagnostic).label : '读取中'
              )}
              {renderMenuCard(
                '电池优化与后台权限', '电池优化与后台运行设置', 'battery-charging', theme.primary,
                () => router.push('/settings-tools', { section: 'background' })
              )}
            </View>
          )}</MotionCollapse>}

          <UiListItem title="应用更新" subtitle="检查 APK 版本与热更新" icon="download-cloud" color={theme.primary} onPress={() => router.push('/app-updates')} />

          <UiListItem
            title="关于掌上仓库"
            subtitle={`当前版本 ${APP_VERSION}`}
            icon="info"
            color={theme.textSecondary}
            onPress={() => toggleSettingsGroup('about')}
            expanded={expandedSettingsGroup === 'about'}
          />
        </UiListSection>

        {<MotionCollapse open={Boolean(expandedSettingsGroup === 'about')}>{expandedSettingsGroup === 'about' && (
          <View style={styles.aboutCard}>
            {/* App图标和名称 */}
            <View style={styles.aboutAppSection}>
              <View style={styles.aboutLogo}>
                <Feather name="package" size={scaleControlSize(16)} color={theme.primary} />
              </View>
              <Text style={styles.aboutAppName}>{APP_NAME}</Text>
              <View style={styles.aboutVersionBadge}>
                <Text style={styles.aboutVersionText}>{APP_VERSION}</Text>
              </View>
            </View>

            <View style={styles.aboutDivider} />

            {/* 公司信息 */}
            <View style={styles.aboutDetailsSection}>
              <AnimatedButton
                style={styles.aboutDetailRow}
                activeOpacity={0.7}
                onPress={() => Linking.openURL(COMPANY_WEBSITE)}
              >
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="briefcase" size={scaleControlSize(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  公司
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    {COMPANY_NAME}
                  </Text>
                  <Feather name="external-link" size={scaleControlSize(12)} color={theme.textMuted} />
                </View>
              </AnimatedButton>

              <View style={styles.aboutDetailRow}>
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="user" size={scaleControlSize(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  作者
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    {AUTHOR}
                  </Text>
                  <View style={styles.aboutDetailAccessorySpacer} />
                </View>
              </View>



              <AnimatedButton
                style={styles.aboutDetailRow}
                activeOpacity={0.7}
                onPress={() => Linking.openURL(ICP_FILING_URL)}
              >
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="shield" size={scaleControlSize(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  备案号
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    {ICP_FILING_NUMBER}
                  </Text>
                  <Feather name="external-link" size={scaleControlSize(12)} color={theme.textMuted} />
                </View>
              </AnimatedButton>

              <AnimatedButton
                style={styles.aboutDetailRow}
                activeOpacity={0.7}
                onPress={() => router.push('/privacy-policy')}
              >
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="lock" size={scaleControlSize(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  隐私政策
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    查看
                  </Text>
                  <Feather name="chevron-right" size={scaleControlSize(12)} color={theme.textMuted} />
                </View>
              </AnimatedButton>
            </View>

            <View style={styles.aboutDivider} />

            {/* 使用说明和更新日志 */}
            <View style={styles.helpRow}>
              <TouchableOpacity
                style={styles.helpEntry}
                activeOpacity={0.86}
                onPress={() => router.push('/help')}
              >
                <Feather
                  name="book-open"
                  size={scaleControlSize(14)}
                  color={theme.textMuted}
                  style={styles.helpIconWrapper}
                />
                <Text style={styles.helpText}>使用说明</Text>
                <Feather name="chevron-right" size={scaleControlSize(14)} color={theme.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.helpEntry}
                activeOpacity={0.86}
                onPress={() => router.push('/changelog')}
              >
                <Feather
                  name="clock"
                  size={scaleControlSize(14)}
                  color={theme.textMuted}
                  style={styles.changelogIconWrapper}
                />
                <Text style={styles.changelogText}>更新日志</Text>
                <Feather name="chevron-right" size={scaleControlSize(14)} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}</MotionCollapse>}

        {/* 底部留白 */}
        <View style={{ height: Spacing['4xl'] }} />
      </ScrollView>}

      {/* ==================== 在线更新模态框 ==================== */}
      <Modal visible={draftArchiveModalVisible && isFocused} transparent animationType="fade"
        onRequestClose={() => !restoringDraftArchive && setDraftArchiveModalVisible(false)}>
        <DraftArchiveDialog styles={styles} archives={draftArchives} selectedId={selectedDraftArchiveId}
          restoring={restoringDraftArchive} onClose={() => setDraftArchiveModalVisible(false)}
          onSelect={setSelectedDraftArchiveId} onRestore={handleRestoreDraftArchive} />
      </Modal>
      <Modal
        visible={updateModalVisible && (isFocused || downloading)}
        transparent
        animationType="fade"
        onRequestClose={() => !downloading && setUpdateModalVisible(false)}
      >
        <ApkUpdateDialog styles={styles} downloading={downloading} info={updateInfo} progress={downloadProgress}
          cachedReady={cachedApkReady} installStage={apkInstallStage}
          onClose={() => setUpdateModalVisible(false)} onDownload={downloadAndInstall} />
      </Modal>

      {(isFocused || showRestartModal) && alert.AlertComponent}
      <ToastContainer />

      {/* 数据库恢复后的重启提示弹窗 - 强制重启 */}
      <Modal
        visible={showRestartModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // 禁止点击遮罩关闭，必须点击重启按钮
          return false;
        }}
      >
        <AppModalViewport style={styles.restartModalOverlay}>
          <AppModalCard
            title="需要重启应用"
            subtitle={restartMessage}
            style={styles.restartModalContent}
            bodyStyle={styles.restartModalBody}
            size="auto"
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                primaryLabel="立即重启应用"
                onPrimaryPress={async () => {
                  try {
                    await Updates.reloadAsync();
                  } catch (error) {
                    logger.error('重启应用失败:', error);
                    alert.showError('重启失败，请手动关闭应用后重新打开');
                  }
                }}
              />
            }
          >
            <View style={styles.restartModalIcon}>
              <Feather name="refresh-cw" size={48} color={theme.accent} />
            </View>

            <View style={styles.restartModalWarningContainer}>
              <View style={styles.restartModalWarningTitleRow}>
                <Feather name="alert-triangle" size={18} color={theme.warning} />
                <Text style={styles.restartModalWarning}>必须重启应用才能继续使用</Text>
              </View>
              <Text style={styles.restartModalWarningSub}>未重启可能导致数据错乱</Text>
            </View>
          </AppModalCard>
        </AppModalViewport>
      </Modal>
    </Screen>
  );
}
