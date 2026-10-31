import {
  getInventoryBindingByCode,
  getInventorySupplierById,
  type QRCodeRule,
} from '@/utils/database';

export class RuleSupplierValidationError extends Error {
  constructor(public readonly ruleId: string, public readonly title: string, message: string) {
    super(message);
    this.name = 'RuleSupplierValidationError';
  }
}

/** Only an explicit supplier link participates; historical supplier notes remain compatible. */
export const assertRuleSupplierForScan = async ({
  rule,
  inventoryCode,
  materialSupplier,
}: {
  rule: QRCodeRule | null;
  inventoryCode?: string | null;
  materialSupplier?: string | null;
}): Promise<'unlinked' | 'unknown' | 'consistent'> => {
  if (!rule?.supplierId?.trim()) return 'unlinked';
  const linkedSupplier = await getInventorySupplierById(rule.supplierId);
  if (!linkedSupplier) {
    throw new RuleSupplierValidationError(rule.id, '规则供应商关联失效',
      `规则「${rule.name}」关联的供应商已不存在。本次未录入或打印，请重新选择规则所属供应商。`);
  }

  // The material's independently maintained binding is the evidence, not the ERP vendor.
  const actualSupplier = materialSupplier === undefined
    ? inventoryCode?.trim() ? (await getInventoryBindingByCode(inventoryCode))?.supplier : null
    : materialSupplier;
  if (!actualSupplier?.trim()) return 'unknown';
  if (actualSupplier.trim().toUpperCase() !== linkedSupplier.name.trim().toUpperCase()) {
    throw new RuleSupplierValidationError(rule.id, '规则与物料供应商不一致',
      `解析规则「${rule.name}」所属供应商：${linkedSupplier.name}\n物料绑定中的供应商：${actualSupplier.trim()}\n\n本次未录入或打印。请核对规则所属供应商、字段顺序和物料绑定；系统不会自动换用其他规则。`);
  }
  return 'consistent';
};
