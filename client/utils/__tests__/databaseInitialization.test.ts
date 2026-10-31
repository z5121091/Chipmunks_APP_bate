import { createRequire } from 'node:module';
import type { SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabase(...args),
}));
jest.mock('../databaseRestoreJournal', () => ({
  recoverInterruptedDatabaseRestore: () => mockRecoverDatabaseRestore(),
}));
jest.mock('../workDraftIsolation', () => ({
  recoverInterruptedWorkDraftIsolation: () => mockRecoverWorkDraftIsolation(),
}));

const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite');
const mockOpenDatabase = jest.fn<Promise<SQLiteDatabase>, unknown[]>();
const mockRecoverDatabaseRestore = jest.fn<Promise<void>, []>();
const mockRecoverWorkDraftIsolation = jest.fn<Promise<void>, []>();
const events: string[] = [];
const fixtures: InstanceType<typeof DatabaseSync>[] = [];
const handles: ReturnType<typeof createHandle>[] = [];
let database: typeof import('../database');

const locked = new Error(
  "Call to function 'NativeStatement.finalizeAsync' has been rejected. Caused by: database is locked"
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function createHandle(options: {
  writeError?: Error;
  schemaError?: Error;
  migrationError?: Error;
  version?: number;
} = {}) {
  const label = `connection-${handles.length + 1}`;
  const fixture = new DatabaseSync(':memory:');
  fixtures.push(fixture);
  fixture.exec(`
    CREATE TABLE [系统配置] (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO [系统配置] VALUES ('install_id', 'initialization-test');
    INSERT INTO [系统配置] VALUES ('db_version', '${options.version ?? 1}');
    PRAGMA user_version = ${options.version ?? 1};
  `);
  const statements: string[] = [];
  const record = (sql: string) => { statements.push(sql); };
  const adapter = {
    closeAsync: jest.fn(async () => { events.push(`close:${label}`); }),
    execAsync: jest.fn(async (sql: string) => {
      record(sql);
      if (options.schemaError && /CREATE TABLE/i.test(sql)) throw options.schemaError;
      fixture.exec(sql);
    }),
    runAsync: jest.fn(async (sql: string, params: SQLInputValue[] = []) => {
      record(sql);
      if (options.writeError) throw options.writeError;
      const result = fixture.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    }),
    getFirstAsync: jest.fn(async (sql: string, params: SQLInputValue[] = []) => {
      record(sql);
      return fixture.prepare(sql).get(...params) ?? null;
    }),
    getAllAsync: jest.fn(async (sql: string, params: SQLInputValue[] = []) => {
      record(sql);
      if (options.migrationError && /SELECT \* FROM \[扫码解析规则\]/i.test(sql)) {
        throw options.migrationError;
      }
      return fixture.prepare(sql).all(...params);
    }),
    withExclusiveTransactionAsync: async (task: (transaction: SQLiteDatabase) => Promise<void>) => {
      fixture.exec('BEGIN IMMEDIATE');
      try {
        await task(adapter as unknown as SQLiteDatabase);
        fixture.exec('COMMIT');
      } catch (error) {
        fixture.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const handle = { adapter, label, statements };
  handles.push(handle);
  events.push(`open:${label}`);
  return handle;
}

beforeEach(() => {
  jest.resetModules();
  events.length = 0;
  handles.length = 0;
  mockOpenDatabase.mockReset();
  mockOpenDatabase.mockImplementation(async () => createHandle().adapter as unknown as SQLiteDatabase);
  mockRecoverDatabaseRestore.mockReset().mockResolvedValue(undefined);
  mockRecoverWorkDraftIsolation.mockReset().mockResolvedValue(undefined);
  // jest-expo may default to web; these cases must exercise native initialization.
  const { Platform } = require('react-native') as typeof import('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  database = require('../database');
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

it('closes a failed finalize/locked connection before opening the successful retry', async () => {
  const closing = deferred();
  const allowClose = deferred();
  mockOpenDatabase.mockImplementationOnce(async () => {
    const handle = createHandle({ writeError: locked });
    handle.adapter.closeAsync.mockImplementation(async () => {
      closing.resolve();
      await allowClose.promise;
      events.push(`close:${handle.label}`);
    });
    return handle.adapter as unknown as SQLiteDatabase;
  });

  const initialization = database.initDatabase();
  const settled = initialization.then(() => undefined, () => undefined);
  try {
    await Promise.race([closing.promise, settled]);
    expect(handles[0].adapter.closeAsync).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabase).toHaveBeenCalledTimes(1);
  } finally {
    allowClose.resolve();
    await settled;
  }

  await expect(initialization).resolves.toBeUndefined();

  expect(mockOpenDatabase).toHaveBeenCalledTimes(2);
  expect(handles[0].adapter.closeAsync).toHaveBeenCalledTimes(1);
  expect(events.indexOf(`close:${handles[0].label}`))
    .toBeLessThan(events.indexOf(`open:${handles[1].label}`));
  expect(handles[1].adapter.closeAsync).not.toHaveBeenCalled();
});

it('lets an initialization transaction failure reach the outer retry without awaiting its own initialization', async () => {
  mockOpenDatabase.mockImplementationOnce(async () =>
    createHandle({ migrationError: locked }).adapter as unknown as SQLiteDatabase);

  await expect(database.initDatabase()).resolves.toBeUndefined();

  expect(mockOpenDatabase).toHaveBeenCalledTimes(2);
  expect(handles[0].adapter.closeAsync).toHaveBeenCalledTimes(1);
  expect(events.indexOf(`close:${handles[0].label}`))
    .toBeLessThan(events.indexOf(`open:${handles[1].label}`));
}, 8000);

it('reports a persistent lock after bounded retries and permits a new manual initialization', async () => {
  mockOpenDatabase.mockImplementation(async () =>
    createHandle({ writeError: locked }).adapter as unknown as SQLiteDatabase);

  await expect(database.initDatabase()).rejects.toThrow(locked.message);
  const failedHandles = [...handles];
  const failedAttempts = mockOpenDatabase.mock.calls.length;
  mockOpenDatabase.mockImplementation(async () => createHandle().adapter as unknown as SQLiteDatabase);

  await expect(database.initDatabase()).resolves.toBeUndefined();

  expect(failedAttempts).toBe(3);
  for (const handle of failedHandles) expect(handle.adapter.closeAsync).toHaveBeenCalledTimes(1);
  expect(mockOpenDatabase).toHaveBeenCalledTimes(failedAttempts + 1);
  expect(handles.at(-1)?.adapter.closeAsync).not.toHaveBeenCalled();
});

it('shares recovery and native initialization across concurrent calls', async () => {
  const recovery = deferred();
  mockRecoverDatabaseRestore.mockImplementation(() => recovery.promise);
  const first = database.initDatabase();
  const second = database.initDatabase();
  const result = Promise.all([first, second]);

  try {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(mockRecoverDatabaseRestore).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabase).not.toHaveBeenCalled();
  } finally {
    recovery.resolve();
    await result;
  }

  expect(mockRecoverWorkDraftIsolation).toHaveBeenCalledTimes(1);
  expect(mockOpenDatabase).toHaveBeenCalledTimes(1);
});

it('sets busy_timeout as the first SQL statement before attempting schema or cleanup writes', async () => {
  await database.initDatabase();

  expect(handles[0].statements[0].trim()).toMatch(/^PRAGMA\s+busy_timeout\s*=\s*5000\s*;?$/i);
  expect(handles[0].statements.some(sql => /DELETE FROM \[系统配置\]/.test(sql))).toBe(true);
});

it('closes and reports a permanent schema error without retrying it', async () => {
  const schemaError = new Error('no such column: unsupported_schema');
  mockOpenDatabase.mockImplementation(async () =>
    createHandle({ schemaError }).adapter as unknown as SQLiteDatabase);

  await expect(database.initDatabase()).rejects.toThrow(schemaError.message);

  expect(mockOpenDatabase).toHaveBeenCalledTimes(1);
  expect(handles[0].adapter.closeAsync).toHaveBeenCalledTimes(1);
});

it('closes and reports an unsupported database version without retrying it', async () => {
  mockOpenDatabase.mockImplementation(async () =>
    createHandle({ version: 2 }).adapter as unknown as SQLiteDatabase);

  await expect(database.initDatabase()).rejects.toThrow('数据库版本高于当前应用');

  expect(mockOpenDatabase).toHaveBeenCalledTimes(1);
  expect(handles[0].adapter.closeAsync).toHaveBeenCalledTimes(1);
});
