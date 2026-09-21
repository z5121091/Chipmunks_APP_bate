import { useMemo, useState } from 'react';
import { Keyboard, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  analyzeQRCodeRuleDetection,
  AVAILABLE_FIELDS,
  getQRCodeRuleSegmentCount,
  inspectQRCodeRule,
  type QRCodeRule,
} from '@/utils/database';
import { isIgnoredRuleField, visualizeScanCharacters, suggestRuleFieldPrefix, suggestRuleSeparators } from '@/utils/ruleConditions';
import { parseQuantity } from '@/utils/quantity';
import { displayRuleTerminator } from '@/utils/ruleTerminator';
import { useTheme } from '@/hooks/useTheme';
import { RuleOptionPicker } from './RuleOptionPicker';
import { Typography } from '@/constants/theme';

export function RuleSamplePanel({ sample, onSampleChange, rule, rules, configurationError, fieldLabel, onAssign, onSeparatorSelect }: {
  sample: string; onSampleChange: (value: string) => void; rule: QRCodeRule; rules: QRCodeRule[];
  configurationError: string; fieldLabel: (field: string) => string;
  onAssign: (index: number, field: string, count: number, rawValue: string) => void;
  onSeparatorSelect: (separator: string) => void;
}) {
  const { theme } = useTheme();
  const [showHidden, setShowHidden] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [mappingIndex, setMappingIndex] = useState<number | null>(null);
  const [separatorPicker, setSeparatorPicker] = useState(false);
  const [continuousMapping, setContinuousMapping] = useState(false);
  const suggestions = useMemo(() => suggestRuleSeparators(sample, [rule.separator, ...rules.map(item => item.separator)]), [sample, rules, rule.separator]);
  const inspection = useMemo(() => sample && !configurationError ? inspectQRCodeRule(sample, rule) : null,
    [sample, rule, configurationError]);
  const detection = useMemo(() => {
    if (!sample || configurationError || !rule.isActive) return null;
    return analyzeQRCodeRuleDetection(sample, [
      ...rules.filter(other => other.isActive && other.id !== rule.id),
      rule,
    ]);
  }, [sample, rules, rule, configurationError]);
  const structuralMatches = useMemo(() => {
    if (sample || configurationError || !rule.isActive || !rule.separator || rule.fieldOrder.length < 2) return [];
    const segmentCount = getQRCodeRuleSegmentCount(rule);
    return rules.filter(other => other.isActive && other.id !== rule.id &&
      other.separator === rule.separator && getQRCodeRuleSegmentCount(other) === segmentCount);
  }, [sample, rules, rule, configurationError]);
  const otherMatchedRules = detection?.matchedRules.filter(other => other.id !== rule.id) ?? [];
  const conflictingRuleNames = detection?.conflictingRules
    .filter(other => other.id !== rule.id)
    .map(other => other.name) ?? [];
  const selectedOtherRule = detection?.selectedRule && detection.selectedRule.id !== rule.id
    ? detection.selectedRule
    : null;
  const isAutomaticallyDistinguished = Boolean(
    detection?.selectedRule?.id === rule.id && otherMatchedRules.length > 0 && conflictingRuleNames.length === 0
  );
  const quantityIndex = rule.fieldOrder.indexOf('quantity');
  const badQuantity = inspection && quantityIndex >= 0 && parseQuantity(inspection.values[quantityIndex]) === null;
  const quantityPrefixSuggestion = inspection && quantityIndex >= 0
    ? suggestRuleFieldPrefix(inspection.parts[quantityIndex] ?? '', rule.separator)
    : '';
  const choices = AVAILABLE_FIELDS.map(field => ({ value: field, label: fieldLabel(field) }))
    .map(option => ({ ...option, disabled: rule.fieldOrder.some((field, index) => index !== mappingIndex && field === option.value) }));
  const segmentCount = inspection?.parts.length ?? 0;
  const canMap = segmentCount >= 2 && segmentCount <= 128 && !configurationError;
  const closePicker = () => {
    setSeparatorPicker(false);
    setMappingIndex(null);
    setContinuousMapping(false);
  };
  const startMapping = () => {
    Keyboard.dismiss();
    setContinuousMapping(true);
    if (suggestions.length) setSeparatorPicker(true);
    else if (canMap) setMappingIndex(0);
  };
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>扫码样本</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="清空样本" disabled={!sample}
          onPress={() => onSampleChange('')} style={styles.iconButton}>
          <Feather name="trash-2" size={18} color={sample ? theme.primary : theme.textMuted} />
        </TouchableOpacity>
      </View>
      <TextInput accessibilityLabel="扫码样本内容" multiline autoCapitalize="none" autoCorrect={false}
        placeholder="扫描或粘贴原始内容" placeholderTextColor={theme.textMuted} value={sample}
        onChangeText={onSampleChange} maxLength={4096} textAlignVertical="top"
        style={[styles.sample, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.backgroundDefault }]} />
      {!sample && structuralMatches.length > 0 && <View style={styles.noticeRow}>
        <Feather name="info" size={15} color={theme.textSecondary} />
        <Text style={[Typography.caption, { flex: 1, color: theme.textSecondary }]}>发现相同分隔符和段数的规则：{structuralMatches.map(item => item.name).join('、')}。录入扫码样本后会按真实优先级验证。</Text>
      </View>}
      {!!sample && <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="拆分并逐段分配"
          disabled={!!configurationError || (!suggestions.length && !canMap)} onPress={startMapping}
          style={[styles.assignButton, { backgroundColor: theme.primary,
            opacity: configurationError || (!suggestions.length && !canMap) ? 0.4 : 1 }]}>
          <Feather name="list" size={18} color={theme.buttonPrimaryText} />
          <Text style={[Typography.smallMedium, { color: theme.buttonPrimaryText }]}>拆分并逐段分配</Text>
        </TouchableOpacity>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>
            {suggestions.length ? `推荐分隔符：${suggestions[0].label} · ${suggestions[0].fieldCount}段` : '未发现明确分隔符，请手动设置'}
          </Text>
        {!!configurationError && <Text accessibilityRole="alert" style={{ color: theme.error }}>{configurationError}</Text>}
        {inspection && <>
          <View style={[styles.heading, { marginTop: 12 }]}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>拆分结果 · {inspection.parts.length}段</Text>
            {inspection.matched && <Feather accessibilityLabel="匹配通过" name="check-circle" size={18} color={theme.success} />}
          </View>
          {segmentCount < 2 && <Text style={{ color: theme.error }}>当前分隔符未拆出多段，请确认分隔符</Text>}
          {rule.fieldOrder.length === 0
            ? <Text style={{ color: theme.textSecondary }}>字段尚未分配</Text>
            : inspection.errors.length > 0 && <Text style={[Typography.caption, { color: theme.error }]}>{inspection.errors[0]}</Text>}
          {rule.fieldOrder.length > 0 && !rule.fieldOrder.includes('model') && <Text style={{ color: theme.error }}>型号字段尚未分配</Text>}
          {badQuantity && <Text style={{ color: theme.error }}>
            {quantityPrefixSuggestion && !rule.fieldPrefixes?.quantity?.trim()
              ? `数量段检测到候选前缀“${quantityPrefixSuggestion}”，请在字段前缀中确认；未去除前缀时业务扫码无法入账`
              : '数量不是有效的正整数，业务扫码将无法入账'}
          </Text>}
          {Math.max(inspection.parts.length, rule.fieldOrder.length) > 128
            ? <Text style={{ color: theme.error }}>段数超过128，请检查分隔符或缩短样本</Text>
            : Array.from({ length: Math.max(inspection.parts.length, rule.fieldOrder.length) }, (_, index) => {
              const field = rule.fieldOrder[index];
              const configuredPrefix = field ? rule.fieldPrefixes?.[field]?.trim() : '';
              return <View key={index} style={[styles.row, { borderColor: theme.border }]}> 
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text style={[Typography.caption, { color: theme.textMuted }]}>第{index + 1}段</Text>
                  <Text selectable style={[Typography.small, { color: theme.textPrimary }]}>{inspection.parts[index] === undefined ? '【缺少此段】' : inspection.parts[index] || '【空字段】'}</Text>
                  {inspection.values[index] !== inspection.parts[index] && <Text style={[Typography.caption, { color: theme.textSecondary }]}>
                    已去除前缀“{configuredPrefix}”：{inspection.values[index] || '【空字段】'}
                  </Text>}
                </View>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`设置第${index + 1}段字段`}
                    disabled={!canMap || index >= segmentCount}
                    onPress={() => { Keyboard.dismiss(); setContinuousMapping(false); setMappingIndex(index); }} style={styles.mapping}>
                    <Text style={[Typography.smallMedium, { color: theme.primary, flexShrink: 1 }]}>{field ? fieldLabel(field) : '选择字段'}</Text>
                    <Feather name="chevron-down" size={16} color={theme.primary} />
                  </TouchableOpacity>
              </View>;
            })}
        </>}
        {conflictingRuleNames.length > 0 && <Text style={[Typography.caption, { color: theme.error }]}>当前样本与 {conflictingRuleNames.join('、')} 优先级相同，扫码无法自动区分。</Text>}
        {!conflictingRuleNames.length && selectedOtherRule && <Text style={[Typography.caption, { color: theme.warning }]}>当前样本会优先使用“{selectedOtherRule.name}”，本规则不会处理该样本。</Text>}
        {isAutomaticallyDistinguished && <Text style={[Typography.caption, { color: theme.success }]}>已与 {otherMatchedRules.map(other => other.name).join('、')} 自动区分，扫码会优先使用本规则。</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="解析诊断" accessibilityState={{ expanded: showDiagnostics }}
          onPress={() => setShowDiagnostics(value => !value)} style={[styles.heading, { minHeight: 44 }]}>
          <Feather name="activity" size={16} color={theme.textSecondary} />
          <Text style={[Typography.caption, { flex: 1, color: theme.textSecondary }]}>解析诊断</Text>
          <Feather name={showDiagnostics ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textMuted} />
        </TouchableOpacity>
        {showDiagnostics && <View style={{ gap: 8 }}>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>当前分隔符：{rule.separator === ' ' ? '空格' : displayRuleTerminator(rule.separator) || '未设置'}</Text>
          <View style={styles.heading}>
            <Text style={[Typography.small, { color: theme.textSecondary }]}>显示隐藏字符</Text>
            <Switch accessibilityLabel="显示隐藏字符" value={showHidden} onValueChange={setShowHidden} />
          </View>
          {showHidden && <Text selectable style={[styles.raw, { color: theme.textSecondary }]}>{visualizeScanCharacters(sample)}</Text>}
          {inspection?.errors.map((error, index) => <Text key={index} style={[Typography.caption, { color: theme.error }]}>{error}</Text>)}
        </View>}
      </>}
      {(separatorPicker || mappingIndex !== null) && <RuleOptionPicker
        title={separatorPicker ? '确认分隔符' : `第${(mappingIndex ?? 0) + 1} / ${segmentCount}段`}
        detail={separatorPicker ? undefined : inspection?.parts[mappingIndex ?? 0]}
        value={separatorPicker ? rule.separator
          : isIgnoredRuleField(rule.fieldOrder[mappingIndex ?? 0] ?? '') ? '__ignore__' : rule.fieldOrder[mappingIndex ?? 0]}
        options={separatorPicker ? suggestions.map((suggestion, index) => ({ value: suggestion.value,
          label: `${suggestion.label} · ${suggestion.fieldCount}段${index === 0 ? '（推荐）' : ''}`,
          disabled: suggestion.fieldCount > 128,
        })) : [{ value: '__ignore__', label: '忽略此段' }, ...choices]}
        onPrevious={!separatorPicker && continuousMapping && (mappingIndex ?? 0) > 0
          ? () => setMappingIndex(index => Math.max(0, (index ?? 0) - 1)) : undefined}
        onClose={closePicker} onSelect={value => {
          if (separatorPicker) {
            const count = inspectQRCodeRule(sample, { ...rule, separator: value }).parts.length;
            onSeparatorSelect(value);
            setSeparatorPicker(false);
            setMappingIndex(count >= 2 && count <= 128 ? 0 : null);
          } else if (mappingIndex !== null && canMap) {
            onAssign(
              mappingIndex,
              value,
              Math.max(segmentCount, rule.fieldOrder.length),
              inspection?.parts[mappingIndex] ?? '',
            );
            if (continuousMapping && mappingIndex + 1 < segmentCount) setMappingIndex(mappingIndex + 1);
            else closePicker();
          }
        }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 12, gap: 8 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  title: { ...Typography.smallMedium },
  sample: { ...Typography.small, minHeight: 88, maxHeight: 160, padding: 12, borderWidth: 1, borderRadius: 8 },
  raw: { ...Typography.caption },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  mapping: { minHeight: 44, width: 104, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  assignButton: { minHeight: 44, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
