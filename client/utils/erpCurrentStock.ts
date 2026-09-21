import {
  BackendApiError,
  BackendNetworkError,
  backendJsonRequest,
  buildErpProxyPath,
} from '@/utils/backendApi';
import { type ErpAccountConfig, requireErpAccountBackend } from '@/utils/erpAccounts';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const CURRENT_STOCK_QUERY_PATH = buildErpProxyPath('/api/erp/tplus/current-stock/query');
const CURRENT_STOCK_CACHE_TTL_MS = 15_000;
export const CURRENT_STOCK_BATCH_SIZE = 100;
const CURRENT_STOCK_PAGE_SIZE = 1000;

type MaybeRecord = Record<string, unknown>;

type ChanjetProxyResponse<T> = {
  data?: T;
  details?: unknown;
  message?: string;
  success?: boolean;
};

type ChanjetCurrentStockResponse = {
  code?: string | number;
  data?: unknown;
  exception?: unknown;
  message?: string;
  value?: unknown;
};

export interface CurrentStockRow {
  availableQuantity: number | null;
  inventoryCode: string;
  inventoryName: string;
  quantity: number | null;
  raw: MaybeRecord;
  specification: string;
  warehouseCode: string;
  warehouseName: string;
}

export interface CurrentStockQueryResult {
  accountKey: ErpAccountConfig['key'];
  accountName: string;
  inventoryCode: string;
  rows: CurrentStockRow[];
}

export interface CurrentStockBatchResult {
  accountKey: ErpAccountConfig['key'];
  rows: CurrentStockRow[];
  requestCount: number;
}

type CurrentStockCacheEntry = {
  cachedAt: number;
  result: CurrentStockQueryResult;
};

const currentStockCache = new Map<string, CurrentStockCacheEntry>();
const currentStockRequests = new Map<string, Promise<CurrentStockQueryResult>>();

const isRecord = (value: unknown): value is MaybeRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): MaybeRecord => (isRecord(value) ? value : {});

const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const asNumberOrNull = (value: unknown): number | null => {
  const text = asText(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const firstText = (record: MaybeRecord, keys: string[]): string => {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) {
      return value;
    }
  }

  return '';
};

const firstNumber = (record: MaybeRecord, keys: string[]): number | null => {
  for (const key of keys) {
    const value = asNumberOrNull(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
};

const formatPayloadPreview = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').slice(0, 160);
  }

  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return String(value).slice(0, 160);
  }
};

const ROW_COLLECTION_KEYS = [
  'Rows',
  'rows',
  'Items',
  'items',
  'CurrentStock',
  'currentStock',
  'data',
  'Data',
  'value',
  'Value',
  'result',
  'Result',
] as const;

type StockPage = { rows: unknown[]; totalCount: number | null };

const readTotalCount = (value: unknown): number | null => {
  const record = asRecord(value);
  const raw = record.TotalCount ?? record.totalCount;
  if (raw === undefined || raw === null) return null;
  const total = asNumberOrNull(raw);
  if (total === null || !Number.isSafeInteger(total) || total < 0) {
    throw new Error('ERP库存分页总数无效，已停止核对');
  }
  return total;
};

const findStockPage = (value: unknown): StockPage | null => {
  if (Array.isArray(value)) {
    return { rows: value, totalCount: readTotalCount(value[0]) };
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ROW_COLLECTION_KEYS) {
    const page = findStockPage(value[key]);
    if (page) {
      return { ...page, totalCount: readTotalCount(value) ?? page.totalCount };
    }
  }

  // Do not inspect arbitrary object values here. ERP responses may contain
  // unrelated arrays (for example paging metadata or grouping options).
  return null;
};

const extractPayload = (response: unknown): ChanjetCurrentStockResponse => {
  if (!isRecord(response)) {
    throw new Error(`现存量查询返回结构异常：${formatPayloadPreview(response)}`);
  }

  const proxyResponse = response as ChanjetProxyResponse<unknown>;
  if (proxyResponse.success === false) {
    throw new Error(
      (asText(proxyResponse.message)
        ? formatUserFacingErrorMessage(proxyResponse.message, '后端ERP代理请求失败')
        : '') ||
        `后端ERP代理请求失败：${formatPayloadPreview(proxyResponse.details || response)}`
    );
  }

  const payload = isRecord(proxyResponse.data)
    ? proxyResponse.data as ChanjetCurrentStockResponse
    : response as ChanjetCurrentStockResponse;

  if (payload.code !== undefined && String(payload.code) !== '0') {
    const upstreamMessage = asText(payload.message)
      ? formatUserFacingErrorMessage(payload.message, 'ERP未提供具体错误原因')
      : '';
    throw new Error(`现存量查询失败${upstreamMessage ? `：${upstreamMessage}` : ''}`);
  }

  return payload;
};

const mapStockRow = (value: unknown, fallbackInventoryCode: string): CurrentStockRow => {
  const raw = asRecord(value);
  const inventory = asRecord(raw.Inventory || raw.inventory);
  const warehouse = asRecord(raw.Warehouse || raw.warehouse);

  return {
    availableQuantity: firstNumber(raw, [
      'AvailableQuantity',
      'availableQuantity',
      'AvailableBaseQuantity',
      'CanUseQuantity',
      'AvaliableQuantity',
    ]),
    inventoryCode:
      firstText(inventory, ['Code', 'code']) ||
      firstText(raw, ['InventoryCode', 'inventoryCode', 'InvCode']) ||
      fallbackInventoryCode,
    inventoryName:
      firstText(inventory, ['Name', 'name']) ||
      firstText(raw, ['InventoryName', 'inventoryName', 'InvName']),
    quantity: firstNumber(raw, [
      'Quantity',
      'quantity',
      'BaseQuantity',
      'ExistingQuantity',
      'CurrentQuantity',
      'StockQuantity',
    ]),
    raw,
    specification:
      firstText(inventory, ['Specification', 'specification']) ||
      firstText(raw, ['Specification', 'specification']),
    warehouseCode:
      firstText(warehouse, ['Code', 'code']) || firstText(raw, ['WarehouseCode', 'warehouseCode']),
    warehouseName:
      firstText(warehouse, ['Name', 'name']) || firstText(raw, ['WarehouseName', 'warehouseName']),
  };
};

const getRowInventoryCode = (value: unknown): string => {
  const raw = asRecord(value);
  const inventory = asRecord(raw.Inventory || raw.inventory);
  return (
    firstText(inventory, ['Code', 'code']) ||
    firstText(raw, ['InventoryCode', 'inventoryCode', 'InvCode'])
  );
};

const filterRowsByInventoryCode = (rows: unknown[], inventoryCode: string): unknown[] => {
  const normalizedCode = inventoryCode.trim().toLocaleLowerCase();
  const rowsWithCode = rows.filter((row) => Boolean(getRowInventoryCode(row)));

  // Some T+ responses omit the inventory code because it was fixed in the
  // request. In that case the rows are still valid and must be retained.
  if (rowsWithCode.length === 0) {
    return rows;
  }

  return rowsWithCode.filter(
    (row) => getRowInventoryCode(row).toLocaleLowerCase() === normalizedCode
  );
};

export const parseCurrentStockRows = (
  payload: ChanjetCurrentStockResponse,
  inventoryCode: string
): CurrentStockRow[] => {
  const rows = findStockPage(payload)?.rows ?? [];
  return filterRowsByInventoryCode(rows, inventoryCode).map((row) =>
    mapStockRow(row, inventoryCode)
  );
};

// Inventory count deliberately bypasses both caches. An absent code means zero
// only after every page of a successful, validated batch has been received.
export const fetchCurrentStockByInventoryCodes = async (
  account: ErpAccountConfig,
  inventoryCodes: string[]
): Promise<CurrentStockBatchResult> => {
  const codes = new Map<string, string>();
  for (const code of inventoryCodes) {
    if (!code.trim()) throw new Error('存货编码为空，无法批量查询库存');
    codes.set(code.trim().toLocaleLowerCase(), code.trim());
  }
  if (codes.size === 0 || codes.size > CURRENT_STOCK_BATCH_SIZE) {
    throw new Error(`每批库存查询需要 1 至 ${CURRENT_STOCK_BATCH_SIZE} 个存货编码`);
  }
  const baseUrl = requireErpAccountBackend(account);
  const rows: CurrentStockRow[] = [];
  const seenPages = new Set<string>();
  let totalCount: number | null = null;
  let requestCount = 0;
  // Bound unexpected upstream paging; exceeding this cap rejects the whole count.
  for (let pageIndex = 1; pageIndex <= 100; pageIndex += 1) {
    const requestPage = async () => {
      requestCount += 1;
      return backendJsonRequest<unknown>(CURRENT_STOCK_QUERY_PATH, {
        baseUrl,
        body: {
          param: {
            Inventory: Array.from(codes.values(), (Code) => ({ Code })),
            PageSize: String(CURRENT_STOCK_PAGE_SIZE),
            PageIndex: String(pageIndex),
            GroupInfo: { Warehouse: true, Inventory: true },
          },
        },
        erpAccountKey: account.key,
        erpCacheMode: 'bypass',
      });
    };
    let response: unknown;
    try {
      response = await requestPage();
    } catch (error) {
      const transient = error instanceof BackendNetworkError ||
        (error instanceof BackendApiError && [429, 502, 503, 504].includes(error.status));
      if (!transient) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await requestPage();
    }
    const payload = extractPayload(response);
    const page = findStockPage(payload);
    if (!page || (asRecord(response).success !== true && String(payload.code) !== '0')) {
      throw new Error('ERP未返回有效的库存明细，不能按零库存完成盘点');
    }
    if (page.totalCount !== null) {
      if (totalCount !== null && totalCount !== page.totalCount) {
        throw new Error('ERP库存分页总数发生变化，请重新完成盘点');
      }
      totalCount = page.totalCount;
    }
    const fingerprint = JSON.stringify(page.rows);
    if (page.rows.length > 0 && seenPages.has(fingerprint)) {
      throw new Error('ERP重复返回同一页库存，已停止核对');
    }
    seenPages.add(fingerprint);
    for (const raw of page.rows) {
      const row = mapStockRow(raw, codes.size === 1 ? Array.from(codes.values())[0] : '');
      if (!codes.has(row.inventoryCode.toLocaleLowerCase())) {
        throw new Error('ERP批量库存明细缺少存货编码或返回了未请求的编码');
      }
      if (row.quantity === null) {
        throw new Error(`ERP未返回 ${row.inventoryCode} 的现存量，不能用可用量代替`);
      }
      // T+ may include unassigned reservation rows with zero existing stock.
      if (account.expectedWarehouseName && !row.warehouseName && row.quantity !== 0) {
        throw new Error(`ERP未返回 ${row.inventoryCode} 的仓库，无法核对盘点范围`);
      }
      rows.push(row);
    }
    if (totalCount !== null) {
      if (rows.length > totalCount || (rows.length < totalCount && page.rows.length === 0)) {
        throw new Error('ERP库存分页明细不完整，请重新完成盘点');
      }
      if (rows.length === totalCount) return { accountKey: account.key, rows, requestCount };
    } else if (page.rows.length < CURRENT_STOCK_PAGE_SIZE) {
      return { accountKey: account.key, rows, requestCount };
    }
  }
  throw new Error('ERP库存分页超过安全上限，请检查返回数据后重试');
};

export const fetchCurrentStockByInventoryCode = async (
  account: ErpAccountConfig,
  inventoryCode: string,
  options: { forceRefresh?: boolean } = {}
): Promise<CurrentStockQueryResult> => {
  const requestedInventoryCode = inventoryCode.trim();
  if (!requestedInventoryCode) {
    throw new Error('存货编码为空，无法查询库存');
  }

  const cacheKey = `${account.key}:${requestedInventoryCode.toLocaleLowerCase()}`;
  if (!options.forceRefresh) {
    const cached = currentStockCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= CURRENT_STOCK_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const requestKey = `${cacheKey}:${options.forceRefresh ? 'bypass' : 'default'}`;
  const existingRequest = currentStockRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const response = await backendJsonRequest<unknown>(CURRENT_STOCK_QUERY_PATH, {
      baseUrl: requireErpAccountBackend(account),
      body: {
        param: {
          Inventory: [{ Code: requestedInventoryCode }],
          PageSize: '100',
          PageIndex: '1',
          GroupInfo: {
            Warehouse: true,
            Inventory: true,
          },
        },
      },
      erpAccountKey: account.key,
      erpCacheMode: options.forceRefresh ? 'bypass' : 'default',
    });
    const payload = extractPayload(response);
    if (!findStockPage(payload) || (asRecord(response).success !== true && String(payload.code) !== '0')) {
      throw new Error('ERP未返回有效的库存明细，请重新查询');
    }
    const rows = parseCurrentStockRows(payload, requestedInventoryCode);
    const result = {
      accountKey: account.key,
      accountName: account.name,
      inventoryCode: requestedInventoryCode,
      rows,
    };

    currentStockCache.set(cacheKey, {
      cachedAt: Date.now(),
      result,
    });
    return result;
  })();

  currentStockRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (currentStockRequests.get(requestKey) === request) {
      currentStockRequests.delete(requestKey);
    }
  }
};
