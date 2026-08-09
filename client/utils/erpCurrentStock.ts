import { backendJsonRequest, buildErpProxyPath } from '@/utils/backendApi';
import { type ErpAccountConfig, requireErpAccountBackend } from '@/utils/erpAccounts';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const CURRENT_STOCK_QUERY_PATH = buildErpProxyPath('/api/erp/tplus/current-stock/query');
const CURRENT_STOCK_CACHE_TTL_MS = 15_000;

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

const findRows = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  for (const key of ROW_COLLECTION_KEYS) {
    const rows = findRows(value[key]);
    if (rows.length > 0) {
      return rows;
    }
  }

  // Do not inspect arbitrary object values here. ERP responses may contain
  // unrelated arrays (for example paging metadata or grouping options).
  return [];
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
      'AvailableQuantity',
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
  const rows = findRows(payload.data ?? payload.value ?? payload);
  return filterRowsByInventoryCode(rows, inventoryCode).map((row) =>
    mapStockRow(row, inventoryCode)
  );
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
