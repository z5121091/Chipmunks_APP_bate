import { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppModalActions } from '@/components/AppModalActions';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { Screen } from '@/components/Screen';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { getAllWarehouses, type Warehouse } from '@/utils/database';
import {
  clearOutboundWarehouseOrderRule,
  doOutboundOrderRulesConflict,
  getOutboundOrderRuleSummary,
  inferOutboundOrderRuleFromSample,
  loadOutboundWarehouseOrderRules,
  saveOutboundWarehouseOrderRule,
  type OutboundWarehouseSampleRuleMap,
} from '@/utils/outboundOrderRule';
import { createStyles } from './styles';

export default function OutboundOrderRulesScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseRules, setWarehouseRules] = useState<OutboundWarehouseSampleRuleMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeWarehouse, setActiveWarehouse] = useState<Warehouse | null>(null);
  const [activeSampleText, setActiveSampleText] = useState('');

  const configuredWarehouseCount = useMemo(
    () => warehouses.filter((warehouse) => !!warehouseRules[String(warehouse.id)]).length,
    [warehouseRules, warehouses]
  );

  const activeParseResult = useMemo(() => {
    if (!activeSampleText.trim()) {
      return {
        rule: null,
        summary: null,
        error: '请填写这个仓库的真实出库单号样例',
      };
    }

    try {
      const nextRule = inferOutboundOrderRuleFromSample(activeSampleText);
      return {
        rule: nextRule,
        summary: getOutboundOrderRuleSummary(nextRule),
        error: '',
      };
    } catch (error) {
      return {
        rule: null,
        summary: null,
        error: error instanceof Error ? error.message : '订单号样例无法识别',
      };
    }
  }, [activeSampleText]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [warehouseList, savedWarehouseRules] = await Promise.all([
        getAllWarehouses(),
        loadOutboundWarehouseOrderRules(),
      ]);
      setWarehouses(warehouseList);
      setWarehouseRules(savedWarehouseRules);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const openWarehouseEditor = useCallback(
    (warehouse: Warehouse) => {
      setActiveWarehouse(warehouse);
      setActiveSampleText(warehouseRules[String(warehouse.id)]?.sample || '');
    },
    [warehouseRules]
  );

  const closeWarehouseEditor = useCallback(() => {
    if (saving) {
      return;
    }
    setActiveWarehouse(null);
    setActiveSampleText('');
  }, [saving]);

  const handleSaveWarehouseRule = useCallback(async () => {
    if (!activeWarehouse || !activeParseResult.rule) {
      return;
    }

    const activeWarehouseId = String(activeWarehouse.id);
    const availableWarehouseIds = new Set(warehouses.map((warehouse) => String(warehouse.id)));
    const conflictEntry = Object.entries(warehouseRules).find(([warehouseId, rule]) => {
      return (
        warehouseId !== activeWarehouseId &&
        availableWarehouseIds.has(warehouseId) &&
        doOutboundOrderRulesConflict(activeParseResult.rule!, rule)
      );
    });

    if (conflictEntry) {
      const conflictWarehouse = warehouses.find(
        (warehouse) => String(warehouse.id) === conflictEntry[0]
      );
      alert.showWarning(`该样例会同时匹配 ${conflictWarehouse?.name || '其他仓库'}，请调整后再保存`);
      return;
    }

    setSaving(true);
    try {
      const nextRules = await saveOutboundWarehouseOrderRule(
        activeWarehouseId,
        activeParseResult.rule
      );
      setWarehouseRules(nextRules);
      setActiveWarehouse(null);
      setActiveSampleText('');
      alert.showSuccess(`已保存 ${activeWarehouse.name} 的出库单号样例`);
    } catch (error) {
      alert.showWarning(error instanceof Error ? error.message : '仓库规则保存失败');
    } finally {
      setSaving(false);
    }
  }, [activeParseResult.rule, activeWarehouse, alert, warehouseRules, warehouses]);

  const handleClearWarehouseRule = useCallback(async () => {
    if (!activeWarehouse) {
      return;
    }

    setSaving(true);
    try {
      const nextRules = await clearOutboundWarehouseOrderRule(String(activeWarehouse.id));
      setWarehouseRules(nextRules);
      setActiveWarehouse(null);
      setActiveSampleText('');
      alert.showSuccess(`已清空 ${activeWarehouse.name} 的出库单号样例`);
    } finally {
      setSaving(false);
    }
  }, [activeWarehouse, alert]);

  const renderSummary = () => {
    if (!activeParseResult.summary) {
      return (
        <View style={styles.errorHint}>
          <Feather name="alert-circle" size={15} color={theme.error} />
          <Text style={styles.errorHintText}>{activeParseResult.error}</Text>
        </View>
      );
    }

    return (
      <View style={styles.summaryGrid}>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
            {activeParseResult.summary.prefix}
          </Text>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            前缀
          </Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
            {activeParseResult.summary.separator}
          </Text>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            分隔符
          </Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue} numberOfLines={1}>
            {activeParseResult.summary.segmentCount}
          </Text>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            字段
          </Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
            {activeParseResult.summary.sequence}
          </Text>
          <Text style={styles.summaryLabel} numberOfLines={1}>
            最后序号
          </Text>
        </View>
      </View>
    );
  };

  const renderListHeader = () => (
    <View>
      <View style={styles.configCard}>
        <View style={styles.configHeader}>
          <View style={[styles.configIcon, { backgroundColor: `${theme.primary}18` }]}>
            <Feather name="sliders" size={20} color={theme.primary} />
          </View>
          <View style={styles.configTitleWrap}>
            <Text style={styles.configTitle}>出库单号规则</Text>
            <Text style={styles.configSubtitle}>
              每个仓库维护一个真实订单号样例，扫码时唯一命中后自动切换仓库。
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>仓库绑定</Text>
          <Text style={styles.sectionDesc}>
            已配置 {configuredWarehouseCount}/{warehouses.length} 个仓库
          </Text>
        </View>
      </View>
    </View>
  );

  const renderWarehouse = useCallback(
    ({ item }: { item: Warehouse }) => {
      const rule = warehouseRules[String(item.id)];
      const configured = !!rule;

      return (
        <TouchableOpacity
          style={[styles.warehouseCard, configured && styles.warehouseCardConfigured]}
          activeOpacity={0.78}
          onPress={() => openWarehouseEditor(item)}
        >
          <View style={styles.warehouseTopRow}>
            <View style={styles.warehouseNameWrap}>
              <View style={[styles.warehouseIcon, configured && styles.warehouseIconConfigured]}>
                <Feather
                  name={configured ? 'link' : 'box'}
                  size={16}
                  color={configured ? theme.buttonPrimaryText : theme.textSecondary}
                />
              </View>
              <View style={styles.warehouseTextWrap}>
                <View style={styles.warehouseTitleRow}>
                  <Text style={styles.warehouseName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.is_default ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>默认</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.warehouseDesc} numberOfLines={1}>
                  {configured ? rule.sample : '点按设置订单号样例'}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={theme.textMuted} />
          </View>
        </TouchableOpacity>
      );
    },
    [
      openWarehouseEditor,
      styles.defaultBadge,
      styles.defaultBadgeText,
      styles.warehouseCard,
      styles.warehouseCardConfigured,
      styles.warehouseDesc,
      styles.warehouseIcon,
      styles.warehouseIconConfigured,
      styles.warehouseName,
      styles.warehouseNameWrap,
      styles.warehouseTextWrap,
      styles.warehouseTitleRow,
      styles.warehouseTopRow,
      theme.buttonPrimaryText,
      theme.textMuted,
      theme.textSecondary,
      warehouseRules,
    ]
  );

  if (activeWarehouse) {
    return (
      <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
        <View style={[styles.editorScreen, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.7}
              onPress={closeWarehouseEditor}
            >
              <Feather name="arrow-left" size={20} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title}>编辑订单号样例</Text>
          </View>

          <KeyboardAwareFormScrollView
            contentContainerStyle={[
              styles.editorContent,
              { paddingBottom: insets.bottom + 100 },
            ]}
          >
            <View style={styles.editorInfoCard}>
              <View style={styles.editorInfoTopRow}>
                <View style={styles.editorBadge}>
                  <Feather name="box" size={18} color={theme.primary} />
                </View>
                <View style={styles.editorTitleWrap}>
                  <Text style={styles.editorTitle}>{activeWarehouse.name}</Text>
                  <Text style={styles.editorSubtitle}>
                    扫描同结构订单号时，APP 会自动切换到这个仓库。
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.editorInputCard}>
              <Text style={styles.editorInputLabel}>订单号样例</Text>
              <View style={styles.editorInputWrap}>
                <TextInput
                  style={styles.editorInput}
                  value={activeSampleText}
                  onChangeText={setActiveSampleText}
                  placeholder="例如 IO-2000-01-01-01"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
              <Text style={styles.editorHint}>
                只需要填这个仓库的一个真实样例。前缀、分隔符、字段数量和最后序号位数都会自动识别。
              </Text>
              {renderSummary()}
            </View>

            <AppModalActions
              primaryLabel={saving ? '保存中...' : '保存样例'}
              onPrimaryPress={handleSaveWarehouseRule}
              secondaryLabel="清空样例"
              onSecondaryPress={handleClearWarehouseRule}
              primaryDisabled={saving || !activeParseResult.rule}
              containerStyle={styles.editorActions}
            />
          </KeyboardAwareFormScrollView>
        </View>
        {alert.AlertComponent}
      </Screen>
    );
  }

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
          <Text style={styles.title}>出库单号规则</Text>
        </View>

        <FlatList
          data={warehouses}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderWarehouse}
          refreshing={loading}
          onRefresh={loadData}
          ListHeaderComponent={renderListHeader}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 100 },
            warehouses.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={
            <AppEmptyState
              icon="box"
              title="暂无仓库"
              description="请先在仓库档案中创建仓库，再配置出库单号样例。"
              style={styles.emptyContainer}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.itemGap} />}
          showsVerticalScrollIndicator={false}
        />
      </View>
      {alert.AlertComponent}
    </Screen>
  );
}
