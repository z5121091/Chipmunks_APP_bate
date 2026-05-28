import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  TextInput,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  getAllRules,
  addRule,
  updateRule,
  deleteRule,
  getAllCustomFields,
  QRCodeRule,
  CustomField,
  FIELD_LABELS,
  AVAILABLE_FIELDS,
  isCustomField,
  getCustomFieldId,
  createCustomFieldKey,
  MatchCondition,
} from '@/utils/database';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppModalHeader } from '@/components/AppModalHeader';
import { AppModalActions } from '@/components/AppModalActions';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { createStyles } from './styles';
import { logger } from '@/utils/logger';
import { Spacing } from '@/constants/theme';
import { rf } from '@/utils/responsive';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { useToast } from '@/utils/toast';

export default function RulesScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const { showToast, ToastContainer } = useToast();
  
  const [rules, setRules] = useState<QRCodeRule[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<QRCodeRule | null>(null);
  
  // 规则名称输入框 ref
  const ruleNameInputRef = useRef<TextInput>(null);
  
  // 表单状态
  const [ruleName, setRuleName] = useState('');
  const [ruleSeparator, setRuleSeparator] = useState('/');
  const [customSeparator, setCustomSeparator] = useState('');
  const [customLeftBracket, setCustomLeftBracket] = useState('');
  const [customRightBracket, setCustomRightBracket] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [matchConditions, setMatchConditions] = useState<MatchCondition[]>([]);
  const [newConditionIndex, setNewConditionIndex] = useState('');
  const [newConditionKeyword, setNewConditionKeyword] = useState('');
  
  // 加载数据
  const loadData = useCallback(async () => {
    const [rulesData, fieldsData] = await Promise.all([
      getAllRules(),
      getAllCustomFields(),
    ]);
    setRules(rulesData);
    setCustomFields(fieldsData);
  }, []);
  
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );
  
  // 打开新增弹窗
  const handleAddRule = () => {
    setEditingRule(null);
    setRuleName('');

    setRuleSeparator('/');
    setCustomSeparator('');
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
    setEditingRule(rule);
    setRuleName(rule.name);
    setCustomLeftBracket('');
    setCustomRightBracket('');
    
    const separatorToDisplay: Record<string, string> = {
      '{}': '{ * }',
      '()': '( * )',
      '[]': '[ * ]',
      '<>': '< * >',
    };
    
    const presetSeparators = ['/', '|', ',', '*', '#', ' ', ';', ':', '{}', '()', '[]', '<>'];
    if (presetSeparators.includes(rule.separator)) {
      setRuleSeparator(separatorToDisplay[rule.separator] || rule.separator);
      setCustomSeparator('');
    } else if (rule.separator.includes('{') || rule.separator.includes('}') ||
               rule.separator.includes('(') || rule.separator.includes(')') ||
               rule.separator.includes('[') || rule.separator.includes(']')) {
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
    
    const hasCustomFieldsInOrder = rule.fieldOrder?.some(f => isCustomField(f));
    
    if (hasCustomFieldsInOrder) {
      setSelectedFields(rule.fieldOrder || []);
    } else if (rule.customFieldIds && rule.customFieldIds.length > 0) {
      const standardFields = rule.fieldOrder || [];
      const customFieldKeys = rule.customFieldIds.map(id => createCustomFieldKey(id));
      setSelectedFields([...standardFields, ...customFieldKeys]);
    } else {
      setSelectedFields(rule.fieldOrder || []);
    }
    
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
    
    setMatchConditions(prev => [
      ...prev,
      { fieldIndex: index - 1, keyword: newConditionKeyword.trim() }
    ]);
    setNewConditionIndex('');
    setNewConditionKeyword('');
  };
  
  // 保存规则
  const handleSaveRule = async () => {
    if (!ruleName.trim()) {
      alert.showWarning('请输入规则名称');
      return;
    }
    if (selectedFields.length < 2) {
      alert.showWarning('请至少选择2个字段');
      return;
    }
    
    const displayToSeparator: Record<string, string> = {
      '{ * }': '{}',
      '( * )': '()',
      '[ * ]': '[]',
      '< * >': '<>',
    };
    
    let finalSeparator: string;
    
    if (ruleSeparator === 'custom') {
      finalSeparator = customSeparator.trim();
    } else if (ruleSeparator === 'special') {
      if (!customLeftBracket.trim() || !customRightBracket.trim()) {
        alert.showWarning('请输入左右分隔符');
        return;
      }
      finalSeparator = customLeftBracket.trim() + customRightBracket.trim();
    } else {
      finalSeparator = displayToSeparator[ruleSeparator] || ruleSeparator;
    }
    
    if (!finalSeparator) {
      alert.showWarning('请输入分隔符');
      return;
    }
    
    const getFieldDisplayName = (field: string): string => {
      if (isCustomField(field)) {
        const fieldId = getCustomFieldId(field);
        const customField = customFields.find(f => f.id === fieldId);
        return customField?.name || '未知字段';
      }
      return FIELD_LABELS[field] || field;
    };
    
    const separatorToDisplayFormat: Record<string, string> = {
      '{}': '{ * }',
      '()': '( * )',
      '[]': '[ * ]',
      '<>': '< * >',
    };
    
    const separatorForDisplay = separatorToDisplayFormat[finalSeparator] || finalSeparator;
    const separatorDisplay = finalSeparator === ' ' ? '空格' : `"${separatorForDisplay}"`;
    const fieldDisplay = selectedFields.map(f => getFieldDisplayName(f)).join(' → ');
    const autoDescription = `分隔符: ${separatorDisplay} | 字段: ${fieldDisplay}`;
    
    // 保存的规则数据（避免 undefined 被 JSON.stringify 忽略）
    const ruleData: Parameters<typeof addRule>[0] = {
      name: ruleName.trim(),
      description: autoDescription,
      separator: finalSeparator,
      fieldOrder: selectedFields,
      isActive: true,
      supplierName: supplierName.trim(),
      matchConditions: matchConditions.length > 0 ? matchConditions : [],
      // 提取自定义字段ID
      customFieldIds: selectedFields
        .filter(f => isCustomField(f))
        .map(f => getCustomFieldId(f)),
    };

    try {
      if (editingRule) {
        await updateRule(editingRule.id, ruleData);
        alert.showSuccess('规则已更新');
      } else {
        await addRule(ruleData);
        alert.showSuccess('规则已添加');
      }
      setModalVisible(false);
      loadData();
    } catch (error) {
      logger.error('保存规则失败:', error);
      alert.showError('保存失败');
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
          loadData();
        } catch (error) {
      logger.error('删除规则失败:', error);
          alert.showError('删除失败');
        }
      },
      true
    );
  };
  
  // 切换字段选择
  const toggleField = (fieldKey: string) => {
    if (selectedFields.includes(fieldKey)) {
      setSelectedFields(selectedFields.filter(f => f !== fieldKey));
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
    }
  };
  
  const moveFieldDown = (index: number) => {
    if (index < selectedFields.length - 1) {
      const newFields = [...selectedFields];
      [newFields[index], newFields[index + 1]] = [newFields[index + 1], newFields[index]];
      setSelectedFields(newFields);
    }
  };
  
  // 获取字段显示名称
  const getFieldDisplayName = (fieldKey: string): string => {
    if (isCustomField(fieldKey)) {
      const fieldId = getCustomFieldId(fieldKey);
      const customField = customFields.find(f => f.id === fieldId);
      return customField?.name || '未知字段';
    }
    return FIELD_LABELS[fieldKey] || fieldKey;
  };
  
  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>解析规则</Text>
          </View>
          <TouchableOpacity style={styles.addButton} activeOpacity={0.9} onPress={handleAddRule}>
                <Text style={styles.addButtonText}>新增</Text>
          </TouchableOpacity>
        </View>
        
        {/* 规则列表 */}
        <ScrollView 
          style={styles.container}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
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
              {rules.map((rule) => (
                <View 
                  key={rule.id} 
                  style={styles.ruleItem}
                >
                  <TouchableOpacity
                    style={styles.ruleContent}
                    activeOpacity={0.9}
                    onPress={() => handleEditRule(rule)}
                    onLongPress={() => handleDeleteRule(rule)}
                    delayLongPress={800}
                  >
                    {/* 第一行：规则名称（加大加粗） */}
                    <Text style={styles.ruleName} numberOfLines={1}>{rule.name}</Text>
                    {/* 第二行：分隔符 */}
                    <Text style={styles.ruleSeparator} numberOfLines={1}>
                      分隔符：
                      {(() => {
                        const separatorDisplayMap: Record<string, string> = {
                          '{}': '{*}',
                          '()': '(*)',
                          '[]': '[*]',
                          '<>': '<*>',
                        };
                        return rule.separator === ' ' ? '空格' 
                          : (separatorDisplayMap[rule.separator] || rule.separator);
                      })()}
                    </Text>
                    {/* 第三行：字段顺序预览 */}
                    <Text style={styles.ruleFields} numberOfLines={1}>
                      字段：
                      {(() => {
                        if (!rule.fieldOrder || rule.fieldOrder.length === 0) {
                          return '未配置';
                        }
                        return rule.fieldOrder.map((field, index) => {
                          let label: string;
                          if (isCustomField(field)) {
                            // 自定义字段
                            const fieldId = getCustomFieldId(field);
                            const customField = customFields.find(f => f.id === fieldId);
                            label = customField?.name || field;
                          } else {
                            // 标准字段
                            label = FIELD_LABELS[field] || field;
                          }
                          return index === 0 ? label : ` → ${label}`;
                        }).join('');
                      })()}
                    </Text>
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
        onRequestClose={() => setModalVisible(false)}
      >
        <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
          <View style={[styles.ruleEditorScreen, { paddingTop: insets.top }]}>
            <View style={styles.ruleEditorHeader}>
              <AppModalHeader
                title={editingRule ? '编辑规则' : '添加规则'}
                onClose={() => setModalVisible(false)}
              />
            </View>

            <KeyboardAwareFormScrollView
              style={styles.ruleEditorBody}
              contentContainerStyle={styles.ruleEditorBodyContent}
              bottomOffset={Math.max(insets.bottom, 20) + 84}
              extraScrollHeight={18}
              showsVerticalScrollIndicator={true}
            >
              {/* 规则名称 */}
              <Text style={styles.inputLabel}>规则名称 *</Text>
              <TextInput
                ref={ruleNameInputRef}
                style={styles.textInput}
                placeholder="如：极海半导体"
                placeholderTextColor={theme.textMuted}
                value={ruleName}
                onChangeText={setRuleName}
              />
              
              {/* 分隔符 */}
              <Text style={styles.inputLabel}>分隔符 *</Text>
              <View style={styles.separatorOptions}>
                {['/', '|', ',', '*', '#', ' ', ';', ':', '{ * }', '( * )', '[ * ]', '< * >'].map((sep) => (
                  <TouchableOpacity key={sep}
                    style={[
                      styles.separatorBtn,
                      ruleSeparator === sep && styles.separatorBtnActive,
                    ]}
                    activeOpacity={0.7} onPress={() => {
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
                <TouchableOpacity style={[
                    styles.separatorBtn,
                    ruleSeparator === 'custom' && styles.separatorBtnActive,
                  ]}
                  activeOpacity={0.7} onPress={() => {
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
                <TouchableOpacity style={[
                    styles.separatorBtn,
                    ruleSeparator === 'special' && styles.separatorBtnActive,
                  ]}
                  activeOpacity={0.7} onPress={() => {
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
                <View style={{ marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { marginBottom: Spacing.xs, fontSize: rf(12) }]}>左符号</Text>
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
                    <Text style={[styles.inputLabel, { marginBottom: Spacing.xs, fontSize: rf(12) }]}>右符号</Text>
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
                      示例: {customLeftBracket}字段1{customRightBracket}{customLeftBracket}字段2{customRightBracket}
                    </Text>
                  )}
                </View>
              )}
              
              {/* 字段顺序 */}
              <Text style={styles.inputLabel}>标准字段（点击添加/移除）</Text>
              <View style={styles.fieldOptions}>
                {AVAILABLE_FIELDS.map((field) => (
                  <TouchableOpacity key={field}
                    style={[
                      styles.fieldBtn,
                      selectedFields.includes(field) && styles.fieldBtnActive,
                    ]}
                    activeOpacity={0.7} onPress={() => toggleField(field)}
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
              
              {/* 自定义字段选择 */}
              {customFields.length > 0 && (
                <View style={styles.customFieldsSection}>
                  <Text style={styles.inputLabel}>自定义字段（点击添加/移除）</Text>
                  <View style={styles.fieldOptions}>
                    {customFields.map((field) => {
                      const fieldKey = createCustomFieldKey(field.id);
                      const isSelected = selectedFields.includes(fieldKey);
                      return (
                        <TouchableOpacity key={field.id}
                          style={[
                            styles.fieldBtn,
                            isSelected && styles.fieldBtnActive,
                          ]}
                          activeOpacity={0.7} onPress={() => toggleField(fieldKey)}
                        >
                          <Text
                            style={[
                              styles.fieldBtnText,
                              isSelected && styles.fieldBtnTextActive,
                            ]}
                          >
                            {field.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
              
              {/* 已选字段顺序 */}
              {selectedFields.length > 0 && (
                <View style={styles.selectedFieldsContainer}>
                  <Text style={styles.selectedFieldsLabel}>字段顺序（可调整）：</Text>
                  {selectedFields.map((fieldKey, index) => {
                    const isCustom = isCustomField(fieldKey);
                    const displayName = getFieldDisplayName(fieldKey);
                    return (
                      <View key={fieldKey} style={styles.selectedFieldItem}>
                        <Text style={styles.selectedFieldIndex}>{index + 1}.</Text>
                        <Text style={styles.selectedFieldName}>{displayName}</Text>
                        {isCustom && (
                          <View style={[styles.customTag, { backgroundColor: 'rgba(14, 165, 233, 0.12)' }]}>
                            <Text style={[styles.customTagText, { color: theme.accent }]}>自定义</Text>
                          </View>
                        )}
                        <View style={styles.selectedFieldActions}>
                          <TouchableOpacity onPress={() => moveFieldUp(index)}>
                            <Text style={styles.moveBtn}>↑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => moveFieldDown(index)}>
                            <Text style={styles.moveBtn}>↓</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              
              {/* 识别条件配置 */}
              <View style={styles.sectionContainer}>
                <Text style={styles.inputLabel}>识别条件（可选）</Text>
                <Text style={styles.sectionHint}>当多个规则分隔符和字段数相同时，通过特定字段值来区分</Text>
                
                {/* 供应商名称 */}
                <View style={styles.conditionInputRow}>
                  <Text style={styles.inputRowLabel}>供应商</Text>
                  <TextInput
                    style={styles.inputRowField}
                    placeholder="选填"
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
                      const displayName = fieldKey ? getFieldDisplayName(fieldKey) : `第${condition.fieldIndex + 1}个字段`;
                      return (
                        <View key={index} style={styles.conditionItem}>
                          <Text style={styles.conditionText}>
                            {`${displayName} 包含 "${condition.keyword}"`}
                          </Text>
                          <TouchableOpacity  activeOpacity={0.7} onPress={() => {
                              setMatchConditions(prev => prev.filter((_, i) => i !== index));
                            }}
                          >
                            <Text style={styles.removeConditionBtn}>✕</Text>
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
                        <TouchableOpacity style={styles.fieldSelectBtn}
                          activeOpacity={0.7} onPress={() => {
                            if (!newConditionIndex) {
                              setNewConditionIndex('1');
                            } else {
                              const next = parseInt(newConditionIndex, 10) + 1;
                              if (next > selectedFields.length) {
                                setNewConditionIndex('1');
                              } else {
                                setNewConditionIndex(next.toString());
                              }
                            }
                          }}
                        >
                          <Text style={styles.fieldSelectText} numberOfLines={1}>
                            {newConditionIndex ? getFieldDisplayName(selectedFields[parseInt(newConditionIndex, 10) - 1]) : '点击选择'}
                          </Text>
                        </TouchableOpacity>
                        <Text style={styles.conditionLabel}>包含</Text>
                      </View>
                      <View style={styles.conditionInputRow}>
                        <Text style={styles.inputRowLabel}>关键字</Text>
                        <TextInput
                          style={styles.conditionKeywordInput}
                          placeholder="请输入"
                          placeholderTextColor={theme.textMuted}
                          value={newConditionKeyword}
                          onChangeText={setNewConditionKeyword}
                        />
                        <TouchableOpacity style={styles.addConditionBtn}
                          activeOpacity={0.7} onPress={handleAddMatchCondition}
                        >
                          <Text style={styles.addConditionBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.noFieldsHint}>请先选择字段</Text>
                  )}
                </View>
              </View>
            </KeyboardAwareFormScrollView>

            <View style={[styles.ruleEditorFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <AppModalActions
                containerStyle={styles.ruleEditorActions}
                secondaryLabel="取消"
                onSecondaryPress={() => setModalVisible(false)}
                primaryLabel="保存"
                onPrimaryPress={handleSaveRule}
              />
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
