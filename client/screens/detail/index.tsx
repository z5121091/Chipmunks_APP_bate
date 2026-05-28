import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, Modal, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { createStyles } from './styles';
import { getMaterial, deleteMaterial, getOrder, MaterialRecord, getAllCustomFields, CustomField, updateMaterialCustomFields, getRuleById, getAllRules } from '@/utils/database';
import { formatDateTime } from '@/utils/time';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { rf } from '@/utils/responsive';
import { Spacing } from '@/constants/theme';
import { logger } from '@/utils/logger';

export default function DetailScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const searchParams = useSafeSearchParams<{ id: string }>();
  const alert = useCustomAlert();
  
  const [record, setRecord] = useState<MaterialRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string>('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [ruleCustomFieldIds, setRuleCustomFieldIds] = useState<string[]>([]);
  const [ruleSeparator, setRuleSeparator] = useState<string>('/'); // 规则的分隔符
  const [ruleName, setRuleName] = useState<string>(''); // 规则名称
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCustomFields, setEditingCustomFields] = useState<Record<string, string>>({});
  
  // 初始化数据库并加载记录
  useEffect(() => {
    let cancelled = false;

    const updateIfActive = (fn: () => void) => {
      if (!cancelled) {
        fn();
      }
    };

    const loadRecord = async () => {
      updateIfActive(() => {
        setLoading(true);
        setError(null);
        setRecord(null);
        setCustomerName('');
        setCustomFields([]);
        setRuleCustomFieldIds([]);

        setRuleName('');
        setRuleSeparator('/');
      });

      if (!searchParams.id) {
        updateIfActive(() => {
          setError('缺少记录ID');
          setLoading(false);
        });
        return;
      }
      
      try {
        const result = await getMaterial(searchParams.id);
        if (!result) {
          updateIfActive(() => {
            setError('记录不存在');
          });
          return;
        }

        updateIfActive(() => {
          setRecord(result);
        });

        // 根据订单号获取最新的客户名称
        const order =
          (await getOrder(result.order_no, result.warehouse_id)) || (await getOrder(result.order_no));
        updateIfActive(() => {
          if (order && order.customer_name) {
            setCustomerName(order.customer_name);
          } else if (result.customer_name) {
            setCustomerName(result.customer_name);
          }
        });

        // 加载所有自定义字段
        const allFields = await getAllCustomFields();
        updateIfActive(() => {
          setCustomFields(allFields);
        });
        
        // 如果有规则ID，加载规则关联的自定义字段
        if (result.rule_id) {
          // 从规则中获取信息
          const rule = await getRuleById(result.rule_id);
          if (rule) {
            updateIfActive(() => {
              setRuleSeparator(result.separator || rule.separator || '/');
              setRuleName(rule.name || '');
              // 兼容新旧格式
              const hasCustomFieldsInOrder = rule.fieldOrder?.some((f: string) => f.startsWith('custom:'));
              if (hasCustomFieldsInOrder) {
                // 新格式：从 fieldOrder 提取自定义字段ID
                const customIds = rule.fieldOrder
                  .filter((f: string) => f.startsWith('custom:'))
                  .map((f: string) => f.replace('custom:', ''));
                setRuleCustomFieldIds(customIds);
              } else if (rule.customFieldIds) {
                // 旧格式：使用 customFieldIds
                setRuleCustomFieldIds(rule.customFieldIds);
              }
            });
          }
        } else if (result.separator) {
          // 没有规则ID时，使用记录中存储的分隔符
          updateIfActive(() => {
            setRuleSeparator(result.separator || '/');
          });
          // 尝试通过分隔符查找匹配的规则
          const rules = await getAllRules();
          const matchedRule = rules.find(r => r.separator === result.separator);
          if (matchedRule) {
            updateIfActive(() => {
              setRuleName(matchedRule.name || '');
              const hasCustomFieldsInOrder = matchedRule.fieldOrder?.some((f: string) => f.startsWith('custom:'));
              if (hasCustomFieldsInOrder) {
                const customIds = matchedRule.fieldOrder
                  .filter((f: string) => f.startsWith('custom:'))
                  .map((f: string) => f.replace('custom:', ''));
                setRuleCustomFieldIds(customIds);
              }
            });
          }
        }
      } catch (err) {
      logger.error('加载记录失败:', err);
        updateIfActive(() => {
          setError('加载记录失败');
        });
      } finally {
        updateIfActive(() => {
          setLoading(false);
        });
      }
    };

    void loadRecord();

    return () => {
      cancelled = true;
    };
  }, [searchParams.id]);
  
  // 复制内容
  const handleCopy = async () => {
    if (!record) return;
    
    const text = `订单号: ${record.order_no}
客户: ${customerName || '-'}
型号: ${record.model}
批次: ${record.batch}
封装: ${record.package || '-'}
版本号: ${record.version || '-'}
数量: ${record.quantity}
生产日期: ${record.productionDate || '-'}
箱号: ${record.sourceNo || '-'}
扫描时间: ${formatDateTime(record.scanned_at)}
原始内容: ${record.raw_content}`;
    
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        await Clipboard.setStringAsync(text);
      }
      alert.showSuccess('内容已复制到剪贴板');
    } catch (copyError) {
      logger.error('复制内容失败:', copyError);
      alert.showError('复制失败，请稍后重试');
    }
  };
  
  // 删除记录
  const handleDelete = () => {
    if (!record) return;
    
    alert.showConfirm(
      '确认删除',
      '确定要删除这条记录吗？',
      async () => {
        try {
          await deleteMaterial(record.id!);
          alert.showSuccess('记录已删除');
          router.back();
        } catch (error) {
      logger.error('删除失败:', error);
          alert.showError('删除失败');
        }
      },
      true
    );
  };
  
  // 返回
  const handleBack = () => {
    router.back();
  };
  
  // 打开编辑自定义字段弹窗
  const handleEditCustomFields = () => {
    if (!record) return;
    setEditingCustomFields(record.customFields || {});
    setEditModalVisible(true);
  };
  
  // 保存自定义字段
  const handleSaveCustomFields = async () => {
    if (!record) return;

    const normalizedCustomFields: Record<string, string> = {};
    const ruleCustomFields = getRuleCustomFields();

    for (const field of ruleCustomFields) {
      const rawValue = editingCustomFields[field.id] ?? '';
      const trimmedValue = rawValue.trim();

      if (field.required && !trimmedValue) {
        alert.showWarning(`${field.name} 为必填项`);
        return;
      }

      if (trimmedValue) {
        normalizedCustomFields[field.id] = trimmedValue;
      }
    }

    try {
      await updateMaterialCustomFields(record.id!, normalizedCustomFields);
      setRecord({ ...record, customFields: normalizedCustomFields });
      setEditModalVisible(false);
      alert.showSuccess('自定义字段已更新');
    } catch (error) {
      logger.error('保存自定义字段失败:', error);
      alert.showError('保存失败');
    }
  };
  
  // 获取规则关联的自定义字段
  const getRuleCustomFields = (): CustomField[] => {
    if (ruleCustomFieldIds.length === 0) return [];
    return customFields.filter(f => ruleCustomFieldIds.includes(f.id));
  };

  const getCustomFieldInputConfig = (field: CustomField) => {
    return {
      keyboardType: 'default' as const,
      placeholder: `请输入${field.name}`,
    };
  };
  
  // 加载中
  if (loading) {
    return (
      <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </Screen>
    );
  }
  
  // 错误状态
  if (error || !record) {
    return (
      <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error || '记录不存在'}</Text>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={handleBack}>
            <Text style={styles.backButtonText}>返回</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }
  
  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView 
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* 头部 */}
        <View style={styles.header}>
          <Text style={styles.title}>记录详情</Text>
        </View>
        
        {/* 基本信息 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>基本信息</Text>
          
          {/* 订单号单独一行，支持换行 */}
          <View style={styles.fieldColumn}>
            <Text style={styles.fieldLabel}>订单号</Text>
            <Text style={styles.fieldValueLong}>{record.order_no}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>客户名称</Text>
            <Text style={styles.fieldValue}>{customerName || '-'}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>扫描时间</Text>
            <Text style={styles.fieldValue}>
              {formatDateTime(record.scanned_at)}
            </Text>
          </View>
        </View>
        
        {/* 物料信息 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>物料信息</Text>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>型号</Text>
            <Text style={[styles.fieldValue, styles.modelValue]}>
              {record.model || '-'}
            </Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>批次</Text>
            <Text style={styles.fieldValue}>{record.batch || '-'}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>封装</Text>
            <Text style={styles.fieldValue}>{record.package || '-'}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>版本号</Text>
            <Text style={styles.fieldValue}>{record.version || '-'}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>数量</Text>
            <Text style={[styles.fieldValue, { color: theme.primary, fontWeight: '700' }]}>
              {record.quantity || '-'}
            </Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>生产日期</Text>
            <Text style={styles.fieldValue}>{record.productionDate || '-'}</Text>
          </View>
          
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>追踪码</Text>
            <Text style={styles.fieldValue}>{record.traceNo || '-'}</Text>
          </View>
          
          <View style={[styles.fieldRow, styles.fieldRowLast]}>
            <Text style={styles.fieldLabel}>箱号</Text>
            <Text style={styles.fieldValue}>{record.sourceNo || '-'}</Text>
          </View>
        </View>
        
        {/* 自定义字段 - 仅当规则有关联字段时显示 */}
        {getRuleCustomFields().length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>自定义字段</Text>
              <TouchableOpacity onPress={handleEditCustomFields}>
                <Feather name="edit-2" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
            {getRuleCustomFields().map(field => (
              <View key={field.id} style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{field.name}</Text>
                <Text style={styles.fieldValue}>
                  {record.customFields?.[field.id] || '-'}
                </Text>
              </View>
            ))}
          </View>
        )}
        
        {/* 原始内容 */}
        <View style={[styles.card, styles.rawContentCard]}>
          <Text style={styles.cardTitle}>原始二维码内容</Text>
          <Text style={styles.rawContentText}>
            {record.raw_content || '无'}
          </Text>
          
          {/* 解析诊断信息 */}
          {record.raw_content && (
            <View style={{ marginTop: Spacing.sm }}>
              <Text style={[styles.cardTitle, { fontSize: rf(13), marginBottom: 8 }]}>
                字段拆分结果：
              </Text>
              {(() => {
                // 支持多种括号格式的解析
                const BRACKET_PAIRS: Record<string, string> = {
                  '{': '}',
                  '(': ')',
                  '[': ']',
                  '<': '>',
                };
                
                // 检测括号格式
                const detectBracketFormat = (str: string): string | null => {
                  for (const left of Object.keys(BRACKET_PAIRS)) {
                    const right = BRACKET_PAIRS[left];
                    if (str.startsWith(left) && str.includes(right + left)) {
                      return left;
                    }
                  }
                  return null;
                };
                
                // 解析括号格式
                const splitByBracket = (str: string, leftBracket: string): string[] => {
                  const rightBracket = BRACKET_PAIRS[leftBracket];
                  let s = str.trim();
                  if (s.startsWith(leftBracket)) s = s.slice(1);
                  if (s.endsWith(rightBracket)) s = s.slice(0, -1);
                  return s.split(rightBracket + leftBracket).map(p => p.trim()).filter(p => p.length > 0);
                };
                
                let parts: string[];
                let displaySeparator: string;
                
                // 分隔符存储值到显示值的映射
                const separatorDisplayMap: Record<string, string> = {
                  '{}': '{ * }',
                  '()': '( * )',
                  '[]': '[ * ]',
                  '<>': '< * >',
                };
                
                const bracketLeft = detectBracketFormat(record.raw_content);
                const isBracketRule = ['{}', '()', '[]', '<>'].includes(ruleSeparator);
                // 检测是否为自定义特殊分隔符（长度为2，非预设括号）
                const isSpecialSeparator = ruleSeparator.length === 2 && !isBracketRule;
                
                if (isBracketRule || bracketLeft) {
                  // 预设括号格式
                  const leftBracket = bracketLeft || ruleSeparator[0];
                  parts = splitByBracket(record.raw_content, leftBracket);
                  displaySeparator = separatorDisplayMap[ruleSeparator] || ruleSeparator;
                } else if (isSpecialSeparator) {
                  // 自定义特殊分隔符（左右括号）
                  const leftBracket = ruleSeparator[0];
                  const rightBracket = ruleSeparator[1];
                  let str = record.raw_content.trim();
                  if (str.startsWith(leftBracket)) str = str.slice(1);
                  if (str.endsWith(rightBracket)) str = str.slice(0, -1);
                  parts = str.split(rightBracket + leftBracket).map(p => p.trim()).filter(p => p.length > 0);
                  displaySeparator = `${leftBracket} * ${rightBracket}`;
                } else {
                  parts = record.raw_content.split(ruleSeparator).filter(p => p.trim());
                  displaySeparator = ruleSeparator === ' ' ? '空格' : ruleSeparator;
                }
                
                return (
                  <View>
                    {parts.map((part, index) => (
                      <Text key={index} style={styles.rawContentText}>
                        [{index + 1}] {part}
                      </Text>
                    ))}
                    <Text style={[styles.rawContentText, { marginTop: Spacing.xs, color: theme.textSecondary }]}>
                      共 {parts.length} 个字段（分隔符: &quot;{displaySeparator}&quot;）
                    </Text>
                  </View>
                );
              })()}
            </View>
          )}
          
          {/* 规则信息 */}
          {(record.rule_name || ruleName) && (
            <View style={{ marginTop: Spacing.sm }}>
              <Text style={[styles.cardTitle, { fontSize: rf(13) }]}>
                使用规则: {record.rule_name || ruleName}
              </Text>
            </View>
          )}
        </View>
        
        {/* 操作按钮 */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.button} activeOpacity={0.7} onPress={handleCopy}>
            <Text style={styles.buttonText}>复制内容</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={[styles.secondaryButton, styles.dangerButton]} 
            activeOpacity={0.7} onPress={handleDelete}
          >
            <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>
              删除记录
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.7} onPress={handleBack}>
            <Text style={styles.secondaryButtonText}>返回</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      
      {/* 编辑自定义字段弹窗 */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title="编辑自定义字段"
            onClose={() => setEditModalVisible(false)}
            style={styles.modalContent}
            bodyStyle={styles.modalBodyContent}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={() => setEditModalVisible(false)}
                primaryLabel="保存"
                onPrimaryPress={handleSaveCustomFields}
              />
            }
          >
            <KeyboardAwareFormScrollView bottomOffset={16} extraScrollHeight={8}>
              {getRuleCustomFields().map(field => (
                <AppFormField key={field.id} label={field.name} required={field.required}>
                  {field.type === 'select' && field.options ? (
                    <View style={styles.optionsContainer}>
                      {field.options.map(opt => (
                        <TouchableOpacity key={opt}
                          style={[
                            styles.optionButton,
                            editingCustomFields[field.id] === opt && styles.optionButtonActive,
                          ]}
                          activeOpacity={0.76} onPress={() => setEditingCustomFields({ 
                            ...editingCustomFields, 
                            [field.id]: opt 
                          })}
                        >
                          <Text style={[
                            styles.optionButtonText,
                            editingCustomFields[field.id] === opt && styles.optionButtonTextActive,
                          ]}>
                            {opt}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <TextInput
                      style={styles.formInput}
                      value={editingCustomFields[field.id] || ''}
                      onChangeText={(text) => setEditingCustomFields({ 
                        ...editingCustomFields, 
                        [field.id]: text 
                      })}
                      placeholder={getCustomFieldInputConfig(field).placeholder}
                      placeholderTextColor={theme.textMuted}
                      keyboardType={getCustomFieldInputConfig(field).keyboardType}
                    />
                  )}
                </AppFormField>
              ))}
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>
      
      {/* 自定义弹窗 */}
      {alert.AlertComponent}
    </Screen>
  );
}
