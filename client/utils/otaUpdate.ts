import { APP_VERSION } from '@/constants/version';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'warehouse.ota.applied.v1';
const RETURN_HOME_KEY = 'warehouse.ota.return-home';
export async function markOtaReload(): Promise<void> { await AsyncStorage.setItem(RETURN_HOME_KEY, '1'); }
export async function consumeOtaReturnHome(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(RETURN_HOME_KEY);
  if (pending) await AsyncStorage.removeItem(RETURN_HOME_KEY);
  return pending === '1';
}
export type AppliedUpdate = { id: string; appliedAt: string; notes: string };
export const updateNotes = (manifest: unknown): string => {
  const wrapper = manifest as { manifest?: unknown } | undefined;
  const value = (wrapper?.manifest || manifest) as { extra?: { warehouseUpdate?: { notes?: string } } } | undefined;
  return value?.extra?.warehouseUpdate?.notes || '';
};
type PendingState = { isUpdatePending: boolean; downloadedUpdate?: { type?: string; updateId?: string; createdAt?: Date; manifest?: unknown }; currentlyRunning?: { updateId?: string; createdAt?: Date } };
export function getPendingOtaUpdate(state: PendingState) {
  const pending = state.downloadedUpdate;
  if (!state.isUpdatePending || !pending?.updateId || pending.type === 'rollback') return null;
  const runningId = state.currentlyRunning?.updateId || Updates.updateId;
  if (pending.updateId === runningId) return null;
  const runningDate = state.currentlyRunning?.createdAt || Updates.createdAt;
  if (pending.createdAt && runningDate && pending.createdAt.getTime() <= runningDate.getTime()) return null;
  return pending;
}
let noticeQueue: Promise<unknown> = Promise.resolve();
export function claimOtaNotice(kind: 'ready' | 'applied', id: string): Promise<boolean> {
  const operation = noticeQueue.catch(() => undefined).then(async () => {
    const key = `warehouse.ota.notice.${kind}.v1`;
    if (await AsyncStorage.getItem(key) === id) return false;
    await AsyncStorage.setItem(key, id);
    return true;
  });
  noticeQueue = operation;
  return operation;
}
export async function recordRunningUpdate(): Promise<AppliedUpdate | null> {
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.updateId) return null;
  const previous = await AsyncStorage.getItem(KEY);
  let parsed: AppliedUpdate | null = null;
  try { parsed = previous ? JSON.parse(previous) : null; } catch { /* Replace damaged display metadata. */ }
  if (parsed?.id === Updates.updateId) return null;
  const value = { id: Updates.updateId, appliedAt: new Date().toISOString(), notes: updateNotes(Updates.manifest) };
  await AsyncStorage.setItem(KEY, JSON.stringify(value));
  return value;
}
export async function readAppliedUpdate(): Promise<AppliedUpdate | null> {
  const value = await AsyncStorage.getItem(KEY);
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
let checking: Promise<'downloaded' | 'latest'> | null = null;
export function downloadOtaUpdate(): Promise<'downloaded' | 'latest'> {
  if (!Updates.isEnabled) return Promise.reject(new Error('请先安装启用热更新的新 APK；WEB 预览不支持热更新。'));
  if (!checking) {
    checking = (async () => {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        const id = (result.manifest as { id?: string } | undefined)?.id;
        // A self-hosted server may return the currently running manifest again.
        // Never re-fetch it or treat it as another pending update.
        if (id && id === Updates.updateId) return 'latest' as const;
        await Updates.fetchUpdateAsync(); return 'downloaded' as const;
      }
      if (Updates.runtimeVersion) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(`https://erp.chipmunks.fun/app-updates/status?runtime=${encodeURIComponent(Updates.runtimeVersion)}&apkVersion=${encodeURIComponent(APP_VERSION)}`, { signal: controller.signal });
          if (response.ok && (await response.json()).requiresApk) throw new Error('服务器上的热更新需要新版 APK，请先检查 APK 更新。');
        } finally { clearTimeout(timer); }
      }
      return 'latest' as const;
    })().finally(() => { checking = null; });
  }
  return checking;
}
