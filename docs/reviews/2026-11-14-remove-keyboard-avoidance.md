# 取消键盘自动避让与缩窗

## 本轮范围

用户以仓库档案新增仓库弹窗为例，要求清理全部“键盘弹出后抬升输入框、自动滚动到焦点、压缩窗口”的旧逻辑。此约定替代此前保留键盘避让的要求；普通手动滚动、扫码自动聚焦、主动收起键盘和真实窗口尺寸适配继续保留。

工作区已有多轮未提交 UI 修改。本记录只说明这一轮键盘策略清理，不将 Git diff 中全部响应式、供应商维护或滚动嵌套修改算作本轮新增。

## 代码改动

- `client/components/Screen.tsx`：整页自动包装使用普通 ScrollView；保留对垂直列表、横向例外和 Modal 边界的识别。页面已有滚动区时不再替换为 KeyboardAware 组件，不加入焦点滚动或键盘额外偏移。安全区与默认手动拖动/点击行为保留。
- `client/components/AppModalViewport.tsx`：KeyboardAvoidingView 改普通 View，只测量真实窗口 padding 内的高度。AppModalCard 的真实短窗口限高、固定操作区与正文独立滚动继续有效。
- 删除 `client/components/KeyboardAwareForm.tsx`；移除 `client/package.json` 与 `pnpm-lock.yaml` 中对应依赖及其独占的 iphone-x-helper 依赖项。无其它依赖版本升级。
- 仓库档案、设置、设置工具、物料绑定/供应商、解析规则、前缀编辑、出库单号规则、出库、盘点、退货备注中的旧包装换成普通 ScrollView/FlatList。移除 bottomOffset/extraHeight/extraScrollHeight，保留正文高度链、表单状态、提交回调和手动滚动。
- 标签补打的修改数量、打印任务、新建内部标签三个弹窗移除 KeyboardAvoidingView；扫码 onShow/自动焦点、前后台焦点切换、手动输入开关和查询/打印逻辑保留。
- 产品 app/components/screens/hooks 源码检查已无 KeyboardAware/KeyboardAvoidingView、自动焦点滚动或键盘显示事件驱动的避让逻辑。历史测试夹具仍包含旧组件名称用于防回归；未使用的第三方 heroui 文档示例不是应用中的避让路径。

## Android 原生层

仅删除 JavaScript 避让不足以解决压缩：MainActivity 原本使用 adjustResize；当前 RN 0.86.3 的 Modal 在创建 Dialog 时也设置 ADJUST_RESIZE。

- MainActivity 的 manifest 改 adjustNothing，onCreate 后显式应用同一策略。
- 新增 `WarehouseKeyboardPolicy.kt`，使用 RN 公开 ExtraWindowEventListener 在 Modal 创建后改为 ADJUST_NOTHING；只替换 ADJUST 掩码，保留输入法 STATE 标志。单例不持有 Activity/Window/旧 Context；弱 Host 集合防重复注册，已存在及重建的 ReactContext 都会接入。
- `withWarehouseKeyboard.js` 通过现有 `withWarehouseAndroid` 插件接入，持久化 manifest、MainActivity、MainApplication 和 Kotlin 模板，重复 prebuild 不重复插入。不修改 RN 依赖源码或加入补丁。
- 原生指纹覆盖 Android、plugins、package.json 与锁文件。完整策略须重新构建并安装 APK；只发布 JavaScript 热更新无法改变旧 APK 的原生窗口策略。本轮没有构建或发布，也没有写入新的 OTA 基线。

## 验证范围

保留真实组件层级的 Screen、AppModalCard、仓库编辑、出库单号/前缀编辑、标签补打等回归；保留滚动责任检查，并增加产品源码禁止重新引入自动避让的护栏。专项原生检查调用真实 Expo mods，校验生成一致性、幂等、STATE 位保留、原生备份调度未丢失和 RN 公开事件接口。

Kotlin 策略已使用实际 RN 0.86.3 release AAR、Android 36 SDK 与本机 Kotlin 2.2 编译器独立编译通过，没有构建 APK。

最终检查结果：

- 共享容器、仓库/规则编辑与滚动护栏专项：5 套、34 项通过。
- 标签补打专项：36 项通过；设置工具旧测试夹具改用原生 ScrollView 后，该套 10 项通过。
- 客户端最终完整复跑：115 套、1588 项全部通过，退出码 0。首轮发现的旧测试组件名引用已修正，未放宽业务断言。
- 全量 TypeScript、ESLint 通过；最后一处测试夹具修改的单文件 ESLint 也通过。
- Android 键盘策略 6 项、自动备份 22 项通过；Android 启动资源及配置检查通过。新增 Kotlin 策略独立编译通过。
- 冻结锁文件离线一致性检查通过；锁文件仅删除 23 行旧依赖记录，无其它依赖升级；`git diff --check` 通过。
- 额外只读交叉审查未发现新的确证遗漏；保留的返回顶部和拖动排序滚动与键盘无关。

组件测试及模拟窗口测量不代表真机输入法验收；待新 APK 安装后，在 PDA 检查仓库编辑、长表单、多供应商列表、内部标签扫码焦点及键盘开关时的窗口位置。本轮没有构建 APK/EXE、发布热更新、提交或推送 Git。
