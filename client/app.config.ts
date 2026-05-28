import { ExpoConfig, ConfigContext } from 'expo/config';
import versionConfig from './version.json';

const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const slugAppName = projectId ? `app${projectId}` : 'myapp';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    "name": versionConfig.appName,
    "slug": slugAppName,
    "version": versionConfig.version,
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "light",
    "newArchEnabled": true,
    // 启动画面：背景由系统铺满，Logo 使用方形安全区资源，适配不同屏幕比例。
    "splash": {
      "image": "./assets/images/splash-universal.png",
      "backgroundColor": "#FFFFFF",
      "resizeMode": "contain"
    },
    "ios": {
      "supportsTablet": true,
      "splash": {
        "image": "./assets/images/splash-universal.png",
        "backgroundColor": "#FFFFFF",
        "resizeMode": "contain"
      }
    },
    "android": {
      "package": "com.chipmunks.traceability",
      "versionCode": versionConfig.versionCode,
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.ACCESS_WIFI_STATE",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_EXTERNAL_STORAGE"
      ],
      "splash": {
        "image": "./assets/images/splash-universal.png",
        "backgroundColor": "#FFFFFF",
        "resizeMode": "contain"
      }
    },
    "web": {
      "bundler": "metro",
      "output": "single"
    },
    "plugins": [
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-build-properties",
        {
          "android": {
            // 最低 Android 版本
            "minSdkVersion": 30, // Android 11
            // 允许 HTTP 明文流量（电脑同步和 NAS 更新源需要）
            "usesCleartextTraffic": true
          }
        }
      ],
      [
        "expo-media-library",
        {
          "photosPermission": "允许元器件溯源扫码App保存APK到下载文件夹以便安装更新",
          "savePhotosPermission": "允许元器件溯源扫码App保存文件到您的设备",
          "isAccessMediaLocationGranted": true
        }
      ],
      [
        "expo-document-picker",
        {
          "iCloudContainerEnvironment": "Production"
        }
      ],
      [
        "expo-sqlite",
        {
          enableExperimental: false,
          // WebAssembly 模式配置（虚拟机/Web 平台使用）
          // 使用官方 CDN 的 libSQL WASM 文件
          libSQLUrl: "https://unpkg.com/@libsql/sqlite-wasm@latest/dist/sqlite3.wasm",
          useSQLCipher: false
        }
      ],
      "./plugins/withAutoDatabaseBackup"
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
