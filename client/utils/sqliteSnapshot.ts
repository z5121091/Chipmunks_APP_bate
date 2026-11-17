import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

export const SQLITE_BACKUP_SCHEMA_SQL = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name, tbl_name";

export interface SnapshotDatabase {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string): Promise<T[]>;
}
export interface SnapshotFileSystem {
  getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number }>;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}
type SnapshotConnection = SnapshotDatabase & { closeAsync(): Promise<void> };
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
let snapshotSequence = 0;

/** SQLite takes a native path here, not a file URI; decode exactly once and escape SQL separately. */
function nativeFilePath(uri: string): string {
  // React Native's URL shim handles HTTP pathname only. Do not use URL for file://.
  if (!/^file:\/\/\//i.test(uri) || /[?#]/.test(uri)) {
    throw new Error('数据库备份必须使用本机文件路径');
  }
  const path = decodeURIComponent(uri.slice('file://'.length));
  if (!path || path.startsWith('//') || path.endsWith('/') || path.includes('\0') || path.includes('\\')) throw new Error('数据库备份文件路径无效');
  // Android/iOS use absolute POSIX paths; Windows paths support isolated desktop fixtures.
  const windows = /^\/[a-z]:\//i.test(path);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length <= (windows ? 1 : 0)) throw new Error('数据库备份文件路径无效');
      parts.pop();
    } else parts.push(part);
  }
  if (parts.length <= (windows ? 1 : 0)) throw new Error('数据库备份文件路径无效');
  return `${windows ? '' : '/'}${parts.join('/')}`;
}
const pathIdentity = (path: string) => /^[a-z]:\//i.test(path) ? path.toLowerCase() : path;
const schemaIdentity = (rows: SchemaRow[]) => JSON.stringify(rows.map(row => [row.type, row.name, row.tbl_name, row.sql]));

async function openSnapshotConnection(uri: string): Promise<SnapshotConnection> {
  const path = nativeFilePath(uri);
  const split = path.lastIndexOf('/');
  return SQLite.openDatabaseAsync(path.slice(split + 1), { useNewConnection: true }, path.slice(0, split));
}

/**
 * Called inside the existing serialized backup gate, outside any SQL transaction.
 * The source is never compacted/replaced. Only a validated, closed snapshot is published.
 */
export async function createValidatedDatabaseSnapshot(
  database: SnapshotDatabase,
  sourceUri: string,
  destinationUri: string,
  options: { fileSystem?: SnapshotFileSystem; openSnapshot?: (uri: string) => Promise<SnapshotConnection> } = {},
): Promise<void> {
  const fs = options.fileSystem ?? FileSystem;
  const openSnapshot = options.openSnapshot ?? openSnapshotConnection;
  const sourcePath = nativeFilePath(sourceUri);
  const destinationPath = nativeFilePath(destinationUri);
  if (pathIdentity(sourcePath) === pathIdentity(destinationPath)) throw new Error('备份目标不能是正在使用的原数据库');
  const sourceInfo = await fs.getInfoAsync(sourceUri);
  if (!sourceInfo.exists || sourceInfo.isDirectory || !sourceInfo.size) throw new Error('原数据库文件不存在或为空，已停止备份');
  if ((await fs.getInfoAsync(destinationUri)).exists) throw new Error('备份目标已存在，已停止以保护已有备份');

  const expectedSchema = await database.getAllAsync<SchemaRow>(SQLITE_BACKUP_SCHEMA_SQL);
  if (expectedSchema.length === 0) throw new Error('原数据库没有有效表结构，已停止备份');
  const parentUri = destinationUri.slice(0, destinationUri.lastIndexOf('/') + 1);
  const temporaryDirectory = `${parentUri}.snapshot-${Date.now()}-${++snapshotSequence}-${Math.random().toString(36).slice(2, 10)}/`;
  const temporaryUri = `${temporaryDirectory}snapshot.db`;
  let ownsDirectory = false;
  let snapshot: SnapshotConnection | undefined;
  try {
    // intermediates:false fails if this randomly named directory already exists.
    // Cleanup is permitted only after this call establishes ownership.
    await fs.makeDirectoryAsync(temporaryDirectory, { intermediates: false });
    ownsDirectory = true;
    const escapedPath = nativeFilePath(temporaryUri).replace(/'/g, "''");
    await database.execAsync(`VACUUM INTO '${escapedPath}'`);
    const snapshotInfo = await fs.getInfoAsync(temporaryUri);
    if (!snapshotInfo.exists || snapshotInfo.isDirectory || !snapshotInfo.size) throw new Error('数据库快照未完整生成，已停止备份');

    snapshot = await openSnapshot(temporaryUri);
    // Expo has no readOnly open option. This separate connection executes only reads.
    await snapshot.execAsync('PRAGMA query_only = ON');
    const integrity = await snapshot.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check?.trim().toLowerCase() !== 'ok') {
      throw new Error('数据库快照完整性检查失败，已停止备份');
    }
    const actualSchema = await snapshot.getAllAsync<SchemaRow>(SQLITE_BACKUP_SCHEMA_SQL);
    if (schemaIdentity(actualSchema) !== schemaIdentity(expectedSchema)) throw new Error('数据库快照结构不完整，已停止备份');
    await snapshot.closeAsync();
    snapshot = undefined;

    // Recheck before publishing. No existing backup is ever deleted or intentionally overwritten.
    if ((await fs.getInfoAsync(destinationUri)).exists) throw new Error('备份目标已存在，已停止以保护已有备份');
    await fs.moveAsync({ from: temporaryUri, to: destinationUri });
  } finally {
    if (snapshot) await snapshot.closeAsync().catch(() => undefined);
    if (ownsDirectory) await fs.deleteAsync(temporaryDirectory, { idempotent: true }).catch(() => undefined);
  }
}
