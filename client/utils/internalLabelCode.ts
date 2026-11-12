import type { ErpAccountKey } from '@/utils/erpAccounts';

const PREFIX = 'HLS';
export const INTERNAL_LABEL_SEPARATOR = '~#~';
export const INTERNAL_LABEL_RULE_ID = 'internal-hls-v1';
export const INTERNAL_LABEL_RULE_NAME = '内部包装标签';

export interface InternalLabelCode {
  inventoryCode: string;
  quantity: number;
  packageId: string;
  revision: number;
}

export interface InternalLabelStock {
  accountKey: ErpAccountKey;
  inventoryCode: string;
  inventoryName: string;
  specification: string;
  warehouseName: string;
  warehouseCode: string;
  quantity: number;
}

export interface InternalLabelPackage extends InternalLabelStock, InternalLabelCode {
  parentPackageId?: string;
}

export function isInternalLabelInput(content: string): boolean {
  const input = content.trim();
  return input === PREFIX || input.startsWith(`${PREFIX}~`);
}

export function isInternalInventoryCode(value: string): boolean {
  return value === value.trim() && value.length > 0 && value.length <= 120 &&
    Array.from(value).every(character => character >= ' ' && character <= '~') &&
    !value.includes('"') && !value.includes(INTERNAL_LABEL_SEPARATOR);
}

export function parseInternalLabel(content: string): InternalLabelCode {
  const parts = content.trim().split(INTERNAL_LABEL_SEPARATOR);
  if (parts.length !== 5 || parts[0] !== PREFIX) {
    throw new Error('内部标签格式不完整，请重新扫描 HLS 二维码');
  }
  const [, inventoryCode, quantityText, packageId, revisionText] = parts;
  const quantity = Number(quantityText);
  const revision = Number(revisionText);
  if (!isInternalInventoryCode(inventoryCode)) throw new Error('内部标签的存货编码无效');
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || String(quantity) !== quantityText) {
    throw new Error('内部标签的数量必须是大于 0 的整数');
  }
  if (!/^[A-Z0-9]{12,32}$/.test(packageId) || !Number.isSafeInteger(revision) ||
      revision <= 0 || String(revision) !== revisionText) {
    throw new Error('内部标签的包号或版本无效');
  }
  return { inventoryCode, quantity, packageId, revision };
}

export function buildInternalLabel(code: InternalLabelCode): string {
  const result = [PREFIX, code.inventoryCode, code.quantity, code.packageId, code.revision].join(INTERNAL_LABEL_SEPARATOR);
  parseInternalLabel(result);
  return result;
}

export const internalLabelPackageKey = (packageId: string): string => `${PREFIX}:${packageId}`;
export const isInternalLabelPackageKey = (key?: string | null): boolean => key?.startsWith(`${PREFIX}:`) === true;

export const normalizeInternalLabelSpecification = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/g, '').toUpperCase();

export function assertInternalLabelStockMatches(
  label: InternalLabelPackage,
  rows: readonly { inventoryCode: string; specification: string }[],
) {
  const code = label.inventoryCode.toUpperCase();
  const specification = normalizeInternalLabelSpecification(label.specification);
  const matching = rows.filter(row => row.inventoryCode.trim().toUpperCase() === code);
  if (!specification || !matching.length ||
      matching.some(row => normalizeInternalLabelSpecification(row.specification) !== specification)) {
    throw new Error(`当前账套无法核对存货编码 ${label.inventoryCode} 的规格，请确认账套和物料后重试`);
  }
}
