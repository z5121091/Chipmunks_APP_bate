import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

const root = path.resolve(__dirname, '..');
const databaseSource = fs.readFileSync(path.join(root, 'database.ts'), 'utf8');
const backupSource = fs.readFileSync(path.join(root, 'nasBackup.ts'), 'utf8');

type ExportResult = { success: boolean; message: string; filePath?: string };
type ExportFunction = () => Promise<ExportResult>;

/** Execute the checked-in entry point with isolated dependencies, not a copied implementation. */
function productionFunction<T>(source: string, name: string, dependencies: Record<string, unknown>, prelude = ''): T {
  const parsed = ts.createSourceFile('entry.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(node => node.name.getText(parsed) === name);
  if (!declaration?.initializer) throw new Error(`Production declaration missing: ${name}`);
  const code = ts.transpileModule(`return (() => { ${prelude}\nreturn ${declaration.initializer.getText(parsed)}; })();`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as T;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function waitForSnapshot(started: () => boolean) {
  for (let i = 0; i < 50 && !started(); i++) await Promise.resolve();
  expect(started()).toBe(true);
}

function exporter() {
  const events: string[] = [];
  const source = {};
  let insideGate = false;
  const checkpoint = jest.fn(async (db: unknown) => { expect(db).toBe(source); expect(insideGate).toBe(true); events.push('checkpoint'); });
  const snapshot = jest.fn(async (db: unknown, sourceUri: string, destinationUri: string) => {
    expect(db).toBe(source); expect(insideGate).toBe(true);
    expect(sourceUri).toBe('file:///private/SQLite/live.db');
    expect(destinationUri).toContain('file:///private/backups/掌上仓库_2026-11-15_');
    events.push('snapshot');
  });
  const finishOta = jest.fn();
  const gate = productionFunction<(label: string, task: () => Promise<unknown>) => Promise<unknown>>(
    databaseSource, 'runSerializedDatabaseOperation', { beginOtaSensitiveOperation: () => finishOta },
    'let serializedDatabaseOperationQueue = Promise.resolve();');
  const fsAdapter = {
    documentDirectory: 'file:///private/',
    getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 4096 })),
    makeDirectoryAsync: jest.fn(async () => undefined),
    copyAsync: jest.fn(), deleteAsync: jest.fn(),
  };
  const naming = jest.fn(async () => '掌上仓库_2026-11-15_01.db');
  const exportFile = productionFunction<ExportFunction>(databaseSource, 'exportDatabaseFile', {
    isWebPlatform: false,
    runWithTransientDatabaseRetry: async (_label: string, task: () => Promise<unknown>) => task(),
    runSerializedDatabaseOperation: (label: string, task: () => Promise<unknown>) => gate(label, async () => {
      insideGate = true;
      try { return await task(); } finally { insideGate = false; }
    }),
    getDb: () => source,
    checkpointDatabaseForFileBackup: checkpoint,
    getDatabaseFilePath: () => 'file:///private/SQLite/live.db',
    FS: fsAdapter,
    getDatabaseBackupDateString: () => '2026-11-15',
    getNextDatedBackupFileName: naming,
    sanitizeBackupFileName: (value: string) => value,
    APP_NAME: '掌上仓库',
    createValidatedDatabaseSnapshot: snapshot,
    refreshDatabaseConnectionAfterTransientError: jest.fn(),
    logger: { error: jest.fn(), warn: jest.fn() },
  });
  return { exportFile, checkpoint, snapshot, events, fsAdapter, naming, finishOta };
}

it('waits for the validated compact snapshot inside the existing checkpoint/serialized gate before reporting success', async () => {
  const f = exporter(); const pending = deferred();
  f.snapshot.mockImplementationOnce(async () => { f.events.push('snapshot'); await pending.promise; });
  let complete = false;
  const result = f.exportFile().then(value => { complete = true; return value; });
  await waitForSnapshot(() => f.snapshot.mock.calls.length === 1);
  expect(f.events).toEqual(['checkpoint', 'snapshot']);
  expect(complete).toBe(false);
  expect(f.fsAdapter.copyAsync).not.toHaveBeenCalled();
  pending.resolve();
  await expect(result).resolves.toEqual({ success: true, message: '数据库文件导出成功', filePath: 'file:///private/backups/掌上仓库_2026-11-15_01.db' });
  expect(f.finishOta).toHaveBeenCalledTimes(1);
});

it('keeps checkpoint failure fail-closed without creating, copying or deleting a snapshot', async () => {
  const f = exporter(); f.checkpoint.mockRejectedValueOnce(new Error('WAL still busy'));
  await expect(f.exportFile()).resolves.toEqual({ success: false, message: 'WAL still busy' });
  expect(f.snapshot).not.toHaveBeenCalled();
  expect(f.fsAdapter.copyAsync).not.toHaveBeenCalled();
  expect(f.fsAdapter.deleteAsync).not.toHaveBeenCalled();
  expect(f.finishOta).toHaveBeenCalledTimes(1);
});

it('does not report a path or fall back to an unchecked copy when snapshot validation fails', async () => {
  const f = exporter(); f.snapshot.mockRejectedValueOnce(new Error('Snapshot integrity failed'));
  await expect(f.exportFile()).resolves.toEqual({ success: false, message: 'Snapshot integrity failed' });
  expect(f.fsAdapter.copyAsync).not.toHaveBeenCalled();
  expect(f.fsAdapter.deleteAsync).not.toHaveBeenCalled();
});

it('serializes simultaneous foreground exports through the real production gate and retains separate daily sequence names', async () => {
  const f = exporter(); const firstSnapshot = deferred();
  f.naming.mockResolvedValueOnce('掌上仓库_2026-11-15_01.db').mockResolvedValueOnce('掌上仓库_2026-11-15_02.db');
  f.snapshot.mockImplementationOnce(async () => { f.events.push('snapshot'); await firstSnapshot.promise; });
  const first = f.exportFile(); const second = f.exportFile();
  await waitForSnapshot(() => f.snapshot.mock.calls.length === 1);
  expect(f.checkpoint).toHaveBeenCalledTimes(1);
  expect(f.snapshot).toHaveBeenCalledTimes(1);
  firstSnapshot.resolve();
  const results = await Promise.all([first, second]);
  expect(results.every(result => result.success)).toBe(true);
  expect(results.map(result => result.filePath)).toEqual([
    'file:///private/backups/掌上仓库_2026-11-15_01.db',
    'file:///private/backups/掌上仓库_2026-11-15_02.db',
  ]);
  expect(f.events).toEqual(['checkpoint', 'snapshot', 'checkpoint', 'snapshot']);
  expect(f.finishOta).toHaveBeenCalledTimes(2);
});

function realtimeBackup(stats: { failed: number } = { failed: 0 }) {
  const ensure = jest.fn(async () => undefined);
  const flush = jest.fn(async () => stats);
  const exportFile = jest.fn(async (): Promise<ExportResult> => ({ success: true, message: 'ok', filePath: 'snapshot.db' }));
  const run = productionFunction<(options?: { timeoutMs?: number }) => Promise<{ localFilePath: string }>>(
    backupSource, 'createRealtimeDatabaseBackupFile', {
      ensureDatabaseConnectionReady: ensure,
      scanQueue: { flushPendingWrites: flush },
      exportDatabaseFile: exportFile,
    });
  return { run, ensure, flush, exportFile };
}

it('keeps queue flushing and connection readiness ahead of foreground snapshot creation', async () => {
  const f = realtimeBackup();
  await expect(f.run({ timeoutMs: 7000 })).resolves.toEqual({ localFilePath: 'snapshot.db' });
  expect(f.flush).toHaveBeenCalledWith({ timeoutMs: 7000, retryFailed: true });
  expect(f.ensure).toHaveBeenCalledTimes(2);
  expect(f.ensure.mock.invocationCallOrder[0]).toBeLessThan(f.flush.mock.invocationCallOrder[0]);
  expect(f.flush.mock.invocationCallOrder[0]).toBeLessThan(f.ensure.mock.invocationCallOrder[1]);
  expect(f.ensure.mock.invocationCallOrder[1]).toBeLessThan(f.exportFile.mock.invocationCallOrder[0]);
});

it('refuses a realtime/upgrade backup while unresolved scan writes remain', async () => {
  const f = realtimeBackup({ failed: 2 });
  await expect(f.run()).rejects.toThrow('2 条出库扫码记录写入失败');
  expect(f.exportFile).not.toHaveBeenCalled();
});

it('propagates queue failures or failed snapshot export instead of declaring the backup ready', async () => {
  const queueFailure = realtimeBackup(); queueFailure.flush.mockRejectedValueOnce(new Error('flush unavailable'));
  await expect(queueFailure.run()).rejects.toThrow('flush unavailable');
  expect(queueFailure.exportFile).not.toHaveBeenCalled();
  const exportFailure = realtimeBackup(); exportFailure.exportFile.mockResolvedValueOnce({ success: false, message: 'integrity failed' });
  await expect(exportFailure.run()).rejects.toThrow('integrity failed');
});
