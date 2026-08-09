import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/config';
import {
  getAllWarehouses,
  getExistingInventoryCheckRecordIds,
  getInboundDocumentSummaries,
  getMaterialsByOrder,
  type Warehouse,
} from '@/utils/database';
import {
  ERP_ACCOUNTS,
  isErpAccountAvailable,
  type ErpAccountKey,
} from '@/utils/erpAccounts';
import {
  loadCachedPendingPurchaseReceives,
  loadCachedPurchaseReceiveVoucherStatuses,
} from '@/utils/erpPurchaseReceive';
import { safeJsonParseNullable } from '@/utils/json';
import { logger } from '@/utils/logger';

const INBOUND_RECORDS_PREFIX = 'inbound_scan_records:';
const INBOUND_PENDING_PREFIX = 'inbound_pending_data:';
const LEGACY_INBOUND_RECORDS_KEY = 'inbound_scan_records';
const LEGACY_INBOUND_PENDING_KEY = 'inbound_pending_data';
const INVENTORY_RECORDS_KEY = 'inventory_check_records';

type DraftRecord = {
  id?: string;
  model?: string;
  quantity?: number | string;
};

type OutboundDraft = {
  customerName?: string;
  erpVoucher?: {
    accountKey?: ErpAccountKey;
    accountName?: string;
    lines?: Array<{ quantity?: number }>;
  };
  orderNo?: string;
  updatedAt?: string;
  warehouseId?: string;
  warehouseName?: string;
};

type InboundPendingData = {
  inboundNo?: string;
  supplier?: string | null;
  warehouseId?: string;
  warehouseName?: string;
};

type InventoryDraftStore = Record<
  string,
  {
    partial?: DraftRecord[];
    whole?: DraftRecord[];
  }
>;

const readInventoryDraftLists = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { partial: [] as DraftRecord[], whole: [] as DraftRecord[] };
  }

  const draft = value as InventoryDraftStore[string];
  return {
    partial: Array.isArray(draft.partial) ? draft.partial : [],
    whole: Array.isArray(draft.whole) ? draft.whole : [],
  };
};

export type HomeWorkKind = 'outbound' | 'inbound' | 'inventory';

export interface HomeActiveWork {
  accountKey?: ErpAccountKey;
  detail: string;
  id: string;
  kind: HomeWorkKind;
  route: '/outbound' | '/inbound' | '/inventory';
  subtitle: string;
  title: string;
  voucherCode?: string;
  warehouseId?: string;
}

export interface HomePendingReceipt {
  accountKey: ErpAccountKey;
  code: string;
  partnerName: string;
  voucherDate: string;
  warehouseName: string;
}

export interface HomeWorkspaceSnapshot {
  activeWork: HomeActiveWork[];
  pendingReceipts: HomePendingReceipt[];
  pendingReceiptUpdatedAt: string;
}

const asTrimmedText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const parseQuantity = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || 0));
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumDraftQuantity = (records: readonly DraftRecord[]) =>
  records.reduce((total, record) => total + parseQuantity(record.quantity), 0);

const isMeaningfulDraftRecord = (value: unknown): value is DraftRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as DraftRecord;
  return Boolean(
    asTrimmedText(record.id) &&
      asTrimmedText(record.model) &&
      parseQuantity(record.quantity) > 0
  );
};

const findAccountForWarehouse = (warehouseName?: string) =>
  ERP_ACCOUNTS.find(
    (account) =>
      warehouseName &&
      account.expectedWarehouseName.trim() === warehouseName.trim()
  ) || ERP_ACCOUNTS.find(isErpAccountAvailable) || ERP_ACCOUNTS[0];

const readOutboundWork = async (): Promise<HomeActiveWork | null> => {
  const rawDraft = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WORK_DRAFT);
  const draft = safeJsonParseNullable<OutboundDraft>(rawDraft, 'home.outboundDraft');
  const orderNo = asTrimmedText(draft?.orderNo).toUpperCase();
  const warehouseId = asTrimmedText(draft?.warehouseId);
  if (!draft || !orderNo || !warehouseId) {
    return null;
  }

  const records = await getMaterialsByOrder(orderNo, warehouseId);
  const scannedQuantity = records.reduce(
    (total, record) => total + parseQuantity(record.quantity),
    0
  );
  const expectedQuantity = Array.isArray(draft.erpVoucher?.lines)
    ? draft.erpVoucher.lines.reduce(
        (total, line) => total + parseQuantity(line.quantity),
        0
      )
    : 0;
  const progressText =
    expectedQuantity > 0
      ? `已扫 ${scannedQuantity.toLocaleString()} / 应出 ${expectedQuantity.toLocaleString()}`
      : `已扫 ${records.length} 件`;
  const customerName = asTrimmedText(draft.customerName) || '客户待读取';
  const warehouseName = asTrimmedText(draft.warehouseName) || '仓库待确认';

  return {
    accountKey: draft.erpVoucher?.accountKey,
    detail: progressText,
    id: `outbound:${warehouseId}:${orderNo}`,
    kind: 'outbound',
    route: '/outbound',
    subtitle: `${customerName} · ${warehouseName}`,
    title: orderNo,
    warehouseId,
  };
};

const readInboundWork = async (): Promise<HomeActiveWork[]> => {
  const allKeys = await AsyncStorage.getAllKeys();
  const scopedRecordKeys = allKeys.filter((key) => key.startsWith(INBOUND_RECORDS_PREFIX));
  const recordKeys =
    scopedRecordKeys.length > 0
      ? scopedRecordKeys
      : allKeys.includes(LEGACY_INBOUND_RECORDS_KEY)
        ? [LEGACY_INBOUND_RECORDS_KEY]
        : [];

  const workItems = await Promise.all(
    recordKeys.map(async (recordsKey): Promise<HomeActiveWork | null> => {
      const pendingKey =
        recordsKey === LEGACY_INBOUND_RECORDS_KEY
          ? LEGACY_INBOUND_PENDING_KEY
          : recordsKey.replace(INBOUND_RECORDS_PREFIX, INBOUND_PENDING_PREFIX);
      const [recordsText, pendingText] = await AsyncStorage.multiGet([
        recordsKey,
        pendingKey,
      ]);
      const records = safeJsonParseNullable<DraftRecord[]>(
        recordsText[1],
        `home.${recordsKey}`
      );
      const pending = safeJsonParseNullable<InboundPendingData>(
        pendingText[1],
        `home.${pendingKey}`
      );
      const voucherCode = asTrimmedText(pending?.inboundNo).toUpperCase();
      if (!Array.isArray(records) || records.length === 0 || !voucherCode) {
        return null;
      }

      const account = findAccountForWarehouse(pending?.warehouseName);
      const quantity = sumDraftQuantity(records);
      const supplier = asTrimmedText(pending?.supplier) || '供应商待读取';
      const warehouseName = asTrimmedText(pending?.warehouseName) || '仓库待确认';

      return {
        accountKey: account.key,
        detail: `${records.length} 条 · ${quantity.toLocaleString()} 件`,
        id: `inbound:${pending?.warehouseId || 'unknown'}:${voucherCode}`,
        kind: 'inbound',
        route: '/inbound',
        subtitle: `${supplier} · ${warehouseName}`,
        title: voucherCode,
        voucherCode,
        warehouseId: pending?.warehouseId,
      };
    })
  );

  return workItems.filter((item): item is HomeActiveWork => item !== null);
};

const readInventoryWork = async (warehouses: Warehouse[]): Promise<HomeActiveWork[]> => {
  const rawStore = await AsyncStorage.getItem(INVENTORY_RECORDS_KEY);
  const parsed = safeJsonParseNullable<unknown>(rawStore, 'home.inventoryDrafts');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    if (rawStore) {
      await AsyncStorage.removeItem(INVENTORY_RECORDS_KEY);
    }
    return [];
  }

  const store = parsed as Record<string, unknown>;
  const warehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
  const candidateIds = Object.entries(store).flatMap(([warehouseId, rawDraft]) => {
    if (!warehouseIds.has(warehouseId)) {
      return [];
    }

    const draft = readInventoryDraftLists(rawDraft);
    return [...draft.whole, ...draft.partial]
      .filter(isMeaningfulDraftRecord)
      .map((record) => asTrimmedText(record.id));
  });
  const savedRecordIds = await getExistingInventoryCheckRecordIds(candidateIds);
  const cleanedStore: InventoryDraftStore = {};

  const workItems = Object.entries(store).flatMap(([warehouseId, rawDraft]) => {
    if (!warehouseIds.has(warehouseId)) {
      return [];
    }

    const draft = readInventoryDraftLists(rawDraft);
    const whole = draft.whole
      .filter(isMeaningfulDraftRecord)
      .filter((record) => !savedRecordIds.has(asTrimmedText(record.id)));
    const partial = draft.partial
      .filter(isMeaningfulDraftRecord)
      .filter((record) => !savedRecordIds.has(asTrimmedText(record.id)));
    const totalCount = whole.length + partial.length;
    if (totalCount === 0) {
      return [];
    }

    cleanedStore[warehouseId] = {
      ...(whole.length > 0 ? { whole } : {}),
      ...(partial.length > 0 ? { partial } : {}),
    };

    const warehouseName =
      warehouses.find((warehouse) => warehouse.id === warehouseId)?.name || '';
    const quantity = sumDraftQuantity([...whole, ...partial]);

    return [
      {
        detail: `${totalCount} 条 · ${quantity.toLocaleString()} 件`,
        id: `inventory:${warehouseId}`,
        kind: 'inventory' as const,
        route: '/inventory' as const,
        subtitle: `${warehouseName} · 整包 ${whole.length} / 拆包 ${partial.length}`,
        title: '盘点暂存',
        warehouseId,
      },
    ];
  });

  const cleanedText = JSON.stringify(cleanedStore);
  if (cleanedText !== JSON.stringify(store)) {
    if (Object.keys(cleanedStore).length > 0) {
      await AsyncStorage.setItem(INVENTORY_RECORDS_KEY, cleanedText);
    } else {
      await AsyncStorage.removeItem(INVENTORY_RECORDS_KEY);
    }
  }

  return workItems;
};

const readPendingReceipts = async () => {
  const inboundDocuments = await getInboundDocumentSummaries();
  const accountResults = await Promise.all(
    ERP_ACCOUNTS.filter(isErpAccountAvailable).map(async (account) => {
      const [pendingCache, statusCache] = await Promise.all([
        loadCachedPendingPurchaseReceives(account.key),
        loadCachedPurchaseReceiveVoucherStatuses(account.key),
      ]);
      if (!pendingCache) {
        return { items: [] as HomePendingReceipt[], updatedAt: '' };
      }

      const completedCodes = new Set(
        inboundDocuments
          .filter(
            (document) =>
              document.warehouse_name.trim() === account.expectedWarehouseName.trim()
          )
          .map((document) => document.inbound_no.trim().toUpperCase())
      );
      const auditedCodes = new Set(
        (statusCache?.data || [])
          .filter((status) => status.status === 'audited')
          .map((status) => status.voucherCode.trim().toUpperCase())
      );

      return {
        items: pendingCache.data.items
          .filter((item) => {
            const code = item.code.trim().toUpperCase();
            return code && !completedCodes.has(code) && !auditedCodes.has(code);
          })
          .map((item) => ({
            accountKey: account.key,
            code: item.code.trim().toUpperCase(),
            partnerName: item.partnerName.trim(),
            voucherDate: item.voucherDate,
            warehouseName: item.warehouseName.trim(),
          })),
        updatedAt: pendingCache.cachedAt,
      };
    })
  );

  const updatedTimestamps = accountResults
    .map((result) => result.updatedAt)
    .filter(Boolean)
    .sort();
  const updatedAt = updatedTimestamps[updatedTimestamps.length - 1] || '';

  return {
    items: accountResults
      .flatMap((result) => result.items)
      .sort((a, b) => b.voucherDate.localeCompare(a.voucherDate)),
    updatedAt,
  };
};

export const loadHomeWorkspaceSnapshot = async (): Promise<HomeWorkspaceSnapshot> => {
  try {
    const warehouses = await getAllWarehouses();
    const [outboundWork, inboundWork, inventoryWork, pendingReceipts] =
      await Promise.all([
        readOutboundWork(),
        readInboundWork(),
        readInventoryWork(warehouses),
        readPendingReceipts(),
      ]);

    return {
      activeWork: [
        ...(outboundWork ? [outboundWork] : []),
        ...inboundWork,
        ...inventoryWork,
      ],
      pendingReceipts: pendingReceipts.items,
      pendingReceiptUpdatedAt: pendingReceipts.updatedAt,
    };
  } catch (error) {
    logger.warn('[首页] 读取本地作业快照失败:', error);
    return {
      activeWork: [],
      pendingReceipts: [],
      pendingReceiptUpdatedAt: '',
    };
  }
};
