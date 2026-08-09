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

## 回滚与备份

- 每次部署前备份两份环境文件和整个 `CHANJET_STATE_DIR`。
- 回滚代码时不要回滚较新的 Token 状态文件，否则可能恢复已经失效的 `refreshToken`。
- 如果主状态文件损坏，程序会尝试读取同目录的 `.bak`；仍失败时应停止对应实例后再人工恢复。
- 两个实例必须分别检查健康状态。一个账套正常不代表另一个账套可用。
