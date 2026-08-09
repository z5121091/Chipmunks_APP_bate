import * as FileSystemLegacy from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UPDATE_CONFIG } from '@/constants/config';
import { ensureDatabaseConnectionReady, exportDatabaseFile } from './database';
import { buildDatabaseBackupFileName, getDatabaseBackupDateString } from './backupNaming';
import { base64Encode, getUpdateServer, parseAuthFromUrl } from './update';
import { logger } from './logger';
import { scanQueue } from './scanQueue';
import { safeJsonParseNullable } from './json';

const FileSystem = FileSystemLegacy as any;

type WebDavServer = {
  baseUrl: string;
  headers: Record<string, string>;
};

export type NasDatabaseBackupResult = {
  fileName: string;
  remoteUrl: string;
};

export type NasDatabaseBackupSource =
  | 'auto-js'
  | 'manual-export'
  | 'online-update'
  | 'native-workmanager'
  | 'unknown';

export type RealtimeDatabaseBackupFileResult = {
  localFilePath: string;
};

export type RealtimeNasDatabaseBackupResult = NasDatabaseBackupResult & {
  localFilePath: string;
};

export type NasDatabaseBackupSuccess = NasDatabaseBackupResult & {
  dateStr: string;
  successAtMs: number;
  source: NasDatabaseBackupSource;
};

const NAS_DATABASE_BACKUP_SUCCESS_KEY = '@nas_database_backup_last_success';
const NAS_REQUEST_TIMEOUT_MS = 12_000;

const NAS_DATABASE_BACKUP_SOURCE_LABELS: Record<NasDatabaseBackupSource, string> = {
  'auto-js': '前台自动备份',
  'manual-export': '手动导出同步',
  'online-update': '更新前备份',
  'native-workmanager': '后台定时备份',
  unknown: 'NAS 备份',
};

const readBackupSource = (value: unknown): NasDatabaseBackupSource => {
  if (
    value === 'auto-js' ||
    value === 'manual-export' ||
    value === 'online-update' ||
    value === 'native-workmanager'
  ) {
    return value;
  }
  return 'unknown';
};

export const getNasDatabaseBackupSourceLabel = (source?: string): string => {
  return (
    NAS_DATABASE_BACKUP_SOURCE_LABELS[readBackupSource(source)] ??
    NAS_DATABASE_BACKUP_SOURCE_LABELS.unknown
  );
};

const joinUrl = (baseUrl: string, path: string): string => {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
};

export const getLastNasDatabaseBackupSuccess =
  async (): Promise<NasDatabaseBackupSuccess | null> => {
    const saved = await AsyncStorage.getItem(NAS_DATABASE_BACKUP_SUCCESS_KEY);
    const parsed = safeJsonParseNullable<NasDatabaseBackupSuccess>(
      saved,
      'nasBackup.lastSuccess'
    );

    if (
      !parsed ||
      typeof parsed.fileName !== 'string' ||
      typeof parsed.remoteUrl !== 'string' ||
      typeof parsed.dateStr !== 'string' ||
      typeof parsed.successAtMs !== 'number'
    ) {
      return null;
    }

    return {
      ...parsed,
      source: readBackupSource((parsed as Partial<NasDatabaseBackupSuccess>).source),
    };
  };

const recordNasDatabaseBackupSuccess = async (
  result: NasDatabaseBackupResult,
  dateStr: string,
  source: NasDatabaseBackupSource
): Promise<void> => {
  const success: NasDatabaseBackupSuccess = {
    ...result,
    dateStr,
    successAtMs: Date.now(),
    source,
  };

  await AsyncStorage.setItem(NAS_DATABASE_BACKUP_SUCCESS_KEY, JSON.stringify(success));
};

const encodePathSegment = (value: string): string => {
  return encodeURIComponent(value).replace(/\+/g, '%20');
};

const getWebDavServer = async (): Promise<WebDavServer> => {
  const rawServerUrl = (await getUpdateServer()) || UPDATE_CONFIG.DEFAULT_SERVER;
  const authInfo = parseAuthFromUrl(rawServerUrl);
  const baseUrl = (authInfo?.baseUrl || rawServerUrl).trim().replace(/\/+$/, '');
  const headers: Record<string, string> = {};

  if (authInfo) {
    headers.Authorization = `Basic ${base64Encode(`${authInfo.username}:${authInfo.password}`)}`;
  }

  return { baseUrl, headers };
};

const getResponseMessage = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  return `${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`;
};

const fetchNas = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NAS_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`NAS 连接超时（${NAS_REQUEST_TIMEOUT_MS / 1000}秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const remoteFileExists = async (
  fileUrl: string,
  headers: Record<string, string>
): Promise<boolean> => {
  const response = await fetchNas(fileUrl, {
    method: 'HEAD',
    headers,
  });

  if (response.ok) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }

  if (response.status === 403 || response.status === 405 || response.status === 501) {
    logger.warn(
      'NAS 不支持通过 HEAD 检查文件，改由带防覆盖条件的 PUT 判断:',
      response.status
    );
    return false;
  }

  throw new Error(`NAS 备份文件检查失败：${await getResponseMessage(response)}`);
};

const uploadToWebDav = async (
  fileUri: string,
  remoteUrl: string,
  headers: Record<string, string>
): Promise<number> => {
  const uploadResult = await FileSystem.uploadAsync(remoteUrl, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'If-None-Match': '*',
    },
  });

  return Number(uploadResult?.status || 0);
};

export const uploadDatabaseBackupToNas = async (
  fileUri: string,
  options: string | { dateStr?: string; source?: NasDatabaseBackupSource } = {}
): Promise<NasDatabaseBackupResult> => {
  const dateStr = typeof options === 'string' ? options : options.dateStr ?? getDatabaseBackupDateString();
  const source = typeof options === 'string' ? 'unknown' : options.source ?? 'unknown';
  const server = await getWebDavServer();
  const backupDirectoryUrl = `${joinUrl(server.baseUrl, 'backup')}/`;

  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const fileName = buildDatabaseBackupFileName(dateStr, sequence);
    const remoteUrl = `${backupDirectoryUrl}${encodePathSegment(fileName)}`;

    if (await remoteFileExists(remoteUrl, server.headers)) {
      continue;
    }

    const status = await uploadToWebDav(fileUri, remoteUrl, server.headers);
    if (status >= 200 && status <= 299) {
      logger.log('NAS 数据库备份上传成功:', remoteUrl);
      const result = { fileName, remoteUrl };
      await recordNasDatabaseBackupSuccess(result, dateStr, source).catch((error) => {
        logger.warn('记录 NAS 数据库备份成功状态失败:', error);
      });
      return result;
    }
    if (status === 412) {
      continue;
    }
    if (status === 409) {
      throw new Error('NAS 备份目录不存在或发生冲突，请检查 backup 目录权限');
    }

    throw new Error(`NAS 数据库备份上传失败：HTTP ${status}`);
  }

  throw new Error(`NAS 当日数据库备份序号已超过 999：${dateStr}`);
};

export const createRealtimeDatabaseBackupFile = async (
  options: { timeoutMs?: number } = {}
): Promise<RealtimeDatabaseBackupFileResult> => {
  await ensureDatabaseConnectionReady('createRealtimeDatabaseBackupFile.beforeFlush');

  const outboundQueueStats = await scanQueue.flushPendingWrites({
    timeoutMs: options.timeoutMs ?? 15000,
    retryFailed: true,
  });

  if (outboundQueueStats.failed > 0) {
    throw new Error(
      `仍有 ${outboundQueueStats.failed} 条出库扫码记录写入失败，请回到扫码出库页确认后再备份`
    );
  }

  await ensureDatabaseConnectionReady('createRealtimeDatabaseBackupFile.beforeExport');

  const result = await exportDatabaseFile();
  if (!result.success || !result.filePath) {
    throw new Error(result.message || '数据库文件导出失败');
  }

  return { localFilePath: result.filePath };
};

export const createRealtimeDatabaseBackupToNas = async (
  options: { timeoutMs?: number; source?: NasDatabaseBackupSource } = {}
): Promise<RealtimeNasDatabaseBackupResult> => {
  const { localFilePath } = await createRealtimeDatabaseBackupFile(options);
  const nasResult = await uploadDatabaseBackupToNas(localFilePath, {
    source: options.source ?? 'auto-js',
  });

  return {
    ...nasResult,
    localFilePath,
  };
};
