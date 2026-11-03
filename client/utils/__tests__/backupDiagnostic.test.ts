import { describeBackupDiagnostic, type BackupDiagnostic } from '../backupDiagnostic';
jest.mock('../autoNasBackup', () => ({
  getAutoNasBackupStatusLabel: () => '前台状态', getNativeAutoNasBackupStatusLabel: () => '后台状态',
  getAutoNasBackupReasonLabel: () => '跳过', getNativeAutoNasBackupReasonLabel: () => '跳过',
  getAutoNasBackupTriggerLabel: () => '前台',
}));
jest.mock('../nasBackup', () => ({ getNasDatabaseBackupSourceLabel: () => '后台' }));
const now = Date.now();
it('shows a new failure even when a backup succeeded earlier today', () => {
  const data = { foreground: { status: 'failed', lastCheckedAt: now, lastError: '完整错误'.repeat(100), trigger: 'test' },
    background: null, success: { successAtMs: now - 1000, fileName: 'backup.db', source: 'native-workmanager' } } as BackupDiagnostic;
  const result = describeBackupDiagnostic(data);
  expect(result.label).toBe('备份异常');
  expect(result.errors[0]).toContain('完整错误'.repeat(100));
  expect(result.latestSuccessText).not.toBe('暂无');
});
it('clears an old warning when a later background backup succeeded, while retaining diagnostic details', () => {
  const data = { foreground: { status: 'failed', lastCheckedAt: now - 2000, lastError: '旧错误', trigger: 'test' },
    background: { status: 'success', checkedAtMs: now, fileName: 'new.db' }, success: null } as BackupDiagnostic;
  const result = describeBackupDiagnostic(data);
  expect(result.label).toBe('今日已备份');
  expect(result.errors).toEqual([]);
  expect(result.rows).toContainEqual(['前台说明', '旧错误']);
});
