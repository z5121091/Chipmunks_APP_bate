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
const databaseFile = declarations.find(node => node.name.getText(parsed) === 'DATABASE_FILE_NAME').initializer.text;
const businessQuery = declarations.find(node => node.name.getText(parsed) === 'hasAnyBusinessData').getText(parsed);
const logicalTables = [...businessQuery.matchAll(/FROM (\w+) LIMIT 1/g)].map(match => match[1]);
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

// Execute the worker's table probes against SQLite; Android scheduling is tested on-device.
function hasNativeBusinessData(db) {
  return nativeTables.some(name => db.prepare(existsQuery).get(name)
    && Boolean(db.prepare(rowQuery.replace('$tableName', name)).get()));
}

function withFixture(run) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of Object.values(tables)) db.exec(`CREATE TABLE [${name}] (id TEXT)`);
    run(db);
  } finally { db.close(); }
}

test('native template and checked-in Android worker have identical behavior', () => {
  const normalized = native.replace(/^package [^\n]+/, 'package __PACKAGE_NAME__');
  assert.ok(normalized === template, 'Regenerate the Android worker from its Expo plugin template');
});

test('all native worker entry points share a guard before snapshot, upload and status writes', () => {
  const work = template.slice(template.indexOf('override suspend fun doWork()'), template.indexOf('private fun hasBusinessData'));
  assert.ok(work.indexOf('backupInProgress.compareAndSet(false, true)') < work.indexOf('AutoDatabaseBackupScheduler.writeStatus'));
  assert.match(work, /if \(!backupInProgress\.compareAndSet\(false, true\)\) \{[\s\S]*?return Result\.retry\(\)/);
  assert.match(work, /finally \{\s*backupInProgress\.set\(false\)\s*\}/);
  assert.match(template.slice(template.indexOf('companion object {', template.indexOf('private fun urlEncode'))), /backupInProgress = AtomicBoolean\(false\)/);
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

for (const logical of ['orders', 'materials', 'inbound_records', 'inventory_check_records', 'unpack_records', 'sales_return_records']) {
  test(`native backup detects a database containing only ${logical}`, () => withFixture(db => {
    db.prepare(`INSERT INTO [${tables[logical]}] (id) VALUES (?)`).run('backup-regression-test');
    assert.equal(hasNativeBusinessData(db), true);
  }));
}

test('empty business tables and configuration-only databases remain skipped', () => withFixture(db => {
  assert.equal(hasNativeBusinessData(db), false);
  for (const logical of ['system_config', 'inventory_bindings', 'warehouses', 'qr_code_rules']) {
    db.prepare(`INSERT INTO [${tables[logical]}] (id) VALUES (?)`).run('configuration-only');
  }
  assert.equal(hasNativeBusinessData(db), false);
}));

test('a database whose tables have not been created is safely skipped', () => {
  const db = new DatabaseSync(':memory:');
  try { assert.equal(hasNativeBusinessData(db), false); } finally { db.close(); }
});

test('JavaScript business-data SQL runs on SQLite with the physical table mapping', () => withFixture(db => {
  const query = businessQuery.match(/`([^`]+)`/)?.[1];
  assert.ok(query);
  const physicalQuery = query.replace(/FROM (\w+) LIMIT 1/g, (_, logical) => `FROM [${tables[logical]}] LIMIT 1`);
  assert.equal(db.prepare(physicalQuery).get().exists, 0);
  db.prepare(`INSERT INTO [${tables.inbound_records}] (id) VALUES (?)`).run('persisted-inbound');
  assert.equal(db.prepare(physicalQuery).get().exists, 1);
}));
