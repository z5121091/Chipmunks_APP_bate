import {
  ERP_ACCOUNTS,
  getErpAccountByOutboundOrderNo,
  getOutboundOrderSequenceLength,
} from '../erpAccounts';
import { resolveErpPublicGatewayMode } from '../backendApi';

describe('ERP account backend defaults', () => {
  it('uses HTTPS so web previews and APKs do not make mixed-content requests', () => {
    expect(ERP_ACCOUNTS[0]?.backendBaseUrl).toBe('https://erp.chipmunks.fun');
  });

  it('enables both production ERP accounts through the HTTPS gateway by default', () => {
    expect(
      ERP_ACCOUNTS.map(({ backendBaseUrl, erpEnabled, key }) => ({
        backendBaseUrl,
        erpEnabled,
        key,
      }))
    ).toEqual([
      {
        backendBaseUrl: 'https://erp.chipmunks.fun',
        erpEnabled: true,
        key: 'shanghai-chipmunk',
      },
      {
        backendBaseUrl: 'https://erp.chipmunks.fun',
        erpEnabled: true,
        key: 'wuxi-duneng',
      },
    ]);
  });

  it('bypasses the Coze backend sandbox for ERP requests', () => {
    expect(
      resolveErpPublicGatewayMode({
        backendBaseUrl: 'https://project.dev.coze.site',
        cozeProjectId: 'coze-project',
      })
    ).toBe(true);
  });

  it('routes both accounts through the public gateway in a Coze build', () => {
    const previousEnv = process.env;

    try {
      process.env = {
        ...previousEnv,
        EXPO_PUBLIC_BACKEND_BASE_URL: 'https://project.dev.coze.site',
        EXPO_PUBLIC_COZE_PROJECT_ID: 'coze-project',
      };
      jest.resetModules();

      const { ERP_ACCOUNTS: cozeAccounts } = jest.requireActual<
        typeof import('../erpAccounts')
      >('../erpAccounts');

      expect(cozeAccounts.map(({ backendBaseUrl }) => backendBaseUrl)).toEqual([
        'https://erp.chipmunks.fun',
        'https://erp.chipmunks.fun',
      ]);
    } finally {
      process.env = previousEnv;
      jest.resetModules();
    }
  });

  it('keeps the local web backend proxy outside Coze', () => {
    expect(
      resolveErpPublicGatewayMode({
        backendBaseUrl: 'http://localhost:19007',
      })
    ).toBe(false);
  });

  it('uses the public ERP gateway for standalone APK builds without a backend URL', () => {
    expect(resolveErpPublicGatewayMode({})).toBe(true);
  });
});

describe('ERP account routing by outbound voucher number', () => {
  test.each([
    ['IO-2026-06-08-001', 3, 'wuxi-duneng'],
    ['io/2026/06/08/99', 2, 'shanghai-chipmunk'],
    [' IO_2026_06_08_123 ', 3, 'wuxi-duneng'],
  ])('routes %s by its final sequence length', (voucherCode, length, accountKey) => {
    expect(getOutboundOrderSequenceLength(voucherCode)).toBe(length);
    expect(getErpAccountByOutboundOrderNo(voucherCode)?.key).toBe(accountKey);
  });

  test.each(['', 'II-2026-06-08-001'])(
    'rejects malformed or non-outbound voucher number %s',
    (voucherCode) => {
      expect(getOutboundOrderSequenceLength(voucherCode)).toBeNull();
      expect(getErpAccountByOutboundOrderNo(voucherCode)).toBeNull();
    }
  );

  test.each(['IO-2026-06-08-1', 'IO-2026-06-08-0001'])(
    'does not route unsupported sequence length %s',
    (voucherCode) => {
      expect(getErpAccountByOutboundOrderNo(voucherCode)).toBeNull();
    }
  );
});
