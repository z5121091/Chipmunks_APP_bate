jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { QRCodeRule } from '../database';
import { recoverConfirmedScannerContent } from '../qrcodeParser';

const rule: QRCodeRule = {
  id: 'three-fields', name: 'Three fields', description: '', separator: '/',
  fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '',
};
const first = 'MODEL/LOT-1/100';
const next = 'MODEL/LOT-2/100';

describe('confirmed scanner frame recovery', () => {
  it('recovers a complete second frame after a confirmed first frame remains in native input', () => {
    expect(recoverConfirmedScannerContent(first + next, first, [rule])).toBe(next);
    const third = 'MODEL/LOT-3/100';
    expect(recoverConfirmedScannerContent(first + next + third, first + next, [rule])).toBe(third);
  });

  it('keeps an identical independent no-trace package intact', () => {
    expect(recoverConfirmedScannerContent(first, first, [rule])).toBe(first);
    expect(recoverConfirmedScannerContent(first + first, first, [rule])).toBe(first);
  });

  it('preserves a valid longer trace even when the whole previous QR is its prefix', () => {
    const traceRule = { ...rule, fieldOrder: ['model', 'batch', 'quantity', 'traceNo'] };
    const old = first + '/TRACE-1';
    const longer = first + '/TRACE-10';
    expect(recoverConfirmedScannerContent(longer, old, [traceRule])).toBe(longer);
  });

  it.each([null, '', 'UNRELATED/LOT/100'])('does not infer an unknown boundary from %s', confirmed => {
    expect(recoverConfirmedScannerContent(first + next, confirmed, [rule])).toBe(first + next);
  });

  it('does not cut unknown or incomplete suffixes for the business detector', () => {
    for (const suffix of ['MODEL', 'MODEL/LOT', 'UNRECOGNIZED;LOT;100']) {
      expect(recoverConfirmedScannerContent(first + suffix, first, [rule])).toBe(first + suffix);
    }
  });

  it('preserves the original when another active rule can parse the whole input', () => {
    const longerRule = { ...rule, id: 'longer', fieldOrder: ['model', 'batch', 'version', 'package', 'quantity'] };
    expect(recoverConfirmedScannerContent(first + next, first, [rule, longerRule])).toBe(first + next);
  });

  it('leaves conflicting suffix rules for the actual detector to resolve', () => {
    const other = { ...rule, id: 'other', fieldOrder: ['batch', 'model', 'quantity'] };
    expect(recoverConfirmedScannerContent(first + next, first, [rule, other])).toBe(next);
  });

  it.each(['\r\n', '\n', '\r'])('preserves the exact contents of line-delimited frames using %j', separator => {
    const lines = { ...rule, separator };
    const old = `MODEL${separator}LOT-1${separator}100${separator}`;
    const rawNext = `MODEL${separator}LOT-2${separator}100${separator}`;
    expect(recoverConfirmedScannerContent(old + rawNext, old, [lines])).toBe(rawNext);
  });

  it('does not use missing, disabled or malformed rules to guess a boundary', () => {
    for (const rules of [[], [{ ...rule, isActive: false }], [{ ...rule, separator: '' }], [{ ...rule, fieldOrder: [] }]]) {
      expect(recoverConfirmedScannerContent(first + next, first, rules)).toBe(first + next);
    }
  });
});
