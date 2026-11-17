/* global require, __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { XML } = require('expo/config-plugins');
const withWarehouseAndroid = require('../plugins/withWarehouseAndroid');
const withWarehouseKeyboard = require('../plugins/withWarehouseKeyboard');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const javaPath = 'android/app/src/main/java/com/chipmunks/traceability/';
const activitySource = read(`${javaPath}MainActivity.kt`);
const applicationSource = read(`${javaPath}MainApplication.kt`);
const template = read('plugins/WarehouseKeyboardPolicy.kt');
const activityCall = 'WarehouseKeyboardPolicy.applyTo(window)';
const applicationCall = 'WarehouseKeyboardPolicy.install(reactHost)';

async function runMod(config, mod, results, androidRoot) {
  const result = await config.mods.android[mod]({
    ...config,
    modRequest: { projectRoot: root, platformProjectRoot: androidRoot, platform: 'android', modName: mod },
    modResults: results,
  });
  return result.modResults;
}

test('manifest policy replaces only adjustment flags and remains idempotent', () => {
  const fixture = { manifest: { application: [{ activity: [{
    $: { 'android:name': '.MainActivity', 'android:windowSoftInputMode': 'stateAlwaysHidden|adjustResize' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }] }],
  }] }] } };
  withWarehouseKeyboard.configureManifest(fixture);
  assert.equal(fixture.manifest.application[0].activity[0].$['android:windowSoftInputMode'],
    'stateAlwaysHidden|adjustNothing');
  withWarehouseKeyboard.configureManifest(fixture);
  assert.equal(fixture.manifest.application[0].activity[0].$['android:windowSoftInputMode'],
    'stateAlwaysHidden|adjustNothing');
});

test('actual Expo mods reproduce checked-in Kotlin/manifest and do not duplicate lifecycle calls', async () => {
  // Invoke the registered mods from the real parent plugin, not a mocked generator.
  const config = withWarehouseAndroid({ name: 'keyboard-fixture', android: { package: 'com.chipmunks.traceability' } });
  for (const [mod, checkedIn, call] of [
    ['mainActivity', activitySource, activityCall],
    ['mainApplication', applicationSource, applicationCall],
  ]) {
    const original = checkedIn.replace(`    ${call}\n`, '');
    const first = await runMod(config, mod, { language: 'kt', contents: original });
    const second = await runMod(config, mod, first);
    assert.equal(first.contents, checkedIn);
    assert.equal(second.contents, checkedIn);
    assert.equal(checkedIn.split(call).length - 1, 1);
  }
  assert.ok(activitySource.indexOf(activityCall) > activitySource.indexOf('super.onCreate(null)'));
  assert.ok(applicationSource.indexOf(applicationCall) > applicationSource.indexOf('loadReactNative(this)'));
  assert.match(applicationSource, /AutoDatabaseBackupScheduler\.schedule\(this\)/,
    'Keyboard policy must leave the independent backup scheduler intact');
  const manifest = await XML.parseXMLAsync(read('android/app/src/main/AndroidManifest.xml'));
  const generated = await runMod(config, 'manifest', structuredClone(manifest));
  assert.deepEqual(generated, manifest);
  const activity = generated.manifest.application[0].activity.find(value => value.$['android:name'] === '.MainActivity');
  assert.equal(activity.$['android:windowSoftInputMode'], 'adjustNothing');
});

test('actual Expo dangerous mod generates the identical native policy twice without an APK build', async () => {
  const prefix = path.join(os.tmpdir(), 'chipmunks-keyboard-');
  const fixtureRoot = fs.mkdtempSync(prefix);
  try {
    const config = withWarehouseAndroid({ name: 'keyboard-fixture', android: { package: 'com.chipmunks.traceability' } });
    for (let pass = 0; pass < 2; pass++) {
      await runMod(config, 'dangerous', {}, fixtureRoot);
      const generated = fs.readFileSync(path.join(fixtureRoot, 'app/src/main/java/com/chipmunks/traceability/WarehouseKeyboardPolicy.kt'), 'utf8');
      assert.equal(generated.replace(/\r\n/g, '\n'), read(`${javaPath}WarehouseKeyboardPolicy.kt`));
      assert.equal(generated.replace(/^package [^\r\n]+/, 'package __PACKAGE_NAME__').replace(/\r\n/g, '\n'), template);
    }
  } finally {
    assert.ok(path.resolve(fixtureRoot).startsWith(path.resolve(prefix)), 'Cleanup must stay in this test fixture');
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('plugin fails explicitly if a future template no longer has the required Kotlin lifecycle', async () => {
  assert.throws(() => withWarehouseKeyboard.configureActivity('class OtherActivity'), /missing Kotlin lifecycle anchor/);
  assert.throws(() => withWarehouseKeyboard.configureApplication('class OtherApplication'), /missing Kotlin lifecycle anchor/);
  const config = withWarehouseKeyboard({ android: { package: 'com.chipmunks.traceability' } });
  await assert.rejects(runMod(config, 'mainActivity', { language: 'java', contents: '' }), /Kotlin MainActivity/);
  await assert.rejects(runMod(config, 'mainApplication', { language: 'java', contents: '' }), /Kotlin MainApplication/);
});

test('native policy preserves IME state bits and covers existing as well as recreated React contexts', () => {
  assert.match(template, /previousMode and WindowManager\.LayoutParams\.SOFT_INPUT_MASK_ADJUST\.inv\(\)/);
  assert.match(template, /or\s*WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_NOTHING/);
  assert.match(template, /if \(previousMode != nextMode\) \{\s*window\.setSoftInputMode\(nextMode\)/);
  assert.match(template, /Collections\.newSetFromMap\(WeakHashMap<ReactHost, Boolean>\(\)\)/);
  assert.match(template, /if \(installedHosts\.add\(host\)\) \{\s*host\.addReactInstanceEventListener\(this\)/);
  assert.match(template, /host\.currentReactContext\?\.let\(::onReactContextInitialized\)/);
  assert.match(template, /override fun onReactContextInitialized\(context: ReactContext\) \{[\s\S]*?context\.addExtraWindowEventListener\(this\)/);
  assert.match(template, /override fun onExtraWindowCreate\(window: Window\) \{[\s\S]*?applyTo\(window\)/);
  assert.doesNotMatch(template, /(?:val|var)\s+\w+\s*:\s*(?:Window|ReactContext|Activity)\b/,
    'The singleton must not retain old UI windows, activities or React contexts');
});

test('installed React Native exposes the public Modal window hook after its resize override', () => {
  const base = 'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/';
  const modal = read(`${base}views/modal/ReactModalHostView.kt`);
  const resize = modal.indexOf('window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)');
  const hook = modal.indexOf('.onExtraWindowCreate(window)', resize);
  assert.ok(resize >= 0 && hook > resize, 'Recheck the native integration when React Native changes Modal creation');
  const context = read(`${base}bridge/ReactContext.java`);
  assert.match(context, /CopyOnWriteArraySet<ExtraWindowEventListener>/);
  assert.match(context, /public void addExtraWindowEventListener\(ExtraWindowEventListener listener\)/);
  assert.match(read(`${base}uimanager/ThemedReactContext.kt`), /reactApplicationContext\.onExtraWindowCreate\(window\)/);
  assert.match(read(`${base}ReactHost.kt`), /fun addReactInstanceEventListener\(listener: ReactInstanceEventListener\)/);
});
