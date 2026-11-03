import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity, Linking } from 'react-native';
import SettingsToolsScreen from '../index';
import { readBackupDiagnostic } from '@/utils/backupDiagnostic';
import { saveSyncConnectionConfig } from '@/utils/syncConnection';
import { verifySyncPairingConnection } from '@/utils/syncPairing';

const mockParams = { section: 'sync' };
const mockBack = jest.fn();
const mockSnapshot = { config: { ip: '192.168.1.8', port: '8080', pairingKey: 'test-key' }, status: 'success' };
jest.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeSearchParams: () => mockParams,
  useSafeRouter: () => ({ back: mockBack, canGoBack: () => true }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/hooks/useHardwareBack', () => ({ useHardwareBack: jest.fn() }));
jest.mock('@/components/WarehouseScanInput', () => ({ WarehouseScanInput: 'Scanner' }));
jest.mock('@/components/SyncPairingCamera', () => ({ SyncPairingCamera: 'Camera' }));
jest.mock('@/utils/syncPairing', () => ({
  ...jest.requireActual('@/utils/syncPairing'), verifySyncPairingConnection: jest.fn(async () => undefined),
}));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Scroll' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => { throw Error('unsupported'); }) }));
jest.mock('@/utils/syncConnection', () => ({
  getSyncConnectionSnapshot: () => mockSnapshot, subscribeSyncConnection: () => () => undefined,
  refreshSyncConnection: jest.fn(async () => undefined), saveSyncConnectionConfig: jest.fn(async () => undefined),
}));
jest.mock('@/utils/backupDiagnostic', () => ({ readBackupDiagnostic: jest.fn(), describeBackupDiagnostic: () => ({
  label: '备份异常', latestSuccessText: '2026-11-01 10:00', errors: ['网络错误：' + '详细原因'.repeat(40)],
  rows: [['后台说明', '完整后台信息']],
}) }));

let root: TestRenderer.ReactTestRenderer;
const press = async (label: string) => {
  const button = root.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label ||
    node.findAllByType(Text).some(text => text.props.children === label));
  expect(button).toBeDefined();
  await act(async () => { await button!.props.onPress(); });
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(verifySyncPairingConnection).mockResolvedValue(undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.mocked(readBackupDiagnostic).mockResolvedValue({ foreground: null, background: null, success: null });
});
afterEach(async () => { await act(async () => { root?.unmount(); }); jest.restoreAllMocks(); });

it.each(['sync', 'nas', 'background'])('returns from %s to the existing settings screen', async section => {
  mockParams.section = section;
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await press('返回设置');
  expect(mockBack).toHaveBeenCalledTimes(1);
});

const code = (key?: string) => JSON.stringify({ type: 'palm-warehouse-sync', v: 1, ip: '192.168.1.9', port: 8080, ...(key ? { key } : {}) });
it('connects a scanner code without carrying over the old pairing key', async () => {
  mockParams.section = 'sync';
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await act(async () => { root.root.findByType('Scanner').props.onChangeText(code()); });
  expect(verifySyncPairingConnection).toHaveBeenCalledWith({ ip: '192.168.1.9', port: '8080' });
  expect(saveSyncConnectionConfig).toHaveBeenCalledWith({ ip: '192.168.1.9', port: '8080' });
});
it('does not replace the saved connection if verification fails', async () => {
  mockParams.section = 'sync';
  jest.mocked(verifySyncPairingConnection).mockRejectedValueOnce(Error('配对密钥不匹配'));
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await act(async () => { root.root.findByType('Scanner').props.onChangeText(code('new-key')); });
  expect(saveSyncConnectionConfig).not.toHaveBeenCalled();
  expect(root.root.findAllByType(Text).some(node => node.props.children === '配对密钥不匹配')).toBe(true);
});
it('waits for a complete scanner frame and does not save after leaving the page', async () => {
  mockParams.section = 'sync';
  let finish!: () => void;
  jest.mocked(verifySyncPairingConnection).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await act(async () => { root.root.findByType('Scanner').props.onChangeText(code().slice(0, 40)); });
  expect(verifySyncPairingConnection).not.toHaveBeenCalled();
  await act(async () => { root.root.findByType('Scanner').props.onChangeText(code()); });
  await act(async () => { root.unmount(); });
  await act(async () => { finish(); });
  expect(saveSyncConnectionConfig).not.toHaveBeenCalled();
});
it('ignores duplicate scans while validating and saves camera scans through the same flow', async () => {
  mockParams.section = 'sync';
  let finish!: () => void;
  jest.mocked(verifySyncPairingConnection).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await act(async () => { root.root.findByType('Scanner').props.onChangeText(code('new-key')); root.root.findByType('Scanner').props.onChangeText(code('new-key')); });
  expect(verifySyncPairingConnection).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(saveSyncConnectionConfig).toHaveBeenCalledTimes(1);
  await act(async () => { root.root.findByType('Scanner').props.onActionPress(); });
  await act(async () => { root.root.findByType('Camera').props.onScan(code('camera-key')); });
  expect(saveSyncConnectionConfig).toHaveBeenLastCalledWith({ ip: '192.168.1.9', port: '8080', pairingKey: 'camera-key' });
});
it('loads saved pairing key and passes it through connection detection', async () => {
  mockParams.section = 'sync';
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await press('手动配置');
  const fields = root.root.findAllByType(TextInput);
  expect(fields[2].props.secureTextEntry).toBe(true);
  expect(fields[2].props.value).toBe('test-key');
  await act(async () => { fields[0].props.onChangeText('192.168.1.9'); });
  await press('检测连接');
  expect(saveSyncConnectionConfig).toHaveBeenCalledWith({ ip: '192.168.1.9', port: '8080', pairingKey: 'test-key' });
});
it('shows complete failures before expanding diagnostics and permits refresh after a read failure', async () => {
  mockParams.section = 'nas';
  jest.mocked(readBackupDiagnostic).mockRejectedValueOnce(Error('read failed'));
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  await press('刷新状态');
  const error = root.root.findAllByType(Text).find(node => String(node.props.children).startsWith('网络错误：'));
  expect(error?.props.numberOfLines).toBeUndefined();
  expect(root.root.findAllByType(Text).some(node => node.props.children === '完整后台信息')).toBe(false);
  await press('查看详细诊断');
  expect(root.root.findAllByType(Text).some(node => node.props.children === '完整后台信息')).toBe(true);
});
it('opens system app settings as fallback when the battery settings activity is unavailable', async () => {
  mockParams.section = 'background';
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await act(async () => { root = TestRenderer.create(<SettingsToolsScreen />); });
  const button = root.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text)
    .some(text => ['打开电池优化设置', '打开应用设置'].includes(text.props.children)));
  await act(async () => { button!.props.onPress(); await Promise.resolve(); await Promise.resolve(); });
  expect(open).toHaveBeenCalledTimes(1);
});
