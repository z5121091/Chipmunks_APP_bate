let active = 0;
let applying = false;
export function beginOtaSensitiveOperation(checkpoint = false): () => void {
  if (applying && !checkpoint) throw new Error('正在应用更新，请稍后重试');
  active++;
  let released = false;
  return () => { if (!released) { released = true; active--; } };
}
export function lockForOtaApply(): () => void {
  if (applying || active > 0) throw new Error('正在保存或同步数据，请完成后再应用更新');
  applying = true;
  return () => { applying = false; };
}
