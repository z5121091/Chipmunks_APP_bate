# ERP Token 自动续期

## 结论

- `openToken` 是短期令牌，当前按接口返回的 `expiresIn` 判断；接口未返回时按 6 天兜底。
- `refreshToken` 有效期为 29 天。每次调用新版刷新接口成功后，服务端必须同时保存返回的新 `openToken` 和新 `refreshToken`，29 天从本次成功刷新重新计算。
- 正式发布不会把 `openToken` 自动变成长效。长期稳定运行依赖服务端持续刷新 `refreshToken`。

## 当前实现

每个 ERP 账套实例都会执行以下保护：

1. 服务启动 3 秒后检查一次，此后默认每 60 分钟检查一次。
2. 距离 `openToken` 过期不足 24 小时，或当前令牌组已经使用 5 天时，自动调用 `/auth/v2/refreshToken`。
3. 每次业务请求发出前再次检查，避免服务器休眠或定时任务延迟造成过期。
4. 畅捷通明确返回 Token 过期或无效时，强制刷新后仅重试一次原请求。
5. 新旧令牌通过临时文件加原子重命名写入，并保留上一份状态备份。
6. 日志和健康接口只返回时间与状态，不返回 Token 内容。

## 双账套隔离

两套账使用同一份代码、两个进程和两份独立状态：

| 账套       | 实例                | 状态文件                                                   |
| ---------- | ------------------- | ---------------------------------------------------------- |
| 无锡笃能   | `wuxi-duneng`       | `<CHANJET_STATE_DIR>/wuxi-duneng/chanjet-state.json`       |
| 上海花栗鼠 | `shanghai-chipmunk` | `<CHANJET_STATE_DIR>/shanghai-chipmunk/chanjet-state.json` |

每个进程只使用自己的 AppKey、AppSecret、orgId、软证书和 `refreshToken`。不能复制另一个账套的状态文件来初始化。

## 环境变量

```dotenv
CHANJET_AUTO_REFRESH_ENABLED=true
CHANJET_AUTO_REFRESH_LEAD_HOURS=24
CHANJET_AUTO_REFRESH_MAX_AGE_HOURS=120
CHANJET_AUTO_REFRESH_CHECK_MINUTES=60
```

默认值已经适合正式环境。迁移服务器时，只需迁移每个账套自己的受保护环境文件和状态目录；前端及业务接口地址不需要因续期功能而修改。

## 健康检查

`GET /api/erp/health` 会增加以下非敏感字段：

- `tokenAutoRefreshEnabled`
- `tokenRefreshDueAt`
- `refreshTokenConfigured`
- `refreshTokenExpiresAt`
- `refreshTokenExpired`
- `lastTokenRefreshAttemptAt`
- `lastTokenRefreshSucceededAt`
- `lastTokenRefreshErrorAt`
- `lastTokenRefreshError`

如果 `refreshToken` 已经过期，只能重新授权一次。重新授权成功并取得新令牌后，自动续期会继续接管。

## 网关与账套实例

公网 `8080` 服务只作为 ERP 网关，必须设置 `CHANJET_PROXY_MODE=true`。它不启动
Token 定时器，也不保存或刷新业务 Token；带 `/api/v1/tplus-proxy` 前缀以及旧客户端
使用的直接 ERP 路径，都会转发到 `18081` 或 `18082` 的独立账套实例。

`erp-proxy.config.json` 的 `hostAccounts` 可将两个正式二级域名分别映射到
`wuxi-duneng` 和 `shanghai-chipmunk`。这样畅捷通消息与 OAuth 回调没有
`x-erp-account-key` 请求头时，仍可根据访问域名进入正确账套。
