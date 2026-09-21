import { nextIgnoredRuleField } from './ruleConditions';

interface LegacyRuleFields {
  fieldOrder: string[];
  customFieldIds?: string[];
  fieldPrefixes?: Record<string, string>;
}

// Older backups appended customFieldIds after standard fields; inline custom keys
// are already positioned and must not be appended a second time.
export const migrateLegacyRuleFields = <T extends LegacyRuleFields>(rule: T): T => {
  const order = [...rule.fieldOrder];
  if (!order.some(field => field.startsWith('custom:'))) {
    order.push(...(rule.customFieldIds ?? []).map(id => `custom:${id}`));
  }
  if (!order.some(field => field.startsWith('custom:')) && !rule.customFieldIds?.length) return rule;
  const keys = new Map<string, string>();
  const reserved = [...order];
  const fieldOrder = order.map(field => {
    if (!field.startsWith('custom:')) return field;
    if (!keys.has(field)) {
      const ignored = nextIgnoredRuleField(reserved);
      keys.set(field, ignored);
      reserved.push(ignored);
    }
    return keys.get(field)!;
  });
  const fieldPrefixes = Object.fromEntries(Object.entries(rule.fieldPrefixes ?? {})
    .map(([field, prefix]) => [keys.get(field) ?? field, prefix]));
  return { ...rule, fieldOrder, fieldPrefixes, customFieldIds: [] };
};
