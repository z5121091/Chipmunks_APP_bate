import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AppFormField } from '@/components/AppFormField';
import { AppSegmentedOptions } from '@/components/AppSegmentedOptions';
import { AppToggleRow } from '@/components/AppToggleRow';
import { Spacing } from '@/constants/theme';
import { createStyles } from './styles';
import { logger } from '@/utils/logger';
import {
  addCustomField,
  CustomField,
  CustomFieldType,
  deleteCustomField,
  getAllCustomFields,
  updateCustomField,
} from '@/utils/database';
import { useCustomAlert } from '@/components/CustomAlert';
import { useToast } from '@/utils/toast';

type EditableCustomFieldType = 'text' | 'select';

const FIELD_TYPE_OPTIONS: Array<{
  type: EditableCustomFieldType;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  hint: string;
}> = [
  { type: 'text', label: '文本', icon: 'type', hint: '适合备注、名称、说明等自由内容' },
  { type: 'select', label: '选择', icon: 'list', hint: '适合状态、等级、类别等固定选项' },
];

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: '文本',
  select: '选择',
};

export default function CustomFieldsScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const { showToast, ToastContainer } = useToast();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<EditableCustomFieldType>('text');
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('');

  const fieldNameInputRef = useRef<TextInput>(null);
  const fieldNameFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTypeOption =
    FIELD_TYPE_OPTIONS.find((option) => option.type === fieldType) ?? FIELD_TYPE_OPTIONS[0];

  const loadFields = useCallback(async () => {
    const data = await getAllCustomFields();
    setFields(data);
  }, []);

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
    setFieldType('text');
    setIsRequired(false);
    setOptionsText('');
  }, []);

  const handleAddField = useCallback(() => {
    resetForm();
    setModalVisible(true);
  }, [resetForm]);

  const handleEditField = useCallback((field: CustomField) => {
    setEditingField(field);
    setFieldName(field.name);
    setFieldType(field.type === 'select' ? 'select' : 'text');
    setIsRequired(field.required);
    setOptionsText(field.options?.join(', ') ?? '');
    setModalVisible(true);
  }, []);

  const handleSaveField = useCallback(async () => {
    const trimmedName = fieldName.trim();

    if (!trimmedName) {
      alert.showWarning('请输入字段名称');
      return;
    }

    const normalizedOptions =
      fieldType === 'select'
        ? optionsText
            .split(',')
            .map((option) => option.trim())
            .filter(Boolean)
        : undefined;

    if (fieldType === 'select' && (!normalizedOptions || normalizedOptions.length < 2)) {
      alert.showWarning('选择类型至少需要 2 个选项');
      return;
    }

    try {
      if (editingField) {
        await updateCustomField(editingField.id, {
          name: trimmedName,
          type: fieldType,
          required: isRequired,
          options: normalizedOptions,
        });
        alert.showSuccess('字段已更新');
      } else {
        await addCustomField({
          name: trimmedName,
          type: fieldType,
          required: isRequired,
          options: normalizedOptions,
        });
        alert.showSuccess('字段已添加');
      }

      closeModal();
      await loadFields();
    } catch (error) {
      logger.error('保存自定义字段失败:', error);
      alert.showError('保存失败');
    }
  }, [alert, closeModal, editingField, fieldName, fieldType, isRequired, loadFields, optionsText]);

  const handleDeleteField = useCallback(
    (field: CustomField) => {
      alert.showConfirm(
        '确认删除',
        `确定要删除字段“${field.name}”吗？`,
        async () => {
          try {
            await deleteCustomField(field.id);
            await loadFields();
            showToast('字段已删除', 'success');
          } catch (error) {
            logger.error('删除自定义字段失败:', error);
            alert.showError('删除失败');
          }
        },
        true
      );
    },
    [alert, loadFields]
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
            <Text style={styles.title}>自定义字段</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.toolbarTextBlock}>
            <Text style={styles.toolbarTitle}>字段列表</Text>
            <Text style={styles.toolbarSubtitle}>当前 {fields.length} 个定义</Text>
          </View>
          <TouchableOpacity style={styles.addButton} activeOpacity={0.8} onPress={handleAddField}>
            <Feather name="plus" size={15} color={theme.buttonPrimaryText} />
            <Text style={styles.addButtonText}>新增字段</Text>
          </TouchableOpacity>
        </View>

        {fields.length === 0 ? (
          <AppEmptyState
            icon="plus-square"
            title="暂无自定义字段"
            description="添加后可在物料详情中补充记录关键信息。"
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
                      <Text style={styles.typeChip}>{FIELD_TYPE_LABELS[field.type]}</Text>
                      {field.required ? <Text style={styles.requiredChip}>必填</Text> : null}
                      {field.type === 'select' && field.options?.length ? (
                        <Text style={styles.metaText}>{field.options.length} 项选项</Text>
                      ) : null}
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

              {field.type === 'select' && field.options?.length ? (
                <View style={styles.optionsRow}>
                  {field.options.map((option) => (
                    <Text key={option} style={styles.optionTag}>
                      {option}
                    </Text>
                  ))}
                </View>
              ) : null}
            </AnimatedCard>
          ))
        )}
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title={editingField ? '编辑字段' : '添加字段'}
            onClose={closeModal}
            style={styles.modalContent}
            bodyStyle={styles.modalBodySection}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={closeModal}
                primaryLabel="保存"
                onPrimaryPress={handleSaveField}
              />
            }
          >
            <KeyboardAwareFormScrollView
              style={styles.modalFormScroll}
              contentContainerStyle={styles.modalFormScrollContent}
              bottomOffset={Spacing.sm}
              extraScrollHeight={12}
            >
              <AppFormField label="字段名称" required>
                <TextInput
                  ref={fieldNameInputRef}
                  style={styles.formInput}
                  value={fieldName}
                  onChangeText={setFieldName}
                  placeholder="如：供应商、库位、来料等级"
                  placeholderTextColor={theme.textMuted}
                  maxLength={32}
                  returnKeyType="done"
                />
              </AppFormField>

              <AppFormField label="录入方式" hint={activeTypeOption.hint}>
                <AppSegmentedOptions
                  options={FIELD_TYPE_OPTIONS.map((option) => ({
                    value: option.type,
                    label: option.label,
                    icon: option.icon,
                  }))}
                  value={fieldType}
                  onChange={setFieldType}
                />
              </AppFormField>

              {fieldType === 'select' ? (
                <AppFormField
                  label="选项列表"
                  hint="多个选项用英文逗号分隔，例如：良品, 待检, 退货"
                >
                  <TextInput
                    style={[styles.formInput, styles.optionsInput]}
                    value={optionsText}
                    onChangeText={setOptionsText}
                    placeholder="请输入选项内容"
                    placeholderTextColor={theme.textMuted}
                    multiline
                    scrollEnabled
                    textAlignVertical="top"
                  />
                </AppFormField>
              ) : null}

              <AppToggleRow
                title="设为必填字段"
                description="录入物料时必须填写这个字段"
                checked={isRequired}
                onPress={() => setIsRequired((prev) => !prev)}
              />
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>

      {alert.AlertComponent}
      <ToastContainer />
    </Screen>
  );
}
