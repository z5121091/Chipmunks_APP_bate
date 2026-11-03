import type { MaterialRecord } from '@/utils/database';

export interface OrderBatchGroup {
  key: string;
  batch: string;
  productionDate: string;
  quantity: number;
  records: MaterialRecord[];
}
export interface OrderMaterialGroup {
  key: string;
  model: string;
  inventoryCode: string;
  version: string;
  package: string;
  quantity: number;
  recordCount: number;
  batches: OrderBatchGroup[];
}

// Display aggregation only. Keep distinct item identities and original date codes intact.
export function groupOrderMaterials(records: MaterialRecord[]): OrderMaterialGroup[] {
  const groups = new Map<string, OrderMaterialGroup>();
  const batches = new Map<string, OrderBatchGroup>();
  for (const record of records) {
    const key = JSON.stringify([record.order_no, record.warehouse_id, record.erp_account_key,
      record.operation_type, record.model, record.inventory_code, record.version, record.package]);
    let group = groups.get(key);
    if (!group) {
      group = { key, model: record.model || '未知型号', inventoryCode: record.inventory_code || '',
        version: record.version || '', package: record.package || '', quantity: 0, recordCount: 0, batches: [] };
      groups.set(key, group);
    }
    const batch = record.batch || '';
    const productionDate = record.productionDate || '';
    const batchKey = JSON.stringify([key, batch, productionDate]);
    let batchGroup = batches.get(batchKey);
    if (!batchGroup) {
      batchGroup = { key: batchKey, batch, productionDate, quantity: 0, records: [] };
      batches.set(batchKey, batchGroup);
      group.batches.push(batchGroup);
    }
    const quantity = Number(record.quantity) || 0;
    group.quantity += quantity;
    group.recordCount += 1;
    batchGroup.quantity += quantity;
    batchGroup.records.push(record);
  }
  return [...groups.values()];
}
