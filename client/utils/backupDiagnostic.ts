import { getDatabaseBackupDateString } from '@/utils/backupNaming';
import { getAutoNasBackupStatus, getNativeAutoNasBackupStatus,
  getAutoNasBackupStatusLabel, getNativeAutoNasBackupStatusLabel,
  getAutoNasBackupReasonLabel, getNativeAutoNasBackupReasonLabel,
  getAutoNasBackupTriggerLabel, type AutoNasBackupStatus, type NativeAutoNasBackupStatus } from '@/utils/autoNasBackup';
import { getLastNasDatabaseBackupSuccess, getNasDatabaseBackupSourceLabel, type NasDatabaseBackupSuccess } from '@/utils/nasBackup';
import { formatDateTimeExport } from '@/utils/time';

export interface BackupDiagnostic {
  foreground: AutoNasBackupStatus | null;
  background: NativeAutoNasBackupStatus | null;
  success: NasDatabaseBackupSuccess | null;
}
export async function readBackupDiagnostic(): Promise<BackupDiagnostic> {
  const [foreground, background, success] = await Promise.all([
    getAutoNasBackupStatus(), getNativeAutoNasBackupStatus(), getLastNasDatabaseBackupSuccess(),
  ]);
  return { foreground, background, success };
}
export function describeBackupDiagnostic(data: BackupDiagnostic) {
  const { foreground: f, background: b, success } = data;
  const nativeSuccessAt = b?.status === 'success' ? b.checkedAtMs : b?.lastSuccessAtMs || 0;
  const latestSuccessAt = Math.max(success?.successAtMs || 0, nativeSuccessAt, f?.lastSuccessAt || 0);
  const errors = [f?.status === 'failed' && (!f.lastCheckedAt || f.lastCheckedAt >= latestSuccessAt) ? `前台：${f.lastError || '未知错误'}` : '',
    b?.status === 'failed' && (!b.checkedAtMs || b.checkedAtMs >= latestSuccessAt) ? `后台：${b.errorMessage || '未知错误'}` : ''].filter(Boolean);
  const today = latestSuccessAt > 0 && getDatabaseBackupDateString(new Date(latestSuccessAt)) === getDatabaseBackupDateString();
  const label = errors.length ? '备份异常' : today ? '今日已备份' : latestSuccessAt ? '今日未备份' : '暂无成功记录';
  const time = (value?: number) => value ? formatDateTimeExport(new Date(value).toISOString()) : '暂无';
  const rows: Array<[string, string]> = [
    ['最近 NAS 备份', success ? `${time(success.successAtMs)} · ${getNasDatabaseBackupSourceLabel(success.source)} · ${success.fileName}` : '暂无记录'],
    ['前台状态', getAutoNasBackupStatusLabel(f)], ['前台检查', time(f?.lastCheckedAt)],
    ['前台来源', getAutoNasBackupTriggerLabel(f?.trigger)],
    ['前台说明', f?.status === 'failed' ? f.lastError || '未知错误' : f?.status === 'skipped' ? getAutoNasBackupReasonLabel(f.reason) : f?.status === 'success' ? '已上传到 NAS' : '暂无检查记录'],
    ['前台成功', `${time(f?.lastSuccessAt)}${f?.lastSuccessFileName ? ` · ${f.lastSuccessFileName}` : ''}`],
    ['前台策略', '前台每 15 分钟刷新状态，Android 自动上传交给后台任务'],
    ['后台状态', getNativeAutoNasBackupStatusLabel(b)], ['后台检查', time(b?.checkedAtMs)],
    ['后台说明', b?.status === 'failed' ? b.errorMessage || '未知错误' : b?.status === 'skipped' ? getNativeAutoNasBackupReasonLabel(b.reason) : b?.status === 'running' ? '后台任务正在执行' : b?.status === 'success' ? '已上传到 NAS' : '暂无后台任务记录'],
    ['后台成功', time(nativeSuccessAt)], ['后台文件', b?.fileName || '暂无'],
    ['后台策略', 'Android WorkManager 每 6 小时调度，锁屏后由系统执行'],
  ];
  return { label, errors, latestSuccessText: time(latestSuccessAt), rows };
}
