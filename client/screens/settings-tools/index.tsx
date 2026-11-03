import { MotionChevron } from '@/components/AppMotion';
import { MotionCollapse, MotionContent } from '@/components/AppMotion';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as IntentLauncher from 'expo-intent-launcher';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { getSyncConnectionSnapshot, subscribeSyncConnection, refreshSyncConnection, saveSyncConnectionConfig } from '@/utils/syncConnection';
import { getSyncConfigError, normalizeSyncConfig } from '@/utils/heartbeat';
import { NETWORK_CONFIG, type SyncConfig } from '@/constants/config';
import { describeBackupDiagnostic, readBackupDiagnostic, type BackupDiagnostic } from '@/utils/backupDiagnostic';
import { BorderRadius, Spacing, Typography } from '@/constants/theme';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { SyncPairingCamera } from '@/components/SyncPairingCamera';
import { parseSyncPairingCode, verifySyncPairingConnection } from '@/utils/syncPairing';
import { useHardwareBack } from '@/hooks/useHardwareBack';

export default function SettingsToolsScreen() {
  const { section } = useSafeSearchParams<{ section?: string }>();
  const mode = section === 'nas' || section === 'background' ? section : 'sync';
  const title = mode === 'sync' ? '同步助手' : mode === 'nas' ? 'NAS 备份诊断' : '电池优化与后台权限';
  const { theme, isDark } = useTheme();
  const router = useSafeRouter();
  const snapshot = useSyncExternalStore(subscribeSyncConnection, getSyncConnectionSnapshot, getSyncConnectionSnapshot);
  const [config, setConfig] = useState<SyncConfig>(() => snapshot.config || { ip: '', port: NETWORK_CONFIG.DEFAULT_PORT });
  const [data, setData] = useState<BackupDiagnostic | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(mode !== 'sync' || !!snapshot.config);
  const [details, setDetails] = useState(false);
  const [manual, setManual] = useState(false);
  const [camera, setCamera] = useState(false);
  const [scanText, setScanText] = useState('');
  const [notice, setNotice] = useState('');
  const scanRef = useRef<WarehouseScanInputHandle>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visit = useRef(0);
  const active = useRef(false);
  const busyRef = useRef(false);
  const dirty = useRef(false);
  const diagnostic = data ? describeBackupDiagnostic(data) : null;
  const clearScanTimer = () => { if (scanTimer.current) clearTimeout(scanTimer.current); scanTimer.current = null; };
  useEffect(() => () => clearScanTimer(), []);
  useHardwareBack(useCallback(() => {
    if (!camera) return false;
    setCamera(false);
    return true;
  }, [camera]));

  useFocusEffect(useCallback(() => {
    let current = true;
    active.current = true;
    if (mode === 'nas') {
      void readBackupDiagnostic().then(value => { if (current) { setData(value); setError(''); } })
        .catch(() => { if (current) setError('读取备份状态失败，请点击刷新重试'); });
    } else if (mode === 'sync') {
      void refreshSyncConnection().then(() => {
        if (current) {
          if (!dirty.current) setConfig(getSyncConnectionSnapshot().config || { ip: '', port: NETWORK_CONFIG.DEFAULT_PORT });
          setReady(true);
        }
      }).catch(() => { if (current) { setReady(true); setError('读取连接状态失败，请重新检测'); } });
    }
    return () => { current = false; active.current = false; visit.current += 1; clearScanTimer(); setCamera(false); };
  }, [mode]));

  const change = (key: keyof SyncConfig, value: string) => {
    dirty.current = true;
    setError('');
    setNotice('');
    setConfig(previous => ({ ...previous, [key]: value }));
  };
  const detect = async (candidate: SyncConfig = config) => {
    if (busyRef.current || !ready) return;
    const normalized = normalizeSyncConfig(candidate);
    const validation = getSyncConfigError(normalized);
    if (validation) { setError(validation); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const expectedVisit = visit.current;
    try {
      await verifySyncPairingConnection(normalized);
      if (!active.current || visit.current !== expectedVisit) return;
      await saveSyncConnectionConfig(normalized);
      if (active.current && visit.current === expectedVisit) { setConfig(normalized); dirty.current = false; setNotice('已连接电脑，配置已保存'); }
    } catch (failure) {
      if (active.current && visit.current === expectedVisit) setError(failure instanceof Error ? failure.message : '连接失败，请重试');
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  };
  const scan = (raw: string) => {
    clearScanTimer();
    setScanText(''); scanRef.current?.clear();
    if (busyRef.current || !active.current) return;
    try {
      const candidate = parseSyncPairingCode(raw);
      setConfig(candidate); dirty.current = true;
      void detect(candidate);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法识别连接二维码'); setNotice(''); }
  };
  const scanChanged = (raw: string) => {
    setScanText(raw); clearScanTimer();
    if (!raw.trim()) return;
    // A complete JSON frame can be submitted immediately; never process partial scanner input.
    try { JSON.parse(raw.trim()); scan(raw); return; } catch { /* Wait for the rest of the frame. */ }
    scanTimer.current = setTimeout(() => { if (active.current) scan(raw); }, 800);
  };
  const refresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const value = await readBackupDiagnostic();
      if (active.current) { setData(value); setError(''); }
    } catch { if (active.current) setError('读取备份状态失败，请重试'); }
    finally { busyRef.current = false; if (active.current) setBusy(false); }
  };
  const openBatterySettings = async () => {
    setError('');
    try {
      if (Platform.OS === 'android') {
        try { await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'); return; }
        catch { /* Some PDA systems only provide app settings. */ }
      }
      await Linking.openSettings();
    } catch { if (active.current) setError('无法打开系统设置，请手动进入系统设置中的应用管理'); }
  };
  const normalized = normalizeSyncConfig(config);
  const saved = snapshot.config;
  const same = normalized.ip === saved?.ip && normalized.port === saved?.port && (normalized.pairingKey || '') === (saved?.pairingKey || '');
  const connected = same && snapshot.status === 'success';
  const checking = busy || (same && snapshot.status === 'testing');
  const textStyle = { color: theme.textPrimary };
  const mutedStyle = { color: theme.textSecondary };


  return <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'} disableAutoScroll>
    <MotionContent contentKey={camera ? 'camera' : mode} direction="fade" style={{ flex: 1 }}>
    {camera ? <SyncPairingCamera onClose={() => setCamera(false)} onError={() => { setCamera(false); setError('无法启动相机，请使用 PDA 扫描头，或检查系统相机权限'); }} onScan={raw => { setCamera(false); scan(raw); }} /> : <>
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <TouchableOpacity style={styles.back} accessibilityRole="button" accessibilityLabel="返回设置" onPress={() => {
        if (router.canGoBack()) router.back(); else router.replace('/settings');
      }}><Feather name="arrow-left" size={22} color={theme.textPrimary} /></TouchableOpacity>
      <Text style={[styles.title, textStyle]}>{title}</Text>
    </View>
    <KeyboardAwareFormScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={Spacing.xl}>
      {!!error && <Text accessibilityRole="alert" style={[styles.paragraph, { color: theme.error }]}>{error}</Text>}
      {mode === 'sync' && <View style={[styles.connectionCard, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
        <View style={[styles.connectionHeading, { borderBottomColor: theme.border }]}>
          <View style={[styles.connectionIcon, { backgroundColor: theme.backgroundTertiary }]}>
            <Feather name="monitor" size={22} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, textStyle]}>电脑连接</Text>
            <Text style={[styles.connectionNote, mutedStyle]}>与手机保持在同一网络</Text>
          </View>
          <Text style={[styles.label, { color: connected ? theme.success : theme.textMuted }]}>
            {checking ? '检测中…' : connected ? '已连接' : same && saved?.ip ? '未连接' : '待检测'}
          </Text>
        </View>
        <Text style={[styles.connectionNote, mutedStyle]}>点击电脑同步助手的服务地址，打开连接二维码。手机与电脑需在同一网络。</Text>
        <WarehouseScanInput inputRef={scanRef} accessibilityLabel="扫描电脑连接二维码" placeholder="扫描电脑连接二维码"
          value={scanText} onChangeText={scanChanged} onSubmitEditing={event => { if (event.nativeEvent.text.trim()) scan(event.nativeEvent.text); }}
          active={mode === 'sync' && !manual && !camera} autoFocus={!manual && !camera} processing={busy} editable={ready}
          actionIcon="camera" actionDisabled={!ready} actionLabel="使用相机扫描连接码" onActionPress={() => { clearScanTimer(); setScanText(''); scanRef.current?.clear(); setCamera(true); }} />
        {!!saved?.ip && <Text style={[styles.connectionNote, mutedStyle]}>已保存电脑：{saved.ip}:{saved.port} · {saved.pairingKey ? '已配置配对密钥' : '未配置配对密钥'}</Text>}
        {!!notice && <Text accessibilityRole="alert" style={[styles.connectionNote, { color: theme.success }]}>{notice}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: manual }} style={[styles.disclosure, { borderColor: theme.border, marginTop: 16 }]}
          onPress={() => { clearScanTimer(); setManual(value => !value); }}>
          <Text style={[styles.label, textStyle]}>手动配置</Text><MotionChevron expanded={Boolean(manual)} collapsed="down" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
        {<MotionCollapse open={Boolean(manual)}>{manual && <>
        <View style={styles.addressRow}>
          {(['ip', 'port'] as const).map(key => <View key={key} style={key === 'ip' ? styles.ipField : styles.portField}>
            <Text style={[styles.label, mutedStyle]}>{key === 'ip' ? '电脑 IP' : '端口'}</Text>
            <TextInput accessibilityLabel={key === 'ip' ? '电脑 IP' : '端口'}
              style={[styles.input, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
              value={config[key]} editable={ready && !busy} autoCapitalize="none" autoCorrect={false}
              keyboardType={key === 'port' ? 'numeric' : 'default'}
              placeholder={key === 'ip' ? '192.168.1.100' : '8080'} placeholderTextColor={theme.textMuted}
              onChangeText={value => change(key, key === 'port' ? value.replace(/\D/g, '').slice(0, 5) : value)} />
          </View>)}
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, mutedStyle]}>配对密钥（选填）</Text>
          <TextInput accessibilityLabel="配对密钥" secureTextEntry
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]}
            value={config.pairingKey || ''} editable={ready && !busy} autoCapitalize="none" autoCorrect={false}
            placeholder="电脑开启配对时填写" placeholderTextColor={theme.textMuted} maxLength={128}
            onChangeText={value => change('pairingKey', value)} />
        </View>
        <ActionButton label={checking ? '检测中…' : '检测连接'} onPress={() => void detect()} disabled={checking || !ready} />
        <Text style={[styles.connectionNote, mutedStyle]}>检测连接成功后保存配置。</Text>
        </>}</MotionCollapse>}
        {same && (snapshot.status === 'error' || snapshot.status === 'disconnected') && <Text style={[styles.paragraph, { color: theme.error, marginTop: 12 }]}>请核对 IP、端口及配对密钥，并确认电脑同步助手已启动。应用在前台时会自动尝试重连。</Text>}
      </View>}
      {mode === 'nas' && <>
        {!data && !error && <ActivityIndicator color={theme.primary} />}
        {diagnostic && <>
          <Text style={[styles.status, { color: diagnostic.errors.length ? theme.error : theme.textPrimary }]}>{diagnostic.label}</Text>
          <Text style={[styles.paragraph, mutedStyle]}>最近成功：{diagnostic.latestSuccessText}</Text>
          {diagnostic.errors.map(message => <Text key={message} selectable style={[styles.paragraph, { color: theme.error }]}>{message}</Text>)}
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(value => !value)} style={[styles.disclosure, { borderColor: theme.border }]}>
            <Text style={[styles.label, textStyle]}>{details ? '收起详细诊断' : '查看详细诊断'}</Text>
            <MotionChevron expanded={Boolean(details)} collapsed="down" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
          {<MotionCollapse open={Boolean(details)}>{details && diagnostic.rows.map(([label, value]) => <View key={label} style={[styles.diagnosticRow, { borderBottomColor: theme.border }]}>
            <Text style={[styles.label, mutedStyle]}>{label}</Text><Text selectable style={[styles.value, textStyle]}>{value}</Text>
          </View>)}</MotionCollapse>}
        </>}
        <ActionButton label={busy ? '刷新中…' : '刷新状态'} onPress={() => void refresh()} disabled={busy} />
      </>}
      {mode === 'background' && <>
        <Text style={[styles.status, textStyle]}>允许锁屏后继续备份</Text>
        <Text style={[styles.paragraph, mutedStyle]}>在系统设置中，将掌上仓库设为不受电池优化限制，并允许后台联网。企业 PDA 如有自启动或后台运行管理，也请允许本应用运行。</Text>
        <ActionButton label={Platform.OS === 'android' ? '打开电池优化设置' : '打开应用设置'} onPress={() => void openBatterySettings()} />
        <Text style={[styles.paragraph, mutedStyle]}>不同设备的设置名称可能不同。开启情况请以系统设置为准；后台任务的实际结果可在 NAS 备份诊断中查看。</Text>
      </>}
    </KeyboardAwareFormScrollView>
    </>}
    </MotionContent>
  </Screen>;
}
function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { theme } = useTheme();
  return <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={[styles.button, { backgroundColor: theme.primary, opacity: disabled ? 0.5 : 1 }]}>
    <Text style={[styles.buttonText, { color: theme.buttonPrimaryText }]}>{label}</Text>
  </TouchableOpacity>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  title: { ...Typography.h4, flexShrink: 1 },
  content: { padding: Spacing.md, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  status: { ...Typography.h4, marginBottom: 8 },
  paragraph: { ...Typography.small, lineHeight: 22, marginBottom: 16 },
  connectionCard: { borderWidth: 1, borderRadius: BorderRadius.xl, padding: 16 },
  connectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 16, marginBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  connectionIcon: { width: 42, height: 42, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  connectionNote: { ...Typography.caption, lineHeight: 19, marginTop: 3 },
  addressRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  ipField: { flex: 1, minWidth: 0 }, portField: { width: 78 },
  field: { marginBottom: 4 }, label: { ...Typography.smallMedium },
  input: { minHeight: 48, borderWidth: 1, borderRadius: BorderRadius.md, padding: 12, marginTop: 8, ...Typography.body },
  button: { minHeight: 48, borderRadius: BorderRadius.md, padding: 12, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  buttonText: { ...Typography.smallMedium },
  disclosure: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderRadius: BorderRadius.md, padding: 12, minHeight: 48 },
  diagnosticRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { ...Typography.small, lineHeight: 22, marginTop: 4 },
});
