const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const { createProxyMiddleware } = require('http-proxy-middleware');
const connect = require('connect');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'wasm'])];

// Windows native bundling uses paths relative to client; keep hoisted dependencies visible.
if (process.env.EXPO_NO_METRO_WORKSPACE_ROOT === '1') {
  config.watchFolders = [...new Set([...config.watchFolders, path.resolve(__dirname, '../node_modules')])];
}

// 安全地获取 Expo 的默认排除列表
const existingBlockList = [].concat(config.resolver.blockList || []);
const managedPreview = Boolean(process.env.CHIPMUNKS_WEB_PREVIEW_SESSION);
// The browser preview does not consume Express or native project sources. Keep
// their dependency trees out of the initial watcher crawl on Windows.
const previewOnlyFolders = managedPreview ? ['server', 'client/android', 'client/ios'] : [];
if (managedPreview) {
  const serverRoot = path.resolve(__dirname, '../server').toLowerCase();
  config.watchFolders = (config.watchFolders || []).filter((folder) => path.resolve(folder).toLowerCase() !== serverRoot);
}
const previewGeneratedFolders = ['output', 'logs', 'dist', 'scripts/.sync-build-temp', 'scripts/dist', ...previewOnlyFolders].map((folder) => {
  const absolute = path.resolve(__dirname, '..', folder);
  const escaped = absolute.split(/[\\/]/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
  return new RegExp(`^${escaped}(?:[\\\\/].*)?$`);
});

config.resolver.blockList = [
  ...existingBlockList,
  ...previewGeneratedFolders,
  /.*\/\.expo\/.*/, // Expo 的缓存和构建产物目录

  // 1. 原生代码 (Java/C++/Objective-C)
  /.*\/react-native\/ReactAndroid\/.*/,
  /.*\/react-native\/ReactCommon\/.*/,

  // 2. 纯开发和调试工具
  // 这些工具只在开发电脑上运行，不会被打包到应用中
  /.*\/@typescript-eslint\/eslint-plugin\/.*/,

  // 3. 构建时数据
  // 这个数据库只在打包过程中使用，应用运行时不需要
  /.*\/caniuse-lite\/data\/.*/,

  // 4. 通用规则
  /.*\/__tests__\/.*/, // 排除所有测试目录
  /.*\.git\/.*/, // 排除 Git 目录

  // 5. pnpm 临时目录（避免 ENOENT 错误）
  /.*node_modules\/\.pnpm\/.*_tmp_\d+.*/,
];

const BACKEND_TARGET = 'http://localhost:9091';
const logMetroProxy = (...args) => {
  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`${args.join(' ')}\n`);
  }
};

const apiProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  logLevel: 'debug',
  proxyTimeout: 86400000,
  onProxyReq: (proxyReq, req) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream')) {
      proxyReq.setHeader('accept-encoding', 'identity');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/event-stream') || contentType.includes('application/stream')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        try { res.flushHeaders(); } catch {}
      }
    }
  },
});

const streamProxy = createProxyMiddleware({
  target: BACKEND_TARGET,
  changeOrigin: true,
  logLevel: 'debug',
  ws: true,
  proxyTimeout: 86400000,
  onProxyReq: (proxyReq, req) => {
    const upgrade = req.headers.upgrade;
    const accept = req.headers.accept || '';
    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      proxyReq.setHeader('Connection', 'upgrade');
      proxyReq.setHeader('Upgrade', req.headers.upgrade);
    } else if (accept.includes('text/event-stream')) {
      proxyReq.setHeader('accept-encoding', 'identity');
      proxyReq.setHeader('Connection', 'keep-alive');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/event-stream') || contentType.includes('application/stream')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        try { res.flushHeaders(); } catch {}
      }
    }
  },
});

const shouldProxyToBackend = (url) => {
  if (!url) return false;
  if (/^\/api\/v\d+\//.test(url)) {
    return true;
  }
  return false;
};

const isWebSocketRequest = (req) =>
  !!(req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket');
const isSSERequest = (req) => {
  const accept = req.headers.accept || '';
  return accept.includes('text/event-stream');
};

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, metroServer) => {
    return connect()
      .use((req, res, next) => {
        const previewSession = process.env.CHIPMUNKS_WEB_PREVIEW_SESSION;
        if (previewSession) res.setHeader('X-Chipmunks-Preview-Session', previewSession);
        if (shouldProxyToBackend(req.url)) {
          logMetroProxy(`[Metro Proxy] Forwarding ${req.method} ${req.url}`);

          if (isWebSocketRequest(req) || isSSERequest(req)) {
            return streamProxy(req, res, next);
          }
          return apiProxy(req, res, next);
        }
        next();
      })
      .use(metroMiddleware);
  },
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
