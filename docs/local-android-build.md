# 本地构建 APK

## 日常使用

1. 推荐在项目根目录双击 `掌上仓库构建工具.exe`，点击“开始构建”。可以切换程序或最小化；关闭窗口时选择“继续后台运行”，可从托盘或再次双击 EXE 恢复同一个任务。
2. 等待窗口显示“构建成功”。首次构建或增加原生依赖可能较慢，后续会复用缓存。界面显示实际阶段与日志，不估算完成百分比。
3. 安装包在项目的 `dist/apk` 文件夹，文件名包含应用名、版本号、`arm64` 和构建时间。每次生成新文件，不覆盖旧包。
4. 完整日志在 `logs/android-build`。出现 `BUILD FAILED` 时不要使用旧包冒充新包，将本次日志提供给维护人员。

APK 与同步助手统一在图形工具中选择构建，独立 CMD 构建入口已移除。不要单独移动 EXE 使用，仍需完整项目。

图形窗口的完整任务日志位于 `logs/android-build/gui`。若提示需要准备环境，点击“准备环境…”，在打开的可见窗口中阅读并处理 SDK 许可，再重新构建。详细用法见 [掌上仓库构建工具说明](build-tool.md)。

## 新电脑自动准备环境

图形工具会先检测所选目标的构建环境。已有可用环境直接复用；缺少或版本不兼容时，在 `%LOCALAPPDATA%\ChipmunksBuildTools` 准备项目需要的工具，再继续原有构建。适用于 Windows 10/11 的 Intel/AMD 64 位电脑，首次准备需要网络。

| 检查项 | 自动准备策略 |
| --- | --- |
| Node.js | 检查 Node 22.14+ 和 `node:sqlite`；缺少时使用已验证的 Node 22.23.1 官方 ZIP。 |
| pnpm | 使用项目 `packageManager` 对应的 9.0.0；缺少时通过 Corepack 准备，保留独立缓存。 |
| JDK | 检测 `JAVA_HOME`、PATH 和常见安装目录中的 JDK 17；缺少时使用 Adoptium 官方 JDK 17。 |
| Android SDK | 检查 API 36、Build Tools 36.0.0、platform-tools 与 SDK 许可；缺少时准备独立 SDK。 |

工具路径只设置在本次构建进程中，不要求手工修改系统 PATH 或重启电脑。不会卸载其他版本的软件，不执行 Expo 升级或重新生成原生项目。Gradle 继续使用项目自己的 wrapper，并按项目配置准备 NDK/CMake 等原生组件；首次下载可能较慢。

首次准备 SDK 时，窗口会显示 Google 许可，请阅读后按提示确认；未接受时停止，不会自动代答。网络失败时可重新运行，已验证的下载与完整工具会复用。未完成的文件不会作为成功安装使用。

只准备环境、不构建 APK 或 EXE，可双击根目录的 `准备构建环境.bat`，默认检查并准备两种构建环境。只准备其中一种：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-build-environment.ps1 -Target Apk
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-build-environment.ps1 -Target Sync
```

仅检查两种环境、不下载安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-build-environment.ps1 -Target Both -CheckOnly
```

换电脑仍需携带完整项目、`android-build.local`、原发布签名和 NAS 私密配置，并将配置中的路径改成新电脑实际路径。只复制构建工具 EXE 不能构建。环境自动准备不会生成或替换发布密钥，也不能推断 NAS 用户名和密码。若新电脑没有 D 盘，须把 `buildRoot` 和私密配置路径指向新电脑的有效位置；缓存仍要求独立的短 `cw-*` 目录。

同步助手也在 `掌上仓库构建工具.exe` 中选择，同样先检查环境；已有打包好的同步助手 EXE 运行时自带 Python，不需要为了运行它而安装这些构建工具。

官方工具来源：[Node 发布及校验值](https://nodejs.org/en/blog/release/v22.23.1)、[Python 3.12.10](https://www.python.org/downloads/release/python-31210/)、[Adoptium API](https://github.com/adoptium/api.adoptium.net/blob/main/docs/cookbook.adoc)、[Android SDK 工具](https://developer.android.com/tools/sdkmanager)。

脚本由本机独立执行，不依赖 Codex 对话、Token 或扣子沙箱。电脑需要保持运行；图形窗口关闭时可选择继续后台运行。

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

单独运行 `node client/scripts/check-android-backup.cjs` 可验证当前中文表名、仅有批次流水时的判断、空库保护，以及原生文件与 Expo 模板的一致性。该检查使用本地 SQLite 测试库，不上传 NAS，也不能替代 PDA 的实际后台调度验收。

## 本机配置与签名

本机已配置 `android-build.local`，这是 JSON 格式的本地文件，已被现有 Git 忽略规则排除。

```json
{
  "buildRoot": "D:\\cw-android",
  "signingFile": "D:\\掌上仓库_Android发布签名\\signing.local.json",
  "updateServerFile": "D:\\掌上仓库_Android发布签名\\update-server.local.json"
}
```

`buildRoot` 必须是独立的短目录，例如 `D:\cw-android`，不能指向项目、磁盘根目录或个人资料目录。已有目录必须是脚本标记过的专用缓存；不要手动给其他目录添加标记。更换电脑时可在这里选择一个尚不存在的新缓存目录，首次构建会重新准备依赖。

发布签名可通过工具中的“签名管理 → 导入原发布签名”迁入当前 Windows 账户的加密存储，后续构建优先使用已托管签名。原文件仍保留。换电脑请使用“导出加密备份”和“从备份恢复”，不能直接复制本机加密文件。加密备份仅含签名及签名参数，不含源码、NAS 配置或构建环境。

原私有发布签名在 `D:\掌上仓库_Android发布签名`。务必私密备份整个目录，包含密钥文件及 `signing.local.json`。不要上传到公开代码仓库、扣子或随 APK 分发。脚本不会在签名丢失时自动换一把新密钥，也不会退回调试签名。

`update-server.local.json` 保存 NAS 更新地址和登录信息，内容格式为 `{"defaultServer":"https://用户名:密码@服务器/AppUpdate"}`。构建脚本从 `updateServerFile` 读取它，不把凭据写入项目源码。请与签名文件一起私密备份；更换 NAS 密码后也要更新这个文件。发布 APK 中仍会包含访问 NAS 所需的信息，应限制 NAS 账户权限并在凭据泄露后及时更换。

本机需要 JDK 17、Node.js 22.23（本机已验证，需支持 `node:sqlite`）、pnpm、Android SDK 36及Build Tools 36.0.0。`JAVA_HOME` 指向JDK；SDK优先读取 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，否则使用当前用户的 `AppData\Local\Android\Sdk`。NDK和CMake由项目配置及Gradle管理，首次准备需要可用网络及已接受的SDK许可。

仅检查环境、不启动构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android-release.ps1 -CheckOnly
```

只验证源码同步、不安装依赖或启动 APK 编译：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android-release.ps1 -SyncOnly
```

`-SyncOnly` 会使用同样的缓存所有权检查和构建锁，完成第 1 步后显示 `SYNC PASSED`。它不读取私有签名配置，也不启动 pnpm 或 Gradle；同步通过不代表整个 APK 已构建完成。

## 安装提醒

首次从扣子的调试签名APK切换到本地发布签名，需要卸载旧包后安装。卸载前必须将数据库及需要保留的配置备份到NAS或电脑，确认文件可读取；只留在APP内部的备份会随卸载丢失。

以后继续使用同一发布签名即可覆盖升级。构建成功不等于实机业务验收，正式使用前仍需检查PDA安装、数据库恢复、双账套查询及扫码出入库、盘点功能。

当前正式版内部安装编号为 100；旧“掌上仓库”安装包曾使用编号 106。如果设备上装着同包名的 106 版，Android 不会直接用 100 版覆盖。处理前先确认签名和备份，再决定采用更高的安装编号发布，或在备份后卸载旧版并安装新包。

## 构建输入与可清理文件

手动构建不需要逐个选择文件，也不需要上传给扣子。在完整项目根目录双击 `掌上仓库构建工具.exe` 并选择 APK 即可；脚本会同步 `client/`、根目录的依赖清单和锁文件以及 `server/package.json` 到专用构建目录。`patches/` 是可选的依赖补丁目录：存在时同步；不存在且依赖配置、锁文件没有引用时跳过，并清除专用缓存中遗留的同名目录。若配置仍引用 `patches/` 但源目录缺失，会明确报错，不能通过建空目录代替真实补丁文件。APK 使用完整前端源码、原生 Android 工程和图片等资源，不能只拿本轮改过的几个文件单独构建。

应用版本唯一来源是 `client/version.json`，Android 和 Expo 自动读取它；当前为 `V1.0`、`versionCode=100`、`buildNumber=100`。普通双击构建不自动增加版本号。以后发布更新时，应按实际升级需要递增内部安装编号。同步助手版本独立维护，这两个程序的版本不要求使用相同编号。

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

**必须保留**：项目 `client/` 中的源码和 `client/android/` 原生工程（只可清理明确的内部构建目录）、`scripts/label_templates/`、`scripts/assets/`、构建脚本、项目配置引用的依赖补丁文件（如 `patches/` 中的文件）、依赖锁文件、`android-build.local`、`D:/掌上仓库_Android发布签名/`、服务器配置，以及 `D:/数据同步/` 的 Excel、`sync-helper-config.json` 等配置、旧 `native-label-print-history.json` 和新 `native-label-print-history.sqlite3` 去重账本。

`tools/week-converter/` 是独立的周次转换项目，不属于旧同步助手。`node_modules/`、pnpm 缓存和用户目录的 Gradle 缓存虽然可以重新下载，但平时不建议为清理安装包而删除。不要在构建过程中清理任何构建目录。
