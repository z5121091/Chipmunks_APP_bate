jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import * as database from '../database';
import { shouldWaitForQRCodeContinuation } from '../qrcodeParser';
import { scheduleScanSubmitWithCompletionCheck } from '../scannerInput';

const rule: database.QRCodeRule = {
  id: 'scanner-rule', name: 'Scanner rule', description: '', separator: '/',
  fieldOrder: ['model', 'batch', 'quantity'], isActive: true,
  created_at: '', updated_at: '',
};

describe('QR input completion with the real rule inspector', () => {
  it('only requests grace for missing fields, not complete valid QR data', () => {
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT', [rule])).toBe(true);
    expect(shouldWaitForQRCodeContinuation('MODEL', [rule])).toBe(true);
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT/100', [rule])).toBe(false);
  });

  it('lets a complete matching rule win over another longer rule', () => {
    const longer = { ...rule, id: 'longer', fieldOrder: ['model', 'batch', 'quantity', 'traceNo'] };
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT/100', [longer, rule])).toBe(false);
  });

  it('does not delay when there are no usable active rules', () => {
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT', [])).toBe(false);
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT', [{ ...rule, fieldOrder: [] }])).toBe(false);
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT', [{ ...rule, separator: '' }])).toBe(false);
    expect(shouldWaitForQRCodeContinuation(' \r\n ', [rule])).toBe(false);
  });

  it.each(['\r\n', '\n', '\r'])('uses real field splitting for line separator %j', separator => {
    const lines = { ...rule, separator };
    expect(shouldWaitForQRCodeContinuation(`MODEL${separator}LOT`, [lines])).toBe(true);
    expect(shouldWaitForQRCodeContinuation(`MODEL${separator}LOT${separator}100${separator}`, [lines])).toBe(false);
  });

  it('preserves bracket field parsing and the configured terminator behavior', () => {
    const brackets = { ...rule, separator: '{}' };
    expect(shouldWaitForQRCodeContinuation('{MODEL}{LOT}', [brackets])).toBe(true);
    expect(shouldWaitForQRCodeContinuation('{MODEL}{LOT}{100}', [brackets])).toBe(false);
    expect(shouldWaitForQRCodeContinuation('MODEL/LOT/100END\r\n', [{ ...rule, terminator: 'END' }])).toBe(false);
  });

  it('does not mistake slash-delimited date pieces for extra material fields', () => {
    const dated = { ...rule, fieldOrder: ['model', 'productionDate', 'quantity', 'traceNo'] };
    const full = 'MODEL/2026/10/14/100/TRACE-1';
    expect(database.inspectQRCodeRule(full, dated)).toMatchObject({
      matched: true, parts: ['MODEL', '2026/10/14', '100', 'TRACE-1'],
    });
    expect(shouldWaitForQRCodeContinuation(full, [dated])).toBe(false);
  });

  it('does not hide a complete unknown QR or invoke the business detector during preliminary inspection', () => {
    const detector = jest.spyOn(database, 'detectRule');
    try {
      const restricted = { ...rule, matchConditions: [{ fieldIndex: 0, operator: 'startsWith' as const, keyword: 'LX' }] };
      expect(shouldWaitForQRCodeContinuation('OTHER/LOT/100', [restricted])).toBe(false);
      const unrelated = { ...rule, id: 'comma-rule', separator: ',',
        fieldOrder: ['model', 'batch', 'quantity', 'traceNo'] };
      expect(shouldWaitForQRCodeContinuation('OTHER/LOT/100', [restricted, unrelated])).toBe(false);
      expect(detector).not.toHaveBeenCalled();
    } finally {
      detector.mockRestore();
    }
  });

  it('does not delay a real conflict or choose a rule to suppress it', () => {
    const other = { ...rule, id: 'conflicting-rule', fieldOrder: ['batch', 'model', 'quantity'] };
    const content = 'MODEL/LOT/100';
    expect(database.analyzeQRCodeRuleDetection(content, [rule, other]).conflictingRules)
      .toHaveLength(2);
    const detector = jest.spyOn(database, 'detectRule');
    try {
      expect(shouldWaitForQRCodeContinuation(content, [rule, other])).toBe(false);
      expect(detector).not.toHaveBeenCalled();
    } finally {
      detector.mockRestore();
    }
  });

  it('keeps matched data at 150 ms and retains incomplete data for one bounded continuation period', async () => {
    jest.useFakeTimers();
    try {
      const timer = { current: null as ReturnType<typeof setTimeout> | null };
      const submit = jest.fn();
      let raw = 'MODEL/LOT/100';
      scheduleScanSubmitWithCompletionCheck(timer, {
        delay: 150, isCurrent: () => true,
        shouldWaitForMore: () => shouldWaitForQRCodeContinuation(raw, [rule]),
        submit: () => submit(raw),
      });
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      expect(submit.mock.calls).toEqual([['MODEL/LOT/100']]);
      raw = 'MODEL/LOT';
      scheduleScanSubmitWithCompletionCheck(timer, {
        delay: 150, isCurrent: () => true,
        shouldWaitForMore: () => shouldWaitForQRCodeContinuation(raw, [rule]),
        submit: () => submit(raw),
      });
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      expect(submit).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(349);
      expect(submit).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(submit.mock.calls).toEqual([['MODEL/LOT/100'], ['MODEL/LOT']]);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
