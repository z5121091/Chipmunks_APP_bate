import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Platform, Text, TextInput, TouchableOpacity } from 'react-native';
import RuleDiagnosticsScreen from '../index';
import { UiPageHeader, UiToolbarButton } from '@/components/UiRedesign';
import { AppSegmentedOptions } from '@/components/AppSegmentedOptions';
import { RuleOptionPicker } from '@/screens/rules/RuleOptionPicker';
import { getAllInventoryBindings, getAllRules, getInventorySuppliers } from '@/utils/database';
import { analyzeRuleSample, diagnoseRuleConfiguration, type RuleSampleAnalysis } from '@/utils/ruleDiagnostics';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockReduced = false;
let mockFocusEffect: (() => void | (() => void)) | undefined;
let mockFocusCleanup: (() => void) | undefined;
const mockTransitionListeners = new Set<(event: { data: { closing: boolean } }) => void>();
const mockNavigation = {
  isFocused: jest.fn(() => true),
  addListener: jest.fn((_name: string, callback: (event: { data: { closing: boolean } }) => void) => {
    mockTransitionListeners.add(callback);
    return () => mockTransitionListeners.delete(callback);
  }),
};
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const React = require('react') as typeof import('react');
  const MockScrollView = React.forwardRef(function MockScrollView(props: import('react-native').ScrollViewProps, _ref) {
    return React.createElement('MockScrollView', props, props.children);
  });
  return { __esModule: true, default: Object.assign(MockScrollView, { Context: React.createContext(null) }) };
});
jest.mock('expo-router', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void | (() => void)) => {
    require('react').useEffect(() => {
      mockFocusEffect = callback;
      const cleanup = callback();
      mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
      return () => {
        mockFocusCleanup?.();
        mockFocusCleanup = undefined;
        mockFocusEffect = undefined;
      };
    }, [callback]);
  },
}));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('@/hooks/useAppMotion', () => ({ useAppMotion: () => mockReduced }));
jest.mock('@/hooks/useSafeRouter', () => ({ useSafeRouter: () => ({ push: mockPush, back: mockBack }), useSafeSearchParams: () => ({}) }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppEmptyState', () => ({ AppEmptyState: 'Empty' }));
jest.mock('@/components/AppSegmentedOptions', () => ({ AppSegmentedOptions: 'Segments' }));
jest.mock('@/components/UiRedesign', () => ({ UiPageHeader: 'Header', UiToolbarButton: 'Tool' }));
jest.mock('@/screens/rules/RuleOptionPicker', () => ({ RuleOptionPicker: 'Picker' }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/utils/database', () => ({ FIELD_LABELS: { model: '型号', quantity: '数量' }, getAllInventoryBindings: jest.fn(), getAllRules: jest.fn(), getInventorySuppliers: jest.fn() }));
jest.mock('@/utils/ruleDiagnostics', () => ({ analyzeRuleSample: jest.fn(), diagnoseRuleConfiguration: jest.fn() }));

const rules = [{ id: 'A', name: 'A规则', isActive: true, separator: '/', fieldOrder: ['model', 'quantity'], description: '', created_at: '', updated_at: '' }];
const result: RuleSampleAnalysis = { selectedRuleId: 'A', conflictingRuleIds: [], expectedStatus: 'matched', summary: '本样本实际使用 A规则', priorityExplanation: ['唯一匹配'], candidates: [{
  ruleId: 'A', ruleName: 'A规则', isActive: true, matched: true, reasons: [], fields: { model: 'APM1', quantity: '100' }, quantityValid: true,
  bindingMatch: 'exact', binding: null, ruleSupplierName: '极海', materialSupplierName: '领芯', supplierStatus: 'mismatch', priorityExplanation: ['匹配了识别条件'], selected: true, considered: true,
}] };
let root: TestRenderer.ReactTestRenderer;
const rendered = () => root.root.findAllByType(Text).map(item => {
  const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('')
    : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text(item.props.children);
}).join('\n');
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
async function transitionEnd(closing = false) {
  await act(async () => { for (const callback of mockTransitionListeners) callback({ data: { closing } }); });
}
async function pressTool(label: string) {
  await act(async () => { root.root.findAllByType(UiToolbarButton).find(item => item.props.label === label)!.props.onPress(); });
}
async function typeSample(value: string) {
  await act(async () => { root.root.findByType(TextInput).props.onChangeText(value); });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.clearAllMocks();
  mockReduced = false;
  mockNavigation.isFocused.mockReturnValue(true);
  jest.replaceProperty(Platform, 'OS', 'android');
  mockTransitionListeners.clear();
  jest.mocked(getAllRules).mockResolvedValue(rules);
  jest.mocked(getAllInventoryBindings).mockResolvedValue([]);
  jest.mocked(getInventorySuppliers).mockResolvedValue([]);
  jest.mocked(diagnoseRuleConfiguration).mockReturnValue([{ id: 'issue-A', severity: 'warning', title: '结构交叉风险', detail: '需要实际二维码确认', ruleIds: ['A'], kind: 'overlap' }]);
  jest.mocked(analyzeRuleSample).mockReturnValue(result);
  await act(async () => { root = TestRenderer.create(<RuleDiagnosticsScreen />); });
  await settle();
});
afterEach(async () => { await act(async () => { root.unmount(); }); jest.restoreAllMocks(); });

it('loads the local snapshot once, checks all rules, and opens the exact rule editor', async () => {
  expect(getAllRules).toHaveBeenCalledTimes(1);
  expect(diagnoseRuleConfiguration).toHaveBeenCalledWith(rules);
  expect(rendered()).toContain('结构交叉风险');
  await pressTool('编辑 A规则');
  expect(mockPush).toHaveBeenCalledWith('/rules', { editRuleId: 'A', returnTo: 'rule-diagnostics' });
});

it('offers only all, problems and risks and filters real findings without maintenance hints', async () => {
  const findings = [
    { id: 'error-A', severity: 'error' as const, kind: 'invalid-configuration', title: '配置不完整', detail: '缺少分隔符', ruleIds: ['A'] },
    { id: 'warning-A', severity: 'warning' as const, kind: 'duplicate-rules', title: '重复配置', detail: '相同优先级', ruleIds: ['A'] },
  ];
  jest.mocked(diagnoseRuleConfiguration).mockReturnValueOnce(findings);
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(root.root.findByType(AppSegmentedOptions).props.options).toEqual([
    { value: 'all', label: '全部' }, { value: 'error', label: '问题' }, { value: 'warning', label: '风险' },
  ]);
  expect(rendered()).toContain('明确问题 1 项 · 交叉风险 1 项');
  expect(rendered()).not.toContain('维护提示');
  expect(root.root.findByType(FlatList).props.data).toEqual(findings);
  await act(async () => { root.root.findByType(AppSegmentedOptions).props.onChange('error'); });
  expect(root.root.findByType(FlatList).props.data).toEqual([findings[0]]);
  await act(async () => { root.root.findByType(AppSegmentedOptions).props.onChange('warning'); });
  expect(root.root.findByType(FlatList).props.data).toEqual([findings[1]]);
  await act(async () => { root.root.findByType(AppSegmentedOptions).props.onChange('all'); });
  expect(root.root.findByType(FlatList).props.data).toEqual(findings);
});

it('shows a clean configuration result when no problem or risk remains', async () => {
  jest.mocked(diagnoseRuleConfiguration).mockReturnValueOnce([]);
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(root.root.findByType(FlatList).props.data).toEqual([]);
  expect(root.root.findByType(FlatList).props.ListEmptyComponent.props.title).toBe('本次配置检查未发现已知问题');
  expect(rendered()).toContain('明确问题 0 项 · 交叉风险 0 项');
  expect(rendered()).not.toContain('维护提示');
});

it('validates the original sample without normalizing hidden characters and shows supplier evidence', async () => {
  const sample = 'APM1/100\r\n';
  await typeSample(sample);
  await pressTool('诊断样本');
  expect(analyzeRuleSample).toHaveBeenCalledWith(sample, rules, [], [], undefined);
  expect(rendered()).toContain('供应商不一致');
  expect(rendered()).toContain('本样本实际使用 A规则');
  expect(rendered()).toContain('APM1');
  await typeSample('CHANGED');
  expect(rendered()).not.toContain('本样本实际使用 A规则');
  expect(getAllRules).toHaveBeenCalledTimes(1);
});

it('supports choosing an expected rule and clears stale results after changing that choice', async () => {
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === '选择预期规则')!.props.onPress(); });
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect('A'); });
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  expect(analyzeRuleSample).toHaveBeenLastCalledWith('APM1/100', rules, [], [], 'A');
  expect(rendered()).toContain('与预期一致');
  await pressTool('清空');
  expect(root.root.findByType(TextInput).props.value).toBe('');
  expect(rendered()).not.toContain('本样本实际使用 A规则');
});

it('rejects an empty sample and refreshes the snapshot on request', async () => {
  await pressTool('诊断样本');
  expect(analyzeRuleSample).not.toHaveBeenCalled();
  expect(rendered()).toContain('请先扫描或粘贴二维码内容');
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(getAllRules).toHaveBeenCalledTimes(2);
});

it('automatically rechecks the retained sample against refreshed rules after editing', async () => {
  await typeSample('LX32F003F6P6/V01H1/LQFP64/811206700006');
  jest.mocked(analyzeRuleSample).mockClear();
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(analyzeRuleSample).toHaveBeenCalledWith('LX32F003F6P6/V01H1/LQFP64/811206700006', rules, [], [], undefined);
  expect(rendered()).toContain('本样本实际使用 A规则');
});

it('retains the sample and diagnostic selections while editing, then rechecks updated rules on focus', async () => {
  const originalSample = 'APM1/100\r\n';
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === '选择预期规则')!.props.onPress(); });
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect('A'); });
  await act(async () => { root.root.findByType(AppSegmentedOptions).props.onChange('warning'); });
  await typeSample(originalSample);
  await pressTool('诊断样本');
  await pressTool('编辑 A规则');
  expect(mockPush).toHaveBeenCalledWith('/rules', { editRuleId: 'A', returnTo: 'rule-diagnostics' });
  await act(async () => {
    mockFocusCleanup?.();
    mockFocusCleanup = undefined;
  });

  const updatedRules = [{ ...rules[0], name: 'A规则已修改', fieldOrder: ['quantity', 'model'] }];
  const updatedResult = { ...result, summary: '修改后的规则已重新验证', candidates: [] };
  jest.mocked(getAllRules).mockResolvedValueOnce(updatedRules);
  jest.mocked(diagnoseRuleConfiguration).mockReturnValueOnce([]);
  jest.mocked(analyzeRuleSample).mockClear().mockReturnValueOnce(updatedResult);
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await transitionEnd();
  await settle();

  expect(getAllRules).toHaveBeenCalledTimes(2);
  expect(diagnoseRuleConfiguration).toHaveBeenLastCalledWith(updatedRules);
  expect(root.root.findByType(TextInput).props.value).toBe(originalSample);
  expect(root.root.findByType(AppSegmentedOptions).props.value).toBe('warning');
  expect(rendered()).toContain('预期规则：A规则已修改');
  expect(analyzeRuleSample).toHaveBeenCalledTimes(1);
  expect(analyzeRuleSample).toHaveBeenLastCalledWith(originalSample, updatedRules, [], [], 'A');
  expect(rendered()).toContain('修改后的规则已重新验证');
  expect(rendered()).not.toContain('结构交叉风险');
});

it('rechecks on return without waiting for a native transition event when motion is reduced', async () => {
  mockReduced = true;
  await act(async () => { root.unmount(); root = TestRenderer.create(<RuleDiagnosticsScreen />); });
  await settle();
  await typeSample('MODEL/100');
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  jest.mocked(analyzeRuleSample).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await settle();
  expect(analyzeRuleSample).toHaveBeenCalledWith('MODEL/100', rules, [], [], undefined);
  expect(rendered()).toContain('本样本实际使用 A规则');
});

it('shows load failures and disables sample analysis until retry succeeds', async () => {
  jest.mocked(getAllRules).mockRejectedValueOnce(new Error('读取失败'));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(rendered()).toContain('读取失败');
  expect(root.root.findAllByType(UiToolbarButton).find(item => item.props.label === '诊断样本')!.props.disabled).toBe(true);
  await pressTool('重试加载');
  await settle();
  expect(rendered()).not.toContain('读取失败');
});

it('does not let a late previous request overwrite a newer refresh', async () => {
  let finishOld!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  const callsBefore = jest.mocked(diagnoseRuleConfiguration).mock.calls.length;
  await act(async () => { finishOld([{ ...rules[0], id: 'OLD', name: '旧请求' }]); });
  await settle();
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(callsBefore);
});

it('keeps the result, summary and filtered list visible during a returning-screen refresh', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  await act(async () => { root.root.findByType(AppSegmentedOptions).props.onChange('warning'); });
  const previousItems = root.root.findByType(FlatList).props.data;
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  jest.mocked(analyzeRuleSample).mockClear();
  await act(async () => {
    mockFocusCleanup?.();
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  expect(root.root.findByType(FlatList).props.data).toBe(previousItems);
  expect(root.root.findByType(AppSegmentedOptions).props.value).toBe('warning');
  expect(rendered()).toContain('正在更新检查 · 暂显示上次结果');
  expect(rendered()).toContain('交叉风险 1 项');
  expect(rendered()).toContain('本样本实际使用 A规则');
  expect(root.root.findAllByType(UiToolbarButton).filter(item => item.props.label === '编辑 A规则').every(item => item.props.disabled)).toBe(true);
  await pressTool('编辑 A规则');
  await pressTool('诊断样本');
  expect(mockPush).not.toHaveBeenCalled();
  expect(analyzeRuleSample).not.toHaveBeenCalled();
  await act(async () => { finishRead(rules); });
  await settle();
  expect(root.root.findAllByType(UiToolbarButton).find(item => item.props.label === '诊断样本')!.props.disabled).toBe(false);
  expect(rendered()).not.toContain('正在更新检查');
});

it('preserves the last checked content on read failure and replaces it only after a successful retry', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  jest.mocked(getAllRules).mockRejectedValueOnce(new Error('规则读取暂不可用'));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(rendered()).toContain('本次未更新 · 以下为上次检查结果');
  expect(rendered()).toContain('规则读取暂不可用');
  expect(rendered()).toContain('结构交叉风险');
  expect(rendered()).toContain('本样本实际使用 A规则');
  await pressTool('编辑 A规则');
  expect(mockPush).not.toHaveBeenCalled();
  await pressTool('重试加载');
  await settle();
  expect(rendered()).not.toContain('规则读取暂不可用');
  expect(rendered()).not.toContain('本次未更新');
});

it('does not mix a new rule snapshot with an old sample result when renewed analysis fails', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  jest.mocked(getAllRules).mockResolvedValueOnce([{ ...rules[0], name: '尚未完成检查的新规则' }]);
  jest.mocked(diagnoseRuleConfiguration).mockReturnValueOnce([]);
  jest.mocked(analyzeRuleSample).mockImplementationOnce(() => { throw new Error('样本重新检查失败'); });
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await settle();
  expect(rendered()).toContain('样本重新检查失败');
  expect(rendered()).toContain('本次未更新');
  expect(rendered()).toContain('本样本实际使用 A规则');
  expect(rendered()).toContain('结构交叉风险');
  expect(rendered()).not.toContain('尚未完成检查的新规则');
});

it('rechecks the latest sample when it changes during a delayed refresh', async () => {
  await typeSample('OLD/100');
  await pressTool('诊断样本');
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await typeSample('NEW/250');
  expect(rendered()).not.toContain('本样本实际使用 A规则');
  jest.mocked(analyzeRuleSample).mockClear().mockReturnValueOnce({ ...result, summary: '新样本检查完成' });
  await act(async () => { finishRead(rules); });
  await settle();
  expect(analyzeRuleSample).toHaveBeenCalledTimes(1);
  expect(analyzeRuleSample).toHaveBeenCalledWith('NEW/250', rules, [], [], undefined);
  expect(rendered()).toContain('新样本检查完成');
});

it('does not restore a result that was cleared while a refresh was pending', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await pressTool('清空');
  jest.mocked(analyzeRuleSample).mockClear();
  await act(async () => { finishRead(rules); });
  await settle();
  expect(analyzeRuleSample).not.toHaveBeenCalled();
  expect(root.root.findByType(TextInput).props.value).toBe('');
  expect(rendered()).not.toContain('本样本实际使用 A规则');
});

it('uses the current expected-rule selection when a previously opened picker completes during refresh', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  await act(async () => { root.root.findAllByType(TouchableOpacity).find(item => item.props.accessibilityLabel === '选择预期规则')!.props.onPress(); });
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await act(async () => { root.root.findByType(RuleOptionPicker).props.onSelect('A'); });
  expect(rendered()).not.toContain('本样本实际使用 A规则');
  jest.mocked(analyzeRuleSample).mockClear();
  await act(async () => { finishRead(rules); });
  await settle();
  expect(analyzeRuleSample).toHaveBeenCalledWith('APM1/100', rules, [], [], 'A');
  expect(rendered()).toContain('与预期一致');
});

it('yields ordinary refresh work to a cancellable frame and cancels it when leaving', async () => {
  let deferredAnalysis: (() => void) | undefined;
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(task => {
    deferredAnalysis = () => task(0);
    return 17;
  });
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  expect(deferredAnalysis).toBeDefined();
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  expect(rendered()).toContain('结构交叉风险');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  expect(cancel).toHaveBeenCalledTimes(1);
  // Even a stale native callback cannot apply the old request after the blur.
  await act(async () => { deferredAnalysis?.(); });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  expect(rendered()).toContain('结构交叉风险');
});

it('retains the first-load indicator until the initial snapshot is available', async () => {
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { root.unmount(); root = TestRenderer.create(<RuleDiagnosticsScreen />); });
  expect(root.root.findByType(FlatList).props.data).toEqual([]);
  expect(rendered()).toContain('正在读取并检查本机规则');
  expect(rendered()).not.toContain('交叉风险 1 项');
  await act(async () => { finishRead(rules); });
  await settle();
  expect(rendered()).toContain('交叉风险 1 项');
  expect(rendered()).not.toContain('正在读取并检查本机规则');
});

it('keeps the newer frame cancellable if an obsolete frame callback still fires', async () => {
  const tasks: (() => void)[] = [];
  const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(task => {
    tasks.push(() => task(0));
    return tasks.length;
  });
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  await act(async () => { root.root.findByType(UiPageHeader).props.onRightPress(); });
  expect(tasks).toHaveLength(2);
  expect(cancel).toHaveBeenCalledWith(1);
  await act(async () => { tasks[0](); });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  expect(cancel).toHaveBeenCalledWith(2);
  await act(async () => { tasks[1](); });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
});

it('waits for this native screen to appear before recomputing a returning editor result', async () => {
  await typeSample('APM1/100');
  await pressTool('诊断样本');
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  jest.mocked(diagnoseRuleConfiguration).mockClear().mockReturnValueOnce([]);
  jest.mocked(analyzeRuleSample).mockClear().mockReturnValueOnce({ ...result, summary: '退场后更新完成' });
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  expect(rendered()).toContain('结构交叉风险');
  expect(rendered()).toContain('本样本实际使用 A规则');
  await transitionEnd(true);
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await transitionEnd(false);
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(1);
  expect(rendered()).toContain('退场后更新完成');
  expect(rendered()).not.toContain('结构交叉风险');
});

it('consumes an appearance event that finishes before the returning database read', async () => {
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  let finishRead!: (value: typeof rules) => void;
  jest.mocked(getAllRules).mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await transitionEnd();
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await act(async () => { finishRead(rules); });
  await settle();
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(1);
  expect(root.root.findByType(UiPageHeader).props.rightLoading).toBe(false);
});

it('cancels a native appearance wait on blur and permits a new focus to update once', async () => {
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  await transitionEnd();
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await settle();
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(1);
});

it('does not wait for a native-stack event when returning in a web browser', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await settle();
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(1);
  expect(root.root.findByType(UiPageHeader).props.rightLoading).toBe(false);
});

it('removes its appearance listener and drops the pending result when unmounted during return', async () => {
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  await act(async () => { root.unmount(); });
  expect(mockTransitionListeners.size).toBe(0);
  await transitionEnd();
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
});

it('does not consume a late previous appearance callback while the editor is still focused', async () => {
  await pressTool('编辑 A规则');
  await act(async () => { mockFocusCleanup?.(); mockFocusCleanup = undefined; });
  mockNavigation.isFocused.mockReturnValue(false);
  await transitionEnd();
  mockNavigation.isFocused.mockReturnValue(true);
  jest.mocked(diagnoseRuleConfiguration).mockClear();
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  expect(diagnoseRuleConfiguration).not.toHaveBeenCalled();
  await transitionEnd();
  expect(diagnoseRuleConfiguration).toHaveBeenCalledTimes(1);
});
