import TestRenderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { usePendingPurchaseReceivePrefetch } from '../usePendingPurchaseReceivePrefetch';
import {
  fetchPurchaseReceiveVoucherStatuses,
  revalidatePendingPurchaseReceives,
  savePurchaseReceiveVoucherStatusesCache,
} from '@/utils/erpPurchaseReceive';
import { logger } from '@/utils/logger';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/utils/erpAccounts', () => ({
  ERP_ACCOUNTS: [{ key: 'shanghai-chipmunk', name: 'A' }, { key: 'wuxi-duneng', name: 'B' }],
  isErpAccountAvailable: () => true,
}));
jest.mock('@/utils/erpPurchaseReceive', () => ({
  fetchPurchaseReceiveVoucherStatuses: jest.fn(),
  revalidatePendingPurchaseReceives: jest.fn(),
  savePurchaseReceiveVoucherStatusesCache: jest.fn(),
}));
jest.mock('@/utils/logger', () => ({ logger: { warn: jest.fn() } }));

const update = jest.fn((_isCurrent: () => boolean) => Promise.resolve());
const request = jest.mocked(revalidatePendingPurchaseReceives);
const statusRequest = jest.mocked(fetchPurchaseReceiveVoucherStatuses);
const saveStatuses = jest.mocked(savePurchaseReceiveVoucherStatusesCache);
const listeners = new Set<(state: AppStateStatus) => void>();
let root: TestRenderer.ReactTestRenderer | undefined;
const foreground = (value: AppStateStatus) => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value });
  listeners.forEach(listener => listener(value));
};
function Harness() { usePendingPurchaseReceivePrefetch(update); return null; }
const render = async () => { await act(async () => { root = TestRenderer.create(<Harness />); }); };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.clear();
  foreground('active');
  request.mockReset().mockResolvedValue({ cachedAt: '', data: { items: [], pageIndex: 0, totalCount: 0, totalPageNum: 0 } });
  statusRequest.mockReset().mockResolvedValue([]);
  saveStatuses.mockReset().mockResolvedValue({ cachedAt: '', data: [] });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); root = undefined; });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('prefetches on entry, then polls only local audit messages during a long workbench visit', async () => {
  await render();
  expect(request.mock.calls.map(call => call[0].key)).toEqual(['shanghai-chipmunk', 'wuxi-duneng']);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0]()).toBe(true);
  expect(statusRequest.mock.calls.map(call => call[0].key)).toEqual(['shanghai-chipmunk', 'wuxi-duneng']);
  expect(saveStatuses.mock.calls.map(call => call[0])).toEqual(['shanghai-chipmunk', 'wuxi-duneng']);
  await act(async () => { await jest.advanceTimersByTimeAsync(60 * 60_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(statusRequest).toHaveBeenCalledTimes(122);
  expect(saveStatuses).toHaveBeenCalledTimes(122);
  expect(update).toHaveBeenCalledTimes(61);
});

it('does not poll in the background and revalidates when the app returns', async () => {
  await render();
  await act(async () => { foreground('background'); await jest.advanceTimersByTimeAsync(120_000); });
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => { foreground('active'); });
  expect(request).toHaveBeenCalledTimes(4);
});

it('keeps local audit polling independent of an unfinished ERP preload', async () => {
  request.mockImplementation(() => new Promise(() => undefined));
  await render();
  await act(async () => { await jest.advanceTimersByTimeAsync(180_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(statusRequest).toHaveBeenCalledTimes(8);
  expect(update).toHaveBeenCalledTimes(3);
});

it('does not duplicate local audit queries while their preceding cycle is still pending', async () => {
  statusRequest.mockImplementation(() => new Promise(() => undefined));
  await render();
  await act(async () => { await jest.advanceTimersByTimeAsync(180_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(statusRequest).toHaveBeenCalledTimes(2);
});

it('refreshes local audit indicators even if neither account can preload a list', async () => {
  request.mockRejectedValue(new Error('daily preload unavailable'));
  await render();
  expect(update).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(2);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(statusRequest).toHaveBeenCalledTimes(4);
  expect(update).toHaveBeenCalledTimes(2);
});

it('keeps one failed account from discarding a successful account prefetch', async () => {
  request.mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(update).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

it('refreshes the workbench from successful lists even when one audit-state request fails', async () => {
  statusRequest.mockRejectedValueOnce(new Error('status offline'));
  await render();
  expect(request).toHaveBeenCalledTimes(2);
  expect(saveStatuses).toHaveBeenCalledTimes(1);
  expect(saveStatuses).toHaveBeenCalledWith('wuxi-duneng', []);
  expect(update).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

it('keeps a status-cache write failure separate from successful list prefetching', async () => {
  saveStatuses.mockRejectedValueOnce(new Error('storage offline'));
  await render();
  expect(update).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

it('invalidates a delayed workbench update and removes polling on exit', async () => {
  await render();
  const isCurrent = update.mock.calls[0][0];
  await act(async () => { root!.unmount(); root = undefined; });
  expect(isCurrent()).toBe(false);
  await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(listeners.size).toBe(0);
});
