import TestRenderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { UiListItem } from '@/components/UiRedesign';
import { backendJsonRequest } from '@/utils/backendApi';
import { ERP_ACCOUNTS } from '@/utils/erpAccounts';
import SettingsScreen from '../index';

let mockFocused = true;
const mockNavigation = { addListener: () => () => undefined };
const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockAlert = { showError: jest.fn(), AlertComponent: null };
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
  useNavigation: () => mockNavigation,
}));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon', FontAwesome6: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/CustomAlert', () => ({ useCustomAlert: () => mockAlert }));
jest.mock('@/utils/toast', () => ({ useToast: () => ({ ToastContainer: () => null }) }));
jest.mock('@/utils/feedback', () => ({ initSoundSetting: jest.fn(), setSoundEnabled: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/utils/database', () => ({
  STORAGE_KEYS: { SYNC_CONFIG: 'mock-sync-config', SOUND_ENABLED: 'mock-sound' },
  getConfigStats: jest.fn(async () => ({ rules: 0, customFields: 0, inventoryBindings: 0, warehouses: 0 })),
}));
jest.mock('@/utils/workDraftIsolation', () => ({ listIsolatedWorkDrafts: jest.fn(async () => []) }));
jest.mock('@/utils/nasBackup', () => ({}));
jest.mock('@/utils/backupDiagnostic', () => ({ readBackupDiagnostic: jest.fn(async () => null) }));
jest.mock('@/utils/heartbeat', () => ({}));
jest.mock('@/utils/backendApi', () => ({ buildErpProxyPath: (value: string) => value, backendJsonRequest: jest.fn() }));
jest.mock('@/utils/erpAccounts', () => ({
  ERP_ACCOUNTS: [
    { key: 'shanghai-chipmunk', name: '测试上海账套', backendBaseUrl: 'https://shanghai.invalid' },
    { key: 'wuxi-duneng', name: '测试无锡账套', backendBaseUrl: 'https://wuxi.invalid' },
  ],
  isErpAccountAvailable: () => true,
}));
jest.mock('@/utils/syncConnection', () => {
  const snapshot = { status: 'idle', config: null };
  return {
    getSyncConnectionSnapshot: () => snapshot,
    subscribeSyncConnection: () => () => undefined,
    refreshSyncConnection: jest.fn(async () => undefined),
  };
});
jest.mock('@/screens/app-updates', () => ({ OtaUpdatePanel: () => null }));
jest.mock('expo-updates', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-intent-launcher', () => ({}));

const request = jest.mocked(backendJsonRequest);
const listeners = new Set<(state: AppStateStatus) => void>();
let originalAppState: typeof AppState.currentState;
let root: TestRenderer.ReactTestRenderer | undefined;
let testTime = Date.UTC(2026, 10, 17);

const healthy = (account: (typeof ERP_ACCOUNTS)[number]) => ({
  accountKey: account.key,
  success: true,
  appKeyConfigured: true,
  appSecretConfigured: true,
  openTokenConfigured: true,
});

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}

async function appState(state: AppStateStatus) {
  await act(async () => {
    AppState.currentState = state;
    for (const listener of listeners) listener(state);
  });
}

async function mount(updatesOnly = false) {
  await act(async () => { root = TestRenderer.create(<SettingsScreen updatesOnly={updatesOnly} />); });
}

const item = (title: string) => root!.root.findAllByType(UiListItem).find(node => node.props.title === title)!;
const statusSubtitle = () => item('ERP对接').props.subtitle;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers().setSystemTime(testTime += 60 * 60 * 1000);
  mockFocused = true;
  originalAppState = AppState.currentState;
  AppState.currentState = 'active';
  request.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  listeners.clear();
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('reruns a pending two-account check on return to the foreground and ignores old responses', async () => {
  const first = ERP_ACCOUNTS.map(() => deferred());
  const resumed = ERP_ACCOUNTS.map(() => deferred());
  [...first, ...resumed].forEach(result => request.mockReturnValueOnce(result.promise));

  AppState.currentState = null;
  await mount();
  expect(statusSubtitle()).toBe('正在检测ERP后端');
  expect(request).toHaveBeenCalledTimes(2);
  ERP_ACCOUNTS.forEach((account, index) => {
    expect(request).toHaveBeenNthCalledWith(index + 1, '/api/erp/health', expect.objectContaining({
      baseUrl: account.backendBaseUrl,
      erpAccountKey: account.key,
      settleOnAbort: true,
      timeoutMs: 8_000,
    }));
  });
  const oldSignals = request.mock.calls.map(([, options]) => options?.signal);
  await appState('active');
  expect(request).toHaveBeenCalledTimes(2);
  expect(oldSignals.every(signal => signal?.aborted === false)).toBe(true);
  await appState('background');
  await appState('active');
  expect(request).toHaveBeenCalledTimes(4);
  expect(oldSignals.every(signal => signal?.aborted)).toBe(true);

  await act(async () => { resumed.forEach((result, index) => result.resolve(healthy(ERP_ACCOUNTS[index]))); });
  expect(statusSubtitle()).toBe('2/2 套已就绪');
  await act(async () => { first.forEach(result => result.resolve({ success: false })); });
  expect(statusSubtitle()).toBe('2/2 套已就绪');
});

it('aborts a check on navigation blur and does not probe in the background of another screen', async () => {
  request.mockImplementation(() => new Promise(() => undefined));
  await mount();
  expect(request).toHaveBeenCalledTimes(2);
  const signals = request.mock.calls.map(([, options]) => options?.signal);
  await act(async () => {
    mockFocused = false;
    root!.update(<SettingsScreen />);
  });
  expect(signals.every(signal => signal?.aborted)).toBe(true);

  await appState('background');
  await appState('active');
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not probe ERP health from the application-update-only route', async () => {
  await mount(true);
  await appState('background');
  await appState('active');
  expect(request).not.toHaveBeenCalled();
});

it('keeps the healthy account visible and lets the operator retry after the other account times out', async () => {
  const [first, second] = ERP_ACCOUNTS;
  request.mockResolvedValueOnce(healthy(first)).mockRejectedValueOnce(new Error('请求超时（8秒）'));
  await mount();
  expect(statusSubtitle()).toBe('1/2 套已就绪');

  await act(async () => { item('ERP对接').props.onPress(); });
  expect(item(first.name).props.rightText).toBe('正常');
  expect(item(second.name).props.rightText).toBe('异常');
  expect(item(second.name).props.subtitle).toContain('超时');
  expect(item('重新检测ERP').props.disabled).toBe(false);

  request.mockResolvedValueOnce(healthy(first)).mockResolvedValueOnce(healthy(second));
  await act(async () => { item('重新检测ERP').props.onPress(); });
  expect(request).toHaveBeenCalledTimes(4);
  expect(statusSubtitle()).toBe('2/2 套已就绪');
});
