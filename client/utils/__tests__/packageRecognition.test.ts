import { buildPackageKey, buildSplitBoxLabel, getSplitPackageKey } from '../packageRecognition';

const fields = {
  model: 'MOT3114G', version: '810411G01000101', package: 'PDFN5*6',
  batch: 'ZYA.C', quantity: '2000', productionDate: '20261022', sourceNo: '0005-1',
};

describe('supported box-split label layouts', () => {
  it('preserves Renmao fixed B prefix, field order, spaces and box-number leading zeros', () => {
    expect(buildSplitBoxLabel('广东仁懋电子有限公司', fields))
      .toBe('B 810411G01000101 MOT3114G PDFN5*6 ZYA.C 2000 20261022 0005-1');
  });

  it('preserves Dongwei quantity-before-date field order and trailing semicolon', () => {
    expect(buildSplitBoxLabel('苏州东微半导体股份有限公司', fields))
      .toBe('MOT3114G;810411G01000101;PDFN5*6;ZYA.C;2000;20261022;0005-1;');
  });

  it.each(['', '未知供应商', '珠海博雅科技股份有限公司'])('rejects unsupported %s instead of guessing a QR format', supplier => {
    expect(() => buildSplitBoxLabel(supplier, fields)).toThrow('暂不支持按箱号生成拆包标签');
  });

  it('replaces box number and selected quantity while keeping every other identity field', () => {
    const rule = { id: 'BOX-RULE', packagingFields: ['sourceNo', 'batch', 'model', 'quantity'] };
    const original = buildPackageKey(rule, { ...fields, sourceNo: '0005', quantity: '5000' }, {})!;
    const child = buildPackageKey(rule, fields, {});
    expect(getSplitPackageKey(original, '0005-1', 2000)).toBe(child);
    expect(getSplitPackageKey(original, '0005')).not.toContain('quantity');
  });
});
