import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, type SyncConfig } from '@/constants/config';
import {
  getNextUnpackIndex,
  getSupplierForInventoryBinding,
  requireActiveInternalLabel,
  type UnpackRecord,
} from '@/utils/database';
import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import { safeJsonParseNullable } from '@/utils/json';
import { buildUnpackLabelSheet } from '@/utils/labelExport';
import { internalLabelPackageKey, isInternalLabelPackageKey } from '@/utils/internalLabelCode';
import { parseQuantity } from '@/utils/quantity';
import { DONGWEI_SUPPLIER } from '@/utils/dongweiLabel';
import { assertDongweiSixPrintSupported, DongweiPrintCompatibilityError } from '@/utils/dongweiPrintCompatibility';

const NATIVE_LABEL_PRINT_MODE = 'native_tsc_supplier_v2';

const enrichUnpackRecordsWithSuppliers = async (
  records: UnpackRecord[]
): Promise<UnpackRecord[]> => {
  const supplierCache = new Map<string, string | null>();
  const enrichedRecords: UnpackRecord[] = [];

  for (const record of records) {
    if (isInternalLabelPackageKey(record.parent_package_key)) {
      enrichedRecords.push(record);
      continue;
    }
    if (record.package_supplier) {
      enrichedRecords.push({ ...record, supplier: record.package_supplier });
      continue;
    }
    const cacheKey = [
      record.inventory_code?.trim().toLowerCase() || '',
      record.model.trim().toLowerCase(),
      record.version?.trim().toLowerCase() || '',
    ].join('::');

    if (!supplierCache.has(cacheKey)) {
      supplierCache.set(
        cacheKey,
        await getSupplierForInventoryBinding({
          scanModel: record.model,
          version: record.version,
          inventoryCode: record.inventory_code,
        })
      );
    }
    const supplier = supplierCache.get(cacheKey) || record.supplier?.trim() || '';

    enrichedRecords.push({
      ...record,
      supplier,
    });
  }

  return enrichedRecords;
};

export const buildNextUnpackTraceNo = async (traceNo?: string | null) => {
  const baseTraceNo = traceNo ? traceNo.replace(/-\d+$/, '') : '';
  if (!baseTraceNo) {
    return '';
  }

  const nextIndex = await getNextUnpackIndex(traceNo || '');
  return `${baseTraceNo}-${nextIndex}`;
};

export const loadLabelSyncConfig = async (): Promise<SyncConfig> => {
  const savedSyncConfig = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
  const parsedConfig = savedSyncConfig
    ? safeJsonParseNullable<SyncConfig>(savedSyncConfig, 'unpack.syncConfig')
    : null;

  return parsedConfig || { ip: '', port: '8080' };
};

export const getUnpackSyncFailureMessage = (error: unknown): string => {
  if (error instanceof DongweiPrintCompatibilityError) return error.message;
  const errorName =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name || '')
      : '';
  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error || '请检查网络和同步服务');

  if (errorName === 'AbortError') {
    return '连接超时，请检查网络';
  }

  if (message.includes('电脑IP') || message.includes('服务器')) {
    return message;
  }

  return formatSyncErrorMessage(message, '请检查网络和同步服务');
};

export interface UnpackPrintSubmission {
  status: 'submitted' | 'skipped';
  printJobId: string;
  fileName: string;
  message: string;
  duplicate: boolean;
  templateNames: string[];
}

export const submitUnpackRecordsToComputer = async (
  records: UnpackRecord[],
  syncConfig?: SyncConfig,
  options: { retryConfirmed?: boolean } = {}
): Promise<UnpackPrintSubmission> => {
  const printJobIds = [
    ...new Set(
      records
        .map((record) => record.pair_id?.trim())
        .filter((jobId): jobId is string => Boolean(jobId))
    ),
  ];
  const [printJobId] = printJobIds;
  if (
    printJobIds.length !== 1 ||
    !printJobId ||
    records.some((record) => record.pair_id?.trim() !== printJobId)
  ) {
    throw new Error('拆包标签缺少统一的打印任务标识');
  }
  // A full split retains a zero remainder in the audit pair, but no child
  // package or physical label exists for it. Keep it out of validation/printing.
  const printableRecords = records.filter(record =>
    record.label_type !== 'remaining' || parseQuantity(record.new_quantity, { min: 0 }) !== 0);
  if (!printableRecords.length) throw new Error('拆包任务没有可打印的标签');
  const internalRecords = printableRecords.filter(record => isInternalLabelPackageKey(record.parent_package_key));
  for (const record of internalRecords) {
    const label = await requireActiveInternalLabel(record.source_qr || '');
    if (record.package_key !== internalLabelPackageKey(label.packageId) || !label.parentPackageId ||
        record.parent_package_key !== internalLabelPackageKey(label.parentPackageId)) {
      throw new Error('拆包任务中的内部包号与当前登记不一致，请核对标签');
    }
  }
  const config = syncConfig || (await loadLabelSyncConfig());
  const enrichedRecords = await enrichUnpackRecordsWithSuppliers(printableRecords);
  if (enrichedRecords.some(record => record.supplier === DONGWEI_SUPPLIER && record.qr_field_count === 6)) {
    await assertDongweiSixPrintSupported(config);
  }
  const labelSheet = buildUnpackLabelSheet(enrichedRecords, '标签数据');
  const nameSuffix = records[0]?.order_no || '拆包标签';
  const result = await syncExcelToComputer(
    [labelSheet],
    '/labels',
    config,
    nameSuffix,
    undefined,
    undefined,
    undefined,
    {
      queryParams: {
        print_mode: NATIVE_LABEL_PRINT_MODE,
        print_job_id: printJobId,
        ...(options.retryConfirmed === true ? { retry_confirmed: 'true' } : {}),
      },
      requireNativePrint: true,
      acceptNativePrintPolicySkip: internalRecords.length === 0,
    }
  );

  if (!result.success) {
    throw new Error(result.message || '拆包标签自动打印失败');
  }

  if (result.nativePrintJobId && result.nativePrintJobId !== printJobId) {
    throw new Error('同步助手返回的打印任务标识不一致，请先核对标签');
  }
  if (result.nativePrintSkipped === true && result.nativePrint === true) {
    throw new Error('同步助手返回的打印状态冲突，请先核对标签');
  }
  if (result.nativePrintSkipped !== true && result.nativePrint !== true) {
    throw new Error('同步助手未确认打印任务结果，请先核对标签');
  }

  const status = result.nativePrintSkipped === true ? 'skipped' : 'submitted';
  return {
    status,
    printJobId,
    fileName: result.fileName || nameSuffix,
    message:
      status === 'skipped'
        ? result.nativePrintSkipReason || '按供应商策略跳过，未自动打印'
        : result.nativePrintDuplicate === true
          ? '同步助手已识别为同一任务，请核对已有标签'
          : '已提交同步助手，实际标签请核对',
    duplicate: result.nativePrintDuplicate === true,
    templateNames: result.nativePrintTemplateNames || [],
  };
};

/** Existing export callers retain their file-name result. */
export const syncUnpackRecordsToComputer = async (
  records: UnpackRecord[],
  syncConfig?: SyncConfig
): Promise<string> =>
  (await submitUnpackRecordsToComputer(records, syncConfig)).fileName;
