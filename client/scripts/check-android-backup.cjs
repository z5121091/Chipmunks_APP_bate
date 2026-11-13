/* global require, __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const databaseSource = read('utils/database.ts');
const parsed = ts.createSourceFile('database.ts', databaseSource, ts.ScriptTarget.Latest, true);
const declarations = parsed.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations]);
const schema = declarations.find(node => node.name.getText(parsed) === 'DATABASE_TABLE_NAMES').initializer.expression;
const tables = Object.fromEntries(schema.properties.map(property => [property.name.getText(parsed), property.initializer.text]));
const createdSchemaTables = new Set();
function collectCreatedSchemaTables(node) {
  // Read SQL literals rather than comments or the Web adapter's regex parser.
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
    const sql = ts.isTemplateExpression(node) ? node.getText(parsed) : node.text;
    const createTable = /\bCREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\[([^\]]+)\]|"([^"]+)"|`([^`]+)`|([\p{L}_][\p{L}\p{N}_]*))/giu;
    for (const match of sql.matchAll(createTable)) {
      createdSchemaTables.add(match[1] || match[2] || match[3] || match[4]);
    }
  }
  ts.forEachChild(node, collectCreatedSchemaTables);
}
collectCreatedSchemaTables(parsed);
const databaseFile = declarations.find(node => node.name.getText(parsed) === 'DATABASE_FILE_NAME').initializer.text;
const declarationSource = name => {
  const declaration = declarations.find(node => node.name.getText(parsed) === name);
  assert.ok(declaration, `${name} declaration is missing`);
  return `const ${declaration.getText(parsed)};`;
};
const backupPolicySource = ['DATABASE_BACKUP_TABLE_CLASSIFICATION', 'DATABASE_BACKUP_BUSINESS_TABLES']
  .map(declarationSource).join('\n');
const { classification, logicalTables } = new Function(ts.transpile(`${backupPolicySource}
  return { classification: DATABASE_BACKUP_TABLE_CLASSIFICATION, logicalTables: DATABASE_BACKUP_BUSINESS_TABLES };`))();
// Execute the real JS/Web guard without loading the full Expo database module.
const createJsBusinessProbe = new Function('isWebPlatform', 'mockTables', 'getDb', 'runDatabaseReadWithRetry', 'logger',
  ts.transpile(`${backupPolicySource}\n${declarationSource('hasAnyBusinessData')}\nreturn hasAnyBusinessData;`));
const template = read('plugins/AutoDatabaseBackupWorker.kt');
const native = read('android/app/src/main/java/com/chipmunks/traceability/AutoDatabaseBackupWorker.kt');
const list = template.match(/val businessTables = listOf\(([^)]+)\)/)?.[1];
assert.ok(list, 'Native backup business table list is missing');
const nativeTables = [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const existsQuery = template.slice(template.indexOf('private fun tableExists'))
  .match(/"(SELECT [^"\n]+)"/)?.[1];
const rowQuery = template.slice(template.indexOf('private fun tableHasRows'))
  .match(/"(SELECT [^"\n]+)"/)?.[1];
assert.ok(existsQuery && rowQuery, 'Native backup SQL could not be read');

// Execute the worker's table probes against SQLite. Scheduling assertions below
// protect configuration; WorkManager timing and device lifecycle still need a PDA.
function hasNativeBusinessData(db) {
  return nativeTables.some(name => db.prepare(existsQuery).get(name)
    && Boolean(db.prepare(rowQuery.replace('$tableName', name)).get()));
}

function jsProbe(db, mockTables) {
  return createJsBusinessProbe(Boolean(mockTables), mockTables || {}, () => ({
    getFirstAsync: async sql => db.prepare(sql.replace(/FROM (\w+) LIMIT 1/g,
      (_, logical) => `FROM [${tables[logical]}] LIMIT 1`)).get(),
  }), (_label, operation) => operation(), { error: () => { /* Probe results are checked by assertions below. */ } });
}

async function withFixture(run) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of Object.values(tables)) db.exec(`CREATE TABLE [${name}] (id TEXT)`);
    await run(db);
  } finally { db.close(); }
}

test('native template and checked-in Android worker have identical behavior', () => {
  const normalized = native.replace(/^package [^\n]+/, 'package __PACKAGE_NAME__');
  assert.ok(normalized === template, 'Regenerate the Android worker from its Expo plugin template');
});

test('all native worker entry points share a guard before snapshot, upload and status writes', () => {
  const work = template.slice(template.indexOf('override suspend fun doWork()'), template.indexOf('private fun hasBusinessData'));
  assert.ok(work.indexOf('backupInProgress.compareAndSet(false, true)') < work.indexOf('AutoDatabaseBackupScheduler.writeStatus'));
  assert.match(work, /if \(!backupInProgress\.compareAndSet\(false, true\)\) \{[\s\S]*?return retryWithinLimit\(\)/);
  assert.match(work, /finally \{\s*backupInProgress\.set\(false\)\s*\}/);
  assert.match(template.slice(template.indexOf('companion object {', template.indexOf('private fun urlEncode'))), /backupInProgress = AtomicBoolean\(false\)/);
});

test('native retries are bounded per execution without disabling periodic, daily or startup recovery', () => {
  const retry = template.slice(template.indexOf('private fun retryWithinLimit'), template.indexOf('private fun hasBusinessData'));
  assert.match(template, /private const val MAX_RETRY_COUNT = 3/);
  assert.match(retry, /if \(runAttemptCount < MAX_RETRY_COUNT\) \{\s*return Result\.retry\(\)/);
  assert.match(retry, /return Result\.failure\(\)/);
  assert.equal((template.match(/Result\.retry\(\)/g) || []).length, 1, 'All retries must use the bounded helper');
  assert.match(template, /catch \(error: Exception\) \{[\s\S]*?writeStatus\([\s\S]*?"failed"[\s\S]*?retryWithinLimit\(\)/);
  assert.doesNotMatch(retry, /cancel|markSuccess|markNoData|SharedPreferences|remove/);
  const scheduler = template.slice(0, template.indexOf('class AutoDatabaseBackupWorker('));
  assert.match(scheduler, /fun schedule\(context: Context\) \{\s*scheduleDailyAlarm\(context\)\s*enqueuePeriodicBackup\(context\)/);
  assert.match(scheduler, /PERIODIC_BACKUP_INTERVAL_MINUTES = 6L \* 60L/);
  assert.match(scheduler, /ExistingPeriodicWorkPolicy\.UPDATE/);
  assert.match(scheduler, /setRequiredNetworkType\(NetworkType\.CONNECTED\)/);
  assert.match(scheduler, /setBackoffCriteria\(BackoffPolicy\.EXPONENTIAL, 30, TimeUnit\.MINUTES\)/);
});

test('native backup keeps remote sequence names separate from per-execution snapshot ownership and cleanup', () => {
  const snapshot = template.slice(template.indexOf('private fun createDatabaseSnapshot'), template.indexOf('private fun remoteFileExists'));
  assert.match(snapshot, /File\(backupDir, "snapshot-\$\{UUID\.randomUUID\(\)\}\.db"\)/);
  assert.doesNotMatch(snapshot, /File\(backupDir, backupFileName\)/);
  assert.match(snapshot, /remoteFileName = backupFileName/);
  assert.match(template, /fileName = backupSnapshot\.remoteFileName/);
  assert.match(snapshot, /catch \(error: Exception\) \{\s*backupFile\.delete\(\)\s*throw error/);
  assert.match(snapshot, /finally \{[\s\S]*?backupFile\.exists\(\) && !backupFile\.delete\(\)/);
  assert.match(template, /\$\{appName\}_\$\{date\}_\$\{sequence\.toString\(\)\.padStart\(2, '0'\)\}\.db/);
});

test('native backup reads the foreground app-private NAS configuration and falls back only before migration', () => {
  const mirror = read('utils/nativeNasBackupConfig.ts');
  const location = mirror.match(/NATIVE_NAS_BACKUP_CONFIG_FILE = '([^']+)'/)?.[1];
  assert.equal(location, 'auto-db-backup/server-config.json');
  assert.ok(template.includes(`File(applicationContext.filesDir, "${location}")`));
  assert.match(template, /WebDavServer\.from\(readEffectiveUpdateServer\(\)\)/);
  const reader = template.slice(template.indexOf('private fun readEffectiveUpdateServer'), template.indexOf('private fun remoteFileExists'));
  assert.match(reader, /if \(!configFile\.exists\(\)\) return DEFAULT_UPDATE_SERVER/);
  assert.match(reader, /config\.optInt\("version"\) != 1/);
  assert.match(reader, /uri\.scheme\?\.lowercase\(Locale.US\) !in listOf\("http", "https"\)/);
  assert.match(reader, /catch \(_: Exception\) \{[\s\S]*throw IllegalStateException\("NAS 后台配置无法读取/);
  assert.equal((reader.match(/return DEFAULT_UPDATE_SERVER/g) || []).length, 1);
  assert.match(mirror, /await FileSystem\.writeAsStringAsync\(temporary/);
  assert.match(mirror, /await FileSystem\.moveAsync\(\{ from: temporary, to: destination \}\)/);
  assert.doesNotMatch(mirror, /deleteAsync\(destination/);
});

test('native credential decoding preserves literal plus and does not log the destination URL', () => {
  assert.match(template, /URLDecoder\.decode\(it\.replace\("\+", "%2B"\)/);
  assert.doesNotMatch(template, /Log\.[a-z]+\([^\n]*\$(?:backupFileUrl|serverUrl|rawUrl)/);
});

test('native backup uses the current database filename and physical business table names', () => {
  assert.ok(template.includes(`"SQLite/${databaseFile}"`));
  assert.ok(logicalTables.length >= 5);
  assert.deepEqual(nativeTables, logicalTables.map(name => tables[name]));
});

test('every database table has an explicit backup classification, including both binding tables', () => {
  assert.ok(createdSchemaTables.size > 0, 'No CREATE TABLE statements were discovered');
  assert.deepEqual([...createdSchemaTables].sort(), Object.keys(tables).sort(),
    'Every CREATE TABLE must have a physical-name mapping and explicit backup classification');
  assert.deepEqual(Object.keys(classification).sort(), Object.keys(tables).sort());
  for (const kind of Object.values(classification)) assert.ok(['business', 'configuration', 'supporting'].includes(kind));
  assert.equal(classification.inventory_bindings, 'business');
  assert.equal(classification.inventory_binding_versions, 'business');
  assert.equal(classification.system_config, 'configuration');
});

test('retired placeholder definitions are optional and do not affect business-data backup detection', () => withFixture(async db => {
  assert.equal(tables.custom_fields, undefined, 'Retired definitions must not remain in the active schema');
  assert.equal(classification.custom_fields, undefined);
  assert.equal(createdSchemaTables.has('custom_fields'), false);
  // Old databases can reach the native worker before the JS migration runs.
  // Neither spelling of the obsolete definitions may trigger or block backup.
  for (const name of ['custom_fields', '规则占位字段']) {
    db.exec(`CREATE TABLE [${name}] (id TEXT)`);
    db.prepare(`INSERT INTO [${name}] (id) VALUES (?)`).run('legacy-placeholder-definition');
  }
  assert.equal(hasNativeBusinessData(db), false);
  assert.equal(await jsProbe(db)(), false);
  assert.equal(await jsProbe(db, { custom_fields: [{ id: 'legacy-web-definition' }] })(), false);
  db.prepare(`INSERT INTO [${tables.inventory_bindings}] (id) VALUES (?)`).run('real-material-binding');
  assert.equal(hasNativeBusinessData(db), true);
  assert.equal(await jsProbe(db)(), true);
}));

for (const logical of logicalTables) {
  test(`native, JS and Web backup guards detect a database containing only ${logical}`, () => withFixture(async db => {
    db.prepare(`INSERT INTO [${tables[logical]}] (id) VALUES (?)`).run('backup-regression-test');
    assert.equal(hasNativeBusinessData(db), true);
    assert.equal(await jsProbe(db)(), true);
    assert.equal(await jsProbe(db, { [logical]: [{ id: 'web-backup-test' }] })(), true);
  }));
}

test('empty databases and configuration/supporting-only databases remain skipped', () => withFixture(async db => {
  assert.equal(hasNativeBusinessData(db), false);
  assert.equal(await jsProbe(db)(), false);
  assert.equal(await jsProbe(db, {})(), false);
  const mockTables = {};
  for (const [logical, kind] of Object.entries(classification)) {
    if (kind === 'business') continue;
    db.prepare(`INSERT INTO [${tables[logical]}] (id) VALUES (?)`).run(`${kind}-only`);
    mockTables[logical] = [{ id: `${kind}-only` }];
  }
  assert.equal(hasNativeBusinessData(db), false);
  assert.equal(await jsProbe(db)(), false);
  assert.equal(await jsProbe(db, mockTables)(), false);
}));

test('a database whose tables have not been created is safely skipped', () => {
  const db = new DatabaseSync(':memory:');
  try { assert.equal(hasNativeBusinessData(db), false); } finally { db.close(); }
});

test('JavaScript business-data SQL responds to new rows without a cached empty result', () => withFixture(async db => {
  const probe = jsProbe(db);
  assert.equal(await probe(), false);
  db.prepare(`INSERT INTO [${tables.inbound_records}] (id) VALUES (?)`).run('persisted-inbound');
  assert.equal(await probe(), true);
}));

test('JavaScript probe failures propagate instead of falsely treating valuable data as absent', async () => {
  const expected = new Error('database is locked');
  const probe = createJsBusinessProbe(false, {}, () => ({ getFirstAsync: async () => { throw expected; } }),
    (_label, operation) => operation(), { error: () => { /* This test asserts the expected rejection directly. */ } });
  await assert.rejects(probe, error => error === expected);
});
