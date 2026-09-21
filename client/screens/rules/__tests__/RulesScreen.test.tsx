import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text, TextInput, TouchableOpacity } from 'react-native';
import RulesScreen from '../index';
import { RuleSamplePanel } from '../RuleSamplePanel';
import { RuleOptionPicker } from '../RuleOptionPicker';
import { AppModalActions } from '@/components/AppModalActions';
import * as database from '@/utils/database';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Scroll' }));
jest.mock('../RuleSamplePanel', () => ({ RuleSamplePanel: 'Sample' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/toast', () => ({ useToast: () => ({ showToast: jest.fn(), ToastContainer: () => null }) }));
jest.mock('@/components/CustomAlert', () => {
  const alert = { showAlert: jest.fn(), showConfirm: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ ...jest.requireActual('@/utils/database'),
  getAllRules: jest.fn(), addRule: jest.fn(), updateRule: jest.fn(), deleteRule: jest.fn(),
}));
let root: TestRenderer.ReactTestRenderer;
const button = (label: string) => root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === label)!;
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); };
const input = async (label: string, value: string) => {
  await act(async () => { root.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === label)!.props.onChangeText(value); });
};
const sample = () => root.root.findByType(RuleSamplePanel);
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  jest.mocked(database.getAllRules).mockResolvedValue([]);
  jest.mocked(database.addRule).mockResolvedValue('new');
  await act(async () => { root = TestRenderer.create(<RulesScreen />); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); });

it('shows an inline required-name error for empty and whitespace names and clears it after correction', async () => {
  await press('新增解析规则');
  const save = async () => { await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); }); };
  const errors = () => root.root.findAllByType(Text).filter(item => item.props.accessibilityRole === 'alert');
  await save();
  expect(errors()[0].props.children).toBe('解析规则名称为必填项');
  expect(database.addRule).not.toHaveBeenCalled();
  await input('规则名称', '   ');
  await save();
  expect(errors()).toHaveLength(1);
  await input('规则名称', '有效名称');
  expect(errors()).toHaveLength(0);
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  await save();
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({ name: '有效名称' }));
});

it('keeps low-frequency controls secondary and saves new-rule prefixes with the sample after returning', async () => {
  await press('新增解析规则');
  await input('规则名称', 'New');
  expect(root.root.findAllByType(TextInput).map(item => item.props.accessibilityLabel)).not.toContain('识别条件关键字');
  await act(async () => { sample().props.onSeparatorSelect(';'); sample().props.onSampleChange('PN:A;100'); });
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  await press('字段前缀');
  expect(root.root.findAllByType(RuleSamplePanel)).toHaveLength(0);
  await input('第1段前缀', 'PN:');
  await press('完成设置');
  expect(sample().props.sample).toBe('PN:A;100');
  expect(sample().props.rule.fieldPrefixes).toEqual({ model: 'PN:' });
  await press('识别条件');
  await input('供应商备注', 'Supplier');
  await press('选择条件字段');
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect('1'); });
  await input('识别条件关键字', 'PN:');
  await press('添加识别条件');
  await press('返回规则');
  expect(sample().props.rule.matchConditions).toEqual([{ fieldIndex: 0, keyword: 'PN:', operator: 'contains' }]);
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({
    name: 'New', fieldOrder: ['model', 'quantity'], fieldPrefixes: { model: 'PN:' }, supplierName: 'Supplier',
  }));
  expect(database.updateRule).not.toHaveBeenCalled();
});

it('automatically fills recognized prefixes while assigning sample fields', async () => {
  await press('新增解析规则');
  await input('规则名称', '带前缀样本');
  await act(async () => {
    sample().props.onSeparatorSelect(';');
    sample().props.onSampleChange('PART NO.:QM4051PW;QTY:8000 PCS');
  });
  await act(async () => { sample().props.onAssign(0, 'model', 2, 'PART NO.:QM4051PW'); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2, 'QTY:8000 PCS'); });
  expect(sample().props.rule.fieldPrefixes).toEqual({ model: 'PART NO.:', quantity: 'QTY:' });
});

it('does not report overlap for rules that share a separator but have different segment counts', async () => {
  const existing: database.QRCodeRule = { id: 'existing', name: 'Existing', description: '', separator: ';',
    fieldOrder: ['model', 'batch', 'quantity', 'ignore:1', 'ignore:2', 'ignore:3'], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([existing]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });

  await press('新增解析规则');
  await input('规则名称', 'Eight segments');
  await act(async () => { sample().props.onSeparatorSelect(';'); });
  await act(async () => { sample().props.onAssign(0, 'model', 8); });
  await act(async () => { sample().props.onAssign(1, 'package', 8); });
  await act(async () => { sample().props.onAssign(2, 'quantity', 8); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });

  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({
    fieldOrder: expect.arrayContaining(['model', 'package', 'quantity']),
  }));
});

it('saves same-shape rules without a sample and leaves only an inline recommendation', async () => {
  const existing: database.QRCodeRule = { id: 'existing', name: 'Existing', description: '', separator: '/',
    fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([existing]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });

  await press('新增解析规则');
  await input('规则名称', 'Same shape');
  await act(async () => { sample().props.onAssign(0, 'model', 3); });
  await act(async () => { sample().props.onAssign(1, 'package', 3); });
  await act(async () => { sample().props.onAssign(2, 'quantity', 3); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });

  const alertMock = require('@/components/CustomAlert').useCustomAlert();
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'Same shape' }));
  expect(alertMock.showAlert).not.toHaveBeenCalled();
});

it('does not show a conflict dialog when sample prefixes uniquely select the draft rule', async () => {
  const existing: database.QRCodeRule = { id: 'generic', name: 'Generic', description: '', separator: '/',
    fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([existing]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });

  await press('新增解析规则');
  await input('规则名称', 'Prefixed');
  await act(async () => { sample().props.onSampleChange('PN:MODEL/LOT/100'); });
  await act(async () => { sample().props.onAssign(0, 'model', 3, 'PN:MODEL'); });
  await act(async () => { sample().props.onAssign(1, 'batch', 3, 'LOT'); });
  await act(async () => { sample().props.onAssign(2, 'quantity', 3, '100'); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });

  const alertMock = require('@/components/CustomAlert').useCustomAlert();
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'Prefixed', fieldPrefixes: { model: 'PN:' } }));
  expect(alertMock.showAlert).not.toHaveBeenCalled();
});

it('shows a conflict dialog only when the sample cannot distinguish equal-priority rules', async () => {
  const existing: database.QRCodeRule = { id: 'existing', name: 'Existing', description: '', separator: '/',
    fieldOrder: ['model', 'batch', 'quantity'], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([existing]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });

  await press('新增解析规则');
  await input('规则名称', 'Ambiguous');
  await act(async () => { sample().props.onSampleChange('MODEL/LOT/100'); });
  await act(async () => { sample().props.onAssign(0, 'model', 3, 'MODEL'); });
  await act(async () => { sample().props.onAssign(1, 'package', 3, 'LOT'); });
  await act(async () => { sample().props.onAssign(2, 'quantity', 3, '100'); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });

  const alertMock = require('@/components/CustomAlert').useCustomAlert();
  expect(database.addRule).not.toHaveBeenCalled();
  expect(alertMock.showAlert).toHaveBeenCalledWith(
    '规则冲突',
    expect.stringContaining('Existing'),
    expect.any(Array),
    'warning'
  );
});

it('requires a unique rule name before saving', async () => {
  const existing: database.QRCodeRule = { id: 'existing', name: 'Existing Rule', description: '', separator: ';',
    fieldOrder: ['model', 'quantity'], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([existing]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });

  await press('新增解析规则');
  await input('规则名称', ' existing rule ');
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });

  expect(root.root.findAllByType(Text).find(item => item.props.accessibilityRole === 'alert')?.props.children)
    .toBe('解析规则名称已存在，请更换名称');
  expect(database.addRule).not.toHaveBeenCalled();
});

it('preserves existing ignored prefixes and remaps conditions when moving fields on the secondary page', async () => {
  const rule: database.QRCodeRule = { id: 'old', name: 'Existing', description: '', separator: ';',
    fieldOrder: ['model', 'ignore:3', 'quantity'], fieldPrefixes: { 'ignore:3': 'PO:' },
    matchConditions: [{ fieldIndex: 1, keyword: 'PO-' }], isActive: true, created_at: '', updated_at: '' };
  jest.mocked(database.getAllRules).mockResolvedValue([rule]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text)
    .some(text => text.props.children === 'Existing'))!.props.onPress(); });
  await press('手动字段顺序');
  await press('上移第2段');
  await act(async () => { root.root.findAllByType(Modal).find(item => item.props.visible)!.props.onRequestClose(); });
  expect(sample().props.rule.fieldOrder).toEqual(['ignore:3', 'model', 'quantity']);
  expect(sample().props.rule.matchConditions[0].fieldIndex).toBe(0);
  expect(sample().props.rule.fieldPrefixes).toEqual({ 'ignore:3': 'PO:' });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.updateRule).toHaveBeenCalledWith('old', expect.objectContaining({ fieldPrefixes: { 'ignore:3': 'PO:' } }));
});
