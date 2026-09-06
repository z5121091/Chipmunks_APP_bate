import type { MutableRefObject } from 'react';

export const RECENT_SCAN_DUPLICATE_WINDOW_MS = 600;

type ScanSubmitTimerRef = MutableRefObject<ReturnType<typeof setTimeout> | null>;

export const cancelScanSubmit = (timerRef: ScanSubmitTimerRef) => {
  if (timerRef.current !== null) clearTimeout(timerRef.current);
  timerRef.current = null;
};

export const scheduleScanSubmit = (timerRef: ScanSubmitTimerRef, submit: () => void, delay: number) => {
  cancelScanSubmit(timerRef);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    submit();
  }, delay);
};

export const sanitizeCompactScannerInput = (rawText: string) =>
  rawText
    .trim()
    .replace(/\s+/g, '')
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/[^a-z0-9]+$/i, '');

export const sanitizeLooseScannerInput = (rawText: string) =>
  rawText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 保留二维码内部的结构字符，只清理扫码器可能附带的 BOM、NUL 和首尾空白。
 * 扫码完成仍由页面防抖触发，不依赖扫描枪发送回车。
 */
export const sanitizeStructuredScannerInput = (rawText: string) =>
  rawText.replace(/^\uFEFF/, '').split('\0').join('').trim();

export const hasMatchingTraceNo = <T extends { traceNo?: string | null }>(
  records: readonly T[],
  traceNo?: string | null
) => {
  const normalizedTraceNo = traceNo?.trim().toUpperCase();
  if (!normalizedTraceNo) {
    return false;
  }

  return records.some(
    (record) => record.traceNo?.trim().toUpperCase() === normalizedTraceNo
  );
};

export const shouldIgnoreRecentDuplicateScan = (
  code: string,
  lastScanRef: MutableRefObject<string>,
  lastScanTimeRef: MutableRefObject<number>,
  windowMs = RECENT_SCAN_DUPLICATE_WINDOW_MS
) => {
  const normalized = code.trim();
  const now = Date.now();

  if (
    normalized &&
    lastScanRef.current === normalized &&
    now - lastScanTimeRef.current < windowMs
  ) {
    return true;
  }

  lastScanRef.current = normalized;
  lastScanTimeRef.current = now;
  return false;
};
