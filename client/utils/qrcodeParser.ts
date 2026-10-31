/** 扫码内容识别和解析。解析规则统一使用 database.ts 中的方法。 */

import { 
  detectRule, 
  parseWithRule,
  inspectQRCodeRule,
  type QRCodeRule,
} from './database';


/** 没有单独配置规则时也能识别的常用分隔符。 */
const COMMON_SEPARATORS = [
  '\r\n',
  '||',
  '//',
  '/',
  '|',
  ',',
  '*',
  '#',
  ';',
  ':',
  '\t',
  '\n',
  '\r',
  '\x1D',
  '\x1E',
];

/** 支持连续括号字段，例如 {型号}{数量}。 */
const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '[': ']',
  '<': '>',
};

/** URL 中的双斜线不能当成字段分隔符。 */
const isURL = (content: string): boolean => {
  const lower = content.toLowerCase();
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('ftp://') ||
    lower.startsWith('sftp://')
  );
};

/** 识别 {字段}{字段} 这类连续括号格式，并返回左括号。 */
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

/** 识别 +-、+=、:- 等双字符分隔符。 */
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
 * 自动提交前的收码检查，不参与规则选择或业务校验。
 * 完整匹配保持原速度；还缺字段时保留缓冲区，给扫码器一次继续输入的机会。
 */
export const shouldWaitForQRCodeContinuation = (
  content: string,
  rules: readonly QRCodeRule[]
): boolean => {
  if (!content.trim()) return false;
  const inspections = rules
    .filter(rule => rule.separator && (rule.fieldOrder?.length ?? 0) >= 2)
    .map(rule => ({ rule, inspection: inspectQRCodeRule(content, rule) }));
  if (inspections.some(({ inspection }) => inspection.matched)) return false;
  const hasFieldStructure = isQRCode(content, rules);
  return inspections.some(({ rule, inspection }) =>
    inspection.parts.length < rule.fieldOrder.length &&
    (inspection.parts.length > 1 || !hasFieldStructure)
  );
};

/**
 * 原生清空尚未生效时，完整回车确认过的前包可能仍累计在本包前面。
 * 仅当累计原文不匹配任何现有规则、而明确边界后的完整后包可匹配时恢复。
 * 有效的新二维码（如追溯码从 -1 延长为 -10）及不确定内容均保持原文。
 */
export const recoverConfirmedScannerContent = (
  content: string,
  confirmedNativeContent: string | null,
  rules: readonly QRCodeRule[]
): string => {
  if (!confirmedNativeContent || content.length <= confirmedNativeContent.length ||
      !content.startsWith(confirmedNativeContent)) return content;
  const usableRules = rules.filter(rule => rule.isActive !== false && rule.separator &&
    (rule.fieldOrder?.length ?? 0) >= 2);
  if (usableRules.length === 0) return content;
  try {
    if (usableRules.some(rule => inspectQRCodeRule(content, rule).matched)) return content;
    const nextContent = content.slice(confirmedNativeContent.length);
    return usableRules.some(rule => inspectQRCodeRule(nextContent, rule).matched) ? nextContent : content;
  } catch {
    // 配置或原码异常仍交由正常解析入口报告，不猜测边界。
    return content;
  }
};

/** 根据括号、常用分隔符和用户配置判断扫码内容是否需要解析。 */
export const isQRCode = (
  content: string,
  rules: readonly { separator: string }[] = []
): boolean => {
  if (!content || content.trim().length === 0) {
    return false;
  }

  const trimmed = content.trim();

  if (detectBracketFormat(trimmed)) {
    return true;
  }

  for (const sep of COMMON_SEPARATORS) {
    // URL 中的 // 不是字段分隔符。
    if (sep === '//' && isURL(trimmed)) {
      continue;
    }
    if (trimmed.includes(sep)) {
      return true;
    }
  }

  if (detectCustomSeparator(trimmed)) {
    return true;
  }

  // 空格或单字符分隔符以用户配置为准。
  return rules.some(rule => Boolean(rule.separator) && trimmed.includes(rule.separator));
};

/** 扫码内容解析结果。 */
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

/** 查找匹配规则并解析扫码内容；没有匹配规则时返回 null。 */
export const parseQRCode = async (content: string): Promise<ParsedQRCode | null> => {
  if (!content || content.trim().length === 0) {
    return null;
  }

  const trimmedContent = content.trim();

  // 使用数据库中同一套规则匹配逻辑。
  // 只匹配用户已经启用的规则，未知结构不做猜测。
  const rule = await detectRule(content);

  if (!rule) {
    return null;
  }

  // 使用规则解析字段
  const { standardFields } = parseWithRule(content, rule);

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

  // 先识别连续括号格式。
  const bracketLeft = detectBracketFormat(trimmedContent);
  if (bracketLeft) {
    const rightBracket = BRACKET_PAIRS[bracketLeft];
    separator = bracketLeft + rightBracket;
    let str = trimmedContent;
    if (str.startsWith(bracketLeft)) str = str.slice(1);
    if (str.endsWith(rightBracket)) str = str.slice(0, -1);
    fields = str.split(rightBracket + bracketLeft).map(s => s.trim());
  } else {
    // 再尝试常用分隔符。
    for (const sep of COMMON_SEPARATORS) {
      if (sep === '//' && isURL(trimmedContent)) continue;
      const parts = trimmedContent.split(sep).map(s => s.trim());
      if (parts.length >= 2) {
        separator = sep;
        fields = parts;
        break;
      }
    }

    // 最后尝试双字符分隔符。
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
