/**
 * 统一时间格式化工具
 * 所有时间格式化都从这里调用，保持格式一致
 */

// ============================================
// 存储格式
// ============================================

/**
 * 获取指定时间或当前时间（用于存储/导出/备份）
 * 格式：YYYY/MM/DD HH:mm
 */
export const getISODateTime = (date: Date = new Date()): string => {
  const now = date;
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

/**
 * 获取当前时间（用于导出/备份）- 别名，兼容旧代码
 */
export const getExportDateTime = getISODateTime;

// ============================================
// 显示格式
// ============================================

/**
 * 格式化日期 (YYYY-MM-DD)
 * 用于列表、卡片等只显示日期的场景
 */
export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '-';
  try {
    // 先检查是否已经是 YYYY/M/D HH:mm 或 YYYY/M/D 格式（直接提取日期部分）
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(dateString)) {
      const [year, month, day] = dateString.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.split(/[\sT]/)[0].padStart(2, '0')}`;
    }
    
    // 先尝试 ISO 格式解析（带时区或 UTC）
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // 尝试解析本地格式 YYYY-M-D 并转为 YYYY/M/D
    const normalized = dateString.replace(/-/g, '/');
    date = new Date(normalized);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    return '-';
  } catch {
    return '-';
  }
};

/**
 * 格式化日期时间 (YYYY-MM-DD HH:mm)
 * 用于详情、导出等需要时间的场景
 */
export const formatDateTime = (dateString: string | undefined | null): string => {
  if (!dateString) return '-';
  try {
    // 先检查是否已经是 YYYY/M/D HH:mm 格式（直接返回）
    if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}$/.test(dateString)) {
      const [datePart, timePart] = dateString.split(' ');
      const [year, month, day] = datePart.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timePart}`;
    }
    
    // 尝试解析 ISO 格式
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
    
    // 尝试用斜杠替换连字符
    const normalized = dateString.replace(/-/g, '/');
    date = new Date(normalized);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
    
    return '-';
  } catch {
    return '-';
  }
};

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 * 用于日期比较筛选
 */
export const getToday = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 获取今天的日期（本地格式，用于数据库日期比较）
 * 格式：YYYY/MM/DD
 */
export const getTodayLocal = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

/**
 * 格式化时间 (YYYY-MM-DD HH:mm)
 * 与 formatDateTime 功能相同，提供别名兼容旧代码
 */
export const formatTime = (dateString: string | undefined | null): string => {
  return formatDateTime(dateString);
};

/**
 * 导出专用日期时间格式 (YYYY/M/D HH:mm)
 * 用于 Excel 导出，不补零，更紧凑
 */
export const formatDateTimeExport = (dateString: string | undefined | null): string => {
  if (!dateString) return '-';
  try {
    // 先检查是否已经是 YYYY/M/D HH:mm 格式（直接返回）
    if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}$/.test(dateString)) {
      return dateString;
    }
    
    // 尝试解析 ISO 格式或标准格式
    let date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}/${month}/${day} ${hours}:${minutes}`;
    }
    
    // 尝试用斜杠替换连字符
    const normalized = dateString.replace(/-/g, '/');
    date = new Date(normalized);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}/${month}/${day} ${hours}:${minutes}`;
    }
    
    return '-';
  } catch {
    return '-';
  }
};
