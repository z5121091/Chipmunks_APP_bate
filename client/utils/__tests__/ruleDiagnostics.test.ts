jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { analyzeRuleSample, diagnoseRuleConfiguration } from '../ruleDiagnostics';
import { analyzeQRCodeRuleDetection, type InventoryBinding, type QRCodeRule } from '../database';
import type { RuleConditionInput } from '../ruleConditions';

const rule = (id = 'a', updates: Partial<QRCodeRule> & { supplierId?: string } = {}): QRCodeRule => ({
  id, name: `规则 ${id}`, description: '', separator: '/', fieldOrder: ['model', 'batch', 'quantity'],
  isActive: true, created_at: '', updated_at: '', ...updates,
});
const binding = (id = 'binding-a', updates: Partial<InventoryBinding> = {}): InventoryBinding => ({
  id, scan_model: 'SF1234', version: '', inventory_code: `IC-${id}`, supplier: '厂家甲', created_at: '', ...updates,
});
const sf: RuleConditionInput = { fieldIndex: 0, operator: 'startsWith', keyword: 'SF' };
const os: RuleConditionInput = { fieldIndex: 0, operator: 'startsWith', keyword: 'OS' };
const suppliers = [{ id: 'supplier-a', name: '厂家甲' }, { id: 'supplier-b', name: '厂家乙' }];
const sample = 'SF1234/LOT-1/100';
const kinds = (rules: QRCodeRule[]) => diagnoseRuleConfiguration(rules).map(issue => issue.kind);

describe('static rule diagnosis', () => {
  it('describes reversed field mappings as a risk instead of claiming a witnessed business failure', () => {
    const issues = diagnoseRuleConfiguration([rule(), rule('b', { fieldOrder: ['batch', 'model', 'quantity'] })]);
    expect(issues).toEqual([expect.objectContaining({
      kind: 'field-order-overlap', severity: 'warning', ruleIds: ['a', 'b'],
    })]);
    expect(issues[0].detail).toContain('真实样本');
    expect(issues[0].detail).toContain('可能');
  });

  it('detects equivalent configurations regardless of condition order and rule list presentation order', () => {
    const first = rule('a', { matchConditions: [sf, { fieldIndex: 1, keyword: 'LOT' }] });
    const second = rule('b', { displayOrder: 300, matchConditions: [...first.matchConditions!].reverse() });
    expect(kinds([first, second])).toContain('duplicate-rules');
  });

  it('does not confuse different ignore-slot identifiers with business field misalignment', () => {
    expect(kinds([rule('a', { fieldOrder: ['model', 'ignore:1', 'quantity'] }),
      rule('b', { fieldOrder: ['model', 'ignore:9', 'quantity'] })])).toEqual(['duplicate-rules']);
  });

  it('does not include inactive rules in active conflicts or configuration errors', () => {
    expect(diagnoseRuleConfiguration([rule(), rule('b', { isActive: false }),
      rule('c', { isActive: false, separator: '' })])).toEqual([]);
  });

  it('proves incompatible SF and OS prefixes disjoint when they inspect the same raw segment', () => {
    expect(diagnoseRuleConfiguration([rule('a', { matchConditions: [sf] }),
      rule('b', { matchConditions: [os] })])).toEqual([]);
  });

  it('clears a reversed-field risk after adding an effective condition while keeping real sample explanations', () => {
    const generic = rule('normal', { fieldOrder: ['model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo'] });
    const swapped = rule('swapped', { fieldOrder: ['model', 'batch', 'version', 'package', 'quantity', 'productionDate', 'traceNo', 'sourceNo'] });
    expect(diagnoseRuleConfiguration([generic, swapped]).some(issue => issue.severity === 'warning')).toBe(true);
    const conditioned = { ...swapped, matchConditions: [{ fieldIndex: 2, operator: 'startsWith' as const, keyword: '81' }] };
    const issues = diagnoseRuleConfiguration([generic, conditioned]);
    expect(issues).toEqual([]);
    const original = 'LX32F003F6P6/V01H1/LQFP64/811206700006/5000/2510/BT7125032100-2/IPCG0195321006';
    const wrongPosition = analyzeRuleSample(original, [generic, conditioned], [], []);
    expect(wrongPosition.selectedRuleId).toBe('normal');
    expect(wrongPosition.candidates.find(candidate => candidate.ruleId === 'swapped')?.reasons.join('')).toContain('第3段不满足');
    expect(wrongPosition.candidates.find(candidate => candidate.ruleId === 'swapped')?.reasons.join('')).toContain('第3段实际内容：LQFP64');
    const corrected = { ...conditioned, matchConditions: [{ ...conditioned.matchConditions[0], fieldIndex: 3 }] };
    expect(analyzeRuleSample(original, [generic, corrected], [], []).selectedRuleId).toBe('swapped');
  });

  it('does not hide ambiguity just because both rules have a matching condition', () => {
    const first = rule('a', { matchConditions: [sf] });
    const second = rule('b', { fieldOrder: ['model', 'quantity', 'batch'], matchConditions: [sf] });
    expect(diagnoseRuleConfiguration([first, second])).toEqual([expect.objectContaining({ kind: 'field-order-overlap', severity: 'warning' })]);
    expect(analyzeRuleSample(sample, [first, second], [], []).conflictingRuleIds).toHaveLength(2);
  });

  it('does not confuse conditions on different raw positions with mutually exclusive conditions', () => {
    const first = rule('a', { matchConditions: [sf] });
    const second = rule('b', { matchConditions: [{ ...os, fieldIndex: 1 }] });
    expect(kinds([first, second])).toContain('possible-overlap');
    expect(analyzeRuleSample('SF1234/OS-LOT/100', [first, second], [], []).conflictingRuleIds).toHaveLength(2);
  });

  it('keeps OR branches that overlap at equal effective priority as a risk', () => {
    expect(diagnoseRuleConfiguration([rule('a', { conditionMode: 'any', matchConditions: [sf, os] }),
      rule('b', { matchConditions: [sf] })])).toEqual([expect.objectContaining({ kind: 'possible-overlap', severity: 'warning' })]);
  });

  it('does not report findings for a fixed prefix or mandatory-condition priority', () => {
    expect(diagnoseRuleConfiguration([rule('a'), rule('b', { fieldPrefixes: { model: 'PN:' } })])).toEqual([]);
    const rules = [rule('a', { matchConditions: [sf] }), rule('b', { matchConditions: [sf, { fieldIndex: 1, operator: 'startsWith', keyword: 'LOT' }] })];
    expect(diagnoseRuleConfiguration(rules)).toEqual([]);
    expect(analyzeRuleSample(sample, rules, [], []).selectedRuleId).toBe('b');
  });

  it('accepts a supported model contains condition without issuing a maintenance finding', () => {
    const configured = rule('contains', { matchConditions: [{ fieldIndex: 0, operator: 'contains', keyword: 'SF' }] });
    expect(diagnoseRuleConfiguration([configured])).toEqual([]);
    expect(analyzeRuleSample('XSF1234/LOT-1/100', [configured], [], []).selectedRuleId).toBe('contains');
  });

  it('flags impossible mandatory prefixes but accepts SF-or-OS in any mode', () => {
    expect(kinds([rule('a', { matchConditions: [sf, os] })])).toContain('contradictory-conditions');
    expect(kinds([rule('a', { conditionMode: 'any', matchConditions: [sf, os] })]))
      .not.toContain('contradictory-conditions');
  });

  it('only calls a mixed rule impossible when every alternative contradicts the mandatory conditions', () => {
    const conditions: RuleConditionInput[] = [sf, { ...os, group: 'any' },
      { fieldIndex: 0, operator: 'startsWith', keyword: 'SF1', group: 'any' }];
    expect(kinds([rule('a', { conditionMode: 'mixed', matchConditions: conditions })]))
      .not.toContain('contradictory-conditions');
    expect(kinds([rule('a', { conditionMode: 'mixed', matchConditions: conditions.slice(0, 2) })]))
      .toContain('contradictory-conditions');
  });

  it('can prove an exact value incompatible with a contains condition', () => {
    expect(kinds([rule('a', { matchConditions: [
      { fieldIndex: 0, operator: 'equals', keyword: 'OS12' }, { fieldIndex: 0, keyword: 'SF' },
    ] })])).toContain('contradictory-conditions');
  });

  it('does not call prefix/suffix or multiple contains clauses contradictory', () => {
    expect(kinds([rule('a', { matchConditions: [sf,
      { fieldIndex: 0, operator: 'endsWith', keyword: 'OS' },
      { fieldIndex: 0, keyword: 'ABC' }, { fieldIndex: 0, keyword: 'XYZ' },
    ] })])).not.toContain('contradictory-conditions');
  });

  it('uses the engine lower-case normalization rather than expanding Unicode uppercase forms', () => {
    expect(kinds([rule('a', { matchConditions: [
      { fieldIndex: 0, operator: 'equals', keyword: 'ß' },
      { fieldIndex: 0, keyword: 'ß' },
    ] })])).not.toContain('contradictory-conditions');
  });

  it('handles all alternatives when comparing OR rules instead of treating them as AND', () => {
    const first = rule('a', { conditionMode: 'any', matchConditions: [sf, os] });
    expect(kinds([first, rule('b', { matchConditions: [sf] })])).toContain('possible-overlap');
    expect(kinds([first, rule('b', { matchConditions: [{ ...sf, keyword: 'LX' }] })]))
      .not.toContain('possible-overlap');
  });

  it('reports malformed conditions and impossible field indexes clearly', () => {
    expect(kinds([rule('a', { matchConditions: [{ ...sf, fieldIndex: 8 }] })]))
      .toContain('invalid-configuration');
    expect(kinds([rule('a', { conditionMode: 'bad' as QRCodeRule['conditionMode'] })]))
      .toContain('invalid-configuration');
    expect(kinds([rule('a', { matchConditions: [{ ...sf, keyword: '' }] })]))
      .toContain('invalid-configuration');
  });

  it('reports repeated business fields and missing quantities', () => {
    expect(kinds([rule('a', { fieldOrder: ['model', 'model'] })]))
      .toEqual(expect.arrayContaining(['missing-business-fields', 'repeated-fields']));
    expect(kinds([rule('a', { fieldOrder: ['model', 'quantity', 'ignore:1', 'ignore:1'] })]))
      .not.toContain('repeated-fields');
  });

  it('warns that duplicate mandatory conditions can distort priority', () => {
    const issues = diagnoseRuleConfiguration([rule('a', { matchConditions: [sf, sf] })]);
    expect(issues).toEqual([expect.objectContaining({ kind: 'repeated-conditions' })]);
    expect(issues[0].detail).toContain('抬高');
  });

  it('does not use different terminators alone as a proof of separation', () => {
    expect(kinds([rule('a', { terminator: '\r' }), rule('b', { terminator: '\n' })]))
      .toContain('possible-overlap');
    // Removing different terminal strings can change condition input as well.
    expect(kinds([rule('a', { terminator: 'SF', matchConditions: [sf] }),
      rule('b', { terminator: 'OS', matchConditions: [os] })])).toContain('possible-overlap');
  });

  it('does not invent static findings from separator nesting or different field counts', () => {
    const nested = [rule('a', { separator: '\r\n' }), rule('b', { separator: '\n' })];
    expect(diagnoseRuleConfiguration(nested)).toEqual([]);
    const analysis = analyzeRuleSample('SF1234\r\nLOT-1\r\n100', nested, [], []);
    expect(analysis.candidates.filter(candidate => candidate.matched)).toHaveLength(2);
    expect(analysis.selectedRuleId).toBe('a');
    expect(analysis.priorityExplanation.join('')).toContain('分隔符更长');
    expect(diagnoseRuleConfiguration([rule('a', { fieldOrder: ['model', 'quantity'] }), rule('b')])).toEqual([]);
    expect(diagnoseRuleConfiguration([rule('a', { fieldOrder: ['model', 'productionDate', 'quantity'] }),
      rule('b', { fieldOrder: ['model', 'batch', 'productionDate', 'quantity'] })])).toEqual([]);
  });

  it('does not invent a structural conflict for unrelated separators', () => {
    expect(kinds([rule(), rule('b', { separator: ',' })])).not.toContain('possible-overlap');
  });
});

describe('real sample diagnosis', () => {
  it('uses the business engine winner and explains why a conditional candidate wins', () => {
    const rules = [rule('a'), rule('b', { matchConditions: [sf] })];
    const result = analyzeRuleSample(sample, rules, [], [], 'a');
    expect(result.selectedRuleId).toBe(analyzeQRCodeRuleDetection(sample, rules).selectedRule?.id);
    expect(result.selectedRuleId).toBe('b');
    expect(result.expectedStatus).toBe('different');
    expect(result.priorityExplanation.join('')).toContain('满足识别条件的候选优先');
    expect(result.candidates[0].considered).toBe(false);
  });

  it('shows a same-priority conflict and both field mappings', () => {
    const result = analyzeRuleSample(sample, [rule(), rule('b', { fieldOrder: ['batch', 'model', 'quantity'] })], [], [], 'a');
    expect(result.selectedRuleId).toBeNull();
    expect(result.conflictingRuleIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(result.expectedStatus).toBe('conflict');
    expect(result.candidates[0].fields).toEqual({ model: 'SF1234', batch: 'LOT-1', quantity: '100' });
    expect(result.candidates[1].fields).toEqual({ batch: 'SF1234', model: 'LOT-1', quantity: '100' });
  });

  it('does not select an inactive rule even if its sample inspection succeeds', () => {
    const result = analyzeRuleSample(sample, [rule('a', { isActive: false })], [], [], 'a');
    expect(result.selectedRuleId).toBeNull();
    expect(result.expectedStatus).toBe('unmatched');
    expect(result.candidates[0]).toEqual(expect.objectContaining({ matched: true, considered: false, selected: false }));
    expect(result.candidates[0].priorityExplanation.join('')).toContain('已停用');
  });

  it('explains unsuccessful field count, prefix and condition checks', () => {
    const result = analyzeRuleSample(sample, [
      rule('count', { fieldOrder: ['model', 'quantity'] }),
      rule('prefix', { fieldPrefixes: { model: 'PART:' } }),
      rule('condition', { matchConditions: [os] }),
    ], [], []);
    expect(result.candidates[0].reasons.join('')).toContain('需要2段，实际3段');
    expect(result.candidates[1].reasons.join('')).toContain('前缀不匹配');
    expect(result.candidates[2].reasons.join('')).toContain('不满足');
    expect(result.expectedStatus).toBe('not-set');
  });

  it('checks quantity validity separately from structural matching', () => {
    const badQuantity = analyzeRuleSample('SF1234/LOT/ABC', [rule()], [], []).candidates[0];
    expect(badQuantity.matched).toBe(true);
    expect(badQuantity.quantityValid).toBe(false);
    expect(analyzeRuleSample('SF1234/LOT/100pcs', [rule()], [], []).candidates[0].quantityValid).toBe(true);
    expect(analyzeRuleSample('SF1234/LOT', [rule('a', { fieldOrder: ['model', 'batch'] })], [], [])
      .candidates[0].quantityValid).toBeNull();
  });

  it('cross-checks supplier membership but never changes the actual winner', () => {
    const rules = [rule('a', { supplierId: 'supplier-a' }),
      rule('b', { supplierId: 'supplier-b', matchConditions: [sf] })];
    const result = analyzeRuleSample(sample, rules, [binding()], suppliers);
    expect(result.selectedRuleId).toBe('b');
    expect(result.candidates[0].supplierStatus).toBe('consistent');
    expect(result.candidates[1].supplierStatus).toBe('mismatch');
    expect(result.candidates[1].materialSupplierName).toBe('厂家甲');
  });

  it('matches exact model+version first and generic bindings only as fallback', () => {
    const rules = [rule('a', { fieldOrder: ['model', 'version', 'quantity'], supplierId: 'supplier-b' })];
    const records = [binding(), binding('version', { version: 'V1', supplier: '厂家乙' })];
    const exact = analyzeRuleSample('sf1234/v1/100', rules, records, suppliers).candidates[0];
    expect(exact.bindingMatch).toBe('exact');
    expect(exact.binding?.id).toBe('version');
    expect(exact.supplierStatus).toBe('consistent');
    const fallback = analyzeRuleSample('SF1234/V2/100', rules, records, suppliers).candidates[0];
    expect(fallback.bindingMatch).toBe('generic');
    expect(fallback.binding?.id).toBe('binding-a');
    expect(fallback.supplierStatus).toBe('mismatch');
  });

  it('does not guess a versioned binding when the QR has no version', () => {
    const result = analyzeRuleSample(sample, [rule('a', { supplierId: 'supplier-a' })],
      [binding('version', { version: 'V1' })], suppliers).candidates[0];
    expect(result.bindingMatch).toBe('none');
    expect(result.supplierStatus).toBe('unknown');
  });

  it('does not match a legacy empty model binding when the sample model is absent', () => {
    const result = analyzeRuleSample('LOT/100', [rule('a', {
      supplierId: 'supplier-a', fieldOrder: ['batch', 'quantity'],
    })], [binding('invalid', { scan_model: '' })], suppliers).candidates[0];
    expect(result.bindingMatch).toBe('none');
    expect(result.binding).toBeNull();
    expect(result.supplierStatus).toBe('unknown');
  });

  it('distinguishes absent links, absent material suppliers and broken supplier references', () => {
    const result = analyzeRuleSample(sample, [
      rule('unlinked'), rule('linked', { supplierId: 'supplier-a' }),
      rule('missing', { supplierId: 'deleted', supplierName: '厂家甲' }),
    ], [binding('blank', { supplier: '' })], suppliers);
    expect(result.candidates.map(candidate => candidate.supplierStatus)).toEqual(['unlinked', 'unknown', 'unknown']);
    expect(result.candidates[2].ruleSupplierName).toBeNull();
  });

  it('keeps historical supplier notes unlinked until a formal association is selected', () => {
    const result = analyzeRuleSample(sample, [rule('a', { supplierName: ' 厂家甲 ' })],
      [binding('a', { supplier: ' 厂家甲 ' })], suppliers).candidates[0];
    expect(result.supplierStatus).toBe('unlinked');
    expect(result.ruleSupplierName).toBeNull();
    expect(result.materialSupplierName).toBe('厂家甲');
  });

  it('treats a blank scanned version and blank binding version as an exact match', () => {
    const result = analyzeRuleSample(sample, [rule('a', { supplierId: 'supplier-a' })],
      [binding('a', { supplier: ' 厂家甲 ' })], suppliers).candidates[0];
    expect(result.bindingMatch).toBe('exact');
    expect(result.supplierStatus).toBe('consistent');
  });

  it('does not use a failed candidate or ambiguous bindings as supplier evidence', () => {
    const result = analyzeRuleSample(sample, [rule('a', { supplierId: 'supplier-a', matchConditions: [os] })],
      [binding()], suppliers).candidates[0];
    expect(result.binding).toBeNull();
    expect(result.supplierStatus).toBe('unknown');
    const ambiguous = analyzeRuleSample(sample, [rule('a', { supplierId: 'supplier-a' })],
      [binding('a'), binding('b')], suppliers).candidates[0];
    expect(ambiguous.bindingMatch).toBe('ambiguous');
    expect(ambiguous.binding).toBeNull();
    expect(ambiguous.supplierStatus).toBe('unknown');
  });

  it('explains actual prefix and terminator priority without turning OR branch count into rank', () => {
    const prefixRules = [rule('a'), rule('b', { fieldPrefixes: { model: 'PN:' } })];
    const prefix = analyzeRuleSample('PN:SF1234/LOT/100', prefixRules, [], []);
    expect(prefix.selectedRuleId).toBe('b');
    expect(prefix.priorityExplanation.join('')).toContain('命中的字段前缀更多');
    const terminated = analyzeRuleSample(`${sample}\r\n`, [rule(), rule('b', { terminator: '\r\n' })], [], []);
    expect(terminated.selectedRuleId).toBe('b');
    expect(terminated.priorityExplanation.join('')).toContain('实际命中的结束符更长');
    const conditions = analyzeRuleSample(sample, [rule('any', { conditionMode: 'any', matchConditions: [sf, os] }),
      rule('all', { matchConditions: [sf, { fieldIndex: 1, keyword: 'LOT' }] })], [], []);
    expect(conditions.selectedRuleId).toBe('all');
    expect(conditions.priorityExplanation.join('')).toContain('任选组只计一次');
  });

  it('handles blank samples and verifies the expected winner', () => {
    expect(analyzeRuleSample('', [rule()], [], [], 'a').summary).toContain('请扫描');
    expect(analyzeRuleSample(sample, [rule()], [], [], 'a').expectedStatus).toBe('matched');
  });

  it('keeps input rules, supplier records and bindings unchanged', () => {
    const rules = [rule('a', { supplierId: 'supplier-a' }), rule('b', { matchConditions: [sf] })];
    const records = [binding()];
    const before = JSON.stringify({ rules, records, suppliers });
    diagnoseRuleConfiguration(rules);
    analyzeRuleSample(sample, rules, records, suppliers, 'a');
    expect(JSON.stringify({ rules, records, suppliers })).toBe(before);
  });
});
