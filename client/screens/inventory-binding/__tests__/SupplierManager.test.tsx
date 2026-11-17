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
jest.mock('@/components/UiRedesign', () => ({ UiToolbarButton: 'Tool' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showConfirm: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({
  getInventorySuppliers: jest.fn(), addInventorySupplier: jest.fn(), deleteInventorySupplier: jest.fn(),
  getInventoryBindingsPage: jest.fn(), assignInventoryBindingSupplier: jest.fn(),
}));

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
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  jest.mocked(database.assignInventoryBindingSupplier).mockResolvedValue(undefined);
});
afterEach(async () => { if (root) { await act(async () => { root!.unmount(); }); root = undefined; } });

const unassignedBinding: database.InventoryBinding = {
  id: 'unassigned-1', scan_model: 'APM32F003F6P6', inventory_code: 'IC.UNASSIGNED.01',
  version: 'V1', versions: ['V1', 'V2'], supplier: '', description: '保留原描述', created_at: '2026-11-14 10:00:00',
};
function mockUnassignedRows(initial: database.InventoryBinding[] = [unassignedBinding]) {
  let rows = [...initial];
  jest.mocked(database.getInventoryBindingsPage).mockImplementation(async options => {
    const pageSize = options.pageSize ?? 10;
    const filtered = rows.filter(row => !options.keyword ||
      [row.scan_model, row.inventory_code, ...(row.versions ?? [])].some(value => value.includes(options.keyword!)));
    const page = Math.min(options.page ?? 1, Math.max(1, Math.ceil(filtered.length / pageSize)));
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  });
  jest.mocked(database.assignInventoryBindingSupplier).mockImplementation(async id => { rows = rows.filter(row => row.id !== id); });
}
async function openUnassigned() {
  await press('查看未绑定供应商的物料');
  expect(card().props.title).toBe('未绑定供应商的物料');
}

it('opens unassigned materials and returns through every level within the same parent modal', async () => {
  mockUnassignedRows();
  const closeRef = { current: null as (() => void) | null };
  await act(async () => {
    root = TestRenderer.create(<SupplierManager embedded closeRef={closeRef} mode="select" value="原表单供应商"
      onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} />);
  });
  await pressFooter('onSecondaryPress');
  await type('供应商名称', '尚未添加的草稿');
  await openUnassigned();
  expect(database.getInventoryBindingsPage).toHaveBeenLastCalledWith(expect.objectContaining({ supplierStatus: 'unassigned', page: 1 }));
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  expect(card().props.title).toBe('分配供应商');
  expect(root!.root.findAllByType(Modal)).toHaveLength(0);
  await act(async () => { closeRef.current?.(); });
  expect(card().props.title).toBe('未绑定供应商的物料');
  await act(async () => { closeRef.current?.(); });
  expect(card().props.title).toBe('维护供应商');
  expect(input('供应商名称').props.value).toBe('尚未添加的草稿');
  await act(async () => { closeRef.current?.(); });
  expect(card().props.title).toBe('选择供应商');
  expect(onClose).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(database.assignInventoryBindingSupplier).not.toHaveBeenCalled();
  await act(async () => { closeRef.current?.(); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('assigns only after confirmation, refreshes the unassigned list and notifies separately from form selection', async () => {
  mockUnassignedRows();
  const onAssigned = jest.fn();
  await act(async () => {
    root = TestRenderer.create(<SupplierManager mode="manage" value="原表单供应商"
      onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} onAssigned={onAssigned} />);
  });
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  expect(footer().props.primaryLabel).toBe('保存分配');
  expect(footer().props.primaryDisabled).toBe(true);
  await press(`分配给供应商 ${suppliers[1].name}`);
  expect(database.assignInventoryBindingSupplier).not.toHaveBeenCalled();
  expect(onAssigned).not.toHaveBeenCalled();
  await pressFooter('onPrimaryPress');
  expect(database.assignInventoryBindingSupplier).toHaveBeenCalledWith(unassignedBinding.id, suppliers[1].id);
  expect(onAssigned).toHaveBeenCalledWith(unassignedBinding.id, suppliers[1].name);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(card().props.title).toBe('未绑定供应商的物料');
  expect(button(`分配供应商 ${unassignedBinding.inventory_code}`)).toBeUndefined();
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(2);
  await pressFooter('onPrimaryPress');
  expect(card().props.title).toBe('维护供应商');
});

it('lets an intentionally unassigned material remain unchanged when backing out of supplier choice', async () => {
  mockUnassignedRows();
  await mount('manage');
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  await press(`分配给供应商 ${suppliers[0].name}`);
  expect(footer().props.secondaryLabel).toBe('返回物料');
  await pressFooter('onSecondaryPress');
  expect(card().props.title).toBe('未绑定供应商的物料');
  expect(button(`分配供应商 ${unassignedBinding.inventory_code}`)).toBeDefined();
  expect(database.assignInventoryBindingSupplier).not.toHaveBeenCalled();
  await act(async () => { root!.root.findByType(Modal).props.onRequestClose(); });
  expect(card().props.title).toBe('维护供应商');
  expect(onClose).not.toHaveBeenCalled();
});

it('prevents repeated assignment and every close route while the save is pending', async () => {
  mockUnassignedRows();
  const pending = deferred<void>();
  jest.mocked(database.assignInventoryBindingSupplier).mockReturnValueOnce(pending.promise);
  await mount('manage');
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  await press(`分配给供应商 ${suppliers[0].name}`);
  const save = footer().props.onPrimaryPress;
  await act(async () => { save(); save(); });
  expect(database.assignInventoryBindingSupplier).toHaveBeenCalledTimes(1);
  expect(card().props.onClose).toBeUndefined();
  expect(footer().props.primaryDisabled).toBe(true);
  expect(footer().props.secondaryDisabled).toBe(true);
  await act(async () => { root!.root.findByType(Modal).props.onRequestClose(); footer().props.onSecondaryPress?.(); });
  expect(card().props.title).toBe('分配供应商');
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); });
  expect(card().props.title).toBe('未绑定供应商的物料');
});

it('keeps the failed assignment and chosen supplier available for retry instead of silently dropping the material', async () => {
  mockUnassignedRows();
  const onAssigned = jest.fn();
  jest.mocked(database.assignInventoryBindingSupplier).mockRejectedValueOnce(new Error('该物料已被另一操作分配供应商'));
  await act(async () => {
    root = TestRenderer.create(<SupplierManager mode="manage" value="" onSelect={onSelect}
      onDeleted={onDeleted} onClose={onClose} onAssigned={onAssigned} />);
  });
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  await press(`分配给供应商 ${suppliers[0].name}`);
  await pressFooter('onPrimaryPress');
  expect(card().props.title).toBe('分配供应商');
  expect(onAssigned).not.toHaveBeenCalled();
  expect(footer().props.primaryDisabled).toBe(false);
  expect(root!.root.findAllByType(Text).some(node => String(node.props.children).includes('该物料已被另一操作分配供应商'))).toBe(true);
  await pressFooter('onPrimaryPress');
  expect(database.assignInventoryBindingSupplier).toHaveBeenCalledTimes(2);
  expect(onAssigned).toHaveBeenCalledTimes(1);
});

it('refreshes the material list after a concurrent-assignment rejection instead of offering the stale row again', async () => {
  mockUnassignedRows();
  const onAssigned = jest.fn();
  jest.mocked(database.assignInventoryBindingSupplier).mockImplementationOnce(async () => {
    // The database now excludes this row because another operation assigned it.
    jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    throw new Error('该物料已被另一操作分配供应商');
  });
  await act(async () => {
    root = TestRenderer.create(<SupplierManager mode="manage" value="" onSelect={onSelect}
      onDeleted={onDeleted} onClose={onClose} onAssigned={onAssigned} />);
  });
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  await press(`分配给供应商 ${suppliers[0].name}`);
  await pressFooter('onPrimaryPress');
  expect(card().props.title).toBe('分配供应商');
  const readsBeforeBack = jest.mocked(database.getInventoryBindingsPage).mock.calls.length;
  await pressFooter('onSecondaryPress');
  expect(database.getInventoryBindingsPage).toHaveBeenCalledTimes(readsBeforeBack + 1);
  expect(database.getInventoryBindingsPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: '', supplierStatus: 'unassigned' });
  expect(card().props.title).toBe('未绑定供应商的物料');
  expect(button(`分配供应商 ${unassignedBinding.inventory_code}`)).toBeUndefined();
  expect(onAssigned).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('does not read supplier counts or unassigned materials while the manager is hidden', async () => {
  await act(async () => {
    root = TestRenderer.create(<SupplierManager visible={false} mode="manage" value=""
      onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} />);
  });
  expect(database.getInventorySuppliers).not.toHaveBeenCalled();
  expect(database.getInventoryBindingsPage).not.toHaveBeenCalled();
  await act(async () => {
    root!.update(<SupplierManager visible mode="manage" value=""
      onSelect={onSelect} onDeleted={onDeleted} onClose={onClose} />);
  });
  expect(database.getInventorySuppliers).toHaveBeenCalledTimes(1);
  expect(database.getInventoryBindingsPage).toHaveBeenCalledWith(expect.objectContaining({ supplierStatus: 'unassigned' }));
});

it('ignores a successful assignment that finishes after the manager is hidden', async () => {
  mockUnassignedRows();
  const pending = deferred<void>();
  jest.mocked(database.assignInventoryBindingSupplier).mockReturnValueOnce(pending.promise);
  const onAssigned = jest.fn();
  const props = { mode: 'manage' as const, value: '', onSelect, onDeleted, onClose, onAssigned };
  await act(async () => { root = TestRenderer.create(<SupplierManager {...props} visible />); });
  await openUnassigned();
  await press(`分配供应商 ${unassignedBinding.inventory_code}`);
  await press(`分配给供应商 ${suppliers[0].name}`);
  await pressFooter('onPrimaryPress');
  await act(async () => { root!.update(<SupplierManager {...props} visible={false} />); });
  await act(async () => { pending.resolve(); });
  expect(onAssigned).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('searches extra versions and paginates unassigned materials without changing their supplier', async () => {
  mockUnassignedRows(Array.from({ length: 11 }, (_, index) => ({
    ...unassignedBinding, id: `binding-${index}`, inventory_code: `IC.CODE.${index}`, scan_model: `MODEL-${index}`,
  })));
  await mount('manage');
  await openUnassigned();
  expect(button('分配供应商 IC.CODE.0')).toBeDefined();
  expect(button('分配供应商 IC.CODE.10')).toBeUndefined();
  await pressTool('下一页');
  expect(database.getInventoryBindingsPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, supplierStatus: 'unassigned' }));
  expect(button('分配供应商 IC.CODE.10')).toBeDefined();
  await type('搜索未绑定供应商的物料', ' V2 ');
  await pressTool('查询');
  expect(database.getInventoryBindingsPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, keyword: 'V2', supplierStatus: 'unassigned' }));
  expect(button('分配供应商 IC.CODE.0')).toBeDefined();
  expect(database.assignInventoryBindingSupplier).not.toHaveBeenCalled();
});

it('does not restore a late old material list after leaving and reopening that level', async () => {
  const oldList = deferred<database.InventoryBindingPageResult>();
  const current = { ...unassignedBinding, id: 'current', inventory_code: 'IC.CURRENT', scan_model: 'CURRENT' };
  let materialLoads = 0;
  jest.mocked(database.getInventoryBindingsPage).mockImplementation(options => {
    const result = { items: [current], total: 1, page: 1, pageSize: options.pageSize ?? 10 };
    return options.pageSize !== 1 && materialLoads++ === 0 ? oldList.promise : Promise.resolve(result);
  });
  await mount('manage');
  await openUnassigned();
  await act(async () => { card().props.onClose(); });
  expect(card().props.title).toBe('维护供应商');
  await openUnassigned();
  expect(button('分配供应商 IC.CURRENT')).toBeDefined();
  await act(async () => { oldList.resolve({ items: [unassignedBinding], total: 1, page: 1, pageSize: 10 }); });
  expect(button('分配供应商 IC.CURRENT')).toBeDefined();
  expect(button(`分配供应商 ${unassignedBinding.inventory_code}`)).toBeUndefined();
});

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
