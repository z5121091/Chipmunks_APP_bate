jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  Object.defineProperty(native.Platform, 'OS', { configurable: true, value: 'web' });
  return native;
});

import {
  analyzeQRCodeRuleDetection, detectRule, inspectQRCodeRule, parseWithRule,
  addRule, getRuleById, updateRule, initDatabase, type QRCodeRule,
} from '../database';
import { evaluateRuleConditions, type RuleConditionInput, type RuleConditionMode } from '../ruleConditions';

const rule: QRCodeRule = {
  id: 'prefix', name: 'Prefix', description: '', separator: '/',
  fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '',
};
const sf: RuleConditionInput = { fieldIndex: 0, keyword: 'SF', operator: 'startsWith' };
const os: RuleConditionInput = { fieldIndex: 0, keyword: 'OS', operator: 'startsWith' };
const anyRule: QRCodeRule = { ...rule, conditionMode: 'any', matchConditions: [sf, os] };

describe('rule condition modes', () => {
  it.each([
    ['SF1234', true], ['OS5678', true], ['AB-SF1234', false], ['XOS5678', false],
    ['SFOS1234', true], [' sf1234 ', true],
  ])('matches model %s only at its beginning', (model, expected) => {
    expect(inspectQRCodeRule(`${model}/LOT/100`, anyRule).matched).toBe(expected);
  });

  it('retains old AND and contains behavior when mode and operator are absent', () => {
    const legacy = { ...rule, matchConditions: [{ fieldIndex: 0, keyword: 'SF' }, { fieldIndex: 1, keyword: 'LOT' }] };
    expect(inspectQRCodeRule('XSF1234/LOT/100', legacy).matched).toBe(true);
    expect(inspectQRCodeRule('XSF1234/OTHER/100', legacy).matched).toBe(false);
    expect(inspectQRCodeRule('SF1234/LOT/100', { ...rule, matchConditions: [sf, os] }).matched).toBe(false);
  });

  it('requires all mandatory conditions and one optional branch in mixed mode', () => {
    const mixed: QRCodeRule = { ...rule, conditionMode: 'mixed', matchConditions: [
      { fieldIndex: 1, keyword: 'LOT', operator: 'equals' },
      { ...sf, group: 'any' }, { ...os, group: 'any' },
    ] };
    expect(inspectQRCodeRule('SF1234/LOT/100', mixed).matched).toBe(true);
    expect(inspectQRCodeRule('OS5678/LOT/100', mixed).matched).toBe(true);
    expect(inspectQRCodeRule('SF1234/OTHER/100', mixed).matched).toBe(false);
    expect(inspectQRCodeRule('OTHER/LOT/100', mixed).matched).toBe(false);
  });

  it('treats absent groups as unrestricted and missing mixed group as mandatory', () => {
    for (const mode of ['all', 'any', 'mixed'] as const) {
      expect(evaluateRuleConditions(['SF1234'], [], mode).matched).toBe(true);
    }
    expect(evaluateRuleConditions(['SF1234'], [sf], 'mixed').matched).toBe(true);
    expect(evaluateRuleConditions(['OS1234'], [sf], 'mixed').matched).toBe(false);
    expect(evaluateRuleConditions(['SF1234'], [{ ...sf, group: 'any' }], 'mixed').matched).toBe(true);
    // Groups do not alter all/any modes until mixed is explicitly selected.
    expect(evaluateRuleConditions(['SF1234'], [{ ...sf, group: 'any' }, os], 'all').matched).toBe(false);
  });

  it('keeps structure and configured field prefixes mandatory for an OR match', () => {
    expect(inspectQRCodeRule('SF1234/LOT', anyRule).matched).toBe(false);
    expect(inspectQRCodeRule('SF1234/LOT/100/EXTRA', anyRule).matched).toBe(false);
    expect(inspectQRCodeRule('SF1234;LOT;100', anyRule).matched).toBe(false);
    expect(inspectQRCodeRule('SF1234/LOT/100', { ...anyRule, fieldPrefixes: { batch: 'LOT:' } }).matched).toBe(false);
  });

  it('preserves raw-segment conditions and does not strip SF from the parsed model', () => {
    expect(parseWithRule('SF1234/LOT/100', anyRule).standardFields.model).toBe('SF1234');
    const labelled = { ...anyRule, fieldPrefixes: { model: 'PART NO.:' } };
    expect(inspectQRCodeRule('PART NO.:SF1234/LOT/100', labelled).matched).toBe(false);
    expect(parseWithRule('PART NO.:SF1234/LOT/100', labelled).standardFields.model).toBe('SF1234');
  });

  it('does not report unmatched alternative branches as overall errors after one succeeds', () => {
    expect(inspectQRCodeRule('SF1234/LOT/100', anyRule).errors).toEqual([]);
    expect(inspectQRCodeRule('OTHER/LOT/100', anyRule).errors).toEqual([
      '任选条件至少需要满足一项：第1段不满足“开头是 SF”；第1段不满足“开头是 OS”',
    ]);
  });

  it('gives a whole OR group at most one specificity point', async () => {
    const one: QRCodeRule = { ...anyRule, id: 'one', name: 'One', matchConditions: [sf], displayOrder: 999 };
    const many: QRCodeRule = { ...anyRule, id: 'many', name: 'Many', matchConditions: [sf, os,
      { ...sf, keyword: 'S' }, { ...sf }], displayOrder: 1 };
    expect(evaluateRuleConditions(['SF1234'], many.matchConditions!, 'any').specificity).toBe(1);
    expect(analyzeQRCodeRuleDetection('SF1234/LOT/100', [one, many]).conflictingRules).toHaveLength(2);
    await expect(detectRule('SF1234/LOT/100', [many, one])).rejects.toThrow('同时匹配多个解析规则');
  });

  it('preserves legacy AND priority and counts a mixed optional group once', () => {
    const all: QRCodeRule = { ...rule, matchConditions: [sf, { fieldIndex: 1, keyword: 'LOT' }] };
    expect(analyzeQRCodeRuleDetection('SF1234/LOT/100', [anyRule, all]).selectedRule).toBe(all);
    const mixed: QRCodeRule = { ...all, conditionMode: 'mixed', matchConditions: [
      { fieldIndex: 1, keyword: 'LOT' }, { ...sf, group: 'any' }, { ...os, group: 'any' },
    ] };
    expect(evaluateRuleConditions(['SF1234', 'LOT', '100'], mixed.matchConditions!, 'mixed').specificity).toBe(2);
    expect(analyzeQRCodeRuleDetection('SF1234/LOT/100', [all, { ...mixed, id: 'mixed', name: 'Mixed' }]).conflictingRules).toHaveLength(2);
  });

  it.each([
    { conditionMode: 'bad' },
    { conditionMode: null },
    { matchConditions: [{ ...sf, group: 'bad' }] },
    { matchConditions: [{ ...sf, operator: 'bad' }] },
    { matchConditions: [{ ...sf, fieldIndex: 100 }] },
    { matchConditions: [{ ...sf, keyword: '' }] },
    { matchConditions: [null] },
    { matchConditions: null },
    { matchConditions: {} },
  ])('fails closed for invalid runtime conditions %j', invalid => {
    const damaged = { ...anyRule, ...invalid } as unknown as QRCodeRule;
    expect(inspectQRCodeRule('SF1234/LOT/100', damaged).matched).toBe(false);
  });

  it('persists and updates the new mode and group in the Web mock backend', async () => {
    await initDatabase();
    const id = await addRule({ ...anyRule, name: 'Web mixed persistence' });
    expect((await getRuleById(id))?.conditionMode).toBe('any');
    await updateRule(id, { conditionMode: 'mixed', matchConditions: [{ ...sf, group: 'any' }] });
    expect(await getRuleById(id)).toMatchObject({ conditionMode: 'mixed', matchConditions: [{ ...sf, group: 'any' }] });
    await updateRule(id, { conditionMode: 'all' });
    expect((await getRuleById(id))?.conditionMode ?? 'all').toBe('all');
  });

  it('rejects an unknown mode independently of an otherwise successful alternative', () => {
    expect(evaluateRuleConditions(['SF1234'], [sf], 'bad' as RuleConditionMode).matched).toBe(false);
  });
});
