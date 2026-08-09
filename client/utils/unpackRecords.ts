import type { UnpackRecord } from '@/utils/database';

type UnpackOrderScopeRecord = Pick<UnpackRecord, 'order_no' | 'warehouse_id'>;

export const selectLatestOrderUnpackRecords = <T extends UnpackOrderScopeRecord>(
  records: readonly T[]
): T[] => {
  const latestRecord = records[0];
  if (!latestRecord) {
    return [];
  }

  const latestOrderNo = latestRecord.order_no.trim();
  if (!latestOrderNo) {
    return [];
  }

  const latestWarehouseId = latestRecord.warehouse_id?.trim() || '';
  return records.filter((record) => {
    if (record.order_no.trim() !== latestOrderNo) {
      return false;
    }

    return !latestWarehouseId || record.warehouse_id?.trim() === latestWarehouseId;
  });
};
