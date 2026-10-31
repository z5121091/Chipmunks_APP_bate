import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import type { ParamListBase } from 'expo-router/react-navigation';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppSegmentedOptions } from '@/components/AppSegmentedOptions';
import { UiPageHeader, UiToolbarButton } from '@/components/UiRedesign';
import { RuleOptionPicker } from '@/screens/rules/RuleOptionPicker';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { BorderRadius, Spacing, Typography, type Theme } from '@/constants/theme';
import {
  FIELD_LABELS, getAllInventoryBindings, getAllRules, getInventorySuppliers,
  type InventoryBinding, type InventorySupplier, type QRCodeRule,
} from '@/utils/database';
import {
  analyzeRuleSample, diagnoseRuleConfiguration,
  type RuleDiagnosticIssue, type RuleSampleAnalysis, type RuleSampleCandidate,
} from '@/utils/ruleDiagnostics';
import { visualizeScanCharacters } from '@/utils/ruleConditions';

type RuleSnapshot = { rules: QRCodeRule[]; bindings: InventoryBinding[]; suppliers: InventorySupplier[] };
const EMPTY_SNAPSHOT: RuleSnapshot = { rules: [], bindings: [], suppliers: [] };
const SEVERITY_LABELS = { error: '明确问题', warning: '交叉风险' } as const;
const SUPPLIER_LABELS = { consistent: '供应商一致', mismatch: '供应商不一致', unlinked: '规则未关联供应商', unknown: '暂时无法核验供应商' } as const;
const BINDING_LABELS = { exact: '精确绑定', generic: '通用版本绑定', none: '未找到物料绑定', ambiguous: '物料绑定不唯一' } as const;

export default function RuleDiagnosticsScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const params = useSafeSearchParams<{ expectedRuleId?: string }>();
  const [snapshot, setSnapshot] = useState<RuleSnapshot>(EMPTY_SNAPSHOT);
  const [issues, setIssues] = useState<RuleDiagnosticIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<'all' | RuleDiagnosticIssue['severity']>('all');
  const [sample, setSample] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [result, setResult] = useState<RuleSampleAnalysis | null>(null);
  const [expectedRuleId, setExpectedRuleId] = useState(typeof params.expectedRuleId === 'string' ? params.expectedRuleId : '');
  const [rulePicker, setRulePicker] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [candidateLimit, setCandidateLimit] = useState(6);
  const requestRef = useRef(0);
  const loadingRef = useRef(true);
  const loadErrorRef = useRef('');
  const pendingAnalysisRef = useRef<{ cancel: () => void; afterTransition?: () => void } | null>(null);
  const waitingForEditorReturnRef = useRef(false);
  const sampleRef = useRef('');
  const expectedRuleRef = useRef(expectedRuleId);

  useEffect(() => navigation.addListener('transitionEnd', event => {
    if (event.data.closing || !navigation.isFocused()) return;
    waitingForEditorReturnRef.current = false;
    pendingAnalysisRef.current?.afterTransition?.();
  }), [navigation]);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    pendingAnalysisRef.current?.cancel();
    pendingAnalysisRef.current = null;
    loadingRef.current = true;
    loadErrorRef.current = '';
    setLoading(true);
    setLoadError('');
    try {
      const [rules, bindings, suppliers] = await Promise.all([
        getAllRules(), getAllInventoryBindings(), getInventorySuppliers(),
      ]);
      if (request !== requestRef.current) return;
      // Native-stack emits this screen's appearance completion on return. Wait
      // only after opening its linked editor; first loads and web cannot deadlock
      // waiting for an animation event that they may never receive.
      await new Promise<void>(resolve => {
        let completed = false;
        const complete = () => {
          if (completed) return;
          completed = true;
          if (request === requestRef.current) pendingAnalysisRef.current = null;
          resolve();
        };
        if (Platform.OS !== 'web' && waitingForEditorReturnRef.current) {
          pendingAnalysisRef.current = { cancel: complete, afterTransition: complete };
        } else {
          const frame = requestAnimationFrame(complete);
          if (!completed) pendingAnalysisRef.current = { cancel: () => { cancelAnimationFrame(frame); complete(); } };
        }
      });
      if (request !== requestRef.current) return;
      const nextIssues = diagnoseRuleConfiguration(rules);
      const supplierIds = new Set(suppliers.map(item => item.id));
      for (const rule of rules.filter(item => item.isActive && item.supplierId && !supplierIds.has(item.supplierId))) {
        nextIssues.push({ id: `supplier-missing:${rule.id}`, severity: 'error', kind: 'missing-supplier',
          title: '规则供应商关联失效', detail: `「${rule.name}」关联的供应商不存在，请重新选择所属供应商。`, ruleIds: [rule.id] });
      }
      // Compute against the latest input before committing the new snapshot. A
      // failed recheck must not mix new rules with the previous sample result.
      const nextResult = sampleRef.current.trim()
        ? analyzeRuleSample(sampleRef.current, rules, bindings, suppliers, expectedRuleRef.current || undefined)
        : null;
      setSnapshot({ rules, bindings, suppliers });
      setIssues(nextIssues);
      setResult(nextResult);
      setSampleError('');
      setHasSnapshot(true);
    } catch (error) {
      if (request === requestRef.current) {
        const message = error instanceof Error ? error.message : '解析诊断加载失败，请重试';
        loadErrorRef.current = message;
        setLoadError(message);
      }
    } finally {
      if (request === requestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      requestRef.current += 1;
      pendingAnalysisRef.current?.cancel();
      pendingAnalysisRef.current = null;
    };
  }, [load]));

  const rulesById = useMemo(() => new Map(snapshot.rules.map(rule => [rule.id, rule])), [snapshot.rules]);
  const activeCount = snapshot.rules.filter(rule => rule.isActive).length;
  const disabledRules = snapshot.rules.filter(rule => !rule.isActive);
  const visibleIssues = useMemo(() => filter === 'all' ? issues : issues.filter(issue => issue.severity === filter), [filter, issues]);
  const candidates = useMemo(() => result ? result.candidates.filter(candidate => candidate.isActive || candidate.ruleId === expectedRuleId).slice().sort((a, b) => {
    const score = (item: RuleSampleCandidate) => item.selected ? 0 : item.ruleId === expectedRuleId ? 1 : item.matched ? 2 : 3;
    return score(a) - score(b);
  }) : [], [expectedRuleId, result]);

  const editRule = (id: string) => {
    if (loadingRef.current || loadErrorRef.current) return;
    waitingForEditorReturnRef.current = Platform.OS !== 'web';
    try {
      router.push('/rules', { editRuleId: id, returnTo: 'rule-diagnostics' });
    } catch (error) {
      waitingForEditorReturnRef.current = false;
      throw error;
    }
  };
  const runSample = () => {
    if (loadingRef.current || loadErrorRef.current) return;
    Keyboard.dismiss();
    if (!sample.trim()) { setSampleError('请先扫描或粘贴二维码内容'); return; }
    try {
      setResult(analyzeRuleSample(sample, snapshot.rules, snapshot.bindings, snapshot.suppliers, expectedRuleId || undefined));
      setSampleError('');
      setCandidateLimit(6);
    } catch (error) {
      setResult(null);
      setSampleError(error instanceof Error ? error.message : '样本诊断失败，请检查规则配置');
    }
  };

  const candidateCard = (candidate: RuleSampleCandidate) => (
    <View key={candidate.ruleId} style={styles.candidate}>
      <Text style={styles.title}>{candidate.ruleName}{!candidate.isActive ? ' · 已停用，不参与选择' : candidate.selected ? ' · 实际选中' : candidate.matched ? ' · 可匹配' : ' · 未匹配'}</Text>
      {!candidate.matched ? <Text style={styles.problemText}>{candidate.reasons.join('\n') || '未通过规则格式检查'}</Text> : null}
      {candidate.matched ? <>
        {Object.entries(candidate.fields).filter(([, value]) => value !== '').map(([field, value]) => (
          <View key={field} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{FIELD_LABELS[field] || field}</Text>
            <Text selectable style={styles.fieldValue}>{value}</Text>
          </View>
        ))}
        {candidate.quantityValid === false ? <Text style={styles.problemText}>数量不是有效的正整数，业务扫码不能录入。</Text> : null}
        <Text style={styles.detail}>{BINDING_LABELS[candidate.bindingMatch]}{candidate.binding ? ` · ${candidate.binding.inventory_code}` : ''}</Text>
        <Text style={candidate.supplierStatus === 'mismatch' ? styles.problemText : styles.detail}>{SUPPLIER_LABELS[candidate.supplierStatus]}</Text>
        {candidate.supplierStatus === 'mismatch' ? <Text style={styles.problemText}>选中此规则时，业务扫码会因供应商不一致而拦截，请先核对配置。</Text> : null}
        {rulesById.get(candidate.ruleId)?.supplierId && !candidate.ruleSupplierName ? <Text style={styles.problemText}>正式供应商关联已失效，业务扫码会拦截，请重新选择供应商。</Text> : null}
        <Text style={styles.detail}>规则供应商：{candidate.ruleSupplierName || '未关联'}{`\n`}物料供应商：{candidate.materialSupplierName || '未设置或未找到物料'}</Text>
        {candidate.priorityExplanation.map((text, index) => <Text key={index} style={styles.detail}>{text}</Text>)}
      </> : null}
      <UiToolbarButton label={`编辑 ${candidate.ruleName}`} icon="edit-2" containerStyle={styles.fullWidthAction} variant="secondary" disabled={loading || !!loadError} onPress={() => editRule(candidate.ruleId)} />
    </View>
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'} disableAutoScroll>
      <UiPageHeader title="解析诊断" onBack={() => router.back()} rightIcon="refresh-cw" rightLabel="重新检查规则" rightLoading={loading} onRightPress={() => { void load(); }} />
      <FlatList
        style={styles.list}
        data={hasSnapshot ? visibleIssues : []}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        ListHeaderComponent={
          <View style={styles.sections}>
            <View style={styles.card}>
              <Text style={styles.title}>规则检查</Text>
              <Text numberOfLines={1} style={styles.detail}>{loading ? hasSnapshot ? '正在更新检查 · 暂显示上次结果' : '正在读取并检查本机规则…' : loadError ? hasSnapshot ? '本次未更新 · 以下为上次检查结果' : '本次检查未完成' : `已检查 ${activeCount} 条启用规则 · ${disabledRules.length} 条已停用`}</Text>
              {hasSnapshot ? <>
                <Text style={styles.summary}>{Object.entries(SEVERITY_LABELS).map(([severity, label]) => `${label} ${issues.filter(issue => issue.severity === severity).length} 项`).join(' · ')}</Text>
                <Text style={styles.detail}>配置检查用于发现已知问题与交叉风险。真实二维码是否会被其他规则识别，可在下方扫描验证。</Text>
                {disabledRules.length > 0 ? <Text style={styles.detail}>已停用，不参与实际选择：{disabledRules.map(rule => rule.name).join('、')}</Text> : null}
              </> : null}
              {loadError ? <><Text accessibilityRole="alert" style={styles.problemText}>{loadError}</Text><UiToolbarButton label="重试加载" icon="refresh-cw" containerStyle={styles.fullWidthAction} variant="secondary" onPress={() => { void load(); }} /></> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.title}>扫码验证</Text>
              <Text style={styles.detail}>扫描或粘贴后点击诊断；样本仅用于本页检查，不保存为出入库、打印或其他业务记录。</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="选择预期规则" style={styles.select} onPress={() => { Keyboard.dismiss(); setRulePicker(true); }} disabled={loading || !!loadError}>
                <Text style={styles.selectText}>预期规则：{expectedRuleId ? rulesById.get(expectedRuleId)?.name || '原规则已不存在，请重新选择' : '不指定'}</Text>
                <Feather name="chevron-down" size={18} color={theme.textMuted} />
              </TouchableOpacity>
              <TextInput accessibilityLabel="诊断二维码内容" multiline value={sample} maxLength={4096} autoCorrect={false} autoCapitalize="none" textAlignVertical="top" placeholder="扫描或粘贴完整二维码" placeholderTextColor={theme.textMuted} style={styles.sampleInput} onChangeText={value => { sampleRef.current = value; setSample(value); setResult(null); setSampleError(''); }} />
              <View style={styles.actions}>
                <UiToolbarButton label="诊断样本" icon="search" containerStyle={styles.rowAction} variant="primary" disabled={loading || !!loadError} onPress={runSample} />
                <UiToolbarButton label="清空" icon="trash-2" containerStyle={styles.rowAction} variant="secondary" onPress={() => { sampleRef.current = ''; setSample(''); setResult(null); setSampleError(''); }} />
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="显示诊断隐藏字符" accessibilityState={{ expanded: showHidden }} onPress={() => setShowHidden(value => !value)} style={styles.smallAction}>
                <Text style={styles.detail}>{showHidden ? '收起' : '显示'}隐藏字符（回车、换行、空格）</Text>
              </TouchableOpacity>
              {showHidden && sample ? <Text selectable style={styles.raw}>{visualizeScanCharacters(sample)}</Text> : null}
              {sampleError ? <Text accessibilityRole="alert" style={styles.problemText}>{sampleError}</Text> : null}
            </View>

            {result ? <View style={styles.card}>
              <Text style={styles.title}>本次样本结果</Text>
              <Text accessibilityRole="alert" style={styles.summary}>{result.summary}</Text>
              <Text style={styles.detail}>实际选择：{result.selectedRuleId ? rulesById.get(result.selectedRuleId)?.name || result.selectedRuleId : result.conflictingRuleIds.length ? '存在同优先级冲突，未选择规则' : '未匹配到规则'}</Text>
              {expectedRuleId ? <Text style={result.expectedStatus === 'matched' ? styles.detail : styles.problemText}>预期核对：{({ 'not-set': '未指定', matched: '与预期一致', different: '实际选择了其他规则', conflict: '同优先级冲突', unmatched: '预期规则未被选中' })[result.expectedStatus]}</Text> : null}
              {result.priorityExplanation.map((text, index) => <Text key={index} style={styles.detail}>{text}</Text>)}
              <Text style={styles.detail}>已检查全部启用规则；下面按实际选中、预期、其他匹配、未匹配的顺序展示各规则解析结果。</Text>
              <Text style={styles.detail}>“实际选择”指解析规则选择。业务保存还会核对供应商、ERP 在单、数量和追溯码等信息。</Text>
              {candidates.slice(0, candidateLimit).map(candidateCard)}
              {candidates.length > candidateLimit ? <UiToolbarButton label={`再看 ${Math.min(6, candidates.length - candidateLimit)} 条候选`} icon="chevrons-down" containerStyle={styles.fullWidthAction} variant="secondary" onPress={() => setCandidateLimit(value => value + 6)} /> : null}
            </View> : null}

            <View style={styles.card}>
              <Text style={styles.title}>配置检查结果</Text>
              <AppSegmentedOptions options={[{ value: 'all', label: '全部' }, { value: 'error', label: '问题' }, { value: 'warning', label: '风险' }]} value={filter} onChange={setFilter} />
            </View>
          </View>
        }
        ListEmptyComponent={
          <AppEmptyState compact icon="activity" loading={!hasSnapshot && loading} title={!hasSnapshot && loading ? '正在检查规则' : !hasSnapshot && loadError ? '请重试检查' : issues.length ? '此分类没有检查项' : activeCount ? '本次配置检查未发现已知问题' : '暂无启用规则'} description={!hasSnapshot && loading ? '本机检查，无需访问 ERP' : '可使用真实二维码继续验证字段、优先级和供应商归属'} />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={[styles.issueLabel, { color: item.severity === 'error' ? theme.error : theme.warning }]}>{SEVERITY_LABELS[item.severity]}</Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text selectable style={styles.detail}>{item.detail}</Text>
            <View style={styles.issueActions}>
              {item.ruleIds.map(id => rulesById.has(id) ? <UiToolbarButton key={id} label={`编辑 ${rulesById.get(id)!.name}`} icon="edit-2" containerStyle={styles.fullWidthAction} variant="secondary" disabled={loading || !!loadError} onPress={() => editRule(id)} /> : null)}
            </View>
          </View>
        )}
      />
      {rulePicker ? <RuleOptionPicker title="这张码应该属于哪条规则" value={expectedRuleId} options={[{ value: '', label: '不指定预期规则' }, ...snapshot.rules.map(rule => ({ value: rule.id, label: `${rule.name}${rule.isActive ? '' : '（已停用）'}` }))]} onClose={() => setRulePicker(false)} onSelect={value => { expectedRuleRef.current = value; setExpectedRuleId(value); setResult(null); setRulePicker(false); }} /> : null}
    </Screen>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  list: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm, paddingBottom: Spacing['2xl'] },
  sections: { gap: Spacing.sm, marginBottom: Spacing.sm },
  card: { backgroundColor: theme.backgroundDefault, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: theme.border, padding: Spacing.md, gap: Spacing.sm },
  title: { ...Typography.bodyMedium, color: theme.textPrimary, fontWeight: '700' },
  detail: { ...Typography.caption, color: theme.textSecondary, lineHeight: 19 },
  summary: { ...Typography.smallMedium, color: theme.textPrimary, lineHeight: 21 },
  problemText: { ...Typography.caption, color: theme.error, lineHeight: 19 },
  select: { borderWidth: 1, borderColor: theme.border, borderRadius: BorderRadius.md, backgroundColor: theme.backgroundTertiary, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, minHeight: 44 },
  selectText: { ...Typography.small, color: theme.textPrimary, flex: 1 },
  sampleInput: { ...Typography.small, color: theme.textPrimary, backgroundColor: theme.backgroundTertiary, borderWidth: 1, borderColor: theme.border, borderRadius: BorderRadius.md, minHeight: 100, maxHeight: 180, padding: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  rowAction: { flex: 1, minWidth: 0 },
  fullWidthAction: { width: '100%', minWidth: 0, alignSelf: 'stretch' },
  smallAction: { minHeight: 44, justifyContent: 'center' },
  raw: { ...Typography.caption, color: theme.textSecondary, lineHeight: 19 },
  candidate: { borderWidth: 1, borderColor: theme.borderLight, borderRadius: BorderRadius.md, padding: Spacing.sm, gap: Spacing.xs },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  fieldLabel: { ...Typography.caption, color: theme.textMuted, width: 68 },
  fieldValue: { ...Typography.caption, color: theme.textPrimary, flex: 1, minWidth: 0, lineHeight: 19 },
  issueLabel: { ...Typography.captionMedium },
  issueActions: { gap: Spacing.sm, alignItems: 'stretch' },
});
