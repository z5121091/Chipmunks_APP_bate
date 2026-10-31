import type { SaleDispatchLine } from './erpSaleDispatch';

export type SaleDispatchDirection = 'outbound' | 'sales_return' | 'invalid';
export type SalesReturnVerificationKind = 'trace_matched' | 'trace_unknown' | 'batch';

/** ERP 明细的正负方向必须一致；拒绝空单、零数量及无法精确累计的数量。 */
export function getSaleDispatchDirection(lines: readonly SaleDispatchLine[]): SaleDispatchDirection {
  if (lines.length === 0) return 'invalid';

  let direction: SaleDispatchDirection = 'invalid';
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity === 0) return 'invalid';
    const lineDirection = line.quantity < 0 ? 'sales_return' : 'outbound';
    if (direction !== 'invalid' && direction !== lineDirection) return 'invalid';
    direction = lineDirection;
  }
  return direction;
}

/** 仅用于退货需求计算；ERP 原始明细和 raw 中的负数量保持原样。 */
export function normalizeSaleReturnLines(lines: readonly SaleDispatchLine[]): SaleDispatchLine[] {
  if (getSaleDispatchDirection(lines) !== 'sales_return') {
    throw new Error('销售退货单必须全部为负整数数量，不能包含零数量或混合正负明细');
  }
  return lines.map((line) => ({ ...line, quantity: Math.abs(line.quantity) }));
}

export function buildSalesReturnNotes(
  kind: SalesReturnVerificationKind,
  userNotes?: string
): string {
  const verificationNotes: Record<SalesReturnVerificationKind, string> = {
    trace_matched: '已匹配历史发货记录',
    trace_unknown: '未查到该追溯码的历史发货记录；历史来源未知',
    batch: '按批次核对，未校验原追溯码；批次不限制客户',
  };
  const notes = [
    '销售退货',
    verificationNotes[kind],
  ];
  const extraNotes = userNotes?.trim();
  if (extraNotes) notes.push(extraNotes);
  return notes.join('；');
}
