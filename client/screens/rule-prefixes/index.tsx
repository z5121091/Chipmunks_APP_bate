import { useCallback, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { AppEmptyState } from '@/components/AppEmptyState';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { getAllRules, QRCodeRule } from '@/utils/database';
import { createStyles } from './styles';

const getSeparatorLabel = (separator: string): string => {
  const separatorDisplayMap: Record<string, string> = {
    '{}': '{*}',
    '()': '(*)',
    '[]': '[*]',
    '<>': '<*>',
    ' ': '空格',
  };

  return separatorDisplayMap[separator] || separator || '未配置';
};

const getPrefixCount = (rule: QRCodeRule): number => {
  const prefixes = rule.fieldPrefixes || {};
  return (rule.fieldOrder || []).filter((fieldKey) => prefixes[fieldKey]?.trim()).length;
};

export default function RulePrefixesScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();

  const [rules, setRules] = useState<QRCodeRule[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllRules();
      setRules(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRules();
    }, [loadRules])
  );

  const renderRule = useCallback(
    ({ item }: { item: QRCodeRule }) => {
      const prefixCount = getPrefixCount(item);

      return (
        <TouchableOpacity
          style={styles.ruleCard}
          activeOpacity={0.72}
          onPress={() => router.push('/rule-prefix-edit', { ruleId: item.id })}
        >
          <View style={styles.ruleHeader}>
            <View style={styles.ruleTitleWrap}>
              <Text style={styles.ruleName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.ruleDescription} numberOfLines={2}>
                {item.description || '未填写规则描述'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.textMuted} />
          </View>

          <View style={styles.ruleMetaRow}>
            <View style={styles.metaPill}>
              <Feather name="scissors" size={12} color={theme.textSecondary} />
              <Text style={styles.metaText}>分隔符 {getSeparatorLabel(item.separator)}</Text>
            </View>
            <View style={styles.metaPill}>
              <Feather name="list" size={12} color={theme.textSecondary} />
              <Text style={styles.metaText}>{item.fieldOrder?.length || 0} 个字段</Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            {!item.isActive && (
              <View style={styles.disabledBadge}>
                <Text style={styles.disabledBadgeText}>未启用</Text>
              </View>
            )}
            {prefixCount > 0 && (
              <View style={styles.prefixBadge}>
                <Text style={styles.prefixBadgeText}>{prefixCount} 个前缀</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [
      router,
      styles.badgeRow,
      styles.disabledBadge,
      styles.disabledBadgeText,
      styles.metaPill,
      styles.metaText,
      styles.prefixBadge,
      styles.prefixBadgeText,
      styles.ruleCard,
      styles.ruleDescription,
      styles.ruleHeader,
      styles.ruleMetaRow,
      styles.ruleName,
      styles.ruleTitleWrap,
      theme.textMuted,
      theme.textSecondary,
    ]
  );

  const renderSeparator = useCallback(() => <View style={styles.itemGap} />, [styles.itemGap]);

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>字段前缀配置</Text>
          </View>
        </View>

        <FlatList
          data={rules}
          keyExtractor={(item) => item.id}
          renderItem={renderRule}
          refreshing={loading}
          onRefresh={loadRules}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 100 },
            rules.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={
            <AppEmptyState
              icon="sliders"
              title="暂无解析规则"
              description="请先创建解析规则，再按字段设置识别前缀。"
              style={styles.emptyContainer}
            />
          }
          ItemSeparatorComponent={renderSeparator}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </Screen>
  );
}
