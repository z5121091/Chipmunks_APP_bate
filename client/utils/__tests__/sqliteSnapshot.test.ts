import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as SQLite from 'expo-sqlite';
import {
  createValidatedDatabaseSnapshot,
  SQLITE_BACKUP_SCHEMA_SQL,
  type SnapshotDatabase,
  type SnapshotFileSystem,
} from '../sqliteSnapshot';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({}));

const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');
type NativeDatabase = InstanceType<typeof DatabaseSync>;
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
type Faults = {
  vacuum?: boolean;
  integrity?: Record<string, unknown>[];
  schema?: 'missing' | 'changed' | 'extra';
  close?: boolean;
  move?: boolean;
  empty?: boolean;
  open?: boolean;
  queryOnly?: boolean;
};
const fixtureDirectories: string[] = [];
const databases: NativeDatabase[] = [];

function fixture(faults: Faults = {}, dirname = 'backups') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-snapshot-test-'));
  fixtureDirectories.push(root);
  const sourcePath = path.join(root, 'source.db');
  const backupDirectory = path.join(root, dirname);
  fs.mkdirSync(backupDirectory);
  const destinationPath = path.join(backupDirectory, '掌上仓库_2026-11-15_01.db');
  const sourceUri = pathToFileURL(sourcePath).href;
  const destinationUri = pathToFileURL(destinationPath).href;
  const source = new DatabaseSync(sourcePath);
  databases.push(source);
  source.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA wal_autocheckpoint=0;
    PRAGMA foreign_keys=ON;
    CREATE TABLE packages(id TEXT PRIMARY KEY, model TEXT, version TEXT, quantity INTEGER,
      note TEXT, raw BLOB, optional TEXT);
    CREATE INDEX packages_model ON packages(model);
    CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, package_id TEXT REFERENCES packages(id), action TEXT);
    CREATE TRIGGER package_inserted AFTER INSERT ON packages BEGIN
      INSERT INTO events(package_id, action) VALUES (NEW.id, 'created');
    END;
    CREATE VIEW package_totals AS SELECT model, SUM(quantity) AS total FROM packages GROUP BY model;
  `);
  const insert = source.prepare('INSERT INTO packages VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('P-1', '长型号;带空格', 'V1', 2500, "quote's note", Buffer.from([0, 255, 1]), null);
  insert.run('P-2', '长型号;带空格', 'V2', 5000, 'second', Buffer.from([2, 3, 128]), '');
  // Keep an AUTOINCREMENT high-water mark that is not merely MAX(id).
  source.exec("UPDATE sqlite_sequence SET seq=500 WHERE name='events'");

  const operations: string[] = [];
  const deleted: string[] = [];
  const opened: NativeDatabase[] = [];
  const safePath = (uri: string) => {
    const resolved = path.resolve(fileURLToPath(uri));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Test I/O escaped its fixture');
    return resolved;
  };
  const fileSystem = {
    getInfoAsync: jest.fn(async (uri: string) => {
      const filename = safePath(uri);
      if (!fs.existsSync(filename)) return { exists: false };
      const stats = fs.statSync(filename);
      return { exists: true, isDirectory: stats.isDirectory(), size: faults.empty && path.basename(filename) === 'snapshot.db' ? 0 : stats.size };
    }),
    makeDirectoryAsync: jest.fn(async (uri: string, options?: { intermediates?: boolean }) => {
      fs.mkdirSync(safePath(uri), { recursive: Boolean(options?.intermediates) });
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      operations.push('move');
      if (faults.move) throw new Error('Simulated publish failure');
      fs.renameSync(safePath(from), safePath(to));
    }),
    deleteAsync: jest.fn(async (uri: string, _options?: { idempotent?: boolean }) => {
      const filename = safePath(uri);
      expect(filename).not.toBe(sourcePath);
      expect(filename).not.toBe(destinationPath);
      expect(filename).not.toBe(root);
      expect(filename).not.toBe(backupDirectory);
      deleted.push(filename);
      fs.rmSync(filename, { force: true, recursive: true });
    }),
  } satisfies SnapshotFileSystem;
  const database: SnapshotDatabase = {
    execAsync: async sql => {
      operations.push(sql);
      if (faults.vacuum && /^VACUUM\s+INTO/i.test(sql)) {
        // Emulate an interrupted engine that created a partial output before failing.
        const destination = /^VACUUM\s+INTO\s+'((?:''|[^'])+)'/i.exec(sql)?.[1]?.replace(/''/g, "'");
        if (destination) fs.writeFileSync(destination, 'partial');
        throw new Error('Simulated snapshot failure');
      }
      source.exec(sql);
    },
    getAllAsync: async <T,>(sql: string) => source.prepare(sql).all() as T[],
  };
  const openSnapshot = jest.fn(async (uri: string) => {
    if (faults.open) throw new Error('Simulated open failure');
    const snapshot = new DatabaseSync(safePath(uri), { readOnly: true });
    opened.push(snapshot);
    databases.push(snapshot);
    operations.push('open');
    return {
      execAsync: async (sql: string) => {
        operations.push(sql);
        if (faults.queryOnly && /query_only/i.test(sql)) throw new Error('Cannot establish query-only validation');
        snapshot.exec(sql);
      },
      getAllAsync: async <T,>(sql: string) => {
        if (/PRAGMA\s+integrity_check/i.test(sql) && faults.integrity) return faults.integrity as T[];
        const rows = snapshot.prepare(sql).all();
        if (sql === SQLITE_BACKUP_SCHEMA_SQL && faults.schema) {
          const schema = rows as SchemaRow[];
          if (faults.schema === 'missing') return schema.filter(row => row.name !== 'package_inserted') as T[];
          if (faults.schema === 'changed') return schema.map(row => row.name === 'packages' ? { ...row, sql: 'CREATE TABLE packages(id TEXT PRIMARY KEY)' } : row) as T[];
          return [...schema, { type: 'view', name: 'unexpected', tbl_name: 'unexpected', sql: 'CREATE VIEW unexpected AS SELECT 1' }] as T[];
        }
        return rows as T[];
      },
      closeAsync: async () => {
        operations.push('close');
        snapshot.close();
        if (faults.close) throw new Error('Simulated validation close failure');
      },
    };
  });
  const run = () => createValidatedDatabaseSnapshot(database, sourceUri, destinationUri, { fileSystem, openSnapshot });
  return { root, source, sourcePath, sourceUri, destinationPath, destinationUri, backupDirectory,
    operations, deleted, opened, database, fileSystem, openSnapshot, run };
}

afterEach(() => {
  jest.mocked(SQLite.openDatabaseAsync).mockReset();
  for (const db of databases.splice(0)) {
    try { db.close(); } catch { /* Each production validation connection is normally closed by the helper. */ }
  }
  for (const directory of fixtureDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('warehouse-snapshot-test-')) {
      throw new Error('Refusing cleanup outside the test fixture');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

it('creates an independent complete SQLite snapshot including committed WAL rows, indexes, triggers, views and sequence state', async () => {
  const f = fixture();
  expect(fs.statSync(f.sourcePath + '-wal').size).toBeGreaterThan(0);
  const originalMain = fs.readFileSync(f.sourcePath);
  const originalWal = fs.readFileSync(f.sourcePath + '-wal');
  const sourceRows = f.source.prepare('SELECT * FROM packages ORDER BY id').all();
  const sourceSchema = f.source.prepare(SQLITE_BACKUP_SCHEMA_SQL).all();
  await f.run();
  expect(fs.readFileSync(f.sourcePath)).toEqual(originalMain);
  expect(fs.readFileSync(f.sourcePath + '-wal')).toEqual(originalWal);
  expect(f.source.prepare('SELECT * FROM packages ORDER BY id').all()).toEqual(sourceRows);
  expect(f.operations).toContain('PRAGMA query_only = ON');
  expect(f.operations.indexOf('close')).toBeLessThan(f.operations.indexOf('move'));
  const restored = new DatabaseSync(f.destinationPath, { readOnly: true }); databases.push(restored);
  expect(restored.prepare('SELECT * FROM packages ORDER BY id').all()).toEqual(sourceRows);
  expect(restored.prepare(SQLITE_BACKUP_SCHEMA_SQL).all()).toEqual(sourceSchema);
  expect(restored.prepare('SELECT * FROM events ORDER BY id').all()).toEqual(f.source.prepare('SELECT * FROM events ORDER BY id').all());
  expect(restored.prepare('SELECT * FROM package_totals').all()).toEqual(f.source.prepare('SELECT * FROM package_totals').all());
  expect(restored.prepare('SELECT * FROM sqlite_sequence').all()).toEqual(f.source.prepare('SELECT * FROM sqlite_sequence').all());
  expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  expect(fs.existsSync(f.destinationPath + '-wal')).toBe(false);
  expect(fs.readdirSync(f.backupDirectory)).toEqual([path.basename(f.destinationPath)]);
});

it('supports encoded hashes, Unicode, spaces and quotes in snapshot paths without changing source data', async () => {
  const f = fixture({}, "备份#标签 空间 O'Brien");
  expect(f.destinationUri).toContain('%23');
  await f.run();
  expect(fs.existsSync(f.destinationPath)).toBe(true);
  const snapshot = new DatabaseSync(f.destinationPath, { readOnly: true }); databases.push(snapshot);
  expect(snapshot.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
});

it('creates a snapshot even if the React Native URL shim rejects file URI construction', async () => {
  const f = fixture();
  const originalURL = globalThis.URL;
  const brokenURL = function (input: string | URL, base?: string | URL) {
    if (/^file:/i.test(String(input))) throw new Error('React Native file URL shim is unavailable');
    return new originalURL(input, base);
  } as unknown as typeof URL;
  try {
    globalThis.URL = brokenURL;
    await f.run();
  } finally {
    globalThis.URL = originalURL;
  }
  const snapshot = new DatabaseSync(f.destinationPath, { readOnly: true }); databases.push(snapshot);
  expect(snapshot.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
});

it.each([
  'https://example.invalid/backup.db',
  'file://remote/private/backup.db',
  'file:///private/backup.db?query=1',
  'file:///private/backup.db#fragment',
  'file:///',
  'file:///C:/',
  'file:///private/%00backup.db',
  'file:////remote/backup.db',
  'file:///private/%5Cbackup.db',
])('rejects unsafe/nonlocal destination %s before any filesystem or database operation', async destination => {
  const exec = jest.fn(async () => undefined);
  const read = jest.fn(async () => []);
  const fileSystem = {
    getInfoAsync: jest.fn(async () => ({ exists: false })),
    makeDirectoryAsync: jest.fn(async () => undefined),
    moveAsync: jest.fn(async () => undefined),
    deleteAsync: jest.fn(async () => undefined),
  };
  await expect(createValidatedDatabaseSnapshot({ execAsync: exec, getAllAsync: read },
    'file:///private/live.db', destination, { fileSystem })).rejects.toThrow();
  expect(exec).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(fileSystem.getInfoAsync).not.toHaveBeenCalled();
  expect(fileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  expect(fileSystem.moveAsync).not.toHaveBeenCalled();
  expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('opens only the new snapshot through the default Expo adapter using a fresh connection and native directory', async () => {
  const f = fixture({}, "原生 备份 O'Brien");
  jest.mocked(SQLite.openDatabaseAsync).mockImplementation(async (name, options, directory) => {
    expect(options).toEqual({ useNewConnection: true });
    expect(directory).toBeTruthy();
    expect(directory).not.toMatch(/^file:/);
    return await f.openSnapshot(pathToFileURL(path.join(directory!, name)).href) as unknown as SQLite.SQLiteDatabase;
  });
  await createValidatedDatabaseSnapshot(f.database, f.sourceUri, f.destinationUri, { fileSystem: f.fileSystem });
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  const [name, , directory] = jest.mocked(SQLite.openDatabaseAsync).mock.calls[0];
  expect(name).toBe('snapshot.db');
  expect(path.dirname(path.resolve(directory!))).toBe(f.backupDirectory);
  expect(path.basename(directory!)).toMatch(/^\.snapshot-/);
  expect(f.operations).toContain('PRAGMA query_only = ON');
  expect(fs.existsSync(f.destinationPath)).toBe(true);
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
});

it('refuses to publish over an existing destination and never removes that earlier backup', async () => {
  const f = fixture();
  const previous = Buffer.from('previous-backup-must-survive');
  fs.writeFileSync(f.destinationPath, previous);
  await expect(f.run()).rejects.toThrow();
  expect(fs.readFileSync(f.destinationPath)).toEqual(previous);
  expect(f.fileSystem.moveAsync).not.toHaveBeenCalled();
  expect(f.deleted).not.toContain(f.destinationPath);
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
});

it('refuses the source as destination before issuing VACUUM or deleting anything', async () => {
  const f = fixture();
  const before = fs.readFileSync(f.sourcePath);
  await expect(createValidatedDatabaseSnapshot(f.database, f.sourceUri, f.sourceUri,
    { fileSystem: f.fileSystem, openSnapshot: f.openSnapshot })).rejects.toThrow();
  expect(f.operations.some(sql => /^VACUUM/i.test(sql))).toBe(false);
  expect(f.deleted).toEqual([]);
  expect(fs.readFileSync(f.sourcePath)).toEqual(before);
});

it('normalizes dot segments before rejecting a destination alias of the live database', async () => {
  const f = fixture();
  const sourceAlias = f.sourceUri.replace(/source\.db$/, 'subdir/../source.db');
  const before = fs.readFileSync(f.sourcePath);
  await expect(createValidatedDatabaseSnapshot(f.database, f.sourceUri, sourceAlias,
    { fileSystem: f.fileSystem, openSnapshot: f.openSnapshot })).rejects.toThrow('原数据库');
  expect(f.fileSystem.getInfoAsync).not.toHaveBeenCalled();
  expect(f.operations).toEqual([]);
  expect(f.deleted).toEqual([]);
  expect(fs.readFileSync(f.sourcePath)).toEqual(before);
});

it.each([
  ['VACUUM failure', { vacuum: true }],
  ['empty snapshot', { empty: true }],
  ['cannot open snapshot', { open: true }],
  ['query-only failure', { queryOnly: true }],
  ['integrity failure', { integrity: [{ integrity_check: 'database disk image is malformed' }] }],
  ['missing integrity result', { integrity: [] }],
  ['multiple integrity rows', { integrity: [{ integrity_check: 'ok' }, { integrity_check: 'inconsistent index' }] }],
  ['missing trigger', { schema: 'missing' }],
  ['changed table definition', { schema: 'changed' }],
  ['unexpected schema object', { schema: 'extra' }],
  ['connection close failure', { close: true }],
  ['publish move failure', { move: true }],
] as [string, Faults][])('fails closed after %s and cleans only its own incomplete snapshot', async (_name, faults) => {
  const f = fixture(faults);
  const originalMain = fs.readFileSync(f.sourcePath);
  const originalWal = fs.readFileSync(f.sourcePath + '-wal');
  await expect(f.run()).rejects.toThrow();
  expect(fs.existsSync(f.destinationPath)).toBe(false);
  expect(fs.readdirSync(f.backupDirectory)).toEqual([]);
  expect(fs.readFileSync(f.sourcePath)).toEqual(originalMain);
  expect(fs.readFileSync(f.sourcePath + '-wal')).toEqual(originalWal);
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
  if (!faults.move) expect(f.fileSystem.moveAsync).not.toHaveBeenCalled();
});

it('rejects a source connection with an uncommitted transaction without rolling back or committing the caller data', async () => {
  const f = fixture();
  f.source.exec('BEGIN IMMEDIATE');
  f.source.prepare('INSERT INTO packages(id,model,quantity) VALUES(?,?,?)').run('P-3', 'pending', 7);
  try {
    await expect(f.run()).rejects.toThrow();
    expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 3 });
    expect(fs.existsSync(f.destinationPath)).toBe(false);
  } finally {
    f.source.exec('ROLLBACK');
  }
  expect(f.source.prepare('SELECT COUNT(*) AS count FROM packages').get()).toEqual({ count: 2 });
});

it('rechecks destination availability before publication if another backup appears during validation', async () => {
  const f = fixture();
  const originalOpen = f.openSnapshot.getMockImplementation()!;
  f.openSnapshot.mockImplementation(async uri => {
    const validation = await originalOpen(uri);
    fs.writeFileSync(f.destinationPath, 'newer-backup');
    return validation;
  });
  await expect(f.run()).rejects.toThrow();
  expect(fs.readFileSync(f.destinationPath, 'utf8')).toBe('newer-backup');
  expect(f.fileSystem.moveAsync).not.toHaveBeenCalled();
});
