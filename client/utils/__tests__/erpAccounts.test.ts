import {
  getErpAccountByOutboundOrderNo,
  getOutboundOrderSequenceLength,
} from '../erpAccounts';

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
