import AsyncStorage from '@react-native-async-storage/async-storage';
import TestRenderer, { act } from 'react-test-renderer';
import * as Updates from 'expo-updates';
import { usePathname } from 'expo-router';
import { useOverlayActivity } from '@/hooks/useOverlayActivity';
import { recordRunningUpdate } from '@/utils/otaUpdate';
import { OtaStartup } from '../OtaStartup';
import { AppModal } from '@/components/AppModal';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { AppPillToast } from '@/components/AppPillToast';
import { checkpointDatabaseToDisk } from '@/utils/database';
import { lockForOtaApply } from '@/utils/otaSafety';
import { Text } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-updates', () => ({ useUpdates: jest.fn(), updateId: 'running-id', isEnabled: true, reloadAsync: jest.fn() }));
jest.mock('expo-router', () => ({ usePathname: jest.fn() }));
jest.mock('@/hooks/useOverlayActivity', () => ({ useOverlayActivity: jest.fn() }));
const mockPush = jest.fn();
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock('@/utils/database', () => ({ checkpointDatabaseToDisk: jest.fn() }));
jest.mock('@/utils/otaSafety', () => ({ lockForOtaApply: jest.fn() }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }) }));
jest.mock('@/components/AppModal', () => ({ AppModal: ({ visible, children }: { visible: boolean; children: unknown }) => visible ? require('react').createElement(require('react-native').View, { testID: 'ota-dialog' }, children) : null }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: (props: { children: unknown; footer: unknown }) => require('react').createElement(require('react-native').View, {}, props.children, props.footer) }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'ota-actions' }) }));
jest.mock('@/utils/otaUpdate', () => ({
  ...jest.requireActual('@/utils/otaUpdate'),
  recordRunningUpdate: jest.fn(), consumeOtaReturnHome: async () => false, downloadOtaUpdate: async () => 'latest',
}));
const pending = (id: string) => ({ isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: id, manifest: { id } } });
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks(); await AsyncStorage.clear();
  jest.mocked(usePathname).mockReturnValue('/');
  jest.mocked(useOverlayActivity).mockReturnValue(false);
  jest.mocked(Updates.useUpdates).mockReturnValue(pending('next-id') as never);
  jest.mocked(recordRunningUpdate).mockResolvedValue(null);
  jest.mocked(checkpointDatabaseToDisk).mockResolvedValue(undefined);
  jest.mocked(lockForOtaApply).mockImplementation(() => jest.fn());
});
afterEach(() => { jest.useRealTimers(); });
async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<OtaStartup />); });
  return tree;
}
const dialogs = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(AppModal).filter(node => node.props.visible);
const actions = (tree: TestRenderer.ReactTestRenderer) => tree.root.findByType(AppModalActions);
const pills = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(AppPillToast).filter(node => node.props.visible);
test('already applied update never shows a ready dialog', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue(pending('running-id') as never);
  const tree = await render(); expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
});
test('ready dialog is dismissed and does not reappear after restart', async () => {
  const tree = await render(); expect(dialogs(tree)).toHaveLength(1);
  await act(async () => actions(tree).props.onSecondaryPress());
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
  const restarted = await render(); expect(dialogs(restarted)).toHaveLength(0);
  await act(async () => restarted.unmount());
});
test('scanner screens defer dialogs until returning to workbench', async () => {
  jest.mocked(usePathname).mockReturnValue('/outbound');
  const tree = await render(); expect(dialogs(tree)).toHaveLength(0);
  jest.mocked(usePathname).mockReturnValue('/');
  await act(async () => tree.update(<OtaStartup />));
  expect(dialogs(tree)).toHaveLength(1);
  await act(async () => tree.unmount());
});
test('another modal defers update reminder', async () => {
  jest.mocked(useOverlayActivity).mockReturnValue(true);
  const tree = await render(); expect(dialogs(tree)).toHaveLength(0);
  jest.mocked(useOverlayActivity).mockReturnValue(false);
  await act(async () => tree.update(<OtaStartup />));
  expect(dialogs(tree)).toHaveLength(1);
  await act(async () => tree.unmount());
});
test('update modal registering its own overlay does not hide or reopen itself', async () => {
  const tree = await render(); expect(dialogs(tree)).toHaveLength(1);
  jest.mocked(useOverlayActivity).mockReturnValue(true);
  await act(async () => tree.update(<OtaStartup />));
  expect(dialogs(tree)).toHaveLength(1);
  await act(async () => actions(tree).props.onSecondaryPress());
  jest.mocked(useOverlayActivity).mockReturnValue(false);
  await act(async () => tree.update(<OtaStartup />));
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
});
test('applied notification has no buttons and dismisses itself after 1.5 seconds without repeating after restart', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue(pending('running-id') as never);
  jest.mocked(recordRunningUpdate).mockResolvedValue({ id: 'running-id', notes: 'fixed', appliedAt: '2026-11-02' });
  const tree = await render();
  expect(dialogs(tree)).toHaveLength(0);
  expect(tree.root.findAllByType(AppModalCard)).toHaveLength(0);
  expect(pills(tree)).toHaveLength(1);
  expect(pills(tree)[0].props).toMatchObject({ text: '热更新已完成', type: 'success', bottom: 108 });
  expect(pills(tree)[0].findAllByProps({ pointerEvents: 'none' }).length).toBeGreaterThan(0);
  expect(tree.root.findAllByType(AppModalActions)).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(1499); });
  expect(pills(tree)).toHaveLength(1);
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(pills(tree)).toHaveLength(0);
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.update(<OtaStartup />));
  expect(pills(tree)).toHaveLength(0);
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
  const restarted = await render();
  expect(pills(restarted)).toHaveLength(0);
  expect(dialogs(restarted)).toHaveLength(0);
  await act(async () => restarted.unmount());
});

test('ready notification still waits for a user action instead of dismissing on the applied timer', async () => {
  const tree = await render();
  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(dialogs(tree)).toHaveLength(1);
  expect(actions(tree).props.primaryLabel).toBe('立即应用');
  await act(async () => tree.unmount());
});

test('ready reminder directly applies once after saving, without navigating to settings', async () => {
  let finishSave!: () => void;
  jest.mocked(checkpointDatabaseToDisk).mockImplementation(() => new Promise<void>(resolve => { finishSave = resolve; }));
  const tree = await render();
  expect(actions(tree).props.primaryLabel).toBe('立即应用');
  await act(async () => { actions(tree).props.onPrimaryPress(); actions(tree).props.onPrimaryPress(); });
  expect(lockForOtaApply).toHaveBeenCalledTimes(1);
  expect(checkpointDatabaseToDisk).toHaveBeenCalledTimes(1);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('warehouse.ota.return-home')).toBeNull();
  expect(actions(tree).props).toMatchObject({ primaryLabel: '正在应用…', primaryDisabled: true, secondaryDisabled: true });
  await act(async () => { actions(tree).props.onSecondaryPress(); });
  expect(dialogs(tree)).toHaveLength(1);
  await act(async () => finishSave());
  expect(await AsyncStorage.getItem('warehouse.ota.return-home')).toBe('1');
  expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('busy operations keep the reminder open with the full reason and permit a later retry', async () => {
  const reason = '正在保存或同步数据，请完成后再应用更新';
  jest.mocked(lockForOtaApply).mockImplementationOnce(() => { throw new Error(reason); });
  const tree = await render();
  await act(async () => { actions(tree).props.onPrimaryPress(); });
  expect(dialogs(tree)).toHaveLength(1);
  expect(checkpointDatabaseToDisk).not.toHaveBeenCalled();
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  const errorText = tree.root.findAllByType(Text).find(node => node.props.children === reason);
  expect(errorText).toBeDefined();
  expect(errorText!.props.numberOfLines).toBeUndefined();
  expect(actions(tree).props.primaryDisabled).toBe(false);
  await act(async () => { actions(tree).props.onPrimaryPress(); });
  expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(Text).some(node => node.props.children === reason)).toBe(false);
  await act(async () => tree.unmount());
});

test('failed database checkpoint releases the apply lock without reloading', async () => {
  const unlock = jest.fn();
  jest.mocked(lockForOtaApply).mockReturnValue(unlock);
  jest.mocked(checkpointDatabaseToDisk).mockRejectedValueOnce(new Error('数据库保存失败，请重试'));
  const tree = await render();
  await act(async () => { actions(tree).props.onPrimaryPress(); });
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('warehouse.ota.return-home')).toBeNull();
  expect(actions(tree).props.primaryDisabled).toBe(false);
  await act(async () => { actions(tree).props.onSecondaryPress(); });
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('applied timer is cancelled away from workbench and restarts when the notice becomes visible again', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue(pending('running-id') as never);
  jest.mocked(recordRunningUpdate).mockResolvedValue({ id: 'running-id', notes: '', appliedAt: '2026-11-02' });
  const tree = await render();
  await act(async () => { jest.advanceTimersByTime(500); });
  jest.mocked(usePathname).mockReturnValue('/outbound');
  await act(async () => tree.update(<OtaStartup />));
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(pills(tree)).toHaveLength(0);
  expect(dialogs(tree)).toHaveLength(0);
  jest.mocked(usePathname).mockReturnValue('/');
  await act(async () => tree.update(<OtaStartup />));
  expect(pills(tree)).toHaveLength(1);
  await act(async () => { jest.advanceTimersByTime(1500); });
  expect(pills(tree)).toHaveLength(0);
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
});

test('applied pill waits while another dialog is open and resumes without blocking input', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue(pending('running-id') as never);
  jest.mocked(recordRunningUpdate).mockResolvedValue({ id: 'running-id', notes: '', appliedAt: '2026-11-02' });
  const tree = await render();
  expect(pills(tree)).toHaveLength(1);
  await act(async () => { jest.advanceTimersByTime(500); });
  jest.mocked(useOverlayActivity).mockReturnValue(true);
  await act(async () => tree.update(<OtaStartup />));
  expect(pills(tree)).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(2000); });
  jest.mocked(useOverlayActivity).mockReturnValue(false);
  await act(async () => tree.update(<OtaStartup />));
  expect(pills(tree)).toHaveLength(1);
  expect(dialogs(tree)).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(1500); });
  expect(pills(tree)).toHaveLength(0);
  await act(async () => tree.unmount());
});
