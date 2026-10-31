import {
  getQRCodeRuleValueSpans,
  inspectQRCodeRule,
  parseWithRule,
  type QRCodeRule,
} from '@/utils/database';
import { parseQuantity } from '@/utils/quantity';

/** Increment only the terminal decimal suffix; no database or numeric precision loss. */
export const nextLabelTraceNo = (traceNo: string): string => {
  if (!traceNo) return '';
  const match = /-(\d+)$/.exec(traceNo);
  if (!match) return `${traceNo}-1`;
  const digits = match[1].split('');
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    const value = Number(digits[index]) + carry;
    digits[index] = String(value % 10);
    carry = value === 10 ? 1 : 0;
  }
  return `${traceNo.slice(0, match.index + 1)}${carry ? '1' : ''}${digits.join('')}`;
};

/** Only edits the matched quantity and trace spans; all other scanned bytes stay intact. */
export const rewriteLabelQrQuantity = (
  raw: string,
  rule: QRCodeRule,
  newQuantity: number
): { sourceQr: string; traceNo: string; quantity: number } => {
  if (!Number.isSafeInteger(newQuantity) || newQuantity <= 0) {
    throw new Error('正确数量必须是大于 0 的整数，且不能超过系统支持的整数范围。');
  }
  const inspection = inspectQRCodeRule(raw, rule);
  if (!inspection.matched) {
    throw new Error(`原标签与解析规则不一致，无法修改数量：${inspection.errors.join('；')}`);
  }
  const original = parseWithRule(raw, rule);
  const oldQuantity = parseQuantity(original.standardFields.quantity);
  if (oldQuantity === null) throw new Error('原标签没有有效的数量字段，无法修改数量。');
  const traceNo = original.standardFields.traceNo || '';
  if (oldQuantity === newQuantity) return { sourceQr: raw, traceNo, quantity: newQuantity };
  const spans = getQRCodeRuleValueSpans(raw, rule);
  const quantitySpans = spans.filter(span => span.field === 'quantity');
  const traceSpans = spans.filter(span => span.field === 'traceNo');
  if (quantitySpans.length !== 1 || traceSpans.length > 1) {
    throw new Error('解析规则的数量或追溯码字段重复或缺失，无法安全修改标签。');
  }
  const quantitySpan = quantitySpans[0];
  const quantityText = raw.slice(quantitySpan.start, quantitySpan.end);
  const quantityMatch = /^(\d+)(?:\s*(?:pcs?|[个件片只箱]))?$/iu.exec(quantityText);
  if (!quantityMatch || quantityText !== original.standardFields.quantity) {
    throw new Error('无法准确定位二维码中的数量数值，本次未打印，请核对数量字段和解析规则。');
  }
  const nextTrace = nextLabelTraceNo(traceNo);
  const edits = [{ start: quantitySpan.start, end: quantitySpan.start + quantityMatch[1].length, value: String(newQuantity) }];
  if (traceNo) {
    const traceSpan = traceSpans[0];
    if (!traceSpan || raw.slice(traceSpan.start, traceSpan.end) !== traceNo) {
      throw new Error('无法准确定位二维码中的追溯码，本次未打印，请核对解析规则。');
    }
    edits.push({ start: traceSpan.start, end: traceSpan.end, value: nextTrace });
  }
  edits.sort((left, right) => right.start - left.start);
  let sourceQr = raw;
  let boundary = raw.length;
  for (const edit of edits) {
    if (edit.start < 0 || edit.end > boundary || edit.end < edit.start) {
      throw new Error('数量与追溯码字段位置重叠，无法安全修改标签。');
    }
    sourceQr = sourceQr.slice(0, edit.start) + edit.value + sourceQr.slice(edit.end);
    boundary = edit.start;
  }
  const updatedInspection = inspectQRCodeRule(sourceQr, rule);
  if (!updatedInspection.matched) {
    throw new Error(`修改后的标签不再符合原解析规则，本次未打印：${updatedInspection.errors.join('；')}`);
  }
  const updated = parseWithRule(sourceQr, rule);
  const standard = updated.standardFields;
  if (parseQuantity(standard.quantity) !== newQuantity || (standard.traceNo || '') !== nextTrace ||
    Object.keys(original.standardFields).some(field => field !== 'quantity' && field !== 'traceNo' && standard[field] !== original.standardFields[field]) ||
    Object.keys(standard).length !== Object.keys(original.standardFields).length ||
    JSON.stringify(updated.customFields) !== JSON.stringify(original.customFields)) {
    throw new Error('修改后的标签校验失败，存在数量或追溯码之外的字段变化，本次未打印。');
  }
  return { sourceQr, traceNo: nextTrace, quantity: newQuantity };
};
