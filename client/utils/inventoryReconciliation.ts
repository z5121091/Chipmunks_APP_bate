import {
  fetchCurrentStockByInventoryCode,
  type CurrentStockQueryResult,
  type CurrentStockRow,
} from './erpCurrentStock';
import type { ErpAccountConfig } from './erpAccounts';

export type InventoryCountRecord = {
  actualQuantity?: number;
  inventoryCode?: string;
  model: string;
  quantity: number;
};

export type InventoryDifferenceRow = {
  differenceQuantity: number;
  erpQuantity: number;
  inventoryCode: string;
  model: string;
  physicalQuantity: number;
};

export type InventoryReconciliationResult = {
  differenceRows: InventoryDifferenceRow[];
  erpQuantityByInventoryCode: Map<string, number>;
  queryCount: number;
};

type FetchCurrentStock = (
  account: ErpAccountConfig,
  inventoryCode: string,
  options?: { forceRefresh?: boolean }
) => Promise<CurrentStockQueryResult>;

const normalizeText = (value?: string | null): string => value?.trim().toLocaleLowerCase() || '';

export const getInventoryCodeLookupKey = (inventoryCode: string): string =>
  normalizeText(inventoryCode);

const getPhysicalQuantity = (record: InventoryCountRecord): number => {
  const value = Number(record.actualQuantity ?? record.quantity ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const sumStockRows = (inventoryCode: string, rows: CurrentStockRow[]): number => {
  const quantities = rows.map((row) => row.quantity).filter((value): value is number => value !== null);
  if (rows.length > 0 && quantities.length === 0) {
    throw new Error(`ERP未返回 ${inventoryCode} 的库存数量字段`);
  }

  return quantities.reduce((sum, quantity) => sum + quantity, 0);
};

export const getErpStockQuantityForAccount = (
  account: ErpAccountConfig,
  inventoryCode: string,
  rows: CurrentStockRow[]
): number => {
  if (rows.length === 0) {
    return 0;
  }

  const expectedWarehouse = normalizeText(account.expectedWarehouseName);
  if (!expectedWarehouse) {
    return sumStockRows(inventoryCode, rows);
  }

  const matchedRows = rows.filter(
    (row) => normalizeText(row.warehouseName) === expectedWarehouse
  );
  if (matchedRows.length === 0) {
    const returnedWarehouses = Array.from(
      new Set(rows.map((row) => row.warehouseName.trim()).filter(Boolean))
    );
    throw new Error(
      `ERP返回了 ${inventoryCode}，但未找到仓库“${account.expectedWarehouseName}”` +
        `${returnedWarehouses.length > 0 ? `（实际返回：${returnedWarehouses.join('、')}）` : ''}`
    );
  }

  return sumStockRows(inventoryCode, matchedRows);
};

const buildPhysicalCountRows = (records: InventoryCountRecord[]) => {
  const rowsByCode = new Map<
    string,
    { inventoryCode: string; model: string; physicalQuantity: number }
  >();

  records.forEach((record) => {
    const inventoryCode = record.inventoryCode?.trim() || '';
    const lookupKey = getInventoryCodeLookupKey(inventoryCode);
    if (!lookupKey) {
      throw new Error(`型号 ${record.model || '-'} 缺少存货编码，无法核对ERP库存`);
    }

    const existing = rowsByCode.get(lookupKey);
    if (existing) {
      existing.physicalQuantity += getPhysicalQuantity(record);
      return;
    }

    rowsByCode.set(lookupKey, {
      inventoryCode,
      model: record.model.trim(),
      physicalQuantity: getPhysicalQuantity(record),
    });
  });

  return Array.from(rowsByCode.values()).sort((a, b) =>
    a.inventoryCode.localeCompare(b.inventoryCode)
  );
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

export const reconcileInventoryRecords = async (
  account: ErpAccountConfig,
  records: InventoryCountRecord[],
  options: {
    concurrency?: number;
    fetchCurrentStock?: FetchCurrentStock;
  } = {}
): Promise<InventoryReconciliationResult> => {
  const physicalRows = buildPhysicalCountRows(records);
  const fetchCurrentStock = options.fetchCurrentStock || fetchCurrentStockByInventoryCode;
  const erpRows = await mapWithConcurrency(
    physicalRows,
    options.concurrency ?? 3,
    async (physicalRow) => {
      try {
        const result = await fetchCurrentStock(account, physicalRow.inventoryCode, {
          forceRefresh: true,
        });
        return {
          ...physicalRow,
          erpQuantity: getErpStockQuantityForAccount(
            account,
            physicalRow.inventoryCode,
            result.rows
          ),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${physicalRow.inventoryCode} 库存核对失败：${message}`);
      }
    }
  );

  const erpQuantityByInventoryCode = new Map<string, number>();
  const differenceRows = erpRows.map((row) => {
    erpQuantityByInventoryCode.set(getInventoryCodeLookupKey(row.inventoryCode), row.erpQuantity);
    return {
      differenceQuantity: row.physicalQuantity - row.erpQuantity,
      erpQuantity: row.erpQuantity,
      inventoryCode: row.inventoryCode,
      model: row.model,
      physicalQuantity: row.physicalQuantity,
    };
  });

  return {
    differenceRows,
    erpQuantityByInventoryCode,
    queryCount: physicalRows.length,
  };
};
