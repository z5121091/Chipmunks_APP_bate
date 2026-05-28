import { generateId } from './database';
import { logger } from './logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
}

export interface BatchConfig {
  maxSize: number;
  interval: number;
}

const DEFAULT_CONFIG: BatchConfig = {
  maxSize: 10,
  interval: 500,
};

const TERMINAL_ITEM_LIMIT = 50;
const STORAGE_KEY = '@outbound_scan_queue_v1';

const isQueueItemStatus = (value: unknown): value is QueueItemStatus =>
  value === QueueItemStatus.PENDING ||
  value === QueueItemStatus.WRITING ||
  value === QueueItemStatus.SUCCESS ||
  value === QueueItemStatus.FAILED;

const isPersistedQueueItem = (value: unknown): value is QueueItem => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as QueueItem;
  return (
    typeof item.id === 'string' &&
    typeof item.scanData === 'string' &&
    typeof item.parsed === 'object' &&
    item.parsed !== null &&
    isQueueItemStatus(item.status) &&
    typeof item.timestamp === 'number'
  );
};

class ScanQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private config: BatchConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<() => void> = new Set();
  private restored = false;
  private persistPromise: Promise<void> = Promise.resolve();

  private batchWriteToDatabase: (items: QueueItem[]) => Promise<{
    success: boolean[];
    materialIds: string[];
    errors: (string | null)[];
  }> = async () => {
    throw new Error('batchWriteToDatabase not configured');
  };

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.log('[ScanQueue] initialized with config:', this.config);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private getPersistableItems() {
    return this.queue.filter((item) => item.status !== QueueItemStatus.SUCCESS);
  }

  private persistQueue() {
    const items = this.getPersistableItems();
    const write = items.length > 0
      ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items))
      : AsyncStorage.removeItem(STORAGE_KEY);

    this.persistPromise = write.catch((error) => {
      logger.warn('[ScanQueue] persist failed:', error);
    });

    return this.persistPromise;
  }

  private async restorePersistedQueue() {
    if (this.restored) {
      return;
    }
    this.restored = true;

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return;
      }

      const existingIds = new Set(this.queue.map((item) => item.id));
      const restoredItems = parsed
        .filter(isPersistedQueueItem)
        .filter((item) => !existingIds.has(item.id))
        .map((item) => ({
          ...item,
          status:
            item.status === QueueItemStatus.WRITING ||
            item.status === QueueItemStatus.FAILED
              ? QueueItemStatus.PENDING
              : item.status,
        }));

      if (restoredItems.length === 0) {
        return;
      }

      this.queue = [...restoredItems, ...this.queue];
      logger.log(`[ScanQueue] restored persisted items: ${restoredItems.length}`);
      this.notify();
      this.persistQueue();
    } catch (error) {
      logger.warn('[ScanQueue] restore failed:', error);
    }
  }

  add(scanData: string, parsed: QueueItemParsedPayload): QueueItem {
    const item: QueueItem = {
      id: `queue_${generateId()}`,
      scanData,
      parsed,
      status: QueueItemStatus.PENDING,
      timestamp: Date.now(),
    };

    this.queue.push(item);
    logger.log(`[ScanQueue] added item ${item.id}, size: ${this.queue.length}`);
    this.notify();
    this.persistQueue();

    if (this.queue.length >= this.config.maxSize) {
      this.triggerBatchWrite();
    }

    return item;
  }

  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  getPendingItems(): QueueItem[] {
    return this.queue.filter((item) => item.status === QueueItemStatus.PENDING);
  }

  private triggerBatchWrite() {
    if (!this.isProcessing) {
      void this.processBatch();
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForIdle(deadline: number) {
    while (this.isProcessing) {
      if (Date.now() > deadline) {
        throw new Error('等待出库扫码队列写入超时');
      }
      await this.sleep(50);
    }
  }

  private async processBatch() {
    if (this.isProcessing) {
      logger.log('[ScanQueue] batch already in progress, skipping');
      return;
    }

    const pendingItems = this.getPendingItems().slice(0, this.config.maxSize);
    if (pendingItems.length === 0) {
      logger.log('[ScanQueue] no pending items');
      return;
    }

    this.isProcessing = true;
    logger.log(`[ScanQueue] writing batch with ${pendingItems.length} items`);

    pendingItems.forEach((item) => {
      item.status = QueueItemStatus.WRITING;
    });
    this.notify();
    this.persistQueue();

    try {
      const results = await this.batchWriteToDatabase(pendingItems);

      pendingItems.forEach((item, index) => {
        if (results.success[index]) {
          item.status = QueueItemStatus.SUCCESS;
          item.materialId = results.materialIds[index];
          return;
        }

        item.status = QueueItemStatus.FAILED;
        item.errorMessage = results.errors[index] || 'write failed';
      });

      logger.log(
        '[ScanQueue] batch complete, success count:',
        results.success.filter(Boolean).length
      );
    } catch (error) {
      logger.error('[ScanQueue] batch write failed:', error);
      pendingItems.forEach((item) => {
        item.status = QueueItemStatus.FAILED;
        item.errorMessage = String(error);
      });
    } finally {
      this.isProcessing = false;
      this.cleanupCompletedItems();
      this.notify();
      this.persistQueue();

      if (this.getPendingItems().length > 0) {
        void this.processBatch();
      }
    }
  }

  private cleanupCompletedItems() {
    const removableIds = new Set<string>();
    const terminalStatuses = [
      QueueItemStatus.SUCCESS,
      QueueItemStatus.FAILED,
    ] as const;

    terminalStatuses.forEach((status) => {
      const items = this.queue.filter((item) => item.status === status);
      if (items.length <= TERMINAL_ITEM_LIMIT) {
        return;
      }

      items
        .slice(0, items.length - TERMINAL_ITEM_LIMIT)
        .forEach((item) => removableIds.add(item.id));
    });

    if (removableIds.size === 0) {
      return;
    }

    this.queue = this.queue.filter((item) => !removableIds.has(item.id));
    logger.log(`[ScanQueue] cleaned terminal items: ${removableIds.size}`);
  }

  setBatchWriteFunction(fn: typeof this.batchWriteToDatabase) {
    this.batchWriteToDatabase = fn;
  }

  startTimer() {
    if (this.timer) {
      logger.log('[ScanQueue] timer already running');
      return;
    }

    logger.log('[ScanQueue] starting timer:', this.config.interval, 'ms');
    void this.restorePersistedQueue().then(() => {
      if (this.getPendingItems().length > 0 && !this.isProcessing) {
        void this.processBatch();
      }
    });
    this.timer = setInterval(() => {
      const pending = this.getPendingItems();
      if (pending.length > 0 && !this.isProcessing) {
        logger.log(`[ScanQueue] timer triggered batch write, pending: ${pending.length}`);
        void this.processBatch();
      }
    }, this.config.interval);
  }

  stopTimer() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    logger.log('[ScanQueue] timer stopped');
  }

  clear() {
    this.queue = [];
    this.notify();
    this.persistQueue();
    logger.log('[ScanQueue] queue cleared');
  }

  async flushPendingWrites(options: { timeoutMs?: number; retryFailed?: boolean } = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const retryFailed = options.retryFailed ?? true;
    const deadline = Date.now() + timeoutMs;

    await this.restorePersistedQueue();

    if (retryFailed) {
      let changed = false;
      this.queue.forEach((item) => {
        if (
          item.status === QueueItemStatus.FAILED ||
          item.status === QueueItemStatus.WRITING
        ) {
          item.status = QueueItemStatus.PENDING;
          item.errorMessage = undefined;
          changed = true;
        }
      });

      if (changed) {
        this.notify();
        await this.persistQueue();
      }
    }

    while (true) {
      await this.waitForIdle(deadline);

      const pending = this.getPendingItems();
      if (pending.length === 0) {
        break;
      }

      if (Date.now() > deadline) {
        throw new Error('等待出库扫码队列写入超时');
      }

      await this.processBatch();
    }

    await this.waitForIdle(deadline);
    await this.persistPromise;

    const stats = this.getStats();
    if (stats.pending > 0 || stats.writing > 0) {
      throw new Error('仍有出库扫码记录未写入数据库，请稍后重试');
    }

    return stats;
  }

  getStats() {
    return {
      total: this.queue.length,
      pending: this.getPendingItems().length,
      writing: this.queue.filter((item) => item.status === QueueItemStatus.WRITING).length,
      success: this.queue.filter((item) => item.status === QueueItemStatus.SUCCESS).length,
      failed: this.queue.filter((item) => item.status === QueueItemStatus.FAILED).length,
    };
  }
}

export const scanQueue = new ScanQueue();


