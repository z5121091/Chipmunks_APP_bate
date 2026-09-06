# 2026-09-05 审查修复结果

## 范围

对应 code-audit-2026-09-05.md 的 8 项问题，记录用户同意修复及中断续做后的本地状态。原审查报告保留为修复前证据。

本轮涉及 30 个代码/配置/测试路径（含删除 1 个文件），另有本说明 1 个文件。未打包扣子 ZIP、未构建 APK，未部署、重启或压测正式服务器。原有启动屏、连接复用、部署配置等未提交修改均保留。

## 修复明细

| 原审查项 | 本轮处理 | 验证 |
| --- | --- | --- |
| 1. 旧响应覆盖新缓存 | 同一查询只允许最新启动的请求写缓存；刷新进行中，普通读取等待刷新 | 假 ERP 测试覆盖旧请求先返回、后返回及刷新期间读取 |
| 2. 双层缓存延长有效期 | 移除代理缓存，统一由现有 ERP 服务管理；代理透传 X-Cache，不重算 TTL | 后端测试、类型检查、构建及代理转发代码复查 |
| 3. 备用地址重置超时 | 域名连接、备用地址及响应读取共用总截止时间；客户端断开可取消代理上游请求 | 测试覆盖备用地址、过期不回退、响应体中途超时 |
| 4. 长错误文字撑出屏幕 | 采购入库和库存查询错误文字允许收缩，保留完整诊断文本 | 小屏、桌面、深色预览均无横向溢出；实际查看截图 |
| 5. 规则编辑安全区重复 | 顶部只由 Screen 处理，表单独占滚动，底部保留安全区留白 | 两种小屏按钮可见，新增规则实际保存成功 |
| 6. 校验范围不完整 | lint 固定覆盖 app/components/screens/hooks/utils/contexts/constants；修复错误级诊断和相关 Hook 依赖 | 完整校验通过；仍有 106 条历史警告，见下文 |
| 7. 扫码提交重复维护 | 五个扫码/查询页面共用定时提交及取消函数；库存查询离页取消待提交任务 | 验证最新输入提交、回车取消延时、相同输入分次提交 |
| 8. 旧组件残留 | 删除未引用的 ScanWorkflowPanel、UiScanBox 和其私有样式；移除盘点旧仓库按钮样式 | 引用检索、类型检查、浏览器回归 |

额外修复：

- Web 模拟数据库的 AND/OR 嵌套条件会把同型号不同版本误判为重复绑定。现在按逻辑优先级递归判断并消费所有参数；新增测试覆盖大小写查询、不同版本、重复绑定及按仓库汇总数量。未修改手机 SQLite 建表、迁移或业务事务。
- 订单页移除没有实际复用效果的渲染 useCallback 包装及未使用状态，避免遗漏主题颜色依赖。编辑、删除、查询与拆包流程没有重写。

保留双账套共用物料绑定、同存货编码合并 ERP 行、原有扫码队列和拆包方式、占位字段不导出。没有新增连续相同扫码去重或语音合并逻辑。

## 验证结果

| 检查 | 最终结果 |
| --- | --- |
| pnpm --dir client run test:ci --silent | 15 个套件、51 项通过 |
| pnpm --dir server run test:ci | 13 项通过，无失败、跳过或取消 |
| pnpm -w lint:all | 通过，包含前后端 TypeScript；前端 0 错误、106 警告，后端无诊断 |
| pnpm --dir server run build | 通过 |
| git diff --check | 通过，只有仓库已有的 LF/CRLF 提示 |
| 隔离浏览器 | 库存盘点、扫码出库、采购入库、库存查询、解析规则、设置，共 24 个尺寸/主题组合无横向溢出 |
| 规则编辑弹窗 | 320x568、360x640 均实际新增并保存成功 |

页面尺寸为 320x568、360x640、1280x800 浅色，以及 360x640 深色。ERP 网络请求在独立浏览器中被拦截；测试数据仅存在于测试进程或独立浏览器内存，未写入公司 ERP。

## 仍保留的事项

- ESLint 106 条警告未清零，其中 database.ts 的 88 条是历史 any 类型。其余主要是未使用变量和外围模块类型；没有关闭全局检查隐藏诊断。校验覆盖缺口已修复，类型完善仍是后续工作。
- 未连接实际 PDA：Android 键盘、安全区、大字体与扫码枪连续录入仍需真机回归。Web 截图不能替代。
- 未做正式 ERP、NAS、打印机端到端验证或真实业务压测；本地并发耗时不能代表正式 ERP 首次查询延迟。
- 本轮尚未发布到正式服务器和扣子。页面改动需要重新构建 APK 后在实机生效，后端改动需要后续部署。

## 本轮路径清单

仅表示本轮修复范围，不是整个工作区未提交修改清单。后续若与前几轮合包，须合入那些轮次的依赖文件并使用最新版本。

```text
DELETE client/components/ScanWorkflowPanel.tsx
MODIFY client/components/UiRedesign.tsx
MODIFY client/package.json
MODIFY client/screens/custom-fields/index.tsx
MODIFY client/screens/inbound/index.tsx
MODIFY client/screens/inventory/index.tsx
MODIFY client/screens/inventory/styles.ts
MODIFY client/screens/orders/index.tsx
MODIFY client/screens/outbound-order-rules/index.tsx
MODIFY client/screens/outbound/index.tsx
MODIFY client/screens/purchase-receive/index.tsx
MODIFY client/screens/purchase-receive/styles.ts
MODIFY client/screens/rules/index.tsx
MODIFY client/screens/stock-query/index.tsx
MODIFY client/screens/stock-query/styles.ts
MODIFY client/screens/warehouse-management/index.tsx
MODIFY client/utils/__tests__/scannerInput.test.ts
ADD    client/utils/__tests__/databaseQueries.test.ts
MODIFY client/utils/backupNaming.ts
MODIFY client/utils/database.ts
MODIFY client/utils/excelSchema.ts
MODIFY client/utils/heartbeat.ts
MODIFY client/utils/quantity.ts
MODIFY client/utils/scannerInput.ts
MODIFY client/utils/update.ts
MODIFY server/src/erp.ts
MODIFY server/src/index.ts
ADD    server/src/erpProxy.ts
MODIFY server/src/__tests__/erpHttp.test.ts
ADD    server/src/__tests__/erpProxy.test.ts
```

普通覆盖 ZIP 不会删除旧文件。后续交付扣子时，须明确删除 client/components/ScanWorkflowPanel.tsx，其余路径按最新文件覆盖。
