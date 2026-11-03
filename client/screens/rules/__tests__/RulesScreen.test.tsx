import TestRenderer, { act } from 'react-test-renderer';
import { AppState, BackHandler, FlatList, Modal, ScrollView, Text, TextInput, TouchableOpacity, UIManager } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Gesture, GestureDetector, PointerType, State, Swipeable } from 'react-native-gesture-handler';
import RulesScreen from '../index';
import { RuleSamplePanel } from '../RuleSamplePanel';
import { RuleOptionPicker } from '../RuleOptionPicker';
import { SupplierManager } from '@/screens/inventory-binding/SupplierManager';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalHeader } from '@/components/AppModalHeader';
import * as database from '@/utils/database';

const mockScrollTo = jest.fn();
let mockRouteParams: { editRuleId?: string; returnTo?: string } = {};
const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockDispatch = jest.fn();
const mockBackHandlers = new Set<() => boolean | null | undefined>();
const hardwareBack = () => Array.from(mockBackHandlers).reverse().some(handler => handler());
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = require('react') as typeof import('react');
  const MockScrollView = React.forwardRef(function MockScrollView(props: import('react-native').ScrollViewProps, ref) {
      React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return React.createElement('MockScrollView', props, props.children);
  });
  return { __esModule: true, default: Object.assign(MockScrollView, { Context: React.createContext(null) }) };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
  useNavigation: () => ({ dispatch: mockDispatch }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => mockRouter, useSafeSearchParams: () => mockRouteParams }));
jest.mock('@/screens/inventory-binding/SupplierManager', () => ({ SupplierManager: 'SupplierPanel' }));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));
jest.mock('@/components/AppModalActions', () => ({ AppModalActions: 'Actions' }));
jest.mock('@/components/KeyboardAwareForm', () => ({ KeyboardAwareFormScrollView: 'Scroll' }));
jest.mock('../RuleSamplePanel', () => ({ RuleSamplePanel: 'Sample' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/toast', () => {
  const toast = { showToast: jest.fn(), ToastContainer: () => null };
  return { useToast: () => toast };
});
jest.mock('@/components/CustomAlert', () => {
  const alert = { showAlert: jest.fn(), showConfirm: jest.fn(), showError: jest.fn(), showSuccess: jest.fn(), showWarning: jest.fn(), AlertComponent: null };
  return { useCustomAlert: () => alert };
});
jest.mock('@/utils/database', () => ({ ...jest.requireActual('@/utils/database'),
  getAllRules: jest.fn(), addRule: jest.fn(), updateRule: jest.fn(), deleteRule: jest.fn(), setRulesDisplayOrder: jest.fn(),
}));
let root: TestRenderer.ReactTestRenderer;
const originalMeasure = Object.getOwnPropertyDescriptor(UIManager, 'measureInWindow');
const button = (label: string) => root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === label)!;
const press = async (label: string) => { await act(async () => { button(label).props.onPress(); }); };
const input = async (label: string, value: string) => {
  await act(async () => { root.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === label)!.props.onChangeText(value); });
};
const sample = () => root.root.findByType(RuleSamplePanel);
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  mockBackHandlers.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    mockBackHandlers.add(handler);
    return { remove: () => mockBackHandlers.delete(handler) };
  });
  mockRouteParams = {};
  mockRouter.canGoBack.mockReturnValue(true);
  Object.defineProperty(UIManager, 'measureInWindow', {
    configurable: true,
    value: jest.fn((_node, callback) => callback(0, 100, 360, 500)),
  });
  jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(1);
  jest.mocked(database.getAllRules).mockResolvedValue([]);
  jest.mocked(database.addRule).mockResolvedValue('new');
  await act(async () => { root = TestRenderer.create(<RulesScreen />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
  if (originalMeasure) Object.defineProperty(UIManager, 'measureInWindow', originalMeasure);
  else Reflect.deleteProperty(UIManager, 'measureInWindow');
  jest.useRealTimers();
});

const beginSorting = async () => {
  const rules: database.QRCodeRule[] = ['A', 'B', 'C'].map(id => ({
    id, name: id, description: '', separator: '/', fieldOrder: ['model', 'quantity'],
    isActive: true, created_at: '', updated_at: '',
  }));
  jest.mocked(database.getAllRules).mockResolvedValue(rules);
  await act(async () => {
    root.unmount();
    root = TestRenderer.create(<RulesScreen />);
  });
  await act(async () => {
    root.root.findAllByType(TouchableOpacity).find(item => item.props.onLongPress)!.props.onLongPress();
  });
  return root.root.findAllByType(GestureDetector)[0].props.gesture as ReturnType<typeof Gesture.Pan>;
};

const panEvent = {
  handlerTag: 0, state: State.ACTIVE, oldState: State.BEGAN, numberOfPointers: 1,
  pointerType: PointerType.TOUCH, x: 0, y: 0, absoluteX: 0, absoluteY: 0,
  translationX: 0, translationY: 0, velocityX: 0, velocityY: 0,
};

it('returns to the first row after adding a rule while preserving the existing list order', async () => {
  const oldRule: database.QRCodeRule = {
    id: 'old', name: 'Old rule', description: '', separator: '/', fieldOrder: ['model', 'quantity'],
    isActive: true, created_at: '', updated_at: '', displayOrder: 1,
  };
  jest.mocked(database.getAllRules).mockResolvedValue([oldRule]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  await act(async () => {
    root.root.findByType(FlatList).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 600 } } });
  });
  jest.mocked(database.addRule).mockImplementationOnce(async () => {
    jest.mocked(database.getAllRules).mockResolvedValue([
      { ...oldRule, id: 'new', name: 'New top rule', displayOrder: 1 },
      { ...oldRule, displayOrder: 2 },
    ]);
    return 'new';
  });
  await press('新增解析规则');
  await input('规则名称', 'New top rule');
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  mockScrollTo.mockClear();
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(root.root.findByType(FlatList).props.data.map((rule: database.QRCodeRule) => rule.id)).toEqual(['new', 'old']);
  expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0, animated: false }));
});

it('unlocks scrolling on cancelled drag and app backgrounding', async () => {
  let onAppState: ((state: string) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onAppState = callback;
    return { remove };
  });
  const gesture = await beginSorting();
  const list = () => root.root.findAllByType(ScrollView)[0];
  await act(async () => { gesture.handlers.onStart?.(panEvent); });
  expect(list().props.scrollEnabled).toBe(false);
  await act(async () => { gesture.handlers.onFinalize?.({ ...panEvent, state: State.CANCELLED }, false); });
  expect(list().props.scrollEnabled).toBe(true);
  await act(async () => { gesture.handlers.onStart?.(panEvent); });
  await act(async () => { onAppState?.('background'); });
  expect(list().props.scrollEnabled).toBe(true);
  await act(async () => { gesture.handlers.onUpdate?.({ ...panEvent, translationY: 300 }); });
  await press('完成排序');
  expect(database.setRulesDisplayOrder).toHaveBeenCalledWith(['A', 'B', 'C']);
});

it('saves only once while pending and lets the user retry after a failed save', async () => {
  await beginSorting();
  let rejectSave!: (reason: Error) => void;
  jest.mocked(database.setRulesDisplayOrder).mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectSave = reject;
  }));
  await press('完成排序');
  expect(button('完成排序').props.disabled).toBe(true);
  expect(button('取消排序').props.disabled).toBe(true);
  await press('完成排序');
  expect(database.setRulesDisplayOrder).toHaveBeenCalledTimes(1);
  await act(async () => { rejectSave(new Error('保存失败')); });
  expect(button('完成排序').props.disabled).toBe(false);
  jest.mocked(database.setRulesDisplayOrder).mockResolvedValueOnce();
  await press('完成排序');
  expect(database.setRulesDisplayOrder).toHaveBeenCalledTimes(2);
});

it('reverses edge scrolling without crossing the centre and stops timers when unmounted', async () => {
  jest.useFakeTimers();
  const scheduleInterval = jest.spyOn(global, 'setInterval');
  const cancelInterval = jest.spyOn(global, 'clearInterval');
  const gesture = await beginSorting();
  const list = root.root.findAllByType(ScrollView)[0];
  await act(async () => {
    list.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
    list.props.onContentSizeChange(360, 2000);
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 200 } } });
    jest.advanceTimersByTime(100);
    gesture.handlers.onStart?.(panEvent);
  });
  await act(async () => { gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 580 }); });
  await act(async () => { jest.advanceTimersByTime(16); });
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 210, animated: false });
  await act(async () => { gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 110 }); });
  await act(async () => { jest.advanceTimersByTime(16); });
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 190, animated: false });
  await act(async () => {
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 1495 } } });
    gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 580 });
    jest.advanceTimersByTime(16);
  });
  expect(mockScrollTo).toHaveBeenLastCalledWith({ y: 1500, animated: false });
  await act(async () => { gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 350 }); });
  mockScrollTo.mockClear();
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(mockScrollTo).not.toHaveBeenCalled();
  await act(async () => {
    gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 110 });
    gesture.handlers.onFinalize?.({ ...panEvent, state: State.CANCELLED }, false);
  });
  expect(root.root.findAllByType(ScrollView)[0].props.scrollEnabled).toBe(true);
  await act(async () => { jest.advanceTimersByTime(100); });
  expect(mockScrollTo).not.toHaveBeenCalled();
  await act(async () => {
    gesture.handlers.onStart?.(panEvent);
    gesture.handlers.onUpdate?.({ ...panEvent, absoluteY: 580 });
  });
  const edgeTimer = scheduleInterval.mock.results.at(-1)!.value;
  await act(async () => { root.unmount(); });
  expect(cancelInterval).toHaveBeenCalledWith(edgeTimer);
  mockScrollTo.mockClear();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(mockScrollTo).not.toHaveBeenCalled();
});

it('cancels a reordered draft without persisting it', async () => {
  const gesture = await beginSorting();
  await act(async () => {
    gesture.handlers.onStart?.(panEvent);
    gesture.handlers.onUpdate?.({ ...panEvent, translationY: 180 });
    gesture.handlers.onFinalize?.({ ...panEvent, state: State.CANCELLED }, false);
  });
  await press('取消排序');
  expect(database.setRulesDisplayOrder).not.toHaveBeenCalled();
});

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
  await press('选择规则供应商');
  await act(async () => { root.root.findByType(SupplierManager).props.onSelect('Supplier', 'supplier-1'); });
  await press('识别条件');
  await press('选择条件字段');
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect('1'); });
  await input('识别条件关键字', 'PN:');
  await press('添加识别条件');
  await press('返回规则');
  expect(sample().props.rule.matchConditions).toEqual([{ fieldIndex: 0, keyword: 'PN:', operator: 'contains' }]);
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({
    name: 'New', fieldOrder: ['model', 'quantity'], fieldPrefixes: { model: 'PN:' }, supplierName: 'Supplier', supplierId: 'supplier-1',
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

it('keeps the rule draft while choosing a supplier and can clear the formal association', async () => {
  await press('新增解析规则');
  await input('规则名称', '草稿名称');
  await act(async () => { sample().props.onSampleChange('MODEL/100'); sample().props.onAssign(0, 'model', 2); });
  await press('选择规则供应商');
  // Keep the editor beneath the supplier surface so returning never flashes the rule list.
  expect(root.root.findByType(Modal).props.visible).toBe(true);
  await act(async () => { root.root.findByType(SupplierManager).props.onSelect('极海科技', 'supplier-apm'); });
  expect(sample().props.sample).toBe('MODEL/100');
  expect(sample().props.rule).toMatchObject({ name: '草稿名称', supplierName: '极海科技', supplierId: 'supplier-apm' });
  await press('选择规则供应商');
  await act(async () => { root.root.findByType(SupplierManager).props.onClose(); });
  expect(sample().props.rule.supplierId).toBe('supplier-apm');
  await press('选择规则供应商');
  await act(async () => { root.root.findByType(SupplierManager).props.onSelect(''); });
  expect(sample().props.rule).toMatchObject({ supplierId: '', supplierName: '' });
});

it('opens a diagnosis-linked rule once, keeps legacy supplier notes unassociated, and saves them unchanged', async () => {
  const legacy: database.QRCodeRule = {
    id: 'legacy-rule', name: '旧规则', description: '', separator: '/',
    fieldOrder: ['model', 'quantity'], supplierName: '旧备注',
    isActive: true, created_at: '', updated_at: '',
  };
  jest.mocked(database.getAllRules).mockResolvedValue([legacy]);
  mockRouteParams = { editRuleId: legacy.id };
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  expect(root.root.findByType(Modal).props.visible).toBe(true);
  expect(button('选择规则供应商').props.accessibilityValue.text).toBe('旧备注，历史备注未关联');
  expect(sample().props.rule).toMatchObject({ supplierId: '', supplierName: '旧备注' });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.updateRule).toHaveBeenCalledWith(legacy.id, expect.objectContaining({ supplierId: '', supplierName: '旧备注' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

const openRuleFromDiagnostics = async () => {
  const rule: database.QRCodeRule = {
    id: 'diagnosed-rule', name: '需要调整的规则', description: '', separator: '/',
    fieldOrder: ['model', 'quantity'], isActive: true, created_at: '', updated_at: '',
  };
  jest.mocked(database.getAllRules).mockResolvedValue([rule]);
  mockRouteParams = { editRuleId: rule.id, returnTo: 'rule-diagnostics' };
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  return rule;
};

it('returns directly to the existing diagnosis only after the linked rule saves successfully', async () => {
  const rule = await openRuleFromDiagnostics();
  await input('规则名称', '已修复的规则');
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.updateRule).toHaveBeenCalledWith(rule.id, expect.objectContaining({ name: '已修复的规则' }));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(sample().props.rule.name).toBe('已修复的规则');
});

it('stays in the diagnosis-linked editor on validation or database save failure', async () => {
  await openRuleFromDiagnostics();
  await input('规则名称', '');
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(AppModalActions)).toHaveLength(1);
  await input('规则名称', '保留的修改');
  jest.mocked(database.updateRule).mockRejectedValueOnce(new Error('数据库暂不可写'));
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(AppModalActions)).toHaveLength(1);
  expect(sample().props.rule.name).toBe('保留的修改');
  expect(require('@/components/CustomAlert').useCustomAlert().showError).toHaveBeenCalledWith('数据库暂不可写');
});

it.each(['取消按钮', '标题关闭', '安卓返回'])('returns to diagnosis through %s without saving', async (method) => {
  await openRuleFromDiagnostics();
  await act(async () => {
    if (method === '取消按钮') root.root.findByType(AppModalActions).props.onSecondaryPress();
    else if (method === '标题关闭') root.root.findByType(AppModalHeader).props.onClose();
    else expect(hardwareBack()).toBe(true);
  });
  expect(database.updateRule).not.toHaveBeenCalled();
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(sample().props.rule.name).toBe('需要调整的规则');
});

it('returns from a nested section to the editor before leaving diagnosis editing', async () => {
  await openRuleFromDiagnostics();
  await press('识别条件');
  await act(async () => { expect(hardwareBack()).toBe(true); });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(root.root.findByType(AppModalActions).props.primaryLabel).toBe('保存');
  await act(async () => { hardwareBack(); hardwareBack(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('opens diagnosis when a direct editor link has no previous screen to return to', async () => {
  await openRuleFromDiagnostics();
  mockRouter.canGoBack.mockReturnValue(false);
  await act(async () => { root.root.findByType(AppModalActions).props.onSecondaryPress(); });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/rule-diagnostics');
});

it('does not reveal the rule list while a diagnosis-linked editor is loading or closing', async () => {
  const rule: database.QRCodeRule = { id: 'slow', name: '慢速读取规则', description: '', separator: '/',
    fieldOrder: ['model', 'quantity'], isActive: true, created_at: '', updated_at: '' };
  let resolve!: (rules: database.QRCodeRule[]) => void;
  jest.mocked(database.getAllRules).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  mockRouteParams = { editRuleId: rule.id, returnTo: 'rule-diagnostics' };
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByProps({ accessibilityLabel: '正在加载解析规则' }).length).toBeGreaterThan(0);
  await act(async () => { resolve([rule]); });
  const editor = sample();
  expect(editor.props.rule.name).toBe(rule.name);
  await act(async () => { root.root.findByType(AppModalActions).props.onSecondaryPress(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(sample()).toBe(editor);
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
});

it('keeps the inline rule draft mounted while choosing a supplier', async () => {
  await openRuleFromDiagnostics();
  await input('规则名称', '保留草稿');
  await act(async () => { sample().props.onSampleChange('APM/100'); });
  await press('选择规则供应商');
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  await act(async () => { root.root.findByType(SupplierManager).props.onSelect('极海科技', 'supplier-apm'); });
  expect(sample().props.sample).toBe('APM/100');
  expect(sample().props.rule).toMatchObject({ name: '保留草稿', supplierName: '极海科技', supplierId: 'supplier-apm' });
});

it('blocks page removal and back while saving the inline editor, then releases after failure', async () => {
  await openRuleFromDiagnostics();
  let reject!: (error: Error) => void;
  jest.mocked(database.updateRule).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  let save!: Promise<void>;
  await act(async () => { save = root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(root.root.findByType(AppModalActions).props.primaryDisabled).toBe(true);
  expect(jest.mocked(usePreventRemove)).toHaveBeenLastCalledWith(true, expect.any(Function));
  await act(async () => {
    expect(hardwareBack()).toBe(true);
    root.root.findByType(AppModalActions).props.onSecondaryPress();
  });
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(sample().props.rule.name).toBe('需要调整的规则');
  await act(async () => { reject(new Error('保存失败')); await save; });
  expect(jest.mocked(usePreventRemove)).toHaveBeenLastCalledWith(false, expect.any(Function));
  await act(async () => { root.root.findByType(AppModalActions).props.onSecondaryPress(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('allows returning from a missing diagnosis-linked rule without showing the rule list', async () => {
  mockRouteParams = { editRuleId: 'missing', returnTo: 'rule-diagnostics' };
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
  await act(async () => { root.root.findByType(AppModalHeader).props.onClose(); });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('reports a removed diagnosis-linked rule without opening an unrelated rule', async () => {
  mockRouteParams = { editRuleId: 'missing' };
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  expect(require('@/components/CustomAlert').useCustomAlert().showError).toHaveBeenCalledWith('该解析规则已删除或不存在，请返回诊断页重新检查');
  expect(root.root.findAllByType(Modal)).toHaveLength(0);
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

const selectConditionOption = async (label: string, value: string) => {
  await press(label);
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect(value); });
};

const addPrefixCondition = async (keyword: string) => {
  await selectConditionOption('选择条件字段', '1');
  await selectConditionOption('选择匹配方式', 'startsWith');
  await input('识别条件关键字', keyword);
  await press('添加识别条件');
};

const editSavedRule = async (rule: database.QRCodeRule) => {
  jest.mocked(database.getAllRules).mockResolvedValue([rule]);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.findAllByType(Text)
    .some(text => text.props.children === rule.name))!.props.onPress(); });
};

it('saves SF and OS alternatives from the real editor and matches only the model beginning', async () => {
  await press('新增解析规则');
  await input('规则名称', 'SF与OS');
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  await press('识别条件');
  await selectConditionOption('选择条件关系', 'any');
  await addPrefixCondition('SF');
  await addPrefixCondition('OS');
  await press('返回规则');
  const draft = sample().props.rule as database.QRCodeRule;
  expect(draft.conditionMode).toBe('any');
  for (const model of ['SF1234', 'OS5678', 'sf1234']) {
    expect(database.inspectQRCodeRule(`${model}/100`, draft).matched).toBe(true);
  }
  for (const model of ['XSF1234', 'XXOS5678', 'ABC']) {
    expect(database.inspectQRCodeRule(`${model}/100`, draft).matched).toBe(false);
  }
  await act(async () => { sample().props.onSampleChange('OS5678/100'); });
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.addRule).toHaveBeenCalledWith(expect.objectContaining({
    conditionMode: 'any', matchConditions: [
      { fieldIndex: 0, keyword: 'SF', operator: 'startsWith' },
      { fieldIndex: 0, keyword: 'OS', operator: 'startsWith' },
    ],
  }));
});

it('keeps old conditions mandatory while adding SF or OS in the mixed alternative group', async () => {
  const rule: database.QRCodeRule = { id: 'mixed', name: 'Mixed', description: '', separator: '/',
    fieldOrder: ['model', 'package', 'quantity'], matchConditions: [{ fieldIndex: 1, keyword: 'SOP8', operator: 'equals' }],
    isActive: true, created_at: '', updated_at: '' };
  await editSavedRule(rule);
  expect(sample().props.rule.conditionMode).toBe('all');
  await press('识别条件');
  await selectConditionOption('选择条件关系', 'mixed');
  await addPrefixCondition('SF');
  await addPrefixCondition('OS');
  await press('返回规则');
  const draft = sample().props.rule as database.QRCodeRule;
  expect(draft.conditionMode).toBe('mixed');
  expect(draft.matchConditions?.slice(1).map(condition => condition.group)).toEqual(['any', 'any']);
  expect(database.inspectQRCodeRule('SF1234/SOP8/100', draft).matched).toBe(true);
  expect(database.inspectQRCodeRule('OS5678/SOP8/100', draft).matched).toBe(true);
  expect(database.inspectQRCodeRule('SF1234/QFN/100', draft).matched).toBe(false);
  expect(database.inspectQRCodeRule('XXOS5678/SOP8/100', draft).matched).toBe(false);
  await act(async () => { await root.root.findByType(AppModalActions).props.onPrimaryPress(); });
  expect(database.updateRule).toHaveBeenCalledWith('mixed', expect.objectContaining({ conditionMode: 'mixed', matchConditions: draft.matchConditions }));
});

it('reopens mixed groups and keeps group membership when moving fields or cancelling an edit', async () => {
  const rule: database.QRCodeRule = { id: 'grouped', name: 'Grouped', description: '', separator: '/',
    fieldOrder: ['model', 'quantity'], conditionMode: 'mixed',
    matchConditions: [{ fieldIndex: 0, keyword: 'SF', operator: 'startsWith', group: 'any' }],
    isActive: true, created_at: '', updated_at: '' };
  await editSavedRule(rule);
  await press('识别条件');
  await press('将条件1移到必须组');
  await press('将条件1移到任选组');
  await press('返回规则');
  await press('手动字段顺序');
  await press('下移第1段');
  await press('返回规则');
  expect(sample().props.rule.matchConditions).toEqual([{ ...rule.matchConditions![0], fieldIndex: 1 }]);
  await act(async () => { root.root.findByType(AppModalActions).props.onSecondaryPress(); });
  expect(database.updateRule).not.toHaveBeenCalled();
});

it('can put a new condition into the mandatory group without losing the chosen mode', async () => {
  await press('新增解析规则');
  await act(async () => { sample().props.onAssign(0, 'model', 2); });
  await act(async () => { sample().props.onAssign(1, 'quantity', 2); });
  await press('识别条件');
  await selectConditionOption('选择条件关系', 'mixed');
  await selectConditionOption('选择新增条件分组', 'all');
  await addPrefixCondition('SF');
  await press('返回规则');
  expect(sample().props.rule).toEqual(expect.objectContaining({
    conditionMode: 'mixed', matchConditions: [{ fieldIndex: 0, keyword: 'SF', operator: 'startsWith', group: 'all' }],
  }));
});

it('retains OR alternatives when switching an existing any rule to mixed mode', async () => {
  const rule: database.QRCodeRule = { id: 'any-to-mixed', name: 'AnyToMixed', description: '', separator: '/',
    fieldOrder: ['model', 'quantity'], conditionMode: 'any',
    matchConditions: [{ fieldIndex: 0, keyword: 'SF', operator: 'startsWith' }, { fieldIndex: 0, keyword: 'OS', operator: 'startsWith' }],
    isActive: true, created_at: '', updated_at: '' };
  await editSavedRule(rule);
  await press('识别条件');
  await selectConditionOption('选择条件关系', 'mixed');
  await press('返回规则');
  const draft = sample().props.rule as database.QRCodeRule;
  expect(draft.matchConditions?.map(condition => condition.group)).toEqual(['any', 'any']);
  expect(database.inspectQRCodeRule('SF1234/100', draft).matched).toBe(true);
  expect(database.inspectQRCodeRule('OS5678/100', draft).matched).toBe(true);
});

const manyRules = (count: number): database.QRCodeRule[] => Array.from({ length: count }, (_, index) => ({
  id: `many-${index}`, name: `Rule ${index}`, description: '', separator: '/',
  fieldOrder: ['model', 'batch', 'package', 'quantity', 'traceCode'], isActive: true,
  created_at: '', updated_at: '',
}));

const reloadScreenWithRules = async (rules: database.QRCodeRule[]) => {
  jest.mocked(database.getAllRules).mockResolvedValue(rules);
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
};

it.each([26, 260])('mounts only the first visible batch with %i configured rules', async count => {
  jest.useFakeTimers();
  await reloadScreenWithRules(manyRules(count));
  const list = root.root.findByType(FlatList);
  expect(list.props.data).toHaveLength(count);
  expect(root.root.findAllByType(Swipeable)).toHaveLength(8);
  expect(list.props.getItemLayout).toBeUndefined();
  expect(root.root.findAllByType(GestureDetector)).toHaveLength(0);
  await act(async () => { jest.advanceTimersByTime(220); });
  expect(root.root.findAllByType(RuleSamplePanel)).toHaveLength(0);
});

it('does not repaint rule swipe controls while opening or typing in the editor', async () => {
  jest.useFakeTimers();
  await reloadScreenWithRules(manyRules(26));
  const swipeRender = jest.spyOn(Swipeable.prototype, 'render');
  await press('新增解析规则');
  expect(swipeRender).not.toHaveBeenCalled();
  await input('规则名称', 'New rule');
  expect(swipeRender).not.toHaveBeenCalled();
  await act(async () => { root.root.findByType(AppModalActions).props.onSecondaryPress(); });
  await act(async () => { jest.advanceTimersByTime(220); });
  expect(root.root.findAllByType(RuleSamplePanel)).toHaveLength(0);
  expect(swipeRender).not.toHaveBeenCalled();
});

it('keeps sort gestures separate and restores the scrolled position when cancelling', async () => {
  jest.useFakeTimers();
  await reloadScreenWithRules(manyRules(26));
  let list = root.root.findByType(FlatList);
  await act(async () => {
    list.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 1200 } } });
  });
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.props.onLongPress)!.props.onLongPress(); });
  expect(root.root.findAllByType(FlatList)).toHaveLength(0);
  expect(root.root.findAllByType(GestureDetector)).toHaveLength(26);
  const sortingList = root.root.findAllByType(ScrollView)[0];
  expect(sortingList.props.contentOffset).toEqual({ x: 0, y: 1200 });
  await act(async () => { sortingList.props.onScroll({ nativeEvent: { contentOffset: { y: 1400 } } }); });
  await press('取消排序');
  list = root.root.findByType(FlatList);
  expect(list.props.contentOffset).toEqual({ x: 0, y: 1400 });
  expect(list.props.initialNumToRender).toBeGreaterThan(8);
  expect(root.root.findAllByType(GestureDetector)).toHaveLength(0);
  expect(database.setRulesDisplayOrder).not.toHaveBeenCalled();
});

it('shows a loading indicator instead of an empty-rule message while reading rules', async () => {
  let resolve!: (rules: database.QRCodeRule[]) => void;
  jest.mocked(database.getAllRules).mockReturnValue(new Promise(complete => { resolve = complete; }));
  await act(async () => { root.unmount(); root = TestRenderer.create(<RulesScreen />); });
  expect(root.root.findAllByProps({ accessibilityLabel: '正在加载解析规则' }).length).toBeGreaterThan(0);
  await act(async () => { resolve([]); });
  expect(root.root.findAllByProps({ accessibilityLabel: '正在加载解析规则' })).toHaveLength(0);
  expect(root.root.findByType(FlatList).props.ListEmptyComponent.props.title).toBe('暂无解析规则');
});
