import {
  analyzeQRCodeRuleDetection,
  getExactInventoryCodeByModelVersion,
  parseWithRule,
  type QRCodeRule,
} from './database';

const MAX_DIAGNOSTIC_CANDIDATES = 8;

export interface RuleConflictCandidateDiagnostic {
  ruleId: string;
  ruleName: string;
  model: string;
  version: string;
  inventoryCode: string | null;
  isInCurrentDocument: boolean | null;
}

export interface RuleConflictDiagnostic {
  candidates: RuleConflictCandidateDiagnostic[];
  hiddenCandidateCount: number;
}

export interface RuleConflictDiagnosticOptions {
  normalizeModel?: (value: string) => string;
  normalizeVersion?: (value: string) => string;
  isInventoryCodeInCurrentDocument?: (inventoryCode: string) => boolean;
  lookupInventoryCode?: (model: string, version: string) => Promise<string | null>;
}

/**
 * 只读地展示真正同优先级规则的解析结果。
 * 不选择规则、不修改规则，也不把诊断结果写入任何业务记录。
 */
export const buildRuleConflictDiagnostic = async (
  content: string,
  activeRules: readonly QRCodeRule[],
  options: RuleConflictDiagnosticOptions = {},
): Promise<RuleConflictDiagnostic | null> => {
  const analysis = analyzeQRCodeRuleDetection(content, activeRules);
  if (analysis.conflictingRules.length < 2) return null;

  const candidates = analysis.conflictingRules.slice(0, MAX_DIAGNOSTIC_CANDIDATES);
  const lookupInventoryCode = options.lookupInventoryCode ?? getExactInventoryCodeByModelVersion;
  const diagnostics = await Promise.all(candidates.map(async (rule) => {
    const { standardFields } = parseWithRule(content, rule);
    const rawModel = standardFields.model || '';
    const rawVersion = standardFields.version || '';
    const model = (options.normalizeModel?.(rawModel) ?? rawModel).trim();
    const version = (options.normalizeVersion?.(rawVersion) ?? rawVersion).trim();
    const inventoryCode = model ? await lookupInventoryCode(model, version) : null;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      model,
      version,
      inventoryCode,
      isInCurrentDocument: inventoryCode && options.isInventoryCodeInCurrentDocument
        ? options.isInventoryCodeInCurrentDocument(inventoryCode)
        : null,
    } satisfies RuleConflictCandidateDiagnostic;
  }));

  return {
    candidates: diagnostics,
    hiddenCandidateCount: Math.max(0, analysis.conflictingRules.length - diagnostics.length),
  };
};

export const formatRuleConflictDiagnostic = (
  diagnostic: RuleConflictDiagnostic,
  documentLabel?: string,
): string => {
  const details = diagnostic.candidates.map((candidate) => {
    const lines = [
      `• ${candidate.ruleName}`,
      `  型号：${candidate.model || '未解析'}`,
      `  版本：${candidate.version || '-'}`,
      `  精确绑定：${candidate.inventoryCode || '未找到'}`,
    ];
    if (documentLabel) {
      lines.push(`  ${documentLabel}：${candidate.inventoryCode
        ? candidate.isInCurrentDocument ? '包含该存货编码' : '未包含该存货编码'
        : '无法核验'}`);
    }
    return lines.join('\n');
  });

  if (diagnostic.hiddenCandidateCount > 0) {
    details.push(`另有 ${diagnostic.hiddenCandidateCount} 条同优先级候选未展开。`);
  }

  return [
    '本次未录入。以下结果仅用于排查，系统不会自动选择规则。',
    '',
    ...details,
    '',
    '请在规则设置中补充字段前缀、识别条件或调整规则结构。',
  ].join('\n');
};
