/* global require, __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('expo/config');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const version = JSON.parse(read('version.json'));
const { exp } = getConfig(root);
assert.equal(exp.android.package, 'com.chipmunks.traceability');
assert.equal(exp.android.allowBackup, false);
assert.equal(exp.name, '掌上仓库');
assert.equal(exp.scheme, 'chipmunkswarehouse');
assert.equal(version.selfUpdateEnabled, true);
assert.equal(exp.extra.selfUpdateEnabled, true);
assert.ok(exp.android.permissions.includes('android.permission.REQUEST_INSTALL_PACKAGES'));
assert.ok(!exp.android.blockedPermissions.includes('android.permission.REQUEST_INSTALL_PACKAGES'));
const build = read('android/app/build.gradle');
assert.match(build, /buildConfigField "String", "UPDATE_SERVER_URL"/);
assert.match(read('android/gradle.properties'), /^edgeToEdgeEnabled=true\r?$/m);
assert.match(read('android/app/src/main/res/values/styles.xml'), /name="android:statusBarColor">@android:color\/transparent</);
assert.match(build, /applicationId ['"]com\.chipmunks\.traceability['"]/);
assert.match(build, /namespace ['"]com\.chipmunks\.traceability['"]/);
assert.match(build, /signingConfig signingConfigs\.release/);
assert.doesNotMatch(build.slice(build.indexOf('buildTypes {')).split('release {')[1], /signingConfig signingConfigs\.debug/);
const manifest = read('android/app/src/main/AndroidManifest.xml');
assert.match(manifest, /android:scheme="chipmunkswarehouse"/);
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:usesCleartextTraffic="true"/);
assert.match(manifest, /<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"\s*\/>/);
assert.doesNotMatch(read('update-server.json'), /https?:\/\/[^\s/]+:[^\s/@]+@/);
assert.match(read('android/app/src/main/java/com/chipmunks/traceability/AutoDatabaseBackupWorker.kt'), /BuildConfig\.UPDATE_SERVER_URL/);
assert.match(read('android/app/src/main/java/com/chipmunks/traceability/MainApplication.kt'), /AutoDatabaseBackupScheduler\.schedule\(this\)/);
assert.match(read('plugins/AutoDatabaseBackupWorker.kt'), /BuildConfig\.APPLICATION_ID/);
if (fs.existsSync(path.join(root, '../android-build.local'))) {
  assert.match(read('../android-build.local'), /cw-expo57-dat-build/);
  assert.doesNotMatch(read('../android-build.local'), /cw-build-20260913/);
} else {
  assert.equal(path.basename(path.dirname(root)), 'cw-expo57-dat-build');
}
console.log('PASS: release identity, deep link, native backup, signing and build-cache isolation');
