import {
  analyzeQRCodeRuleDetection, inspectQRCodeRule, parseWithRule,
  type InventoryBinding, type QRCodeRule,
} from './database';
import {
  evaluateRuleConditions, isConditionOperator, isRuleConditionGroup, isRuleConditionMode,
  matchesRuleCondition, type RuleConditionInput,
} from './ruleConditions';
import { migrateLegacyRuleFields } from './legacyRuleFields';
import { parseQuantity } from './quantity';
import { stripRuleTerminator } from './ruleTerminator';

export interface RuleDiagnosticIssue {
  id: string;
  severity: 'error' | 'warning';
  kind: string;
  title: string;
  detail: string;
  ruleIds: string[];
}

export interface RuleSampleCandidate {
  ruleId: string;
  ruleName: string;
  isActive: boolean;
  matched: boolean;
  reasons: string[];
  fields: Record<string, string>;
  quantityValid: boolean | null;
  bindingMatch: 'exact' | 'generic' | 'none' | 'ambiguous';
  binding: InventoryBinding | null;
  ruleSupplierName: string | null;
  materialSupplierName: string | null;
  supplierStatus: 'consistent' | 'mismatch' | 'unlinked' | 'unknown';
  priorityExplanation: string[];
  selected: boolean;
  considered: boolean;
}

export interface RuleSampleAnalysis {
  selectedRuleId: string | null;
  conflictingRuleIds: string[];
  expectedStatus: 'not-set' | 'matched' | 'different' | 'conflict' | 'unmatched';
  summary: string;
  priorityExplanation: string[];
  candidates: RuleSampleCandidate[];
}

type Supplier = { id: string; name: string };
const key = (value?: string): string => (value ?? '').trim().toUpperCase();
const conditionText = (value: string): string => value.trim().toLowerCase();
const conditionKey = (condition: RuleConditionInput): string => JSON.stringify([
  condition.fieldIndex, condition.operator ?? 'contains', conditionText(condition.keyword), condition.group ?? 'all',
]);
const conditionsOf = (rule: QRCodeRule): RuleConditionInput[] =>
  Array.isArray(rule.matchConditions) ? rule.matchConditions : [];

const validConditions = (rule: QRCodeRule): boolean =>
  isRuleConditionMode(rule.conditionMode ?? 'all') &&
  (rule.matchConditions === undefined || Array.isArray(rule.matchConditions)) &&
  conditionsOf(rule).every(condition => !!condition &&
    Number.isInteger(condition.fieldIndex) && condition.fieldIndex >= 0 &&
    typeof condition.keyword === 'string' && !!condition.keyword.trim() &&
    (condition.operator === undefined || isConditionOperator(condition.operator)) &&
    (condition.group === undefined || isRuleConditionGroup(condition.group)));

// Only prove incompatibility for operators whose intersection can be decided exactly.
// Contains clauses may coexist with arbitrary prefixes/suffixes, so they are never guessed apart.
const incompatible = (a: RuleConditionInput, b: RuleConditionInput): boolean => {
  if (a.fieldIndex !== b.fieldIndex) return false;
  const first = conditionText(a.keyword);
  const second = conditionText(b.keyword);
  const firstOperator = a.operator ?? 'contains';
  const secondOperator = b.operator ?? 'contains';
  if (firstOperator === 'equals') return !matchesRuleCondition(first, b);
  if (secondOperator === 'equals') return !matchesRuleCondition(second, a);
  if (firstOperator === 'startsWith' && secondOperator === 'startsWith') {
    return !first.startsWith(second) && !second.startsWith(first);
  }
  if (firstOperator === 'endsWith' && secondOperator === 'endsWith') {
    return !first.endsWith(second) && !second.endsWith(first);
  }
  return false;
};

const hasContradiction = (conditions: readonly RuleConditionInput[]): boolean =>
  conditions.some((condition, index) => conditions.slice(index + 1)
    .some(other => incompatible(condition, other)));

const branchesOf = (rule: QRCodeRule): RuleConditionInput[][] => {
  const conditions = conditionsOf(rule);
  const mode = rule.conditionMode ?? 'all';
  const mandatory = mode === 'any' ? [] : mode === 'mixed'
    ? conditions.filter(condition => condition.group !== 'any') : conditions;
  const alternatives = mode === 'any' ? conditions : mode === 'mixed'
    ? conditions.filter(condition => condition.group === 'any') : [];
  return alternatives.length ? alternatives.map(condition => [...mandatory, condition]) : [mandatory];
};

const prefixPositions = (rule: QRCodeRule): string[] => rule.fieldOrder.map(field =>
  (rule.fieldPrefixes?.[field] ?? '').replace(/\s+/g, '').toLowerCase());
const fieldPositions = (rule: QRCodeRule): string[] => rule.fieldOrder.map(field =>
  /^ignore:\d+$/.test(field) ? 'ignore' : field);

// Different terminators or prefix-dependent date merging can change the actual split.
// A static diagnostic must not incorrectly prove those rules mutually exclusive.
const haveComparableParts = (a: QRCodeRule, b: QRCodeRule): boolean =>
  a.separator === b.separator && a.fieldOrder.length === b.fieldOrder.length &&
  (a.terminator ?? '') === (b.terminator ?? '') &&
  JSON.stringify(prefixPositions(a)) === JSON.stringify(prefixPositions(b));

const provablyDisjoint = (a: QRCodeRule, b: QRCodeRule): boolean =>
  haveComparableParts(a, b) && validConditions(a) && validConditions(b) &&
  branchesOf(a).every(first => branchesOf(b).every(second => hasContradiction([...first, ...second])));

const signature = (rule: QRCodeRule): string => JSON.stringify([
  rule.separator, rule.terminator ?? '', fieldPositions(rule), prefixPositions(rule),
  rule.conditionMode ?? 'all', conditionsOf(rule).map(conditionKey).sort(),
]);

// These dimensions have a fixed order whenever BOTH rules match. A terminator's
// match strength depends on the actual QR, so it is deliberately not guessed here.
const hasFixedPriorityDifference = (a: QRCodeRule, b: QRCodeRule): boolean => {
  const aConditioned = conditionsOf(a).length > 0;
  const bConditioned = conditionsOf(b).length > 0;
  if (aConditioned !== bConditioned) return true;
  const aPrefixes = prefixPositions(a).filter(Boolean).length;
  const bPrefixes = prefixPositions(b).filter(Boolean).length;
  if (aPrefixes !== bPrefixes) return true;
  const aSpecificity = evaluateRuleConditions([], conditionsOf(a), a.conditionMode ?? 'all').specificity;
  const bSpecificity = evaluateRuleConditions([], conditionsOf(b), b.conditionMode ?? 'all').specificity;
  return aSpecificity !== bSpecificity;
};

/** Static findings describe proven configuration errors or possible overlaps, never sampled facts. */
export const diagnoseRuleConfiguration = (rules: readonly QRCodeRule[]): RuleDiagnosticIssue[] => {
  const issues: RuleDiagnosticIssue[] = [];
  const active = rules.filter(rule => rule.isActive).map(migrateLegacyRuleFields);
  const add = (kind: string, severity: RuleDiagnosticIssue['severity'], title: string,
    detail: string, ruleIds: string[]) => issues.push({
    id: `${kind}:${ruleIds.join(':')}`, kind, severity, title, detail, ruleIds,
  });
  const invalidRules = new Set<string>();
  for (const rule of active) {
    const errors: string[] = [];
    if (!rule.separator) errors.push('未设置分隔符');
    if (rule.fieldOrder.length < 2) errors.push('字段不足两段');
    if (!validConditions(rule)) errors.push('识别条件配置无效');
    if (conditionsOf(rule).some(condition => condition && condition.fieldIndex >= rule.fieldOrder.length)) {
      errors.push('识别条件位置超出字段范围');
    }
    if (errors.length) {
      invalidRules.add(rule.id);
      add('invalid-configuration', 'error', `${rule.name}：配置不完整`, errors.join('；'), [rule.id]);
    } else if (branchesOf(rule).every(hasContradiction)) {
      invalidRules.add(rule.id);
      add('contradictory-conditions', 'error', `${rule.name}：识别条件互相矛盾`,
        '同一段的必选条件不能同时满足，且没有可成立的任选分支。这条规则无法正常命中，请检查“全部／任意／混合”逻辑。', [rule.id]);
    }
    const missing = ['model', 'quantity'].filter(field => !rule.fieldOrder.includes(field));
    if (missing.length) add('missing-business-fields', 'warning', `${rule.name}：缺少业务字段`,
      `未配置${missing.map(field => field === 'model' ? '型号' : '数量').join('、')}，即使格式匹配，也可能无法用于出入库或补打。`, [rule.id]);
    const repeatedFields = [...new Set(rule.fieldOrder.filter((field, index) =>
      !field.startsWith('ignore:') && rule.fieldOrder.indexOf(field) !== index))];
    if (repeatedFields.length) add('repeated-fields', 'warning', `${rule.name}：字段重复`,
      '相同字段被配置在多个位置，解析时后面的值会覆盖前面的值，请核对字段顺序。', [rule.id]);
    if (validConditions(rule)) {
      const conditions = conditionsOf(rule);
      if (new Set(conditions.map(conditionKey)).size < conditions.length) add('repeated-conditions', 'warning',
        `${rule.name}：识别条件重复`, '重复条件没有增加区分依据；在全部条件组中还可能抬高当前优先级，请检查是否重复添加。', [rule.id]);
    }
  }

  for (let first = 0; first < active.length; first++) {
    const a = active[first];
    if (invalidRules.has(a.id)) continue;
    for (let second = first + 1; second < active.length; second++) {
      const b = active[second];
      if (invalidRules.has(b.id) || provablyDisjoint(a, b)) continue;
      const sameSeparator = a.separator === b.separator;
      const sameCount = a.fieldOrder.length === b.fieldOrder.length;
      if (sameSeparator && sameCount) {
        const sameFields = JSON.stringify(fieldPositions(a)) === JSON.stringify(fieldPositions(b));
        const duplicate = signature(a) === signature(b);
        // A resolved priority must not become a warning when informational findings are removed.
        if (hasFixedPriorityDifference(a, b)) continue;
        add(duplicate ? 'duplicate-rules' : sameFields ? 'possible-overlap' : 'field-order-overlap', 'warning',
          duplicate ? `${a.name}、${b.name}：重复配置` :
            `${a.name}、${b.name}：${sameFields ? '识别范围可能重叠' : '相同结构、字段位置不同'}`,
          duplicate ? '两条启用规则的解析配置一致、优先级相同；若它们同为最高候选，实际扫码会提示冲突。供应商归属不会自动改变选择。' :
            `${sameFields ? '两条规则使用相同分隔符和段数。' : '同一位置被定义为不同字段，选错规则可能使型号、批次等错位。'}目前未能从配置证明两者互斥，请扫描真实样本核对命中规则及优先级。结束符不同本身不能保证互斥。`, [a.id, b.id]);
      }
    }
  }
  return issues;
};

interface PriorityFacts {
  conditioned: boolean;
  prefixCount: number;
  specificity: number;
  terminatorLength: number;
  separatorLength: number;
  fieldCount: number;
}

const priorityFacts = (content: string, rule: QRCodeRule): PriorityFacts => {
  const inspection = inspectQRCodeRule(content, rule);
  return {
    conditioned: conditionsOf(rule).length > 0,
    // Facts are compared only for matched rules, where every configured prefix passed inspection.
    prefixCount: prefixPositions(rule).filter(Boolean).length,
    specificity: evaluateRuleConditions(inspection.parts, conditionsOf(rule), rule.conditionMode ?? 'all').specificity,
    terminatorLength: stripRuleTerminator(content, rule.terminator).matched ? (rule.terminator?.length ?? 0) : 0,
    separatorLength: Array.from(rule.separator).length,
    fieldCount: rule.fieldOrder.length,
  };
};

const winningReason = (winner: PriorityFacts, other: PriorityFacts): string => {
  if (winner.conditioned !== other.conditioned) return '满足识别条件的候选优先于未配置识别条件的候选';
  if (winner.prefixCount !== other.prefixCount) return '命中的字段前缀更多';
  if (winner.specificity !== other.specificity) return '识别条件的有效约束数更多（任选组只计一次）';
  if (winner.terminatorLength !== other.terminatorLength) return '本样本实际命中的结束符更长';
  if (winner.separatorLength !== other.separatorLength) return '分隔符更长';
  if (winner.fieldCount !== other.fieldCount) return '字段段数更多';
  return '识别优先级相同，无法自动区分';
};

/** Uses exactly the business engine's winner. Supplier evidence never silently selects another rule. */
export const analyzeRuleSample = (
  content: string,
  originalRules: readonly QRCodeRule[],
  bindings: readonly InventoryBinding[],
  suppliers: readonly Supplier[],
  expectedRuleId?: string,
): RuleSampleAnalysis => {
  const rules = originalRules.map(migrateLegacyRuleFields);
  const active = rules.filter(rule => rule.isActive);
  const analysis = analyzeQRCodeRuleDetection(content, active);
  const selectedRuleId = analysis.selectedRule?.id ?? null;
  const conflictingRuleIds = analysis.conflictingRules.map(rule => rule.id);
  const consideredIds = new Set(analysis.consideredRules.map(rule => rule.id));
  const suppliersById = new Map(suppliers.map(supplier => [supplier.id, supplier.name]));
  const suppliersByName = new Map(suppliers.map(supplier => [key(supplier.name), supplier.name]));
  const bindingsByModel = new Map<string, InventoryBinding[]>();
  for (const binding of bindings) {
    const modelKey = key(binding.scan_model);
    const rows = bindingsByModel.get(modelKey) ?? [];
    rows.push(binding);
    bindingsByModel.set(modelKey, rows);
  }
  const winnerFacts = analysis.selectedRule ? priorityFacts(content, analysis.selectedRule) : null;
  const candidates = rules.map((rule): RuleSampleCandidate => {
    const inspection = inspectQRCodeRule(content, rule);
    const reasons = [...inspection.errors];
    if (!inspection.matched && validConditions(rule)) {
      const failedIndexes = new Set(conditionsOf(rule)
        .filter(condition => !matchesRuleCondition(inspection.parts[condition.fieldIndex] ?? '', condition))
        .map(condition => condition.fieldIndex));
      for (const index of failedIndexes) {
        const raw = inspection.parts[index];
        reasons.push(`第${index + 1}段实际内容：${raw === undefined ? '【缺少此段】' : raw ? raw.slice(0, 160) : '【空字段】'}`);
      }
    }
    const fields = parseWithRule(content, rule).standardFields;
    const modelKey = key(fields.model);
    const matchingModels = modelKey ? bindingsByModel.get(modelKey) ?? [] : [];
    const version = key(fields.version);
    const exact = matchingModels.filter(binding => key(binding.version) === version);
    const generic = matchingModels.filter(binding => !key(binding.version));
    const rows = exact.length ? exact : generic;
    const binding = inspection.matched && rows.length === 1 ? rows[0] : null;
    const bindingMatch: RuleSampleCandidate['bindingMatch'] = !inspection.matched || !rows.length ? 'none'
      : rows.length > 1 ? 'ambiguous' : exact.length ? 'exact' : 'generic';
    const supplierId = (rule as QRCodeRule & { supplierId?: string }).supplierId;
    // supplierName was historically free-form notes, not a verified association.
    // Only the formal supplierId can provide membership evidence.
    const ruleSupplierName = supplierId ? suppliersById.get(supplierId) ?? null : null;
    const materialSupplierName = binding?.supplier?.trim()
      ? suppliersByName.get(key(binding.supplier)) ?? binding.supplier.trim() : null;
    const supplierStatus: RuleSampleCandidate['supplierStatus'] = !supplierId ? 'unlinked'
      : !inspection.matched || !binding || !materialSupplierName || !ruleSupplierName ? 'unknown'
        : key(ruleSupplierName) === key(materialSupplierName) ? 'consistent' : 'mismatch';
    const explanations: string[] = [];
    if (!rule.isActive) explanations.push('规则已停用，不参与实际扫码识别');
    else if (!inspection.matched) explanations.push('未通过格式或识别条件检查，不参与优先级比较');
    else {
      const facts = priorityFacts(content, rule);
      explanations.push(`识别条件${facts.conditioned ? `有效约束 ${facts.specificity} 项` : '未设置'}；命中前缀 ${facts.prefixCount} 个；实际命中结束符 ${facts.terminatorLength} 字符；分隔符 ${facts.separatorLength} 字符；${facts.fieldCount} 段`);
      if (selectedRuleId === rule.id) explanations.push('本样本实际使用此规则');
      else if (conflictingRuleIds.includes(rule.id)) explanations.push('与最高优先级候选并列，实际扫码会提示规则冲突');
      else if (winnerFacts) explanations.push(`未被选中：${analysis.selectedRule!.name}${winningReason(winnerFacts, facts)}`);
      else if (!consideredIds.has(rule.id)) explanations.push('另有满足识别条件的候选，此普通候选不进入最终比较');
      else explanations.push('低于发生冲突的最高优先级候选');
    }
    return {
      ruleId: rule.id, ruleName: rule.name, isActive: rule.isActive,
      matched: inspection.matched, reasons, fields,
      quantityValid: fields.quantity === undefined ? null : parseQuantity(fields.quantity) !== null,
      bindingMatch, binding, ruleSupplierName, materialSupplierName, supplierStatus,
      priorityExplanation: explanations,
      selected: selectedRuleId === rule.id, considered: consideredIds.has(rule.id),
    };
  });
  const expectedStatus: RuleSampleAnalysis['expectedStatus'] = !expectedRuleId ? 'not-set'
    : conflictingRuleIds.length ? 'conflict' : !selectedRuleId ? 'unmatched'
      : selectedRuleId === expectedRuleId ? 'matched' : 'different';
  const summary = !content.trim() ? '请扫描或粘贴二维码样本'
    : conflictingRuleIds.length ? `同一优先级匹配 ${conflictingRuleIds.length} 条规则，实际扫码会提示冲突`
      : analysis.selectedRule ? `实际命中：${analysis.selectedRule.name}` : '没有启用规则能够识别此样本';
  const priorityExplanation = [
    '仅启用规则参与实际选择；列表排序和供应商归属不改变识别优先级。',
    '满足识别条件的候选优先，再比较命中前缀数、有效条件约束数、实际命中结束符、分隔符长度和段数；最高优先级并列则提示冲突。',
  ];
  if (analysis.selectedRule && analysis.matchedRules.length > 1) {
    for (const other of analysis.matchedRules) {
      if (other.id !== analysis.selectedRule.id) priorityExplanation.push(
        `${analysis.selectedRule.name} 优先于 ${other.name}：${winningReason(winnerFacts!, priorityFacts(content, other))}。`);
    }
  }
  return { selectedRuleId, conflictingRuleIds, expectedStatus, summary, priorityExplanation, candidates };
};
