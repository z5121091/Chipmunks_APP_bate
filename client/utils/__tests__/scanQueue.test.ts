import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkMaterialExists, generateId, getMaterialById } from '../database';
import { getRecoveryMaterialId, QueueItem, QueueItemStatus, ScanQueue } from '../scanQueue';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../database', () => ({ generateId: jest.fn(), getMaterialById: jest.fn(), checkMaterialExists: jest.fn() }));

const storageKey = '@outbound_scan_queue_v1';
const item = (id: string, status = QueueItemStatus.PENDING, traceNo = ''): QueueItem => ({
  id, scanData: 'MODEL|BATCH|100', status, timestamp: 100,
  parsed: { orderNo: 'IO-A', model: 'MODEL', batch: 'BATCH', quantity: '100', traceNo,
    warehouseId: 'W-A', warehouseName: '仓库 A' },
});
const saved = (record: QueueItem, id = getRecoveryMaterialId(record)) => ({
  id, order_no: record.parsed.orderNo, warehouse_id: record.parsed.warehouseId, raw_content: record.scanData,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.mocked(getMaterialById).mockResolvedValue(null);
  jest.mocked(checkMaterialExists).mockResolvedValue({ material: null, isUnpacked: false, canRescan: false });
});

it.each([QueueItemStatus.PENDING, QueueItemStatus.WRITING, QueueItemStatus.FAILED])(
  'keeps ambiguous legacy no-trace %s scans for explicit review and never calls the old writer', async status => {
  await AsyncStorage.setItem(storageKey, JSON.stringify([item('old', status)]));
  const queue = new ScanQueue({ maxSize: 1, interval: 1 });
  const writer = jest.fn();
  queue.setBatchWriteFunction(writer);
  expect(await queue.restoreForReview()).toEqual([expect.objectContaining({ id: 'old', requiresManualReview: true })]);
  expect((await queue.flushPendingWrites()).failed).toBe(1);
  expect(writer).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(storageKey))!)).toHaveLength(1);
});

it('reconciles a committed stable scan ID before a restart can duplicate a no-trace pack', async () => {
  const scan = item('already-committed', QueueItemStatus.WRITING);
  jest.mocked(getMaterialById).mockResolvedValue(saved(scan) as Awaited<ReturnType<typeof getMaterialById>>);
  await AsyncStorage.setItem(storageKey, JSON.stringify([scan]));
  expect(await new ScanQueue().restoreForReview()).toEqual([]);
  expect(getMaterialById).toHaveBeenCalledWith(getRecoveryMaterialId(scan));
  expect(await AsyncStorage.getItem(storageKey)).toBeNull();
});

it('reconciles a legacy trace package only in its original order and warehouse', async () => {
  const scan = item('legacy-trace', QueueItemStatus.WRITING, 'TRACE-A');
  jest.mocked(checkMaterialExists).mockResolvedValue({ material: saved(scan, 'OLD-ID') as NonNullable<Awaited<ReturnType<typeof getMaterialById>>>,
    isUnpacked: false, canRescan: false });
  await AsyncStorage.setItem(storageKey, JSON.stringify([scan]));
  expect(await new ScanQueue().restoreForReview()).toEqual([]);
  const wrong = { ...saved(scan, 'OTHER'), order_no: 'IO-OTHER' };
  jest.mocked(checkMaterialExists).mockResolvedValue({ material: wrong as NonNullable<Awaited<ReturnType<typeof getMaterialById>>>,
    isUnpacked: false, canRescan: true });
  await AsyncStorage.setItem(storageKey, JSON.stringify([scan]));
  expect(await new ScanQueue().restoreForReview()).toEqual([expect.objectContaining({ requiresManualReview: true })]);
});

it('keeps all failed legacy entries instead of dropping records beyond a terminal-size limit', async () => {
  const scans = Array.from({ length: 70 }, (_, index) => item(`failure-${index}`, QueueItemStatus.FAILED));
  await AsyncStorage.setItem(storageKey, JSON.stringify(scans));
  const queue = new ScanQueue();
  expect(await queue.restoreForReview()).toHaveLength(70);
  expect((await queue.flushPendingWrites()).failed).toBe(70);
  expect(JSON.parse((await AsyncStorage.getItem(storageKey))!)).toHaveLength(70);
});

it('does not acknowledge a recovery before its matching material is committed', async () => {
  const scan = item('needs-commit');
  await AsyncStorage.setItem(storageKey, JSON.stringify([scan]));
  const queue = new ScanQueue();
  await expect(queue.acknowledgeRecovered(scan.id)).rejects.toThrow('尚未确认');
  expect(await queue.restoreForReview()).toHaveLength(1);
  jest.mocked(getMaterialById).mockResolvedValue(saved(scan) as Awaited<ReturnType<typeof getMaterialById>>);
  await queue.acknowledgeRecovered(scan.id);
  expect(await queue.restoreForReview()).toEqual([]);
});

it('archives an explicitly reviewed entry while removing only the review inbox record', async () => {
  const scan = item('operator-reviewed', QueueItemStatus.WRITING);
  await AsyncStorage.setItem(storageKey, JSON.stringify([scan]));
  const queue = new ScanQueue();
  await queue.discardReviewed(scan.id);
  expect(await queue.restoreForReview()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem('@outbound_scan_queue_reviewed_v1'))!))
    .toEqual([expect.objectContaining({ id: scan.id, action: 'operator-reviewed' })]);
});

it('preserves malformed storage and its raw backup instead of silently dropping old data', async () => {
  const raw = '[{"id":"broken"';
  await AsyncStorage.setItem(storageKey, raw);
  await expect(new ScanQueue().restoreForReview()).rejects.toThrow('原始内容已保留');
  expect(await AsyncStorage.getItem(storageKey)).toBe(raw);
  expect(await AsyncStorage.getItem('@outbound_scan_queue_invalid_backup_v1')).toBe(raw);
});

it('assigns separate stable IDs to separate physical scans with identical raw content', async () => {
  jest.mocked(generateId).mockReturnValueOnce('1').mockReturnValueOnce('2');
  const queue = new ScanQueue();
  await queue.restoreForReview();
  const first = queue.add(item('a').scanData, item('a').parsed);
  const second = queue.add(item('b').scanData, item('b').parsed);
  expect(getRecoveryMaterialId(first)).not.toBe(getRecoveryMaterialId(second));
  expect((await queue.restoreForReview()).map(getRecoveryMaterialId))
    .toEqual([getRecoveryMaterialId(first), getRecoveryMaterialId(second)]);
  expect((await queue.flushPendingWrites()).failed).toBe(2);
});
