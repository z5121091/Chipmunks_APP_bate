export const shouldLoadPrivacyPolicyInsideApp = (
  targetUrl: string,
  policyUrl: string
): boolean => {
  const policyOrigin = policyUrl.split('/').slice(0, 3).join('/');
  return targetUrl === 'about:blank' || targetUrl.startsWith(`${policyOrigin}/`);
};
