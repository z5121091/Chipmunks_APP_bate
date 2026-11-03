import AsyncStorage from '@react-native-async-storage/async-storage';
import { exportOutboundHistoryToComputer } from '../outboundHistoryExport';
import { getOutboundExportRows, getTodayExportCount, incrementExportCount } from '../database';
import { syncExcelToComputer } from '../excel';
import { scanQueue } from '../scanQueue';
import { STORAGE_KEYS } from '@/constants/config';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../database', () => ({ getOutboundExportRows: jest.fn(), getTodayExportCount: jest.fn(), incrementExportCount: jest.fn() }));
jest.mock('../scanQueue', () => ({ scanQueue: { flushPendingWrites: jest.fn() } }));
jest.mock('../excel', () => ({ syncExcelToComputer: jest.fn() }));
jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
const warehouse = { id: 'A', name: 'A仓库' };
const rows = [
  { order_no: 'OLD', model: 'OLD-MODEL', warehouse_name: 'A仓库', quantity: 5, scanned_at: '2025-01-03' },
  { order_no: 'NEW', model: 'NEW-MODEL', warehouse_name: 'A仓库', quantity: 7, scanned_at: '2026-10-31' },
] as Awaited<ReturnType<typeof getOutboundExportRows>>;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1', port: '8080', pairingKey: 'fixture-key' }));
  jest.mocked(scanQueue.flushPendingWrites).mockResolvedValue({ failed: 0 } as Awaited<ReturnType<typeof scanQueue.flushPendingWrites>>);
  jest.mocked(getOutboundExportRows).mockResolvedValue(rows);
  jest.mocked(getTodayExportCount).mockResolvedValue(3);
  jest.mocked(syncExcelToComputer).mockResolvedValue({ success: true });
});
it('exports all months for exactly the requested warehouse and preserves pairing', async () => {
  const result = await exportOutboundHistoryToComputer(warehouse);
  expect(getOutboundExportRows).toHaveBeenCalledWith('A');
  expect(result.recordCount).toBe(2);
  expect(result.fileName).toContain('A仓库');
  const call = jest.mocked(syncExcelToComputer).mock.calls[0];
  expect(call[0].map(sheet => sheet.name)).toEqual(['2025-01月', '2026-10月']);
  expect(call[1]).toBe('/outbound');
  expect(call[2]).toEqual({ ip: '127.0.0.1', port: '8080', pairingKey: 'fixture-key' });
  expect(call[6]).toBe(result.fileName);
  expect(incrementExportCount).toHaveBeenCalledWith('outbound');
  await exportOutboundHistoryToComputer({ id: 'B', name: 'B仓库' });
  expect(getOutboundExportRows).toHaveBeenLastCalledWith('B');
});
it('never falls back to exporting all warehouses when none is selected', async () => {
  await expect(exportOutboundHistoryToComputer({ id: '', name: '' })).rejects.toThrow('选择仓库');
  expect(getOutboundExportRows).not.toHaveBeenCalled();
  expect(syncExcelToComputer).not.toHaveBeenCalled();
});
it('rejects missing settings and allows a later retry', async () => {
  await AsyncStorage.removeItem(STORAGE_KEYS.SYNC_CONFIG);
  await expect(exportOutboundHistoryToComputer(warehouse)).rejects.toThrow('配置电脑同步助手');
  expect(getOutboundExportRows).not.toHaveBeenCalled();
  await AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify({ ip: '127.0.0.1', port: '8080' }));
  await expect(exportOutboundHistoryToComputer(warehouse)).resolves.toMatchObject({ recordCount: 2 });
});
it('does not send empty data or data with failed queued writes', async () => {
  jest.mocked(scanQueue.flushPendingWrites).mockResolvedValueOnce({ failed: 1 } as Awaited<ReturnType<typeof scanQueue.flushPendingWrites>>);
  await expect(exportOutboundHistoryToComputer(warehouse)).rejects.toThrow('写入失败');
  expect(getOutboundExportRows).not.toHaveBeenCalled();
  jest.mocked(getOutboundExportRows).mockResolvedValueOnce([]);
  await expect(exportOutboundHistoryToComputer(warehouse)).rejects.toThrow('暂无历史出库记录');
  expect(syncExcelToComputer).not.toHaveBeenCalled();
});
it('allows retry after network failure and advances the counter only on success', async () => {
  jest.mocked(syncExcelToComputer).mockResolvedValueOnce({ success: false, message: 'offline' });
  await expect(exportOutboundHistoryToComputer(warehouse)).rejects.toThrow('offline');
  expect(incrementExportCount).not.toHaveBeenCalled();
  await exportOutboundHistoryToComputer(warehouse);
  expect(incrementExportCount).toHaveBeenCalledTimes(1);
});
it('serializes exports until the current transfer settles', async () => {
  let finish!: (result: { success: boolean }) => void;
  jest.mocked(syncExcelToComputer).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = exportOutboundHistoryToComputer(warehouse);
  await expect(exportOutboundHistoryToComputer(warehouse)).rejects.toThrow('正在导出');
  // Wait until the first call reaches the mocked network transfer.
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  finish({ success: true });
  await first;
  await expect(exportOutboundHistoryToComputer(warehouse)).resolves.toMatchObject({ recordCount: 2 });
});
it('keeps a successful transfer successful if updating the local counter fails', async () => {
  jest.mocked(incrementExportCount).mockRejectedValueOnce(new Error('db busy'));
  await expect(exportOutboundHistoryToComputer(warehouse)).resolves.toMatchObject({ recordCount: 2 });
});
