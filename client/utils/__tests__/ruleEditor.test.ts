jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { analyzeQRCodeRuleDetection, detectRule, inspectQRCodeRule, parseWithRule, type QRCodeRule } from '../database';
import { parseQuantity } from '../quantity';
import { matchesRuleCondition, nextIgnoredRuleField, visualizeScanCharacters, suggestRuleFieldPrefix, suggestRuleSeparators, type ConditionOperator } from '../ruleConditions';

const rule: QRCodeRule = {
  id: 'demo', name: 'Demo', description: '', separator: '/',
  fieldOrder: ['ignore:1', 'model', 'quantity'], isActive: true, created_at: '', updated_at: '',
};

describe('rule editor diagnostics', () => {
  it('recommends separators for real samples without guessing fields', () => {
    expect(suggestRuleSeparators('08-Feb-26 ICW1117A50S3G SOT223 CP GQ06160 2500')[0])
      .toEqual({ value: ' ', label: '空格', fieldCount: 6 });
    expect(suggestRuleSeparators('PN:QM4051&QTY:8000 PCS&DATE:2026/08/06;')[0].value).toBe('&');
    expect(suggestRuleSeparators('A\r\nB\r\n100\r\n')).toEqual([{ value: '\r\n', label: '回车换行', fieldCount: 3 }]);
    expect(suggestRuleSeparators('A||B||100')[0]).toEqual({ value: '||', label: '||', fieldCount: 3 });
    expect(suggestRuleSeparators('{A}{100}')[0].value).toBe('{}');
    expect(suggestRuleSeparators('A~B~100', ['~'])[0].value).toBe('~');
    expect(suggestRuleSeparators('MODEL-123')).toEqual([]);
    expect(suggestRuleSeparators('https://example.com/A')).toEqual([]);
  });

  it('detects generic prefix syntax without relying on field-name presets', () => {
    expect(suggestRuleFieldPrefix('PART NO.:QM4051PW', '/')).toBe('PART NO.:');
    expect(suggestRuleFieldPrefix('QTY:8000 PCS', '/')).toBe('QTY:');
    expect(suggestRuleFieldPrefix('P/N:LTC8836XS8/R8', ',')).toBe('P/N:');
    expect(suggestRuleFieldPrefix('D/C:S-O5D', ',')).toBe('D/C:');
    expect(suggestRuleFieldPrefix('LTC8836XS8/R8', ',')).toBe('');
    expect(suggestRuleFieldPrefix('CUSTOM<>VALUE', '/')).toBe('CUSTOM<>');
    expect(suggestRuleFieldPrefix('IC:555', ':')).toBe('');

    const prefixed = {
      ...rule,
      fieldOrder: ['model', 'quantity'],
      fieldPrefixes: { model: 'PART NO.:', quantity: 'QTY:' },
    };
    const inspection = inspectQRCodeRule('PART NO.:QM4051PW;QTY:8000 PCS', {
      ...prefixed,
      separator: ';',
    });
    expect(inspection.values).toEqual(['QM4051PW', '8000 PCS']);
    expect(parseQuantity(inspection.values[1])).toBe(8000);
    expect(parseWithRule('PART NO.:QM4051PW;QTY:8000 PCS', {
      ...prefixed,
      separator: ';',
    }).standardFields).toEqual({ model: 'QM4051PW', quantity: '8000 PCS' });
  });
  it.each<[ConditionOperator | undefined, string, boolean]>([
    [undefined, 'XPO-123', true], ['contains', 'XPO-123', true],
    ['startsWith', 'PO-123', true], ['startsWith', 'XPO-123', false],
    ['equals', 'PO-', true], ['equals', 'PO-123', false],
    ['endsWith', '123PO-', true], ['endsWith', 'PO-123', false],
  ])('matches operator %s against %s', (operator, text, expected) => {
    expect(matchesRuleCondition(text, { operator, keyword: 'po-' })).toBe(expected);
  });

  it('keeps old contains semantics and requires every condition', async () => {
    const legacy = { ...rule, matchConditions: [{ fieldIndex: 0, keyword: 'PO-' }] };
    await expect(detectRule('XPO-123/A/100', [legacy])).resolves.toBe(legacy);
    const strict = { ...rule, matchConditions: [
      { fieldIndex: 0, keyword: 'PO-', operator: 'startsWith' as const },
      { fieldIndex: 1, keyword: 'A', operator: 'equals' as const },
    ] };
    expect(inspectQRCodeRule('XPO-123/A/100', strict).errors).toContain('第1段不满足“开头是 PO-”');
    await expect(detectRule('PO-123/AB/100', [strict])).resolves.toBeNull();
    await expect(detectRule('PO-123/A/100', [strict])).resolves.toBe(strict);
  });

  it('reports counts and prefix failures using the live detector', async () => {
    const prefixed = { ...rule, fieldPrefixes: { model: 'PN:' } };
    const diagnostic = inspectQRCodeRule('PO-1/OTHER:A/100/extra', prefixed);
    expect(diagnostic.errors).toEqual(['需要3段，实际4段', '第2段前缀不匹配：PN:']);
    await expect(detectRule('PO-1/OTHER:A/100/extra', [prefixed])).resolves.toBeNull();
    const good = inspectQRCodeRule('PO-1/PN:A/100', prefixed);
    expect(good).toMatchObject({ matched: true, values: ['PO-1', 'A', '100'] });
  });

  it('ignores local fields without losing positional conditions or polluting business data', () => {
    expect(nextIgnoredRuleField(['ignore:1', 'ignore:3'])).toBe('ignore:2');
    expect(parseWithRule('PO-1/A/100', rule)).toEqual({ standardFields: { model: 'A', quantity: '100' }, customFields: {} });
    const mixed = { ...rule, fieldOrder: ['ignore:1', 'custom:old', 'quantity'] };
    expect(parseWithRule('PO-1/A/100', mixed)).toEqual({ standardFields: { quantity: '100' }, customFields: {} });
  });

  it('exposes hidden characters without mutating the sample', () => {
    const raw = 'A \r\nB\t\x1D\x1E\x04\u200b';
    expect(visualizeScanCharacters(raw)).toBe('A【空格】【CR】【LF】\nB【TAB】【GS】【RS】【EOT】【U+200B】');
    expect(raw).toBe('A \r\nB\t\x1D\x1E\x04\u200b');
  });

  it('exposes all overlapping matches while live detection still rejects equal-priority conflicts', async () => {
    const other = { ...rule, id: 'other', name: 'Other', fieldOrder: ['ignore:1', 'batch', 'quantity'] };
    expect([rule, other].filter(item => inspectQRCodeRule('PO-1/A/100', item).matched)).toHaveLength(2);
    await expect(detectRule('PO-1/A/100', [rule, other])).rejects.toThrow('同时匹配多个解析规则');
  });

  it('uses the same live priority analysis to distinguish a prefixed rule from a broad rule', () => {
    const generic: QRCodeRule = {
      ...rule,
      id: 'generic',
      name: 'Generic',
      fieldOrder: ['model', 'batch', 'quantity'],
    };
    const prefixed: QRCodeRule = {
      ...generic,
      id: 'prefixed',
      name: 'Prefixed',
      fieldPrefixes: { model: 'PN:' },
    };

    const analysis = analyzeQRCodeRuleDetection('PN:MODEL/LOT/100', [generic, prefixed]);
    expect(analysis.matchedRules.map(item => item.id)).toEqual(['generic', 'prefixed']);
    expect(analysis.selectedRule?.id).toBe('prefixed');
    expect(analysis.conflictingRules).toEqual([]);
  });

  it('reports only truly equal-priority matches as conflicts in editor analysis', () => {
    const other: QRCodeRule = {
      ...rule,
      id: 'other',
      name: 'Other',
      fieldOrder: ['model', 'package', 'quantity'],
    };

    const analysis = analyzeQRCodeRuleDetection('MODEL/PKG/100', [
      { ...rule, fieldOrder: ['model', 'batch', 'quantity'] },
      other,
    ]);
    expect(analysis.selectedRule).toBeNull();
    expect(analysis.conflictingRules.map(item => item.name).sort()).toEqual(['Demo', 'Other']);
  });

  it('distinguishes the real eight-segment Boya layout from the broad Jihai layout by prefixes', () => {
    const jihai: QRCodeRule = {
      id: 'jihai', name: '极海半导体', description: '', separator: '/',
      fieldOrder: ['model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo'],
      isActive: true, created_at: '', updated_at: '',
    };
    const boya: QRCodeRule = {
      id: 'boya', name: '博雅', description: '', separator: '/',
      fieldOrder: ['ignore:1', 'model', 'package', 'quantity', 'batch', 'productionDate', 'sourceNo', 'ignore:2'],
      fieldPrefixes: {
        model: 'PART NO.:', package: 'PACKAGE:', quantity: 'QUANTITY:',
        batch: 'LOT ID:', productionDate: 'DATE CODE:', sourceNo: 'Track ID:',
      },
      isActive: true, created_at: '', updated_at: '',
    };
    const boya2: QRCodeRule = {
      ...boya,
      id: 'boya-2',
      name: '博雅_2',
      fieldOrder: ['ignore:1', 'model', 'package', 'quantity', 'batch', 'productionDate', 'ignore:2', 'sourceNo'],
    };
    const content = 'BOYA MICROELECTRONICS/PART NO.:BY25Q128ESSIG(R)/PACKAGE:SOP8-208MIL/QUANTITY:4000/LOT ID:AP5V193/DATE CODE:2632/Track ID:BY20260916001/MSL3';

    const analysis = analyzeQRCodeRuleDetection(content, [jihai, boya, boya2]);
    expect(analysis.selectedRule?.id).toBe('boya');
    expect(analysis.conflictingRules).toEqual([]);
  });

  it('reports empty input and URL exclusions, and supports a custom ending', () => {
    expect(inspectQRCodeRule('', rule).matched).toBe(false);
    expect(inspectQRCodeRule('https://A/100', rule).errors).toContain('网址不作为物料二维码解析');
    expect(inspectQRCodeRule('PO-1/A/100END\r\n', { ...rule, terminator: 'END' }))
      .toMatchObject({ matched: true, values: ['PO-1', 'A', '100'] });
  });
});
