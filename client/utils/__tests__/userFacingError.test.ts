import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

describe('formatUserFacingErrorMessage', () => {
  it('translates common backend authentication and rate-limit errors', () => {
    expect(formatUserFacingErrorMessage('Unauthorized backend request')).toBe(
      '后端拒绝访问，请检查应用访问密钥'
    );
    expect(formatUserFacingErrorMessage('Too many requests, please retry later')).toBe(
      '请求过于频繁，请稍后再试'
    );
  });

  it('translates network and backend status errors', () => {
    expect(formatUserFacingErrorMessage(new TypeError('Failed to fetch'))).toBe(
      '无法连接服务器，请检查网络、域名和服务器运行状态'
    );
    expect(formatUserFacingErrorMessage('Backend request failed with status 404')).toBe(
      '后端接口请求失败（状态码 404）'
    );
  });

  it('explains expired ERP authorization and keeps existing Chinese details', () => {
    expect(
      formatUserFacingErrorMessage(
        'Stored openToken is expired and no refreshToken is available. Authorize the account again.'
      )
    ).toBe('ERP授权已过期或尚未完成，请重新授权当前账套');
    expect(formatUserFacingErrorMessage('采购入库单已审核')).toBe('采购入库单已审核');
  });

  it('hides unknown English-only implementation errors from users', () => {
    expect(formatUserFacingErrorMessage('Some internal implementation detail')).toBe(
      '操作失败，请稍后重试'
    );
  });
});

