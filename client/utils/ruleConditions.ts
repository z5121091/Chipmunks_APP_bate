export const CONDITION_OPERATORS = {
  contains: '包含',
  equals: '等于',
  startsWith: '开头是',
  endsWith: '结尾是',
} as const;

export type ConditionOperator = keyof typeof CONDITION_OPERATORS;

export const isConditionOperator = (value: unknown): value is ConditionOperator =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONDITION_OPERATORS, value);

export const matchesRuleCondition = (
  value: string,
  condition: { keyword: string; operator?: ConditionOperator },
): boolean => {
  const text = value.trim().toLowerCase();
  const keyword = condition.keyword.trim().toLowerCase();
  if (!keyword) return false;
  switch (condition.operator ?? 'contains') {
    case 'contains': return text.includes(keyword);
    case 'equals': return text === keyword;
    case 'startsWith': return text.startsWith(keyword);
    case 'endsWith': return text.endsWith(keyword);
    default: return false;
  }
};

export const isIgnoredRuleField = (field: string): boolean => /^ignore:\d+$/.test(field);

export const nextIgnoredRuleField = (fields: readonly string[]): string => {
  let id = 1;
  while (fields.includes(`ignore:${id}`)) id++;
  return `ignore:${id}`;
};

/**
 * 从已拆分的单段样本中提取候选前缀。
 * 不依赖供应商或字段名称预设：优先使用 :、：、= 等明确的“标签和值”边界，
 * 不把型号中常见的 /、-、.、_ 当成前缀边界。编辑阶段仅作预填建议，仍可手动修改。
 */
export const suggestRuleFieldPrefix = (value: string, mainSeparator: string): string => {
  const text = String(value ?? '').trim();
  const characters = Array.from(text);
  const separatorCharacters = new Set(Array.from(mainSeparator || ''));
  const preferredMarkers = new Set([':', '：', '=', '#']);
  const ambiguousMarkers = new Set(['/', '-', '.', '_']);
  let preferredCandidate = '';
  let fallbackCandidate = '';

  for (let index = 1; index < characters.length - 1; index += 1) {
    const marker = characters[index];
    if (/^[\p{L}\p{N}\s]$/u.test(marker) || separatorCharacters.has(marker)) continue;

    const before = characters.slice(0, index).join('').trim();
    const after = characters.slice(index + 1).join('').trim();
    const looksLikeFieldLabel = before.length > 0
      && before.length <= 32
      && /\p{L}/u.test(before)
      && !/\p{N}/u.test(before);
    if (!looksLikeFieldLabel || !after) continue;

    const candidate = characters.slice(0, index + 1).join('').trim();
    // 冒号类边界可正确处理 P/N:、PART NO.:、D/C: 等前缀中的内部符号。
    if (preferredMarkers.has(marker)) preferredCandidate = candidate;
    // 没有明确边界时，只对相对少见的符号做保守建议；型号内 /、-、.、_ 一律不猜。
    else if (!ambiguousMarkers.has(marker)) fallbackCandidate = candidate;
  }

  return preferredCandidate || fallbackCandidate;
};

export const visualizeScanCharacters = (value: string): string => Array.from(value).map(char => {
  const labels: Record<string, string> = {
    ' ': '【空格】', '\r': '【CR】', '\n': '【LF】\n', '\t': '【TAB】',
    '\x1D': '【GS】', '\x1E': '【RS】', '\x04': '【EOT】', '\u00a0': '【不换行空格】',
  };
  if (labels[char]) return labels[char];
  const code = char.codePointAt(0)!;
  return code < 32 || code === 127 || code === 0x200b || code === 0xfeff
    ? `【U+${code.toString(16).toUpperCase().padStart(4, '0')}】` : char;
}).join('');

export interface RuleSeparatorSuggestion { value: string; label: string; fieldCount: number }

export const suggestRuleSeparators = (content: string, configured: readonly string[] = []): RuleSeparatorSuggestion[] => {
  if (!content.trim() || /^(?:https?|s?ftp):\/\//i.test(content.trimStart())) return [];
  const text = content.trim();
  const labels: Record<string, string> = { '\r\n': '回车换行', '\r': '回车', '\n': '换行', '\t': '制表符',
    '\x1D': 'GS', '\x1E': 'RS', ' ': '空格', '{}': '{…}', '()': '(…)', '[]': '[…]', '<>': '<…>' };
  const brackets = ['{}', '()', '[]', '<>'];
  const separators = [...brackets, '\r\n', '\n', '\r', '\t', '\x1D', '\x1E', '||', '|', ';', '&', '#', '*', '/', ',', ':', ' ', ...configured];
  // Candidates describe syntax only; punctuation inside models/specifications can also split.
  return [...new Set(separators)].flatMap((value, priority) => {
    if (!value) return [];
    if ((value === '\n' || value === '\r') && text.includes('\r\n') && !text.replace(/\r\n/g, '').includes(value)) return [];
    if (value === '|' && text.includes('||') && !text.replace(/\|\|/g, '').includes('|')) return [];
    let parts: string[];
    if (brackets.includes(value)) {
      if (!text.startsWith(value[0]) || !text.endsWith(value[1]) || !text.includes(value[1] + value[0])) return [];
      parts = text.slice(1, -1).split(value[1] + value[0]);
    } else parts = text.split(value);
    while (parts.length > 1 && !parts[parts.length - 1].trim()) parts.pop();
    if (parts.length < 2 || parts.length > 128) return [];
    return [{ value, label: labels[value] ?? visualizeScanCharacters(value), fieldCount: parts.length, priority }];
  }).sort((a, b) => a.priority - b.priority).slice(0, 8)
    .map(({ value, label, fieldCount }) => ({ value, label, fieldCount }));
};
