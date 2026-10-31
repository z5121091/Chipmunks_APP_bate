jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { inspectQRCodeRule, parseWithRule, type QRCodeRule } from '../database';
import { nextLabelTraceNo, rewriteLabelQrQuantity } from '../labelQrQuantity';

const rule = (fieldOrder: string[], separator = '/', extra: Partial<QRCodeRule> = {}): QRCodeRule => ({
  id: 'rewrite-fixture', name: '数量修正测试规则', description: '', separator, fieldOrder,
  isActive: true, created_at: '', updated_at: '', ...extra,
});
const apmFields = ['model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo'];
const vendors = [
  {
    name: '沁恒',
    raw: 'CH334U,31317.TB,---,QSOP28,313174G25,2500,20260923,China,W52609160004006-1',
    rule: rule(['model', 'version', 'ignore:1', 'package', 'batch', 'quantity', 'productionDate', 'ignore:2', 'traceNo'], ','),
    expected: 'CH334U,31317.TB,---,QSOP28,313174G25,123,20260923,China,W52609160004006-2', trace: 'W52609160004006-2',
  },
  {
    name: '极海', raw: 'APM32F103RBT6/NYORY/LQFP64/801204300041/960/2436/BT7124009010023-10/OPGD144429023',
    rule: rule(apmFields),
    expected: 'APM32F103RBT6/NYORY/LQFP64/801204300041/123/2436/BT7124009010023-11/OPGD144429023', trace: 'BT7124009010023-11',
  },
  {
    name: '领芯', raw: 'LX32F003F6P6/V01H1/LQFP64/811206700006/5000/2510/BT7125032100-2/IPCG0195321006',
    rule: rule(apmFields),
    expected: 'LX32F003F6P6/V01H1/LQFP64/811206700006/123/2510/BT7125032100-3/IPCG0195321006', trace: 'BT7125032100-3',
  },
  {
    name: '博雅长码', raw: 'BOYA MICROELECTRONICS/\r\nPART NO.:BY25Q128ESSIG(R)/\r\nPACKAGE:SOP8-208MIL/\r\nQUANTITY:4000/\r\nLOT ID:AP5G751/\r\nDATE CODE:2620/Track ID:\r\nTP260619006-00100/MSL3',
    rule: rule(['ignore:1', 'model', 'package', 'quantity', 'batch', 'productionDate', 'sourceNo', 'ignore:2'], '/', {
      fieldPrefixes: { model: 'PART NO.:', package: 'PACKAGE:', quantity: 'QUANTITY:', batch: 'LOT ID:', productionDate: 'DATE CODE:', sourceNo: 'Track ID:' },
    }),
    expected: 'BOYA MICROELECTRONICS/\r\nPART NO.:BY25Q128ESSIG(R)/\r\nPACKAGE:SOP8-208MIL/\r\nQUANTITY:123/\r\nLOT ID:AP5G751/\r\nDATE CODE:2620/Track ID:\r\nTP260619006-00100/MSL3', trace: '',
  },
  {
    name: '博雅短码', raw: 'BY25Q128ESSIG(R)/SOP8-208MIL/240/AP5P268/2617/SP26041131',
    rule: rule(['model', 'package', 'quantity', 'batch', 'productionDate', 'sourceNo']),
    expected: 'BY25Q128ESSIG(R)/SOP8-208MIL/123/AP5P268/2617/SP26041131', trace: '',
  },
  {
    name: '盈力', raw: 'UM123;2000;TRACE;LOT123;BOX-1;V1;2610',
    rule: rule(['model', 'quantity', 'traceNo', 'batch', 'sourceNo', 'version', 'productionDate'], ';'),
    expected: 'UM123;123;TRACE-1;LOT123;BOX-1;V1;2610', trace: 'TRACE-1',
  },
  {
    name: '东微', raw: 'SFS10R09UNNF;1009UN;PDFN3.3*3.3;70I0BH6770001;2000;G36PE01N;1-4;',
    rule: rule(['model', 'version', 'package', 'batch', 'quantity', 'productionDate', 'sourceNo'], ';'),
    expected: 'SFS10R09UNNF;1009UN;PDFN3.3*3.3;70I0BH6770001;123;G36PE01N;1-4;', trace: '',
  },
  {
    name: '荣湃', raw: 'Pai8485E-W1R;A552588.1;2528HE;1500;2507260140109;A;LEVEL2;3001-250721001;1;01-A0162;',
    rule: rule(['model', 'batch', 'productionDate', 'quantity', 'traceNo', 'ignore:1', 'version', 'sourceNo', 'ignore:2', 'package'], ';'),
    expected: 'Pai8485E-W1R;A552588.1;2528HE;123;2507260140109-1;A;LEVEL2;3001-250721001;1;01-A0162;', trace: '2507260140109-1',
  },
];

describe('label quantity source rewriting', () => {
  it.each(vendors)('rewrites $name exact quantity/trace bytes and no other fields', fixture => {
    expect(rewriteLabelQrQuantity(fixture.raw, fixture.rule, 123)).toEqual({
      sourceQr: fixture.expected, quantity: 123, traceNo: fixture.trace,
    });
    const before = parseWithRule(fixture.raw, fixture.rule).standardFields;
    const after = parseWithRule(fixture.expected, fixture.rule).standardFields;
    for (const field of Object.keys(before)) {
      if (field !== 'quantity' && field !== 'traceNo') expect(after[field]).toBe(before[field]);
    }
  });

  it.each(vendors)('same quantity preserves $name original bytes and trace', fixture => {
    const parsed = parseWithRule(fixture.raw, fixture.rule).standardFields;
    expect(rewriteLabelQrQuantity(fixture.raw, fixture.rule, Number(parsed.quantity))).toEqual({
      sourceQr: fixture.raw, quantity: Number(parsed.quantity), traceNo: parsed.traceNo || '',
    });
  });

  it('allows greater quantity; preserves prefix spelling, spacing, units, endings and equal-valued ignored fields', () => {
    const configured = rule(['model', 'quantity', 'ignore:1', 'traceNo', 'sourceNo'], ';', {
      terminator: 'END\r\n', fieldPrefixes: { quantity: 'QTY:', traceNo: 'TRACE:' },
    });
    const raw = '  M; q T y:  0005 PCS \r\n;5; Tr Ac E:\r\n ABC-9 ;ABC-9END\r\n\t';
    const result = rewriteLabelQrQuantity(raw, configured, 10000);
    expect(result.sourceQr).toBe('  M; q T y:  10000 PCS \r\n;5; Tr Ac E:\r\n ABC-10 ;ABC-9END\r\n\t');
    expect(result.quantity).toBe(10000);
  });

  it.each(['{}', '[]', '()', '【】'])('preserves %s bracket format and scanner ending', brackets => {
    const [left, right] = Array.from(brackets);
    const raw = ` \r\n${left}M${right}${left} 5 ${right}${left}T-1${right}END\r\n\t`;
    const configured = rule(['model', 'quantity', 'traceNo'], brackets, { terminator: 'END\r\n' });
    expect(rewriteLabelQrQuantity(raw, configured, 9).sourceQr)
      .toBe(` \r\n${left}M${right}${left} 9 ${right}${left}T-2${right}END\r\n\t`);
  });

  it('preserves dates containing the same separator and spaces while locating later quantity and trace', () => {
    const configured = rule(['model', 'productionDate', 'quantity', 'traceNo']);
    const raw = 'M/2026 / 10 / 19/240/T-99';
    expect(inspectQRCodeRule(raw, configured).matched).toBe(true);
    expect(rewriteLabelQrQuantity(raw, configured, 1).sourceQr).toBe('M/2026 / 10 / 19/1/T-100');
  });

  it.each([';', ';;'])('keeps required empty trace and extra trailing separator (%j)', tail => {
    const configured = rule(['model', 'quantity', 'traceNo'], ';', { terminator: ';' });
    expect(rewriteLabelQrQuantity(`M;5${tail}`, configured, 6)).toEqual({
      sourceQr: `M;6${tail}`, quantity: 6, traceNo: '',
    });
  });

  it('supports legacy appended ignored fields without changing those bytes', () => {
    const configured = rule(['model', 'quantity', 'traceNo'], ';', { customFieldIds: ['legacy'] });
    expect(rewriteLabelQrQuantity('M;5;T;KEEP;', configured, 6).sourceQr).toBe('M;6;T-1;KEEP;');
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s', quantity => {
    expect(() => rewriteLabelQrQuantity('M/5/T', rule(['model', 'quantity', 'traceNo']), quantity)).toThrow('大于 0 的整数');
  });

  it('accepts the largest safe positive integer', () => {
    expect(rewriteLabelQrQuantity('M/5/T', rule(['model', 'quantity', 'traceNo']), Number.MAX_SAFE_INTEGER).sourceQr)
      .toBe(`M/${Number.MAX_SAFE_INTEGER}/T-1`);
  });

  it('refuses a rule that does not match original content', () => {
    expect(() => rewriteLabelQrQuantity('M/5/T', rule(['model', 'quantity', 'traceNo'], ';'), 6))
      .toThrow('原标签与解析规则不一致');
  });

  it('refuses a change that violates original identification conditions', () => {
    const configured = rule(['model', 'quantity', 'traceNo'], '/', {
      matchConditions: [{ fieldIndex: 1, operator: 'equals', keyword: '5' }],
    });
    expect(() => rewriteLabelQrQuantity('M/5/T', configured, 6)).toThrow('不再符合原解析规则');
  });

  it('rejects duplicate target fields instead of editing whichever happened to parse last', () => {
    expect(() => rewriteLabelQrQuantity('M/5/5/T', rule(['model', 'quantity', 'quantity', 'traceNo']), 6)).toThrow('重复或缺失');
    expect(() => rewriteLabelQrQuantity('M/5/T/T', rule(['model', 'quantity', 'traceNo', 'traceNo']), 6)).toThrow('重复或缺失');
  });

  it('refuses unrecognized quantities without editing content', () => {
    expect(() => rewriteLabelQrQuantity('M/1.5/T', rule(['model', 'quantity', 'traceNo']), 6)).toThrow('没有有效的数量');
  });
});

describe('label trace suffix', () => {
  it.each([
    ['', ''], ['ABC', 'ABC-1'], ['ABC-1', 'ABC-2'], ['ABC-9', 'ABC-10'], ['ABC-99', 'ABC-100'],
    ['ABC-009', 'ABC-010'], ['ABC-1-2', 'ABC-1-3'], ['ABC-X', 'ABC-X-1'],
    ['ABC-999999999999999999999999', 'ABC-1000000000000000000000000'],
  ])('increments %j to %j without numeric overflow', (input, expected) => {
    expect(nextLabelTraceNo(input)).toBe(expected);
  });
});
