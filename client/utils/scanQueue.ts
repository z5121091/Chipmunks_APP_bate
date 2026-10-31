import { checkMaterialExists, generateId, getMaterialById } from './database';
import { logger } from './logger';
import { workDraftStorage as AsyncStorage } from './workDraftIsolation';

export enum QueueItemStatus {
  PENDING = 'pending',
  WRITING = 'writing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface QueueItemParsedPayload {
  orderNo: string;
  customerName?: string;
  model: string;
  batch: string;
  quantity: string;
  traceNo?: string;
  sourceNo?: string;
  package?: string;
  version?: string;
  productionDate?: string;
  separator?: string;
  ruleId?: string;
  ruleName?: string;
  customFields?: Record<string, string>;
  inventoryCode?: string;
  warehouseId: string;
  warehouseName: string;
}

export interface QueueItem {
  id: string;
  scanData: string;
  parsed: QueueItemParsedPayload;
  status: QueueItemStatus;
  timestamp: number;
  errorMessage?: string;
  materialId?: string;
  requiresManualReview?: boolean;
  reviewReason?: string;
}

export interface BatchConfig { maxSize: number; interval: number; }
type LegacyBatchWriter = (items: QueueItem[]) => Promise<{
  success: boolean[]; materialIds: string[]; errors: (string | null)[];
}>;

const STORAGE_KEY = '@outbound_scan_queue_v1';
const INVALID_STORAGE_KEY = '@outbound_scan_queue_invalid_backup_v1';
const DISCARDED_STORAGE_KEY = '@outbound_scan_queue_reviewed_v1';
const DEFAULT_CONFIG: BatchConfig = { maxSize: 10, interval: 500 };

export const getRecoveryMaterialId = (item: QueueItem): string =>
  item.materialId?.trim() || `outbound-scan-${item.id}`;

const isPersistedQueueItem = (value: unknown): value is QueueItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as QueueItem;
  return typeof item.id === 'string' && item.id.trim() !== '' &&
    typeof item.scanData === 'string' && !!item.parsed && typeof item.parsed === 'object' &&
    ['orderNo', 'model', 'batch', 'quantity', 'warehouseId', 'warehouseName']
      .every(field => typeof item.parsed[field as keyof QueueItemParsedPayload] === 'string') &&
    Object.values(QueueItemStatus).includes(item.status) && typeof item.timestamp === 'number';
};

/** Legacy entries are a review inbox, never a background database writer. */
export class ScanQueue {
  private queue: QueueItem[] = [];
  private listeners = new Set<() => void>();
  private restored = false;
  private restorePromise: Promise<void> | null = null;
  private persistPromise: Promise<void> = Promise.resolve();

  constructor(config: Partial<BatchConfig> = {}) {
    logger.log('[ScanQueue] review inbox initialized:', { ...DEFAULT_CONFIG, ...config });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() { this.listeners.forEach(listener => listener()); }

  private persistQueue(): Promise<void> {
    const serialized = JSON.stringify(this.queue.filter(item => item.status !== QueueItemStatus.SUCCESS));
    this.persistPromise = this.persistPromise.catch(() => undefined).then(async () => {
      if (serialized === '[]') await AsyncStorage.removeItem(STORAGE_KEY);
      else await AsyncStorage.setItem(STORAGE_KEY, serialized);
    });
    return this.persistPromise;
  }
  private persistInBackground() {
    void this.persistQueue().catch(error => logger.warn('[ScanQueue] persist failed:', error));
  }

  private async reconcileItem(item: QueueItem): Promise<void> {
    if (item.status === QueueItemStatus.SUCCESS) return;
    const saved = await getMaterialById(getRecoveryMaterialId(item));
    if (saved) {
      if (saved.order_no === item.parsed.orderNo &&
        (saved.warehouse_id || '') === (item.parsed.warehouseId || '') && saved.raw_content === item.scanData) {
        item.status = QueueItemStatus.SUCCESS;
        item.materialId = saved.id;
        item.errorMessage = undefined;
        return;
      }
      item.requiresManualReview = true;
      item.reviewReason = '任务标识已有不同内容的保存记录，请核对后处理';
      return;
    }
    if (!item.materialId && !item.parsed.traceNo?.trim()) {
      item.requiresManualReview = true;
      item.reviewReason = '旧任务没有追溯码和保存标识，无法确认上次是否已写入；请先核对原订单';
      return;
    }
    if (item.status !== QueueItemStatus.WRITING) return;
    // Old writers used unrelated IDs. A trace may establish an already saved
    // physical package; a no-trace WRITING event is inherently ambiguous.
    if (item.parsed.traceNo?.trim()) {
      const duplicate = await checkMaterialExists(item.parsed.orderNo, item.parsed.model,
        item.parsed.batch, item.parsed.sourceNo, item.parsed.traceNo, item.parsed.quantity,
        item.parsed.warehouseId);
      const material = duplicate.material;
      if (material && material.order_no === item.parsed.orderNo &&
        (material.warehouse_id || '') === (item.parsed.warehouseId || '') && material.raw_content === item.scanData) {
        item.status = QueueItemStatus.SUCCESS;
        item.materialId = material.id;
        item.errorMessage = undefined;
        return;
      }
      if (!material) {
        item.status = QueueItemStatus.FAILED;
        item.errorMessage = '上次写入未确认，请载入原订单并按现行规则重新校验';
        return;
      }
    }
    item.requiresManualReview = true;
    item.reviewReason = '上次写入结果未知，无法确认是否已保存；请核对原订单后处理，避免重复出库';
  }

  private async restorePersistedQueue(): Promise<void> {
    if (this.restored) return;
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw); }
        catch {
          await AsyncStorage.setItem(INVALID_STORAGE_KEY, raw);
          throw new Error('旧扫码队列格式损坏，原始内容已保留，请联系维护人员核对');
        }
        if (!Array.isArray(parsed)) {
          await AsyncStorage.setItem(INVALID_STORAGE_KEY, raw);
          throw new Error('旧扫码队列格式不正确，原始内容已保留');
        }
        const valid = parsed.filter(isPersistedQueueItem);
        if (valid.length !== parsed.length) {
          await AsyncStorage.setItem(INVALID_STORAGE_KEY, raw);
          throw new Error('旧扫码队列含不完整记录，原始内容已保留，请联系维护人员核对');
        }
        const existingIds = new Set(this.queue.map(item => item.id));
        const restored = valid.filter(item => !existingIds.has(item.id));
        this.queue = [...restored, ...this.queue];
        for (const item of restored) {
          try { await this.reconcileItem(item); }
          catch (error) {
            item.requiresManualReview = true;
            item.reviewReason = `无法核对上次保存结果，请重新加载：${String(error)}`;
          }
        }
      }
      this.restored = true;
      this.notify();
      await this.persistQueue();
    })();
    try { await this.restorePromise; }
    finally { this.restorePromise = null; }
  }

  async restoreForReview(): Promise<QueueItem[]> {
    await this.restorePersistedQueue();
    return this.queue.filter(item => item.status !== QueueItemStatus.SUCCESS)
      .map(item => ({ ...item, parsed: { ...item.parsed } }));
  }

  add(scanData: string, parsed: QueueItemParsedPayload): QueueItem {
    const item: QueueItem = { id: `queue_${generateId()}`, scanData, parsed,
      status: QueueItemStatus.PENDING, timestamp: Date.now() };
    item.materialId = getRecoveryMaterialId(item);
    this.queue.push(item);
    this.notify();
    void this.restorePersistedQueue().then(() => this.persistQueue())
      .catch(error => logger.warn('[ScanQueue] persist failed:', error));
    return item;
  }
  getQueue(): QueueItem[] { return this.queue.map(item => ({ ...item, parsed: { ...item.parsed } })); }
  getPendingItems(): QueueItem[] { return this.getQueue().filter(item => item.status === QueueItemStatus.PENDING); }

  async acknowledgeRecovered(id: string, materialId?: string): Promise<void> {
    await this.restorePersistedQueue();
    const item = this.queue.find(entry => entry.id === id);
    if (!item) return;
    const committedId = materialId || getRecoveryMaterialId(item);
    const material = await getMaterialById(committedId);
    if (!material || material.order_no !== item.parsed.orderNo ||
      (material.warehouse_id || '') !== (item.parsed.warehouseId || '') || material.raw_content !== item.scanData) {
      throw new Error('尚未确认原订单的物料保存结果，不能移除待核对扫码');
    }
    item.materialId = committedId;
    item.status = QueueItemStatus.SUCCESS;
    item.errorMessage = undefined;
    item.requiresManualReview = false;
    this.notify();
    await this.persistQueue();
  }

  async markReviewFailed(id: string, message: string): Promise<void> {
    await this.restorePersistedQueue();
    const item = this.queue.find(entry => entry.id === id);
    if (!item) return;
    item.status = QueueItemStatus.FAILED;
    item.errorMessage = message;
    this.notify();
    await this.persistQueue();
  }

  async discardReviewed(id: string): Promise<void> {
    await this.restorePersistedQueue();
    const item = this.queue.find(entry => entry.id === id);
    if (!item) return;
    const raw = await AsyncStorage.getItem(DISCARDED_STORAGE_KEY);
    let reviewed: unknown[] = [];
    if (raw) {
      try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed)) reviewed = parsed; }
      catch { await AsyncStorage.setItem(`${DISCARDED_STORAGE_KEY}_invalid`, raw); }
    }
    await AsyncStorage.setItem(DISCARDED_STORAGE_KEY, JSON.stringify([...reviewed,
      { ...item, reviewedAt: Date.now(), action: 'operator-reviewed' }]));
    this.queue = this.queue.filter(entry => entry.id !== id);
    this.notify();
    await this.persistQueue();
  }

  // Retain compatibility for settings/backups, but never use old parsed payloads
  // to bypass the current ERP, quantity and unpack checks.
  setBatchWriteFunction(_fn: LegacyBatchWriter) {
    logger.warn('[ScanQueue] legacy batch writing disabled; use explicit outbound review');
  }
  startTimer() {
    void this.restorePersistedQueue().catch(error => logger.warn('[ScanQueue] restore failed:', error));
  }
  stopTimer() { /* The review inbox has no automatic write timer. */ }
  async clear(): Promise<void> {
    await this.restorePersistedQueue();
    for (const item of [...this.queue]) await this.discardReviewed(item.id);
  }

  async flushPendingWrites(_options: { timeoutMs?: number; retryFailed?: boolean } = {}) {
    await this.restorePersistedQueue();
    let changed = false;
    for (const item of this.queue) {
      if (item.status === QueueItemStatus.PENDING || item.status === QueueItemStatus.WRITING) {
        item.status = QueueItemStatus.FAILED;
        item.errorMessage ||= '旧扫码待核对，请回到扫码出库页按现行规则处理';
        changed = true;
      }
    }
    if (changed) { this.notify(); this.persistInBackground(); }
    await this.persistPromise;
    return this.getStats();
  }
  getStats() {
    return { total: this.queue.length,
      pending: this.queue.filter(item => item.status === QueueItemStatus.PENDING).length,
      writing: this.queue.filter(item => item.status === QueueItemStatus.WRITING).length,
      success: this.queue.filter(item => item.status === QueueItemStatus.SUCCESS).length,
      failed: this.queue.filter(item => item.status === QueueItemStatus.FAILED).length };
  }
}

export const scanQueue = new ScanQueue();
