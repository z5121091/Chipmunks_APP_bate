import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export const NATIVE_NAS_BACKUP_CONFIG_FILE = 'auto-db-backup/server-config.json';
let pendingWrite: Promise<void> = Promise.resolve();
let synchronizedIdentity: string | undefined;
let temporarySequence = 0;

const validateServer = (serverUrl: string): string => {
  const value = serverUrl.trim();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    return url.toString();
  } catch {
    throw new Error('NAS 服务器地址无效，请检查服务器配置');
  }
};

/** Keep the WorkManager destination identical to the foreground destination, in private app storage. */
export const syncNativeNasBackupConfiguration = (serverUrl: string): Promise<void> => {
  if (Platform.OS !== 'android') return Promise.resolve();
  const task = pendingWrite.catch(() => undefined).then(async () => {
    const normalized = validateServer(serverUrl);
    if (!FileSystem.documentDirectory) throw new Error('无法同步 NAS 后台配置：应用私有目录不可用');
    const directory = `${FileSystem.documentDirectory}auto-db-backup/`;
    const destination = `${FileSystem.documentDirectory}${NATIVE_NAS_BACKUP_CONFIG_FILE}`;
    const identity = `${destination}\n${normalized}`;
    if (synchronizedIdentity === identity) return;

    // Read once after JS startup; do not rewrite credentials on every foreground status refresh.
    try {
      const saved: unknown = JSON.parse(await FileSystem.readAsStringAsync(destination));
      if (saved && typeof saved === 'object' && 'version' in saved && saved.version === 1 &&
          'serverUrl' in saved && saved.serverUrl === normalized) {
        synchronizedIdentity = identity;
        return;
      }
    } catch { /* Missing or interrupted legacy configuration is replaced by the effective JS configuration. */ }

    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const temporary = `${directory}.server-config-${Date.now()}-${++temporarySequence}.tmp`;
    try {
      await FileSystem.writeAsStringAsync(temporary, JSON.stringify({
        version: 1,
        serverUrl: normalized,
        updatedAtMs: Date.now(),
      }));
      // Android legacy moveAsync uses File.renameTo for file:// paths. The same-directory
      // rename replaces a complete file; never remove the previous configuration first.
      await FileSystem.moveAsync({ from: temporary, to: destination });
      synchronizedIdentity = identity;
    } catch {
      // File-system exceptions can include their arguments. Keep credential-bearing URLs out of errors/logs.
      throw new Error('NAS 后台配置同步失败，请重试；本次尚未切换后台备份地址');
    } finally {
      await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
    }
  });
  pendingWrite = task;
  return task;
};
