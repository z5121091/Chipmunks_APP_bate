import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { createStyles } from './styles';
import {
  getMaterial,
  deleteMaterial,
  getOrder,
  MaterialRecord,
  getRuleById,
  getAllRules,
} from '@/utils/database';
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
  const [ruleSeparator, setRuleSeparator] = useState<string>('/'); // 规则的分隔符
  const [ruleName, setRuleName] = useState<string>(''); // 规则名称
  
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

        // 如果有规则 ID，只加载当时使用的规则信息。
        if (result.rule_id) {
          const rule = await getRuleById(result.rule_id);
          if (rule) {
            updateIfActive(() => {
              setRuleSeparator(result.separator || rule.separator || '/');
              setRuleName(rule.name || '');
            });
          }
        } else if (result.separator) {
          // 没有规则ID时，使用记录中存储的分隔符
          updateIfActive(() => {
            setRuleSeparator(result.separator || '/');
          });
          // 优先按扫码时保存的规则名称恢复；旧记录再按分隔符兼容查找。
          const rules = await getAllRules();
          const matchedRule =
            rules.find((r) => result.rule_name && r.name === result.rule_name) ||
            rules.find((r) => r.separator === result.separator);
          if (matchedRule) {
            updateIfActive(() => {
              setRuleName(matchedRule.name || '');
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
      
      {/* 自定义弹窗 */}
      {alert.AlertComponent}
    </Screen>
  );
}
