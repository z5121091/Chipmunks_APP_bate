jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { detectRule, parseWithRule, type QRCodeRule } from '../database';
import { isQRCode } from '../qrcodeParser';
import { sanitizeStructuredScannerInput } from '../scannerInput';
import { parseQuantity } from '../quantity';
import { migrateLegacyRuleFields } from '../legacyRuleFields';
import { decodeRuleTerminator, displayRuleTerminator, stripRuleTerminator } from '../ruleTerminator';

describe('二维码规则解析', () => {
  it('decodes the photographed ICW label as six space-separated fields without a terminator', async () => {
    const content = '08-Feb-26 ICW1117A50S3G SOT223 CP GQ06160 2500';
    const rule: QRCodeRule = {
      id: 'icw-space', name: 'ICW', description: '', separator: ' ',
      fieldOrder: ['productionDate', 'model', 'package', 'custom:unused', 'batch', 'quantity'],
      isActive: true, created_at: '', updated_at: '',
    };
    expect(isQRCode(content, [rule])).toBe(true);
    await expect(detectRule(content, [rule])).resolves.toEqual(migrateLegacyRuleFields(rule));
    expect(parseWithRule(content, rule)).toEqual({
      standardFields: { productionDate: '08-Feb-26', model: 'ICW1117A50S3G', package: 'SOT223', batch: 'GQ06160', quantity: '2500' },
      customFields: {},
    });
  });

  it.each(['', ';'])('preserves required empty last fields while ignoring surplus same-delimiter endings (%j)', async terminator => {
    const rule: QRCodeRule = {
      id: 'empty-last', name: 'Empty last field', description: '', separator: ';', terminator,
      fieldOrder: ['model', 'quantity', 'sourceNo'], isActive: true, created_at: '', updated_at: '',
    };
    for (const content of ['MODEL;100;', 'MODEL;100;;']) {
      await expect(detectRule(content, [rule])).resolves.toBe(rule);
      expect(parseWithRule(content, rule).standardFields).toEqual({ model: 'MODEL', quantity: '100', sourceNo: '' });
    }
  });

  it('strips a composite ending before parsing brackets and preserves data punctuation', async () => {
    const rule: QRCodeRule = {
      id: 'bracket-end', name: 'Bracket ending', description: '', separator: '{}', terminator: 'END\r\n',
      fieldOrder: ['quantity', 'model'], isActive: true, created_at: '', updated_at: '',
    };
    const content = sanitizeStructuredScannerInput('{100}{MODEL#}END\r\n\t');
    await expect(detectRule(content, [rule])).resolves.toBe(rule);
    expect(parseWithRule(content, rule).standardFields).toEqual({ quantity: '100', model: 'MODEL#' });
  });

  it('matches the Qinming ampersand label with a semicolon on the final placeholder', async () => {
    const content = 'PART NO.:QM4051PW&PACKAGE:TSSOP16&QUANTITY:8000 PCS&LOT NO.:2ABP6601&DATE CODE:2607Q01&PACK DATE:2026/08/06;';
    const rule: QRCodeRule = {
      id: 'qinming', name: 'Qinming', description: '', separator: '&',
      fieldOrder: ['model', 'package', 'quantity', 'batch', 'productionDate', 'custom:packDate'],
      fieldPrefixes: {
        model: 'PART NO.:', package: 'PACKAGE:', quantity: 'QUANTITY:',
        batch: 'LOT NO.:', productionDate: 'DATE CODE:', 'custom:packDate': 'PACK DATE:',
      },
      isActive: true, created_at: '', updated_at: '',
    };
    const normalized = sanitizeStructuredScannerInput(content);
    expect(isQRCode(normalized, [rule])).toBe(true);
    await expect(detectRule(normalized, [rule])).resolves.toEqual(migrateLegacyRuleFields(rule));
    const parsed = parseWithRule(normalized, rule);
    expect(parsed.standardFields).toEqual({
      model: 'QM4051PW', package: 'TSSOP16', quantity: '8000 PCS',
      batch: '2ABP6601', productionDate: '2607Q01',
    });
    expect(parsed.customFields).toEqual({});
    expect(parseQuantity(parsed.standardFields.quantity)).toBe(8000);
    await expect(detectRule(normalized, [{ ...rule, separator: ';' }])).resolves.toBeNull();
    await expect(detectRule(normalized, [{ ...rule, fieldPrefixes: { ...rule.fieldPrefixes, model: 'PART NO:' } }])).resolves.toBeNull();
    await expect(detectRule(normalized, [{ ...rule, fieldPrefixes: { ...rule.fieldPrefixes, batch: 'LOT NO:' } }])).resolves.toBeNull();
  });

  it('supports a custom terminator independently of the final field type', async () => {
    const content = 'PART NO.:QM4051PW&PACKAGE:TSSOP16&QUANTITY:8000 PCS&LOT NO.:2ABP6601&DATE CODE:2607Q01&PACK DATE:2026/08/06;\r\n';
    const rule: QRCodeRule = {
      id: 'custom-terminator', name: '自定义结束符', description: '', separator: '&', terminator: ';',
      fieldOrder: ['model', 'package', 'quantity', 'batch', 'version', 'productionDate'],
      fieldPrefixes: {
        model: 'PART NO.:', package: 'PACKAGE:', quantity: 'QUANTITY:',
        batch: 'LOT NO.:', version: 'DATE CODE:', productionDate: 'PACK DATE:',
      },
      isActive: true, created_at: '', updated_at: '',
    };

    const normalized = sanitizeStructuredScannerInput(content);
    await expect(detectRule(normalized, [rule])).resolves.toBe(rule);
    expect(parseWithRule(normalized, rule).standardFields).toEqual({
      model: 'QM4051PW', package: 'TSSOP16', quantity: '8000 PCS',
      batch: '2ABP6601', version: '2607Q01', productionDate: '2026/08/06',
    });

    const fiveFieldRule = { ...rule, id: 'wrong-five-fields', fieldOrder: rule.fieldOrder.slice(0, 5) };
    await expect(detectRule(normalized, [fiveFieldRule])).resolves.toBeNull();
  });

  it('removes exactly one matching custom terminator and preserves internal or unknown suffixes', () => {
    expect(stripRuleTerminator('MODEL-END|LOT-ENDEND', 'END')).toEqual({
      content: 'MODEL-END|LOT-END', matched: true,
    });
    expect(stripRuleTerminator('MODEL|LOT#', 'END')).toEqual({
      content: 'MODEL|LOT#', matched: false,
    });
    expect(decodeRuleTerminator(';\\r\\n')).toBe(';\r\n');
    expect(displayRuleTerminator(';\r\n')).toBe(';\\r\\n');
    expect(() => decodeRuleTerminator('bad\\q')).toThrow('结束符转义无效');
  });

  it('matches CR-only prefixed labels without confusing model slashes, LF or CRLF', async () => {
    const rule: QRCodeRule = {
      id: 'cr-prefixed', name: 'CR prefixed label', description: '', separator: '\r',
      fieldOrder: ['model', 'package', 'quantity', 'version', 'batch', 'productionDate'],
      fieldPrefixes: { model: 'P/N:', package: 'PKG:', quantity: 'QTY:', version: 'D/C:', batch: 'LOT:', productionDate: 'DATE:' },
      isActive: true, created_at: '', updated_at: '',
    };
    const content = sanitizeStructuredScannerInput(
      'P/N:DEMO/R8\rPKG:SOIC-8L\rQTY:4000\rD/C:V1\rLOT:DEMO-LOT\rDATE:18-07-2026\r\n'
    );
    expect(isQRCode(content, [rule])).toBe(true);
    await expect(detectRule(content, [rule])).resolves.toBe(rule);
    expect(parseWithRule(content, rule).standardFields).toEqual({
      model: 'DEMO/R8', package: 'SOIC-8L', quantity: '4000', version: 'V1',
      batch: 'DEMO-LOT', productionDate: '18-07-2026',
    });
    for (const separator of ['\n', '\r\n']) {
      await expect(detectRule(content, [{ ...rule, separator }])).resolves.toBeNull();
    }
    await expect(detectRule(content, [{
      ...rule, fieldOrder: ['model', 'batch', 'package', 'version', 'quantity', 'productionDate'],
    }])).resolves.toBeNull();
  });

  it('distinguishes internal delimiters from scanner terminators and preserves custom separators', () => {
    for (const code of ['123', 'ABC-123', 'IC.00000305.01', '123\r\n', '123\t']) {
      expect(isQRCode(code, [{ separator: '/' }])).toBe(false);
    }
    for (const separator of ['/', ';', '\t', '\r\n', '\x1D', '\x1E', ' ', '$']) {
      expect(isQRCode(`MODEL${separator}100`, [{ separator }])).toBe(true);
    }
    expect(isQRCode('MODEL 100')).toBe(false);
    expect(isQRCode('MODEL', [{ separator: '' }])).toBe(false);
    expect(isQRCode('{MODEL}{100}')).toBe(true);
  });
  it('忽略记录末尾分隔符，同时保留占位字段的位置', () => {
    const rule: QRCodeRule = {
      id: 'semicolon-with-placeholders',
      name: '分号占位示例',
      description: '',
      separator: ';',
      fieldOrder: [
        'model',
        'batch',
        'productionDate',
        'quantity',
        'traceNo',
        'custom:slot-1',
        'custom:slot-2',
        'sourceNo',
        'custom:slot-3',
        'version',
      ],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule(
      'Pai 122M31;FFXW47.1;2622TC;4000;2606050190128;A;LEVEL2;3001-260605001;1;01-A0030;',
      rule
    );

    expect(parsed.standardFields).toEqual({
      model: 'Pai 122M31',
      batch: 'FFXW47.1',
      productionDate: '2622TC',
      quantity: '4000',
      traceNo: '2606050190128',
      sourceNo: '3001-260605001',
      version: '01-A0030',
    });
    expect(parsed.customFields).toEqual({});
    expect(parseWithRule('MODEL-A;LOT-A;2500;', {
      ...rule,
      id: 'same-separator-and-terminator',
      fieldOrder: ['model', 'batch', 'quantity'],
      terminator: ';',
    }).standardFields).toEqual({ model: 'MODEL-A', batch: 'LOT-A', quantity: '2500' });
  });

  it('不删除二维码中间的空字段', () => {
    const rule: QRCodeRule = {
      id: 'keep-empty-fields',
      name: '保留空字段',
      description: '',
      separator: ';',
      fieldOrder: ['model', 'custom:unused', 'quantity'],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule('MODEL-A;;2500;', rule);

    expect(parsed.standardFields).toEqual({
      model: 'MODEL-A',
      quantity: '2500',
    });
    expect(parsed.customFields).toEqual({});
  });

  it('正式解析始终使用已配置分隔符，不被内容中的括号结构改写', () => {
    const rule: QRCodeRule = {
      id: 'semicolon-with-bracket-content',
      name: '分号内含括号',
      description: '',
      separator: ';',
      fieldOrder: ['model', 'batch', 'quantity'],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule('{MODEL}{GRADE};LOT-A;2500', rule);

    expect(parsed.standardFields).toEqual({
      model: '{MODEL}{GRADE}',
      batch: 'LOT-A',
      quantity: '2500',
    });
  });
});
