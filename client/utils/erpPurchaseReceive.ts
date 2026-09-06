import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendJsonRequest, buildErpProxyPath } from '@/utils/backendApi';
import {
  type ErpAccountConfig,
  type ErpAccountKey,
  getErpAccountByKey,
  requireErpAccountBackend,
} from '@/utils/erpAccounts';
import { safeJsonParseNullable } from '@/utils/json';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';

const PURCHASE_RECEIVE_LIST_PATH = buildErpProxyPath(
  '/tplus/api/v2/PurchaseReceiveOpenApi/FindVoucherList'
);
const PURCHASE_RECEIVE_DETAIL_PATH = buildErpProxyPath(
  '/tplus/api/v2/PurchaseReceiveOpenApi/GetVoucherDTO'
);
const PURCHASE_RECEIVE_STATUS_PATH = buildErpProxyPath(
  '/api/erp/tplus/purchase-receive/statuses'
);
const PURCHASE_RECEIVE_CACHE_PREFIX = 'erp_purchase_receive_v2';
const PURCHASE_RECEIVE_STATUS_CACHE_PREFIX = 'erp_purchase_receive_status_v1';
const PURCHASE_RECEIVE_DETAIL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type MaybeRecord = Record<string, unknown>;

type ChanjetProxyResponse = {
  data?: unknown;
  details?: unknown;
  message?: string;
  success?: boolean;
};

type PurchaseReceiveCacheEntry<T> = {
  cachedAt: string;
  data: T;
};

export interface PurchaseReceiveListItem {
  accountKey: ErpAccountKey;
  code: string;
  id: string;
  partnerCode: string;
  partnerName: string;
  stateCode: string;
  stateName: string;
  voucherDate: string;
  warehouseCode: string;
  warehouseName: string;
}

export interface PurchaseReceiveListResult {
  items: PurchaseReceiveListItem[];
  pageIndex: number;
  totalCount: number;
  totalPageNum: number;
}

const pendingListRequests = new Map<string, Promise<PurchaseReceiveListResult>>();
const purchaseReceiveStatusRequests = new Map<
  ErpAccountKey,
  Promise<PurchaseReceiveVoucherStatus[]>
>();

export interface PurchaseReceiveVoucherStatus {
  eventId: string;
  messageTime: string;
  orgId: string;
  receivedAt: string;
  status: 'audited' | 'unaudited';
  voucherCode: string;
  voucherDate: string;
  voucherId: string;
}

export interface PurchaseReceiveLine {
  id: string;
  inventoryCode: string;
  inventoryName: string;
  purchaseOrderCode: string;
  quantity: number;
  raw: MaybeRecord;
  sourceVoucherCode: string;
  specification: string;
  unitName: string;
}

export interface PurchaseReceiveVoucher {
  accountKey: ErpAccountKey;
  accountName: string;
  code: string;
  id: string;
  lines: PurchaseReceiveLine[];
  partnerCode: string;
  partnerName: string;
  raw: MaybeRecord;
  sourceVoucherCode: string;
  stateCode: string;
  stateName: string;
  voucherDate: string;
  warehouseCode: string;
  warehouseName: string;
}

export const isPurchaseReceiveWarehouseAllowed = (
  account: ErpAccountConfig,
  warehouseName: string
): boolean =>
  account.key !== 'shanghai-chipmunk' ||
  warehouseName.trim() === account.expectedWarehouseName.trim();

const isRecord = (value: unknown): value is MaybeRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): MaybeRecord => (isRecord(value) ? value : {});

const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const asNumber = (value: unknown): number => {
  const parsed = Number(asText(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPayloadPreview = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').slice(0, 180);
  }

  try {
    return JSON.stringify(value).slice(0, 260);
  } catch {
    return String(value).slice(0, 180);
  }
};

const extractChanjetPayload = (response: unknown): MaybeRecord => {
  if (!isRecord(response)) {
    throw new Error(`采购入库接口返回结构异常：${formatPayloadPreview(response)}`);
  }

  const proxy = response as ChanjetProxyResponse;
  if (proxy.success === false) {
    throw new Error(
      (asText(proxy.message)
        ? formatUserFacingErrorMessage(proxy.message, '后端ERP代理请求失败')
        : '') || `后端ERP代理请求失败：${formatPayloadPreview(proxy.details || response)}`
    );
  }

  const payload = isRecord(proxy.data) ? proxy.data : response;
  if (asText(payload.code) !== '0') {
    const upstreamMessage = asText(payload.message)
      ? formatUserFacingErrorMessage(payload.message, 'ERP未提供具体错误原因')
      : '';
    throw new Error(`采购入库接口查询失败${upstreamMessage ? `：${upstreamMessage}` : ''}`);
  }

  return payload;
};

const normalizeColumnName = (value: string): string =>
  value.toLowerCase().replace(/^rdrecord/, '').replace(/[^a-z0-9]/g, '');

const readListCell = (row: unknown[], columnIndex: Map<string, number>, columnName: string): string => {
  const index = columnIndex.get(normalizeColumnName(columnName));
  return index === undefined ? '' : asText(row[index]);
};

const mapPurchaseReceiveLine = (value: unknown): PurchaseReceiveLine => {
  const raw = asRecord(value);
  const inventory = asRecord(raw.Inventory);
  const unit = asRecord(raw.Unit);

  return {
    id: asText(raw.ID || raw.Code),
    inventoryCode: asText(inventory.Code),
    inventoryName: asText(inventory.Name),
    purchaseOrderCode: asText(raw.PurchaseOrderCode),
    quantity: asNumber(raw.Quantity),
    raw,
    sourceVoucherCode: asText(raw.SourceVoucherCode),
    specification: asText(inventory.Specification),
    unitName: asText(unit.Name),
  };
};

export const mapPurchaseReceiveVoucher = (
  account: ErpAccountConfig,
  value: MaybeRecord
): PurchaseReceiveVoucher => {
  const partner = asRecord(value.Partner);
  const warehouse = asRecord(value.Warehouse);
  const voucherState = asRecord(value.VoucherState);
  const details = Array.isArray(value.RDRecordDetails) ? value.RDRecordDetails : [];

  return {
    accountKey: account.key,
    accountName: account.name,
    code: asText(value.Code),
    id: asText(value.ID),
    lines: details.map(mapPurchaseReceiveLine),
    partnerCode: asText(partner.Code),
    partnerName: asText(partner.Name),
    raw: value,
    sourceVoucherCode: asText(value.SourceVoucherCode),
    stateCode: asText(voucherState.Code),
    stateName: asText(voucherState.Name),
    voucherDate: asText(value.VoucherDate),
    warehouseCode: asText(warehouse.Code),
    warehouseName: asText(warehouse.Name),
  };
};

const getListCacheKey = (accountKey: ErpAccountKey) =>
  `${PURCHASE_RECEIVE_CACHE_PREFIX}:pending:${accountKey}`;

const getDetailCacheKey = (accountKey: ErpAccountKey, voucherCode: string) =>
  `${PURCHASE_RECEIVE_CACHE_PREFIX}:detail:${accountKey}:${voucherCode.trim().toUpperCase()}`;

const getStatusCacheKey = (accountKey: ErpAccountKey) =>
  `${PURCHASE_RECEIVE_STATUS_CACHE_PREFIX}:${accountKey}`;

const readCache = async <T>(key: string): Promise<PurchaseReceiveCacheEntry<T> | null> => {
  const text = await AsyncStorage.getItem(key);
  return text ? safeJsonParseNullable<PurchaseReceiveCacheEntry<T>>(text, key) : null;
};

const writeCache = async <T>(key: string, data: T): Promise<PurchaseReceiveCacheEntry<T>> => {
  const entry = { cachedAt: new Date().toISOString(), data };
  await AsyncStorage.setItem(key, JSON.stringify(entry));
  return entry;
};

export const loadCachedPendingPurchaseReceives = async (accountKey: ErpAccountKey) => {
  const cached = await readCache<PurchaseReceiveListResult>(getListCacheKey(accountKey));
  const account = getErpAccountByKey(accountKey);
  if (!cached || !account) {
    return cached;
  }

  return {
    ...cached,
    data: {
      ...cached.data,
      items: cached.data.items.filter((item) =>
        isPurchaseReceiveWarehouseAllowed(account, item.warehouseName)
      ),
    },
  };
};

export const savePendingPurchaseReceivesCache = (
  accountKey: ErpAccountKey,
  data: PurchaseReceiveListResult
) => writeCache(getListCacheKey(accountKey), data);

export const loadCachedPurchaseReceiveVoucher = async (
  accountKey: ErpAccountKey,
  voucherCode: string
) => {
  const cacheKey = getDetailCacheKey(accountKey, voucherCode);
  const cached = await readCache<PurchaseReceiveVoucher>(cacheKey);
  if (!cached) {
    return null;
  }

  const cachedAt = Date.parse(cached.cachedAt);
  if (
    !Number.isFinite(cachedAt) ||
    Date.now() - cachedAt > PURCHASE_RECEIVE_DETAIL_CACHE_TTL_MS
  ) {
    await AsyncStorage.removeItem(cacheKey);
    return null;
  }

  const account = getErpAccountByKey(accountKey);
  if (
    account &&
    !isPurchaseReceiveWarehouseAllowed(account, cached.data.warehouseName)
  ) {
    await AsyncStorage.removeItem(cacheKey);
    return null;
  }

  return cached;
};

export const savePurchaseReceiveVoucherCache = (voucher: PurchaseReceiveVoucher) =>
  writeCache(getDetailCacheKey(voucher.accountKey, voucher.code), voucher);

export const loadCachedPurchaseReceiveVoucherStatuses = (accountKey: ErpAccountKey) =>
  readCache<PurchaseReceiveVoucherStatus[]>(getStatusCacheKey(accountKey));

export const savePurchaseReceiveVoucherStatusesCache = (
  accountKey: ErpAccountKey,
  statuses: PurchaseReceiveVoucherStatus[]
) => writeCache(getStatusCacheKey(accountKey), statuses);

export const fetchPurchaseReceiveVoucherStatuses = async (
  account: ErpAccountConfig
): Promise<PurchaseReceiveVoucherStatus[]> => {
  const existingRequest = purchaseReceiveStatusRequests.get(account.key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const response = await backendJsonRequest<unknown>(PURCHASE_RECEIVE_STATUS_PATH, {
      baseUrl: requireErpAccountBackend(account),
      body: {},
      erpAccountKey: account.key,
    });
    if (!isRecord(response)) {
      throw new Error(`采购入库审核状态返回异常：${formatPayloadPreview(response)}`);
    }
    if (response.success === false) {
      throw new Error(
        asText(response.message)
          ? formatUserFacingErrorMessage(response.message, '采购入库审核状态读取失败')
          : '采购入库审核状态读取失败'
      );
    }

    const statuses = Array.isArray(response.statuses) ? response.statuses : [];
    return statuses
      .map((value): PurchaseReceiveVoucherStatus | null => {
        const status = asRecord(value);
        const voucherCode = asText(status.voucherCode).toUpperCase();
        const statusValue = status.status;
        if (
          !voucherCode ||
          (statusValue !== 'audited' && statusValue !== 'unaudited')
        ) {
          return null;
        }

        return {
          eventId: asText(status.eventId),
          messageTime: asText(status.messageTime),
          orgId: asText(status.orgId),
          receivedAt: asText(status.receivedAt),
          status: statusValue,
          voucherCode,
          voucherDate: asText(status.voucherDate),
          voucherId: asText(status.voucherId),
        };
      })
      .filter((status): status is PurchaseReceiveVoucherStatus => status !== null);
  })();

  purchaseReceiveStatusRequests.set(account.key, request);
  try {
    return await request;
  } finally {
    if (purchaseReceiveStatusRequests.get(account.key) === request) {
      purchaseReceiveStatusRequests.delete(account.key);
    }
  }
};

export const fetchPendingPurchaseReceives = async (
  account: ErpAccountConfig,
  pageIndex = 0,
  pageSize = 100,
  options: { bypassCache?: boolean } = {}
): Promise<PurchaseReceiveListResult> => {
  const requestKey = `${account.key}:${pageIndex}:${pageSize}:${
    options.bypassCache ? 'bypass' : 'default'
  }`;
  const existingRequest = pendingListRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async (): Promise<PurchaseReceiveListResult> => {
    const response = await backendJsonRequest<unknown>(PURCHASE_RECEIVE_LIST_PATH, {
      baseUrl: requireErpAccountBackend(account),
      body: {
        pageSize,
        pageIndex,
        selectFields: [
          'RDRecord.Code',
          'RDRecord.ID',
          'RDRecord.VoucherDate',
          'RDRecord.Partner.Code',
          'RDRecord.Partner.Name',
          'RDRecord.Warehouse.Code',
          'RDRecord.Warehouse.Name',
          'RDRecord.VoucherState.Code',
          'RDRecord.VoucherState.Name',
        ],
        paramDic: {
          'RDRecord.VoucherState.Code': [
            {
              text: '未审',
              value: '00',
            },
          ],
        },
      },
      erpAccountKey: account.key,
      erpCacheMode: options.bypassCache ? 'bypass' : 'default',
    });
    const payload = extractChanjetPayload(response);
    const data = asRecord(payload.data);
    const columns = Array.isArray(data.Columns) ? data.Columns.map(asText) : [];
    const rows = Array.isArray(data.Rows) ? data.Rows : [];
    const columnIndex = new Map(
      columns.map((column, index) => [normalizeColumnName(column), index])
    );

    const items = rows
      .filter(Array.isArray)
      .map((row) => ({
        accountKey: account.key,
        code: readListCell(row, columnIndex, 'code'),
        id: readListCell(row, columnIndex, 'id'),
        partnerCode: readListCell(row, columnIndex, 'partnercode'),
        partnerName: readListCell(row, columnIndex, 'partnername'),
        stateCode: readListCell(row, columnIndex, 'voucherstatecode'),
        stateName: readListCell(row, columnIndex, 'voucherstatename'),
        voucherDate: readListCell(row, columnIndex, 'voucherdate'),
        warehouseCode: readListCell(row, columnIndex, 'warehousecode'),
        warehouseName: readListCell(row, columnIndex, 'warehousename'),
      }))
      .filter((item) => item.code)
      .filter((item) => item.stateCode === '00' || item.stateName === '未审')
      .filter((item) =>
        isPurchaseReceiveWarehouseAllowed(account, item.warehouseName)
      );

    return {
      items,
      pageIndex,
      totalCount: asNumber(data.TotalCount),
      totalPageNum: asNumber(data.TotalPageNum),
    };
  })();

  pendingListRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (pendingListRequests.get(requestKey) === request) {
      pendingListRequests.delete(requestKey);
    }
  }
};

export const fetchPurchaseReceiveVoucher = async (
  account: ErpAccountConfig,
  voucherCode: string,
  options: { bypassCache?: boolean } = {}
): Promise<PurchaseReceiveVoucher> => {
  const normalizedCode = voucherCode.trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error('采购入库单号不能为空');
  }

  const response = await backendJsonRequest<unknown>(PURCHASE_RECEIVE_DETAIL_PATH, {
    baseUrl: requireErpAccountBackend(account),
    body: {
      param: {
        voucherCode: normalizedCode,
      },
    },
    erpAccountKey: account.key,
    erpCacheMode: options.bypassCache ? 'bypass' : 'default',
  });
  const payload = extractChanjetPayload(response);
  const voucher = mapPurchaseReceiveVoucher(account, asRecord(payload.data));

  if (!voucher.code) {
    throw new Error(`采购入库单查询失败（账套：${account.name}，单号：${normalizedCode}）`);
  }
  if (voucher.code.trim().toUpperCase() !== normalizedCode) {
    throw new Error(
      `ERP返回单号与所选单号不一致：选择 ${normalizedCode}，返回 ${voucher.code}`
    );
  }
  if (voucher.stateCode !== '00') {
    throw new Error(`${voucher.code} 当前状态为${voucher.stateName || voucher.stateCode}，不再允许扫码入库`);
  }
  if (voucher.warehouseName && voucher.warehouseName !== account.expectedWarehouseName) {
    throw new Error(
      `${account.name} 单据仓库应为 ${account.expectedWarehouseName}，实际为 ${voucher.warehouseName}`
    );
  }

  return voucher;
};
