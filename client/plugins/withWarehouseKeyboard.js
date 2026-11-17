const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require('expo/config-plugins');

const ACTIVITY_CALL = 'WarehouseKeyboardPolicy.applyTo(window)';
const APPLICATION_CALL = 'WarehouseKeyboardPolicy.install(reactHost)';

function ensureCall(source, anchor, call) {
  if (source.includes(call)) return source;
  if (!source.includes(anchor)) {
    throw new Error(`Android keyboard policy: missing Kotlin lifecycle anchor ${anchor}`);
  }
  return source.replace(anchor, `${anchor}\n    ${call}`);
}

function configureManifest(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const mode = activity.$['android:windowSoftInputMode'] || '';
  // Keep stateHidden/stateAlwaysHidden/etc.; only retire resize/pan/default adjustment.
  const stateFlags = mode.split('|').map(flag => flag.trim())
    .filter(flag => flag && !flag.startsWith('adjust'));
  activity.$['android:windowSoftInputMode'] = [...stateFlags, 'adjustNothing'].join('|');
  return manifest;
}

function configureActivity(source) {
  return ensureCall(source, 'super.onCreate(null)', ACTIVITY_CALL);
}

function configureApplication(source) {
  return ensureCall(source, 'loadReactNative(this)', APPLICATION_CALL);
}

function writeKeyboardPolicy(androidRoot, packageName) {
  if (!packageName) throw new Error('android.package is required for the Android keyboard policy');
  const target = path.join(androidRoot, 'app/src/main/java', ...packageName.split('.'),
    'WarehouseKeyboardPolicy.kt');
  const template = fs.readFileSync(path.join(__dirname, 'WarehouseKeyboardPolicy.kt'), 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, template.replace('__PACKAGE_NAME__', packageName));
}

module.exports = function withWarehouseKeyboard(config) {
  config = withAndroidManifest(config, config => {
    config.modResults = configureManifest(config.modResults);
    return config;
  });
  config = withMainActivity(config, config => {
    if (config.modResults.language !== 'kt') {
      throw new Error('The Android keyboard policy requires a Kotlin MainActivity');
    }
    config.modResults.contents = configureActivity(config.modResults.contents);
    return config;
  });
  config = withMainApplication(config, config => {
    if (config.modResults.language !== 'kt') {
      throw new Error('The Android keyboard policy requires a Kotlin MainApplication');
    }
    config.modResults.contents = configureApplication(config.modResults.contents);
    return config;
  });
  return withDangerousMod(config, ['android', config => {
    writeKeyboardPolicy(config.modRequest.platformProjectRoot, config.android?.package);
    return config;
  }]);
};

module.exports.configureManifest = configureManifest;
module.exports.configureActivity = configureActivity;
module.exports.configureApplication = configureApplication;
module.exports.writeKeyboardPolicy = writeKeyboardPolicy;
