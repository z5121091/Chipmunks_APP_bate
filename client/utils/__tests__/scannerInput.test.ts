import {
  cancelScanSubmit,
  scheduleScanSubmit,
  hasMatchingTraceNo,
  sanitizeCompactScannerInput,
  sanitizeStructuredScannerInput,
} from '../scannerInput';

describe('scannerInput', () => {
  it('submits the latest input, cancels pending submission, and preserves separate identical scans', () => {
    jest.useFakeTimers();
    try {
      const timer = { current: null as ReturnType<typeof setTimeout> | null };
      const submit = jest.fn();
      scheduleScanSubmit(timer, () => submit('12'), 180);
      scheduleScanSubmit(timer, () => submit('123'), 180);
      jest.advanceTimersByTime(180);
      expect(submit.mock.calls).toEqual([['123']]);
      expect(timer.current).toBeNull();

      scheduleScanSubmit(timer, () => submit('enter'), 180);
      cancelScanSubmit(timer);
      submit('enter');
      jest.advanceTimersByTime(180);
      expect(submit).toHaveBeenCalledTimes(2);

      scheduleScanSubmit(timer, () => submit('cancelled'), 180);
      cancelScanSubmit(timer);
      jest.advanceTimersByTime(180);
      expect(submit).toHaveBeenCalledTimes(2);

      for (let scan = 0; scan < 2; scan += 1) {
        scheduleScanSubmit(timer, () => submit('same'), 180);
        jest.advanceTimersByTime(180);
      }
      expect(submit.mock.calls.slice(2)).toEqual([['same'], ['same']]);
    } finally {
      jest.useRealTimers();
    }
  });

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
