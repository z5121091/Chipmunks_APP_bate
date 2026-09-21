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
const selfUpdateEnabled = process.env.EXPO_PUBLIC_ENABLE_SELF_UPDATE !== 'false';
const splashBackgroundColor = '#FFFFFF';
const splashDarkBackgroundColor = '#121212';
const splashImage = './assets/images/splash-logo.png';
const splashDarkImage = './assets/images/splash-logo-dark.png';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    "name": versionConfig.appName,
    "slug": slugAppName,
    "version": versionConfig.version,
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "chipmunkswarehouse",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": {
      "image": splashImage,
      "resizeMode": "contain",
      "backgroundColor": splashBackgroundColor
    },
    "ios": {
      "supportsTablet": true,
      "splash": {
        "image": splashImage,
        "resizeMode": "contain",
        "backgroundColor": splashBackgroundColor,
        "dark": {
          "image": splashDarkImage,
          "backgroundColor": splashDarkBackgroundColor
        }
      }
    },
    "android": {
      "package": "com.chipmunks.traceability",
      "versionCode": versionConfig.versionCode,
      "permissions": [
        "android.permission.INTERNET",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.ACCESS_WIFI_STATE",
        ...(selfUpdateEnabled ? ["android.permission.REQUEST_INSTALL_PACKAGES"] : [])
      ],
      "blockedPermissions": [
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.CAMERA",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.RECORD_AUDIO",
        "android.permission.SYSTEM_ALERT_WINDOW",
        ...(!selfUpdateEnabled ? ["android.permission.REQUEST_INSTALL_PACKAGES"] : [])
      ],
      "splash": {
        "image": splashImage,
        "resizeMode": "contain",
        "backgroundColor": splashBackgroundColor,
        "dark": {
          "image": splashDarkImage,
          "backgroundColor": splashDarkBackgroundColor
        }
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
        "expo-splash-screen",
        {
          "image": splashImage,
          "imageWidth": 176,
          "resizeMode": "contain",
          "backgroundColor": splashBackgroundColor,
          "dark": {
            "image": splashDarkImage,
            "backgroundColor": splashDarkBackgroundColor
          }
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            // 最低 Android 版本
            "minSdkVersion": 30, // Android 11
            // 允许 HTTP 明文流量（电脑同步和 NAS 更新源需要）
            "usesCleartextTraffic": true,
            // 只编译 arm64 架构，减小 APK 体积
            "buildArchs": ["arm64-v8a"]
          }
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
      "updateServerUrl": defaultUpdateServer,
      "selfUpdateEnabled": selfUpdateEnabled
    },
    "experiments": {
      "typedRoutes": true
    }
  };
}
