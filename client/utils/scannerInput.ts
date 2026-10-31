import type { MutableRefObject } from 'react';

export const RECENT_SCAN_DUPLICATE_WINDOW_MS = 600;
// 字段段数齐全不能证明最后一段已输完；没有明确回车的物料码等待静默收尾。
export const MATERIAL_SCAN_QUIET_MS = 500;

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

/** 仅消费当前输入；规则检查不能代替结束信号，物料输入可指定最小静默期。 */
export const scheduleScanSubmitWithCompletionCheck = (
  timerRef: ScanSubmitTimerRef,
  options: {
    delay: number;
    continuationDelay?: number;
    minimumQuietMs?: number;
    isConfirmed?: () => boolean;
    isCurrent: () => boolean;
    shouldWaitForMore: () => boolean | Promise<boolean>;
    submit: () => void;
  }
) => {
  const inputAt = Date.now();
  scheduleScanSubmit(timerRef, () => {
    void (async () => {
      if (!options.isCurrent()) return;
      let shouldWait = false;
      try {
        shouldWait = await options.shouldWaitForMore();
      } catch {
        // 初步检查失败交给原有扫码流程报告，不能在这里吞掉业务错误。
      }
      if (!options.isCurrent()) return;
      const minimumQuietMs = options.isConfirmed?.() ? 0 : (options.minimumQuietMs ?? 0);
      const remainingQuietMs = Math.max(0, minimumQuietMs - (Date.now() - inputAt));
      if (shouldWait || remainingQuietMs > 0) {
        scheduleScanSubmit(timerRef, () => {
          if (options.isCurrent()) options.submit();
        }, Math.max(remainingQuietMs, shouldWait ? (options.continuationDelay ?? 350) : 0));
      } else {
        options.submit();
      }
    })();
  }, options.delay);
};

/**
 * 原生回车已给出完整快照，但末次 change 还没合并时，先保存该快照再接下一包。
 * 只按明确收到的回车边界分开累计文本，不猜测型号、追溯码或二维码内的换行。
 */
export const resolveScannerChangeAfterSubmit = (confirmedText: string | null, incomingText: string) => {
  if (!confirmedText || incomingText === confirmedText) {
    return { text: incomingText, confirmed: !!confirmedText, ignore: false };
  }
  if (incomingText && confirmedText.startsWith(incomingText)) {
    return { text: confirmedText, confirmed: true, ignore: true };
  }
  if (incomingText.startsWith(confirmedText)) {
    const remainder = incomingText.slice(confirmedText.length);
    // 分开发送的 CR/LF 仍属于刚才的原码，不能当成下一包。
    if (!remainder.trim()) return { text: incomingText, confirmed: true, ignore: false };
    return { text: remainder, completedText: confirmedText, confirmed: false, ignore: false };
  }
  return { text: incomingText, completedText: confirmedText, confirmed: false, ignore: false };
};

/** 已确认前包的原生累计前缀可能在受控值更新前连续出现多次。 */
export const resolveScannerTextAfterConsumedPrefix = (prefix: string, rawText: string, currentText: string) => {
  if (prefix && rawText && rawText !== currentText && prefix.startsWith(rawText)) {
    // 前包旧 change 不能清掉已接收的下一包；真正的空输入仍表示原生已复位。
    return { text: currentText, prefix, ignore: true };
  }
  if (prefix && rawText !== currentText && rawText.startsWith(prefix)) {
    return { text: rawText.slice(prefix.length), prefix };
  }
  return { text: rawText, prefix: '' };
};

/** 不复活已消费的输入，也不让上一笔的迟来回车提交当前另一笔扫码。 */
export const resolvePendingScannerSubmit = (pendingText: string, nativeText?: string) => {
  const pending = sanitizeStructuredScannerInput(pendingText);
  if (!pending) return null;
  if (typeof nativeText !== 'string') return { text: pendingText, advanced: false };
  const native = sanitizeStructuredScannerInput(nativeText);
  if (!native) return null;
  if (native.startsWith(pending)) {
    return { text: nativeText, advanced: native !== pending };
  }
  if (pending.startsWith(native)) return { text: pendingText, advanced: false };
  return null;
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
 * 保留二维码的结构与末尾字符，结束符交由解析规则处理；清理 BOM 和 NUL。
 * 扫码完成仍由页面防抖触发，不依赖扫描枪发送回车。
 */
export const sanitizeStructuredScannerInput = (rawText: string) => {
  const content = rawText.replace(/^\uFEFF/, '').split('\0').join('');
  return content.trim() ? content : '';
};

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
