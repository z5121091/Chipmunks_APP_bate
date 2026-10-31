type PurchaseApi = typeof import('../erpPurchaseReceive');
type Accounts = typeof import('../erpAccounts');
let api: PurchaseApi;
let accounts: Accounts['ERP_ACCOUNTS'];
let request: jest.Mock;
let storage: typeof import('@react-native-async-storage/async-storage').default;

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backendApi', () => ({
  ...jest.requireActual('../backendApi'), backendJsonRequest: jest.fn(),
}));

const result = (code: string, account: Accounts['ERP_ACCOUNTS'][number]) => ({
  items: [{ accountKey: account.key, code, id: code, partnerCode: '', partnerName: '',
    stateCode: '00', stateName: '未审', voucherDate: '', warehouseCode: '',
    warehouseName: account.expectedWarehouseName }],
  pageIndex: 0, totalCount: 1, totalPageNum: 1,
});
const response = (code: string, account: Accounts['ERP_ACCOUNTS'][number], total = 1) => ({
  success: true, data: { code: '0', data: {
    Columns: ['RDRecord.Code', 'RDRecord.Warehouse.Name', 'RDRecord.VoucherState.Code'],
    Rows: [[code, account.expectedWarehouseName, '00']], TotalCount: total,
    TotalPageNum: Math.ceil(total / 100),
  } },
});

const loadModules = () => {
  api = require('../erpPurchaseReceive');
  accounts = require('../erpAccounts').ERP_ACCOUNTS;
  request = require('../backendApi').backendJsonRequest;
  const storageModule = require('@react-native-async-storage/async-storage');
  storage = storageModule.default || storageModule;
};

const restartWithPersistedStorage = async () => {
  const entries = await storage.multiGet(await storage.getAllKeys());
  jest.resetModules();
  loadModules();
  await storage.multiSet(entries.map(([key, value]) => [key, value || '']));
};

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 17, 9));
  loadModules();
  jest.restoreAllMocks();
  await storage.clear();
});
afterEach(() => jest.useRealTimers());

it('publishes a synchronous account-isolated snapshot for the next screen', async () => {
  expect(api.getPendingPurchaseReceivesSnapshot(accounts[0].key)).toBeNull();
  const a = await api.savePendingPurchaseReceivesCache(accounts[0].key, result('II-A', accounts[0]));
  const b = await api.savePendingPurchaseReceivesCache(accounts[1].key, result('II-B', accounts[1]));
  expect(api.getPendingPurchaseReceivesSnapshot(accounts[0].key)).toBe(a);
  expect(api.getPendingPurchaseReceivesSnapshot(accounts[1].key)).toBe(b);
});

it('reuses today\'s prefetched list even hours later, but manual refresh reads ERP', async () => {
  const cached = await api.savePendingPurchaseReceivesCache(accounts[0].key, result('OLD', accounts[0]));
  jest.setSystemTime(Date.now() + 8 * 60 * 60_000);
  expect(await api.revalidatePendingPurchaseReceives(accounts[0])).toBe(cached);
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(response('NEW', accounts[0]));
  const refreshed = await api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true });
  expect(refreshed.data.items[0].code).toBe('NEW');
  expect(request.mock.calls[0][1].erpCacheMode).toBe('bypass');
  expect(api.getPendingPurchaseReceivesSnapshot(accounts[0].key)).toBe(refreshed);
});

it('loads once again on the next local calendar day', async () => {
  await api.savePendingPurchaseReceivesCache(accounts[0].key, result('OLD', accounts[0]));
  jest.setSystemTime(new Date(2026, 9, 18, 9));
  request.mockResolvedValueOnce(response('LATEST', accounts[0]));
  expect((await api.revalidatePendingPurchaseReceives(accounts[0])).data.items[0].code).toBe('LATEST');
  expect(request).toHaveBeenCalledTimes(1);
});

it('shares an active prefetch with page entry and manual refresh', async () => {
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  request.mockImplementationOnce(() => {
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  const home = api.revalidatePendingPurchaseReceives(accounts[0]);
  const entry = api.revalidatePendingPurchaseReceives(accounts[0]);
  await start;
  const manual = api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true });
  expect(request).toHaveBeenCalledTimes(1);
  finish(response('SHARED', accounts[0]));
  const [a, b, c] = await Promise.all([home, entry, manual]);
  expect(a).toBe(b);
  expect(b).toBe(c);
});

it('preserves the complete old list when a later ERP page fails', async () => {
  const cached = await api.savePendingPurchaseReceivesCache(accounts[0].key, result('COMPLETE-OLD', accounts[0]));
  request.mockResolvedValueOnce(response('PARTIAL-NEW', accounts[0], 101))
    .mockRejectedValueOnce(new Error('second page failed'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true }))
    .rejects.toThrow('second page failed');
  expect(api.getPendingPurchaseReceivesSnapshot(accounts[0].key)).toBe(cached);
  request.mockResolvedValueOnce(response('RETRY', accounts[0]));
  expect((await api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true }))
    .data.items[0].code).toBe('RETRY');
});

it('does not let an old disk read replace a completed network snapshot', async () => {
  let finishDisk!: (value: string) => void;
  jest.spyOn(storage, 'getItem').mockImplementationOnce(() => new Promise(resolve => { finishDisk = resolve; }));
  const disk = api.loadCachedPendingPurchaseReceives(accounts[0].key);
  const latest = await api.savePendingPurchaseReceivesCache(accounts[0].key, result('NEW', accounts[0]));
  finishDisk(JSON.stringify({ cachedAt: '2026-10-16T00:00:00Z', data: result('OLD', accounts[0]) }));
  expect(await disk).toBe(latest);
});

it('does not use cached data to bypass disabled-account configuration', async () => {
  await api.savePendingPurchaseReceivesCache(accounts[0].key, result('OLD', accounts[0]));
  await expect(api.revalidatePendingPurchaseReceives({ ...accounts[0], erpEnabled: false }))
    .rejects.toThrow('暂未开放');
  expect(request).not.toHaveBeenCalled();
});

it('does not repeat a successful daily preload after an app restart', async () => {
  request.mockResolvedValueOnce(response('TODAY', accounts[0]));
  await api.revalidatePendingPurchaseReceives(accounts[0]);
  await restartWithPersistedStorage();
  expect((await api.revalidatePendingPurchaseReceives(accounts[0])).data.items[0].code).toBe('TODAY');
  expect(request).not.toHaveBeenCalled();
});

it('persists a failed attempt before querying and does not automatically retry after restart', async () => {
  request.mockRejectedValueOnce(new Error('ERP offline'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('ERP offline');
  await restartWithPersistedStorage();
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('请点击刷新重试');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(response('MANUAL', accounts[0]));
  expect((await api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true }))
    .data.items[0].code).toBe('MANUAL');
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps yesterday\'s complete list after failure without spending another automatic attempt today', async () => {
  await api.savePendingPurchaseReceivesCache(accounts[0].key, result('YESTERDAY', accounts[0]));
  jest.setSystemTime(new Date(2026, 9, 18, 9));
  request.mockRejectedValueOnce(new Error('ERP offline'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('ERP offline');
  expect((await api.revalidatePendingPurchaseReceives(accounts[0])).data.items[0].code).toBe('YESTERDAY');
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps empty successful lists cached instead of preloading them repeatedly', async () => {
  request.mockResolvedValueOnce({ success: true, data: { code: '0', data: {
    Columns: [], Rows: [], TotalCount: 0, TotalPageNum: 0,
  } } });
  const first = await api.revalidatePendingPurchaseReceives(accounts[0]);
  const second = await api.revalidatePendingPurchaseReceives(accounts[0]);
  expect(first.data.items).toEqual([]);
  expect(second).toBe(first);
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not let an automatic cache-only check swallow a concurrent manual refresh', async () => {
  await api.savePendingPurchaseReceivesCache(accounts[0].key, result('OLD', accounts[0]));
  let finishRead!: (value: string | null) => void;
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  jest.spyOn(storage, 'getItem').mockImplementationOnce(() => {
    started();
    return new Promise(resolve => { finishRead = resolve; });
  });
  const automatic = api.revalidatePendingPurchaseReceives(accounts[0]);
  await reading;
  request.mockResolvedValueOnce(response('MANUAL', accounts[0]));
  const manual = await api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true });
  expect(manual.data.items[0].code).toBe('MANUAL');
  finishRead(null);
  expect((await automatic).data.items[0].code).toBe('MANUAL');
  expect(request).toHaveBeenCalledTimes(1);
});

it('reserves one automatic attempt while concurrent callers wait for storage', async () => {
  const originalSetItem = storage.setItem.bind(storage);
  let finishWrite!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  jest.spyOn(storage, 'setItem').mockImplementationOnce((key, value) => {
    started();
    return new Promise<void>(resolve => { finishWrite = () => { void originalSetItem(key, value).then(resolve); }; });
  });
  request.mockResolvedValueOnce(response('SHARED', accounts[0]));
  const first = api.revalidatePendingPurchaseReceives(accounts[0]);
  await writing;
  const second = api.revalidatePendingPurchaseReceives(accounts[0]);
  expect(request).not.toHaveBeenCalled();
  finishWrite();
  const [a, b] = await Promise.all([first, second]);
  expect(a).toBe(b);
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not call ERP automatically when the attempt record cannot be persisted', async () => {
  jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('storage full');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(response('MANUAL', accounts[0]));
  await api.revalidatePendingPurchaseReceives(accounts[0], { forceRefresh: true });
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps each account\'s automatic attempt independent', async () => {
  request.mockRejectedValueOnce(new Error('account A offline'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('account A offline');
  request.mockResolvedValueOnce(response('ACCOUNT-B', accounts[1]));
  expect((await api.revalidatePendingPurchaseReceives(accounts[1])).data.items[0].code).toBe('ACCOUNT-B');
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('请点击刷新重试');
  expect(request).toHaveBeenCalledTimes(2);
});

it('allows one new attempt after local midnight even if yesterday\'s preload failed', async () => {
  jest.setSystemTime(new Date(2026, 9, 17, 23, 59, 59));
  request.mockRejectedValueOnce(new Error('offline before midnight'));
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('offline before midnight');
  await expect(api.revalidatePendingPurchaseReceives(accounts[0])).rejects.toThrow('请点击刷新重试');
  jest.setSystemTime(new Date(2026, 9, 18, 0, 0, 1));
  request.mockResolvedValueOnce(response('NEXT-DAY', accounts[0]));
  const next = await api.revalidatePendingPurchaseReceives(accounts[0]);
  expect(next.data.items[0].code).toBe('NEXT-DAY');
  expect(await api.revalidatePendingPurchaseReceives(accounts[0])).toBe(next);
  expect(request).toHaveBeenCalledTimes(2);
});
