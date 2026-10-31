import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, AppState, Text, TouchableOpacity, type AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import RootLayout from '@/app/_layout';
import {
  checkpointDatabaseToDisk,
  ensureDatabaseConnectionReady,
  initDatabase,
} from '@/utils/database';
import { maybeRunAutoNasBackup } from '@/utils/autoNasBackup';

jest.mock('../../global.css', () => ({}));
jest.mock('expo-router', () => ({
  Stack: Object.assign(
    jest.fn(({ children }: { children: import('react').ReactNode }) => children),
    { Screen: jest.fn(() => null) },
  ),
}));
jest.mock('expo-splash-screen', () => ({
  setOptions: jest.fn(),
  preventAutoHideAsync: jest.fn(async () => undefined),
  hideAsync: jest.fn(async () => undefined),
}));
jest.mock('@/components/Provider', () => ({
  Provider: ({ children }: { children: import('react').ReactNode }) => children,
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      backgroundRoot: '#ffffff',
      primary: '#0066cc',
      textPrimary: '#111111',
      textSecondary: '#555555',
      buttonPrimaryText: '#ffffff',
    },
  }),
}));
jest.mock('@/constants/theme', () => ({
  BorderRadius: { md: 8 },
  Spacing: { sm: 8, lg: 16, xl: 24 },
  Typography: { bodyMedium: {}, h4: {}, small: {}, smallMedium: {} },
}));
jest.mock('@/utils/responsive', () => ({ MIN_TOUCH_TARGET: 48 }));
jest.mock('@/utils/database', () => ({
  initDatabase: jest.fn(),
  checkpointDatabaseToDisk: jest.fn(async () => undefined),
  ensureDatabaseConnectionReady: jest.fn(async () => undefined),
}));
jest.mock('@/utils/feedback', () => ({
  initSoundSetting: jest.fn(async () => undefined),
  pauseFeedbackForAppInactive: jest.fn(async () => undefined),
  resumeFeedbackAfterAppActive: jest.fn(async () => undefined),
}));
jest.mock('@/utils/autoNasBackup', () => ({
  AUTO_NAS_BACKUP_CHECK_INTERVAL_MS: 60_000,
  maybeRunAutoNasBackup: jest.fn(async () => ({ status: 'skipped', reason: 'not-due' })),
}));
jest.mock('@/utils/syncConnection', () => ({ setSyncConnectionActive: jest.fn() }));
jest.mock('@/utils/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

let renderer: TestRenderer.ReactTestRenderer | undefined;
let previousAppState: typeof AppState.currentState;
const listeners = new Set<(state: AppStateStatus) => void>();
const initialize = jest.mocked(initDatabase);
const hasText = (value: string) => renderer!.root.findAllByType(Text)
  .some(node => node.props.children === value);
const pressRetry = async () => {
  const button = renderer!.root.findAllByType(TouchableOpacity).find(node =>
    node.findAllByType(Text).some(label => label.props.children === '重试初始化'));
  expect(button).toBeDefined();
  await act(async () => { button!.props.onPress(); });
};
const mountAndInitialize = async () => {
  await act(async () => { renderer = TestRenderer.create(<RootLayout />); });
  await act(async () => { await jest.advanceTimersByTimeAsync(0); });
};
const expectDatabaseLifecycleInactive = () => {
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
  expect(ensureDatabaseConnectionReady).not.toHaveBeenCalled();
  expect(checkpointDatabaseToDisk).not.toHaveBeenCalled();
  expect(maybeRunAutoNasBackup).not.toHaveBeenCalled();
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers();
  jest.clearAllMocks();
  initialize.mockReset().mockResolvedValue(undefined);
  previousAppState = AppState.currentState;
  AppState.currentState = 'active';
  listeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
});

afterEach(async () => {
  if (renderer) await act(async () => { renderer!.unmount(); });
  renderer = undefined;
  AppState.currentState = previousAppState;
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('starts a new initialization after a native lock error and keeps database lifecycle work gated until retry succeeds', async () => {
  const retry = deferred();
  const lockMessage = 'NativeStatement.finalizeAsync: database is locked';
  initialize.mockRejectedValueOnce(new Error(lockMessage)).mockReturnValueOnce(retry.promise);

  await mountAndInitialize();
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(hasText('数据库初始化失败')).toBe(true);
  expect(hasText(lockMessage)).toBe(true);
  expect(renderer!.root.findAllByType(Stack)).toHaveLength(0);
  expectDatabaseLifecycleInactive();

  await pressRetry();
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(hasText('正在初始化数据库')).toBe(true);
  expect(hasText(lockMessage)).toBe(false);
  expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  expect(renderer!.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  expect(renderer!.root.findAllByType(Stack)).toHaveLength(0);

  await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
  expectDatabaseLifecycleInactive();
  expect(initialize).toHaveBeenCalledTimes(2);

  await act(async () => { retry.resolve(); });
  expect(renderer!.root.findAllByType(Stack)).toHaveLength(1);
  expect(hasText('数据库初始化失败')).toBe(false);
  expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(1);
  expect(maybeRunAutoNasBackup).toHaveBeenCalledWith('app-ready');
});

it('keeps retry available after another initialization failure and admits the app on a later success', async () => {
  initialize
    .mockRejectedValueOnce(new Error('first database lock'))
    .mockRejectedValueOnce(new Error('second database lock'));

  await mountAndInitialize();
  await pressRetry();
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(hasText('数据库初始化失败')).toBe(true);
  expect(hasText('second database lock')).toBe(true);
  expect(hasText('first database lock')).toBe(false);
  expectDatabaseLifecycleInactive();

  await pressRetry();
  expect(initialize).toHaveBeenCalledTimes(3);
  expect(renderer!.root.findAllByType(Stack)).toHaveLength(1);
  expect(hasText('重试初始化')).toBe(false);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
});
