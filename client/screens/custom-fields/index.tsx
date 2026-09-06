import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AppFormField } from '@/components/AppFormField';
import { createStyles } from './styles';
import { logger } from '@/utils/logger';
import {
  addCustomField,
  createCustomFieldKey,
  CustomField,
  deleteCustomField,
  getAllCustomFields,
  getAllRules,
  updateCustomField,
} from '@/utils/database';
import { useCustomAlert } from '@/components/CustomAlert';
import { useToast } from '@/utils/toast';

export default function CustomFieldsScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const showLoadError = alert.showError;
  const { showToast, ToastContainer } = useToast();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [fieldName, setFieldName] = useState('');

  const fieldNameInputRef = useRef<TextInput>(null);
  const fieldNameFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFields = useCallback(async () => {
    try {
      const data = await getAllCustomFields();
      setFields(data);
    } catch (error) {
      logger.error('加载占位字段失败:', error);
      showLoadError('占位字段加载失败，请重试');
    }
  }, [showLoadError]);

  useFocusEffect(
    useCallback(() => {
      void loadFields();
    }, [loadFields])
  );

  useEffect(() => {
    if (!modalVisible) {
      return undefined;
    }

    fieldNameFocusTimerRef.current = setTimeout(() => {
      fieldNameInputRef.current?.focus();
      fieldNameFocusTimerRef.current = null;
    }, 220);

    return () => {
      if (fieldNameFocusTimerRef.current) {
        clearTimeout(fieldNameFocusTimerRef.current);
        fieldNameFocusTimerRef.current = null;
      }
    };
  }, [modalVisible]);

  const closeModal = useCallback(() => {
    Keyboard.dismiss();
    setModalVisible(false);
  }, []);

  const resetForm = useCallback(() => {
    setEditingField(null);
    setFieldName('');
  }, []);

  const handleAddField = useCallback(() => {
    resetForm();
    setModalVisible(true);
  }, [resetForm]);

  const handleEditField = useCallback((field: CustomField) => {
    setEditingField(field);
    setFieldName(field.name);
    setModalVisible(true);
  }, []);

  const handleSaveField = useCallback(async () => {
    if (saving) {
      return;
    }

    const trimmedName = fieldName.trim();

    if (!trimmedName) {
      alert.showWarning('请输入占位字段名称');
      return;
    }

    if (
      fields.some(
        (field) =>
          field.id !== editingField?.id &&
          field.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
      )
    ) {
      alert.showWarning('已存在同名占位字段，请使用其他名称');
      return;
    }

    setSaving(true);
    try {
      if (editingField) {
        await updateCustomField(editingField.id, {
          name: trimmedName,
        });
        alert.showSuccess('占位字段已更新');
      } else {
        await addCustomField({
          name: trimmedName,
          type: 'text',
          required: false,
        });
        alert.showSuccess('占位字段已添加');
      }

      closeModal();
      await loadFields();
    } catch (error) {
      logger.error('保存占位字段失败:', error);
      alert.showError('保存失败');
    } finally {
      setSaving(false);
    }
  }, [alert, closeModal, editingField, fieldName, fields, loadFields, saving]);

  const handleDeleteField = useCallback(
    async (field: CustomField) => {
      try {
        const fieldKey = createCustomFieldKey(field.id);
        const rules = await getAllRules();
        const affectedRules = rules.filter(
          (rule) =>
            rule.fieldOrder.includes(fieldKey) || (rule.customFieldIds || []).includes(field.id)
        );

        if (affectedRules.length > 0) {
          const affectedNames = affectedRules
            .slice(0, 4)
            .map((rule) => rule.name)
            .join('、');
          alert.showWarning(
            `“${field.name}”仍被解析规则 ${affectedNames}${
              affectedRules.length > 4 ? ` 等 ${affectedRules.length} 条` : ''
            } 使用。请先在这些规则中替换或移除该占位字段，再回来删除。`
          );
          return;
        }
      } catch (error) {
        logger.error('[占位字段] 读取字段使用情况失败:', error);
        alert.showError('暂时无法检查字段使用情况，请稍后重试');
        return;
      }

      alert.showConfirm(
        '确认删除',
        `确定要删除占位字段“${field.name}”吗？\n\n历史记录和原始二维码内容不会被删除。`,
        async () => {
          try {
            await deleteCustomField(field.id);
            await loadFields();
            showToast('占位字段已删除', 'success');
          } catch (error) {
            logger.error('删除占位字段失败:', error);
            alert.showError(error instanceof Error ? error.message : '删除失败');
          }
        },
        true
      );
    },
    [alert, loadFields, showToast]
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 96 }]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>占位字段</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.toolbarTextBlock}>
            <Text style={styles.toolbarTitle}>二维码占位</Text>
            <Text style={styles.toolbarSubtitle}>用于保留不需要导出的二维码段</Text>
          </View>
          <TouchableOpacity style={styles.addButton} activeOpacity={0.8} onPress={handleAddField}>
            <Feather name="plus" size={15} color={theme.buttonPrimaryText} />
            <Text style={styles.addButtonText}>新增占位</Text>
          </TouchableOpacity>
        </View>

        {fields.length === 0 ? (
          <AppEmptyState
            icon="plus-square"
            title="暂无占位字段"
            description="二维码存在无用段时，可创建占位字段保持后续字段位置正确。"
            style={styles.emptyContainer}
          />
        ) : (
          fields.map((field, index) => (
            <AnimatedCard key={field.id} style={styles.fieldItem}>
              <View style={styles.fieldMainRow}>
                <View style={styles.fieldLeft}>
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.fieldTextBlock}>
                    <Text style={styles.fieldName}>{field.name}</Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.typeChip}>仅占位</Text>
                      <Text style={styles.metaText}>不显示、不导出</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.iconButton}
                    activeOpacity={0.75}
                    onPress={() => handleEditField(field)}
                  >
                    <Feather name="edit-2" size={15} color={theme.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconButton}
                    activeOpacity={0.75}
                    onPress={() => handleDeleteField(field)}
                  >
                    <Feather name="trash-2" size={15} color={theme.error} />
                  </TouchableOpacity>
                </View>
              </View>

            </AnimatedCard>
          ))
        )}
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) closeModal();
        }}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title={editingField ? '编辑占位字段' : '添加占位字段'}
            onClose={saving ? undefined : closeModal}
            style={styles.modalContent}
            size="form"
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={closeModal}
                secondaryDisabled={saving}
                primaryLabel={saving ? '保存中...' : '保存'}
                onPrimaryPress={handleSaveField}
                primaryDisabled={saving}
              />
            }
          >
            <AppFormField
              label="占位名称"
              hint="建议按位置命名，如：忽略段1、供应商保留字段"
              required
            >
              <TextInput
                ref={fieldNameInputRef}
                style={styles.formInput}
                value={fieldName}
                onChangeText={setFieldName}
                placeholder="如：忽略段1"
                placeholderTextColor={theme.textMuted}
                maxLength={32}
                returnKeyType="done"
                onSubmitEditing={() => void handleSaveField()}
              />
            </AppFormField>
          </AppModalCard>
        </View>
      </Modal>

      {alert.AlertComponent}
      <ToastContainer />
    </Screen>
  );
}
