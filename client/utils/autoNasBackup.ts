import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getDatabaseBackupDateString } from './backupNaming';
import { hasAnyBusinessData } from './database';
import {
  createRealtimeDatabaseBackupToNas,
  getLastNasDatabaseBackupSuccess,
} from './nasBackup';
import { logger } from './logger';

export const AUTO_NAS_BACKUP_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const FileSystem = FileSystemLegacy as any;
const AUTO_NAS_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_NAS_BACKUP_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
const AUTO_NAS_BACKUP_LAST_FAILURE_AT_KEY = '@auto_nas_backup_last_failure_at';
const AUTO_NAS_BACKUP_STATUS_KEY = '@auto_nas_backup_status_v1';
const NATIVE_AUTO_NAS_BACKUP_STATUS_FILE = 'auto-db-backup/native-status.json';

let autoBackupInFlight = false;

export type AutoNasBackupSkipReason =
  | 'web-platform'
  | 'in-flight'
  | 'failure-backoff'
  | 'not-due'
  | 'no-business-data'
  | 'native-workmanager-primary';

export type AutoNasBackupStatusKind = 'success' | 'skipped' | 'failed';

export interface AutoNasBackupStatus {
  lastCheckedAt: number;
  trigger: string;
  status: AutoNasBackupStatusKind;
  reason?: AutoNasBackupSkipReason;
  lastError?: string;
  lastSuccessAt?: number;
  lastSuccessFileName?: string;
}

export type NativeAutoNasBackupStatusKind = 'running' | 'success' | 'skipped' | 'failed';

export interface NativeAutoNasBackupStatus {
  source: 'native-workmanager';
  checkedAtMs: number;
  status: NativeAutoNasBackupStatusKind;
  trigger: string;
  reason?: string;
  fileName?: string;
  errorMessage?: string;
  lastSuccessAtMs?: number;
  lastSuccessDate?: string;
}

export type AutoNasBackupResult =
  | { status: 'success'; fileName: string }
  | { status: 'skipped'; reason: AutoNasBackupSkipReason }
  | { status: 'failed'; message: string };

type AutoNasBackupSuccessFields = Partial<
  Pick<AutoNasBackupStatus, 'lastSuccessAt' | 'lastSuccessFileName'>
>;

const AUTO_NAS_BACKUP_REASON_LABELS: Record<AutoNasBackupSkipReason, string> = {
  'web-platform': 'Web 预览不执行自动备份',
  'in-flight': '已有备份正在执行',
  'failure-backoff': '上次失败后冷却中',
  'not-due': '未到定时备份间隔',
  'no-business-data': '暂无业务数据',
  'native-workmanager-primary': 'Android 后台任务负责自动备份',
};

const AUTO_NAS_BACKUP_TRIGGER_LABELS: Record<string, string> = {
  'app-ready': '应用启动完成',
  'app-active': '回到前台',
  'app-active-interval': '前台定时检查',
  'app-background': '切到后台',
  'app-inactive': '系统暂停',
  workmanager: 'Android 后台任务',
};

const NATIVE_AUTO_NAS_BACKUP_REASON_LABELS: Record<string, string> = {
  'database-missing': '数据库文件不存在',
  'already-current': '今天已有当前数据库备份',
  'interval-not-elapsed': '数据已变化但未满 6 小时间隔',
  'no-business-data': '暂无业务数据',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readSkipReason = (value: unknown): AutoNasBackupSkipReason | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value in AUTO_NAS_BACKUP_REASON_LABELS ? (value as AutoNasBackupSkipReason) : undefined;
};

const readStatusKind = (value: unknown): AutoNasBackupStatusKind | undefined => {
  if (value === 'success' || value === 'skipped' || value === 'failed') {
    return value;
  }
  return undefined;
};

const readNativeStatusKind = (value: unknown): NativeAutoNasBackupStatusKind | undefined => {
  if (value === 'running' || value === 'success' || value === 'skipped' || value === 'failed') {
    return value;
  }
  return undefined;
};

const parseStoredStatus = (value: string | null): AutoNasBackupStatus | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const lastCheckedAt = readNumber(parsed.lastCheckedAt);
    const trigger = readString(parsed.trigger);
    const status = readStatusKind(parsed.status);
    if (!lastCheckedAt || !trigger || !status) {
      return null;
    }

    return {
      lastCheckedAt,
      trigger,
      status,
      reason: readSkipReason(parsed.reason),
      lastError: readString(parsed.lastError),
      lastSuccessAt: readNumber(parsed.lastSuccessAt),
      lastSuccessFileName: readString(parsed.lastSuccessFileName),
    };
  } catch (error) {
    logger.warn('[AutoNasBackup] Failed to parse stored status:', error);
    return null;
  }
};

const readStoredAutoNasBackupStatus = async (): Promise<AutoNasBackupStatus | null> => {
  const saved = await AsyncStorage.getItem(AUTO_NAS_BACKUP_STATUS_KEY);
  return parseStoredStatus(saved);
};

export const getAutoNasBackupStatus = async (): Promise<AutoNasBackupStatus | null> => {
  try {
    return await readStoredAutoNasBackupStatus();
  } catch (error) {
    logger.warn('[AutoNasBackup] Failed to read auto backup status:', error);
    return null;
  }
};

const parseNativeAutoNasBackupStatus = (value: string | null): NativeAutoNasBackupStatus | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const checkedAtMs = readNumber(parsed.checkedAtMs);
    const status = readNativeStatusKind(parsed.status);
    const trigger = readString(parsed.trigger);
    if (!checkedAtMs || !status || !trigger) {
      return null;
    }

    return {
      source: 'native-workmanager',
      checkedAtMs,
      status,
      trigger,
      reason: readString(parsed.reason),
      fileName: readString(parsed.fileName),
      errorMessage: readString(parsed.errorMessage),
      lastSuccessAtMs: readNumber(parsed.lastSuccessAtMs),
      lastSuccessDate: readString(parsed.lastSuccessDate),
    };
  } catch (error) {
    logger.warn('[AutoNasBackup] Failed to parse native backup status:', error);
    return null;
  }
};

export const getNativeAutoNasBackupStatus =
  async (): Promise<NativeAutoNasBackupStatus | null> => {
    if (!FileSystem.documentDirectory) {
      return null;
    }

    try {
      const statusUri = `${FileSystem.documentDirectory}${NATIVE_AUTO_NAS_BACKUP_STATUS_FILE}`;
      const info = await FileSystem.getInfoAsync(statusUri);
      if (!info.exists) {
        return null;
      }

      const raw = await FileSystem.readAsStringAsync(statusUri);
      return parseNativeAutoNasBackupStatus(raw);
    } catch (error) {
      logger.warn('[AutoNasBackup] Failed to read native backup status:', error);
      return null;
    }
  };

const getLastSuccessFields = async (): Promise<AutoNasBackupSuccessFields> => {
  const lastSuccess = await getLastNasDatabaseBackupSuccess();
  if (!lastSuccess) {
    return {};
  }

  return {
    lastSuccessAt: lastSuccess.successAtMs,
    lastSuccessFileName: lastSuccess.fileName,
  };
};

const recordAutoNasBackupStatus = async (
  status: Omit<AutoNasBackupStatus, 'lastSuccessAt' | 'lastSuccessFileName'> &
    AutoNasBackupSuccessFields
): Promise<void> => {
  try {
    const previous = await readStoredAutoNasBackupStatus();
    const latestSuccess: AutoNasBackupSuccessFields = await getLastSuccessFields().catch((error) => {
      logger.warn('[AutoNasBackup] Failed to read last NAS success:', error);
      return {};
    });
    const next: AutoNasBackupStatus = {
      ...status,
      lastSuccessAt: latestSuccess.lastSuccessAt ?? status.lastSuccessAt ?? previous?.lastSuccessAt,
      lastSuccessFileName:
        latestSuccess.lastSuccessFileName ??
        status.lastSuccessFileName ??
        previous?.lastSuccessFileName,
    };
    await AsyncStorage.setItem(AUTO_NAS_BACKUP_STATUS_KEY, JSON.stringify(next));
  } catch (error) {
    logger.warn('[AutoNasBackup] Failed to record auto backup status:', error);
  }
};

export const getAutoNasBackupReasonLabel = (reason?: string): string => {
  if (!reason) {
    return '无';
  }
  return AUTO_NAS_BACKUP_REASON_LABELS[reason as AutoNasBackupSkipReason] ?? reason;
};

export const getNativeAutoNasBackupReasonLabel = (reason?: string): string => {
  if (!reason) {
    return '无';
  }
  return NATIVE_AUTO_NAS_BACKUP_REASON_LABELS[reason] ?? reason;
};

export const getAutoNasBackupTriggerLabel = (trigger?: string): string => {
  if (!trigger) {
    return '暂无';
  }
  return AUTO_NAS_BACKUP_TRIGGER_LABELS[trigger] ?? trigger;
};

export const getAutoNasBackupStatusLabel = (
  status: AutoNasBackupStatus | null | undefined
): string => {
  if (!status) {
    return '暂无记录';
  }

  if (status.status === 'success') {
    return '备份成功';
  }
  if (status.status === 'failed') {
    return '备份失败';
  }
  return '已跳过';
};

export const getNativeAutoNasBackupStatusLabel = (
  status: NativeAutoNasBackupStatus | null | undefined
): string => {
  if (!status) {
    return '暂无记录';
  }
  if (status.status === 'running') {
    return '执行中';
  }
  if (status.status === 'success') {
    return '后台成功';
  }
  if (status.status === 'failed') {
    return '后台失败';
  }
  return '后台已检查';
};

const getLastFailureAt = async (): Promise<number> => {
  const saved = await AsyncStorage.getItem(AUTO_NAS_BACKUP_LAST_FAILURE_AT_KEY);
  const value = Number(saved || 0);
  return Number.isFinite(value) ? value : 0;
};

const recordFailure = async (): Promise<void> => {
  await AsyncStorage.setItem(AUTO_NAS_BACKUP_LAST_FAILURE_AT_KEY, String(Date.now()));
};

const clearFailure = async (): Promise<void> => {
  await AsyncStorage.removeItem(AUTO_NAS_BACKUP_LAST_FAILURE_AT_KEY);
};

export const maybeRunAutoNasBackup = async (
  trigger: string
): Promise<AutoNasBackupResult> => {
  const checkedAt = Date.now();
  const recordSkipped = async (reason: AutoNasBackupSkipReason): Promise<AutoNasBackupResult> => {
    await recordAutoNasBackupStatus({
      lastCheckedAt: checkedAt,
      trigger,
      status: 'skipped',
      reason,
      lastError: undefined,
    });
    return { status: 'skipped', reason };
  };

  if (Platform.OS === 'web') {
    return recordSkipped('web-platform');
  }

  if (autoBackupInFlight) {
    return recordSkipped('in-flight');
  }

  if (Platform.OS === 'android') {
    return recordSkipped('native-workmanager-primary');
  }

  let uploadStarted = false;
  try {
    const lastFailureAt = await getLastFailureAt();
    if (lastFailureAt > 0 && checkedAt - lastFailureAt < AUTO_NAS_BACKUP_FAILURE_BACKOFF_MS) {
      return await recordSkipped('failure-backoff');
    }

    const lastSuccess = await getLastNasDatabaseBackupSuccess();
    const today = getDatabaseBackupDateString();
    const hasSuccessfulBackupToday = lastSuccess?.dateStr === today;
    const intervalElapsed =
      !lastSuccess || checkedAt - lastSuccess.successAtMs >= AUTO_NAS_BACKUP_INTERVAL_MS;

    if (hasSuccessfulBackupToday && !intervalElapsed) {
      return await recordSkipped('not-due');
    }

    autoBackupInFlight = true;
    uploadStarted = true;
    logger.log(`[AutoNasBackup] ${trigger} auto backup check passed, preparing upload`);

    if (!(await hasAnyBusinessData())) {
      logger.log('[AutoNasBackup] No business data, skipping auto NAS backup');
      return await recordSkipped('no-business-data');
    }

    const result = await createRealtimeDatabaseBackupToNas({ timeoutMs: 15000 });
    await clearFailure();
    await recordAutoNasBackupStatus({
      lastCheckedAt: checkedAt,
      trigger,
      status: 'success',
      reason: undefined,
      lastError: undefined,
      lastSuccessAt: Date.now(),
      lastSuccessFileName: result.fileName,
    });
    logger.log('[AutoNasBackup] Auto NAS database backup succeeded:', result.fileName);
    return { status: 'success', fileName: result.fileName };
  } catch (error) {
    await recordFailure().catch((storageError) => {
      logger.warn('[AutoNasBackup] Failed to record failure time:', storageError);
    });
    const message = error instanceof Error ? error.message : String(error || '未知错误');
    await recordAutoNasBackupStatus({
      lastCheckedAt: checkedAt,
      trigger,
      status: 'failed',
      reason: undefined,
      lastError: message,
    });
    logger.warn(`[AutoNasBackup] ${trigger} auto NAS database backup failed:`, error);
    return { status: 'failed', message };
  } finally {
    if (uploadStarted) {
      autoBackupInFlight = false;
    }
  }
};
