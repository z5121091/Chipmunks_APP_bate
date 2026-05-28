/**
 * 统一字符串资源 - 模拟 Android @string
 * 所有页面文字必须从此处引用，禁止硬编码
 */

// ============================================
// 首页模块
// ============================================
export const Str = {
  // 底部 Tab
  tabHome: '首页',
  tabDiscover: '发现',
  tabProfile: '我的',

  // 首页模块名称
  moduleInbound: '扫码入库',
  moduleOutbound: '扫码出库',
  moduleOrders: '出库订单',
  moduleDocuments: '单据管理',
  moduleInventory: '库存盘点',
  moduleMaterials: '物料绑定',
  moduleSettings: '设置',

  // ============================================
  // 通用按钮与操作
  // ============================================
  btnConfirm: '确认',
  btnCancel: '取消',
  btnSave: '保存',
  btnDelete: '删除',
  btnEdit: '编辑',
  btnAdd: '添加',
  btnSubmit: '提交',
  btnClear: '清空',
  btnReset: '重置',
  btnPrint: '打印',
  btnExport: '导出',
  btnImport: '导入',
  btnClose: '关闭',
  btnSearch: '搜索',
  btnFilter: '筛选',
  btnRefresh: '刷新',
  btnRetry: '重试',

  // ============================================
  // 状态与提示
  // ============================================
  statusSuccess: '操作成功',
  statusError: '操作失败',
  statusLoading: '加载中...',
  statusEmpty: '暂无数据',
  statusPending: '待处理',
  statusCompleted: '已完成',
  statusFailed: '已失败',

  // Toast 提示
  toastScanSuccess: '扫码成功',
  toastScanFailed: '扫码失败',
  toastClearSuccess: '已清空',
  toastSaveSuccess: '保存成功',
  toastSaveFailed: '保存失败',
  toastDeleteSuccess: '删除成功',
  toastDeleteFailed: '删除失败',
  toastSubmitSuccess: '提交成功',
  toastNoData: '暂无数据',
  toastMaxQuantity: '超出最大数量',
  toastInvalidFormat: '格式不正确',

  // ============================================
  // 表单相关
  // ============================================
  placeholderScan: '扫描物料二维码',
  placeholderSearch: '搜索...',
  placeholderSelect: '请选择',
  placeholderInput: '请输入',
  labelWarehouse: '仓库',
  labelSupplier: '供应商',
  labelSelectWarehouse: '选择仓库',
  labelSelectSupplier: '选择供应商',
  labelBatch: '批次',
  labelQuantity: '数量',
  labelOrderNo: '订单号',
  labelModelNo: '型号',
  labelCustomer: '客户',
  labelRemarks: '备注',
  labelDate: '日期',
  labelTime: '时间',

  // ============================================
  // 入库模块
  // ============================================
  inboundTitle: '扫码入库',
  inboundScanned: '已扫描',
  inboundTotal: '共',
  inboundRecords: '条',
  inboundRestoreRecords: '恢复了',
  inboundConfirm: '确认入库',
  inboundClearAll: '清空列表',

  // ============================================
  // 出库模块
  // ============================================
  outboundTitle: '扫码出库',
  outboundOrderSelect: '选择订单',
  outboundScanned: '已扫描',
  outboundConfirm: '确认出库',

  // ============================================
  // 盘点模块
  // ============================================
  inventoryTitle: '库存盘点',
  inventoryWhole: '整包',
  inventoryPartial: '拆包',
  inventorySaved: '已保存',
  inventoryCount: '盘点数量',
  inventoryDiff: '差异',
  inventoryConfirm: '确认盘点',

  // ============================================
  // 订单模块
  // ============================================
  ordersTitle: '出库订单',
  ordersAll: '全部',
  ordersPending: '待处理',
  ordersProcessing: '处理中',
  ordersCompleted: '已完成',
  ordersCreate: '创建订单',
  ordersScanCount: '扫码次数',
  ordersTotalQty: '总数量',
  ordersToday: '今日',

  // ============================================
  // 标签模块
  // ============================================
  labelsTitle: '标签打印',
  labelsAll: '全部',
  labelsShipped: '已发货',
  labelsRemaining: '剩余',
  labelsPrint: '打印',
  labelsReprint: '补打',
  labelsShippedTag: '发货标签',
  labelsRemainingTag: '剩余标签',

  // ============================================
  // 设置模块
  // ============================================
  settingsTitle: '设置',
  settingsAbout: '关于应用',
  settingsVersion: '当前版本',
  settingsCheckUpdate: '检查更新',
  settingsParseRules: '解析规则',
  settingsCustomFields: '自定义字段',
  settingsDataSync: '电脑同步',
  settingsServerConfig: '同步服务配置',
  settingsClearCache: '清除缓存',
  settingsHelp: '使用帮助',
  settingsChangelog: '更新日志',

  // ============================================
  // 弹窗标题
  // ============================================
  alertTitleSuccess: '成功',
  alertTitleWarning: '警告',
  alertTitleError: '错误',
  alertTitleInfo: '提示',
  alertConfirmDelete: '确认删除',
  alertDeleteMessage: '确定要删除此项吗？此操作无法撤销。',

  // ============================================
  // 错误提示
  // ============================================
  errorNetwork: '网络请求失败',
  errorServer: '服务器错误',
  errorTimeout: '请求超时',
  errorUnknown: '未知错误',
  errorEmpty: '不能为空',
  errorInvalid: '输入格式不正确',
} as const;

// 类型安全访问
export type StrKey = keyof typeof Str;
export const getString = (key: StrKey): string => Str[key] ?? key;
