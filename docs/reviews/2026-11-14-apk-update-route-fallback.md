# APK 更新主线路与飞牛中转回退

## 需求与已验证地址

APK 更新优先用户的域名直连 WebDAV，访问失败再使用飞牛中转。检查清单和下载 APK 都遵循这个顺序，不改变 NAS 业务备份与云端热更新服务。

- 主线路：`https://zx5121091.pw:5006/AppUpdate`。
- 备用线路：`https://dav.zx5121091.fnos.net/AppUpdate`。
- `5667` 实测为 NAS 管理页面，`/AppUpdate/version.json` 在此返回 404。去掉端口后的默认 HTTPS 在本机未成功；已实际验证的 HTTPS WebDAV 服务是 `5006`，证书校验正常。没有将管理端口当下载端口。
- 两条已验证线路读取到的清单与 APK ETag 一致，APK 长度均为 103635208 字节；GET 清单、HEAD APK 和 Range 206 样本读取均成功。

凭证沿用现有私有配置，只在两个已知 NAS 域名之间使用，不写入源码、审查文档或日志。

## 本轮代码

- `client/utils/apkUpdateRoutes.ts`：独立 APK 路由。已知 NAS 地址映射为主站在前、中转在后；第三方自定义服务器保持自身设置。相对下载路径分别解析，绝对中转下载链接也生成对应主站链接并优先排列，规范化后去重。检查清单每条线路最多等待 5 秒，覆盖 fetch 和 JSON 正文读取；网络、HTTP、JSON、清单结构或包名异常切换备用。异常只保留白名单原因，不传播认证 URL。
- `client/utils/apkUpdateDownload.ts`：按顺序下载。首次新增字节等待 12 秒，此后连续 20 秒没有新增字节才超时；正常持续传输不受短总时限影响。失败调用原生 cancelAsync，最多等待取消 2 秒。每任务/线路使用独立 APK 缓存文件，迟到回调不覆盖新进度或备用文件；失败缓存清理，错误信息白名单化。
- `client/screens/settings/index.tsx`：接入上述两个 helper，删除旧的重复 URL 解析和下载循环；同步 ref 防止同一渲染周期连续点击启动重复任务。原有版本号/安装编号门槛、下载进度、更新弹窗与 Android 安装流程继续使用。

没有改界面布局、按钮尺寸或动画，没有更改解析规则、业务单据、双账套/仓库或原生窗口。

## NAS 备份及热更新边界

`getUpdateServer()` 同时负责 NAS 备份配置镜像，`nasBackup.ts` 和 WorkManager 都依赖它。因此没有修改 `getUpdateServer`、`saveUpdateServer`、公共 defaultServer、私有发布配置、原生备份代码或构建脚本。APK 主备地址是运行时临时候选，不回写这些配置。

安装顺序仍是“下载成功 → 原地址 NAS 数据库备份 → 打开 Android 安装器”，备份失败不打开安装器。云端热更新仍走原有 ERP 云服务，未跟随 APK 下载改线路。

## NAS 清单已更新

通过已认证的 HTTPS WebDAV 读取原清单，并用 ETag 条件 PUT 修改：

- `downloadUrl` 指向主线路 APK。
- `downloadUrls` 为主线路 APK、中转 APK两项。
- 其余字段保持原值，包括 `V1.01`、versionCode/buildNumber 200、包名、更新说明和 forceUpdate。

修改前的原始清单和修改后的文件保存在现有私有发布目录的 `NAS更新线路备份` 文件夹，未进入 Git。文件名分别为 `version.before-apk-routes-20261114-210501.json`、`version.ipv6-first-20261114-210501.json`。PUT 后从主、中转两侧重新读取，内容均与预期一致。没有上传或替换 APK。

兼容现有下载列表的旧 APP 重新检查版本后即可使用新的 APK 下载顺序；APP 侧清单优先主站、超时切换及防重入增强，需要用户将本轮前端代码分发到 PDA 后生效。

## 实际验证与局限

本机主站清单 GET 约 0.22 秒；分别读取 1 MiB APK 样本，主站约 0.20 秒，中转约 1.31 秒，均返回 Range 206 且 APK 文件头正确。这里只是本机一次短样本，不能当作完整 APK 下载速度或 PDA 网络承诺。

专项覆盖主站成功、主站 HTTP/网络/正文超时/坏 JSON 后中转成功、正确下载排序、认证隔离、持续传输、无进度取消、迟到回调、空文件、错误结果 URI、同帧多次点击、安装前备份和版本门槛。

最终验证：

- 主备路由 36 项、下载 transport 24 项、真实 SettingsScreen 集成 13 项均通过。
- 与现有更新服务器、原生 NAS 配置镜像、OTA、设置展开及弹窗滚动回归合并执行：8 套、112 项全部通过，Jest 退出码 0。
- 全量客户端 TypeScript 和 ESLint 通过；最终本轮文件再次检查 ESLint，差异格式检查通过。
- 直接执行生产路由 helper 访问真实 NAS：正常读取主线路清单成功；注入主线路连接故障后，读取真实中转清单成功；两种情况下生成的 APK 下载列表均为主线路在前、中转在后。
- 安装前 NAS 备份仍使用原先保存的地址；集成测试确认没有调用 saveUpdateServer，原生备份配置镜像没有收到临时主线路地址。

本轮未构建 APK/EXE、未上传新 APK、未发布热更新、未提交或推送 Git。真实 PDA 的网络选择与完整 APK 下载仍待设备验收。
