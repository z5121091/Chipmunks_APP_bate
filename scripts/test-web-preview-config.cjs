// Test managed-preview boundaries without starting Expo or importing private config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = path.resolve(__dirname, '../client');
const root = path.dirname(client);
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };

function config(session) {
  const connect = () => ({ middleware: [], use(fn) { this.middleware.push(fn); return this; } });
  const context = {
    __dirname: client, module: { exports: {} }, process: { env: session ? { CHIPMUNKS_WEB_PREVIEW_SESSION: session } : {}, stdout: { write() {} } },
    require(name) {
      if (name === 'expo/metro-config') return { getDefaultConfig: () => ({
        resolver: { assetExts: ['png', 'wasm'], blockList: [] },
        watchFolders: [path.join(root, 'node_modules'), client, path.join(root, 'server')], server: {},
      }) };
      if (name === 'uniwind/metro') return { withUniwindConfig: (value) => value };
      if (name === 'connect') return connect;
      if (name === 'http-proxy-middleware') return { createProxyMiddleware: () => (req, res, next) => next() };
      if (name === 'node:path') return path;
      throw new Error(`Unexpected config dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(client, 'metro.config.js'), 'utf8'), context);
  return context.module.exports;
}
const ordinary = config();
const managed = config('fixture-session');
const blocked = (value, file) => value.resolver.blockList.some((rule) => rule.test(file));

test('ordinary builds retain server workspace and native source visibility', () => {
  assert(ordinary.watchFolders.includes(path.join(root, 'server')));
  assert(!blocked(ordinary, path.join(client, 'android/app/src/main/Main.kt')));
});
test('managed preview excludes unused server and native project crawl', () => {
  assert(!managed.watchFolders.includes(path.join(root, 'server')));
  assert(blocked(managed, path.join(root, 'server/src/index.ts')));
  assert(blocked(managed, path.join(client, 'android/app/src/main/Main.kt')));
  assert(blocked(managed, path.join(client, 'ios/project.pbxproj')));
});
test('managed preview keeps app source and hoisted JavaScript dependencies', () => {
  assert(!blocked(managed, path.join(client, 'screens/home/index.tsx')));
  assert(!blocked(managed, path.join(root, 'node_modules/react/index.js')));
  assert(managed.watchFolders.includes(path.join(root, 'node_modules')));
});
test('generated directories are excluded for both path separator styles', () => {
  for (const value of [ordinary, managed]) {
    for (const folder of ['output', 'logs', 'dist', 'scripts/.sync-build-temp', 'scripts/dist']) {
      const file = path.join(root, folder, 'generated-file');
      assert(blocked(value, file));
      assert(blocked(value, file.replace(/\\/g, '/')));
      assert(blocked(value, file.replace(/\//g, '\\')));
    }
  }
});
test('preview session header is scoped to managed development middleware', () => {
  for (const [value, expected] of [[ordinary, undefined], [managed, 'fixture-session']]) {
    const middleware = value.server.enhanceMiddleware(() => {}, {});
    const headers = {}; let continued = false;
    middleware.middleware[0]({ url: '/_chipmunks/preview', headers: {} }, { setHeader: (key, text) => { headers[key] = text; } }, () => { continued = true; });
    assert.equal(headers['X-Chipmunks-Preview-Session'], expected);
    assert(continued);
  }
});
test('existing wasm support is retained without duplicate entries', () => {
  assert.equal(managed.resolver.assetExts.filter((value) => value === 'wasm').length, 1);
});
console.log(`Web preview config tests: ${passed} passed.`);
