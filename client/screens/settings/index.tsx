import { OtaUpdatePanel } from '@/screens/app-updates';
import { UiPageHeader } from '@/components/UiRedesign';
import { MotionCollapse } from '@/components/AppMotion';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { AppModal as Modal } from '@/components/AppModal';
import { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, useWindowDimensions, Platform, FlatList, Linking, InteractionManager } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
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
import { UiListItem, UiListSection } from '@/components/UiRedesign';
import { createStyles } from './styles';
import { AnimatedButton } from '@/components/AnimatedButton';
import { Spacing } from '@/constants/theme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { rs } from '@/utils/responsive';
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
import { parseAuthFromUrl, base64Encode, compareVersions, getUpdateServer } from '@/utils/update';
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

const UPDATE_RETRY_DELAYS = [1000, 2000, 4000];

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
let cachedErpConnectionStates: ErpConnectionStates | null = null;
let lastErpConnectionCheckAt = 0;
let erpConnectionCheckInFlight: Promise<ErpConnectionStates> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getUpdateRequestErrorMessage = (error: unknown): string => {
  return formatUserFacingErrorMessage(error, '检查更新失败，请稍后重试');
};

const withUpdateCacheBuster = (url: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
};

const normalizeUpdateDownloadUrl = (
  downloadUrl: unknown,
  downloadBaseUrl: string
): string | null => {
  if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
    return null;
  }

  try {
    const resolvedUrl = new URL(downloadUrl.trim(), `${downloadBaseUrl.replace(/\/+$/, '')}/`);
    if (!['http:', 'https:'].includes(resolvedUrl.protocol)) {
      return null;
    }

    return resolvedUrl.toString();
  } catch (error) {
    logger.warn('[checkForUpdate] version.json 下载地址无效，已跳过:', error);
    return null;
  }
};

const resolveUpdateDownloadUrls = (
  downloadUrl: unknown,
  downloadUrls: unknown,
  downloadBaseUrl: string
): string[] => {
  const fallbackUrl = `${downloadBaseUrl.replace(/\/+$/, '')}/app-release.apk`;
  const candidates = [
    ...(Array.isArray(downloadUrls) ? downloadUrls : []),
    downloadUrl,
    fallbackUrl,
  ];
  const seen = new Set<string>();
  const resolvedUrls: string[] = [];

  for (const candidate of candidates) {
    const resolvedUrl = normalizeUpdateDownloadUrl(candidate, downloadBaseUrl);

    if (resolvedUrl && !seen.has(resolvedUrl)) {
      seen.add(resolvedUrl);
      resolvedUrls.push(resolvedUrl);
    }
  }

  return resolvedUrls.length > 0 ? resolvedUrls : [fallbackUrl];
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
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const showSettingsLoadError = alert.showError;
  const { ToastContainer } = useToast();

  // 使用 useWindowDimensions 替代 Dimensions.addEventListener，
  // 避免键盘弹出/收起时触发不必要的重渲染和样式重建导致滚动卡顿
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

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
    () => createStyles(theme, screenWidth, screenHeight, undefined),
    [theme, screenWidth, screenHeight]
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
  const [erpConnectionStates, setErpConnectionStates] = useState<
    Record<ErpAccountKey, ErpConnectionState>
  >(() =>
    Object.fromEntries(
      ERP_ACCOUNTS.map((account) => [
        account.key,
        isErpAccountAvailable(account)
          ? { message: '正在检测后端', status: 'checking' as const }
          : { message: '账套尚未开放', status: 'unavailable' as const },
      ])
    ) as Record<ErpAccountKey, ErpConnectionState>
  );

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
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    downloadUrls: string[];
    changelog: string;
    forceUpdate: boolean;
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
      if (
        !options.force &&
        cachedErpConnectionStates &&
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

      if (!erpConnectionCheckInFlight) {
        const checkTask = (async (): Promise<ErpConnectionStates> => {
          const entries = await Promise.all(
            ERP_ACCOUNTS.map(async (account): Promise<[ErpAccountKey, ErpConnectionState]> => {
          if (!isErpAccountAvailable(account)) {
            return [account.key, { message: '账套尚未开放', status: 'unavailable' }];
          }

          try {
            const health = await backendJsonRequest<ErpHealthResponse>(ERP_HEALTH_PATH, {
              baseUrl: account.backendBaseUrl,
              erpAccountKey: account.key,
              method: 'GET',
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
            logger.warn(`[ERP对接] ${account.name} 健康检查失败:`, error);
            return [
              account.key,
              {
                message: formatUserFacingErrorMessage(error, '无法连接后端'),
                status: 'error',
              },
            ];
          }
            })
          );

          return Object.fromEntries(entries) as ErpConnectionStates;
        })();
        erpConnectionCheckInFlight = checkTask;
        const clearCurrentCheck = () => {
          if (erpConnectionCheckInFlight === checkTask) {
            erpConnectionCheckInFlight = null;
          }
        };
        void checkTask.then(clearCurrentCheck, clearCurrentCheck);
      }

      const activeCheck = erpConnectionCheckInFlight;
      if (!activeCheck) {
        return;
      }
      const nextStates = await activeCheck;
      cachedErpConnectionStates = nextStates;
      lastErpConnectionCheckAt = Date.now();
      setErpConnectionStates(nextStates);
    },
    []
  );

  const handleManualErpCheck = useCallback(() => {
    void checkErpConnections({ force: true });
  }, [checkErpConnections]);

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
        void checkErpConnections();
      });
      return () => {
        active = false;
        task.cancel();
      };
    }, [checkErpConnections, loadAutoBackupStatus, loadData, showSettingsLoadError])
  );

  // ==================== 在线更新功能 ====================

  // 检查更新
  const checkForUpdate = async () => {
    if (checkingUpdate) return;

    setCheckingUpdate(true);
    setDownloadProgress(0);
    try {
      const baseUrl = (await getUpdateServer()).trim().replace(/\/+$/, '');

      // 解析URL中的认证信息
      const authInfo = parseAuthFromUrl(baseUrl);
      const requestBaseUrl = (authInfo?.baseUrl || baseUrl).replace(/\/+$/, '');
      const versionUrl = `${requestBaseUrl}/version.json`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };

      // 如果URL包含认证信息，添加Authorization头
      if (authInfo) {
        const authString = `${authInfo.username}:${authInfo.password}`;
        const authBase64 = base64Encode(authString);
        headers['Authorization'] = `Basic ${authBase64}`;
      }

      let response: Response | null = null;
      let lastErrorMessage = '';

      // 覆盖安装或首次安装后，Android 网络栈偶尔会在刚启动时短暂失败，多次退避重试避免用户重启手机。
      for (let attempt = 0; attempt < UPDATE_RETRY_DELAYS.length; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const requestUrl = withUpdateCacheBuster(versionUrl);

        try {
          response = await fetch(requestUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
          lastErrorMessage = '';
          break;
        } catch (error) {
          lastErrorMessage = getUpdateRequestErrorMessage(error);
          logger.warn(
            `[checkForUpdate] 第 ${attempt + 1} 次请求失败:`,
            lastErrorMessage,
            requestUrl
          );
          if (attempt < UPDATE_RETRY_DELAYS.length - 1) {
            await sleep(UPDATE_RETRY_DELAYS[attempt]);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!response) {
        throw new Error(lastErrorMessage || '更新服务器无响应');
      }

      if (!response.ok) {
        let errorMessage = `无法连接到更新服务器 (${response.status})`;

        if (response.status === 401) {
          errorMessage = '认证失败，请检查服务器地址中的用户名和密码是否正确';
        } else if (response.status === 403) {
          errorMessage = '禁止访问，请检查服务器权限设置';
        } else if (response.status === 404) {
          errorMessage = '更新文件不存在，请检查服务器地址是否正确';
        } else {
          errorMessage = `无法连接到更新服务器 (${response.status})，请检查网络和服务器地址`;
        }

        alert.showError(`${errorMessage}。请检查网络连接后重试。`);
        return;
      }

      const data = await response.json();

      if (data.androidPackage !== ANDROID_PACKAGE) {
        alert.showWarning('NAS 上的更新清单不是当前正式版。请先上传包含正确包名的 version.json 和对应 APK，再检查更新。');
        return;
      }

      // 比较版本号
      const currentVersion = APP_VERSION.replace(/^V/, '');
      const latestVersion = (data.version || '0.0.0').replace(/^V/, '');

      const isNewVersion = compareVersions(latestVersion, currentVersion) > 0;

      if (isNewVersion) {
        if (!Number.isInteger(data.versionCode) || data.versionCode <= ANDROID_VERSION_CODE) {
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

        setUpdateInfo({
          version: latestVersion,
          downloadUrls: resolveUpdateDownloadUrls(data.downloadUrl, data.downloadUrls, baseUrl),
          changelog: changelogText,
          forceUpdate: data.forceUpdate || false,
        });
        setUpdateModalVisible(true);
      } else {
        alert.showSuccess(`当前已是最新版本 (${APP_VERSION})`);
      }
    } catch (error) {
      const errorMessage = getUpdateRequestErrorMessage(error);
      logger.error('检查更新失败:', errorMessage, error);
      alert.showError(`检查更新失败：${errorMessage}。请确认网络可访问更新服务器。`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // 下载并安装更新
  const downloadAndInstall = async () => {
    if (!updateInfo || downloading) return;

    // Android 平台检查
    if (Platform.OS !== 'android') {
      alert.showError('目前仅支持 Android 系统更新');
      return;
    }

    setDownloading(true);
    setDownloadProgress(0);

    try {
      // 下载目录：使用应用缓存目录
      let apkUri: string;

      if (FileSystem.cacheDirectory) {
        apkUri = FileSystem.cacheDirectory + 'ZhongCangWarehouse_update.apk';
      } else if (FileSystem.documentDirectory) {
        apkUri = FileSystem.documentDirectory + 'ZhongCangWarehouse_update.apk';
      } else {
        alert.showError('无法获取存储目录');
        setDownloading(false);
        return;
      }

      // 创建下载回调
      const downloadCallback = (downloadProgressData: {
        totalBytesWritten: number;
        totalBytesExpectedToWrite: number;
      }) => {
        if (downloadProgressData.totalBytesExpectedToWrite <= 0) {
          return;
        }

        const progress =
          downloadProgressData.totalBytesWritten / downloadProgressData.totalBytesExpectedToWrite;
        setDownloadProgress(Math.min(99, Math.round(progress * 100)));
      };

      let downloadedApkUri: string | null = null;
      let lastDownloadErrorMessage = '';

      for (let index = 0; index < updateInfo.downloadUrls.length; index += 1) {
        const downloadUrl = updateInfo.downloadUrls[index];
        await FileSystem.deleteAsync(apkUri, { idempotent: true });
        setDownloadProgress(0);

        // 解析URL中的认证信息
        const authInfo = parseAuthFromUrl(downloadUrl);
        const requestDownloadUrl = authInfo?.baseUrl || downloadUrl;
        const downloadHeaders: Record<string, string> = {};

        if (authInfo) {
          const authString = `${authInfo.username}:${authInfo.password}`;
          const authBase64 = base64Encode(authString);
          downloadHeaders['Authorization'] = `Basic ${authBase64}`;
        }

        logger.log(
          `[update] 开始下载安装包线路 ${index + 1}/${updateInfo.downloadUrls.length}:`,
          requestDownloadUrl
        );

        // 开始下载
        const downloadResumable = FileSystem.createDownloadResumable(
          requestDownloadUrl,
          apkUri,
          { headers: downloadHeaders },
          downloadCallback
        );

        let result: { uri: string; status: number } | undefined;
        try {
          result = await downloadResumable.downloadAsync();
        } catch (downloadError) {
          const message =
            downloadError instanceof Error
              ? downloadError.message
              : String(downloadError || '未知错误');
          lastDownloadErrorMessage = message;
          logger.warn(
            `[update] 安装包下载线路 ${index + 1}/${updateInfo.downloadUrls.length} 失败:`,
            message
          );
          continue;
        }

        if (!result || !result.uri || result.status < 200 || result.status >= 300) {
          const statusText = result?.status ? `HTTP ${result.status}` : '无下载结果';
          lastDownloadErrorMessage = statusText;
          logger.warn(
            `[update] 安装包下载线路 ${index + 1}/${updateInfo.downloadUrls.length} 状态异常:`,
            statusText
          );
          continue;
        }

        const apkInfo = await FileSystem.getInfoAsync(result.uri);
        if (!apkInfo.exists || !('size' in apkInfo) || (apkInfo as { size?: number }).size === 0) {
          lastDownloadErrorMessage = '文件为空';
          logger.warn(
            `[update] 安装包下载线路 ${index + 1}/${updateInfo.downloadUrls.length} 文件为空`
          );
          continue;
        }

        downloadedApkUri = result.uri;
        break;
      }

      if (!downloadedApkUri) {
        alert.showError(
          `安装包下载失败：${lastDownloadErrorMessage || '所有下载地址均不可用'}。请检查 version.json 中的 downloadUrl/downloadUrls 或网络后重试。`
        );
        setDownloading(false);
        return;
      }

      try {
        await backupDatabaseToNasForUpdate('安装前');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        alert.showError(
          `安装前 NAS 数据库备份失败：${message}。请稍后再试，避免覆盖安装时丢失当前出库数据。`
        );
        setDownloading(false);
        return;
      }

      // 下载完成
      setDownloadProgress(100);

      const installUri =
        typeof FileSystem.getContentUriAsync === 'function'
          ? await FileSystem.getContentUriAsync(downloadedApkUri)
          : downloadedApkUri;

      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: installUri,
        type: 'application/vnd.android.package-archive',
        flags: 1,
      });

      alert.showSuccess('安装程序已打开，请按提示完成更新');

      setDownloading(false);
    } catch (error) {
      logger.error('安装程序打开失败:', error);
      const message = error instanceof Error ? error.message : String(error || '');
      const installHint = message ? `\n原因：${message}` : '';
      alert.showError(`安装程序打开失败，请确认已允许本应用安装未知来源应用${installHint}`);
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
          `已备份配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 出库单号规则: ${Object.keys(backupData.outboundWarehouseOrderRules || {}).length} 条\n• 操作提示音: ${backupData.soundEnabled === false ? '关闭' : '开启'}\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}\n\n物料绑定请使用独立的 Excel 导入/导出。\n请妥善保管备份文件！`
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
      '即将备份完整的数据库文件（.db），包含所有数据：\n\n• 配置数据：规则、字段、绑定、仓库\n• 业务数据：订单、物料、拆包记录',
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
      '[严重警告] 即将从备份文件恢复数据库！\n\n此操作将：\n• 替换当前所有数据（配置 + 业务）\n• 恢复为备份时的完整状态\n• 将当前未完成作业保存为独立副本，不自动混入恢复后的数据库\n\n恢复前会自动备份当前数据库。作业副本可在设置中核对后恢复。',
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

  const erpConnectionSummary = useMemo(() => {
    const availableAccounts = ERP_ACCOUNTS.filter(isErpAccountAvailable);
    const connectedCount = availableAccounts.filter(
      (account) => erpConnectionStates[account.key].status === 'connected'
    ).length;
    const checking = availableAccounts.some(
      (account) => erpConnectionStates[account.key].status === 'checking'
    );

    if (checking) {
      return '正在检测ERP后端';
    }
    if (availableAccounts.length === 0) {
      return '尚未开放ERP账套';
    }
    return `${connectedCount}/${availableAccounts.length} 套已就绪`;
  }, [erpConnectionStates]);

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
        <KeyboardAwareFormScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={{ backgroundColor: theme.backgroundDefault, padding: 18, borderRadius: 16, marginBottom: 16 }}>
            <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '700' }}>APK 版本</Text>
            <Text style={{ color: theme.textSecondary, marginVertical: 10 }}>当前安装版本：{APP_VERSION}</Text>
            {SELF_UPDATE_ENABLED && <AnimatedButton disabled={checkingUpdate || downloading} onPress={checkForUpdate} style={{ backgroundColor: theme.primary, padding: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: theme.buttonPrimaryText }}>{checkingUpdate ? '检查中…' : '检查 APK 更新'}</Text>
            </AnimatedButton>}
          </View>
          <OtaUpdatePanel />
        </KeyboardAwareFormScrollView>
      </> :       <KeyboardAwareFormScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        bottomOffset={Spacing.xl}
        scrollEventThrottle={16} // 控制滚动事件频率（16ms ≈ 60fps）
        decelerationRate="normal" // 正常减速率，改善滑动手感
        directionalLockEnabled={true} // 锁定滚动方向，提升跟手性
      >
        <View style={styles.settingsPageHeader}>
          <Text style={styles.settingsPageTitle}>设置</Text>
        </View>

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
              {renderMenuCard(
                '重新检测ERP',
                '仅检查后端配置，不消耗ERP业务接口次数',
                'refresh-cw',
                theme.primary,
                handleManualErpCheck,
                false,
                Object.values(erpConnectionStates).some((item) => item.status === 'checking')
              )}
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
                '导出完整数据库文件',
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
                <Feather name="package" size={rs(16)} color={theme.primary} />
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
                  <Feather name="briefcase" size={rs(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  公司
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    {COMPANY_NAME}
                  </Text>
                  <Feather name="external-link" size={rs(12)} color={theme.textMuted} />
                </View>
              </AnimatedButton>

              <View style={styles.aboutDetailRow}>
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="user" size={rs(14)} color={theme.textSecondary} />
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
                  <Feather name="shield" size={rs(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  备案号
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    {ICP_FILING_NUMBER}
                  </Text>
                  <Feather name="external-link" size={rs(12)} color={theme.textMuted} />
                </View>
              </AnimatedButton>

              <AnimatedButton
                style={styles.aboutDetailRow}
                activeOpacity={0.7}
                onPress={() => router.push('/privacy-policy')}
              >
                <View style={styles.aboutDetailIconWrapper}>
                  <Feather name="lock" size={rs(14)} color={theme.textSecondary} />
                </View>
                <Text style={styles.aboutDetailLabel} numberOfLines={1}>
                  隐私政策
                </Text>
                <View style={styles.aboutDetailRight}>
                  <Text style={styles.aboutDetailValue} numberOfLines={1}>
                    查看
                  </Text>
                  <Feather name="chevron-right" size={rs(12)} color={theme.textMuted} />
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
                  size={rs(14)}
                  color={theme.textMuted}
                  style={styles.helpIconWrapper}
                />
                <Text style={styles.helpText}>使用说明</Text>
                <Feather name="chevron-right" size={rs(14)} color={theme.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.helpEntry}
                activeOpacity={0.86}
                onPress={() => router.push('/changelog')}
              >
                <Feather
                  name="clock"
                  size={rs(14)}
                  color={theme.textMuted}
                  style={styles.changelogIconWrapper}
                />
                <Text style={styles.changelogText}>更新日志</Text>
                <Feather name="chevron-right" size={rs(14)} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}</MotionCollapse>}

        {/* 底部留白 */}
        <View style={{ height: Spacing['4xl'] }} />
      </KeyboardAwareFormScrollView>}

      {/* ==================== 在线更新模态框 ==================== */}
      <Modal visible={draftArchiveModalVisible && isFocused} transparent animationType="fade"
        onRequestClose={() => !restoringDraftArchive && setDraftArchiveModalVisible(false)}>
        <View style={styles.updateModalOverlay}>
          <AppModalCard title="恢复前作业副本" size="largeForm" stretchBody
            subtitle="副本不会自动写回业务记录。请先核对单据和实物，再恢复未完成作业。"
            onClose={restoringDraftArchive ? undefined : () => setDraftArchiveModalVisible(false)}
            footer={<AppModalActions primaryLabel={restoringDraftArchive ? '正在恢复' : '恢复副本'}
              onPrimaryPress={handleRestoreDraftArchive}
              primaryDisabled={restoringDraftArchive || !selectedDraftArchiveId}
              secondaryLabel="稍后" secondaryDisabled={restoringDraftArchive}
              onSecondaryPress={() => setDraftArchiveModalVisible(false)} />}>
            <FlatList data={draftArchives} keyExtractor={item => item.id}
              renderItem={({ item }) => <UiListItem
                title={formatDateTimeExport(item.createdAt)}
                subtitle={`${item.databaseFileName} · ${new Set([...item.entries, ...item.lateEntries].map(([key]) => key)).size} 项暂存`}
                icon={selectedDraftArchiveId === item.id ? 'check-circle' : 'archive'}
                color={selectedDraftArchiveId === item.id ? theme.primary : theme.textMuted}
                onPress={() => !restoringDraftArchive && setSelectedDraftArchiveId(item.id)}
              />} />
          </AppModalCard>
        </View>
      </Modal>
      <Modal
        visible={updateModalVisible && (isFocused || downloading)}
        transparent
        animationType="fade"
        onRequestClose={() => !downloading && setUpdateModalVisible(false)}
      >
        <View style={styles.updateModalOverlay}>
          <AppModalCard
            title="发现新版本"
            subtitle={
              downloading
                ? '正在下载安装包，请保持网络稳定并稍候。'
                : '请确认版本信息与更新内容，再决定是否下载安装。'
            }
            onClose={
              downloading
                ? undefined
                : () => {
                    setUpdateModalVisible(false);
                  }
            }
            style={styles.modalContent}
            bodyStyle={styles.modalBody}
            size="largeForm"
            stretchBody
            footer={
              !downloading ? (
                <View style={styles.updateModalFooter}>
                  <AppModalActions
                    containerStyle={styles.modalActions}
                    secondaryLabel="关闭"
                    onSecondaryPress={() => {
                      setUpdateModalVisible(false);
                    }}
                    primaryLabel="下载更新"
                    onPrimaryPress={downloadAndInstall}
                  />
                </View>
              ) : undefined
            }
          >
            <KeyboardAwareFormScrollView
              style={styles.updateModalBody}
              contentContainerStyle={styles.updateModalBodyContent}
              bottomOffset={32}
              scrollEventThrottle={16}
            >
              {updateInfo && (
                <>
                  <View style={styles.updateVersionInfo}>
                    <Text style={styles.updateVersionLabel}>新版本</Text>
                    <Text style={styles.updateVersionText}>V{updateInfo.version}</Text>
                  </View>

                  <Text style={styles.updateChangelogTitle}>更新内容</Text>
                  <Text style={styles.updateChangelogText}>{updateInfo.changelog}</Text>

                  {downloading && (
                    <View style={styles.downloadProgress}>
                      <View style={styles.progressBarContainer}>
                        <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
                      </View>
                      <Text style={styles.progressText}>下载中... {downloadProgress}%</Text>
                    </View>
                  )}
                </>
              )}
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
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
        <View style={styles.restartModalOverlay}>
          <AppModalCard
            title="需要重启应用"
            subtitle={restartMessage}
            style={styles.restartModalContent}
            bodyStyle={styles.restartModalBody}
            size="form"
            stretchBody
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
        </View>
      </Modal>
    </Screen>
  );
}
