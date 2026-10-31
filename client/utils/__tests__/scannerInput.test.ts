import {
  cancelScanSubmit,
  scheduleScanSubmit,
  scheduleScanSubmitWithCompletionCheck,
  resolvePendingScannerSubmit,
  resolveScannerChangeAfterSubmit,
  resolveScannerTextAfterConsumedPrefix,
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
    ).toBe('\r\n{MODEL}\r\n{LOT}\x1D{100}\r\n');
    expect(sanitizeStructuredScannerInput(' \r\n\t ')).toBe('');
  });

  it('finds a trace number across draft record groups without case sensitivity', () => {
    const records = [{ traceNo: ' abC-001 ' }, { traceNo: 'XYZ-002' }];

    expect(hasMatchingTraceNo(records, 'ABC-001')).toBe(true);
    expect(hasMatchingTraceNo(records, 'xyz-003')).toBe(false);
    expect(hasMatchingTraceNo(records, '')).toBe(false);
  });
});

describe('pending scanner submission', () => {
  it('keeps removing the exact confirmed native prefix across multiple queued changes and accepts its controlled replacement', () => {
    expect(resolveScannerTextAfterConsumedPrefix('PREVIOUS', 'PREVIOUS', 'NEXT/LOT')).toMatchObject({
      text: 'NEXT/LOT', prefix: 'PREVIOUS', ignore: true,
    });
    expect(resolveScannerTextAfterConsumedPrefix('PREVIOUS', 'PREVIOUSNEXT/LOT', 'NEXT')).toEqual({
      text: 'NEXT/LOT', prefix: 'PREVIOUS',
    });
    expect(resolveScannerTextAfterConsumedPrefix('PREVIOUS', 'PREVIOUSNEXT/LOT/100', 'NEXT/LOT')).toEqual({
      text: 'NEXT/LOT/100', prefix: 'PREVIOUS',
    });
    expect(resolveScannerTextAfterConsumedPrefix('PREVIOUS', 'NEXT/LOT/100', 'NEXT/LOT/100')).toEqual({
      text: 'NEXT/LOT/100', prefix: '',
    });
    // 相同无追溯包在原生受控值已跟上后，也不能因内容相同而丢弃。
    expect(resolveScannerTextAfterConsumedPrefix('SAME/100', 'SAME/100', 'SAME/100')).toEqual({
      text: 'SAME/100', prefix: '',
    });
  });
  it('freezes an Enter-confirmed scan before a separate or cumulative next package', () => {
    const previous = 'MODEL/LOT/100/TRACE-1';
    const next = 'MODEL/LOT/100/TRACE-2';
    for (const incoming of [next, previous + next]) {
      expect(resolveScannerChangeAfterSubmit(previous, incoming)).toEqual({
        text: next, completedText: previous, confirmed: false, ignore: false,
      });
    }
    expect(resolveScannerChangeAfterSubmit(previous, previous + previous)).toMatchObject({
      text: previous, completedText: previous, confirmed: false,
    });
  });

  it('only splits at a known Enter boundary and preserves internal QR line endings', () => {
    const previous = 'MODEL\r\nLOT\r\n100';
    const next = 'OTHER\r\nLOT\r\n20';
    expect(resolveScannerChangeAfterSubmit(previous, previous + next)).toMatchObject({
      text: next, completedText: previous,
    });
    expect(resolveScannerChangeAfterSubmit(null, previous + next)).toEqual({
      text: previous + next, confirmed: false, ignore: false,
    });
    expect(resolveScannerChangeAfterSubmit(previous, previous + '\r\n')).toEqual({
      text: previous + '\r\n', confirmed: true, ignore: false,
    });
  });

  it('keeps a confirmed full snapshot when an older prefix arrives and consumes it before a native reset', () => {
    expect(resolveScannerChangeAfterSubmit('MODEL/LOT/100', 'MODEL/LOT')).toMatchObject({ ignore: true });
    expect(resolveScannerChangeAfterSubmit('MODEL/LOT/100', '')).toMatchObject({
      text: '', completedText: 'MODEL/LOT/100', confirmed: false, ignore: false,
    });
  });

  it('uses the full native text only when it extends the unconsumed input', () => {
    expect(resolvePendingScannerSubmit('MODEL/LOT/', 'MODEL/LOT/100\r\n'))
      .toEqual({ text: 'MODEL/LOT/100\r\n', advanced: true });
    expect(resolvePendingScannerSubmit('MODEL/LOT/100', 'MODEL/LOT/100'))
      .toEqual({ text: 'MODEL/LOT/100', advanced: false });
  });

  it('does not resurrect a consumed scan or let an unrelated old Enter replace a new scan', () => {
    expect(resolvePendingScannerSubmit('', 'MODEL/LOT/100')).toBeNull();
    expect(resolvePendingScannerSubmit(' \r\n ', 'MODEL/LOT/100')).toBeNull();
    expect(resolvePendingScannerSubmit('NEW/LOT/20', 'OLD/LOT/100')).toBeNull();
    expect(resolvePendingScannerSubmit('MODEL/LOT/100', '')).toBeNull();
  });

  it('keeps the current longer input when Enter has an earlier prefix', () => {
    expect(resolvePendingScannerSubmit('MODEL/LOT/100\r\n', 'MODEL/LOT/'))
      .toEqual({ text: 'MODEL/LOT/100\r\n', advanced: false });
    expect(resolvePendingScannerSubmit('MODEL/LOT/100'))
      .toEqual({ text: 'MODEL/LOT/100', advanced: false });
  });

  it('compares sanitized content without stripping raw QR line endings or delimiters', () => {
    expect(resolvePendingScannerSubmit('\uFEFFMODEL\0/LOT/', 'MODEL/LOT/100\r\n'))
      .toEqual({ text: 'MODEL/LOT/100\r\n', advanced: true });
    expect(resolvePendingScannerSubmit('MODEL/LOT/100\0', '\uFEFFMODEL/LOT/100'))
      .toEqual({ text: '\uFEFFMODEL/LOT/100', advanced: false });
  });
});

describe('scanner completion timer', () => {
  const advance = async (milliseconds: number) => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('does not treat a matching rule as proof that the last field has finished', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const submit = jest.fn();
    let current = 'MODEL/LOT/100/BOX-';
    const schedule = (text: string) => scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, minimumQuietMs: 500, isCurrent: () => current === text,
      shouldWaitForMore: () => false, submit: () => submit(text),
    });
    schedule(current);
    await advance(150);
    await advance(70);
    expect(submit).not.toHaveBeenCalled();
    current += '12345';
    schedule(current);
    await advance(150);
    await advance(349);
    expect(submit).not.toHaveBeenCalled();
    await advance(1);
    expect(submit.mock.calls).toEqual([['MODEL/LOT/100/BOX-12345']]);
  });

  it('does not add the fallback quiet period to a confirmed native snapshot', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const submit = jest.fn();
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, minimumQuietMs: 500, isCurrent: () => true,
      isConfirmed: () => true, shouldWaitForMore: () => false, submit,
    });
    await advance(150);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not add a full quiet period after a slow asynchronous rule inspection', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    let finish!: (value: boolean) => void;
    const submit = jest.fn();
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => true,
      shouldWaitForMore: () => new Promise(resolve => { finish = resolve; }), submit,
    });
    await advance(600);
    finish(false);
    await advance(0);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('preserves the 150 ms submission speed for complete input', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const submit = jest.fn();
    const inspect = jest.fn(() => false);
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => true, shouldWaitForMore: inspect, submit,
    });
    await advance(149);
    expect(inspect).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await advance(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(timer.current).toBeNull();
  });

  it('waits only one additional 350 ms for missing segments, then submits for normal validation', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const submit = jest.fn();
    const inspect = jest.fn(() => true);
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => true, shouldWaitForMore: inspect, submit,
    });
    await advance(150);
    expect(submit).not.toHaveBeenCalled();
    await advance(349);
    expect(submit).not.toHaveBeenCalled();
    await advance(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('cannot submit or replace a newer timer after stale async inspection resolves to %s', async result => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    let revision = 1;
    let resolveOld!: (value: boolean) => void;
    const oldInspection = new Promise<boolean>(resolve => { resolveOld = resolve; });
    const submit = jest.fn();
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => revision === 1,
      shouldWaitForMore: () => oldInspection, submit: () => submit('prefix'),
    });
    await advance(150);
    revision = 2;
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => revision === 2,
      shouldWaitForMore: () => false, submit: () => submit('complete'),
    });
    resolveOld(result);
    await advance(149);
    expect(submit).not.toHaveBeenCalled();
    await advance(1);
    expect(submit.mock.calls).toEqual([['complete']]);
    await advance(1000);
    expect(submit.mock.calls).toEqual([['complete']]);
  });

  it('invalidates a continuation timer on a later input or page session', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    let current = true;
    const submit = jest.fn();
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => current, shouldWaitForMore: () => true, submit,
    });
    await advance(150);
    current = false;
    await advance(350);
    expect(submit).not.toHaveBeenCalled();
  });

  it('hands a failed preliminary inspection to the original validation path once', async () => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const submit = jest.fn();
    scheduleScanSubmitWithCompletionCheck(timer, {
      delay: 150, isCurrent: () => true,
      shouldWaitForMore: async () => { throw new Error('Rules unavailable'); }, submit,
    });
    await advance(150);
    expect(submit).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
