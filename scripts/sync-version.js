#!/usr/bin/env node
/**
 * 版本号同步脚本
 * 从 client/version.json 读取版本号，同步到所有 package.json 文件
 * 
 * 使用方法: node scripts/sync-version.js
 * 
 * ⚠️ 更新版本时请直接修改 client/version.json 文件
 */

const fs = require('fs');
const path = require('path');

// 读取版本配置文件
const versionFilePath = path.join(__dirname, '../client/version.json');
const versionConfig = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'));

const { version, versionCode, appName } = versionConfig;

console.log(`📦 当前版本: ${version} (versionCode: ${versionCode})`);
console.log(`📱 应用名称: ${appName}\n`);

// 需要同步的 package.json 文件列表
const packageJsonFiles = [
  path.join(__dirname, '../package.json'),
  path.join(__dirname, '../client/package.json'),
  path.join(__dirname, '../server/package.json'),
];

let updated = false;

packageJsonFiles.forEach((filePath) => {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  文件不存在: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(content);
  
  if (json.version !== version) {
    json.version = version;
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
    console.log(`✅ 已更新: ${path.relative(path.join(__dirname, '..'), filePath)}`);
    updated = true;
  } else {
    console.log(`⏭️  无需更新: ${path.relative(path.join(__dirname, '..'), filePath)}`);
  }
});

if (updated) {
  console.log('\n✨ 版本号同步完成！');
} else {
  console.log('\n✅ 所有版本号已保持一致！');
}

// 打印所有版本号位置供参考
console.log('\n📋 版本号存储位置:');
console.log('   主配置文件: client/version.json');
console.log('   自动同步到:');
console.log('   - package.json (根目录)');
console.log('   - client/package.json');
console.log('   - server/package.json');
console.log('   - client/app.config.ts (自动读取)');
console.log('   - client/screens/settings/index.tsx (自动读取)');
