import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { AnimatedButton } from '@/components/AnimatedButton';
import { useTheme } from '@/hooks/useTheme';
import { useOtaApply } from '@/hooks/useOtaApply';
import { downloadOtaUpdate, getPendingOtaUpdate, readAppliedUpdate, updateNotes, type AppliedUpdate } from '@/utils/otaUpdate';

export function OtaUpdatePanel() {
  const { theme } = useTheme();
  const state = Updates.useUpdates();
  const pending = getPendingOtaUpdate(state);
  const [busy, setBusy] = useState(false);
  const { applying, error: applyError, apply, clearError } = useOtaApply();
  const working = busy || applying;
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState<AppliedUpdate | null>(null);
  useEffect(() => { void readAppliedUpdate().then(setApplied); }, []);
  const check = async () => {
    if (working) return;
    clearError(); setBusy(true); setMessage('正在检查并下载热更新…');
    try { const result = await downloadOtaUpdate(); setMessage(result === 'downloaded' ? '下载完成，可以立即应用。' : '当前没有可用的新热更新。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '热更新检查失败，请重试'); }
    finally { setBusy(false); }
  };
  const button = (label: string, action: () => void) => <AnimatedButton disabled={working} onPress={action} style={{ backgroundColor: theme.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 }}><Text style={{ color: theme.buttonPrimaryText, fontWeight: '700' }}>{label}</Text></AnimatedButton>;
  const statusMessage = applyError || (applying ? '正在保存数据并应用更新…' : message);
  const cardStyle = { backgroundColor: theme.backgroundDefault, padding: 18, borderRadius: 16, marginBottom: 16 };
  return (
      <View style={cardStyle}>
        <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '700' }}>热更新</Text>
        <Text selectable style={{ color: theme.textSecondary, marginTop: 8 }}>当前生效：{Updates.isEmbeddedLaunch ? 'APK 内置版本' : Updates.updateId?.slice(0, 8) || '未启用'}</Text>
        {!Updates.isEmbeddedLaunch && applied?.id === Updates.updateId && <Text style={{ color: theme.textSecondary }}>生效时间：{new Date(applied.appliedAt).toLocaleString()}</Text>}
        <Text style={{ color: theme.textSecondary, marginTop: 8 }}>{state.isDownloading ? `正在下载热更新${typeof state.downloadProgress === 'number' ? ` · ${Math.round(state.downloadProgress * 100)}%` : '…'}` : pending ? '已下载，待应用' : busy ? '正在检查版本…' : '应用后将重新加载并返回工作台。请先完成当前作业。'}</Text>
        <Text style={{ color: theme.textSecondary }}>{updateNotes(pending || Updates.manifest)}</Text>
        {!!statusMessage && <Text style={{ color: theme.textSecondary, marginTop: 8 }}>{statusMessage}</Text>}
        {button(working ? '处理中…' : '检查热更新', () => { void check(); })}
        {!!pending && button(applying ? '正在应用…' : '立即应用', () => { if (!busy) void apply(); })}
      </View>
  );
}
