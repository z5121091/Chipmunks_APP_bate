import type { SaleDispatchVoucher } from './erpSaleDispatch';
import { parseQuantity } from './quantity';
import { getSaleDispatchDirection, normalizeSaleReturnLines } from './salesReturn';

// 从最近一次 ERP 查询成功起算，物料扫码不会延长核验窗口。
export const OUTBOUND_VERIFICATION_TTL_MS = 15 * 60 * 1000;

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

/** 退货以 ERP 负数量的绝对值作为需求，复用出库的存货码分组和超量判断。 */
export function buildSalesReturnProgress<T extends ScannedItem>(
  lines: SaleDispatchVoucher['lines'],
  records: T[]
): OutboundLineProgress<T>[] {
  const returnLines = getSaleDispatchDirection(lines) === 'sales_return'
    ? normalizeSaleReturnLines(lines)
    : lines.map((line) => ({ ...line, quantity: 0 }));
  const progress = buildOutboundProgress(returnLines, records);
  for (const group of progress) {
    if (!Number.isSafeInteger(group.requiredQuantity) || !Number.isSafeInteger(group.scannedQuantity)) {
      group.status = 'invalid';
    }
  }
  return progress;
}

export function isSalesReturnOrderComplete<T extends ScannedItem>(
  lines: SaleDispatchVoucher['lines'],
  records: T[]
): boolean {
  const progress = buildSalesReturnProgress(lines, records);
  return progress.length > 0 && progress.every((line) => line.status === 'complete');
}
