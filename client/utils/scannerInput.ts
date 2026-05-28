import type { MutableRefObject } from 'react';

export const RECENT_SCAN_DUPLICATE_WINDOW_MS = 600;

export const sanitizeCompactScannerInput = (rawText: string) =>
  rawText
    .trim()
    .replace(/[\r\n\t\s]+/g, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '');

export const sanitizeLooseScannerInput = (rawText: string) =>
  rawText.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

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
