import type { ErpAccountKey } from './erpAccounts';
import type { CurrentStockRow } from './erpCurrentStock';

export type StockQuerySnapshot = {
  inventoryCode: string;
  specification: string;
  queriedAt: string;
  rows: CurrentStockRow[];
};

// One display snapshot per account, kept only for the lifetime of the app process.
const snapshots = new Map<ErpAccountKey, StockQuerySnapshot>();
let selectedAccountKey: ErpAccountKey | undefined;

export const getStockQuerySelectedAccount = () => selectedAccountKey;

export const rememberStockQueryAccount = (accountKey: ErpAccountKey) => {
  selectedAccountKey = accountKey;
};

export const getStockQuerySnapshot = (accountKey: ErpAccountKey) =>
  snapshots.get(accountKey) ?? null;

export const saveStockQuerySnapshot = (accountKey: ErpAccountKey, snapshot: StockQuerySnapshot) => {
  snapshots.set(accountKey, snapshot);
};

export const clearStockQuerySession = () => {
  selectedAccountKey = undefined;
  snapshots.clear();
};
