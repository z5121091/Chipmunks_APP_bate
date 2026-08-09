import type { ConfigContext, ExpoConfig } from 'expo/config';
import versionConfig from './version.json';
import updateServerConfig from './update-server.json';

const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const slugAppName = projectId ? `app${projectId}` : 'myapp';
const configuredUpdateServer = (
  process.env.UPDATE_SERVER_URL ||
  process.env.EXPO_PUBLIC_UPDATE_SERVER_URL ||
  updateServerConfig.defaultServer
).trim();

const restoreMatchingUpdateServerCredentials = (
  candidate: string,
  credentialSource: string
): string => {
  try {
    const candidateUrl = new URL(candidate);
    const sourceUrl = new URL(credentialSource);
    const candidatePath = candidateUrl.pathname.replace(/\/+$/, '');
    const sourcePath = sourceUrl.pathname.replace(/\/+$/, '');
    const sameEndpoint =
      candidateUrl.protocol === sourceUrl.protocol &&
      candidateUrl.host.toLowerCase() === sourceUrl.host.toLowerCase() &&
      candidatePath === sourcePath &&
      candidateUrl.search === sourceUrl.search;

    if (sameEndpoint) {
      candidateUrl.username ||= sourceUrl.username;
      candidateUrl.password ||= sourceUrl.password;
      return candidateUrl.toString();
    }
  } catch {
    // 由运行时的更新检查继续给出可理解的地址错误。
  }

  return candidate;
};

const defaultUpdateServer = restoreMatchingUpdateServerCredentials(
  configuredUpdateServer,
  updateServerConfig.defaultServer
).replace(/\/+$/, '');

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    "name": versionConfig.appName,
    "slug": slugAppName,
    "version": versionConfig.version,
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
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
      "package": "com.chipmunks.traceabilityBeta",
      "versionCode": versionConfig.versionCode,
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.ACCESS_WIFI_STATE",
        "android.permission.REQUEST_INSTALL_PACKAGES"
      ],
      "blockedPermissions": [
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
          "photosPermission": "允许掌上仓库保存 APK 到下载文件夹以便安装更新",
          "savePhotosPermission": "允许掌上仓库保存备份文件到您的设备",
          "isAccessMediaLocationGranted": true
        }
      ],
      [
        "expo-document-picker",
        {
          "iCloudContainerEnvironment": "Production"
        }
      ],
      "expo-font",
      [
        "expo-sqlite",
        {
          useSQLCipher: false
        }
      ],
      "./plugins/withAutoDatabaseBackup"
    ],
    "extra": {
      ...(config.extra || {}),
      "updateServerUrl": defaultUpdateServer
    },
    "experiments": {
      "typedRoutes": true
    }
  };
}
