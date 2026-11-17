# 同方向滚动嵌套：14 个检查点的修复

日期：2026-11-14。项目：`D:\Chipmunks_APP`。根据用户确认的分类方案实施，保留原有 UI 风格与业务行为。

## 范围与工作区基线

本轮开始时 HEAD 为 `8b912ac`，工作区已经包含此前 UI 审查、供应商分配及其滚动修复的未提交内容。下表记录本轮新增变化，不能把当前整个 Git diff 都视为本轮修改。没有部署、打印、编译 APK/EXE、发布热更新或提交推送 Git。

## 14 项处理结果

| 检查点 | 本轮处理 |
|---|---|
| 设置：恢复前作业副本 | 原生 FlatList 单独负责正文滚动；Viewport 测量实际可用高度，Card 使用 body 模式；选择、恢复锁定及回调不变 |
| 标签补打：打印任务 | 保留原任务弹窗显式高度，去掉外层同方向滚动，只有任务 ScrollView 滚动，关闭按钮在正文外 |
| 新建内部标签 | 原有 KAV、视口测量、按包分配和 scanner 焦点保留，正文独立滚动 |
| 修改标签数量 | 同上，保留原数量校验和确认，键盘缩高时输入实例和值不重挂载 |
| 新增／编辑物料绑定 | 现有 largeForm 与单层键盘表单正文，动态版本行不再处于整卡 ScrollView 内容里 |
| 扫码出库：拆包出库 | Viewport → 有限高度 Card → 单层 KeyboardAwareFormScrollView；原84%卡片上限、数量／标签与保存回调保留 |
| 编辑订单号样例 | 仅编辑分支 Screen 显式 disableAutoScroll，内部键盘表单滚动获 flex:1/minHeight:0，列表分支不改 |
| 编辑字段前缀 | 同上，保留全屏 Modal、前缀保存和返回逻辑 |
| 历史扫码待核对 | Card body 模式提供有限高度；内部任务 ScrollView 独立滚动，去掉作为视口的 maxHeight360 |
| 拆包标签任务 | 与上项相同，重试、回执和出纸确认逻辑不变 |
| 设置：发现新版本／更新内容 | 唯一 ScrollView 获正文实际高度，不再以旧525作为视口；下载中按钮、关闭限制和进度行为保留 |
| 出库记录详情：补充退货备注 | 单层键盘表单正文，Card/Viewport 负责限高与外层键盘变化，长备注和错误可滚动 |
| 库存盘点：完成盘点确认 | 两段说明采用单层有界正文，确认按钮留在正文外，盘点保存逻辑不变 |
| 新增／编辑仓库 | 去掉 KeyboardAwareModalContainer 整卡 ScrollView；Viewport + 紧凑 form/body Card + 唯一键盘正文，保存／取消在正文外 |

## 共用策略与清理

- `AppModalCard` 的默认 card 模式没有全局替换。实际有自身滚动的正文才显式使用 body 模式；滚动所有权不随键盘状态切换，避免重挂载输入。
- list + body 预设现在提供明确高度，而非只有 maxHeight。出库的两个短列表使用内容实测高度，内容少时紧凑，内容多时在卡片上限内滚动；原360仅保留为首选内容高度上限，不再当作真实可视区高度。
- 设置两个对话框的无状态 JSX 提取到 `SettingsDialogs.tsx`，父页面仍掌握原可见条件、状态与业务回调，便于真实组件层级测试。
- 清理无产品消费者的旧 `calculateUpdateModalBodyMaxHeight`、updateModalBody 样式、样式工厂 insets 参数及相应缓存字段。主题、窗口、密度缓存仍保留。
- 仓库换用 Viewport 后，移除已无调用的 `KeyboardAwareModalContainer` 导出、类型和样式；共用模块仍保留单层 KeyboardAwareFormScrollView/FlatList。

## 主要文件映射

| 文件／目录 | 本轮职责 |
|---|---|
| `components/AppModalCard.tsx`、对应组件测试 | list/body 有限高度及短列表紧凑测量 |
| `components/KeyboardAwareForm.tsx` | 删除废弃的整卡键盘滚动包装 |
| `screens/settings/index.tsx`、`styles.ts`、新 `SettingsDialogs.tsx` 与新对话框测试 | 副本列表、更新正文及旧高度策略清理 |
| `screens/label-reprint/index.tsx`、`InternalLabelForm.tsx` 与页面测试 | 3 个标签窗口滚动及焦点回归 |
| `screens/outbound/index.tsx`、`styles.ts` | 历史核对、标签任务、拆包3个窗口 |
| `screens/inventory-binding/index.tsx` | 动态版本编辑表单 |
| `screens/detail/index.tsx`、`screens/inventory/index.tsx` | 备注及完成盘点确认 |
| `screens/outbound-order-rules`、`screens/rule-prefix-edit`、`screens/warehouse-management` 与新滚动测试 | 两个 Screen 编辑分支与仓库表单 |
| `utils/__tests__/responsiveTokens.test.ts` | 不再测试废弃525高度，改验当前正文样式和缓存 |
| 新 `utils/__tests__/scrollOwnershipArchitecture.test.ts` | 源码结构检查护栏 |

## 验证与未来检查点

每类先做针对性验证再进入下一类，覆盖任务0/3/8条、12份副本、12包动态分配行、长规格／长更新日志、320/360/768dp、大字体、键盘缩高、输入实例与保存回调。根代理的共用卡片＋出库完整套157项、物料绑定／备注／盘点65项等针对回归均已通过，完整检查结果见下表。

自动结构护栏使用 TypeScript AST 检查真实产品调用点：含自身纵向滚动的 AppModalCard 必须声明 body 模式；Screen 内自定义表单滚动没有原生滚动所有者时必须关闭自动外包裹。识别导入别名、尊重 Modal 边界、排除横向；6组正反夹具与1个全项目检查通过，没有加忽略名单绕过现有调用。

结构检查不能解析任意自定义组件的全部运行时行为，也不能代替 PDA 物理滑动。真实 Card／Screen 层级测试保留，未把 mock 后的点击或内容数组当作实际滑动成功。

## 最终验证

| 检查 | 最终结果 |
|---|---|
| 客户端完整 Jest | 115/115 套、1584/1584 项通过，实际退出码0；286.159秒 |
| 客户端全量 TypeScript | 退出码0，无诊断输出 |
| 客户端全量 ESLint | 退出码0，无错误或警告输出 |
| git diff --check | 退出码0 |
| 滚动结构护栏 | 7项通过，当前产品扫描无此类已定义违规模式，没有忽略名单 |

完整测试包含此前供应商两页的滚动、分配与返回回归，以及出入库、盘点、记录、打印任务和更新等现有测试。普通 ExpoConstants 测试环境提示仍保留，没有过滤日志或使用forceExit掩盖失败。

日志：`%TEMP%\scroll-all-client-jest-final.log`、`scroll-all-client-tsc-final.log`、`scroll-all-client-lint-final.log`，针对性检查日志见同目录 `scroll-*` 文件。

当前没有实际 Web 前端预览或目标 PDA 拖动证据；此前启动本地 Web 前端被自动审批拒绝，本轮没有绕过。键盘 IME、极短屏和大字体的触摸手感仍需目标设备确认。所有14个检查点的产品修复与自动化检查均已完成，没有用设备验证缺口代替未完成的代码工作。
