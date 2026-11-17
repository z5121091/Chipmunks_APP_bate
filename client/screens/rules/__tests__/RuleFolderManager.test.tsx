import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { RuleFolderManager, type RuleFolderManagerProps } from '../RuleFolderManager';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { AppPressable } from '@/components/AppPressable';
import { UiListItem } from '@/components/UiRedesign';
import * as database from '@/utils/database';

jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: require('@/constants/theme').Colors.light }) }));
jest.mock('@/components/AppMotion', () => ({ MotionSurface: 'ModalSurface' }));
jest.mock('@/components/AppModal', () => ({ AppModal: require('react-native').Modal }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppPressable', () => ({ AppPressable: require('react-native').TouchableOpacity }));
jest.mock('@/components/UiRedesign', () => ({
  UiInput: require('react-native').TextInput,
  UiListItem: ({ title, ...props }: { title: string }) => require('react').createElement('Tool', props,
    require('react').createElement(require('react-native').Text, null, title)),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/utils/database', () => ({
  addRuleFolder: jest.fn(), renameRuleFolder: jest.fn(), deleteRuleFolder: jest.fn(),
  moveRulesToFolder: jest.fn(), setRuleFoldersDisplayOrder: jest.fn(),
}));

const folders: database.QRCodeRuleFolder[] = [
  { id: 'east', name: '东微', displayOrder: 1, created_at: '', updated_at: '' },
  { id: 'sea', name: '极海', displayOrder: 2, created_at: '', updated_at: '' },
];
const rules: database.QRCodeRule[] = Array.from({ length: 3 }, (_, index) => ({
  id: `rule-${index}`, name: `规则${index}`, folderId: index < 2 ? 'east' : undefined,
  separator: '/', fieldOrder: ['model', 'quantity'], description: '', isActive: index !== 1, created_at: '', updated_at: '',
}));
const onClose = jest.fn();
const onChanged = jest.fn(async () => undefined);
const onSortRules = jest.fn();
let root: TestRenderer.ReactTestRenderer;
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const card = () => root.root.findByType(AppModalCard);
const actions = () => root.root.findByType(AppModalActions);
const list = () => root.root.findByType(FlatList);
const byLabel = (label: string) => root.root.findAllByType(AppPressable).find(node => node.props.accessibilityLabel === label)!;
const press = async (label: string) => {
  const button = byLabel(label);
  expect(button).toBeDefined();
  expect(button.props.disabled).not.toBe(true);
  await act(async () => { button.props.onPress(); });
};
const toolItem = (title: string) => root.root.findAllByType(UiListItem).find(node => node.props.title === title)!;
const tool = async (title: string) => {
  const item = toolItem(title);
  expect(item.props.disabled).not.toBe(true);
  await act(async () => { item.props.onPress(); });
};
const primary = async () => {
  expect(actions().props.primaryDisabled).not.toBe(true);
  await act(async () => { await actions().props.onPrimaryPress(); });
};
const render = async (props: Partial<RuleFolderManagerProps> = {}) => {
  await act(async () => {
    root = TestRenderer.create(<RuleFolderManager visible rules={rules} folders={folders} currentFolderId="east"
      onClose={onClose} onMoveRules={database.moveRulesToFolder} onChanged={onChanged} onSortRules={onSortRules} {...props} />);
  });
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.addRuleFolder).mockResolvedValue('new');
  jest.mocked(database.renameRuleFolder).mockResolvedValue(undefined);
  jest.mocked(database.deleteRuleFolder).mockResolvedValue(undefined);
  jest.mocked(database.moveRulesToFolder).mockResolvedValue(undefined);
  jest.mocked(database.setRuleFoldersDisplayOrder).mockResolvedValue(undefined);
  onChanged.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  Dimensions.set({ window: originalWindow, screen: originalScreen });
});

it('creates and renames a folder in the same modal, keeping short forms content sized', async () => {
  await render();
  await tool('新建文件夹');
  expect(root.root.findAllByType(Modal)).toHaveLength(1);
  expect(card().props).toMatchObject({ title: '新建文件夹', size: 'auto' });
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(actions().props.primaryDisabled).toBe(true);
  await act(async () => { root.root.findByType(TextInput).props.onChangeText(' 东微新标签 '); });
  await primary();
  expect(database.addRuleFolder).toHaveBeenCalledWith('东微新标签');
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(card().props.title).toBe('管理解析规则');
  await press('重命名文件夹东微');
  expect(root.root.findByType(TextInput).props.value).toBe('东微');
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('东微常用'); });
  await primary();
  expect(database.renameRuleFolder).toHaveBeenCalledWith('east', '东微常用');
});

it('keeps the entered name after a duplicate-name failure and supports retry', async () => {
  await render();
  await tool('新建文件夹');
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('东微'); });
  jest.mocked(database.addRuleFolder).mockRejectedValueOnce(new Error('文件夹名称已存在'));
  await primary();
  expect(card().props.title).toBe('新建文件夹');
  expect(root.root.findByType(TextInput).props.value).toBe('东微');
  expect(root.root.findAllByType(Text).some(node => node.props.children === '文件夹名称已存在')).toBe(true);
  expect(onChanged).not.toHaveBeenCalled();
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('东微备用'); });
  await primary();
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it('batch-selects only ungrouped rules and removes them from the available list after moving', async () => {
  await render();
  await tool('批量移动规则');
  expect(list().props.data.map((rule: database.QRCodeRule) => rule.id)).toEqual(['rule-2']);
  expect(byLabel('选择规则规则0')).toBeUndefined();
  await press('全选规则');
  expect(actions().props.primaryLabel).toBe('下一步（1）');
  await primary();
  expect(card().props.title).toBe('选择目标文件夹');
  expect(byLabel('移入未分组')).toBeUndefined();
  expect(actions().props.primaryDisabled).toBe(true);
  await press('移入极海');
  onChanged.mockImplementationOnce(async () => {
    const props = root.root.findByType(RuleFolderManager).props;
    root.update(<RuleFolderManager {...props} rules={rules.map(rule => rule.folderId ? rule : { ...rule, folderId: 'sea' })} />);
  });
  await primary();
  expect(database.moveRulesToFolder).toHaveBeenCalledTimes(1);
  expect(database.moveRulesToFolder).toHaveBeenLastCalledWith(['rule-2'], 'sea');
  expect(toolItem('批量移动规则').props).toMatchObject({ disabled: true, subtitle: '暂无未分组规则' });
});

it('disables a stale batch selection once the rule belongs to a folder', async () => {
  await render();
  await tool('批量移动规则');
  await press('选择规则规则2');
  await primary();
  await press('移入极海');
  const props = root.root.findByType(RuleFolderManager).props;
  await act(async () => {
    root.update(<RuleFolderManager {...props} rules={rules.map(rule => ({ ...rule, folderId: 'east' }))} />);
  });
  expect(actions().props.primaryDisabled).toBe(true);
  await act(async () => { await actions().props.onPrimaryPress(); });
  expect(database.moveRulesToFolder).not.toHaveBeenCalled();
});

it('requires explicit confirmation before dissolving and never deletes rules through the UI', async () => {
  await render();
  await press('解散文件夹东微');
  expect(card().props.title).toBe('解散文件夹');
  expect(database.deleteRuleFolder).not.toHaveBeenCalled();
  await act(async () => { actions().props.onSecondaryPress(); });
  expect(card().props.title).toBe('管理解析规则');
  await press('解散文件夹东微');
  expect(actions().props.primaryVariant).toBe('danger');
  await primary();
  expect(database.deleteRuleFolder).toHaveBeenCalledWith('east');
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it('orders folders explicitly and enters the existing current-scope rule sorting only on request', async () => {
  await render();
  expect(byLabel('上移文件夹东微').props.disabled).toBe(true);
  await press('下移文件夹东微');
  expect(database.setRuleFoldersDisplayOrder).toHaveBeenCalledWith(['sea', 'east']);
  await tool('调整当前规则顺序');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSortRules).toHaveBeenCalledTimes(1);
});

it('blocks duplicate submit and dismissal while saving and waits for the parent refresh', async () => {
  let resolve!: (id: string) => void;
  jest.mocked(database.addRuleFolder).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render();
  await tool('新建文件夹');
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('新的文件夹'); });
  const submit = actions().props.onPrimaryPress;
  await act(async () => { submit(); submit(); });
  expect(database.addRuleFolder).toHaveBeenCalledTimes(1);
  expect(actions().props.primaryDisabled).toBe(true);
  expect(card().props.onClose).toBeUndefined();
  await act(async () => { root.root.findByType(Modal).props.onRequestClose(); });
  expect(onClose).not.toHaveBeenCalled();
  let finishRefresh!: () => void;
  onChanged.mockImplementationOnce(() => new Promise(done => { finishRefresh = done; }));
  await act(async () => { resolve('new'); });
  expect(card().props.title).toBe('新建文件夹');
  await act(async () => { finishRefresh(); });
  expect(card().props.title).toBe('管理解析规则');
});

it('reports a committed mutation with failed refresh without offering to repeat the mutation', async () => {
  await render();
  await tool('新建文件夹');
  await act(async () => { root.root.findByType(TextInput).props.onChangeText('新文件夹'); });
  onChanged.mockRejectedValueOnce(new Error('reload failed'));
  await primary();
  expect(card().props.title).toBe('管理解析规则');
  expect(root.root.findAllByType(Text).some(node => String(node.props.children).includes('操作已保存'))).toBe(true);
});

function assertListOwner() {
  expect(card().props.scrollMode).toBe('body');
  expect(card().props.size).toBe('list');
  expect(list().props).toMatchObject({ scrollEnabled: true, nestedScrollEnabled: true, keyboardShouldPersistTaps: 'handled' });
  expect(StyleSheet.flatten(list().props.style)).toMatchObject({ flex: 1, minHeight: 0 });
  let ancestor = list().parent;
  while (ancestor) { expect(ancestor.type).not.toBe(ScrollView); ancestor = ancestor.parent; }
  expect(root.root.findAllByProps({ testID: 'app-modal-card-scroll' })).toHaveLength(0);
}
it.each([320, 360, 600, 768, 1024])('bounds long lists, retains the last selectable rule, and shrinks short content at %i dp', async width => {
  Dimensions.set({ window: { width, height: 640, fontScale: 1.3, scale: 1 }, screen: originalScreen });
  const manyRules = Array.from({ length: 60 }, (_, index) => ({ ...rules[0], folderId: undefined, id: `many-${index}`, name: `长型号规则${index}` }));
  const manyFolders = Array.from({ length: 30 }, (_, index) => ({ ...folders[0], id: `folder-${index}`, name: `文件夹${index}` }));
  await render({ rules: manyRules, folders: manyFolders });
  assertListOwner();
  await act(async () => {
    list().props.onContentSizeChange(width - 80, 180);
    root.root.findByProps({ testID: 'app-modal-card-header' }).props.onLayout({ nativeEvent: { layout: { height: 60 } } });
    root.root.findByProps({ testID: 'app-modal-card-footer' }).props.onLayout({ nativeEvent: { layout: { height: 60 } } });
  });
  const shortHeight = StyleSheet.flatten(root.root.findByType('ModalSurface' as React.ElementType).props.style).height;
  await act(async () => { list().props.onContentSizeChange(width - 80, 3000); });
  const longStyle = StyleSheet.flatten(root.root.findByType('ModalSurface' as React.ElementType).props.style);
  expect(shortHeight).toBeLessThan(longStyle.height);
  expect(longStyle.height).toBeLessThanOrEqual(longStyle.maxHeight);
  await tool('批量移动规则');
  assertListOwner();
  const last = list().props.renderItem({ item: manyRules[59], index: 59, separators: {} });
  await act(async () => { last.props.onPress(); });
  expect(actions().props.primaryLabel).toBe('下一步（1）');
  await primary();
  assertListOwner();
  const lastFolder = list().props.renderItem({ item: manyFolders[29], index: 29, separators: {} });
  await act(async () => { lastFolder.props.onPress(); });
  await primary();
  expect(database.moveRulesToFolder).toHaveBeenCalledWith(['many-59'], 'folder-29');
  expect(root.root.findAllByType(Modal)).toHaveLength(1);
});

it('resets stale selections and failed input when reopened', async () => {
  await render();
  await tool('批量移动规则');
  await press('全选规则');
  const props = root.root.findByType(RuleFolderManager).props;
  await act(async () => { root.update(<RuleFolderManager {...props} visible={false} />); });
  await act(async () => { root.update(<RuleFolderManager {...props} visible />); });
  expect(card().props.title).toBe('管理解析规则');
  await tool('批量移动规则');
  expect(actions().props.primaryLabel).toBe('下一步（0）');
  expect(actions().props.primaryDisabled).toBe(true);
});
