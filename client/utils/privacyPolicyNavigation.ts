export const buildPrivacyPolicyUrl = (
  policyUrl: string,
  cacheKey: string | number
): string => {
  const separator = policyUrl.includes('?') ? '&' : '?';
  return `${policyUrl}${separator}app=${encodeURIComponent(String(cacheKey))}`;
};

export const shouldLoadPrivacyPolicyInsideApp = (
  targetUrl: string,
  policyUrl: string
): boolean => {
  const policyOrigin = policyUrl.split('/').slice(0, 3).join('/');
  return targetUrl === 'about:blank' || targetUrl.startsWith(`${policyOrigin}/`);
};
