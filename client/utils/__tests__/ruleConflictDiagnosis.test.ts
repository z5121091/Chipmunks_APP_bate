jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type { QRCodeRule } from '../database';
import {
  buildRuleConflictDiagnostic,
  formatRuleConflictDiagnostic,
} from '../ruleConflictDiagnosis';

const baseRule: QRCodeRule = {
  id: 'rule-a',
  name: '规则 A',
  description: '',
  separator: '/',
  fieldOrder: ['model', 'batch', 'quantity'],
  isActive: true,
  created_at: '',
  updated_at: '',
};

describe('rule conflict diagnosis', () => {
  it('only diagnoses candidates that are truly tied by normal rule priority', async () => {
    const ruleB: QRCodeRule = {
      ...baseRule,
      id: 'rule-b',
      name: '规则 B',
      fieldOrder: ['batch', 'model', 'quantity'],
    };
    const diagnostic = await buildRuleConflictDiagnostic('MODEL-A/LOT-B/100', [baseRule, ruleB], {
      lookupInventoryCode: async (model) => model === 'MODEL-A' ? 'IC.000001' : null,
      isInventoryCodeInCurrentDocument: (inventoryCode) => inventoryCode === 'IC.000001',
    });

    expect(diagnostic).toEqual({
      candidates: [
        {
          ruleId: 'rule-a',
          ruleName: '规则 A',
          model: 'MODEL-A',
          version: '',
          inventoryCode: 'IC.000001',
          isInCurrentDocument: true,
        },
        {
          ruleId: 'rule-b',
          ruleName: '规则 B',
          model: 'LOT-B',
          version: '',
          inventoryCode: null,
          isInCurrentDocument: null,
        },
      ],
      hiddenCandidateCount: 0,
    });
  });

  it('does not present a diagnostic when normal priority already selected one rule', async () => {
    const specific: QRCodeRule = {
      ...baseRule,
      id: 'specific',
      name: '带前缀规则',
      fieldPrefixes: { model: 'PN:' },
    };

    await expect(buildRuleConflictDiagnostic('PN:MODEL-A/LOT-B/100', [baseRule, specific]))
      .resolves.toBeNull();
  });

  it('states that diagnostics are read-only and never claim to auto-select a rule', async () => {
    const ruleB: QRCodeRule = {
      ...baseRule,
      id: 'rule-b',
      name: '规则 B',
      fieldOrder: ['batch', 'model', 'quantity'],
    };
    const diagnostic = await buildRuleConflictDiagnostic('MODEL-A/LOT-B/100', [baseRule, ruleB], {
      lookupInventoryCode: async () => 'IC.000001',
      isInventoryCodeInCurrentDocument: () => true,
    });

    expect(formatRuleConflictDiagnostic(diagnostic!, '当前出库单')).toContain('系统不会自动选择规则');
    expect(formatRuleConflictDiagnostic(diagnostic!, '当前出库单')).toContain('当前出库单：包含该存货编码');
  });
});
