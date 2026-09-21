# 解析规则编辑优化

## 本轮范围

- 样本扫描/粘贴、逐段字段映射、隐藏字符显示、具体失败原因。
- 分隔符候选推荐，需要人工确认；保留手动配置，不推测字段的业务含义。
- 条件支持 contains / equals / startsWith / endsWith，旧条件缺少 operator 时仍按 contains 执行。
- 规则内 ignore:N 字段无需创建全局占位字段，解析时不写入业务字段。
- 保存前读取最新启用规则：有样本时提示样本重叠，无样本时提示同分隔符与段数的潜在重叠。
- 有样本但本规则不匹配时不保存。重叠可人工确认继续保存，运行时仍按原有优先级/冲突逻辑选择。
- 样本仅保留在当前编辑会话，不持久化、不提交到 ERP。不调整版本，不构建 APK，不涉及后端部署。

## 文件

- client/utils/ruleConditions.ts
- client/utils/database.ts
- client/screens/rules/index.tsx
- client/screens/rules/styles.ts
- client/screens/rules/RuleSamplePanel.tsx
- client/screens/rules/RuleOptionPicker.tsx
- client/screens/rule-prefix-edit/index.tsx
- client/screens/help/index.tsx
- client/utils/__tests__/ruleEditor.test.ts
- client/utils/__tests__/batchStockDatabase.test.ts
- client/utils/__tests__/backupData.test.ts
- 本说明文件

## 验证

相关五组测试共48项通过，包含原规则回归、条件操作符、忽略段、推荐分隔符、SQLite持久化与配置备份恢复。
浏览器以360x800验证：样本输入、分隔符确认、逐段映射、自动补忽略段、条件菜单、保存回显、重叠确认、段数失败阻止保存。
未在真实PDA上验证硬件扫码输入。

## 边界

推荐仅为候选字符结构，不能证明分隔符在所有标签中都稳定；一张样本不等于覆盖所有标签。
本轮未加入倒序取字段，未调整前一轮审查提到的日期自动合并、空白分隔符尾部空字段和普通/包裹分隔符区分逻辑。
新条件和规则内忽略段需要本轮客户端代码；不能把新配置当作旧APK也已支持。
