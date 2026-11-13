import {
  createDongweiSixFallbackRule,
  DONGWEI_SIX_RULE_ID,
  DONGWEI_SUPPLIER,
  getDongweiRuleFieldCount,
} from '../dongweiLabel';

const fields = ['model', 'version', 'package', 'batch', 'quantity', 'productionDate'];
const raw = 'SFS10R03UGNF;SFS10R03UGN;PDFN5*6;75FAFL-444401;5000;G23HD03N';

describe('Dongwei print layout selection', () => {
  it('uses the matched rule to distinguish a six-field trailing separator from an empty seventh box', () => {
    expect(getDongweiRuleFieldCount({ separator: ';', fieldOrder: fields })).toBe(6);
    expect(getDongweiRuleFieldCount({ separator: ';', fieldOrder: [...fields, 'sourceNo'], terminator: ';' })).toBe(7);
  });

  it.each([
    { separator: ',', fieldOrder: fields },
    { separator: ';', fieldOrder: [...fields, 'ignore:1'] },
    { separator: ';', fieldOrder: ['model', 'package', 'version', ...fields.slice(3)] },
    { separator: ';', fieldOrder: fields, customFieldIds: ['legacy'] },
    { separator: ';', fieldOrder: fields, fieldPrefixes: { quantity: 'QTY:' } },
    { separator: ';', fieldOrder: fields, terminator: 'END' },
  ])('rejects unsupported layout instead of guessing a print variant: %p', rule => {
    expect(getDongweiRuleFieldCount(rule)).toBeUndefined();
  });

  it.each([raw, `${raw};`, ` ${raw};\r\n`])('offers a stable six-field candidate for %j', content => {
    const rule = createDongweiSixFallbackRule(content);
    expect(rule).toMatchObject({
      id: DONGWEI_SIX_RULE_ID, supplierName: DONGWEI_SUPPLIER,
      separator: ';', terminator: ';', fieldOrder: fields, packagingFields: [], isActive: true,
    });
    expect(getDongweiRuleFieldCount(rule!)).toBe(6);
  });

  it.each([
    `${raw};BOX;`, `${raw};;`, raw.replace(';5000;', ';0;'),
    raw.replace(';5000;', ';1.5;'), raw.replace(';5000;', ';5 PCS;'),
    raw.replace(';5000;', ';9007199254740992;'), raw.replace(';G23HD03N', ';'),
    raw.replace('PDFN5*6', '封装'), raw.replace('PDFN5*6', 'A"B'),
    raw.replace('PDFN5*6', 'A\nB'), raw.replace(/;/g, ','), 'M;5000;LOT',
  ])('does not offer a six-field candidate for malformed or other structures: %j', content => {
    expect(createDongweiSixFallbackRule(content)).toBeNull();
  });
});
