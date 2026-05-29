import { APP_NAME } from '@/constants/version';

export const sanitizeBackupFileName = (value: string): string => {
  const sanitized = value.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').trim();
  return sanitized.replace(/^_+|_+$/g, '') || 'warehouse';
};

export const getDatabaseBackupDateString = (date = new Date()): string => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const buildDatabaseBackupFileName = (
  dateStr: string,
  sequence: number,
  appName = APP_NAME
): string => {
  return `${sanitizeBackupFileName(appName)}_${dateStr}_${String(sequence).padStart(2, '0')}.db`;
};
