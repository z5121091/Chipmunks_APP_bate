import {
  buildOutboundProgress,
  isOutboundOrderComplete,
  isOutboundVerificationFresh,
  OUTBOUND_VERIFICATION_TTL_MS,
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

it('expires verification at 60 seconds and rejects a clock moving backwards', () => {
  const verifiedAt = 100_000;
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + OUTBOUND_VERIFICATION_TTL_MS - 1)).toBe(true);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt + OUTBOUND_VERIFICATION_TTL_MS)).toBe(false);
  expect(isOutboundVerificationFresh(verifiedAt, verifiedAt - 1)).toBe(false);
  expect(isOutboundVerificationFresh(0, verifiedAt)).toBe(false);
});
