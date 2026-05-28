/**
 * 错误类型定义和错误详情处理
 * 用于提供更详细的错误信息和解决建议
 */

/**
 * 错误分类
 */
export enum ErrorCategory {
  FORMAT = 'format',           // 格式错误
  BINDING = 'binding',         // 绑定错误
  SAVE = 'save',               // 保存错误
  DUPLICATE = 'duplicate',     // 重复警告
  NETWORK = 'network',         // 网络错误
  PERMISSION = 'permission',   // 权限错误
  UNKNOWN = 'unknown',         // 未知错误
}

/**
 * 错误详情
 */
export interface ErrorDetail {
  category: ErrorCategory;
  title: string;
  message: string;
  action?: string;
  onPress?: () => void;
  code?: string;
}

/**
 * 获取错误详情
 * @param code 错误代码
 * @param context 上下文信息
 * @param router 路由实例（可选，用于设置 onPress）
 * @returns 错误详情
 */
export function getErrorDetail(code: string, context?: any, router?: any): ErrorDetail {
  let detail: ErrorDetail;

  switch (code) {
    // ========== 格式错误 ==========
    case 'ERR_QR_FORMAT':
      return {
        category: ErrorCategory.FORMAT,
        title: '无法识别二维码格式',
        message: `扫码内容：${context?.code || ''}\n\n格式说明：\n需要包含至少一个分隔符（/ | # ; 空格 -）`,
        action: '配置解析规则',
        code: code,
      };

    case 'ERR_QR_NO_SEPARATOR':
      return {
        category: ErrorCategory.FORMAT,
        title: '二维码缺少分隔符',
        message: `扫码内容：${context?.code || ''}\n\n二维码中未包含有效的分隔符，无法解析。\n可能原因：\n1. 扫描的是一维码（条形码）\n2. 二维码内容格式不符合规则`,
        action: '查看解析规则',
        code: code,
      };

    case 'ERR_QR_LENGTH':
      return {
        category: ErrorCategory.FORMAT,
        title: '二维码内容长度不足',
        message: `扫码内容：${context?.code || ''}\n\n长度：${context?.code?.length || 0} 字符\n\n二维码内容过短，无法解析出完整信息。`,
        action: '查看解析规则',
        code: code,
      };

    // ========== 绑定错误 ==========
    case 'ERR_MODEL_NOT_FOUND':
      return {
        category: ErrorCategory.BINDING,
        title: '型号未识别',
        message: `型号：${context?.model || ''}\n\n解析规则中未定义该型号的位置。\n可能原因：\n1. 解析规则配置错误\n2. 二维码内容不符合规则`,
        action: '查看解析规则',
        code: code,
      };

    case 'ERR_MODEL_NOT_BOUND':
      return {
        category: ErrorCategory.BINDING,
        title: '型号未绑定存货编码',
        message: `型号：${context?.model || ''}\n\n该型号尚未配置存货编码和供应商信息。\n请在物料管理中绑定型号和存货编码。`,
        action: '去绑定',
        code: code,
      };

    // ========== 解析错误 ==========
    case 'ERR_PARSE_FAILED':
      return {
        category: ErrorCategory.FORMAT,
        title: '解析失败',
        message: `错误信息：${context?.error || '未知错误'}\n\n二维码长度：${context?.code?.length || 0}\n\n解析二维码内容时出错，请检查：\n1. 二维码内容格式\n2. 解析规则配置`,
        action: '查看解析规则',
        code: code,
      };

    case 'ERR_NO_RULE':
      return {
        category: ErrorCategory.FORMAT,
        title: '未配置解析规则',
        message: '系统未配置任何解析规则，无法识别二维码。\n\n请先在系统设置中配置解析规则。',
        action: '配置解析规则',
        code: code,
      };

    case 'ERR_RULE_NOT_MATCH':
      return {
        category: ErrorCategory.FORMAT,
        title: '无法匹配解析规则',
        message: `扫码内容：${context?.code || ''}\n\n二维码内容与任何解析规则都不匹配。\n\n建议：\n1. 检查二维码内容格式\n2. 添加新的解析规则`,
        action: '配置解析规则',
        code: code,
      };

    // ========== 保存错误 ==========
    case 'ERR_SAVE_FAILED':
      return {
        category: ErrorCategory.SAVE,
        title: '保存失败',
        message: `错误信息：${context?.error || '数据库写入错误'}\n\n扫码记录保存失败，已保存到本地缓存，稍后会自动重试。`,
        action: '查看缓存',
        code: code,
      };

    case 'ERR_DB_ERROR':
      return {
        category: ErrorCategory.SAVE,
        title: '数据库错误',
        message: `错误信息：${context?.error || '未知错误'}\n\n数据库操作失败，请重试。`,
        action: '重试',
        code: code,
      };

    // ========== 重复警告 ==========
    case 'WARN_DUPLICATE_BY_TRACENO':
      return {
        category: ErrorCategory.DUPLICATE,
        title: '物料已扫码',
        message: `追踪码：${context?.traceNo || ''}\n\n该物料已在本次扫描记录中，请勿重复扫码。`,
        action: '查看记录',
        code: code,
      };

    case 'WARN_DUPLICATE_BY_MODEL':
      return {
        category: ErrorCategory.DUPLICATE,
        title: '型号+批次已扫码',
        message: `型号：${context?.model || ''}\n批次：${context?.batch || ''}\n\n该型号和批次的组合已在本次扫描记录中，请勿重复扫码。`,
        action: '查看记录',
        code: code,
      };

    // ========== 仓库相关 ==========
    case 'ERR_NO_WAREHOUSE':
      return {
        category: ErrorCategory.FORMAT,
        title: '未选择仓库',
        message: '请先选择仓库再进行扫码操作。\n\n仓库用于管理不同地点的库存。',
        action: '选择仓库',
        code: code,
      };

    case 'ERR_WAREHOUSE_NOT_FOUND':
      return {
        category: ErrorCategory.SAVE,
        title: '仓库不存在',
        message: `仓库ID：${context?.warehouseId || ''}\n\n选中的仓库不存在，请重新选择。`,
        action: '重新选择',
        code: code,
      };

    // ========== 默认处理 ==========
    default:
      detail = {
        category: ErrorCategory.UNKNOWN,
        title: '未知错误',
        message: `错误代码：${code}\n\n请检查操作是否正确，如持续遇到问题请联系技术支持。`,
        code: code,
      };
  }

  // 根据错误类型添加不同的导航操作
  if (router && detail.action) {
    if (detail.action === '配置解析规则' || detail.action === '查看解析规则') {
      detail.onPress = () => router.push('/settings');
    } else if (detail.action === '去绑定') {
      detail.onPress = () => router.push('/inventory-binding', { model: context?.model });
    } else if (detail.action === '选择仓库') {
      // 仓库选择器应该已经在页面上显示，不需要跳转
      delete detail.onPress;
    }
  }

  return detail;
}

/**
 * 获取错误分类的颜色
 * @param category 错误分类
 * @returns 颜色
 */
export function getErrorCategoryColor(category: ErrorCategory): string {
  switch (category) {
    case ErrorCategory.FORMAT:
      return '#F59E0B'; // 橙色
    case ErrorCategory.BINDING:
      return '#EF4444'; // 红色
    case ErrorCategory.SAVE:
      return '#EF4444'; // 红色
    case ErrorCategory.DUPLICATE:
      return '#F59E0B'; // 橙色
    case ErrorCategory.NETWORK:
      return '#EF4444'; // 红色
    case ErrorCategory.PERMISSION:
      return '#EF4444'; // 红色
    default:
      return '#6B7280'; // 灰色
  }
}

/**
 * 获取错误分类的图标
 * @param category 错误分类
 * @returns 图标名称
 */
export function getErrorCategoryIcon(category: ErrorCategory): string {
  switch (category) {
    case ErrorCategory.FORMAT:
      return 'file-text';
    case ErrorCategory.BINDING:
      return 'link';
    case ErrorCategory.SAVE:
      return 'save';
    case ErrorCategory.DUPLICATE:
      return 'copy';
    case ErrorCategory.NETWORK:
      return 'wifi-off';
    case ErrorCategory.PERMISSION:
      return 'lock';
    default:
      return 'alert-circle';
  }
}
