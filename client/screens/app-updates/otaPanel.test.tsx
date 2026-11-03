import { AnimatedButton } from '@/components/AnimatedButton';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Updates from 'expo-updates';
import { checkpointDatabaseToDisk } from '@/utils/database';
import { lockForOtaApply } from '@/utils/otaSafety';
import { OtaUpdatePanel } from './index';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('expo-updates', () => ({
  useUpdates: jest.fn(),
  isEnabled: true, isEmbeddedLaunch: false, updateId: 'running-old-id', reloadAsync: jest.fn(),
}));
jest.mock('@/utils/database', () => ({ checkpointDatabaseToDisk: jest.fn() }));
jest.mock('@/utils/otaSafety', () => ({ lockForOtaApply: jest.fn(() => jest.fn()) }));
jest.mock('@/utils/otaUpdate', () => ({
  ...jest.requireActual('@/utils/otaUpdate'),
  readAppliedUpdate: async () => null,
  markOtaReload: async () => undefined,
  downloadOtaUpdate: async () => 'latest',
  updateNotes: () => 'new fix',
}));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {} }) }));
jest.mock('@/components/AnimatedButton', () => ({ AnimatedButton: (props: object) => require('react').createElement(require('react-native').Pressable, props) }));

beforeEach(() => { jest.clearAllMocks(); jest.mocked(Updates.useUpdates).mockReturnValue({ isUpdatePending: false } as never); jest.mocked(lockForOtaApply).mockImplementation(() => jest.fn()); });

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<OtaUpdatePanel />); });
  return tree;
}
const text = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');

test('apply is absent until downloaded and active ID remains the running version', async () => {
  const tree = await render();
  expect(text(tree)).not.toContain('立即应用');
  expect(text(tree)).toContain('running-');
  await act(async () => tree.unmount());
});
test('already applied ID cannot expose another apply button despite native pending flag', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue({ isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: 'running-old-id' } } as never);
  const tree = await render();
  expect(text(tree)).not.toContain('立即应用');
  expect(text(tree)).not.toContain('已下载，待应用');
  await act(async () => tree.unmount());
});
test('apply waits for database checkpoint before reload', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue({ isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: 'new-release', manifest: { id: 'new-release' } } } as never);
  let resolve!: () => void;
  jest.mocked(checkpointDatabaseToDisk).mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const tree = await render();
  await act(async () => { tree.root.findAllByType(AnimatedButton)[1].props.onPress(); });
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('active submissions block reload and display the complete reason', async () => {
  jest.mocked(Updates.useUpdates).mockReturnValue({ isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: 'new-release', manifest: { id: 'new-release' } } } as never);
  jest.mocked(lockForOtaApply).mockImplementation(() => { throw new Error('正在提交打印，请稍后应用'); });
  const tree = await render();
  await act(async () => { tree.root.findAllByType(AnimatedButton)[1].props.onPress(); });
  expect(Updates.reloadAsync).not.toHaveBeenCalled();
  expect(text(tree)).toContain('正在提交打印，请稍后应用');
  await act(async () => tree.unmount());
});
