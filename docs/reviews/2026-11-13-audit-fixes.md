# 2026-11-13 审查问题修复记录

项目：`D:\Chipmunks_APP`。起点：`8b912ac`。修复前产品源码工作区干净，只有此前审查记录未跟踪；以下产品和测试差异均为本轮修改。用户授权按审查结果修复并保存固定 UI 约束。

## 1. 盘点供应商校验

`client/screens/inventory/index.tsx` 在解析规则、取得存货编码后执行 `assertRuleSupplierForScan`，通过后才继续写入草稿。校验 await 后再次检查会话，离开或切换后的旧结果不能继续写入。明确关联的供应商冲突或关联失效会被拒绝；未关联规则、未知物料供应商的兼容边界保持不变。HLS 内部标签仍走独立登记验证。

`client/screens/inventory/__tests__/draftPersistence.test.tsx` 补充一致、未知、未关联、不符、失效和迟到响应回归。与 helper 用例合计 33 项针对检查通过。没有扩大只读库存查询的供应商拦截范围。

## 2. 弹窗高度和极短窗口

- `client/components/AppModalViewport.tsx`：提供键盘避让后、外层 padding 内实测可用高度；物料绑定编辑、数据工具、供应商弹窗接入。
- `client/constants/modal.ts`：预设尺寸以可用高度封顶，保留调用方更严格的数字/百分比上限；窄窗口不再被旧的 260 dp 最小宽度撑出屏幕。
- `client/components/AppModalCard.tsx`：预设最小高度不再突破可用区域。正常高度下保持标题、正文、底栏布局；实际标题和底栏加最低正文空间超过卡片高度时，允许整卡滚动到操作区。始终使用同一棵 ScrollView 子树，避免键盘缩高时输入框重新挂载。auto 模式保留调用方 height，用 maxHeight 限制实际范围。
- `client/screens/inventory-binding/index.tsx`、`SupplierManager.tsx`：仅调整弹窗外层与响应式样式，不改保存、导入和供应商 CRUD 逻辑。
- 新增 `client/components/__tests__/AppModalCard.test.tsx`：11 项组件契约覆盖预设、auto、短窗口、实测高度、输入实例保持及 compact 实际高度判断；补打旧测试按新增外层滚动保护更新，保留任务正文与底栏分离的检查。

这里的 onLayout 测试是约束验证，没有声称运行真实 Yoga 排版或目标 PDA 键盘验收。

## 3. 响应式样式缓存

- `client/hooks/useResponsiveStyles.ts`：统一订阅 width、height、density、fontScale，输入不变时保留样式引用；不把尺寸变化混入颜色 theme 身份或业务会话。
- `client/constants/theme.ts`：响应式 tokens 读取当前宽度/密度，不再永久缓存首次值；`AppComponentTokens.typography` 延迟读取，防止嵌套字体再次冻结。
- `client/constants/uiRedesign.ts`：radius、border、spacing 按属性读取动态 token。
- `client/utils/responsive.ts`：新增宽度驱动、有上限的 `scaleControlSize`。rf 的设备档位也只按宽度，键盘降低窗口高度不再改变全局字号。几何计算用的 rs/wp/hp 不变。
- `client/screens/settings/styles.ts`：去掉相互遮盖的两层缓存，只保留覆盖主题、传入/真实尺寸、密度与安全区的最终缓存；相同输入仍复用对象。`settings/index.tsx` 的 memo 加入密度依赖。
- `orders/styles.ts`、`inventory-binding/styles.ts`：接收 Hook 提供的窗口尺寸，compact 布局随窗口更新。

以下页面原先只按 theme 缓存的样式接入共用 Hook：出库、入库、盘点（含数量弹窗）、出库订单、入库记录、盘点记录、库存查询、物料绑定、供应商管理、标签补打、解析规则、规则列表行、规则诊断、采购收货、单据管理、使用说明、隐私政策。

以下共用组件/独立页面同时去掉模块加载时冻结的样式快照：UiRedesign、AppPillToast、WarehouseGuide、WarehouseScanInput、SyncPairingCamera、RuleSamplePanel、SettingsTools（含文件末尾独立 ActionButton）。没有修改扫码提交、队列、相机判区、动画或页面会话代码。

新增 `hooks/__tests__/useResponsiveStyles.test.tsx` 与 `utils/__tests__/responsiveTokens.test.ts`，使用真实 Dimensions 事件和真实页面样式，验证窄宽往返、键盘同宽缩高、密度/主题/安全区、样式引用稳定及嵌套 tokens。

## 4. 固定宽度容器里的按钮

- UiToolbarButton 默认水平 padding 封顶 16 dp；主题间距缩放封顶 1.15，设置页明确属于图标/控件的旧 rs 调用也改用控制尺寸缩放。
- `client/screens/label-reprint/InternalLabelForm.tsx` 与 `styles.ts`：出现“确认另建并打印”长动作或系统字体大于 1.15 时，底栏动作各占一行，外层不再使用同行 flex: 1；普通按钮和“移除”的既有尺寸契约保留。
- `uiPrimitives.test.tsx` 覆盖从 320 到 1024 再返回时按钮 padding 上限及外层宽度契约。补打页覆盖长文案与 1.3 字体下底栏布局，不靠增加卡片宽度来补。

## 5. Jest 收尾异常

`client/jest.setup.cjs` 在测试环境仍完整时解析 Expo 安装的 lazy fetch getter，仅读取函数，不发请求。Jest 29 原先在清空 module/mock registry 后枚举 global 属性，首次解析 getter 会加载原生 logger，进而产生 tests done 后的警告。不是已确认的 OTA 产品异步错误。

新增 `client/utils/__tests__/jestEnvironment.test.ts` 验证 getter 已解析，resetModules 后枚举全局属性不会再次加载原生 fetch 或警告。未采用 forceExit、忽略退出码或屏蔽日志。

## 6. 固定约束和验证记录

- `AGENTS.md` 加入必读入口，具体规则放在 `docs/development/ui-change-checklist.md`。按用户要求另保存可检索的本机记忆注记，指向这份项目清单。
- 针对检查已覆盖供应商守卫、供应商/物料绑定、补打、扫码输入、相机、规则样本、设置诊断/连接、tokens 和弹窗；失败用例先定位并修复后复跑。
- 首轮全量在极短弹窗滚动层引入后发现补打旧结构断言 3 项失败，已更新为区分保护层和任务列表。最终全量结果在运行结束后补记，不把首轮失败描述为通过。
- 最终客户端完整 Jest：109/109 套、1543/1543 项通过，实际退出码 0（407.552 秒）；没有 FAIL、Cannot log after tests are done 或 ExpoModulesCoreJSLogger 收尾异常。原有普通 ExponentConstants 环境警告未被屏蔽。
- 最终客户端全量 TypeScript：退出码 0，无诊断输出。
- 最终客户端全量 ESLint：退出码 0，无错误、无警告输出；`git diff --check`：退出码 0。设置页密度依赖由样式工厂间接读取，已在对应 Hook 依赖处解释其用途。

日志位于 `%TEMP%\chipmunks-code-audit-20261113`。此前审查阶段已完成 Python 396 项、后端 21 项、Android 及构建环境隔离检查；本轮没有改动这些模块，不重复构建或扩大测试范围。

本轮没有编译 APK/EXE、发布热更新、修改生产服务或提交/推送 Git。上次启动本地 Web 前端预览被自动审批拒绝且未提供详细理由，本轮没有绕过；没有可用前端预览，因此不声称完成实际 Web 页面截图和 PDA 验收。目标设备上仍需确认键盘避让、极短窗口滚动及大字体显示；自动化约束通过不能替代这些实测。
