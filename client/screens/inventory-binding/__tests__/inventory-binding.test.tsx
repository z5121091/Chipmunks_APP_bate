import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import * as XLSX from 'xlsx';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import InventoryBindingScreen from '../index';
import { AppFormField } from '@/components/AppFormField';
import { AppModalActions } from '@/components/AppModalActions';
import { AnimatedButton } from '@/components/AnimatedButton';
import { UiToolbarButton } from '@/components/UiRedesign';
import { SupplierManager } from '../SupplierManager';
import { useCustomAlert } from '@/components/CustomAlert';
import * as database from '@/utils/database';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('../SupplierManager', () => ({ SupplierManager: 'SupplierPanel' }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AnimatedButton', () => ({ AnimatedButton: 'Button' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalCard', () => ({
  AppModalCard: (props: { children?: import('react').ReactNode; footer?: import('react').ReactNode }) =>
    require('react').createElement('Card', props, props.children, props.footer),
}));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'Field' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Scroll' }));
jest.mock('@/components/UiRedesign', () => ({ UiToolbarButton: 'Tool', UiInput: 'Input' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/utils/feedback', () => ({ feedbackClear: jest.fn() }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showConfirm: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(), cacheDirectory: 'cache/',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: jest.fn() }));
jest.mock('@/utils/database', () => ({
  getAllInventoryBindings: jest.fn(), getInventoryBindingsPage: jest.fn(),
  addInventoryBinding: jest.fn(), updateInventoryBinding: jest.fn(),
  deleteInventoryBinding: jest.fn(), importInventoryBindings: jest.fn(),
}));

const binding: database.InventoryBinding = {
  id: 'binding-1', scan_model: 'Pai 122M31', inventory_code: 'IC.00000255.00',
  supplier: '示例供应商', version: 'A1', description: '示例描述', created_at: '2026-09-16 10:00:00',
};
const expectedBinding = {
  scan_model: binding.scan_model, inventory_code: binding.inventory_code,
  supplier: binding.supplier, version: binding.version, description: binding.description,
};
const fieldOrder = ['扫描型号', '存货编码', '供应商', '版本号', '描述'];
let root: TestRenderer.ReactTestRenderer;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.getAllInventoryBindings).mockResolvedValue([binding]);
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValue({ items: [binding], total: 1, page: 1, pageSize: 10 });
  jest.mocked(database.importInventoryBindings).mockResolvedValue({ inserted: 1, updated: 0, unchanged: 0, conflicts: [] });
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'test.xlsx', name: 'test.xlsx' }] });
  await act(async () => { root = TestRenderer.create(<InventoryBindingScreen />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

async function pressTool(label: string) {
  await act(async () => {
    root.root.findAllByType(UiToolbarButton).find(button => button.props.label === label)!.props.onPress();
  });
}
async function importRows(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Bindings');
  jest.mocked(FileSystem.readAsStringAsync).mockResolvedValue(XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }));
  await pressTool('数据工具');
  await pressTool('从 Excel 导入');
}
function exportedRows(): unknown[][] {
  const data = jest.mocked(FileSystem.writeAsStringAsync).mock.calls.at(-1)![1];
  const workbook = XLSX.read(data, { type: 'base64' });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
}

it.each(['新增', '编辑'])('keeps %s form fields in the requested order with correct values', async (mode) => {
  if (mode === '新增') await pressTool('新增');
  else {
    for (const label of [binding.scan_model, '编辑']) {
      await act(async () => {
        root.root.findAllByType(TouchableOpacity).find(button =>
          button.findAllByType(Text).some(text => text.props.children === label))!.props.onPress();
      });
    }
  }
  const fields = root.root.findAllByType(AppFormField);
  expect(fields.map(field => field.props.label)).toEqual(fieldOrder);
  expect(fields.map(field => Boolean(field.props.required))).toEqual([true, true, false, false, false]);
  expect(fields.map(field => field.props.label === '供应商'
    ? field.findByType(TouchableOpacity).props.accessibilityValue.text.replace(/^未设置$/, '')
    : field.findByType(TextInput).props.value)).toEqual(mode === '新增'
    ? ['', '', '', '', '']
    : [binding.scan_model, binding.inventory_code, binding.supplier, binding.version, binding.description]);
});

async function fillBinding(model = 'NEW-MODEL', code = 'NEW-CODE') {
  for (const [label, value] of [['扫描型号', model], ['存货编码', code]]) {
    await act(async () => {
      root.root.findAllByType(AppFormField).find(field => field.props.label === label)!
        .findByType(TextInput).props.onChangeText(value);
    });
  }
}

async function openSupplierSelection() {
  await act(async () => {
    root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === '选择物料供应商')!.props.onPress();
  });
}

it('opens supplier maintenance from the toolbar without a material form', async () => {
  expect(root.root.findAllByType(SupplierManager)).toHaveLength(0);
  await pressTool('维护供应商');
  expect(root.root.findByType(SupplierManager).props.mode).toBe('manage');
  expect(root.root.findAllByType(AppFormField)).toHaveLength(0);
  await act(async () => { root.root.findByType(SupplierManager).props.onClose(); });
  expect(root.root.findAllByType(SupplierManager)).toHaveLength(0);
});

it('keeps typed model and code when selecting or cancelling a supplier and saves the selected name', async () => {
  await pressTool('新增');
  await fillBinding();
  await openSupplierSelection();
  expect(root.root.findByType(SupplierManager).props.mode).toBe('select');
  await act(async () => { root.root.findByType(SupplierManager).props.onClose(); });
  expect(root.root.findAllByType(AppFormField)[0].findByType(TextInput).props.value).toBe('NEW-MODEL');
  await openSupplierSelection();
  await act(async () => { root.root.findByType(SupplierManager).props.onSelect('新供应商'); });
  await act(async () => { root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.addInventoryBinding).toHaveBeenCalledWith({
    scan_model: 'NEW-MODEL', inventory_code: 'NEW-CODE', version: '', supplier: '新供应商', description: '',
  });
});

it('allows saving without a supplier', async () => {
  await pressTool('新增');
  await fillBinding();
  await act(async () => { root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.addInventoryBinding).toHaveBeenCalledWith(expect.objectContaining({ supplier: '' }));
});

it('shows the actual binding validation failure and keeps the form for correction', async () => {
  jest.mocked(database.addInventoryBinding).mockRejectedValueOnce(new Error('该型号及版本已关联销售退货，不能更改存货编码'));
  await pressTool('新增');
  await fillBinding();
  await act(async () => { root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(useCustomAlert().showError).toHaveBeenCalledWith('该型号及版本已关联销售退货，不能更改存货编码');
  expect(root.root.findAllByType(AppFormField)).toHaveLength(5);
});

it('loads only once when changing binding pages', async () => {
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValueOnce({ items: [binding], total: 25, page: 1, pageSize: 10 });
  await act(async () => { root.unmount(); root = TestRenderer.create(<InventoryBindingScreen />); });
  jest.mocked(database.getInventoryBindingsPage).mockClear();
  jest.mocked(database.getInventoryBindingsPage).mockResolvedValueOnce({ items: [binding], total: 25, page: 2, pageSize: 10 });
  await act(async () => { root.root.findAllByType(AnimatedButton)[1].props.onPress(); });
  expect(database.getInventoryBindingsPage).toHaveBeenCalledTimes(1);
  expect(database.getInventoryBindingsPage).toHaveBeenCalledWith({ page: 2, pageSize: 10, keyword: '' });
});

it('exports columns and values in the new order and can import the result unchanged', async () => {
  await pressTool('数据工具');
  await pressTool('导出全部绑定');
  const rows = exportedRows();
  expect(rows[0]).toEqual([...fieldOrder, '创建时间']);
  expect(rows[1].slice(0, 5)).toEqual([binding.scan_model, binding.inventory_code, binding.supplier, binding.version, binding.description]);
  await importRows(rows);
  expect(database.importInventoryBindings).toHaveBeenCalledWith([expectedBinding]);
});

it('exports the reordered template without a hint row that could be imported as data', async () => {
  await pressTool('数据工具');
  await pressTool('下载导入模板');
  const rows = exportedRows();
  expect(rows).toEqual([
    ['扫描型号（必填）', '存货编码（必填）', '供应商（可选）', '版本号（可选）', '描述（可选）'],
    ['示例型号ABC', 'INV001', '供应商A', 'A1', '这是示例描述'],
  ]);
  await importRows(rows);
  expect(database.importInventoryBindings).toHaveBeenCalledWith([
    { scan_model: '示例型号ABC', inventory_code: 'INV001', supplier: '供应商A', version: 'A1', description: '这是示例描述' },
  ]);
});

it.each(['版本号', '版本号（可选）'])('imports the old column order with %s without mixing supplier and version', async (versionHeader) => {
  await importRows([
    ['型号', versionHeader, '存货编码', '供应商', '描述（可选）'],
    [binding.scan_model, binding.version, binding.inventory_code, binding.supplier, binding.description],
  ]);
  expect(database.importInventoryBindings).toHaveBeenCalledWith([expectedBinding]);
});

it('accepts an empty version and reordered columns while preserving case', async () => {
  await importRows([
    ['供应商', '扫描型号', '版本号', '描述', '存货编码'],
    [binding.supplier, binding.scan_model, '', binding.description, binding.inventory_code],
  ]);
  expect(database.importInventoryBindings).toHaveBeenCalledWith([{ ...expectedBinding, version: undefined }]);
});

it.each([
  ['扫描型号', '供应商'],
  ['扫描型号', '存货编码', '型号'],
  ['扫描型号', '存货编码', '供应商', '供应商（可选）'],
])('rejects missing or ambiguous column headers: %j', async (...headers) => {
  await importRows([headers, ['Model', 'IC.01', 'Supplier', 'Supplier']]);
  expect(database.importInventoryBindings).not.toHaveBeenCalled();
  expect(useCustomAlert().showError).toHaveBeenCalled();
});
