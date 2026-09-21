import { migrateLegacyRuleFields } from '../legacyRuleFields';

it('migrates inline slots without duplicating metadata and preserves positional conditions', () => {
  const rule = {
    id: 'old', name: 'Original', isActive: false, separator: '&', terminator: ';',
    fieldOrder: ['model', 'custom:a', 'ignore:1', 'quantity', 'custom:b'],
    customFieldIds: ['a', 'b'],
    fieldPrefixes: { model: 'PN:', 'custom:a': 'PO:', 'custom:b': 'DATE:' },
    matchConditions: [{ fieldIndex: 1, keyword: 'PO-', operator: 'startsWith' }],
  };
  const snapshot = JSON.stringify(rule);
  const result = migrateLegacyRuleFields(rule);
  expect(result).toEqual({ ...rule,
    fieldOrder: ['model', 'ignore:2', 'ignore:1', 'quantity', 'ignore:3'],
    customFieldIds: [],
    fieldPrefixes: { model: 'PN:', 'ignore:2': 'PO:', 'ignore:3': 'DATE:' },
  });
  expect(JSON.stringify(rule)).toBe(snapshot);
  expect(migrateLegacyRuleFields(result)).toBe(result);
});

it('appends legacy metadata-only slots and remaps their prefixes without a global registry', () => {
  expect(migrateLegacyRuleFields({
    fieldOrder: ['model', 'quantity'], customFieldIds: ['missing-definition'],
    fieldPrefixes: { 'custom:missing-definition': 'LOT:' },
  })).toEqual({
    fieldOrder: ['model', 'quantity', 'ignore:1'], customFieldIds: [],
    fieldPrefixes: { 'ignore:1': 'LOT:' },
  });
});

it('leaves modern rules unchanged and does not mutate shared order/prefix objects', () => {
  const rule = { fieldOrder: ['model', 'ignore:2', 'quantity'], fieldPrefixes: { 'ignore:2': 'PO:' } };
  expect(migrateLegacyRuleFields(rule)).toBe(rule);
});
