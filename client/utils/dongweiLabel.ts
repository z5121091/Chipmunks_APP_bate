import type { QRCodeRule } from '@/utils/database';
import { parseQuantity } from '@/utils/quantity';

export const DONGWEI_SUPPLIER = '苏州东微半导体股份有限公司';
export const DONGWEI_SIX_RULE_ID = 'builtin-dongwei-six-without-box';

const SIX_FIELDS = ['model', 'version', 'package', 'batch', 'quantity', 'productionDate'];
const SEVEN_FIELDS = [...SIX_FIELDS, 'sourceNo'];

type DongweiRuleStructure = Pick<QRCodeRule,
  'separator' | 'fieldOrder' | 'customFieldIds' | 'fieldPrefixes' | 'terminator'>;

/** A matched rule, rather than an empty box value, determines the print variant. */
export const getDongweiRuleFieldCount = (rule: DongweiRuleStructure): 6 | 7 | undefined => {
  if (rule.separator !== ';' || (rule.customFieldIds?.length ?? 0) > 0 ||
      (rule.terminator && rule.terminator !== ';') ||
      Object.values(rule.fieldPrefixes ?? {}).some(prefix => prefix.trim())) return undefined;
  const count = rule.fieldOrder.length;
  if (count !== 6 && count !== 7) return undefined;
  const expected = count === 6 ? SIX_FIELDS : SEVEN_FIELDS;
  return expected.every((field, index) => rule.fieldOrder[index] === field) ? count : undefined;
};

/**
 * This is only a structural candidate. The caller must confirm the scanned
 * model/version belongs to Dongwei before using it, after configured rules fail.
 */
export const createDongweiSixFallbackRule = (content: string): QRCodeRule | null => {
  const raw = content.trim();
  if (!raw || raw.length > 4096 || /[^\x20-\x7e]|"/.test(raw)) return null;
  const fields = raw.split(';');
  if (fields.length === 7 && fields[6] === '') fields.pop();
  if (fields.length !== 6 || fields.some(field => !field.trim()) ||
      !/^\d+$/.test(fields[4].trim()) || parseQuantity(fields[4]) === null) return null;
  return {
    id: DONGWEI_SIX_RULE_ID,
    name: '东微（六段无箱号）',
    description: '仅在未匹配已有规则且物料绑定供应商确认为东微时使用',
    separator: ';',
    terminator: ';',
    fieldOrder: [...SIX_FIELDS],
    packagingFields: [],
    isActive: true,
    supplierName: DONGWEI_SUPPLIER,
    created_at: '',
    updated_at: '',
  };
};
