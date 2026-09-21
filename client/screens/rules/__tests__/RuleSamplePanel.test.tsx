import { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Keyboard, Text, TouchableOpacity } from 'react-native';
import { RuleSamplePanel } from '../RuleSamplePanel';
import { RuleOptionPicker } from '../RuleOptionPicker';
import { FIELD_LABELS, parseWithRule, type QRCodeRule } from '@/utils/database';
import { isIgnoredRuleField, nextIgnoredRuleField } from '@/utils/ruleConditions';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ theme: {}, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Icon' }));
jest.mock('@/components/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/AppModalHeader', () => ({ AppModalHeader: 'Header' }));

const base: QRCodeRule = {
  id: 'draft', name: 'Sample', description: '', separator: '/', fieldOrder: [],
  isActive: true, created_at: '', updated_at: '',
};
let root: TestRenderer.ReactTestRenderer;
const latest = (): QRCodeRule => root.root.findByType(RuleSamplePanel).props.rule;
function Harness({ sample, initial = base, rules = [] }: { sample: string; initial?: QRCodeRule; rules?: QRCodeRule[] }) {
  const [rule, setRule] = useState(initial);
  return <RuleSamplePanel sample={sample} onSampleChange={() => undefined} rule={rule} rules={rules}
    configurationError="" fieldLabel={field => isIgnoredRuleField(field) ? '忽略此段' : FIELD_LABELS[field]}
    onSeparatorSelect={separator => setRule(current => ({ ...current, separator }))}
    onAssign={(index, field, count) => setRule(current => {
      const fieldOrder = [...current.fieldOrder];
      while (fieldOrder.length < count) fieldOrder.push(nextIgnoredRuleField(fieldOrder));
      fieldOrder[index] = field === '__ignore__'
        ? isIgnoredRuleField(fieldOrder[index]) ? fieldOrder[index] : nextIgnoredRuleField(fieldOrder)
        : field;
      return { ...current, fieldOrder };
    })} />;
}
const button = (label: string) => root.root.findAllByType(TouchableOpacity)
  .find(item => item.props.accessibilityLabel === label)!;
const picker = () => root.root.findByType(RuleOptionPicker);
const press = async (label: string) => {
  expect(button(label).props.disabled).not.toBe(true);
  await act(async () => { button(label).props.onPress(); });
};
const choose = async (value: string) => {
  expect(picker().props.options.find((option: { value: string }) => option.value === value)?.disabled).not.toBe(true);
  await act(async () => { picker().props.onSelect(value); });
};
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { if (root) await act(async () => { root.unmount(); }); jest.restoreAllMocks(); });

it('confirms the separator then assigns every segment continuously without using the lower field selector', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const sample = 'MODEL;LOT;PKG;V1;100;2026-09-17;TRACE;BOX;unused;unused2';
  await act(async () => { root = TestRenderer.create(<Harness sample={sample} />); });
  expect(button('设置第1段字段').props.disabled).toBe(true);
  await press('拆分并逐段分配');
  expect(picker().props.title).toBe('确认分隔符');
  expect(latest().separator).toBe('/');
  await choose(';');
  const fields = ['model', 'batch', 'package', 'version', 'quantity', 'productionDate', 'traceNo', 'sourceNo', '__ignore__', '__ignore__'];
  for (let index = 0; index < fields.length; index++) {
    expect(picker().props.title).toBe(`第${index + 1} / 10段`);
    expect(picker().props.detail).toBe(sample.split(';')[index]);
    if (index) expect(picker().props.options.find((option: { value: string }) => option.value === 'model').disabled).toBe(true);
    await choose(fields[index]);
  }
  expect(root.root.findAllByType(RuleOptionPicker)).toHaveLength(0);
  expect(latest().fieldOrder.slice(0, 8)).toEqual(fields.slice(0, 8));
  expect(latest().fieldOrder.slice(8).every(isIgnoredRuleField)).toBe(true);
  expect(parseWithRule(sample, latest()).standardFields).toMatchObject({ model: 'MODEL', batch: 'LOT', quantity: '100', sourceNo: 'BOX' });
  expect(dismiss).toHaveBeenCalled();
});

it('supports backtracking, dismissing mid-flow, and editing the second or third segment directly', async () => {
  await act(async () => { root = TestRenderer.create(<Harness sample="MODEL;LOT;100" />); });
  await press('拆分并逐段分配');
  await choose(';');
  await choose('model');
  await act(async () => { picker().props.onPrevious(); });
  expect(picker().props.title).toBe('第1 / 3段');
  expect(picker().props.options.find((option: { value: string }) => option.value === 'model').disabled).toBe(false);
  await choose('model');
  await act(async () => { picker().props.onClose(); });
  await press('设置第2段字段');
  await choose('batch');
  expect(root.root.findAllByType(RuleOptionPicker)).toHaveLength(0);
  await press('设置第3段字段');
  await choose('quantity');
  expect(latest().fieldOrder).toEqual(['model', 'batch', 'quantity']);
});

it('includes a manually configured separator and keeps empty middle segments and ignored identifiers', async () => {
  const initial = { ...base, separator: '~', fieldOrder: ['model', 'ignore:8', 'quantity'] };
  await act(async () => { root = TestRenderer.create(<Harness sample="MODEL~~100" initial={initial} />); });
  await press('拆分并逐段分配');
  await choose('~');
  await choose('model');
  expect(picker().props.detail).toBe('');
  await choose('__ignore__');
  await choose('quantity');
  expect(latest().fieldOrder).toEqual(initial.fieldOrder);
});

it('does not offer a non-responsive mapping dialog when a terminator removes the split content', async () => {
  await act(async () => { root = TestRenderer.create(<Harness sample="MODEL;END" initial={{ ...base, terminator: ';END' }} />); });
  await press('拆分并逐段分配');
  await choose(';');
  expect(root.root.findAllByType(RuleOptionPicker)).toHaveLength(0);
  expect(button('设置第1段字段').props.disabled).toBe(true);
});

it('shows a non-blocking sample recommendation for matching structures before a sample is entered', async () => {
  const existing: QRCodeRule = {
    ...base,
    id: 'existing',
    name: 'Existing',
    fieldOrder: ['model', 'batch', 'quantity'],
  };
  const initial: QRCodeRule = {
    ...base,
    fieldOrder: ['model', 'package', 'quantity'],
  };

  await act(async () => { root = TestRenderer.create(<Harness sample="" initial={initial} rules={[existing]} />); });
  const textContent = (value: unknown): string => Array.isArray(value)
    ? value.map(textContent).join('')
    : String(value ?? '');
  expect(root.root.findAllByType(Text).some(item =>
    textContent(item.props.children).includes('发现相同分隔符和段数的规则：Existing')
  )).toBe(true);
});
