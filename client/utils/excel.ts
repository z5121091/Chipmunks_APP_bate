/**
 * Excel 导出工具
 *
 * 封装 Excel 生成和同步到电脑的功能
 */
import * as XLSX from 'xlsx';
import { Base64 } from 'js-base64';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InteractionManager } from 'react-native';
import { EXPORT_CONFIG, STORAGE_KEYS, SyncConfig } from '@/constants/config';
import type { JsonValidator } from '@/utils/json';
import { logger } from '@/utils/logger';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import {
  getSyncConfigError,
  getSyncServiceBaseUrl,
  testConnection,
} from '@/utils/heartbeat';

const BACKEND_ACCESS_KEY = process.env.EXPO_PUBLIC_BACKEND_ACCESS_KEY?.trim() || '';

/** Excel Sheet 配置 */
export type ExcelCellValue = string | number | boolean | null | undefined | Date;

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: ExcelCellValue[][];
}

const MAX_AUTO_WIDTH_SAMPLE_ROWS = 100;
const EXCEL_HEADER_ROW_HEIGHT = 24;
const EXCEL_DATA_ROW_HEIGHT = 22;
const EXCEL_DEFAULT_COLUMN_WIDTH = 14;

const EXCEL_COLUMN_WIDTHS: Record<string, number> = {
  入库单号: 18,
  订单号: 20,
  盘点单号: 18,
  仓库名称: 14,
  客户名称: 30,
  供应商: 28,
  标签类型: 12,
  存货编码: 18,
  型号: 24,
  版本号: 17,
  封装: 14,
  批次: 16,
  数量: 10,
  实盘数量: 12,
  合计数量: 12,
  盘点数量: 12,
  原数量: 12,
  标签数量: 12,
  盘点类型: 12,
  生产日期: 14,
  追溯码: 20,
  箱号: 25,
  扫描时间: 17,
  拆包时间: 16,
  创建时间: 18,
};

const waitForExportIdle = () =>
  new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });

const getDisplayWidth = (value: ExcelCellValue): number => {
  const text = String(value || '');
  let width = 0;

  for (const char of text) {
    width += char.charCodeAt(0) > 127 ? 2 : 1;
  }

  return width;
};

const getColumnWidth = (header: string, autoWidth: number): number => {
  return EXCEL_COLUMN_WIDTHS[header] ?? Math.min(Math.max(autoWidth + 2, EXCEL_DEFAULT_COLUMN_WIDTH), 30);
};

const buildRowHeights = (rowCount: number) => {
  return Array.from({ length: rowCount }, (_, index) => ({
    hpt: index === 0 ? EXCEL_HEADER_ROW_HEIGHT : EXCEL_DATA_ROW_HEIGHT,
  }));
};

/** 导出结果 */
export interface ExportResult {
  success: boolean;
  message?: string;
  fileName?: string;
  nativePrint?: boolean;
  nativePrintSkipped?: boolean;
  nativePrintSkipReason?: string;
  nativePrintDuplicate?: boolean;
  nativePrintJobId?: string;
  nativePrintTemplateNames?: string[];
}

export interface SyncExcelOptions {
  queryParams?: Record<string, string | undefined>;
  requireNativePrint?: boolean;
  acceptNativePrintPolicySkip?: boolean;
}

export const formatSyncErrorMessage = (
  message?: string,
  fallback = '请检查电脑端同步服务'
) => {
  const normalized = message
    ?.replace(/^同步失败[:：]\s*/, '')
    .replace(/^错误[:：]\s*/, '')
    .trim();

  return normalized ? formatUserFacingErrorMessage(normalized, fallback) : fallback;
};

const setStoredConnectionStatus = async (status: 'success' | 'disconnected') => {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, status);
  } catch (error) {
    logger.warn('[syncExcelToComputer] 保存连接状态失败:', error);
  }
};

/**
 * 生成 Excel 文件（返回 base64）
 */
export const generateExcelBase64 = (sheets: ExcelSheet[]): string => {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;

    const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);

    // 自动列宽只采样前面部分数据，避免历史数据越多时在 JS 线程逐格扫描。
    const widthSampleRows = sheet.rows.slice(0, MAX_AUTO_WIDTH_SAMPLE_ROWS);
    const colWidths = sheet.headers.map((header, colIdx) => {
      let maxWidth = getDisplayWidth(header);
      widthSampleRows.forEach((row) => {
        const width = getDisplayWidth(row[colIdx]);
        if (width > maxWidth) maxWidth = width;
      });
      return { wch: getColumnWidth(header, maxWidth) };
    });
    ws['!cols'] = colWidths;
    ws['!rows'] = buildRowHeights(sheet.rows.length + 1);

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
};

export const decodeBase64ToBytes = (base64String: string): Uint8Array => {
  return Base64.toUint8Array(base64String);
};

export const toBinaryBody = (bytes: Uint8Array): ArrayBuffer => {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
};

const getReturnedFileName = (result: { fileName?: string; path?: string }): string => {
  if (result.fileName?.trim()) {
    return result.fileName.trim();
  }

  const legacyPath = result.path?.trim();
  if (!legacyPath) {
    return '';
  }

  const normalizedPath = legacyPath.replace(/\\/g, '/');
  return normalizedPath.split('/').filter(Boolean).pop() || '';
};

export const parseJsonResponse = async <T>(
  response: Response,
  invalidJsonMessage = '服务器返回格式错误',
  validator?: JsonValidator<T>
): Promise<T> => {
  const responseText = await response.text();

  if (!responseText.trim()) {
    throw new Error(invalidJsonMessage);
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;

    if (!validator) {
      return parsed as T;
    }

    if (typeof validator === 'function' && !('safeParse' in validator)) {
      if (validator(parsed)) {
        return parsed;
      }
    } else {
      const result = (
        validator as {
          safeParse: (value: unknown) => {
            success: boolean;
            data: T;
            error: { flatten: () => unknown };
          };
        }
      ).safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    logger.error('[parseJsonResponse] 响应校验失败:', result.error.flatten());
    }

    throw new Error(invalidJsonMessage);
  } catch (error) {
    logger.error(
      '[parseJsonResponse] JSON解析失败，响应内容:',
      responseText.substring(0, 200),
      error
    );
    throw new Error(invalidJsonMessage);
  }
};

/**
 * 同步 Excel 到电脑（支持多 Sheet）
 */
export const syncExcelToComputer = async (
  sheets: ExcelSheet[],
  endpoint: string,
  syncConfig: SyncConfig,
  nameSuffix?: string,
  onSuccess?: (fileName: string) => void,
  onError?: (error: string) => void,
  exactFileName?: string,
  options?: SyncExcelOptions
): Promise<ExportResult> => {
  if (!syncConfig.ip) {
    return { success: false, message: '请先配置电脑同步地址' };
  }

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows === 0) {
    return { success: false, message: '暂无数据可同步' };
  }

  const serviceOnline = await testConnection(syncConfig);
  if (!serviceOnline) {
    const message = '同步助手未连接，请确认电脑端同步助手已启动';
    await setStoredConnectionStatus('disconnected');
    onError?.(message);
    return { success: false, message };
  }

  await setStoredConnectionStatus('success');

  try {
    await waitForExportIdle();
    const base64String = generateExcelBase64(sheets);
    const bytes = decodeBase64ToBytes(base64String);
    const body = toBinaryBody(bytes);

    const baseUrl = `${getSyncServiceBaseUrl(syncConfig)}${endpoint}`;
    const queryParams = new URLSearchParams();
    if (nameSuffix) {
      queryParams.set('name_suffix', nameSuffix);
    }
    if (exactFileName) {
      queryParams.set('file_name', exactFileName);
    }
    Object.entries(options?.queryParams || {}).forEach(([key, value]) => {
      const normalizedValue = value?.trim();
      if (normalizedValue) {
        queryParams.set(key, normalizedValue);
      }
    });
    const queryString = queryParams.toString();
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXPORT_CONFIG.TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ...(BACKEND_ACCESS_KEY ? { 'X-Backend-Access-Key': BACKEND_ACCESS_KEY } : {}),
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        let serverMessage = '';
        if (responseText.trim()) {
          try {
            const parsed = JSON.parse(responseText) as unknown;
            if (parsed && typeof parsed === 'object') {
              const body = parsed as Record<string, unknown>;
              const candidate = body.message || body.error || body.detail;
              if (typeof candidate === 'string') {
                serverMessage = candidate;
              }
            }
          } catch {
            serverMessage = responseText.trim().slice(0, 180);
          }
        }
        const message = formatSyncErrorMessage(
          serverMessage,
          `电脑端同步服务异常（${response.status}）`
        );
        await setStoredConnectionStatus('disconnected');
        onError?.(message);
        return {
          success: false,
          message,
        };
      }

      const result = await parseJsonResponse<{
        success?: boolean;
        message?: string;
        fileName?: string;
        path?: string;
        nativePrint?: boolean;
        nativePrintSkipped?: boolean;
        nativePrintSkipReason?: string;
        nativePrintDuplicate?: boolean;
        nativePrintJobId?: string;
        nativePrintTemplateNames?: string[];
      }>(
        response,
        '服务器返回格式错误，请检查同步服务是否正常运行'
      );

      if (result.success) {
        const returnedFileName = getReturnedFileName(result);
        const policySkipAccepted =
          options?.acceptNativePrintPolicySkip === true &&
          result.nativePrintSkipped === true;
        if (
          options?.requireNativePrint &&
          result.nativePrint !== true &&
          !policySkipAccepted
        ) {
          const message = '同步助手未确认原生打印，请更新电脑端同步助手后重试';
          onError?.(message);
          return { success: false, message };
        }
        onSuccess?.(returnedFileName);
        return {
          success: true,
          message: result.message,
          fileName: returnedFileName,
          nativePrint: result.nativePrint,
          nativePrintSkipped: result.nativePrintSkipped,
          nativePrintSkipReason: result.nativePrintSkipReason,
          nativePrintDuplicate: result.nativePrintDuplicate,
          nativePrintJobId: result.nativePrintJobId,
          nativePrintTemplateNames: result.nativePrintTemplateNames,
        };
      } else {
        const msg = result.message || '未知错误';
        onError?.(msg);
        return { success: false, message: msg };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : '';
    const errorMessage = formatUserFacingErrorMessage(error, '请检查同步助手是否运行');
    const errorMsg =
      errorName === 'AbortError'
        ? '同步超时，请确认电脑端同步助手仍在运行'
        : `同步失败: ${errorMessage}`;
    await setStoredConnectionStatus('disconnected');
    onError?.(errorMsg);
    return { success: false, message: errorMsg };
  }
};

/**
 * 验证同步配置
 */
export const validateSyncConfig = (config: SyncConfig): boolean => {
  return !getSyncConfigError(config);
};
