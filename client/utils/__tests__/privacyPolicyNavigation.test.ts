import { shouldLoadPrivacyPolicyInsideApp } from '../privacyPolicyNavigation';

const POLICY_URL = 'https://erp.chipmunks.fun/privacy';

describe('privacy policy navigation', () => {
  it('keeps policy pages inside the app', () => {
    expect(
      shouldLoadPrivacyPolicyInsideApp(
        'https://erp.chipmunks.fun/privacy?app=123',
        POLICY_URL
      )
    ).toBe(true);
    expect(shouldLoadPrivacyPolicyInsideApp('about:blank', POLICY_URL)).toBe(true);
  });

  it('sends filing and lookalike hosts outside the webview', () => {
    expect(
      shouldLoadPrivacyPolicyInsideApp('https://beian.miit.gov.cn/', POLICY_URL)
    ).toBe(false);
    expect(
      shouldLoadPrivacyPolicyInsideApp(
        'https://erp.chipmunks.fun.example.com/privacy',
        POLICY_URL
      )
    ).toBe(false);
  });
});
