const HAS_CHINESE_TEXT = /[\u3400-\u9fff]/;

const readErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === 'string') {
    return error.trim();
  }
  return '';
};

const replaceKnownEnglishFragments = (message: string): string =>
  message
    .replace(/failed to fetch/gi, '网络连接失败')
    .replace(/network request failed/gi, '网络连接失败')
    .replace(/network error/gi, '网络连接失败')
    .replace(/load failed/gi, '网络连接失败')
    .replace(/unauthorized backend request/gi, '后端拒绝访问，请检查应用访问密钥')
    .replace(/too many requests,?\s*please retry later/gi, '请求过于频繁，请稍后再试')
    .replace(/erp proxy stream error/gi, 'ERP代理响应中断')
    .replace(/erp proxy request failed/gi, 'ERP代理请求失败')
    .replace(/unexpected erp error/gi, 'ERP服务发生未知错误');

export const formatUserFacingErrorMessage = (
  error: unknown,
  fallback = '操作失败，请稍后重试'
): string => {
  const rawMessage = readErrorText(error);
  if (!rawMessage) {
    return fallback;
  }

  if (/failed to fetch|network request failed|network error|load failed/i.test(rawMessage)) {
    return '无法连接服务器，请检查网络、域名和服务器运行状态';
  }

  const message = replaceKnownEnglishFragments(rawMessage);

  if (/missing\s+expo_public_backend_base_url/i.test(message)) {
    return '应用未配置后端服务器地址，请联系管理员';
  }
  if (/backend request failed with status\s*\d+/i.test(message)) {
    const status = message.match(/status\s*(\d+)/i)?.[1];
    return `后端接口请求失败${status ? `（状态码 ${status}）` : ''}`;
  }
  if (/invalid\s+x-erp-account-key/i.test(message)) {
    return 'ERP账套标识无效，请检查前后端账套配置';
  }
  if (
    /missing\s+open\s*token|stored\s+open\s*token.*expired|opentoken.*expired/i.test(
      message
    )
  ) {
    return 'ERP授权已过期或尚未完成，请重新授权当前账套';
  }
  if (/missing\s+refresh\s*token|refreshtoken.*expired|refresh\s*token.*expired/i.test(message)) {
    return 'ERP自动续期凭证缺失或已过期，请重新授权当前账套';
  }
  if (/token response is missing accesstoken/i.test(message)) {
    return 'ERP授权响应中缺少访问令牌，请重新授权当前账套';
  }
  if (/refresh response is missing refreshtoken/i.test(message)) {
    return 'ERP续期响应中缺少刷新令牌，请重新授权当前账套';
  }
  if (/request timed out|timed out|timeout/i.test(message)) {
    return '请求超时，请检查网络和服务器状态后重试';
  }
  if (/aborterror|operation was aborted|request was aborted/i.test(message)) {
    return '请求已取消，请重新操作';
  }
  if (/unauthorized|status\s*401|\b401\b/i.test(message)) {
    return '服务器拒绝访问，请检查应用访问密钥或登录状态';
  }
  if (/forbidden|status\s*403|\b403\b/i.test(message)) {
    return '当前应用没有访问该接口的权限';
  }
  if (/not found|status\s*404|\b404\b/i.test(message)) {
    return '未找到后端接口，请检查服务器版本和接口地址';
  }
  if (/too many requests|status\s*429|\b429\b/i.test(message)) {
    return '请求过于频繁，请稍后再试';
  }
  if (/provided service name.*(?:incorrect|not correct)/i.test(message)) {
    return 'ERP接口名称不正确，请检查服务器接口版本和权限配置';
  }

  if (HAS_CHINESE_TEXT.test(message)) {
    return message;
  }

  const missingConfigSuffix = ' is not configured';
  if (message.toLowerCase().endsWith(missingConfigSuffix)) {
    return `后端缺少必要配置：${message.slice(0, -missingConfigSuffix.length).trim()}`;
  }

  return fallback;
};
