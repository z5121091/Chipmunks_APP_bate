import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { AppModal } from '@/components/AppModal';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { AppPillToast } from '@/components/AppPillToast';
import { useOverlayActivity } from '@/hooks/useOverlayActivity';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useOtaApply } from '@/hooks/useOtaApply';
import { claimOtaNotice, consumeOtaReturnHome, downloadOtaUpdate, getPendingOtaUpdate, recordRunningUpdate, updateNotes, type AppliedUpdate } from '@/utils/otaUpdate';

type Notice = { kind: 'ready' | 'applied'; id: string; notes: string };
// Mounted after database initialization. Reminders appear only on the active workbench.
export function OtaStartup() {
  const pathname = usePathname();
  const router = useSafeRouter();
  const routerRef = useRef(router);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { applying, error: applyError, apply, clearError } = useOtaApply();
  const state = Updates.useUpdates();
  const pending = getPendingOtaUpdate(state);
  const overlayActive = useOverlayActivity();
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [applied, setApplied] = useState<AppliedUpdate | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const eligible = pathname === '/' && active;
  useEffect(() => {
    let mounted = true;
    void consumeOtaReturnHome().then(value => { if (mounted && value) routerRef.current.replace('/'); }).catch(() => { /* Display metadata must not block startup. */ });
    void recordRunningUpdate().then(value => { if (mounted && value) setApplied(value); }).catch(() => { /* Keep warehouse startup available. */ });
    void downloadOtaUpdate().catch(() => { /* Offline startup continues on installed code. */ });
    const subscription = AppState.addEventListener('change', value => setActive(value === 'active'));
    return () => { mounted = false; subscription.remove(); };
  }, []);
  const pendingId = pending?.updateId;
  const notes = updateNotes(pending);
  useEffect(() => {
    if (!eligible || overlayActive || notice) return;
    const candidate: Notice | null = applied
      ? { kind: 'applied', id: applied.id, notes: applied.notes }
      : pendingId ? { kind: 'ready', id: pendingId, notes } : null;
    if (!candidate) return;
    let mounted = true;
    void claimOtaNotice(candidate.kind, candidate.id).then(show => {
      if (!mounted) return;
      if (show) setNotice(candidate);
      else if (candidate.kind === 'applied') setApplied(null);
    }).catch(() => { /* Settings remains available if reminder storage fails. */ });
    return () => { mounted = false; };
  }, [eligible, overlayActive, notice, applied, pendingId, notes]);
  const close = () => {
    if (applying) return;
    clearError();
    if (notice?.kind === 'applied') setApplied(null);
    setNotice(null);
  };
  const applyUpdate = () => {
    if (notice?.kind === 'ready' && notice.id === pendingId) void apply();
  };
  const valid = notice?.kind === 'applied' || notice?.id === pendingId;
  const appliedNoticeId = notice?.kind === 'applied' ? notice.id : undefined;
  const appliedNoticeVisible = Boolean(appliedNoticeId && eligible && !overlayActive);
  useEffect(() => {
    if (!appliedNoticeId || !appliedNoticeVisible) return;
    const timer = setTimeout(() => {
      setApplied(current => current?.id === appliedNoticeId ? null : current);
      setNotice(current => current?.kind === 'applied' && current.id === appliedNoticeId ? null : current);
    }, 1500);
    return () => clearTimeout(timer);
  }, [appliedNoticeId, appliedNoticeVisible]);
  return <>
    <AppPillToast text="热更新已完成" type="success" visible={appliedNoticeVisible}
      bottom={insets.bottom + 96} />
    <AppModal visible={Boolean(notice?.kind === 'ready' && valid && eligible)} transparent onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <AppModalCard title="热更新已准备好" onClose={applying ? undefined : close}
        footer={<AppModalActions primaryLabel={applying ? '正在应用…' : '立即应用'} onPrimaryPress={applyUpdate}
          primaryDisabled={applying} secondaryLabel="稍后" onSecondaryPress={close} secondaryDisabled={applying} />}>
        <Text style={{ color: theme.textPrimary }}>{notice?.notes || '更新已下载，应用后将重新加载并返回工作台。'}</Text>
        <Text style={{ color: theme.textSecondary, marginTop: 12 }}>更新编号：{notice?.id.slice(0, 8)}</Text>
        {applying && <Text style={{ color: theme.textSecondary, marginTop: 12 }}>正在保存数据并应用更新…</Text>}
        {!!applyError && <Text style={{ color: theme.error, marginTop: 12 }}>{applyError}</Text>}
      </AppModalCard>
    </View>
    </AppModal>
  </>;
}
