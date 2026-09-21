import type { SaleDispatchVoucher } from './erpSaleDispatch';
import { parseQuantity } from './quantity';

export const OUTBOUND_VERIFICATION_TTL_MS = 60_000;

export const isOutboundVerificationFresh = (verifiedAt: number, now = Date.now()) =>
  verifiedAt > 0 && now >= verifiedAt && now - verifiedAt < OUTBOUND_VERIFICATION_TTL_MS;

export const normalizeOutboundInventoryCode = (value?: string | null) =>
  (value || '').trim().toUpperCase();

type ScannedItem = { id: string; inventoryCode?: string; model: string; quantity: string | number };

export interface OutboundLineProgress<T extends ScannedItem> {
  inventoryCode: string;
  inventoryName: string;
  key: string;
  remainingQuantity: number;
  requiredQuantity: number;
  scannedItems: T[];
  scannedQuantity: number;
  sourceLineCount: number;
  specification: string;
  status: 'complete' | 'partial' | 'pending' | 'over' | 'unmatched' | 'invalid';
  unitName: string;
}

export function buildOutboundProgress<T extends ScannedItem>(
  lines: SaleDispatchVoucher['lines'],
  records: T[]
): OutboundLineProgress<T>[] {
  const groups = new Map<string, OutboundLineProgress<T>>();
  for (const line of lines) {
    const code = normalizeOutboundInventoryCode(line.inventoryCode);
    let group = groups.get(code);
    if (!group) {
      group = {
        inventoryCode: code, inventoryName: line.inventoryName, key: `erp:${code}`,
        requiredQuantity: 0, remainingQuantity: 0, scannedQuantity: 0, scannedItems: [],
        sourceLineCount: 0, specification: line.specification, unitName: line.unitName || 'PCS',
        status: 'pending',
      };
      groups.set(code, group);
    }
    group.sourceLineCount += 1;
    group.inventoryName ||= line.inventoryName;
    group.specification ||= line.specification;
    if (!code || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      group.status = 'invalid';
    } else {
      group.requiredQuantity += line.quantity;
    }
  }
  for (const item of records) {
    const code = normalizeOutboundInventoryCode(item.inventoryCode);
    let group = groups.get(code);
    if (!group) {
      group = {
        inventoryCode: code, inventoryName: '', key: `erp:${code}`,
        requiredQuantity: 0, remainingQuantity: 0, scannedQuantity: 0, scannedItems: [],
        sourceLineCount: 0, specification: item.model, unitName: 'PCS', status: 'unmatched',
      };
      groups.set(code, group);
    }
    group.scannedItems.push(item);
    const quantity = parseQuantity(item.quantity);
    if (quantity === null) group.status = 'invalid';
    else group.scannedQuantity += quantity;
  }
  for (const group of groups.values()) {
    group.remainingQuantity = group.requiredQuantity - group.scannedQuantity;
    if (group.status === 'unmatched' || group.status === 'invalid') continue;
    group.status = group.remainingQuantity < 0 ? 'over'
      : group.remainingQuantity === 0 ? 'complete'
        : group.scannedQuantity > 0 ? 'partial' : 'pending';
  }
  return [...groups.values()];
}

export function isOutboundOrderComplete<T extends ScannedItem>(
  lines: SaleDispatchVoucher['lines'],
  records: T[]
): boolean {
  const progress = buildOutboundProgress(lines, records);
  return progress.length > 0 && progress.every((line) => line.status === 'complete');
}
