import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text, TextInput, TouchableOpacity } from 'react-native';
import { SupplierManager } from '../SupplierManager';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { useCustomAlert } from '@/components/CustomAlert';
import { UiToolbarButton } from '@/components/UiRedesign';
import * as database from '@/utils/database';

jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = require('react') as typeof import('react');
  const MockScrollView = React.forwardRef(function MockScrollView(props: import('react-native').ScrollViewProps, _ref) {
    return React.createElement('MockScrollView', props, props.children);
  });
  return { __esModule: true, default: Object.assign(MockScrollView, { Context: React.createContext(null) }) };
});
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: 'Card' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'Field' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormFlatList: require('react-native').FlatList }));
jest.mock('@/components/UiRedesign', () => ({ UiToolbarButton: 'Tool' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showConfirm: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ getInventorySuppliers: jest.fn(), addInventorySupplier: jest.fn(), deleteInventorySupplier: jest.fn() }));

const suppliers: database.InventorySupplier[] = [
  { id: 'supplier-1', name: '极海科技', binding_count: 3, created_at: '2026-10-16 10:00:00' },
  { id: 'supplier-2', name: 'BOYA Microelectronics', binding_count: 0, created_at: '2026-10-16 10:00:00' },
];

it('shares the parent modal and routes Back through the supplier maintenance level', async () => {
  const closeRef = { current: null as (() => void) | null };
  await act(async () => {
    root = TestRenderer.create(<SupplierManager embedded closeRef={closeRef} mode="select" value=""
      onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} />);
  });
  expect(root!.root.findAllByType(Modal)).toHaveLength(0);
  await pressFooter('onSecondaryPress');
  expect(card().props.title).toBe('维护供应商');
  await act(async () => { closeRef.current?.(); });
  expect(card().props.title).toBe('选择供应商');
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { closeRef.current?.(); });
  expect(onClose).toHaveBeenCalledTimes(1);
});
const onSelect = jest.fn();
const onDeleted = jest.fn();
const onClose = jest.fn();
let root: TestRenderer.ReactTestRenderer | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
async function mount(mode: 'manage' | 'select' = 'select', value = '') {
  await act(async () => {
    root = TestRenderer.create(<SupplierManager mode={mode} value={value} onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} />);
  });
}
const card = () => root!.root.findByType(AppModalCard);
const footer = () => card().props.footer as React.ReactElement<React.ComponentProps<typeof AppModalActions>>;
const input = (label: string) => root!.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === label)!;
const button = (label: string) => root!.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === label)!;
const tool = (label: string) => root!.root.findAllByType(UiToolbarButton).find(item => item.props.label === label)!;
const renderedOptions = () => root!.root.findAllByType(TouchableOpacity).filter(item => String(item.props.accessibilityLabel).startsWith('选择供应商 '));
async function type(label: string, value: string) { await act(async () => { input(label).props.onChangeText(value); }); }
async function press(label: string) { await act(async () => { button(label).props.onPress(); }); }
async function pressTool(label: string) { await act(async () => { tool(label).props.onPress(); }); }
async function pressFooter(which: 'onPrimaryPress' | 'onSecondaryPress') { await act(async () => { footer().props[which]?.(); }); }
async function confirmDelete() { await act(async () => { await jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2](); }); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.getInventorySuppliers).mockResolvedValue(suppliers);
  jest.mocked(database.addInventorySupplier).mockResolvedValue('new-supplier');
  jest.mocked(database.deleteInventorySupplier).mockResolvedValue(undefined);
});
afterEach(async () => { if (root) { await act(async () => { root!.unmount(); }); root = undefined; } });

it('loads only when mounted and does not reload for search or switching between select and manage', async () => {
  expect(database.getInventorySuppliers).not.toHaveBeenCalled();
  await mount();
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(1);
  expect(card().props.title).toBe('选择供应商');
  expect(renderedOptions()).toHaveLength(2);
  await type('搜索供应商', '极海');
  await pressFooter('onSecondaryPress');
  expect(card().props.title).toBe('维护供应商');
  expect(input('搜索供应商').props.value).toBe('');
  expect(footer().props.primaryLabel).toBe('返回选择');
  await pressFooter('onPrimaryPress');
  expect(card().props.title).toBe('选择供应商');
  expect(renderedOptions()).toHaveLength(2);
  expect(onClose).not.toHaveBeenCalled();
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(1);
});

it('searches without case or surrounding-space sensitivity and selects the stored full supplier name', async () => {
  await mount('select', suppliers[0].name);
  await type('搜索供应商', '  boya ');
  expect(renderedOptions().map(item => item.props.accessibilityLabel)).toEqual(['选择供应商 BOYA Microelectronics']);
  await press('选择供应商 BOYA Microelectronics');
  expect(onSelect).toHaveBeenCalledWith(suppliers[1].name, suppliers[1].id);
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(1);
  expect(database.addInventorySupplier).not.toHaveBeenCalled();
});

it('allows an empty supplier and closes select or standalone management with the footer', async () => {
  await mount('select', suppliers[0].name);
  await press('不设置供应商');
  expect(onSelect).toHaveBeenCalledWith('', undefined);
  await pressFooter('onPrimaryPress');
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => { root!.unmount(); root = undefined; });
  await mount('manage');
  expect(footer().props.primaryLabel).toBe('完成');
  expect(footer().props.secondaryLabel).toBeUndefined();
  await pressFooter('onPrimaryPress');
  expect(onClose).toHaveBeenCalledTimes(2);
});

it.each(['hardware', 'header'] as const)('returns from nested management to selection before closing with %s back', async closeRoute => {
  await mount('select', suppliers[0].name);
  await pressFooter('onSecondaryPress');
  await type('供应商名称', '尚未添加的供应商');
  const closeCurrent = () => closeRoute === 'hardware'
    ? root!.root.findByType(Modal).props.onRequestClose()
    : card().props.onClose();
  await act(async () => { closeCurrent(); });
  expect(card().props.title).toBe('选择供应商');
  expect(onClose).not.toHaveBeenCalled();
  expect(database.addInventorySupplier).not.toHaveBeenCalled();
  // Going back one layer must preserve a draft, not silently save or discard it.
  await pressFooter('onSecondaryPress');
  expect(input('供应商名称').props.value).toBe('尚未添加的供应商');
  await act(async () => { closeCurrent(); });
  await act(async () => { closeCurrent(); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(['hardware', 'header'] as const)('closes standalone management directly with %s back', async closeRoute => {
  await mount('manage');
  await act(async () => {
    if (closeRoute === 'hardware') root!.root.findByType(Modal).props.onRequestClose();
    else card().props.onClose();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(card().props.title).toBe('维护供应商');
});

it('keeps nested management open during a save, then returns to selection with its newly saved supplier', async () => {
  const pending = deferred<string>();
  jest.mocked(database.addInventorySupplier).mockReturnValueOnce(pending.promise);
  await mount();
  await pressFooter('onSecondaryPress');
  await type('供应商名称', '新供应商');
  await pressTool('添加');
  await act(async () => {
    root!.root.findByType(Modal).props.onRequestClose();
    footer().props.onPrimaryPress();
  });
  expect(card().props.title).toBe('维护供应商');
  expect(onClose).not.toHaveBeenCalled();
  jest.mocked(database.getInventorySuppliers).mockResolvedValueOnce([...suppliers, {
    id: 'supplier-3', name: '新供应商', binding_count: 0, created_at: '',
  }]);
  await act(async () => { pending.resolve('supplier-3'); });
  await act(async () => { root!.root.findByType(Modal).props.onRequestClose(); });
  expect(card().props.title).toBe('选择供应商');
  await press('选择供应商 新供应商');
  expect(onSelect).toHaveBeenCalledWith('新供应商', 'supplier-3');
  expect(onClose).not.toHaveBeenCalled();
});

it('shows loading and prevents mutation or selection until the supplier list has loaded', async () => {
  const pending = deferred<database.InventorySupplier[]>();
  jest.mocked(database.getInventorySuppliers).mockReturnValueOnce(pending.promise);
  await mount('manage');
  expect(root!.root.findByType(AppEmptyState).props).toMatchObject({ loading: true, title: '正在读取供应商' });
  expect(tool('添加').props.disabled).toBe(true);
  await type('供应商名称', '新供应商');
  await pressTool('添加');
  expect(database.addInventorySupplier).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(suppliers); });
  expect(tool('添加').props.disabled).toBe(false);
  expect(renderedOptions()).toHaveLength(2);
});

it('rejects blank and normalized duplicate names before saving', async () => {
  await mount('manage');
  await type('供应商名称', '   ');
  await pressTool('添加');
  expect(useCustomAlert().showWarning).toHaveBeenLastCalledWith('请输入供应商名称');
  await type('供应商名称', ' boya microelectronics ');
  await pressTool('添加');
  expect(useCustomAlert().showWarning).toHaveBeenLastCalledWith('该供应商已在列表中，无需重复添加');
  expect(database.addInventorySupplier).not.toHaveBeenCalled();
});

it('adds a trimmed name, reloads suppliers, and clears only the entry and search fields', async () => {
  await mount('manage');
  await type('搜索供应商', '极海');
  await type('供应商名称', '  新供应商  ');
  jest.mocked(database.getInventorySuppliers).mockResolvedValueOnce([...suppliers, { id: 'supplier-3', name: '新供应商', binding_count: 0, created_at: '' }]);
  await pressTool('添加');
  expect(database.addInventorySupplier).toHaveBeenCalledWith('新供应商');
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(2);
  expect(input('供应商名称').props.value).toBe('');
  expect(input('搜索供应商').props.value).toBe('');
  expect(renderedOptions()).toHaveLength(3);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('prevents repeated save and all close routes while adding', async () => {
  const pending = deferred<string>();
  jest.mocked(database.addInventorySupplier).mockReturnValueOnce(pending.promise);
  await mount('manage');
  await type('供应商名称', '新供应商');
  const submit = tool('添加').props.onPress;
  const close = root!.root.findByType(Modal).props.onRequestClose;
  await act(async () => { submit(); submit(); });
  expect(database.addInventorySupplier).toHaveBeenCalledTimes(1);
  expect(tool('添加').props.disabled).toBe(true);
  expect(input('供应商名称').props.editable).toBe(false);
  expect(card().props.onClose).toBeUndefined();
  expect(footer().props.primaryDisabled).toBe(true);
  await act(async () => { close(); footer().props.onPrimaryPress(); input('供应商名称').props.onSubmitEditing(); });
  expect(onClose).not.toHaveBeenCalled();
  expect(database.addInventorySupplier).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve('supplier-3'); });
  expect(tool('添加').props.disabled).toBe(false);
  await act(async () => { root!.root.findByType(Modal).props.onRequestClose(); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('explains why a supplier in use cannot be deleted', async () => {
  await mount('manage');
  await press('删除供应商 极海科技');
  expect(useCustomAlert().showWarning).toHaveBeenCalledWith('「极海科技」正在被 3 条物料、0 条解析规则使用，不能删除。请先修改相应关联。');
  expect(useCustomAlert().showConfirm).not.toHaveBeenCalled();
  expect(database.deleteInventorySupplier).not.toHaveBeenCalled();
});

it('requires confirmation for an unused supplier, then deletes and notifies the parent', async () => {
  await mount('manage');
  await press('删除供应商 BOYA Microelectronics');
  expect(useCustomAlert().showConfirm).toHaveBeenCalledWith('删除供应商', '确定从供应商列表删除「BOYA Microelectronics」吗？', expect.any(Function), true);
  expect(database.deleteInventorySupplier).not.toHaveBeenCalled();
  jest.mocked(database.getInventorySuppliers).mockResolvedValueOnce([suppliers[0]]);
  await confirmDelete();
  expect(database.deleteInventorySupplier).toHaveBeenCalledWith('supplier-2');
  expect(onDeleted).toHaveBeenCalledWith(suppliers[1].name);
  expect(renderedOptions()).toHaveLength(1);
});

it('counts rule references and prevents deleting a supplier used only by parsing rules', async () => {
  jest.mocked(database.getInventorySuppliers).mockResolvedValueOnce([
    { ...suppliers[1], rule_count: 2 },
  ]);
  await mount('manage');
  expect(root!.root.findAllByType(Text).some(item => item.props.children === '0 条物料 · 2 条解析规则使用中')).toBe(true);
  await press('删除供应商 BOYA Microelectronics');
  expect(useCustomAlert().showWarning).toHaveBeenCalledWith('「BOYA Microelectronics」正在被 0 条物料、2 条解析规则使用，不能删除。请先修改相应关联。');
  expect(database.deleteInventorySupplier).not.toHaveBeenCalled();
  expect(useCustomAlert().showConfirm).not.toHaveBeenCalled();
});

it('prevents duplicate confirmation and closing while deleting', async () => {
  const pending = deferred<void>();
  jest.mocked(database.deleteInventorySupplier).mockReturnValueOnce(pending.promise);
  await mount('manage');
  await press('删除供应商 BOYA Microelectronics');
  const confirm = jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2];
  await act(async () => { void confirm(); void confirm(); root!.root.findByType(Modal).props.onRequestClose(); });
  expect(database.deleteInventorySupplier).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); });
  expect(onDeleted).toHaveBeenCalledTimes(1);
});

it('reports the actual add error and allows a retry without losing the entered name', async () => {
  await mount('manage');
  await type('供应商名称', '新供应商');
  jest.mocked(database.addInventorySupplier).mockRejectedValueOnce(new Error('供应商名称已被另一项操作添加'));
  await pressTool('添加');
  expect(useCustomAlert().showError).toHaveBeenCalledWith('供应商名称已被另一项操作添加');
  expect(input('供应商名称').props.value).toBe('新供应商');
  expect(tool('添加').props.disabled).toBe(false);
  await pressTool('添加');
  expect(database.addInventorySupplier).toHaveBeenCalledTimes(2);
});

it('keeps the supplier visible and does not notify a deletion after a database failure', async () => {
  await mount('manage');
  jest.mocked(database.deleteInventorySupplier).mockRejectedValueOnce(new Error('该供应商正在被物料使用'));
  await press('删除供应商 BOYA Microelectronics');
  await confirmDelete();
  expect(useCustomAlert().showError).toHaveBeenCalledWith('该供应商正在被物料使用');
  expect(onDeleted).not.toHaveBeenCalled();
  expect(renderedOptions()).toHaveLength(2);
  expect(footer().props.primaryDisabled).toBe(false);
});

it('shows a recoverable load error, disables adding, and reloads explicitly', async () => {
  jest.mocked(database.getInventorySuppliers).mockRejectedValueOnce(new Error('offline'));
  await mount('manage');
  expect(root!.root.findByType(AppEmptyState).props).toMatchObject({ loading: false, title: '供应商加载失败' });
  expect(tool('添加').props.disabled).toBe(true);
  await type('供应商名称', '新供应商');
  await pressTool('添加');
  expect(database.addInventorySupplier).not.toHaveBeenCalled();
  await pressTool('重新加载供应商');
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(2);
  expect(renderedOptions()).toHaveLength(2);
  expect(tool('添加').props.disabled).toBe(false);
});

it('does not offer empty selection after load failure, and recovers it after retry', async () => {
  jest.mocked(database.getInventorySuppliers).mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(button('不设置供应商')).toBeUndefined();
  expect(renderedOptions()).toHaveLength(0);
  await pressTool('重新加载供应商');
  await press('不设置供应商');
  expect(onSelect).toHaveBeenCalledWith('', undefined);
});

it('ignores a late load result after unmount and gives the next mount its own data', async () => {
  const pending = deferred<database.InventorySupplier[]>();
  jest.mocked(database.getInventorySuppliers).mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { root!.unmount(); root = undefined; });
  jest.mocked(database.getInventorySuppliers).mockResolvedValueOnce([suppliers[1]]);
  await mount();
  await act(async () => { pending.resolve([suppliers[0]]); });
  expect(renderedOptions().map(item => item.props.accessibilityLabel)).toEqual(['选择供应商 BOYA Microelectronics']);
  expect(useCustomAlert().showError).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('does not reload or notify after a pending deletion finishes on an unmounted manager', async () => {
  const pending = deferred<void>();
  jest.mocked(database.deleteInventorySupplier).mockReturnValueOnce(pending.promise);
  await mount('manage');
  await press('删除供应商 BOYA Microelectronics');
  const confirm = jest.mocked(useCustomAlert().showConfirm).mock.calls.at(-1)![2];
  await act(async () => { void confirm(); });
  await act(async () => { root!.unmount(); root = undefined; });
  await act(async () => { pending.resolve(); });
  expect(onDeleted).not.toHaveBeenCalled();
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(1);
  expect(useCustomAlert().showError).not.toHaveBeenCalled();
});
