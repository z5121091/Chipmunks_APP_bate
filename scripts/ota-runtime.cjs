// Conservative native compatibility boundary. Extra rebuilds are preferable to
// publishing JavaScript against a different native runtime.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
function fingerprint() {
  const files = [];
  function walk(relative) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (['build', '.gradle', '.cxx', 'node_modules'].includes(name)) continue;
        walk(relative + '/' + name);
      }
    } else if (!/local.properties$|warehouse_ota.xml$/.test(relative)) files.push(relative);
  }
  for (const input of ['client/android', 'client/plugins', 'patches', 'client/package.json', 'client/app.config.ts', 'client/constants/motionTiming.json', 'pnpm-lock.yaml']) walk(input);
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file)));
  return 'android-' + hash.digest('hex').slice(0, 32);
}
if (require.main === module) {
  const runtimeVersion = fingerprint();
  const target = path.join(root, 'client/ota-runtime.json');
  if (process.argv.includes('--prepare')) {
    fs.writeFileSync(target, JSON.stringify({ runtimeVersion }) + '\n');
    fs.writeFileSync(path.join(root, 'client/android/app/src/main/res/values/warehouse_ota.xml'), `<resources><string name="warehouse_ota_runtime">${runtimeVersion}</string></resources>\n`);
  }
  console.log(runtimeVersion);
}
module.exports = { fingerprint };
