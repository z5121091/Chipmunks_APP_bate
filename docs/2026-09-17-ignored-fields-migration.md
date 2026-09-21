# 占位字段统一为忽略此段

## 行为

- 移除设置中的独立占位字段入口，以及规则编辑中的全局占位字段选择区。
- 在扫码样本中为每段选择标准字段或“忽略此段”；未分配位置自动补为忽略段，也可直接添加忽略段。
- 旧规则中的 custom:ID 自动映射为规则内 ignore:N，保留位置、前缀、条件、启用状态、规则 ID 与时间戳。
- 兼容字段顺序内嵌 custom:ID，以及旧版 customFieldIds 单独记录末尾占位段这两种格式。
- 原生 SQLite 初始化时事务转换；读取规则、保存规则、恢复旧配置备份时也统一转换。重复初始化不会再次改变编号。
- 再次选择当前的“忽略此段”不会重建编号，也不会丢失其前缀配置。
- 忽略段参与段数、前缀和识别条件校验，内容不写入新的业务记录。识别条件仍检查去前缀之前的原始字段内容。
- 历史业务记录不改写。底层旧字段表保留以支持数据库结构兼容，但不再提供管理入口，新配置备份不再导出旧占位字段定义。
- 旧 /custom-fields 页面地址跳转至 /rules，避免旧链接成为无效页面。

## 本轮文件

新增：

- client/utils/legacyRuleFields.ts
- client/utils/__tests__/legacyRuleFields.test.ts
- docs/2026-09-17-ignored-fields-migration.md

修改（以当前工作区文件为准，包含之前尚未打包的改动）：

- client/utils/database.ts
- client/app/custom-fields.tsx
- client/screens/rules/index.tsx
- client/screens/rules/RuleSamplePanel.tsx
- client/screens/rule-prefix-edit/index.tsx
- client/screens/settings/index.tsx
- client/screens/help/index.tsx
- client/utils/__tests__/databaseRules.test.ts
- client/utils/__tests__/ruleEditor.test.ts
- client/utils/__tests__/batchStockDatabase.test.ts

删除（以后向扣子同步时也应删除）：

- client/screens/custom-fields/index.tsx
- client/screens/custom-fields/styles.ts

## 验证与边界

- 前端全套 Jest：25 组、221 项通过。
- 真实内存 SQLite 测试覆盖旧规则原位转换、重复初始化、迁移中断回滚、旧备份导入、前缀及条件保留、旧格式新增及更新。
- TypeScript 检查通过；本轮相关代码 ESLint --quiet 通过。
- 浏览器 360x800 检查了旧页面跳转、样本拆分、逐段字段选择、自动补忽略段、设置入口移除及布局。
- 未在真实 PDA 上测试；未构建 APK，未修改版本号，未改动或部署后端。
- 兼容方向为新客户端读取旧规则。旧 APK 不保证能读取新 ignore:N 格式的配置；应在升级后的客户端使用新备份。
