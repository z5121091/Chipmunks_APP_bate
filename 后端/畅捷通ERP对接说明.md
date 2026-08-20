# 畅捷通 ERP 对接说明

本文档记录本项目后端对接畅捷通开放平台的第一版方案。代码落点在 `server`，因为当前仓库的 pnpm workspace 已经把 Express 后端固定在 `server` 目录；这个 `后端` 目录先作为对接资料区使用。

## 已接入的后端路由

后端启动后，基础地址默认是 `http://localhost:8080`。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/erp/health` | GET | 查看畅捷通配置是否存在 |
| `/api/erp/auth/open-app-url` | GET | 生成应用开通链接 |
| `/api/erp/auth/authorize-url` | GET | 生成用户授权链接 |
| `/api/erp/auth/callback` | GET | OAuth 回调地址，接收 `code` 和 `state` |
| `/api/erp/auth/exchange-code` | POST | 用临时授权码换 `openToken` |
| `/api/erp/auth/refresh` | POST | 用 `refreshToken` 刷新 `openToken` |
| `/api/erp/auth/app-access-token` | POST | 用 `appTicket` 换应用凭证 |
| `/api/erp/auth/org-access-token` | POST | 用企业永久授权码换企业凭证 |
| `/api/erp/auth/token-by-permanent-code` | POST | 用用户永久授权码换 `openToken` |
| `/api/erp/auth/resend-app-ticket` | POST | 立即触发自建应用 appTicket 推送 |
| `/api/erp/auth/self-built-token` | POST | 自建应用用 `appTicket` + `certificate` 获取 `openToken` |
| `/api/erp/messages` | POST | 畅捷通消息接收地址，返回 `{ "result": "success" }` |
| `/api/erp/messages/latest` | GET | 查看最近一次消息状态，不返回敏感票据 |
| `/api/erp/tplus/inventory/query` | POST | T+Cloud 存货查询 |
| `/api/erp/tplus/current-stock/query` | POST | T+Cloud 现存量查询 |
| `/api/erp/tplus/current-stock/query-by-time` | POST | T+Cloud 现存量增量查询 |

## 环境变量

复制 `server/.env.example` 为 `server/.env`，填入开放平台应用信息：

```env
CHANJET_APP_KEY=
CHANJET_APP_SECRET=
CHANJET_CHECK_CONTENT=
CHANJET_MESSAGE_SECRET=
CHANJET_CERTIFICATE=
CHANJET_APP_TICKET=
CHANJET_REDIRECT_URI=http://localhost:8080/api/erp/auth/callback
CHANJET_APP_NAME=tpluscloud
CHANJET_SCOPE=auth_all
CHANJET_OPEN_TOKEN=
CHANJET_SID=
CHANJET_EXCHANGE_ON_CALLBACK=false
```

`CHANJET_OPEN_TOKEN` 用于本地直接调业务接口。正式方案应把 token 保存到数据库或缓存中，不建议让前端长期持有 token。

`CHANJET_CHECK_CONTENT` 是畅捷通可信域名校验文件 `CHANJET_CHECK.txt` 的内容。配置后，后端会在域名根路径提供：

```text
https://你的域名/CHANJET_CHECK.txt
```

`CHANJET_MESSAGE_SECRET` 是自建应用里配置的消息秘钥，必须是 16 位字符。当前建议填写：

```text
Zx512Erp20260605
```

`CHANJET_CERTIFICATE` 是自建应用管理员授权后获得的软证书；也可以在调用 `/api/erp/auth/self-built-token` 时通过请求体临时传入。

## 企业自建应用流程

企业自建应用找不到 OAuth 回调地址是正常的。官方文档说明：商店应用需要配置 OAuth 回调地址、消息秘钥和消息接收地址；企业自建应用只需要配置消息秘钥和消息接收地址。

自建应用后台需要填写：

```text
消息秘钥：Zx512Erp20260605
消息接收地址：https://erp.chipmunks.fun/api/erp/messages
```

保存消息接收地址时，畅捷通会发送 `APP_TEST` 验证消息；之后每 10 分钟会发送 `APP_TICKET` 消息。后端会自动解密消息并保存最近的 `appTicket`。

如果想立即触发 appTicket 推送，可以调用：

```bash
curl -X POST "https://erp.chipmunks.fun/api/erp/auth/resend-app-ticket"
```

拿到自建应用管理员授权后的软证书 `certificate` 后，换取 `openToken`：

```bash
curl -X POST "https://erp.chipmunks.fun/api/erp/auth/self-built-token" \
  -H "Content-Type: application/json" \
  -d "{\"certificate\":\"你的软证书\"}"
```

后端会把返回的 `accessToken` 缓存起来，后续库存、存货接口会自动使用这个 token。

## 对接流程

1. 在畅捷通开放平台创建应用。

   T+OpenAPI 文档要求模式选择“应用入驻”，对接产品选择 `T+Cloud` 和 `Tplus`。

2. 配置开放平台开发信息。

   OAuth 回调地址填公网可访问的后端地址，例如：

   ```text
   https://你的域名/api/erp/auth/callback
   ```

   消息接收地址填：

   ```text
   https://你的域名/api/erp/messages
   ```

   如果开放平台要求先配置可信域名，需要先下载或复制它给出的 `CHANJET_CHECK.txt` 内容，填入 `server/.env` 的 `CHANJET_CHECK_CONTENT`，然后确认下面地址能打开：

   ```text
   https://你的域名/CHANJET_CHECK.txt
   ```

3. 生成应用开通链接。

   ```bash
   curl "http://localhost:8080/api/erp/auth/open-app-url?state=demo"
   ```

4. 生成用户授权链接。

   用户授权链接需要企业 ID：

   ```bash
   curl "http://localhost:8080/api/erp/auth/authorize-url?orgId=企业ID&state=demo"
   ```

5. 用户授权完成后，开放平台会跳转到 OAuth 回调地址并携带 `code`。

   默认回调只返回 `code` 和 `state`，方便调试。拿到 `code` 后换 token：

   ```bash
   curl -X POST "http://localhost:8080/api/erp/auth/exchange-code" \
     -H "Content-Type: application/json" \
     -d "{\"code\":\"用户临时授权码\"}"
   ```

6. 把返回的 `result.access_token` 临时填入 `CHANJET_OPEN_TOKEN`，然后测试 T+Cloud 接口。

   存货查询：

   ```bash
   curl -X POST "http://localhost:8080/api/erp/tplus/inventory/query" \
     -H "Content-Type: application/json" \
     -d "{\"param\":{\"SelectFields\":\"Code,Name,Specification,DefaultBarCode\",\"PageSize\":\"20\"}}"
   ```

   现存量查询：

   ```bash
   curl -X POST "http://localhost:8080/api/erp/tplus/current-stock/query" \
     -H "Content-Type: application/json" \
     -d "{\"param\":{\"Warehouse\":[{\"Code\":\"001\"}],\"PageSize\":\"20\",\"PageIndex\":\"1\",\"GroupInfo\":{\"Warehouse\":true,\"Inventory\":true}}}"
   ```

## 当前约定

- 后端不会把 `appSecret` 返回给前端。
- 业务接口默认从 `CHANJET_OPEN_TOKEN` 读取 token；本地调试也可以用请求头 `x-chanjet-open-token` 临时传入。
- T+ 部分接口可能需要 `sid`，可配置 `CHANJET_SID` 或请求头 `x-chanjet-sid`。
- 现在还没有持久化 token。下一步应根据项目数据库方案保存 `access_token`、`refresh_token`、`user_auth_permanent_code`、`org_id`、`app_name` 和过期时间。

## ECS 部署记录

当前后端已经迁移到正式 ECS：

```text
公网 IP：47.116.37.183
服务目录：/opt/palm-warehouse/server
systemd 服务：palm-warehouse-server
本机监听：127.0.0.1:8080
无锡笃能账套服务：palm-warehouse-erp@wuxi-duneng（127.0.0.1:18081）
上海花栗鼠账套服务：palm-warehouse-erp@shanghai-chipmunk（配置预留，暂未启用）
Nginx 反向代理：HTTPS -> 127.0.0.1:8080
稳定后端域名：https://erp.chipmunks.fun
HTTPS：Let's Encrypt 已配置，当前证书有效期至 2026-11-10，自动续期模拟已通过；客户端只使用域名，后续迁移服务器无需重新打包 APK
```

需要在阿里云安全组放行：

```text
TCP 80  来源 0.0.0.0/0
TCP 443 来源 0.0.0.0/0
```

需要在域名 DNS 中添加：

```text
主机记录：erp
记录类型：A
记录值：47.116.37.183
```

DNS 生效后，执行证书配置：

```bash
certbot certonly --webroot \
  -w /var/www/letsencrypt \
  -d erp.chipmunks.fun \
  --cert-name erp.chipmunks.fun
```

当前证书已配置完成，以下地址已验证可访问：

```text
https://erp.chipmunks.fun/CHANJET_CHECK.txt
https://erp.chipmunks.fun/api/erp/health
```

证书配置完成后，畅捷通后台填写：

```text
可信域名：erp.chipmunks.fun
OAuth回调地址：https://erp.chipmunks.fun/api/erp/auth/callback
消息接收地址：https://erp.chipmunks.fun/api/erp/messages
```
