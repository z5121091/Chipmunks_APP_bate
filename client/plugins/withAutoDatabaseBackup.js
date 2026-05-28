const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');

const WORK_MANAGER_DEPENDENCY = 'implementation("androidx.work:work-runtime-ktx:2.9.1")';
const RECEIVER_NAME = '.AutoDatabaseBackupReceiver';
const BOOT_ACTION = 'android.intent.action.BOOT_COMPLETED';

function ensurePermission(androidManifest, permissionName) {
  const permissions = androidManifest.manifest['uses-permission'] || [];
  const exists = permissions.some((permission) => {
    return permission.$?.['android:name'] === permissionName;
  });

  if (!exists) {
    permissions.push({ $: { 'android:name': permissionName } });
    androidManifest.manifest['uses-permission'] = permissions;
  }
}

function ensureReceiver(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const receivers = application.receiver || [];
  const existing = receivers.find((receiver) => receiver.$?.['android:name'] === RECEIVER_NAME);
  const receiver = existing || {
    $: {},
  };
  receiver.$['android:name'] = RECEIVER_NAME;
  receiver.$['android:enabled'] = 'true';
  receiver.$['android:exported'] = 'true';

  receiver['intent-filter'] = [
    {
      action: [{ $: { 'android:name': BOOT_ACTION } }],
    },
  ];

  if (!existing) {
    receivers.push(receiver);
  }
  application.receiver = receivers;
}

function ensureWorkManagerDependency(buildGradle) {
  if (buildGradle.includes(WORK_MANAGER_DEPENDENCY)) {
    return buildGradle;
  }

  return buildGradle.replace(
    'implementation("com.facebook.react:react-android")',
    `implementation("com.facebook.react:react-android")\n    ${WORK_MANAGER_DEPENDENCY}`
  );
}

function ensureMainApplicationSchedulesBackup(mainApplicationPath) {
  if (!fs.existsSync(mainApplicationPath)) {
    return;
  }

  const source = fs.readFileSync(mainApplicationPath, 'utf8');
  if (source.includes('AutoDatabaseBackupScheduler.schedule(this)')) {
    return;
  }

  const updated = source.replace(
    'ApplicationLifecycleDispatcher.onApplicationCreate(this)',
    'ApplicationLifecycleDispatcher.onApplicationCreate(this)\n    AutoDatabaseBackupScheduler.schedule(this)'
  );

  fs.writeFileSync(mainApplicationPath, updated);
}

function writeBackupWorker(projectRoot, packageName) {
  const packagePath = packageName.split('.').join(path.sep);
  const targetPath = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packagePath.split(path.sep),
    'AutoDatabaseBackupWorker.kt'
  );
  const templatePath = path.join(__dirname, 'AutoDatabaseBackupWorker.kt');
  const template = fs.readFileSync(templatePath, 'utf8');

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, template.replace('__PACKAGE_NAME__', packageName));
}

module.exports = function withAutoDatabaseBackup(config) {
  config = withAndroidManifest(config, (config) => {
    ensurePermission(config.modResults, 'android.permission.INTERNET');
    ensurePermission(config.modResults, 'android.permission.ACCESS_NETWORK_STATE');
    ensurePermission(config.modResults, 'android.permission.RECEIVE_BOOT_COMPLETED');
    ensureReceiver(config.modResults);
    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = ensureWorkManagerDependency(config.modResults.contents);
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    (config) => {
      const packageName = config.android?.package;
      if (!packageName) {
        throw new Error('android.package is required for withAutoDatabaseBackup');
      }
      writeBackupWorker(config.modRequest.projectRoot, packageName);

      const mainApplicationPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
        'MainApplication.kt'
      );
      ensureMainApplicationSchedulesBackup(mainApplicationPath);

      return config;
    },
  ]);

  return config;
};
