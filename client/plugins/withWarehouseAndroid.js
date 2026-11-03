const fs = require('node:fs');
const path = require('node:path');
const motionTiming = require('../constants/motionTiming.json');
const {
  withAppBuildGradle,
  withDangerousMod,
  withFinalizedMod,
  XML,
} = require('expo/config-plugins');

function replaceRequired(source, from, to) {
  if (!source.includes(from)) throw new Error(`Android template changed: missing ${from}`);
  return source.replace(from, to);
}

function writeMotionResources(androidRoot) {
  const resourceRoot = path.join(androidRoot, 'app/src/main/res');
  const animationRoot = path.join(resourceRoot, 'anim');
  const valuesRoot = path.join(resourceRoot, 'values');
  fs.mkdirSync(animationRoot, { recursive: true });
  fs.mkdirSync(valuesRoot, { recursive: true });
  fs.writeFileSync(path.join(valuesRoot, 'warehouse_motion.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <integer name="warehouse_page_transition_ms">${motionTiming.page}</integer>\n</resources>\n`);
  // Android native-stack ignores animationDuration. Override only the four
  // resources used by slide_from_right/left, keeping their original geometry.
  for (const [name, from, to] of [
    ['rns_slide_in_from_right', '100%', '0%'],
    ['rns_slide_in_from_left', '-100%', '0%'],
    ['rns_slide_out_to_left', '0%', '-100%'],
    ['rns_slide_out_to_right', '0%', '100%'],
  ]) {
    fs.writeFileSync(path.join(animationRoot, `${name}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>\n<translate xmlns:android="http://schemas.android.com/apk/res/android"\n    android:duration="@integer/warehouse_page_transition_ms"\n    android:fromXDelta="${from}"\n    android:toXDelta="${to}" />\n`);
  }
}

module.exports = function withWarehouseAndroid(config) {
  config = withAppBuildGradle(config, (config) => {
    let source = config.modResults.contents;
    if (source.includes('// warehouse-release-signing')) return config;
    source = replaceRequired(source, 'android {', `// warehouse-release-signing
def warehouseVersionFile = new File(projectRoot, "version.json")
def warehouseVersion = new groovy.json.JsonSlurper().parse(warehouseVersionFile)
def warehouseSigning = ["STORE_FILE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"].collectEntries {
    [(it): System.getenv("CHIPMUNKS_RELEASE_" + it)]
}
def hasWarehouseSigning = warehouseSigning.values().every { it != null && !it.trim().isEmpty() }
def warehouseUpdateServerFingerprint = java.security.MessageDigest.getInstance("SHA-256")
    .digest((System.getenv("UPDATE_SERVER_URL") ?: "").getBytes("UTF-8")).encodeHex().toString()
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.file(warehouseVersionFile)
    inputs.property("warehouseUpdateServerFingerprint", warehouseUpdateServerFingerprint)
}
android {`);
    source = source.replace(/versionCode \d+/, 'versionCode (warehouseVersion.versionCode as Integer)')
      .replace(/versionName "[^"]*"/, 'versionName warehouseVersion.version.toString()');
    source = replaceRequired(source, 'signingConfigs {', `signingConfigs {
        release {
            if (hasWarehouseSigning) {
                storeFile file(warehouseSigning.STORE_FILE)
                storePassword warehouseSigning.STORE_PASSWORD
                keyAlias warehouseSigning.KEY_ALIAS
                keyPassword warehouseSigning.KEY_PASSWORD
            }
        }`);
    const releaseStart = source.indexOf('release {', source.indexOf('buildTypes {'));
    if (releaseStart < 0) throw new Error('Android release build type is missing');
    source = source.slice(0, releaseStart) + replaceRequired(source.slice(releaseStart),
      'signingConfig signingConfigs.debug',
      'if (hasWarehouseSigning) { signingConfig signingConfigs.release }');
    source = replaceRequired(source, 'jniLibs {', `jniLibs {
            excludes += ['**/x86/**', '**/x86_64/**', '**/armeabi-v7a/**']`);
    config.modResults.contents = source;
    return config;
  });

  // Splash's default mods rebuild this style; apply overrides after all mods finish.
  config = withFinalizedMod(config, ['android', async (config) => {
    const stylesPath = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/values/styles.xml');
    const xml = await XML.readXMLAsync({ path: stylesPath });
    const styles = xml.resources.style || [];
    for (const [styleName, additions] of [
      ['AppTheme', { 'android:windowBackground': '@color/splashscreen_background' }],
      ['Theme.App.SplashScreen', {
        'android:statusBarColor': '@color/splashscreen_background',
        'android:navigationBarColor': '@color/splashscreen_background',
        'android:windowLightStatusBar': '@bool/splashscreen_light_bars',
        'android:windowLightNavigationBar': '@bool/splashscreen_light_bars',
        'android:forceDarkAllowed': 'false',
      }],
    ]) {
      const style = styles.find(item => item.$.name === styleName);
      if (!style) throw new Error(`Missing Android style: ${styleName}`);
      style.item ||= [];
      for (const [name, value] of Object.entries(additions)) {
        const item = style.item.find(item => item.$.name === name);
        if (item) item._ = value;
        else style.item.push({ $: { name }, _: value });
      }
    }
    await XML.writeXMLAsync({ path: stylesPath, xml });
    return config;
  }]);

  return withDangerousMod(config, ['android', (config) => {
    writeMotionResources(config.modRequest.platformProjectRoot);
    for (const [qualifier, light] of [['values', 'true'], ['values-night', 'false']]) {
      const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res', qualifier);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'bools.xml'),
        `<resources><bool name="splashscreen_light_bars">${light}</bool></resources>\n`);
    }
    return config;
  }]);
};

module.exports.writeMotionResources = writeMotionResources;
