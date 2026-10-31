import {
  buildOutboundProgress,
  buildSalesReturnProgress,
  isOutboundOrderComplete,
  isSalesReturnOrderComplete,
  isOutboundVerificationFresh,
} from '../outboundProgress';
import type { SaleDispatchVoucher } from '../erpSaleDispatch';

const line = (inventoryCode: string, quantity: number): SaleDispatchVoucher['lines'][number] => ({
  inventoryCode, quantity, inventoryName: inventoryCode, specification: inventoryCode, unitName: 'PCS', raw: {},
});
const record = (inventoryCode: string, quantity: string, id = inventoryCode) => ({
  id, inventoryCode, quantity, model: inventoryCode || 'Unbound',
});

it('merges ERP demand by code and preserves unmatched, unbound and over-scanned records', () => {
  const rows = buildOutboundProgress([line(' a ', 1000), line('A', 500)], [record('A', '1500')]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceLineCount: 2, requiredQuantity: 1500, status: 'complete' });
  const changed = buildOutboundProgress([line('A', 100)], [record('A', '100'), record('B', '100'), record('', '5')]);
  expect(changed.map(row => row.status)).toEqual(['complete', 'unmatched', 'unmatched']);
  expect(changed.flatMap(row => row.scannedItems)).toHaveLength(3);
  expect(buildOutboundProgress([line('A', 50)], [record('A', '100')])[0].status).toBe('over');
});

it('does not deduplicate identical labels without trace numbers and rejects invalid quantities', () => {
  const rows = buildOutboundProgress([line('A', 200)], [record('A', '100', '1'), record('A', '100', '2')]);
  expect(rows[0]).toMatchObject({ status: 'complete', scannedQuantity: 200 });
  expect(rows[0].scannedItems).toHaveLength(2);
  for (const quantity of [0, -1, NaN, Infinity]) {
    expect(buildOutboundProgress([line('A', quantity)], [])[0].status).toBe('invalid');
  }
  expect(buildOutboundProgress([line('A', 100)], [record('A', 'bad')])[0].status).toBe('invalid');
});

it('marks an order complete only when every ERP line is exactly fulfilled', () => {
  const lines = [line('A', 100), line('B', 200)];
  expect(isOutboundOrderComplete(lines, [record('A', '100')])).toBe(false);
  expect(isOutboundOrderComplete(lines, [record('A', '100'), record('B', '200')])).toBe(true);
  expect(isOutboundOrderComplete(lines, [record('A', '100'), record('B', '201')])).toBe(false);
});

it('reuses verification within 15 minutes, expires at the boundary and rejects a clock moving backwards', () => {
  const verifiedAt = 100_000;
  const fifteenMinutes = 15 * 60_000;
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + 60_000)).toBe(true);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + 14 * 60_000)).toBe(true);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + fifteenMinutes - 1)).toBe(true);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + fifteenMinutes)).toBe(false);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt - 1)).toBe(false);
  expect(isOutboundVerificationFresh(0, verifiedAt)).toBe(false);
});

describe('sales return progress', () => {
  it('totals negative ERP demand by inventory code without altering outbound handling', () => {
    const lines = [line(' a ', -1000), line('A', -500), line('B', -20)];
    const records = [record('A', '1000', '1'), record(' a ', '500', '2'), record('B', '20')];
    const rows = buildSalesReturnProgress(lines, records);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceLineCount: 2, requiredQuantity: 1500, scannedQuantity: 1500, status: 'complete' });
    expect(rows[0].scannedItems).toHaveLength(2);
    expect(isSalesReturnOrderComplete(lines, records)).toBe(true);
    expect(lines.map(row => row.quantity)).toEqual([-1000, -500, -20]);
    expect(buildOutboundProgress(lines, records).every(row => row.status === 'invalid')).toBe(true);
    expect(isOutboundOrderComplete(lines, records)).toBe(false);
  });

  it('distinguishes missing, partial and over-returned quantities', () => {
    const lines = [line('A', -100), line('B', -20)];
    expect(buildSalesReturnProgress(lines, [record('A', '50')]).map(row => row.status))
      .toEqual(['partial', 'pending']);
    const over = buildSalesReturnProgress(lines, [record('A', '101'), record('B', '20')]);
    expect(over[0]).toMatchObject({ status: 'over', remainingQuantity: -1 });
    expect(isSalesReturnOrderComplete(lines, [record('A', '101'), record('B', '20')])).toBe(false);
  });

  it('keeps unexpected and unbound records visible and refuses to call the order complete', () => {
    const lines = [line('A', -100)];
    const records = [record('A', '100'), record('B', '5'), record('', '5')];
    const rows = buildSalesReturnProgress(lines, records);
    expect(rows.map(row => row.status)).toEqual(['complete', 'unmatched', 'unmatched']);
    expect(rows.flatMap(row => row.scannedItems)).toHaveLength(3);
    expect(isSalesReturnOrderComplete(lines, records)).toBe(false);
  });

  it('rejects invalid ERP direction, missing inventory codes and invalid saved quantities', () => {
    for (const lines of [[line('A', 100)], [line('A', -100), line('A', 20)], [line('A', 0)], [line('A', -1.5)], [line('', -100)]]) {
      expect(buildSalesReturnProgress(lines, [record('A', '100')]).some(row => row.status === 'invalid')).toBe(true);
      expect(isSalesReturnOrderComplete(lines, [record('A', '100')])).toBe(false);
    }
    for (const quantity of ['0', '-100', '1.5', 'bad']) {
      expect(buildSalesReturnProgress([line('A', -100)], [record('A', quantity)])[0].status).toBe('invalid');
    }
    expect(isSalesReturnOrderComplete([], [])).toBe(false);
  });

  it('does not mistake rounded totals above the safe integer range for completed returns', () => {
    const lines = [line('A', -Number.MAX_SAFE_INTEGER), line('A', -2)];
    const records = [record('A', String(Number.MAX_SAFE_INTEGER), '1'), record('A', '1', '2')];
    expect(buildSalesReturnProgress(lines, records)[0].status).toBe('invalid');
    expect(isSalesReturnOrderComplete(lines, records)).toBe(false);
  });
});
