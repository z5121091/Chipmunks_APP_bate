# ERP 双账套部署与迁移

本目录用于把同一份后端代码部署成两个相互隔离的 ERP 实例：

| 账套 | `CHANJET_LOCAL_ACCOUNT_KEY` | 建议内部端口 | 示例公网域名 |
| --- | --- | --- | --- |
| 无锡笃能 | `wuxi-duneng` | `18081` | `erp-wuxi.example.com` |
| 上海花栗鼠 | `shanghai-chipmunk` | `18082` | `erp-shanghai.example.com` |

两个实例共享程序文件，但必须使用不同的环境配置、应用凭据、组织 ID、消息密钥、上传目录和进程端口。`CHANJET_STATE_DIR` 可以共用一个根目录，程序会继续按账套标识写入：

```text
<CHANJET_STATE_DIR>/wuxi-duneng/chanjet-state.json
<CHANJET_STATE_DIR>/shanghai-chipmunk/chanjet-state.json
```

不要手工合并、互换或重命名这两个状态文件。文件中保存了各自滚动更新的 `openToken`、`refreshToken`、消息状态和账套标识。

## 上线前准备

1. 为两个企业自建应用分别配置可信域名、回调地址和消息接收地址。
2. 从 `accounts/wuxi-duneng/.env.example` 和 `accounts/shanghai-chipmunk/.env.example` 各复制一份正式环境文件。
3. 分别填写各自的 `CHANJET_ORG_ID`、`CHANJET_APP_KEY`、`CHANJET_APP_SECRET`、`CHANJET_MESSAGE_SECRET`、`CHANJET_CERTIFICATE` 和 `CHANJET_CHECK_CONTENT`。
4. 为两个实例设置不同且强随机的 `BACKEND_ACCESS_KEY` 和 `BACKEND_ADMIN_KEY`。若前端经统一代理访问，代理目标密钥必须与对应实例的 `BACKEND_ACCESS_KEY` 一致。
5. 将 `CHANJET_ALLOW_PLAINTEXT_MESSAGES` 保持为 `false`，并保持 `CHANJET_AUTO_REFRESH_ENABLED=true`。

环境文件、状态目录和上传目录不得放进网站目录，也不得由 IIS/Nginx 直接公开。正式服务器上已有网站或 ERP 数据库时，只要使用独立目录、端口和服务账号，本服务不会读写那些数据。

## Linux 部署

推荐目录：

```text
/opt/palm-warehouse/multi-account/server     后端构建文件
/etc/palm-warehouse/erp/*.env                两份环境文件，权限 0600
/var/lib/palm-warehouse/erp-state            Token 与消息状态
/var/lib/palm-warehouse/uploads              上传文件
```

安装并启动两个实例：

```bash
sudo cp systemd/palm-warehouse-erp@.service /etc/systemd/system/
sudo install -d -o palmwarehouse -g palmwarehouse /var/lib/palm-warehouse/erp-state /var/lib/palm-warehouse/uploads
sudo systemctl daemon-reload
sudo systemctl enable --now palm-warehouse-erp@wuxi-duneng
sudo systemctl enable --now palm-warehouse-erp@shanghai-chipmunk
```

将 `nginx/palm-warehouse-erp.conf.example` 中的两个示例域名替换为正式域名，再接入现有 Nginx 和 HTTPS 配置。反向代理只转发到 `127.0.0.1:18081` 和 `127.0.0.1:18082`，不要把内部端口直接开放到公网。

## Windows Server 2022 部署

Windows Server 可以使用同一份 Node.js 构建文件。建议目录：

```text
C:\PalmWarehouse\server                     后端构建文件
C:\ProgramData\PalmWarehouse\erp\*.env     两份环境文件
C:\ProgramData\PalmWarehouse\erp-state      Token 与消息状态
C:\ProgramData\PalmWarehouse\uploads        上传文件
```

每个 Windows 服务都应设置自己的 `DOTENV_CONFIG_PATH`，并从同一工作目录启动：

```powershell
$env:DOTENV_CONFIG_PATH = 'C:\ProgramData\PalmWarehouse\erp\wuxi-duneng.env'
node C:\PalmWarehouse\server\dist\index.js

$env:DOTENV_CONFIG_PATH = 'C:\ProgramData\PalmWarehouse\erp\shanghai-chipmunk.env'
node C:\PalmWarehouse\server\dist\index.js
```

实际运行时应由 NSSM、WinSW 或其他 Windows 服务管理器创建两个独立服务，不要在同一个进程内切换环境变量。IIS ARR 或 Nginx for Windows 分别把两个 HTTPS 域名转发到两个内部端口。

## 从测试服务器迁移

1. 停止测试服务器对应账套的后端进程，避免复制过程中 Token 正在轮换。
2. 复制后端程序文件和两份环境配置；正式环境应重新设置域名、目录、访问密钥，不要覆盖正式服务器已有网站目录。
3. 按账套复制 `chanjet-state.json` 及其 `.bak` 文件到正式 `CHANJET_STATE_DIR/<accountKey>/`。
4. 检查状态文件内的 `accountKey` 与目录名一致，再启动对应进程。
5. 先访问两个域名各自的 `/api/erp/health`，确认 `accountKey`、`tokenOrgMatches`、`businessReady` 和 `tokenRefreshReady`。
6. 在开放平台把两个应用的可信域名、回调地址和消息接收地址切换到正式域名，并分别发送测试消息。
7. 最后修改前端或统一代理的两个 ERP 基础地址；业务接口路径不需要更改。

## 高频扫码查询

- 出库扫单继续实时查询 ERP；没有延长缓存或允许未核验的本机缓存直接出库。
- 只读 ERP 查询默认复用 HTTP/HTTPS 连接，避免每次创建 curl 进程和重新进行 TCP/TLS 握手。OAuth 授权、Token 续期仍使用原来的通道。
- 连接保留时间默认由 5 秒调整为 20 秒，适配两次扫码之间的停顿；可用 `CHANJET_HTTP_KEEP_ALIVE_MS` 设置为 1000 至 60000 毫秒，重启后生效。此值不是查询结果缓存时间，也不会延长单次请求的总超时。上游主动关闭连接时仍会建立新连接，并保留原 curl 兜底。
- 现存量直接返回数组（含无库存时的空数组）也视为合法成功响应，正常进入原有 15 秒短缓存；错误响应不缓存。盘点和强制刷新继续通过 `X-Erp-Cache-Mode: bypass` 查询，账套、组织和 Token 隔离规则不变。
- 如果环境中设置了 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`（含小写），自动保留 curl 的代理行为；扣子到正式服务器的代理地址与鉴权不变。
- 只读查询遇到指定的临时连接故障或 HTTP 500/502/503/504 时，最多重试一次；原 curl 兜底也计入这两次请求上限，不能叠加出第三次。两次共用原超时预算（默认 18 秒），余量不足不重试。正常查询不增加请求；400/401/403/404/429、HTTP 200 内的业务报错、授权和 Token 换取不走此重试。可设置 `CHANJET_HTTP_TRANSPORT=curl` 并重启服务，回到原通道。
- 每个 ERP 请求返回 `X-Erp-Request-Id`，失败 JSON 同时带 `requestId`。代理透传此标识；`[ERP upstream]`、`[ERP request failed]` 与慢查询日志可按标识关联，区分上游 HTTP、网络/超时、配置、入参和本地异常。仅记录账套、接口、状态码、标准网络错误码、尝试次数和耗时，不记录单号、客户、物料、请求正文、响应正文或凭证。
- 响应头 `Server-Timing` 中，`erp-token` 是 Token 检查耗时，`erp-query` 是 ERP 查询或等待同单并发请求的耗时，`erp-total` 是账套后端处理耗时，`erp-proxy` 是外层代理到收到后端响应头的耗时；这些时间有包含关系，不能直接相加。超过 1 秒的查询会输出 `[ERP timing]` 日志，不记录单号、客户、物料和 Token。
- 两套账共用此代码，需更新并重启两个账套实例及外层代理。本改动不需要重新打包 APK。连接复用不能消除 ERP 自身处理时间，上线后应使用同一网络下的新订单检查真实延迟，不以本机模拟耗时承诺线上速度。
- 部署时一并确认生产代理不再单独缓存 ERP 结果，直接转发账套后端的 `X-Cache`；否则两层缓存可能把 15 秒的库存缓存窗口延长。
- 本轮不更改版本号。部署后通过本地与服务器程序的 SHA256 一致、服务启动时间、`X-Erp-Request-Id` 和两套账的健康检查确认更新，不能只凭未变的 `backendRelease` 判断部署结果。

## 回滚与备份

- 每次部署前备份两份环境文件和整个 `CHANJET_STATE_DIR`。
- 回滚代码时不要回滚较新的 Token 状态文件，否则可能恢复已经失效的 `refreshToken`。
- 如果主状态文件损坏，程序会尝试读取同目录的 `.bak`；仍失败时应停止对应实例后再人工恢复。
- 两个实例必须分别检查健康状态。一个账套正常不代表另一个账套可用。
