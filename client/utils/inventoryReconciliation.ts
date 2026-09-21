import {
  CURRENT_STOCK_BATCH_SIZE,
  fetchCurrentStockByInventoryCodes,
  type CurrentStockBatchResult,
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
  batchCount: number;
};

type FetchCurrentStock = (
  account: ErpAccountConfig,
  inventoryCodes: string[]
) => Promise<CurrentStockBatchResult>;

const normalizeText = (value?: string | null): string => value?.trim().toLocaleLowerCase() || '';

export const getInventoryCodeLookupKey = (inventoryCode: string): string =>
  normalizeText(inventoryCode);

const getPhysicalQuantity = (record: InventoryCountRecord): number => {
  const value = Number(record.actualQuantity ?? record.quantity ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const sumStockRows = (inventoryCode: string, rows: CurrentStockRow[]): number => {
  const quantities = rows.map((row) => row.quantity).filter((value): value is number => value !== null);
  if (quantities.length !== rows.length || quantities.some((quantity) => !Number.isFinite(quantity))) {
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

  if (rows.some((row) => !row.warehouseName.trim() && row.quantity !== 0)) {
    throw new Error(`ERP未返回 ${inventoryCode} 的仓库，无法核对盘点范围`);
  }

  const matchedRows = rows.filter(
    (row) => normalizeText(row.warehouseName) === expectedWarehouse
  );
  // Stock in another warehouse is not stock in the warehouse being counted.
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
  let failed = false;
  let firstError: unknown;

  const worker = async () => {
    while (!failed && nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await mapper(values[currentIndex]);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
  };

  const limit = Number.isFinite(concurrency) ? Math.floor(concurrency) : 2;
  const workerCount = Math.min(Math.max(1, limit), 2, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) throw firstError;
  return results;
};

export const reconcileInventoryRecords = async (
  account: ErpAccountConfig,
  records: InventoryCountRecord[],
  options: {
    concurrency?: number;
    fetchCurrentStock?: FetchCurrentStock;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<InventoryReconciliationResult> => {
  const physicalRows = buildPhysicalCountRows(records);
  const fetchCurrentStock = options.fetchCurrentStock || fetchCurrentStockByInventoryCodes;
  const batches: typeof physicalRows[] = [];
  for (let index = 0; index < physicalRows.length; index += CURRENT_STOCK_BATCH_SIZE) {
    batches.push(physicalRows.slice(index, index + CURRENT_STOCK_BATCH_SIZE));
  }
  let completed = 0;
  let queryCount = 0;
  options.onProgress?.(0, physicalRows.length);
  const batchResults = await mapWithConcurrency(
    batches,
    options.concurrency ?? 2,
    async (batch) => {
      try {
        const result = await fetchCurrentStock(account, batch.map((row) => row.inventoryCode));
        if (result.accountKey !== account.key) {
          throw new Error('ERP返回账套与当前选择不一致，已停止核对');
        }
        const rowsByCode = new Map<string, CurrentStockRow[]>();
        result.rows.forEach((row) => {
          const key = getInventoryCodeLookupKey(row.inventoryCode);
          const rows = rowsByCode.get(key) ?? [];
          rows.push(row);
          rowsByCode.set(key, rows);
        });
        const reconciled = batch.map((physicalRow) => ({
          ...physicalRow,
          erpQuantity: getErpStockQuantityForAccount(
            account,
            physicalRow.inventoryCode,
            rowsByCode.get(getInventoryCodeLookupKey(physicalRow.inventoryCode)) ?? []
          ),
        }));
        queryCount += result.requestCount;
        completed += batch.length;
        options.onProgress?.(completed, physicalRows.length);
        return reconciled;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${account.name} 库存批次（${batch[0].inventoryCode} 起）核对失败：${message}`);
      }
    }
  );

  const erpQuantityByInventoryCode = new Map<string, number>();
  const differenceRows = batchResults.flat().map((row) => {
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
    queryCount,
    batchCount: batches.length,
  };
};
