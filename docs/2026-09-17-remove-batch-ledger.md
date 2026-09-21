# 移除本地批次库存功能

## 范围

按用户最新要求，停止修补外箱与内盒追溯码不同导致的批次扣减问题，完整移除独立的本地批次库存功能。

- 库存查询仅展示 ERP 现存量，不再查询或展示已登记批次、批次余量。
- 移除入库登记、盘点累计、出库扣减、拆包追溯码余额转移及撤销时恢复余额的本地流水逻辑。
- 新数据库不再创建该流水表。旧数据库初始化时仅删除“批次库存流水”和旧英文名 batch_stock_events 两个独立派生表；重复初始化安全。
- 原入库、出库、盘点、拆包单据及其批次、生产日期、追溯码字段保留。解析、打印、Excel 导出仍使用这些字段。
- 保留原业务去重、事务保存、拆包剩余标签生成及已有后续出库时禁止删除原拆包的保护。
- NAS 自动备份继续依据出库单、出库明细、入库记录、盘点记录、拆包记录判断是否有业务数据。
- 更新 APP 使用说明，移除旧批次库存说明。

用户提供的 Downloads 数据库仅以只读方式检查，没有改写；表清理将在运行新版应用初始化数据库时执行。没有修改 ERP 数据、后端代码或部署服务器。

## 同步扣子时需要删除的旧文件

仅覆盖新增文件不会删除旧文件，后续同步代码时应删除：

- client/utils/batchStock.ts
- client/components/BatchStockTable.tsx
- client/utils/__tests__/batchStock.test.ts
- client/utils/__tests__/batchStockDatabase.test.ts

最后一个文件内仍有价值的 SQLite 规则迁移、规则保存、拆包删除重扫测试已保留并迁入 client/utils/__tests__/databasePersistence.test.ts，而非全部删掉。

## 修改文件

- client/utils/database.ts
- client/screens/stock-query/index.tsx
- client/screens/help/index.tsx
- client/plugins/AutoDatabaseBackupWorker.kt
- client/android/app/src/main/java/com/chipmunks/traceability/AutoDatabaseBackupWorker.kt
- client/scripts/check-android-backup.cjs
- client/utils/__tests__/backupData.test.ts
- client/screens/inbound/__tests__/inbound.test.tsx
- client/utils/__tests__/databasePersistence.test.ts（新增，接替旧 SQLite 集成测试）

同轮保留规则名称必填提示修复：

- client/screens/rules/index.tsx
- client/screens/rules/styles.ts
- client/screens/rules/__tests__/RulesScreen.test.tsx

## 验证

- 前端完整 Jest：26 组、204 项全部通过。
- NAS 原生备份检查：10 项全部通过，确认原生文件与 Expo 模板行为一致。
- 前端 TypeScript 检查通过；本轮页面、组件测试及新 SQLite 集成测试 ESLint 检查通过。
- Git diff 空白检查通过。未以清理历史 database.ts lint 问题为目的进行无关重构。
- SQLite 测试验证清理两个旧流水表后，原有入库、出库行逐字段保持不变；外箱入库/内盒出库、修改数量、盘点及删除操作不再依赖本地批次余额。
- 浏览器验证规则名称为空时显示就地红色必填提示并聚焦，填写名称后提示消失。
- 中断前首次单项 UI 测试曾在 beforeEach 超时；随后完整测试中同一测试通过，未通过放宽超时掩盖问题。
- 未进行 PDA 真机验证，未修改版本号、未构建 APK。
