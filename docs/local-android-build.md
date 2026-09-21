# 本地双击构建 APK

## 日常使用

1. 在项目根目录双击 `构建APK.bat`，不要移动这个文件单独使用。
2. 等待窗口显示 `BUILD SUCCEEDED`。首次构建或增加原生依赖可能较慢，后续会复用缓存，不要重复双击或中途关闭窗口。
3. 安装包在项目的 `dist/apk` 文件夹，文件名包含应用名、版本号、`arm64` 和构建时间。每次生成新文件，不覆盖旧包。
4. 完整日志在 `logs/android-build`。出现 `BUILD FAILED` 时不要使用旧包冒充新包，将本次日志提供给维护人员。

脚本由本机独立执行，不依赖 Codex 对话、Token 或扣子沙箱。电脑需要保持开机，构建窗口不能关闭。

## 脚本执行的操作

- 同步最新前端源码和依赖锁文件到独立的短路径构建缓存，源项目、数据库、服务器配置不会被清理或修改。
- 同步时删除的是缓存副本中已经从源项目删除的旧源码，保留原生编译缓存和依赖缓存。
- 用 pnpm 按锁文件安装依赖，采用适合 Windows 的短路径依赖布局，不自动升级依赖版本。
- 使用本机独立发布签名，只构建 `arm64-v8a`，不包含32位ARM、x86或x86_64。
- 使用生产模式，不自动加载开发用 `.env` 文件；已有系统代理只用于本次构建，不写入 APK。
- 检查启动资源、NAS 定时备份表名与数据库结构的一致性、签名、包名、版本、CPU架构和APK对齐后才交付安装包，同时生成 SHA256 文件和校验记录。

V3.03 恢复品牌启动页。启动专用 Logo 与桌面图标分开，原生资源覆盖五档屏幕密度及深浅色模式。启动页在数据库初始化完成、首页或错误页面提交后淡出，不设置固定停留时间。修改 Logo 或启动尺寸时，须同步更新 Expo 配置及原生资源，并通过 `client/scripts/check-android-launch.cjs` 检查，避免本地构建与扣子重新生成原生工程时效果不一致。

重新从原始 Logo 生成透明图、深色图和原生启动资源：`node client/scripts/check-android-launch.cjs --generate`。只验证、不修改文件：`node client/scripts/check-android-launch.cjs`。这两个命令在项目根目录运行；普通构建只检查，不重绘图片。

应用名和版本读取 `client/version.json`。脚本不会自动增加版本号；正式发布新版本前应在该文件更新版本信息。

V3.04 修复 Android 定时备份仍检查旧英文表名的问题，保留原有六小时周期、每日检查、失败重试和完整数据库备份。单独运行 `node client/scripts/check-android-backup.cjs` 可验证当前中文表名、仅有批次流水时的判断、空库保护，以及原生文件与 Expo 模板的一致性。该检查使用本地 SQLite 测试库，不上传 NAS，也不能替代 PDA 的实际后台调度验收。

## 本机配置与签名

本机已配置 `android-build.local`，这是 JSON 格式的本地文件，已被现有 Git 忽略规则排除。

```json
{
  "buildRoot": "D:\\cw-build-20260913",
  "signingFile": "D:\\掌上仓库_Android发布签名\\signing.local.json"
}
```

`buildRoot` 必须是独立的短目录，例如 `D:\cw-android`，不能指向项目、磁盘根目录或个人资料目录。已有目录必须是脚本标记过的专用缓存；不要手动给其他目录添加标记。更换电脑时可在这里选择一个尚不存在的新缓存目录，首次构建会重新准备依赖。

私有发布签名在 `D:\掌上仓库_Android发布签名`。务必私密备份整个目录，包含密钥文件及 `signing.local.json`。不要上传到公开代码仓库、扣子或随 APK 分发。脚本不会在签名丢失时自动换一把新密钥，也不会退回调试签名。

本机需要 JDK 17、Node.js 22.23（本机已验证，需支持 `node:sqlite`）、pnpm、Android SDK 36及Build Tools 36.0.0。`JAVA_HOME` 指向JDK；SDK优先读取 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，否则使用当前用户的 `AppData\Local\Android\Sdk`。NDK和CMake由项目配置及Gradle管理，首次准备需要可用网络及已接受的SDK许可。

仅检查环境、不启动构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android-release.ps1 -CheckOnly
```

## 安装提醒

首次从扣子的调试签名APK切换到本地发布签名，需要卸载旧包后安装。卸载前必须将数据库及需要保留的配置备份到NAS或电脑，确认文件可读取；只留在APP内部的备份会随卸载丢失。

以后继续使用同一发布签名即可覆盖升级。构建成功不等于实机业务验收，正式使用前仍需检查PDA安装、数据库恢复、双账套查询及扫码出入库、盘点功能。

## 构建输入与可清理文件

手动构建不需要逐个选择文件，也不需要上传给扣子。在完整项目根目录双击 `构建APK.bat` 即可；脚本会同步 `client/`、`patches/`、根目录的依赖清单和锁文件以及 `server/package.json` 到专用构建目录。APK 使用完整前端源码、原生 Android 工程和图片等资源，不能只拿本轮改过的几个文件单独构建。

应用版本唯一来源是 `client/version.json`，Android 和 Expo 自动读取它；当前为 `V3.06`、`versionCode=106`、`buildNumber=106`。普通双击构建不自动增加版本号。同步助手版本独立维护，为 `3.6.2`，本轮未更改。这两个程序的版本不要求使用相同编号。

原生 Gradle 已把 `version.json` 作为前端打包的输入依赖，修改版本时会重新生成前端代码包；交付前还会检查 APK 内的前端代码包包含当前版本标识，避免系统安装信息已更新、APP 内仍显示旧版本。

只在构建已结束、同步助手已退出时清理以下文件：

| 路径 | 是否可清理 | 说明 |
| --- | --- | --- |
| `dist/apk/` 内旧 `.apk`、对应 `.sha256` 和 `*-verification.txt` | 可以 | 交付产物；保留要使用或分发的新包即可。 |
| `scripts/dist/` 内旧同步助手 `.exe` | 可以 | 交付产物；不要把数据目录当作构建目录删除。 |
| `scripts/build/`、生成的 `scripts/掌上仓库ERP版同步助手.spec` | 可以 | PyInstaller 中间产物，标准构建脚本完成后会清理。 |
| `scripts/__pycache__/`、`scripts/label_templates/__pycache__/` | 可以 | Python 自动生成的缓存，下次会重建。 |
| `logs/android-build/` 内旧 `.log` 和预览图 | 可以 | 诊断资料，不影响业务；建议保留最近成功及失败日志。 |
| `logs/android-build/rejected-*/` | 可以 | 验证不通过的隔离产物，禁止安装，不属于交付包。 |
| `D:/cw-build-20260913/client/android/app/build/`、`client/android/build/` | 可以，但会增加重编译时间 | 专用构建副本中的 Gradle 产物；不要删除外层 Android 源码。 |
| 专用构建目录中的 `.cxx/`、`.gradle/` | 可以，但通常不必清理 | 原生编译缓存，删除后下一次构建会明显变慢。 |
| 旧扣子增量/完整源码 ZIP，以及下载目录中不用的旧 APK | 可以 | 确认不是数据库、签名、系统恢复或唯一源码备份后再删除。 |

**必须保留**：项目 `client/` 中的源码和 `client/android/` 原生工程（只可清理明确的内部构建目录）、`scripts/label_templates/`、`scripts/assets/`、构建脚本、`patches/`、依赖锁文件、`android-build.local`、`D:/掌上仓库_Android发布签名/`、服务器配置，以及 `D:/数据同步/` 的 Excel、配置和 `native-label-print-history.json`。

`tools/week-converter/` 是独立的周次转换项目，不属于旧同步助手。`node_modules/`、pnpm 缓存和用户目录的 Gradle 缓存虽然可以重新下载，但平时不建议为清理安装包而删除。不要在构建过程中清理任何构建目录。
