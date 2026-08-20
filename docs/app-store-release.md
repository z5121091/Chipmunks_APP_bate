# 掌上仓库应用商店发布资料

## 构建渠道

- 企业内部 APK：`EXPO_PUBLIC_ENABLE_SELF_UPDATE=true`，保留应用内更新和 `REQUEST_INSTALL_PACKAGES`。
- 应用商店版本：`EXPO_PUBLIC_ENABLE_SELF_UPDATE=false`，隐藏应用内更新，并由 Expo 配置排除 `REQUEST_INSTALL_PACKAGES`。
- 商店构建必须在全新的构建工作区生成原生项目，不能复用曾启用内部更新的旧 Android 构建目录。

## 权限用途

| 权限 | 用途 |
| --- | --- |
| `INTERNET` | 连接 ERP、同步服务、NAS 和更新服务 |
| `ACCESS_NETWORK_STATE` | 判断网络是否可用并展示连接错误 |
| `ACCESS_WIFI_STATE` | 辅助局域网同步连接 |
| `RECEIVE_BOOT_COMPLETED` | 恢复已启用的数据库自动备份计划 |
| `VIBRATE` | 扫码成功或失败的触觉反馈 |
| `REQUEST_INSTALL_PACKAGES` | 仅企业内部 APK 的用户主动更新；商店版本必须排除 |

应用不申请定位、通讯录、相机、麦克风、媒体库或悬浮窗权限。

## 数据安全表填写依据

- 数据收集：扫描及手工录入的仓库业务数据会在启用 ERP、同步或 NAS 功能时离开设备，应按“收集”申报。
- 数据用途：应用功能、业务记录、库存核对、备份和故障排查。
- 数据共享：不用于广告，不出售数据；畅捷通、企业服务器和 NAS 仅按用户配置处理业务数据。
- 广告与分析：无广告 SDK，无行为分析 SDK。
- 传输加密：ERP 和正式后端使用 HTTPS；若用户配置 HTTP 局域网同步地址，则不能声明“所有数据传输均加密”。
- 删除方式：设备内数据可在应用中清理或通过卸载删除；服务器、NAS 和 ERP 数据由企业管理员处理。
- 隐私政策 URL：`https://erp.chipmunks.fun/privacy`。

## 上架前人工确认

1. 商店构建环境设置 `EXPO_PUBLIC_ENABLE_SELF_UPDATE=false`。
2. 检查最终 AAB/APK Manifest 不包含 `REQUEST_INSTALL_PACKAGES`。
3. 确认隐私政策 URL 可公网访问，内容与实际版本一致。
4. 在商店后台填写真实有效的开发者联系邮箱和数据删除联系方式。
5. 如果继续允许 HTTP 局域网同步，数据安全表不得勾选“所有数据传输均加密”。
