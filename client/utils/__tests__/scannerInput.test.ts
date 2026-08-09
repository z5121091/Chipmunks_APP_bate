import {
  hasMatchingTraceNo,
  sanitizeCompactScannerInput,
  sanitizeStructuredScannerInput,
} from '../scannerInput';

describe('scannerInput', () => {
  it('normalizes scanner whitespace and edge separators', () => {
    expect(sanitizeCompactScannerInput('\r\n,MODEL/LOT/100,\t')).toBe('MODEL/LOT/100');
  });

  it('preserves separators and hidden characters inside structured QR content', () => {
    expect(
      sanitizeStructuredScannerInput('\uFEFF\r\n{MODEL}\r\n{LOT}\x1D{100}\u0000\r\n')
    ).toBe('{MODEL}\r\n{LOT}\x1D{100}');
  });

  it('finds a trace number across draft record groups without case sensitivity', () => {
    const records = [{ traceNo: ' abC-001 ' }, { traceNo: 'XYZ-002' }];

    expect(hasMatchingTraceNo(records, 'ABC-001')).toBe(true);
    expect(hasMatchingTraceNo(records, 'xyz-003')).toBe(false);
    expect(hasMatchingTraceNo(records, '')).toBe(false);
  });
});
