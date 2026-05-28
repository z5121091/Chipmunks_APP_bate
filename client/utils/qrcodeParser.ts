/**
 * @file 二维码内容解析器
 * 
 * 本模块负责：
 * 1. 检测扫码内容是否为二维码（通过分隔符识别）
 * 2. 使用用户配置的规则解析二维码内容
 * 
 * 核心逻辑委托给 database.ts 中的 detectRule 和 parseWithRule 方法，
 * 确保分隔符识别规则全局统一。
 * 
 * @see database.ts - 包含 detectRule() 和 parseWithRule() 等公共解析方法
 */

import { 
  detectRule, 
  parseWithRule 
} from './database';


/** 通用分隔符列表（用于 isQRCode 判断） */
const COMMON_SEPARATORS = ['||', '//', '/', '|', ',', '*', '#', ';', '\t'];

/** 预设括号对（用于检测括号格式） */
const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '[': ']',
  '<': '>',
};

/**
 * 检测是否为 URL（避免将 http://、ftp:// 等的 // 当成分隔符）
 * @param content 扫码内容
 * @returns true=是URL，false=不是URL
 */
const isURL = (content: string): boolean => {
  const lower = content.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('ftp://') ||
    lower.startsWith('sftp://')
  );
};

/**
 * 检测括号格式并返回左括号
 * 例如：{字段}{字段} → 返回 '{'
 * @param content 扫码内容
 * @returns 左括号字符，或 null（不是括号格式）
 */
const detectBracketFormat = (content: string): string | null => {
  for (const leftBracket of Object.keys(BRACKET_PAIRS)) {
    const rightBracket = BRACKET_PAIRS[leftBracket];
    const separator = rightBracket + leftBracket; // 如 }{ 或 )(
    if (content.startsWith(leftBracket) && content.includes(separator)) {
      return leftBracket;
    }
  }
  return null;
};

/**
 * 检测自定义两字符分隔符（排除单字符分隔符，避免误判）
 * 例如：+-、+=、:- 等
 * @param content 扫码内容
 * @returns 分隔符字符串，或 null
 */
const detectCustomSeparator = (content: string): string | null => {
  const customSymbols = ['+', '-', '=', ':', '@', '!', '%', '&', '~', '^'];
  for (const left of customSymbols) {
    for (const right of customSymbols) {
      if (left !== right && content.includes(left + right)) {
        return left + right;
      }
    }
  }
  return null;
};

/**
 * 检测是否为二维码内容
 * 
 * 二维码特征：包含分隔符（一维码不包含分隔符）
 * 
 * 检测顺序：
 * 1. 预设括号格式（{}、()、[]、<>）
 * 2. 通用分隔符（||、//、/、|、,、*、#、;、\t）
 * 3. 自定义两字符分隔符（+-、+= 等）
 * 
 * @param content 扫码内容
 * @returns true=二维码（需要震动处理），false=一维码（静默忽略）
 */
export const isQRCode = (content: string): boolean => {
  if (!content || content.trim().length === 0) {
    return false;
  }

  const trimmed = content.trim();

  // 1. 检测括号格式
  if (detectBracketFormat(trimmed)) {
    return true;
  }

  // 2. 检测通用分隔符
  for (const sep of COMMON_SEPARATORS) {
    // 跳过 URL 中的 //
    if (sep === '//' && isURL(trimmed)) {
      continue;
    }
    if (trimmed.includes(sep)) {
      return true;
    }
  }

  // 3. 检测自定义两字符分隔符
  if (detectCustomSeparator(trimmed)) {
    return true;
  }

  // 不包含任何分隔符，判定为一维码
  return false;
};

/**
 * 二维码解析结果接口
 */
export interface ParsedQRCode {
  model: string;           // 型号
  batch: string;            // 批次
  package: string;          // 封装
  version: string;          // 版本号
  quantity: string;         // 数量
  productionDate: string;    // 生产日期年周
  traceNo: string;           // 追踪码
  sourceNo: string;          // 箱号
  rawContent: string;        // 原始内容
  fields: string[];          // 原始拆分出的所有字段
  separator: string;         // 分隔符
}

/**
 * 使用规则解析二维码内容
 * 
 * 本函数委托给 database.ts 的公共方法：
 * 1. detectRule() - 自动检测匹配规则
 * 2. parseWithRule() - 按规则解析字段
 * 
 * @param content 扫码原始内容
 * @param customSeparator 可选，自定义分隔符（优先使用）
 * @returns 解析结果，或 null（解析失败）
 * 
 * @see database.ts detectRule()
 * @see database.ts parseWithRule()
 */
export const parseQRCode = async (
  content: string,
  customSeparator?: string
): Promise<ParsedQRCode | null> => {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const trimmedContent = content.trim();

  // 调用 database.ts 的 detectRule 自动检测规则
  // 该方法会：
  // 1. 尝试匹配用户配置的规则
  // 2. 若无匹配，自动识别分隔符并创建"自动识别"规则
  const rule = await detectRule(trimmedContent);

  if (!rule) {
    // 无法检测规则，整体作为一个字段
    return {
      model: trimmedContent,
      batch: '',
      package: '',
      version: '',
      quantity: '',
      productionDate: '',
      traceNo: '',
      sourceNo: '',
      rawContent: trimmedContent,
      fields: [trimmedContent],
      separator: '',
    };
  }

  // 使用规则解析字段
  const { standardFields } = parseWithRule(trimmedContent, rule);

  return {
    model: standardFields.model || '',
    batch: standardFields.batch || '',
    package: standardFields.package || '',
    version: standardFields.version || '',
    quantity: standardFields.quantity || '',
    productionDate: standardFields.productionDate || '',
    traceNo: standardFields.traceNo || '',
    sourceNo: standardFields.sourceNo || '',
    rawContent: trimmedContent,
    fields: [], // parseWithRule 不返回原始字段，此处留空
    separator: rule.separator,
  };
};

/**
 * 同步版本的二维码解析（仅检测规则，不调用数据库）
 * 
 * 适用于需要同步执行的场景（如在 useEffect 中），
 * 但无法使用用户自定义规则。
 * 
 * @param content 扫码原始内容
 * @returns 解析结果，或 null
 */
export const parseQRCodeSync = (
  content: string,
): ParsedQRCode | null => {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const trimmedContent = content.trim();

  // 检测分隔符
  let separator = '';
  let fields: string[] = [];

  // 1. 检测括号格式
  const bracketLeft = detectBracketFormat(trimmedContent);
  if (bracketLeft) {
    const rightBracket = BRACKET_PAIRS[bracketLeft];
    separator = bracketLeft + rightBracket;
    let str = trimmedContent;
    if (str.startsWith(bracketLeft)) str = str.slice(1);
    if (str.endsWith(rightBracket)) str = str.slice(0, -1);
    fields = str.split(rightBracket + bracketLeft).map(s => s.trim());
  } else {
    // 2. 尝试通用分隔符
    for (const sep of COMMON_SEPARATORS) {
      if (sep === '//' && isURL(trimmedContent)) continue;
      const parts = trimmedContent.split(sep).map(s => s.trim());
      if (parts.length >= 2) {
        separator = sep;
        fields = parts;
        break;
      }
    }

    // 3. 尝试自定义分隔符
    if (fields.length === 0) {
      const customSep = detectCustomSeparator(trimmedContent);
      if (customSep) {
        separator = customSep;
        fields = trimmedContent.split(customSep).map(s => s.trim());
      }
    }
  }

  // 无法拆分
  if (fields.length === 0) {
    fields = [trimmedContent];
  }

  // 按位置解析（标准格式：型号/批次/封装/版本号/数量/生产日期/追踪码/箱号）
  return {
    model: fields[0] || '',
    batch: fields[1] || '',
    package: fields[2] || '',
    version: fields[3] || '',
    quantity: fields[4] || '',
    productionDate: fields[5] || '',
    traceNo: fields[6] || '',
    sourceNo: fields[7] || '',
    rawContent: trimmedContent,
    fields,
    separator,
  };
};

// 导出日期格式化方法（兼容旧代码）
export { formatDate } from './time';
