import * as FileSystemLegacy from 'expo-file-system/legacy';
import { UPDATE_CONFIG } from '@/constants/config';
import { buildDatabaseBackupFileName, getDatabaseBackupDateString } from './backupNaming';
import { base64Encode, getUpdateServer, parseAuthFromUrl } from './update';
import { logger } from './logger';

const FileSystem = FileSystemLegacy as any;

type WebDavServer = {
  baseUrl: string;
  headers: Record<string, string>;
};

export type NasDatabaseBackupResult = {
  fileName: string;
  remoteUrl: string;
};

const joinUrl = (baseUrl: string, path: string): string => {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
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

const ensureRemoteBackupDirectory = async (
  directoryUrl: string,
  headers: Record<string, string>
): Promise<void> => {
  const response = await fetch(directoryUrl, {
    method: 'MKCOL',
    headers,
  });

  if (response.ok || response.status === 405 || response.status === 409) {
    return;
  }

  throw new Error(`NAS 备份目录创建失败：${await getResponseMessage(response)}`);
};

const remoteFileExists = async (
  fileUrl: string,
  headers: Record<string, string>
): Promise<boolean> => {
  const response = await fetch(fileUrl, {
    method: 'HEAD',
    headers,
  });

  if (response.ok) {
    return true;
  }
  if (response.status === 404) {
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
  dateStr = getDatabaseBackupDateString()
): Promise<NasDatabaseBackupResult> => {
  const server = await getWebDavServer();
  const backupDirectoryUrl = `${joinUrl(server.baseUrl, 'backup')}/`;

  await ensureRemoteBackupDirectory(backupDirectoryUrl, server.headers);

  for (let sequence = 1; sequence <= 999; sequence += 1) {
    const fileName = buildDatabaseBackupFileName(dateStr, sequence);
    const remoteUrl = `${backupDirectoryUrl}${encodePathSegment(fileName)}`;

    if (await remoteFileExists(remoteUrl, server.headers)) {
      continue;
    }

    const status = await uploadToWebDav(fileUri, remoteUrl, server.headers);
    if (status >= 200 && status <= 299) {
      logger.log('NAS 数据库备份上传成功:', remoteUrl);
      return { fileName, remoteUrl };
    }
    if (status === 409 || status === 412) {
      continue;
    }

    throw new Error(`NAS 数据库备份上传失败：HTTP ${status}`);
  }

  throw new Error(`NAS 当日数据库备份序号已超过 999：${dateStr}`);
};
