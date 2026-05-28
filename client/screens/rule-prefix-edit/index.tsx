import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalHeader } from '@/components/AppModalHeader';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { Screen } from '@/components/Screen';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { logger } from '@/utils/logger';
import {
  CustomField,
  FIELD_LABELS,
  FieldPrefixes,
  QRCodeRule,
  getAllCustomFields,
  getCustomFieldId,
  getRuleById,
  isCustomField,
  updateRule,
} from '@/utils/database';
import { createStyles } from './styles';

type FieldRow = {
  key: string;
  index: number;
  label: string;
  subtitle: string;
};

const getFieldMeta = (fieldKey: string, index: number, customFields: CustomField[]): FieldRow => {
  if (isCustomField(fieldKey)) {
    const fieldId = getCustomFieldId(fieldKey);
    const customField = customFields.find((field) => field.id === fieldId);
    return {
      key: fieldKey,
      index,
      label: customField?.name || '未知自定义字段',
      subtitle: fieldKey,
    };
  }

  return {
    key: fieldKey,
    index,
    label: FIELD_LABELS[fieldKey] || fieldKey,
    subtitle: fieldKey,
  };
};

export default function RulePrefixEditScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const { showAlert, showError, AlertComponent } = useCustomAlert();
  const { ruleId } = useSafeSearchParams<{ ruleId?: string }>();

  const [rule, setRule] = useState<QRCodeRule | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [prefixes, setPrefixes] = useState<FieldPrefixes>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeField, setActiveField] = useState<FieldRow | null>(null);
  const [draftPrefix, setDraftPrefix] = useState('');

  const loadData = useCallback(async () => {
    if (!ruleId) {
      showError('未找到解析规则');
      return;
    }

    setLoading(true);
    try {
      const [ruleData, customFieldData] = await Promise.all([getRuleById(ruleId), getAllCustomFields()]);

      if (!ruleData) {
        showError('解析规则不存在');
        return;
      }

      setRule(ruleData);
      setCustomFields(customFieldData);
      setPrefixes(ruleData.fieldPrefixes || {});
    } catch (error) {
      logger.error('加载字段前缀配置失败:', error);
      showError('加载失败');
    } finally {
      setLoading(false);
    }
  }, [ruleId, showError]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const fields = useMemo(
    () => (rule?.fieldOrder || []).map((fieldKey, index) => getFieldMeta(fieldKey, index, customFields)),
    [customFields, rule?.fieldOrder]
  );

  const configuredCount = useMemo(
    () => fields.filter((field) => prefixes[field.key]?.trim()).length,
    [fields, prefixes]
  );

  const handleOpenEditor = useCallback(
    (field: FieldRow) => {
      setActiveField(field);
      setDraftPrefix(prefixes[field.key] || '');
    },
    [prefixes]
  );

  const handleCloseEditor = useCallback(() => {
    if (saving) {
      return;
    }
    setActiveField(null);
    setDraftPrefix('');
  }, [saving]);

  const handleApplyField = useCallback(() => {
    if (!activeField) {
      return;
    }

    const trimmedValue = draftPrefix.trim();
    setPrefixes((prev) => {
      const next = { ...prev };
      if (trimmedValue) {
        next[activeField.key] = trimmedValue;
      } else {
        delete next[activeField.key];
      }
      return next;
    });
    setActiveField(null);
    setDraftPrefix('');
  }, [activeField, draftPrefix]);

  const handleClearAll = useCallback(() => {
    showAlert(
      '清空全部',
      '确定清空该规则所有字段的前缀配置吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => setPrefixes({}),
        },
      ],
      'warning'
    );
  }, [showAlert]);

  const handleSave = useCallback(async () => {
    if (!rule || saving) {
      return;
    }

    const fieldKeys = new Set(fields.map((field) => field.key));
    const cleanedPrefixes = Object.entries(prefixes).reduce<FieldPrefixes>((acc, [fieldKey, value]) => {
      const trimmedValue = value.trim();
      if (fieldKeys.has(fieldKey) && trimmedValue) {
        acc[fieldKey] = trimmedValue;
      }
      return acc;
    }, {});

    setSaving(true);
    try {
      await updateRule(rule.id, { fieldPrefixes: cleanedPrefixes });
      setRule((prev) => (prev ? { ...prev, fieldPrefixes: cleanedPrefixes } : prev));
      setPrefixes(cleanedPrefixes);
      showAlert(
        '成功',
        '字段前缀配置已保存',
        [{ text: '确定', onPress: () => router.back() }],
        'success'
      );
    } catch (error) {
      logger.error('保存字段前缀配置失败:', error);
      showError('保存失败');
    } finally {
      setSaving(false);
    }
  }, [fields, prefixes, router, rule, saving, showAlert, showError]);

  const renderField = useCallback(
    ({ item }: { item: FieldRow }) => {
      const value = prefixes[item.key]?.trim() || '';
      const configured = value.length > 0;

      return (
        <TouchableOpacity
          style={[styles.fieldCard, configured && styles.fieldCardConfigured]}
          activeOpacity={0.78}
          onPress={() => handleOpenEditor(item)}
        >
          <View style={styles.fieldTopRow}>
            <View style={styles.fieldIdentity}>
              <View style={[styles.fieldIndex, configured && styles.fieldIndexConfigured]}>
                <Text style={[styles.fieldIndexText, configured && styles.fieldIndexTextConfigured]}>
                  {item.index + 1}
                </Text>
              </View>
              <View style={styles.fieldTitleWrap}>
                <Text style={styles.fieldLabel}>{item.label}</Text>
                <Text style={styles.fieldSubtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              </View>
            </View>

            <View style={styles.fieldActions}>
              <View style={[styles.statusBadge, configured ? styles.statusBadgeConfigured : styles.statusBadgeEmpty]}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    configured ? styles.statusBadgeTextConfigured : styles.statusBadgeTextEmpty,
                  ]}
                >
                  {configured ? '已配置' : '未配置'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.textMuted} />
            </View>
          </View>

          <View style={[styles.prefixPreview, configured && styles.prefixPreviewConfigured]}>
            <Feather
              name={configured ? 'tag' : 'minus-circle'}
              size={14}
              color={configured ? theme.success : theme.textMuted}
            />
            <Text
              style={[styles.prefixPreviewText, configured && styles.prefixPreviewTextConfigured]}
              numberOfLines={1}
            >
              {configured ? value : '点击设置识别前缀'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [
      handleOpenEditor,
      prefixes,
      styles.fieldActions,
      styles.fieldCard,
      styles.fieldCardConfigured,
      styles.fieldIdentity,
      styles.fieldIndex,
      styles.fieldIndexConfigured,
      styles.fieldIndexText,
      styles.fieldIndexTextConfigured,
      styles.fieldLabel,
      styles.fieldSubtitle,
      styles.fieldTitleWrap,
      styles.fieldTopRow,
      styles.prefixPreview,
      styles.prefixPreviewConfigured,
      styles.prefixPreviewText,
      styles.prefixPreviewTextConfigured,
      styles.statusBadge,
      styles.statusBadgeConfigured,
      styles.statusBadgeEmpty,
      styles.statusBadgeText,
      styles.statusBadgeTextConfigured,
      styles.statusBadgeTextEmpty,
      theme.success,
      theme.textMuted,
    ]
  );

  const renderHeader = useCallback(
    () => (
      <View style={styles.ruleInfoCard}>
        <View style={styles.ruleTitleRow}>
          <View style={styles.ruleIconBadge}>
            <Feather name="sliders" size={18} color={theme.success} />
          </View>
          <View style={styles.ruleTitleContent}>
            <Text style={styles.ruleName}>{rule?.name || '加载中'}</Text>
            <Text style={styles.ruleDescription}>{rule?.description || '未填写规则描述'}</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillValue}>{fields.length}</Text>
            <Text style={styles.summaryPillLabel}>字段</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillValue}>{configuredCount}</Text>
            <Text style={styles.summaryPillLabel}>已配置</Text>
          </View>
          <View style={styles.summaryPill}>
            <Text style={styles.summaryPillValue}>{Math.max(fields.length - configuredCount, 0)}</Text>
            <Text style={styles.summaryPillLabel}>待处理</Text>
          </View>
        </View>
      </View>
    ),
    [
      configuredCount,
      fields.length,
      rule?.description,
      rule?.name,
      styles.ruleDescription,
      styles.ruleIconBadge,
      styles.ruleInfoCard,
      styles.ruleName,
      styles.ruleTitleContent,
      styles.ruleTitleRow,
      styles.summaryPill,
      styles.summaryPillLabel,
      styles.summaryPillValue,
      styles.summaryRow,
      theme.success,
    ]
  );

  const activeFieldConfigured = activeField ? (prefixes[activeField.key]?.trim() || '').length > 0 : false;

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>编辑前缀</Text>
        </View>

        <FlatList
          data={fields}
          keyExtractor={(item) => item.key}
          renderItem={renderField}
          refreshing={loading}
          onRefresh={loadData}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIcon}>
                  <Feather name="list" size={28} color={theme.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>该规则暂无字段</Text>
                <Text style={styles.emptyText}>请先到解析规则中补充字段顺序</Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />

        {rule && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              style={styles.clearAllButton}
              activeOpacity={0.72}
              onPress={handleClearAll}
              disabled={saving}
            >
              <Text style={styles.clearAllButtonText}>清空全部</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveButton}
              activeOpacity={0.72}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveButtonText}>{saving ? '保存中...' : '保存'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Modal
        visible={!!activeField}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleCloseEditor}
      >
        <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
          <View style={[styles.editorScreen, { paddingTop: insets.top }]}>
            <View style={styles.editorHeader}>
              <AppModalHeader
                title="编辑字段前缀"
                subtitle={activeField ? `${activeField.label} · 留空则不处理` : undefined}
                onClose={handleCloseEditor}
              />
            </View>

            <KeyboardAwareFormScrollView
              contentContainerStyle={styles.editorScrollContent}
              bottomOffset={Math.max(insets.bottom, 24) + 110}
              extraScrollHeight={20}
            >
              {activeField && (
                <>
                  <View style={styles.editorInfoCard}>
                    <View style={styles.editorInfoTopRow}>
                      <View style={styles.editorFieldBadge}>
                        <Text style={styles.editorFieldBadgeText}>{activeField.index + 1}</Text>
                      </View>
                      <View style={styles.editorFieldTextWrap}>
                        <Text style={styles.editorFieldLabel}>{activeField.label}</Text>
                        <Text style={styles.editorFieldSubtitle}>{activeField.subtitle}</Text>
                      </View>
                      <View
                        style={[
                          styles.editorStatusBadge,
                          activeFieldConfigured
                            ? styles.editorStatusBadgeConfigured
                            : styles.editorStatusBadgeEmpty,
                        ]}
                      >
                        <Text
                          style={[
                            styles.editorStatusText,
                            activeFieldConfigured
                              ? styles.editorStatusTextConfigured
                              : styles.editorStatusTextEmpty,
                          ]}
                        >
                          {activeFieldConfigured ? '已配置' : '未配置'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.editorInputCard}>
                    <Text style={styles.editorInputLabel}>字段前缀</Text>
                    <View style={styles.editorInputWrap}>
                      <TextInput
                        style={styles.editorInput}
                        value={draftPrefix}
                        onChangeText={setDraftPrefix}
                        placeholder="输入前缀，留空则不处理"
                        placeholderTextColor={theme.textMuted}
                        autoFocus
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleApplyField}
                      />
                    </View>
                    <Text style={styles.editorHint}>
                      留空则不处理，匹配时不区分大小写。
                    </Text>
                  </View>
                </>
              )}
            </KeyboardAwareFormScrollView>

            <View style={[styles.editorFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <AppModalActions
                containerStyle={styles.editorActions}
                secondaryLabel="清空当前"
                onSecondaryPress={() => setDraftPrefix('')}
                primaryLabel="保存"
                onPrimaryPress={handleApplyField}
              />
            </View>
          </View>
        </Screen>
      </Modal>

      {AlertComponent}
    </Screen>
  );
}
