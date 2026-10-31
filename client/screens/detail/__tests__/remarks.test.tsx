import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import DetailScreen from '../index';
import { getMaterial, getQueryOrder, getMaterialRemarks, updateSalesReturnNotes, type MaterialRecord, type MaterialRemarkDTO } from '@/utils/database';
import { AppModalCard } from '@/components/AppModalCard';

let mockRecordId = 'material-1';

jest.mock('@/hooks/useSafeRouter', () => ({
  useSafeRouter: () => ({ back: jest.fn() }),
  useSafeSearchParams: () => ({ id: mockRecordId }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/hooks/useTheme', () => {
  const theme = {};
  return { useTheme: () => ({ theme, isDark: false }) };
});
jest.mock('../styles', () => ({ createStyles: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppFormField', () => ({ AppFormField: 'Field' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/AppModalCard', () => ({ AppModalCard: 'Card' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Form' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/CustomAlert', () => ({
  useCustomAlert: () => ({ showSuccess: jest.fn(), showError: jest.fn(), AlertComponent: null }),
}));
jest.mock('@/utils/database', () => ({
  getMaterial: jest.fn(), getQueryOrder: jest.fn(), getMaterialRemarks: jest.fn(), updateSalesReturnNotes: jest.fn(),
  getRuleById: jest.fn(), getAllRules: jest.fn(async () => []),
}));
jest.mock('@/utils/time', () => ({ formatDateTime: (value: string) => value }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('@/utils/logger', () => ({ logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const material = (id = 'material-1', orderNo = 'ORDER-1'): MaterialRecord => ({
  id, order_no: orderNo, customer_name: '客户 A', operation_type: 'outbound',
  model: '同型号', batch: 'LOT-1', quantity: 100, package: '', version: '',
  productionDate: '', traceNo: 'TRACE-1', sourceNo: '', scanned_at: '2026-10-13 10:00:00',
  raw_content: '',
});
const remark = (updates: Partial<MaterialRemarkDTO> = {}): MaterialRemarkDTO => ({
  id: 'label-1', order_no: 'ORDER-1', new_quantity: '100',
  new_traceNo: 'TRACE-1-1', pair_id: 'pair-1',
  notes: '拆包核对\n保留完整备注', unpacked_at: '2026-10-13 10:01:00', ...updates,
});

let root: TestRenderer.ReactTestRenderer | undefined;
const textValues = () => root!.root.findAllByType(Text).map(node => node.props.children);
const fullText = () => textValues().join('\n');
const renderScreen = async () => {
  await act(async () => {
    if (root) root.update(<DetailScreen />);
    else root = TestRenderer.create(<DetailScreen />);
  });
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  mockRecordId = 'material-1';
  jest.mocked(getMaterial).mockResolvedValue(material());
  jest.mocked(getQueryOrder).mockResolvedValue(null);
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark()]);
  jest.mocked(updateSalesReturnNotes).mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

it('shows the complete existing remark directly after scan time and copies it', async () => {
  await renderScreen();
  const values = textValues();
  expect(values.indexOf('备注')).toBeGreaterThan(values.indexOf('扫描时间'));
  expect(values.indexOf('备注')).toBeLessThan(values.indexOf('物料信息'));
  expect(values).toContain('拆包核对\n保留完整备注');
  expect(values).not.toContain('补充退货备注');
  expect(getMaterialRemarks).toHaveBeenCalledWith('material-1', 'ORDER-1', undefined);
  const copy = root!.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(text => text.props.children === '复制内容'))!;
  await act(async () => { await copy.props.onPress(); });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('备注: 拆包核对\n保留完整备注'));
});

it('omits the remark field and copy line when all remarks are empty', async () => {
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ notes: ' \n ' })]);
  await renderScreen();
  expect(textValues()).not.toContain('备注');
  const copy = root!.root.findAllByType(TouchableOpacity).find(button =>
    button.findAllByType(Text).some(text => text.props.children === '复制内容'))!;
  await act(async () => { await copy.props.onPress(); });
  expect(jest.mocked(Clipboard.setStringAsync).mock.calls[0][0]).not.toContain('备注:');
});

it('keeps valid record details visible and distinguishes a failed remark read from no remarks', async () => {
  jest.mocked(getMaterialRemarks).mockRejectedValue(new Error('database busy'));
  await renderScreen();
  expect(fullText()).toContain('同型号');
  expect(fullText()).toContain('备注读取失败，请重新进入详情重试');
  expect(textValues()).not.toContain('加载记录失败');
});

it('retains distinct operations but shows a paired label remark only once', async () => {
  jest.mocked(getMaterialRemarks).mockResolvedValue([
    remark({ notes: '第一次备注' }),
    remark({ id: 'duplicate-1', notes: '第一次备注' }),
    remark({ id: 'label-2', pair_id: 'pair-2', notes: '第二次备注', unpacked_at: '2026-10-13 11:00:00' }),
  ]);
  await renderScreen();
  expect(fullText().match(/第一次备注/g)).toHaveLength(1);
  expect(fullText()).toContain('第二次备注');
  expect(fullText()).toContain('2026-10-13 10:01:00');
  expect(fullText()).toContain('2026-10-13 11:00:00');
});

it('queries only the current package id and order and does not render another order remark', async () => {
  jest.mocked(getMaterialRemarks).mockImplementation(async (id, orderNo) => id === 'material-1' && orderNo === 'ORDER-1'
    ? [remark({ notes: '本笔备注' }), remark({ id: 'label-other-order', pair_id: 'other-order', order_no: 'ORDER-2', notes: '另一单备注' })]
    : [remark({ notes: '另一包备注' })]);
  await renderScreen();
  expect(fullText()).toContain('本笔备注');
  expect(fullText()).not.toContain('另一包备注');
  expect(fullText()).not.toContain('另一单备注');
});

it('ignores the previous record history when its request finishes after switching id', async () => {
  let resolveOld: (rows: MaterialRemarkDTO[]) => void = () => undefined;
  jest.mocked(getMaterialRemarks).mockImplementation(id => id === 'material-1'
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve([remark({ id: 'label-2', order_no: 'ORDER-2', pair_id: 'pair-2', notes: '新记录备注' })]));
  jest.mocked(getMaterial).mockImplementation(id => Promise.resolve(material(id, id === 'material-1' ? 'ORDER-1' : 'ORDER-2')));
  await renderScreen();
  mockRecordId = 'material-2';
  await renderScreen();
  expect(fullText()).toContain('新记录备注');
  await act(async () => { resolveOld([remark({ notes: '旧记录备注' })]); });
  expect(fullText()).toContain('新记录备注');
  expect(fullText()).not.toContain('旧记录备注');
});

it('shows a return record with positive received quantity and its own remark', async () => {
  const received = { ...material('return-1', 'RETURN-1'), operation_type: 'sales_return' as const, quantity: 80 };
  mockRecordId = received.id;
  jest.mocked(getMaterial).mockResolvedValue(received);
  jest.mocked(getMaterialRemarks).mockResolvedValue([
    remark({ id: received.id, pair_id: received.id, order_no: received.order_no, notes: '退货；历史来源未知', new_quantity: '80' }),
  ]);
  await renderScreen();
  expect(fullText()).toContain('退货；历史来源未知');
  expect(fullText()).toContain('退货记录详情');
  expect(fullText()).toContain('实收数量');
  expect(textValues()).toContain(80);
  expect(getMaterialRemarks).toHaveBeenCalledWith('return-1', 'RETURN-1', undefined);
  expect(getQueryOrder).toHaveBeenCalledWith('RETURN-1', undefined);
});

const returnMaterial = (): MaterialRecord => ({
  ...material('return-1', 'RETURN-1'), operation_type: 'sales_return', user_notes: '原补充说明',
});
const pressTextButton = async (label: string) => {
  const button = root!.root.findAllByType(TouchableOpacity).find(item =>
    item.findAllByType(Text).some(text => text.props.children === label))!;
  await act(async () => { button.props.onPress(); });
};

it('edits only supplemental return notes once and reloads the automatic source remark', async () => {
  const received = returnMaterial();
  mockRecordId = received.id;
  jest.mocked(getMaterial).mockResolvedValue(received);
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ id: received.id, pair_id: received.id, order_no: received.order_no, notes: '销售退货；历史来源未知；原补充说明' })]);
  await renderScreen();
  await pressTextButton('补充退货备注');
  expect(root!.root.findByType(TextInput).props.value).toBe('原补充说明');
  await act(async () => { root!.root.findByType(TextInput).props.onChangeText('  客户退回包装破损  '); });
  const save = root!.root.findByType(AppModalCard).props.footer.props.onPrimaryPress;
  jest.mocked(getMaterial).mockResolvedValue({ ...received, user_notes: '客户退回包装破损' });
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ id: received.id, pair_id: received.id, order_no: received.order_no, notes: '销售退货；历史来源未知；客户退回包装破损' })]);
  await act(async () => { save(); save(); });
  expect(updateSalesReturnNotes).toHaveBeenCalledTimes(1);
  expect(updateSalesReturnNotes).toHaveBeenCalledWith('return-1', '客户退回包装破损');
  expect(fullText()).toContain('销售退货；历史来源未知；客户退回包装破损');
  expect(root!.root.findAllByType(AppModalCard)).toHaveLength(0);
});

it('keeps the return note editor open after a failed save', async () => {
  const received = returnMaterial();
  mockRecordId = received.id;
  jest.mocked(getMaterial).mockResolvedValue(received);
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ order_no: received.order_no, notes: '销售退货；历史来源未知' })]);
  await renderScreen();
  await pressTextButton('补充退货备注');
  jest.mocked(updateSalesReturnNotes).mockRejectedValueOnce(new Error('database busy'));
  await act(async () => { root!.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  expect(root!.root.findAllByType(AppModalCard)).toHaveLength(1);
  expect(fullText()).toContain('备注保存失败，请稍后重试');
  expect(fullText()).toContain('销售退货；历史来源未知');
});

it('ignores a saved return note response after opening a different record', async () => {
  const received = returnMaterial();
  mockRecordId = received.id;
  jest.mocked(getMaterial).mockResolvedValue(received);
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ order_no: received.order_no, notes: '销售退货；历史来源未知' })]);
  await renderScreen();
  await pressTextButton('补充退货备注');
  let finishSave!: () => void;
  jest.mocked(updateSalesReturnNotes).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  await act(async () => { root!.root.findByType(AppModalCard).props.footer.props.onPrimaryPress(); });
  mockRecordId = 'material-2';
  jest.mocked(getMaterial).mockResolvedValue(material('material-2', 'ORDER-2'));
  jest.mocked(getMaterialRemarks).mockResolvedValue([remark({ order_no: 'ORDER-2', notes: '另一笔出库备注' })]);
  await renderScreen();
  await act(async () => { finishSave(); });
  expect(fullText()).toContain('另一笔出库备注');
  expect(fullText()).not.toContain('销售退货；历史来源未知');
  expect(root!.root.findAllByType(AppModalCard)).toHaveLength(0);
  expect(textValues()).not.toContain('补充退货备注');
});
