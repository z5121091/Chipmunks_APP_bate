# 同方向滚动嵌套专项检查

日期：2026-11-14。项目：`D:\Chipmunks_APP`。

用户要求检查是否还有“内部纵向列表外面又嵌套整卡纵向滚动”的情况。本轮只读检查产品源码，未修改产品代码／测试，未编译、发布或提交推送。工作区保留此前修复的未提交修改，本报告不是新的产品补丁。

后续用户已确认逐类修复，实施结果另见 [14 项修复记录](2026-11-14-scroll-nesting-fixes.md)。本文保留检查时的结构证据，不是当前未解决清单。

## 范围和结论

- 对 `client/app`、`client/components`、`client/screens` 下 92 个非测试 TSX 文件做 JSX 结构检索，清点到 18 个 AppModalCard 调用点、56 个滚动组件节点，再人工追踪共用包装和样式约束。
- 发现默认 AppModalCard 内另有纵向滚动正文的 **11 个调用点**；已修的两个供应商组件使用 body 模式，不在这 11 个中。
- 另确认 **2 个 Screen 自动包装形成的双层表单滚动**，以及 **1 个仓库表单的双层整卡条件风险**。
- 合计 14 个结构／条件检查点，不能把它们说成 14 个已经在 PDA 复现的故障。只有此前用户报告的供应商两页属于真实拖动反馈；本报告其余项目是源码与高度约束证据。

## 共用原因

`client/components/AppModalCard.tsx:37` 的默认模式仍为 card。`:81`、`:112` 的默认分支用外层纵向 ScrollView；其内容容器仅 flexGrow:1，普通窗口又禁止整卡滚动。卡片自身有 height/maxHeight，并不等于 ScrollView 内容里的内部列表获得了有限视口。当前供应商两页已经显式使用 body 模式，内部列表没有这层滚动祖先。

`client/components/Screen.tsx:141` 只识别原生 ScrollView、FlatList、SectionList。若页面内部用自定义 KeyboardAwareFormScrollView，却没有 disableAutoScroll，`:183`、`:187` 会再加一层 KeyboardAwareScrollView。

## 应优先处理的 6 个调用点

| 入口 | 调用点与内部滚动 | 约束与判断 |
|---|---|---|
| 设置 → 恢复前作业副本 | `settings/index.tsx:1660`；FlatList `:1668` | largeForm/stretchBody 默认 card，列表没有独立有限高度。是与供应商故障最接近的数据列表 |
| 标签补打 → 打印任务 | `label-reprint/index.tsx:697`；ScrollView `:700` | 卡片有 taskModalHeight，但内部 taskScroll 仅 flex:1/minHeight:0；任务多时风险直接 |
| 标签补打 → 新建内部标签 | `label-reprint/InternalLabelForm.tsx:127`；ScrollView `:136` | 卡片高度和键盘视口已测量，但未移除内外双滚；按包分配行增长、长规格和键盘场景需处理 |
| 标签补打 → 修改标签数量 | `label-reprint/index.tsx:651`；ScrollView `:661` | correctionModalHeight 仅限制卡片；内部同为 taskScroll，长字段／说明／错误增加时风险 |
| 物料绑定 → 新增／编辑 | `inventory-binding/index.tsx:800`；KeyboardAwareFormScrollView `:819` | largeForm 内 bindingFormScroll 只有 flex/minHeight；可动态增加的版本行使正文增长 |
| 扫码出库 → 拆包出库 | `outbound/index.tsx:3843`；KeyboardAwareFormScrollView `:3862` | 外卡 maxHeight:84%，内部无独立有限视口；长规格和包装信息场景有同源风险 |

这些调用应让内部正文独立滚动，并保证有限高度链。表单仍应保留需要的键盘避让，不能把所有正文机械替换成 FlatList。

## 另外 5 个默认卡片内的条件项

| 入口 | 位置 | 条件与区别 |
|---|---|---|
| 扫码出库 → 历史扫码待核对 | `outbound/index.tsx:3724` / ScrollView `:3726` | 内部 maxHeight360，常见窗口可能可用；小窗口的真正正文区可能不足360 |
| 扫码出库 → 拆包标签任务 | `outbound/index.tsx:3766` / ScrollView `:3768` | 同样 maxHeight360，不保证小于卡片扣除标题后的可用正文 |
| 设置 → 发现新版本／更新内容 | `settings/index.tsx:1686` / KeyboardAwareFormScrollView `:1720` | 内部有 updateModalBody.maxHeight，当前调用不传 insets、默认525；长更新日志或短窗口时与实际正文空间不一致 |
| 出库记录详情 → 补充退货备注 | `detail/index.tsx:528` / KeyboardAwareFormScrollView `:534` | 普通短备注未必异常；多行备注、长错误和大字体时需核验 |
| 库存盘点 → 完成盘点确认 | `inventory/index.tsx:1700` / KeyboardAwareFormScrollView `:1708` | 只有两段固定说明，没有增长列表，优先级最低；大字体／特别短窗口另验 |

360、525 等 maxHeight 是内部上限，不代表这个上限一定小于当前弹窗剩余高度；因此不能判定它们完全安全，也不能宣称普通窗口已经卡死。

## 另外 3 个包装问题

| 入口 | 位置 | 判断／建议 |
|---|---|---|
| 出库单号规则 → 编辑订单号样例 | `outbound-order-rules/index.tsx:328` Screen → `:342` KeyboardAwareFormScrollView | 未设置 disableAutoScroll，Screen 不识别自定义滚动，自动增加外层。编辑分支可显式关闭自动包裹 |
| 解析规则 → 编辑字段前缀 | `rule-prefix-edit/index.tsx:379` Screen → `:389` KeyboardAwareFormScrollView | 与上项相同。全屏原生 Modal 边界不消除 Modal 内 Screen 的自动双层包装 |
| 仓库档案 → 新增／编辑仓库 | `warehouse-management/index.tsx:327` KeyboardAwareModalContainer → `:328` AppModalCard | 前者在 KeyboardAwareForm.tsx:113 有整卡 ScrollView，后者默认再有一层；正文无第三层滚动。普通 auto 短表单未必故障；键盘／短窗口令内部 cramped 启滚时会有两层竞争 |

两个 Screen 问题的两层滚动都启用，不同于供应商外层禁滚的表现；更可能涉及长表单和键盘滚动交接，尚未实机复现。

## 已排除的正常结构

- 修复后的 SupplierManager 和 UnassignedSupplierBindings：显式 body 模式，有限高度 View 贯通，内部列表独立滚动。
- CustomAlert：仅消息区域一层 ScrollView，父级是 View/MotionSurface；长消息按视口有96–180dp上限。
- RuleOptionPicker：Screen 显式 disableAutoScroll，普通父 View/MotionContent flex:1，只有内部一层滚动。
- 主要出入库、盘点、库存查询、出库订单和记录页面：原生列表可被 Screen 识别，没有再加整页滚动。记录页和订单页仓库／账套选择器是主列表旁的浮层，并非主列表内部的第二个纵向列表。
- 设置、设置工具、解析规则主页面／编辑、使用说明、工作台、单据管理等已显式 disableAutoScroll 的路径。
- 记录详情、更新日志主页面：单原生 ScrollView 被 Screen 正确识别。
- 修改实盘数量、物料绑定数据工具、重启提示、热更新准备提示等卡片：正文没有第二个滚动容器，不因使用 AppModalCard 就算同类。
- WarehouseGuide、AppMotion、MainTabScene 等没有额外纵向滚动包装；未使用库里的 Select／BottomSheet 不算当前产品路径。

## 修复优先次序与验证边界

优先两个数据列表，再处理四个可增长表单；同时可以独立解决两个 Screen 自动包装。剩余条件项按小屏、大字体、长文本及键盘场景逐项验证，而不是全局机械取消所有滚动。

后续若获授权修复，应保留真实卡片和真实列表层级测试；需核对第一项到最后一项、标题与操作区、键盘弹出/收起、长内容及返回。源码审查不替代 PDA 实际拖动，本轮没有运行组件测试或声称复现上述未报告入口。
