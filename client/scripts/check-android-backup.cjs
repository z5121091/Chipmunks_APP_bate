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
  const normalized = native.replace(/^package [^\n]+/, 'package __PACKAGE_NAME__')
    .replace(/private const val DEFAULT_UPDATE_SERVER = [^\n]+/, 'private const val DEFAULT_UPDATE_SERVER = __DEFAULT_UPDATE_SERVER__');
  assert.ok(normalized === template, 'Regenerate the Android worker from its Expo plugin template');
});

test('native backup uses the current database filename and physical business table names', () => {
  assert.ok(template.includes(`"SQLite/${databaseFile}"`));
  assert.ok(logicalTables.length >= 5);
  assert.deepEqual(nativeTables, logicalTables.map(name => tables[name]));
});

for (const logical of ['orders', 'materials', 'inbound_records', 'inventory_check_records', 'unpack_records']) {
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
