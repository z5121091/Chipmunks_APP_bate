/* global require, __dirname, process */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getConfig } = require('expo/config');
const prebuild = require.resolve('@expo/prebuild-config/package.json', {
  paths: [require.resolve('expo-splash-screen/package.json')],
});
const imageUtils = require.resolve('@expo/image-utils', { paths: [prebuild] });
const Jimp = require(require.resolve('jimp-compact', { paths: [imageUtils] }));
const { setSplashImageDrawablesAsync } = require(require.resolve(
  '@expo/prebuild-config/build/plugins/unversioned/expo-splash-screen/withAndroidSplashImages',
  { paths: [prebuild] }
));

async function main() {
  const root = path.resolve(__dirname, '..');
  process.chdir(root);
  const { exp } = getConfig(root);
  const splash = exp.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1];
  const native = path.join(root, 'android/app/src/main/res');
  assert.equal(exp.userInterfaceStyle, 'automatic');
  assert.equal(splash.imageWidth, 176);
  for (const config of [exp.splash, exp.android.splash, exp.ios.splash, splash]) {
    assert.equal(config.image, './assets/images/splash-logo.png');
    assert.equal(config.resizeMode, 'contain');
    assert.equal(config.backgroundColor, '#FFFFFF');
  }
  for (const config of [exp.android.splash, exp.ios.splash, splash]) {
    assert.equal(config.dark.image, './assets/images/splash-logo-dark.png');
    assert.equal(config.dark.backgroundColor, '#121212');
  }
  assert.equal(exp.android.package, 'com.chipmunks.traceability');
  assert.equal(exp.name, '掌上仓库');
  const build = exp.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')[1];
  assert.deepEqual(build.android.buildArchs, ['arm64-v8a']);
  const gradle = fs.readFileSync(path.join(root, 'android/gradle.properties'), 'utf8');
  assert.match(gradle, /^reactNativeArchitectures=arm64-v8a\r?$/m);
  if (process.env.EXPO_NO_METRO_WORKSPACE_ROOT === '1') {
    const metro = require('../metro.config');
    assert.equal(metro.server.unstable_serverRoot, root);
    assert.ok(metro.watchFolders.includes(path.resolve(root, '../node_modules')));
  }

  if (process.argv.includes('--generate')) {
    const logo = await Jimp.read(path.join(root, 'assets/images/splash-universal.png'));
    const pixels = logo.bitmap.data;
    // Remove the white matte and unblend antialiased edges; never alter the original logo.
    for (let i = 0; i < pixels.length; i += 4) {
      const white = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      const alpha = 255 - white;
      for (let c = 0; c < 3; c++) pixels[i + c] = alpha ? Math.round((pixels[i + c] - white) * 255 / alpha) : 0;
      pixels[i + 3] = alpha;
    }
    await logo.writeAsync(path.join(root, splash.image));
    const darkLogo = logo.clone();
    const darkPixels = darkLogo.bitmap.data;
    for (let i = 0; i < darkPixels.length; i += 4) {
      for (let c = 0; c < 3; c++) darkPixels[i + c] = Math.round(darkPixels[i + c] * 0.72 + 255 * 0.28);
    }
    await darkLogo.writeAsync(path.join(root, splash.dark.image));
    await setSplashImageDrawablesAsync(exp, splash, root, splash.imageWidth);
  }
  assert.notDeepEqual(fs.readFileSync(path.join(root, splash.image)), fs.readFileSync(path.join(root, splash.dark.image)), 'Dark logo must be brighter, not an identical copy');

  for (const [mode, config, background] of [
    ['light', splash, 0xffffffff], ['dark', splash.dark, 0x121212ff],
  ]) {
    const logo = await Jimp.read(path.join(root, config.image));
    assert.equal(logo.bitmap.width, logo.bitmap.height);
    let visible = 0;
    for (let y = 0; y < logo.bitmap.height; y++) {
      for (let x = 0; x < logo.bitmap.width; x++) {
        const alpha = logo.bitmap.data[(y * logo.bitmap.width + x) * 4 + 3];
        if (alpha) visible++;
        if (x === 0 || y === 0 || x === logo.bitmap.width - 1 || y === logo.bitmap.height - 1) assert.equal(alpha, 0);
      }
    }
    assert.ok(visible > logo.bitmap.width ** 2 * 0.1 && visible < logo.bitmap.width ** 2 * 0.6, `${mode}: real transparent logo required`);
    const qualifier = mode === 'dark' ? '-night' : '';
    const colors = fs.readFileSync(path.join(native, `values${qualifier}/colors.xml`), 'utf8');
    assert.ok(colors.toLowerCase().includes(config.backgroundColor.toLowerCase()));
    const bars = fs.readFileSync(path.join(native, `values${qualifier}/bools.xml`), 'utf8');
    assert.ok(bars.includes(`>${mode === 'light'}</bool>`));
    assert.equal(fs.existsSync(path.join(native, `drawable${qualifier}/splashscreen_logo.xml`)), false);
    for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
      const bitmap = await Jimp.read(path.join(native, `drawable${qualifier}-${density}/splashscreen_logo.png`));
      const size = 288 * scale;
      assert.equal(bitmap.bitmap.width, size);
      assert.equal(bitmap.bitmap.height, size);
      let colored = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pixel = bitmap.getPixelColor(x, y);
          assert.ok((pixel & 255) >= 254);
          // Jimp's composition may round a background channel by one level.
          const difference = Math.max(...[24, 16, 8].map(shift => Math.abs(((pixel >>> shift) & 255) - ((background >>> shift) & 255))));
          if (difference > 2) {
            colored++;
            // Android 12 can mask the icon to a 192dp circle inside its 288dp canvas.
            assert.ok(Math.hypot(x - size / 2, y - size / 2) < 96 * scale, `${mode}/${density}: logo would be clipped`);
          }
        }
      }
      assert.ok(colored > size * size * 0.02, `${mode}/${density}: blank launch image`);
    }
  }
  const styles = fs.readFileSync(path.join(native, 'values/styles.xml'), 'utf8');
  assert.match(styles, /name="android:windowLightStatusBar">@bool\/splashscreen_light_bars/);
  assert.match(styles, /name="android:windowLightNavigationBar">@bool\/splashscreen_light_bars/);
  assert.match(styles, /name="windowSplashScreenAnimatedIcon">@drawable\/splashscreen_logo/);
  const launchTheme = styles.slice(styles.indexOf('<style name="Theme.App.SplashScreen"'));
  assert.doesNotMatch(launchTheme, /name="android:windowBackground"/, 'Preserve Android 11 inherited logo layer, not a plain color');

  // Verify Expo prebuild generates the same density/theme images as the checked-in native project.
  const prefix = path.join(os.tmpdir(), 'chipmunks-launch-');
  const temporary = fs.mkdtempSync(prefix);
  try {
    for (const config of [splash, splash.dark]) {
      const destination = path.join(temporary, config.image);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, config.image), destination);
    }
    process.chdir(temporary);
    await setSplashImageDrawablesAsync(exp, splash, temporary, splash.imageWidth);
    for (const mode of ['', '-night']) {
      for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
        const relative = `drawable${mode}-${density}/splashscreen_logo.png`;
        assert.deepEqual(fs.readFileSync(path.join(temporary, 'android/app/src/main/res', relative)), fs.readFileSync(path.join(native, relative)));
      }
    }
  } finally {
    process.chdir(root);
    assert.ok(path.resolve(temporary).startsWith(prefix));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('PASS: real transparent logos; 10 light/dark density resources; Android 12 safe area; Expo/native parity; ARM64 only');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
