/**
 * Expo Config Plugin for Android Boot Receiver
 * 添加开机自启动功能
 * 
 * 此文件为 Expo Config Plugin，在 Node.js 构建环境中运行，非客户端代码
 */

const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RECEIVE_BOOT_COMPLETED = 'android.permission.RECEIVE_BOOT_COMPLETED';

const BOOT_RECEIVER_JAVA = `package com.chipmunks.traceability;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机自启动广播接收器
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launchIntent);
        }
    }
}
`;

module.exports = function withBootReceiver(config) {
  // 1. 修改 AndroidManifest.xml
  config = withAndroidManifest(config, async (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    // 添加 RECEIVE_BOOT_COMPLETED 权限
    if (!Array.isArray(config.modResults.manifest['uses-permission'])) {
      config.modResults.manifest['uses-permission'] = [];
    }

    const permissions = config.modResults.manifest['uses-permission'];
    const hasPermission = permissions.some(
      (p) => p.$['android:name'] === RECEIVE_BOOT_COMPLETED
    );

    if (!hasPermission) {
      permissions.push({
        $: { 'android:name': RECEIVE_BOOT_COMPLETED }
      });
    }

    // 添加广播接收器
    if (!Array.isArray(mainApplication.receiver)) {
      mainApplication.receiver = [];
    }

    const receiverName = 'com.chipmunks.traceability.BootReceiver';
    const hasReceiver = mainApplication.receiver.some(
      (r) => r.$['android:name'] === receiverName
    );

    if (!hasReceiver) {
      mainApplication.receiver.push({
        $: {
          'android:name': receiverName,
          'android:enabled': 'true',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }
            ]
          }
        ]
      });
    }

    return config;
  });

  // 2. 注入 Java 文件
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const javaDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/com/chipmunks/traceability'
      );
      
      // 创建目录
      if (!fs.existsSync(javaDir)) {
        fs.mkdirSync(javaDir, { recursive: true });
      }

      // 写入 Java 文件
      const javaFile = path.join(javaDir, 'BootReceiver.java');
      fs.writeFileSync(javaFile, BOOT_RECEIVER_JAVA);

      return config;
    },
  ]);

  return config;
};
