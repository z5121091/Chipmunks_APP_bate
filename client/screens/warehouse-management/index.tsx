import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AnimatedButton } from '@/components/AnimatedButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppFormField } from '@/components/AppFormField';
import { AppToggleRow } from '@/components/AppToggleRow';
import { KeyboardAwareModalContainer } from '@/components/KeyboardAwareForm';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { logger } from '@/utils/logger';
import { useCustomAlert } from '@/components/CustomAlert';
import {
  Warehouse,
  getAllWarehouses,
  addWarehouse,
  updateWarehouse,
  deleteWarehouse,
  reorderWarehouses,
} from '@/utils/database';

export default function WarehouseManagementScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const router = useSafeRouter();
  const alert = useCustomAlert();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
  });

  // 加载仓库列表
  const loadWarehouses = useCallback(async () => {
      logger.log('[WarehouseManagement] 开始加载仓库列表');
    const data = await getAllWarehouses();
      logger.log(`[WarehouseManagement] 加载完成，设置 ${data.length} 条仓库数据`);
    setWarehouses(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWarehouses();
    }, [loadWarehouses])
  );

  // 打开添加/编辑弹窗
  const handleOpenModal = (warehouse?: Warehouse) => {
    if (warehouse) {
      setEditingWarehouse(warehouse);
      setFormData({
        name: warehouse.name,
        description: warehouse.description || '',
        is_default: warehouse.is_default || false,
      });
    } else {
      setEditingWarehouse(null);
      setFormData({
        name: '',
        description: '',
        is_default: false,
      });
    }
    setModalVisible(true);
  };

  // 保存仓库
  const handleSave = async () => {
    // 强制截断名称到4个字符
    const trimmedName = formData.name.trim().slice(0, 4);
    if (!trimmedName) {
      alert.showWarning('请输入仓库名称');
      return;
    }
    
    const finalFormData = { ...formData, name: trimmedName };

    // 检查名称唯一性（排除当前编辑的仓库）
    const existingWarehouse = warehouses.find(
      w => w.name.trim() === trimmedName && 
           (!editingWarehouse || w.id !== editingWarehouse.id)
    );
    if (existingWarehouse) {
      alert.showWarning('该仓库名称已存在，请使用其他名称');
      return;
    }

    try {
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, finalFormData);
        alert.showSuccess('仓库已更新');
      } else {
        await addWarehouse(finalFormData);
        alert.showSuccess('仓库已添加');
      }
      setModalVisible(false);
      loadWarehouses();
    } catch (error) {
      logger.error('保存仓库失败:', error);
      alert.showError('保存失败，请重试');
    }
  };

  // 删除仓库
  const handleDelete = (warehouse: Warehouse) => {
    if (warehouse.is_default) {
      alert.showWarning('默认仓库不能删除');
      return;
    }

    alert.showConfirm(
      '确认删除',
      `确定要删除仓库「${warehouse.name}」吗？\n此操作不可撤销。`,
      async () => {
        try {
          await deleteWarehouse(warehouse.id);
          alert.showSuccess('仓库已删除');
          loadWarehouses();
        } catch (error) {
      logger.error('删除仓库失败:', error);
          alert.showError(error instanceof Error ? error.message : '删除失败，请重试');
        }
      },
      true
    );
  };

  // 设为默认仓库
  const handleSetDefault = async (warehouse: Warehouse) => {
    try {
      await updateWarehouse(warehouse.id, { is_default: true });
      alert.showSuccess(`已将「${warehouse.name}」设为默认仓库`);
      loadWarehouses();
    } catch (error) {
      logger.error('设置默认仓库失败:', error);
      alert.showError('操作失败，请重试');
    }
  };

  const handleMoveWarehouse = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= warehouses.length) {
      return;
    }

    const nextWarehouses = [...warehouses];
    [nextWarehouses[index], nextWarehouses[targetIndex]] = [
      nextWarehouses[targetIndex]!,
      nextWarehouses[index]!,
    ];
    setWarehouses(nextWarehouses);

    try {
      await reorderWarehouses(nextWarehouses.map((warehouse) => warehouse.id));
    } catch (error) {
      logger.error('调整仓库排序失败:', error);
      alert.showError('排序失败，请重试');
      loadWarehouses();
    }
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>仓库档案</Text>
          </View>
        </View>

        {/* 仓库列表 */}
        {warehouses.length > 0 ? (
          warehouses.map((warehouse, index) => (
            <View key={warehouse.id} style={styles.warehouseCard}>
              <View style={styles.warehouseHeader}>
                <View style={styles.warehouseInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.warehouseName}>{warehouse.name}</Text>
                    {warehouse.is_default && (
                      <View style={styles.defaultBadge}>
                        <Text style={styles.defaultBadgeText}>默认</Text>
                      </View>
                    )}
                  </View>
                  {warehouse.description && (
                    <Text style={styles.warehouseDesc}>{warehouse.description}</Text>
                  )}
                </View>
                <View style={styles.warehouseActions}>
                  <AnimatedButton
                    containerStyle={styles.actionButtonWrap}
                    style={[
                      styles.actionButton,
                      index === 0 && styles.actionButtonDisabled,
                    ]}
                    activeScale={0.92}
                    activeOpacity={0.86}
                    disabled={index === 0}
                    onPress={() => handleMoveWarehouse(index, -1)}
                  >
                    <Feather name="arrow-up" size={16} color={theme.textMuted} />
                  </AnimatedButton>
                  <AnimatedButton
                    containerStyle={styles.actionButtonWrap}
                    style={[
                      styles.actionButton,
                      index === warehouses.length - 1 && styles.actionButtonDisabled,
                    ]}
                    activeScale={0.92}
                    activeOpacity={0.86}
                    disabled={index === warehouses.length - 1}
                    onPress={() => handleMoveWarehouse(index, 1)}
                  >
                    <Feather name="arrow-down" size={16} color={theme.textMuted} />
                  </AnimatedButton>
                  {!warehouse.is_default && (
                    <AnimatedButton
                      containerStyle={styles.actionButtonWrap}
                      style={styles.actionButton}
                      activeScale={0.92}
                      activeOpacity={0.86}
                      onPress={() => handleSetDefault(warehouse)}
                    >
                      <Feather name="star" size={18} color={theme.textMuted} />
                    </AnimatedButton>
                  )}
                  <AnimatedButton
                    containerStyle={styles.actionButtonWrap}
                    style={styles.actionButton}
                    activeScale={0.92}
                    activeOpacity={0.86}
                    onPress={() => handleOpenModal(warehouse)}
                  >
                    <Feather name="edit-2" size={18} color={theme.textMuted} />
                  </AnimatedButton>
                  <AnimatedButton
                    containerStyle={styles.actionButtonWrap}
                    style={styles.actionButton}
                    activeScale={0.92}
                    activeOpacity={0.86}
                    onPress={() => handleDelete(warehouse)}
                  >
                    <Feather name="trash-2" size={18} color={theme.error} />
                  </AnimatedButton>
                </View>
              </View>
            </View>
          ))
        ) : (
          <AppEmptyState
            icon="map-pin"
            title="暂无仓库"
            description="添加后可在业务页面切换使用，并设置默认仓库。"
            style={styles.emptyState}
          />
        )}

        {/* 添加仓库按钮 */}
        <AnimatedButton
          containerStyle={styles.addButtonWrap}
          style={styles.addButton}
          activeScale={0.96}
          activeOpacity={0.9}
          onPress={() => handleOpenModal()}
        >
          <Text style={styles.addButtonText}>新增仓库</Text>
        </AnimatedButton>
      </ScrollView>

      {/* 添加/编辑弹窗 */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAwareModalContainer cardStyle={styles.modalCardFrame}>
            <AppModalCard
              title={editingWarehouse ? '编辑仓库' : '添加仓库'}
              onClose={() => setModalVisible(false)}
              style={styles.modalContent}
              bodyStyle={styles.modalBody}
              footer={
                <AppModalActions
                  containerStyle={styles.modalActions}
                  secondaryLabel="取消"
                  onSecondaryPress={() => setModalVisible(false)}
                  primaryLabel="保存"
                  onPrimaryPress={handleSave}
                />
              }
            >
              <AppFormField label="仓库名称（中文4字/英文4字符）" required>
                <TextInput
                  style={styles.input}
                  value={formData.name}
                  onChangeText={(text) => {
                    setFormData({ ...formData, name: text });
                  }}
                  placeholder="请输入仓库名称"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppFormField label="仓库描述">
                <TextInput
                  style={styles.input}
                  value={formData.description}
                  onChangeText={(text) => setFormData({ ...formData, description: text })}
                  placeholder="可选，用于备注仓库信息"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppToggleRow
                title="设为默认仓库"
                description="进入业务页面时优先带出这个仓库"
                checked={formData.is_default}
                onPress={() => setFormData({ ...formData, is_default: !formData.is_default })}
              />
            </AppModalCard>
          </KeyboardAwareModalContainer>
        </View>
      </Modal>

      {/* 全局提示组件 */}
      {alert.AlertComponent}
    </Screen>
  );
}
