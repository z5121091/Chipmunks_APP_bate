import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, type SyncConfig } from '@/constants/config';
import { getOutboundExportRows, getTodayExportCount, incrementExportCount, type Warehouse } from '@/utils/database';
import { syncExcelToComputer } from '@/utils/excel';
import { buildOutboundExportFileName, buildOutboundSheets } from '@/utils/outboundExport';
import { getSyncConfigError, normalizeSyncConfig } from '@/utils/heartbeat';
import { safeJsonParseNullable } from '@/utils/json';
import { scanQueue } from '@/utils/scanQueue';
import { logger } from '@/utils/logger';

// Serialize history exports even if the page is reopened while a request is running.
let exportInProgress = false;

export async function exportOutboundHistoryToComputer(warehouse: Pick<Warehouse, 'id' | 'name'>) {
  if (!warehouse.id?.trim()) throw new Error('请先选择仓库');
  if (exportInProgress) throw new Error('历史记录正在导出，请稍候');
  exportInProgress = true;
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
    const config = saved ? safeJsonParseNullable<SyncConfig>(saved, 'outboundHistory.syncConfig') : null;
    if (!config || typeof config.ip !== 'string' || typeof config.port !== 'string') {
      throw new Error('请先在设置中配置电脑同步助手');
    }
    const configError = getSyncConfigError(config);
    if (configError) throw new Error(configError);

    const stats = await scanQueue.flushPendingWrites({ timeoutMs: 15000, retryFailed: true });
    if (stats.failed > 0) {
      throw new Error(`仍有 ${stats.failed} 条出库扫码记录写入失败，请回到扫码出库页核对后再导出`);
    }
    // Deliberately independent of the order page's date, search and expanded-order filters.
    const records = await getOutboundExportRows(warehouse.id);
    if (records.length === 0) throw new Error(`「${warehouse.name}」暂无历史出库记录可导出`);
    const sequence = (await getTodayExportCount('outbound')) + 1;
    const fileName = buildOutboundExportFileName(warehouse.name, sequence);
    const result = await syncExcelToComputer(
      buildOutboundSheets(records), '/outbound', normalizeSyncConfig(config),
      undefined, undefined, undefined, fileName,
    );
    if (!result.success) throw new Error(result.message || '导出失败，请检查电脑同步助手');
    try {
      await incrementExportCount('outbound');
    } catch (error) {
      // The file has already been delivered; a counter failure must not report a failed transfer.
      logger.warn('[出库历史导出] 文件已发送，导出序号保存失败:', error);
    }
    return { fileName: result.fileName || fileName, recordCount: records.length };
  } finally {
    exportInProgress = false;
  }
}
