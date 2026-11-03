import { groupOrderMaterials } from '../orderMaterialGroups';
import type { MaterialRecord } from '../database';

const base = { order_no: 'A', warehouse_id: 'W', erp_account_key: 'account', operation_type: 'outbound',
  model: 'MODEL', inventory_code: 'CODE', package: 'PKG', version: 'V', batch: 'B1', productionDate: '2620', quantity: 2500 } as MaterialRecord;

it('sums four packages into three batch/date rows without modifying source records', () => {
  const records = [base, { ...base }, { ...base, productionDate: '2621' }, { ...base, batch: 'B2', productionDate: '2621' }];
  const before = JSON.stringify(records);
  const [group] = groupOrderMaterials(records);
  expect(group.quantity).toBe(10000);
  expect(group.recordCount).toBe(4);
  expect(group.batches.map(row => [row.batch, row.productionDate, row.quantity])).toEqual([
    ['B1', '2620', 5000], ['B1', '2621', 2500], ['B2', '2621', 2500],
  ]);
  expect(group.batches[0].records).toEqual(records.slice(0, 2));
  expect(JSON.stringify(records)).toBe(before);
});
it.each(['inventory_code', 'version', 'package', 'warehouse_id', 'erp_account_key', 'operation_type', 'order_no'] as const)(
  'keeps different %s identities separate', field => {
    expect(groupOrderMaterials([base, { ...base, [field]: 'different' }])).toHaveLength(2);
  });
it('keeps missing and raw production dates separate and uses shipped quantity for unpacked records', () => {
  const groups = groupOrderMaterials([
    { ...base, quantity: 200, original_quantity: '240', remaining_quantity: '40', isUnpacked: true, productionDate: '' },
    { ...base, quantity: 3, productionDate: '17-04-2023' },
    { ...base, quantity: 7, productionDate: '2620' },
  ]);
  expect(groups[0].quantity).toBe(210);
  expect(groups[0].batches.map(row => row.productionDate)).toEqual(['', '17-04-2023', '2620']);
});
