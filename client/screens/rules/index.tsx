import { useState, useCallback, useRef, useMemo, useEffect, type ElementRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  TextInput,
  Modal,
  Keyboard,
  ScrollView,
  Platform,
  UIManager,
  findNodeHandle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  LinearTransition,
} from 'react-native-reanimated';
import {
  getAllRules,
  addRule,
  updateRule,
  deleteRule,
  setRulesDisplayOrder,
  QRCodeRule,
  FIELD_LABELS,
  AVAILABLE_FIELDS,
  MatchCondition,
  analyzeQRCodeRuleDetection,
  inspectQRCodeRule,
  normalizeQRCodeRuleName,
} from '@/utils/database';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppModalHeader } from '@/components/AppModalHeader';
import { AppModalActions } from '@/components/AppModalActions';
import { AppSegmentedOptions } from '@/components/AppSegmentedOptions';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { createStyles } from './styles';
import { logger } from '@/utils/logger';
import { Spacing } from '@/constants/theme';
import { rf } from '@/utils/responsive';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { useToast } from '@/utils/toast';
import { decodeRuleTerminator, displayRuleTerminator } from '@/utils/ruleTerminator';
import {
  CONDITION_OPERATORS,
  type ConditionOperator,
  isIgnoredRuleField,
  nextIgnoredRuleField,
  suggestRuleFieldPrefix,
} from '@/utils/ruleConditions';
import { RuleSamplePanel } from './RuleSamplePanel';
import { RuleOptionPicker } from './RuleOptionPicker';

const SEPARATOR_VALUES: Record<string, string> = {
  '{ * }': '{}',
  '( * )': '()',
  '[ * ]': '[]',
  '< * >': '<>',
  回车换行: '\r\n',
  换行: '\n',
  回车: '\r',
  制表符: '\t',
  GS: '\x1D',
  RS: '\x1E',
};

const EDITOR_SECTIONS = {
  main: '规则',
  format: '分隔符与结束符',
  fields: '手动字段顺序',
  prefixes: '字段前缀',
  conditions: '识别条件',
};

const SORT_LAYOUT_TRANSITION = LinearTransition.springify().damping(140).stiffness(1600).mass(4);
const SORT_ROW_GAP = Spacing.sm;

export default function RulesScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const showRuleLoadError = alert.showError;
  const { showToast, ToastContainer } = useToast();

  const [rules, setRules] = useState<QRCodeRule[]>([]);
  // 调整顺序模式
  const [sortMode, setSortMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef<string[]>([]);
  const heightsRef = useRef<Record<string, number>>({});
  const dragIndexRef = useRef(-1);
  const accumulatedRef = useRef(0);
  const dragY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableIdRef = useRef<string | null>(null);
  const scrollViewRef = useRef<ElementRef<typeof ScrollView>>(null);
  const scrollOffsetRef = useRef(0);
  const dragStartScrollOffsetRef = useRef(0);
  const lastTranslationYRef = useRef(0);
  const listLayoutRef = useRef<{ top: number; height: number } | null>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRule, setEditingRule] = useState<QRCodeRule | null>(null);
  const [editorSection, setEditorSection] = useState<keyof typeof EDITOR_SECTIONS>('main');
  const [draftPrefixes, setDraftPrefixes] = useState<Record<string, string>>({});
  const openSection = (section: keyof typeof EDITOR_SECTIONS) => {
    Keyboard.dismiss();
    setEditorSection(section);
  };
  const closeEditor = () => {
    if (saving) return;
    if (editorSection !== 'main') openSection('main');
    else setModalVisible(false);
  };

  // 规则名称输入框 ref
  const ruleNameInputRef = useRef<TextInput>(null);

  // 表单状态
  const [ruleName, setRuleName] = useState('');
  const [ruleNameError, setRuleNameError] = useState<string | null>(null);
  const [ruleSeparator, setRuleSeparator] = useState('/');
  const [customSeparator, setCustomSeparator] = useState('');
  const [ruleTerminator, setRuleTerminator] = useState('');
  const [terminatorMode, setTerminatorMode] = useState<'auto' | 'custom'>('auto');
  const [customLeftBracket, setCustomLeftBracket] = useState('');
  const [customRightBracket, setCustomRightBracket] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [matchConditions, setMatchConditions] = useState<MatchCondition[]>([]);
  const [newConditionIndex, setNewConditionIndex] = useState('');
  const [newConditionKeyword, setNewConditionKeyword] = useState('');
  const [newConditionOperator, setNewConditionOperator] = useState<ConditionOperator>('contains');
  const [conditionPicker, setConditionPicker] = useState<'field' | 'operator' | null>(null);
  const [sample, setSample] = useState('');
  const finalEditorSeparator =
    ruleSeparator === 'custom'
      ? customSeparator.trim()
      : ruleSeparator === 'special'
        ? customLeftBracket.trim() + customRightBracket.trim()
        : SEPARATOR_VALUES[ruleSeparator] || ruleSeparator;
  const draft = useMemo(() => {
    let terminator = '';
    let error = '';
    try {
      if (terminatorMode === 'custom') {
        terminator = decodeRuleTerminator(ruleTerminator);
        if (!terminator) error = '请输入自定义结束符，或选择自动处理';
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '结束符格式无效';
    }
    if (!finalEditorSeparator) error = '请选择或填写分隔符';
    const rule: QRCodeRule = {
      id: editingRule?.id ?? '__draft__',
      name: ruleName,
      description: '',
      separator: finalEditorSeparator,
      terminator,
      fieldOrder: selectedFields,
      matchConditions,
      fieldPrefixes: Object.fromEntries(
        Object.entries(draftPrefixes).filter(([field]) => selectedFields.includes(field))
      ),
      isActive: editingRule?.isActive ?? true,
      created_at: '',
      updated_at: '',
    };
    return { rule, error };
  }, [
    editingRule,
    ruleName,
    finalEditorSeparator,
    terminatorMode,
    ruleTerminator,
    selectedFields,
    matchConditions,
    draftPrefixes,
  ]);

  // 加载数据
  const loadData = useCallback(async () => {
    try {
      const rulesData = await getAllRules();
      setRules(rulesData);
    } catch (error) {
      logger.error('加载解析规则失败:', error);
      showRuleLoadError('解析规则加载失败，请重试');
    }
  }, [showRuleLoadError]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  // 打开新增弹窗
  const handleAddRule = () => {
    setEditorSection('main');
    setDraftPrefixes({});
    setSample('');
    setNewConditionOperator('contains');
    setConditionPicker(null);
    setEditingRule(null);
    setRuleName('');
    setRuleNameError(null);

    setRuleSeparator('/');
    setCustomSeparator('');
    setRuleTerminator('');
    setTerminatorMode('auto');
    setCustomLeftBracket('');
    setCustomRightBracket('');
    setSelectedFields([]);
    setSupplierName('');
    setMatchConditions([]);
    setNewConditionIndex('');
    setNewConditionKeyword('');
    setModalVisible(true);
  };

  // 打开编辑弹窗
  const handleEditRule = (rule: QRCodeRule) => {
    setEditorSection('main');
    setDraftPrefixes(rule.fieldPrefixes || {});
    setSample('');
    setNewConditionIndex('');
    setNewConditionKeyword('');
    setNewConditionOperator('contains');
    setConditionPicker(null);
    setEditingRule(rule);
    setRuleName(rule.name);
    setRuleNameError(null);
    setRuleTerminator(displayRuleTerminator(rule.terminator || ''));
    setTerminatorMode(rule.terminator ? 'custom' : 'auto');
    setCustomLeftBracket('');
    setCustomRightBracket('');

    const separatorToDisplay: Record<string, string> = {
      '{}': '{ * }',
      '()': '( * )',
      '[]': '[ * ]',
      '<>': '< * >',
      '\r\n': '回车换行',
      '\n': '换行',
      '\r': '回车',
      '\t': '制表符',
      '\x1D': 'GS',
      '\x1E': 'RS',
    };

    const presetSeparators = [
      '/',
      '|',
      ',',
      '*',
      '#',
      ' ',
      ';',
      ':',
      '{}',
      '()',
      '[]',
      '<>',
      '\r\n',
      '\n',
      '\r',
      '\t',
      '\x1D',
      '\x1E',
    ];
    if (presetSeparators.includes(rule.separator)) {
      setRuleSeparator(separatorToDisplay[rule.separator] || rule.separator);
      setCustomSeparator('');
    } else if (
      rule.separator.includes('{') ||
      rule.separator.includes('}') ||
      rule.separator.includes('(') ||
      rule.separator.includes(')') ||
      rule.separator.includes('[') ||
      rule.separator.includes(']')
    ) {
      // 特殊格式：包含包裹字符 { } ( ) [ ]
      setRuleSeparator('special');
      setCustomLeftBracket(rule.separator[0]);
      setCustomRightBracket(rule.separator[rule.separator.length - 1]);
      setCustomSeparator('');
    } else {
      // 其他分隔符（如 ||、:: 等）→ 自定义
      setRuleSeparator('custom');
      setCustomSeparator(rule.separator);
    }

    setSelectedFields(rule.fieldOrder || []);

    setSupplierName(rule.supplierName || '');
    setMatchConditions(rule.matchConditions || []);

    setModalVisible(true);
  };

  // 添加匹配条件
  const handleAddMatchCondition = () => {
    const index = parseInt(newConditionIndex, 10);
    if (isNaN(index) || index < 1 || index > selectedFields.length) {
      alert.showWarning('请选择字段');
      return;
    }
    if (!newConditionKeyword.trim()) {
      alert.showWarning('请输入关键字');
      return;
    }

    if (
      matchConditions.some(
        (condition) =>
          condition.fieldIndex === index - 1 &&
          (condition.operator ?? 'contains') === newConditionOperator &&
          condition.keyword.trim().toLowerCase() === newConditionKeyword.trim().toLowerCase()
      )
    ) {
      alert.showWarning('该识别条件已经存在');
      return;
    }
    setMatchConditions((prev) => [
      ...prev,
      {
        fieldIndex: index - 1,
        keyword: newConditionKeyword.trim(),
        operator: newConditionOperator,
      },
    ]);
    setNewConditionIndex('');
    setNewConditionKeyword('');
  };

  // 保存规则
  const handleSaveRule = async () => {
    if (saving) {
      return;
    }
    if (!ruleName.trim()) {
      setRuleNameError('解析规则名称为必填项');
      ruleNameInputRef.current?.focus();
      return;
    }
    if (selectedFields.length < 2) {
      alert.showWarning('请至少选择2个字段');
      return;
    }

    let finalSeparator: string;

    if (ruleSeparator === 'custom') {
      finalSeparator = customSeparator.trim();
    } else if (ruleSeparator === 'special') {
      if (!customLeftBracket.trim() || !customRightBracket.trim()) {
        alert.showWarning('请输入左右分隔符');
        return;
      }
      if (customLeftBracket.trim() === customRightBracket.trim()) {
        alert.showWarning('左右分隔符不能相同');
        return;
      }
      finalSeparator = customLeftBracket.trim() + customRightBracket.trim();
    } else {
      finalSeparator = SEPARATOR_VALUES[ruleSeparator] || ruleSeparator;
    }

    if (!finalSeparator) {
      alert.showWarning('请输入分隔符');
      return;
    }

    let terminator: string;
    try {
      terminator = terminatorMode === 'custom' ? decodeRuleTerminator(ruleTerminator) : '';
      if (terminatorMode === 'custom' && !terminator) {
        alert.showWarning('请输入自定义结束符，或选择自动处理');
        return;
      }
    } catch (error) {
      alert.showWarning(error instanceof Error ? error.message : '结束符格式无效');
      return;
    }

    const getFieldDisplayName = (field: string): string => {
      if (isIgnoredRuleField(field)) return '忽略此段';
      return FIELD_LABELS[field] || field;
    };

    const separatorToDisplayFormat: Record<string, string> = {
      '{}': '{ * }',
      '()': '( * )',
      '[]': '[ * ]',
      '<>': '< * >',
      '\r\n': '回车换行',
      '\n': '换行',
      '\r': '回车',
      '\t': '制表符',
      '\x1D': 'GS',
      '\x1E': 'RS',
    };

    const separatorForDisplay = separatorToDisplayFormat[finalSeparator] || finalSeparator;
    const separatorDisplay = finalSeparator === ' ' ? '空格' : `"${separatorForDisplay}"`;
    const fieldDisplay = selectedFields.map((f) => getFieldDisplayName(f)).join(' → ');
    const autoDescription = `分隔符: ${separatorDisplay} | 字段: ${fieldDisplay}`;
    const fieldPrefixes = Object.fromEntries(
      Object.entries(draftPrefixes).filter(
        ([fieldName, prefix]) => selectedFields.includes(fieldName) && prefix.trim().length > 0
      )
    );

    // 保存的规则数据（避免 undefined 被 JSON.stringify 忽略）
    const ruleData: Parameters<typeof addRule>[0] = {
      name: ruleName.trim(),
      description: autoDescription,
      separator: finalSeparator,
      terminator,
      fieldOrder: selectedFields,
      isActive: editingRule?.isActive ?? true,
      supplierName: supplierName.trim(),
      matchConditions: matchConditions.length > 0 ? matchConditions : [],
      fieldPrefixes,
      customFieldIds: [],
    };
    const candidateRule: QRCodeRule = {
      ...draft.rule,
      ...ruleData,
      id: editingRule?.id ?? '__draft__',
    };

    const persist = async () => {
      setSaving(true);
      try {
        if (editingRule) {
          await updateRule(editingRule.id, ruleData);
          alert.showSuccess('规则已更新');
        } else {
          await addRule(ruleData);
          alert.showSuccess('规则已添加');
        }
        setModalVisible(false);
        await loadData();
      } catch (error) {
        logger.error('保存规则失败:', error);
        alert.showError(error instanceof Error ? error.message : '保存失败');
      } finally {
        setSaving(false);
      }
    };
    if (newConditionKeyword.trim()) {
      openSection('conditions');
      alert.showWarning('有尚未添加的识别条件，请先添加或清空关键字');
      return;
    }
    if (sample) {
      const inspection = inspectQRCodeRule(sample, { ...draft.rule, ...ruleData });
      if (!inspection.matched) {
        alert.showError(`样本校验未通过：\n${inspection.errors.join('\n')}`);
        return;
      }
    }
    setSaving(true);
    try {
      const currentRules = await getAllRules();
      const duplicateName = currentRules.find(
        (other) =>
          other.id !== editingRule?.id &&
          normalizeQRCodeRuleName(other.name) === normalizeQRCodeRuleName(ruleData.name)
      );
      if (duplicateName) {
        setRuleNameError('解析规则名称已存在，请更换名称');
        ruleNameInputRef.current?.focus();
        return;
      }
      if (sample && ruleData.isActive) {
        const analysis = analyzeQRCodeRuleDetection(sample, [
          ...currentRules.filter((other) => other.isActive && other.id !== editingRule?.id),
          candidateRule,
        ]);
        const conflictNames = analysis.conflictingRules.map((rule) => rule.name);
        if (conflictNames.length > 1) {
          setSaving(false);
          alert.showAlert(
            '规则冲突',
            `当前样本与 ${conflictNames.join('、')} 优先级相同，扫码无法自动区分。请补充字段前缀、识别条件或结束符。`,
            [
              { text: '返回检查', style: 'cancel' },
              {
                text: '仍然保存',
                onPress: () => {
                  void persist();
                },
              },
            ],
            'warning'
          );
          return;
        }

        if (analysis.selectedRule && analysis.selectedRule.id !== candidateRule.id) {
          setSaving(false);
          alert.showAlert(
            '规则优先级提醒',
            `当前样本扫码时会优先使用“${analysis.selectedRule.name}”，本规则不会处理该样本。请检查字段前缀、识别条件或规则结构。`,
            [
              { text: '返回检查', style: 'cancel' },
              {
                text: '仍然保存',
                onPress: () => {
                  void persist();
                },
              },
            ],
            'warning'
          );
          return;
        }
      }
      await persist();
    } catch (error) {
      alert.showError(error instanceof Error ? error.message : '规则冲突检查失败');
    } finally {
      setSaving(false);
    }
  };

  // 切换规则启用状态
  const handleToggleRule = async (rule: QRCodeRule) => {
    try {
      await updateRule(rule.id, { isActive: !rule.isActive });
      await loadData();
      showToast(rule.isActive ? '规则已禁用' : '规则已启用', 'success');
    } catch (error) {
      logger.error('更新规则失败:', error);
      showToast('切换失败', 'error');
    }
  };

  // 删除规则
  const handleDeleteRule = (rule: QRCodeRule) => {
    alert.showConfirm(
      '确认删除',
      `确定要删除规则"${rule.name}"吗？`,
      async () => {
        try {
          await deleteRule(rule.id);
          alert.showSuccess('规则已删除');
          await loadData();
        } catch (error) {
          logger.error('删除规则失败:', error);
          alert.showError('删除失败');
        }
      },
      true
    );
  };

  // 右滑删除互斥：同时只允许一个卡片处于滑开状态
  const closeOpenSwipeable = useCallback(() => {
    const openId = openSwipeableIdRef.current;
    if (openId) {
      swipeableRefs.current.get(openId)?.close();
      openSwipeableIdRef.current = null;
    }
  }, []);

  // 调整顺序模式
  const enterSortMode = useCallback(() => {
    if (rules.length < 2) return;
    closeOpenSwipeable();
    const ids = rules.map((rule) => rule.id);
    orderRef.current = ids;
    setOrder(ids);
    dragIndexRef.current = -1;
    accumulatedRef.current = 0;
    setDraggingId(null);
    draggingIdRef.current = null;
    setSortMode(true);
  }, [closeOpenSwipeable, rules]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  }, []);

  const cancelSort = useCallback(() => {
    stopAutoScroll();
    setSortMode(false);
    setDraggingId(null);
    draggingIdRef.current = null;
    dragY.value = 0;
    dragScale.value = 1;
    dragIndexRef.current = -1;
    accumulatedRef.current = 0;
  }, [dragY, dragScale, stopAutoScroll]);

  const confirmSort = useCallback(async () => {
    stopAutoScroll();
    try {
      await setRulesDisplayOrder(orderRef.current);
      setSortMode(false);
      setDraggingId(null);
      draggingIdRef.current = null;
      dragY.value = 0;
      dragScale.value = 1;
      dragIndexRef.current = -1;
      accumulatedRef.current = 0;
      await loadData();
      showToast('顺序已保存', 'success');
    } catch (error) {
      logger.error('保存规则排序失败:', error);
      showToast('保存失败', 'error');
    }
  }, [dragY, dragScale, loadData, showToast, stopAutoScroll]);

  const clearDragState = useCallback(() => {
    setDraggingId(null);
    dragIndexRef.current = -1;
    accumulatedRef.current = 0;
  }, []);

  const measureListLayout = useCallback(() => {
    const view = scrollViewRef.current;
    if (view == null) return;
    if (Platform.OS === 'web') {
      const node = (view as unknown as { getScrollableNode?: () => Element | null }).getScrollableNode?.();
      if (node) {
        const rect = node.getBoundingClientRect();
        listLayoutRef.current = { top: rect.top, height: rect.height };
      }
      return;
    }
    const node = findNodeHandle(view);
    if (node == null) return;
    UIManager.measureInWindow(node, (x, y, width, height) => {
      listLayoutRef.current = { top: y, height };
    });
  }, []);

  // 进入排序模式后重新测量列表可视区域，确保边缘自动滚动使用最新位置
  useEffect(() => {
    if (!sortMode) return;
    const timer = setTimeout(() => {
      measureListLayout();
    }, 100);
    return () => clearTimeout(timer);
  }, [sortMode, measureListLayout]);

  const handleDragStart = useCallback(
    (id: string) => {
      dragIndexRef.current = orderRef.current.indexOf(id);
      accumulatedRef.current = 0;
      lastTranslationYRef.current = 0;
      dragStartScrollOffsetRef.current = scrollOffsetRef.current;
      dragY.value = 0;
      draggingIdRef.current = id;
      setDraggingId(id);
      dragScale.value = withSpring(1.04, { damping: 20, stiffness: 240, mass: 0.8 });
      if (!listLayoutRef.current) {
        measureListLayout();
      }
    },
    [dragY, dragScale, measureListLayout]
  );

  const applyDragPosition = useCallback(
    (effectiveTranslationY: number) => {
      const list = [...orderRef.current];
      let index = dragIndexRef.current;
      if (index < 0 || index >= list.length) return;

      let offset = effectiveTranslationY - accumulatedRef.current;
      let changed = false;
      const dragHeight = heightsRef.current[draggingIdRef.current ?? ''] ?? 108;

      while (offset > 0 && index < list.length - 1) {
        const step = dragHeight + SORT_ROW_GAP;
        if (offset <= step / 2) break;
        [list[index], list[index + 1]] = [list[index + 1], list[index]];
        accumulatedRef.current += step;
        index += 1;
        offset = effectiveTranslationY - accumulatedRef.current;
        changed = true;
      }

      while (offset < 0 && index > 0) {
        const aboveId = list[index - 1];
        const step = (heightsRef.current[aboveId] ?? 108) + SORT_ROW_GAP;
        if (offset >= -step / 2) break;
        [list[index], list[index - 1]] = [list[index - 1], list[index]];
        accumulatedRef.current -= step;
        index -= 1;
        offset = effectiveTranslationY - accumulatedRef.current;
        changed = true;
      }

      dragIndexRef.current = index;
      dragY.value = offset;

      if (changed) {
        orderRef.current = list;
        setOrder(list);
      }
    },
    [dragY]
  );

  const handleDragUpdate = useCallback(
    (translationY: number, absoluteY: number) => {
      lastTranslationYRef.current = translationY;
      const effectiveY =
        translationY + (scrollOffsetRef.current - dragStartScrollOffsetRef.current);
      applyDragPosition(effectiveY);

      const layout = listLayoutRef.current;
      if (!layout) return;
      const topEdge = layout.top + 72;
      const bottomEdge = layout.top + layout.height - 72;
      let direction = 0;
      if (absoluteY < topEdge) direction = -1;
      else if (absoluteY > bottomEdge) direction = 1;

      if (direction !== 0 && !autoScrollTimerRef.current) {
        autoScrollTimerRef.current = setInterval(() => {
          const target = Math.max(0, scrollOffsetRef.current + direction * 10);
          scrollViewRef.current?.scrollTo({ y: target, animated: false });
        }, 16);
      } else if (direction === 0) {
        stopAutoScroll();
      }
    },
    [applyDragPosition, stopAutoScroll]
  );

  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      if (draggingIdRef.current) {
        const effectiveY =
          lastTranslationYRef.current +
          (scrollOffsetRef.current - dragStartScrollOffsetRef.current);
        applyDragPosition(effectiveY);
      }
    },
    [applyDragPosition]
  );

  const handleDragEnd = useCallback(() => {
    stopAutoScroll();
    draggingIdRef.current = null;
    dragScale.value = withSpring(1, { damping: 20, stiffness: 240, mass: 0.8 });
    dragY.value = withSpring(0, { damping: 20, stiffness: 220, mass: 0.8 }, (finished) => {
      if (finished) {
        runOnJS(clearDragState)();
      }
    });
  }, [clearDragState, dragY, dragScale, stopAutoScroll]);

  const dragAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }, { scale: dragScale.value }],
  }));

  const gestureCacheRef = useRef<Map<string, ReturnType<typeof Gesture.Pan>>>(new Map());
  const getDragGesture = useCallback(
    (id: string) => {
      const cached = gestureCacheRef.current.get(id);
      if (cached) return cached;
      const gesture = Gesture.Pan()
        .activateAfterLongPress(300)
        .runOnJS(true)
        .onStart(() => handleDragStart(id))
        .onUpdate((event) => handleDragUpdate(event.translationY, event.absoluteY))
        .onEnd(() => handleDragEnd());
      gestureCacheRef.current.set(id, gesture);
      return gesture;
    },
    [handleDragStart, handleDragUpdate, handleDragEnd]
  );

  // 切换字段选择
  const toggleField = (fieldKey: string) => {
    const removedIndex = selectedFields.indexOf(fieldKey);
    if (removedIndex >= 0) {
      setDraftPrefixes((current) => {
        const next = { ...current };
        delete next[fieldKey];
        return next;
      });
      setSelectedFields(selectedFields.filter((f) => f !== fieldKey));
      setNewConditionIndex((current) => {
        if (!current) return current;
        const selectedIndex = Number.parseInt(current, 10) - 1;
        if (!Number.isInteger(selectedIndex)) return '';
        if (selectedIndex === removedIndex) return '';
        return selectedIndex > removedIndex ? String(selectedIndex) : current;
      });
      setMatchConditions((current) =>
        current.flatMap((condition) => {
          if (condition.fieldIndex === removedIndex) {
            return [];
          }
          return [
            condition.fieldIndex > removedIndex
              ? { ...condition, fieldIndex: condition.fieldIndex - 1 }
              : condition,
          ];
        })
      );
    } else {
      setSelectedFields([...selectedFields, fieldKey]);
    }
  };

  // 移动字段顺序
  const moveFieldUp = (index: number) => {
    if (index > 0) {
      const newFields = [...selectedFields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      setSelectedFields(newFields);
      setNewConditionIndex((current) => {
        const selectedIndex = Number.parseInt(current, 10) - 1;
        if (!Number.isInteger(selectedIndex)) return current;
        if (selectedIndex === index) return String(index);
        if (selectedIndex === index - 1) return String(index + 1);
        return current;
      });
      setMatchConditions((current) =>
        current.map((condition) => {
          if (condition.fieldIndex === index) return { ...condition, fieldIndex: index - 1 };
          if (condition.fieldIndex === index - 1) return { ...condition, fieldIndex: index };
          return condition;
        })
      );
    }
  };

  const moveFieldDown = (index: number) => {
    if (index < selectedFields.length - 1) {
      const newFields = [...selectedFields];
      [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      setSelectedFields(newFields);
      setNewConditionIndex((current) => {
        const selectedIndex = Number.parseInt(current, 10) - 1;
        if (!Number.isInteger(selectedIndex)) return current;
        if (selectedIndex === index) return String(index + 2);
        if (selectedIndex === index + 1) return String(index + 1);
        return current;
      });
      setMatchConditions((current) =>
        current.map((condition) => {
          if (condition.fieldIndex === index) return { ...condition, fieldIndex: index + 1 };
          if (condition.fieldIndex === index + 1) return { ...condition, fieldIndex: index };
          return condition;
        })
      );
    }
  };

  // 获取字段显示名称
  const getFieldDisplayName = (fieldKey: string): string => {
    if (isIgnoredRuleField(fieldKey)) return '忽略此段';
    return FIELD_LABELS[fieldKey] || fieldKey;
  };

  const assignSampleField = (index: number, field: string, count: number, rawValue = '') => {
    const next = [...selectedFields];
    while (next.length < count) next.push(nextIgnoredRuleField(next));
    if (
      field !== '__ignore__' &&
      next.some((value, position) => position !== index && value === field)
    )
      return;
    const oldField = next[index];
    const nextField =
      field === '__ignore__'
        ? isIgnoredRuleField(oldField)
          ? oldField
          : nextIgnoredRuleField(next)
        : field;
    next[index] = nextField;
    setSelectedFields(next);
    const suggestedPrefix = isIgnoredRuleField(nextField)
      ? ''
      : suggestRuleFieldPrefix(rawValue, finalEditorSeparator);
    setDraftPrefixes((current) => {
      const prefixes = { ...current };
      if (oldField !== nextField) delete prefixes[oldField];
      if (suggestedPrefix && !prefixes[nextField]?.trim()) {
        prefixes[nextField] = suggestedPrefix;
      }
      return prefixes;
    });
  };

  const selectSuggestedSeparator = (separator: string) => {
    const display = Object.entries(SEPARATOR_VALUES).find(([, value]) => value === separator)?.[0];
    if (display || ['/', '|', ',', '*', '#', ' ', ';', ':'].includes(separator)) {
      setRuleSeparator(display ?? separator);
      setCustomSeparator('');
    } else {
      setRuleSeparator('custom');
      setCustomSeparator(separator);
    }
  };

  const rulesById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);

  const renderRuleCardContent = (rule: QRCodeRule) => {
    const separatorDisplayMap: Record<string, string> = {
      '{}': '{*}',
      '()': '(*)',
      '[]': '[*]',
      '<>': '<*>',
      '\r\n': '回车换行',
      '\n': '换行',
      '\r': '回车',
      '\t': '制表符',
      '\x1D': 'GS',
      '\x1E': 'RS',
    };
    return (
      <>
        <Text style={styles.ruleName} numberOfLines={1}>
          {rule.name}
        </Text>
        <Text style={styles.ruleSeparator} numberOfLines={1}>
          分隔符：
          {rule.separator === ' ' ? '空格' : separatorDisplayMap[rule.separator] || rule.separator}
          {` · ${rule.fieldOrder?.length || 0} 段`}
          {(rule.matchConditions?.length || 0) > 0
            ? ` · ${rule.matchConditions?.length} 个条件`
            : ''}
          {Object.values(rule.fieldPrefixes || {}).some((prefix) => prefix.trim())
            ? ` · ${Object.values(rule.fieldPrefixes || {}).filter((prefix) => prefix.trim()).length} 个前缀`
            : ''}
        </Text>
        {!!rule.terminator && (
          <Text style={styles.ruleSeparator} numberOfLines={1}>
            结束符：{displayRuleTerminator(rule.terminator)}
          </Text>
        )}
        <Text style={styles.ruleFields} numberOfLines={1}>
          字段：
          {(() => {
            if (!rule.fieldOrder || rule.fieldOrder.length === 0) return '未配置';
            return rule.fieldOrder
              .map((field, index) => {
                const label = isIgnoredRuleField(field) ? '忽略此段' : FIELD_LABELS[field] || field;
                return index === 0 ? label : ` → ${label}`;
              })
              .join('');
          })()}
        </Text>
      </>
    );
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* 头部 */}
        <View style={styles.header}>
          {sortMode ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="取消排序"
              style={styles.headerAction}
              activeOpacity={0.7}
              onPress={cancelSort}
            >
              <Text style={styles.headerActionText}>取消</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.7}
              onPress={() => router.back()}
            >
              <Feather name="arrow-left" size={20} color={theme.textPrimary} />
            </TouchableOpacity>
          )}
          <View style={styles.headerContent}>
            <Text style={styles.title}>{sortMode ? '调整顺序' : '解析规则'}</Text>
          </View>
          {sortMode ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="完成排序"
              style={styles.addButton}
              activeOpacity={0.9}
              onPress={confirmSort}
            >
              <Text style={styles.addButtonText}>完成</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="新增解析规则"
              style={styles.addButton}
              activeOpacity={0.9}
              onPress={handleAddRule}
            >
              <Feather name="plus" size={18} color={theme.buttonPrimaryText} />
              <Text style={styles.addButtonText}>新增</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 规则列表 */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.container}
          scrollEnabled={!draggingId}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleListScroll}
          onLayout={measureListLayout}
        >
            {rules.length === 0 ? (
              <AppEmptyState
                icon="sliders"
                title="暂无解析规则"
                description="添加后可按不同二维码格式进行识别。"
                style={styles.emptyContainer}
              />
            ) : (
              <View style={{ gap: Spacing.sm }}>
                {sortMode && (
                  <Text style={styles.sortHint}>长按并拖动卡片调整顺序，完成后点右上角完成</Text>
                )}
                {sortMode
                  ? order.map((id) => {
                      const rule = rulesById.get(id);
                      if (!rule) return null;
                      const isDragging = draggingId === id;
                      return (
                        <GestureDetector key={id} gesture={getDragGesture(id)}>
                          <Animated.View
                            onLayout={(event) => {
                              heightsRef.current[id] = event.nativeEvent.layout.height;
                            }}
                            layout={isDragging ? undefined : SORT_LAYOUT_TRANSITION}
                            style={[
                              styles.ruleItem,
                              isDragging && styles.ruleItemDragging,
                              draggingId !== null && !isDragging && styles.ruleItemDimmed,
                              isDragging && dragAnimatedStyle,
                            ]}
                          >
                            <View style={styles.ruleContent}>{renderRuleCardContent(rule)}</View>
                            <View style={styles.dragHandle}>
                              <Feather
                                name="menu"
                                size={20}
                                color={isDragging ? theme.primary : theme.textMuted}
                              />
                            </View>
                          </Animated.View>
                        </GestureDetector>
                      );
                    })
                  : rules.map((rule) => (
                      <Swipeable
                        key={rule.id}
                        containerStyle={styles.swipeContainer}
                        ref={(instance) => {
                          if (instance) {
                            swipeableRefs.current.set(rule.id, instance);
                          } else {
                            swipeableRefs.current.delete(rule.id);
                          }
                        }}
                        onSwipeableWillOpen={() => {
                          const previousId = openSwipeableIdRef.current;
                          if (previousId && previousId !== rule.id) {
                            swipeableRefs.current.get(previousId)?.close();
                          }
                          openSwipeableIdRef.current = rule.id;
                        }}
                        onSwipeableClose={() => {
                          if (openSwipeableIdRef.current === rule.id) {
                            openSwipeableIdRef.current = null;
                          }
                        }}
                        renderLeftActions={() => (
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`删除规则${rule.name}`}
                            style={styles.deleteAction}
                            activeOpacity={0.8}
                            onPress={() => handleDeleteRule(rule)}
                          >
                            <Feather name="trash-2" size={18} color={theme.buttonPrimaryText} />
                            <Text style={styles.deleteActionText}>删除</Text>
                          </TouchableOpacity>
                        )}
                        overshootLeft={false}
                        leftThreshold={48}
                        failOffsetY={[-18, 18]}
                        friction={2}
                        animationOptions={{ bounciness: 3, speed: 14 }}
                      >
                        <View style={styles.ruleItem}>
                          <TouchableOpacity
                            style={styles.ruleContent}
                            activeOpacity={0.9}
                            onPress={() => handleEditRule(rule)}
                            onLongPress={enterSortMode}
                            delayLongPress={500}
                          >
                            {renderRuleCardContent(rule)}
                          </TouchableOpacity>
                          <View style={styles.ruleSwitch}>
                            <Switch
                              value={rule.isActive}
                              onValueChange={() => handleToggleRule(rule)}
                              trackColor={{ false: theme.border, true: theme.primary }}
                              thumbColor={theme.buttonPrimaryText}
                            />
                          </View>
                        </View>
                      </Swipeable>
                    ))}
              </View>
            )}
          </ScrollView>
      </View>

      {/* 编辑弹窗 */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeEditor}
      >
        <Screen
          backgroundColor={theme.backgroundRoot}
          statusBarStyle={isDark ? 'light' : 'dark'}
          safeAreaEdges={['top', 'left', 'right']}
          disableAutoScroll
        >
          <View style={styles.ruleEditorScreen}>
            <View style={styles.ruleEditorHeader}>
              {editorSection !== 'main' && (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="返回规则"
                  style={styles.backButton}
                  onPress={() => openSection('main')}
                >
                  <Feather name="arrow-left" size={20} color={theme.textPrimary} />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }}>
                <AppModalHeader
                  title={
                    editorSection === 'main'
                      ? editingRule
                        ? '编辑规则'
                        : '添加规则'
                      : EDITOR_SECTIONS[editorSection]
                  }
                  onClose={saving || editorSection !== 'main' ? undefined : closeEditor}
                />
              </View>
            </View>

            <KeyboardAwareFormScrollView
              key={editorSection}
              style={styles.ruleEditorBody}
              contentContainerStyle={styles.ruleEditorBodyContent}
              bottomOffset={24}
              extraScrollHeight={18}
              showsVerticalScrollIndicator={true}
            >
              {editorSection === 'main' && (
                <>
                  <Text style={[styles.inputLabel, ruleNameError && styles.validationText]}>
                    规则名称 *
                  </Text>
                  <TextInput
                    accessibilityLabel="规则名称"
                    accessibilityHint={ruleNameError ?? undefined}
                    ref={ruleNameInputRef}
                    style={[styles.textInput, ruleNameError && styles.invalidInput]}
                    placeholder="如：极海半导体"
                    placeholderTextColor={theme.textMuted}
                    value={ruleName}
                    onChangeText={(value) => {
                      setRuleName(value);
                      setRuleNameError(value.trim() ? null : '解析规则名称为必填项');
                    }}
                  />
                  {ruleNameError && (
                    <Text
                      accessibilityRole="alert"
                      accessibilityLiveRegion="polite"
                      style={[styles.validationText, styles.validationMessage]}
                    >
                      {ruleNameError}
                    </Text>
                  )}

                  <RuleSamplePanel
                    sample={sample}
                    onSampleChange={setSample}
                    rule={draft.rule}
                    rules={rules}
                    configurationError={draft.error}
                    fieldLabel={getFieldDisplayName}
                    onAssign={assignSampleField}
                    onSeparatorSelect={selectSuggestedSeparator}
                  />

                  <Text style={styles.sectionTitle}>规则设置</Text>
                  {(
                    [
                      {
                        section: 'format',
                        icon: 'sliders',
                        value:
                          draft.error ||
                          `${finalEditorSeparator === ' ' ? '空格' : displayRuleTerminator(finalEditorSeparator)} · ${terminatorMode === 'custom' ? '自定义结束符' : '自动处理末尾'}`,
                      },
                      { section: 'fields', icon: 'list', value: `${selectedFields.length} 段` },
                      {
                        section: 'prefixes',
                        icon: 'tag',
                        value: `${Object.values(draft.rule.fieldPrefixes || {}).filter((prefix) => prefix.trim()).length} 个前缀`,
                      },
                      {
                        section: 'conditions',
                        icon: 'filter',
                        value: `${matchConditions.length} 个条件${newConditionKeyword.trim() ? ' · 有待添加条件' : ''}`,
                      },
                    ] as const
                  ).map((item) => (
                    <TouchableOpacity
                      key={item.section}
                      accessibilityRole="button"
                      accessibilityLabel={EDITOR_SECTIONS[item.section]}
                      style={styles.settingsRow}
                      onPress={() => openSection(item.section)}
                    >
                      <Feather name={item.icon} size={18} color={theme.textSecondary} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.settingsTitle}>{EDITOR_SECTIONS[item.section]}</Text>
                        <Text
                          style={[
                            styles.settingsValue,
                            item.section === 'format' && !!draft.error && { color: theme.error },
                          ]}
                        >
                          {item.value}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={theme.textMuted} />
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {editorSection === 'format' && (
                <>
                  <Text style={styles.inputLabel}>分隔符 *</Text>
                  <View style={styles.separatorOptions}>
                    {[
                      '/',
                      '|',
                      ',',
                      '*',
                      '#',
                      ' ',
                      ';',
                      ':',
                      '回车',
                      '换行',
                      '回车换行',
                      '制表符',
                      'GS',
                      'RS',
                      '{ * }',
                      '( * )',
                      '[ * ]',
                      '< * >',
                    ].map((sep) => (
                      <TouchableOpacity
                        key={sep}
                        style={[
                          styles.separatorBtn,
                          ruleSeparator === sep && styles.separatorBtnActive,
                        ]}
                        activeOpacity={0.7}
                        onPress={() => {
                          setRuleSeparator(sep);
                          setCustomSeparator('');
                          setCustomLeftBracket('');
                          setCustomRightBracket('');
                        }}
                      >
                        <Text
                          style={[
                            styles.separatorBtnText,
                            ruleSeparator === sep && styles.separatorBtnTextActive,
                          ]}
                        >
                          {sep === ' ' ? '空格' : sep}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[
                        styles.separatorBtn,
                        ruleSeparator === 'custom' && styles.separatorBtnActive,
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        setRuleSeparator('custom');
                        setCustomLeftBracket('');
                        setCustomRightBracket('');
                      }}
                    >
                      <Text
                        style={[
                          styles.separatorBtnText,
                          ruleSeparator === 'custom' && styles.separatorBtnTextActive,
                        ]}
                      >
                        自定义
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.separatorBtn,
                        ruleSeparator === 'special' && styles.separatorBtnActive,
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        setRuleSeparator('special');
                        setCustomSeparator('');
                      }}
                    >
                      <Text
                        style={[
                          styles.separatorBtnText,
                          ruleSeparator === 'special' && styles.separatorBtnTextActive,
                        ]}
                      >
                        特殊
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* 自定义分隔符输入框 */}
                  {ruleSeparator === 'custom' && (
                    <TextInput
                      style={[styles.textInput, { marginTop: Spacing.sm }]}
                      placeholder="请输入自定义分隔符"
                      placeholderTextColor={theme.textMuted}
                      value={customSeparator}
                      onChangeText={setCustomSeparator}
                      maxLength={3}
                    />
                  )}

                  {/* 特殊分隔符输入框 */}
                  {ruleSeparator === 'special' && (
                    <View
                      style={{
                        marginTop: Spacing.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: Spacing.md,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.inputLabel,
                            { marginBottom: Spacing.xs, fontSize: rf(12) },
                          ]}
                        >
                          左符号
                        </Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="如 { ( ["
                          placeholderTextColor={theme.textMuted}
                          value={customLeftBracket}
                          onChangeText={setCustomLeftBracket}
                          maxLength={1}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.inputLabel,
                            { marginBottom: Spacing.xs, fontSize: rf(12) },
                          ]}
                        >
                          右符号
                        </Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="如 } ) ]"
                          placeholderTextColor={theme.textMuted}
                          value={customRightBracket}
                          onChangeText={setCustomRightBracket}
                          maxLength={1}
                        />
                      </View>
                      {customLeftBracket && customRightBracket && (
                        <Text style={{ color: theme.textSecondary, fontSize: rf(12) }}>
                          示例: {customLeftBracket}字段1{customRightBracket}
                          {customLeftBracket}字段2{customRightBracket}
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={styles.terminatorSection}>
                    <Text style={styles.terminatorTitle}>末尾处理</Text>
                    <AppSegmentedOptions
                      value={terminatorMode}
                      onChange={setTerminatorMode}
                      options={[
                        { value: 'auto', label: '自动处理', icon: 'check-circle' },
                        { value: 'custom', label: '自定义', icon: 'edit-3' },
                      ]}
                    />
                    {terminatorMode === 'custom' && (
                      <View style={styles.terminatorDetails}>
                        <Text style={styles.terminatorLabel}>结束符内容</Text>
                        <TextInput
                          accessibilityLabel="规则结束符"
                          style={styles.textInput}
                          placeholder="例如 ; 或 END"
                          placeholderTextColor={theme.textMuted}
                          value={ruleTerminator}
                          onChangeText={setRuleTerminator}
                          autoCapitalize="none"
                          autoCorrect={false}
                          maxLength={384}
                        />
                        <Text style={styles.terminatorLabel}>常用结束符</Text>
                        <View style={styles.separatorOptions}>
                          {[
                            [';', ';'],
                            ['回车', '\\r'],
                            ['换行', '\\n'],
                            ['回车换行', '\\r\\n'],
                            ['制表符', '\\t'],
                            ['GS', '\\x1D'],
                            ['RS', '\\x1E'],
                            ['EOT', '\\x04'],
                          ].map(([label, value]) => (
                            <TouchableOpacity
                              key={label}
                              accessibilityRole="radio"
                              accessibilityLabel={`结束符：${label}`}
                              accessibilityState={{ checked: ruleTerminator === value }}
                              style={[
                                styles.separatorBtn,
                                ruleTerminator === value && styles.separatorBtnActive,
                              ]}
                              activeOpacity={0.7}
                              onPress={() => setRuleTerminator(value)}
                            >
                              <Text
                                style={[
                                  styles.separatorBtnText,
                                  ruleTerminator === value && styles.separatorBtnTextActive,
                                ]}
                              >
                                {label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                </>
              )}
              {editorSection === 'fields' && (
                <>
                  <Text style={styles.inputLabel}>标准字段（点击添加/移除）</Text>
                  <View style={styles.fieldOptions}>
                    {AVAILABLE_FIELDS.map((field) => (
                      <TouchableOpacity
                        key={field}
                        style={[
                          styles.fieldBtn,
                          selectedFields.includes(field) && styles.fieldBtnActive,
                        ]}
                        activeOpacity={0.7}
                        onPress={() => toggleField(field)}
                      >
                        <Text
                          style={[
                            styles.fieldBtnText,
                            selectedFields.includes(field) && styles.fieldBtnTextActive,
                          ]}
                        >
                          {FIELD_LABELS[field]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="添加忽略段"
                    style={styles.ignoreButton}
                    onPress={() =>
                      setSelectedFields((fields) => [...fields, nextIgnoredRuleField(fields)])
                    }
                  >
                    <Feather name="plus" size={18} color={theme.primary} />
                    <Text style={{ color: theme.primary }}>添加忽略段</Text>
                  </TouchableOpacity>

                  {/* 已选字段顺序 */}
                  {selectedFields.length > 0 && (
                    <View style={styles.selectedFieldsContainer}>
                      <Text style={styles.selectedFieldsLabel}>字段顺序（可调整）：</Text>
                      {selectedFields.map((fieldKey, index) => {
                        const displayName = getFieldDisplayName(fieldKey);
                        return (
                          <View key={fieldKey} style={styles.selectedFieldItem}>
                            <Text style={styles.selectedFieldIndex}>{index + 1}.</Text>
                            <Text style={styles.selectedFieldName}>{displayName}</Text>
                            <View style={styles.selectedFieldActions}>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`上移第${index + 1}段`}
                                disabled={index === 0}
                                style={styles.fieldAction}
                                onPress={() => moveFieldUp(index)}
                              >
                                <Feather
                                  name="arrow-up"
                                  size={17}
                                  color={index === 0 ? theme.textMuted : theme.primary}
                                />
                              </TouchableOpacity>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`下移第${index + 1}段`}
                                disabled={index === selectedFields.length - 1}
                                style={styles.fieldAction}
                                onPress={() => moveFieldDown(index)}
                              >
                                <Feather name="arrow-down" size={17} color={theme.primary} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`移除第${index + 1}段`}
                                style={styles.fieldAction}
                                onPress={() => toggleField(fieldKey)}
                              >
                                <Feather name="x" size={17} color={theme.textSecondary} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              {editorSection === 'prefixes' && (
                <>
                  {selectedFields.length === 0 && (
                    <Text style={styles.noFieldsHint}>尚未分配字段</Text>
                  )}
                  {selectedFields.map((field, index) => (
                    <View key={field} style={styles.prefixRow}>
                      <Text style={styles.inputLabel}>
                        第{index + 1}段 · {getFieldDisplayName(field)}
                      </Text>
                      <TextInput
                        accessibilityLabel={`第${index + 1}段前缀`}
                        style={styles.textInput}
                        placeholder="未设置"
                        placeholderTextColor={theme.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={draftPrefixes[field] || ''}
                        onChangeText={(value) =>
                          setDraftPrefixes((current) => ({ ...current, [field]: value }))
                        }
                      />
                    </View>
                  ))}
                </>
              )}

              {/* 识别条件配置 */}
              {editorSection === 'conditions' && (
                <>
                  <View style={styles.sectionContainer}>
                    <Text style={styles.inputLabel}>识别条件（可选）</Text>

                    {/* 供应商名称 */}
                    <View style={styles.conditionInputRow}>
                      <Text style={styles.inputRowLabel}>供应商备注</Text>
                      <TextInput
                        accessibilityLabel="供应商备注"
                        style={styles.inputRowField}
                        placeholder="选填，不参与识别"
                        placeholderTextColor={theme.textMuted}
                        value={supplierName}
                        onChangeText={setSupplierName}
                      />
                    </View>

                    {/* 匹配条件列表 */}
                    {matchConditions.length > 0 && (
                      <View style={styles.conditionsList}>
                        {matchConditions.map((condition, index) => {
                          const fieldKey = selectedFields[condition.fieldIndex];
                          const displayName = fieldKey
                            ? getFieldDisplayName(fieldKey)
                            : `第${condition.fieldIndex + 1}个字段`;
                          return (
                            <View key={index} style={styles.conditionItem}>
                              <Text style={styles.conditionText}>
                                {`第${condition.fieldIndex + 1}段 · ${displayName} ${CONDITION_OPERATORS[condition.operator ?? 'contains']} "${condition.keyword}"`}
                              </Text>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`删除条件${index + 1}`}
                                style={styles.fieldAction}
                                activeOpacity={0.7}
                                onPress={() => {
                                  setMatchConditions((prev) => prev.filter((_, i) => i !== index));
                                }}
                              >
                                <Feather name="trash-2" size={17} color={theme.error} />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* 添加匹配条件 */}
                    <View style={styles.addConditionContainer}>
                      {selectedFields.length > 0 ? (
                        <>
                          <View style={styles.conditionInputRow}>
                            <Text style={styles.inputRowLabel}>匹配条件</Text>
                            <TouchableOpacity
                              style={styles.fieldSelectBtn}
                              accessibilityRole="button"
                              accessibilityLabel="选择条件字段"
                              activeOpacity={0.7}
                              onPress={() => setConditionPicker('field')}
                            >
                              <Text style={styles.fieldSelectText} numberOfLines={1}>
                                {newConditionIndex &&
                                selectedFields[parseInt(newConditionIndex, 10) - 1]
                                  ? getFieldDisplayName(
                                      selectedFields[parseInt(newConditionIndex, 10) - 1]
                                    )
                                  : '点击选择'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              accessibilityRole="button"
                              accessibilityLabel="选择匹配方式"
                              style={styles.fieldAction}
                              onPress={() => setConditionPicker('operator')}
                            >
                              <Text style={styles.conditionLabel}>
                                {CONDITION_OPERATORS[newConditionOperator]}
                              </Text>
                              <Feather name="chevron-down" size={14} color={theme.textSecondary} />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.conditionInputRow}>
                            <Text style={styles.inputRowLabel}>关键字</Text>
                            <TextInput
                              accessibilityLabel="识别条件关键字"
                              style={styles.conditionKeywordInput}
                              placeholder="请输入"
                              placeholderTextColor={theme.textMuted}
                              value={newConditionKeyword}
                              onChangeText={setNewConditionKeyword}
                            />
                            <TouchableOpacity
                              style={styles.addConditionBtn}
                              accessibilityRole="button"
                              accessibilityLabel="添加识别条件"
                              activeOpacity={0.7}
                              onPress={handleAddMatchCondition}
                            >
                              <Feather name="plus" size={20} color={theme.buttonPrimaryText} />
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : (
                        <Text style={styles.noFieldsHint}>请先选择字段</Text>
                      )}
                    </View>
                  </View>
                </>
              )}
            </KeyboardAwareFormScrollView>

            {conditionPicker && (
              <RuleOptionPicker
                title={conditionPicker === 'field' ? '选择条件字段' : '选择匹配方式'}
                value={conditionPicker === 'field' ? newConditionIndex : newConditionOperator}
                options={
                  conditionPicker === 'field'
                    ? selectedFields.map((field, index) => ({
                        value: String(index + 1),
                        label: `第${index + 1}段 · ${getFieldDisplayName(field)}`,
                      }))
                    : Object.entries(CONDITION_OPERATORS).map(([value, label]) => ({
                        value,
                        label,
                      }))
                }
                onClose={() => setConditionPicker(null)}
                onSelect={(value) => {
                  if (conditionPicker === 'field') setNewConditionIndex(value);
                  else setNewConditionOperator(value as ConditionOperator);
                  setConditionPicker(null);
                }}
              />
            )}

            <View style={[styles.ruleEditorFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              {editorSection === 'main' ? (
                <AppModalActions
                  containerStyle={styles.ruleEditorActions}
                  secondaryLabel="取消"
                  onSecondaryPress={() => setModalVisible(false)}
                  secondaryDisabled={saving}
                  primaryLabel={saving ? '保存中...' : '保存'}
                  onPrimaryPress={handleSaveRule}
                  primaryDisabled={saving}
                />
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="完成设置"
                  style={styles.doneButton}
                  onPress={() => openSection('main')}
                >
                  <Feather name="check" size={18} color={theme.buttonPrimaryText} />
                  <Text style={styles.addButtonText}>完成</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Screen>
      </Modal>

      {/* 自定义弹窗 */}
      {alert.AlertComponent}
      <ToastContainer />
    </Screen>
  );
}
