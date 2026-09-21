const ESCAPES: Record<string, string> = { r: '\r', n: '\n', t: '\t', '\\': '\\' };

export const decodeRuleTerminator = (text: string): string => {
  const value = text.replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|[rnt\\])|\\/g, (_match, escape?: string) => {
    if (!escape) throw new Error('结束符转义无效，请使用 \\r、\\n、\\t、\\xHH、\\uHHHH 或 \\\\');
    return ESCAPES[escape] ?? String.fromCharCode(parseInt(escape.slice(1), 16));
  });
  assertValidRuleTerminator(value);
  return value;
};

export const assertValidRuleTerminator = (value: unknown): void => {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > 64 || value.includes('\0')) {
    throw new Error('结束符须为不超过64个字符的文本，且不能包含空字符 NUL');
  }
};

export const displayRuleTerminator = (value: string): string => Array.from(value).map(char => {
  if (char === '\\') return '\\\\';
  if (char === '\r') return '\\r';
  if (char === '\n') return '\\n';
  if (char === '\t') return '\\t';
  const code = char.charCodeAt(0);
  return code < 32 || code === 127 ? `\\x${code.toString(16).padStart(2, '0').toUpperCase()}` : char;
}).join('');

export const stripRuleTerminator = (content: string, terminator?: string) => {
  if (terminator) {
    // Allow scanner-appended whitespace after the exact terminator, but strip only once.
    for (let end = content.length; end >= terminator.length; end--) {
      if (content.slice(end - terminator.length, end) === terminator) {
        return { content: content.slice(0, end - terminator.length), matched: true };
      }
      if (!/\s/.test(content[end - 1])) break;
    }
  }
  return { content, matched: false };
};
