import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { AppModal as Modal } from '@/components/AppModal';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppFormField } from '@/components/AppFormField';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { useCustomAlert } from '@/components/CustomAlert';
import { KeyboardAwareFormFlatList } from '@/components/KeyboardAwareForm';
import { UiToolbarButton } from '@/components/UiRedesign';
import { useTheme } from '@/hooks/useTheme';
import {
  addInventorySupplier,
  deleteInventorySupplier,
  getInventorySuppliers,
  InventorySupplier,
} from '@/utils/database';
import { logger } from '@/utils/logger';
import { createStyles } from './styles';
import { MotionContent, MotionPresence } from '@/components/AppMotion';

interface SupplierManagerProps {
  visible?: boolean;
  embedded?: boolean;
  closeRef?: RefObject<(() => void) | null>;
  mode: 'manage' | 'select';
  value: string;
  onSelect: (name: string, id?: string) => void;
  onDeleted: (name: string) => void;
  onClose: () => void;
}

const nameKey = (name: string) => name.trim().toUpperCase();

export function SupplierManager({ mode, value, onSelect, onDeleted, onClose, embedded = false, closeRef, visible = true }: SupplierManagerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const alert = useCustomAlert();
  const [managing, setManaging] = useState(mode === 'manage');
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [keyword, setKeyword] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const requestRef = useRef(0);
  const [visibleMode, setVisibleMode] = useState(visible ? mode : null);
  if (visibleMode !== (visible ? mode : null)) {
    setVisibleMode(visible ? mode : null);
    if (visible) {
      setManaging(mode === 'manage'); setKeyword(''); setNewName('');
      setLoading(true); setLoadFailed(false);
    }
  }

  const loadSuppliers = useCallback(() => {
    const request = ++requestRef.current;
    return getInventorySuppliers()
      .then(rows => {
        if (activeRef.current && request === requestRef.current) setSuppliers(rows);
      })
      .catch(error => {
        logger.error('加载供应商失败:', error);
        if (activeRef.current && request === requestRef.current) setLoadFailed(true);
      })
      .finally(() => {
        if (activeRef.current && request === requestRef.current) setLoading(false);
      });
  }, []);

  const refreshSuppliers = async () => {
    setLoading(true);
    setLoadFailed(false);
    await loadSuppliers();
  };

  useEffect(() => {
    if (!visible) return;
    activeRef.current = true;
    void loadSuppliers();
    return () => {
      activeRef.current = false;
      requestRef.current += 1;
    };
  }, [loadSuppliers, visible, mode]);

  const close = useCallback(() => {
    if (busyRef.current) return;
    Keyboard.dismiss();
    if (managing && mode === 'select') {
      setKeyword('');
      setManaging(false);
      return;
    }
    onClose();
  }, [managing, mode, onClose]);
  useLayoutEffect(() => {
    if (!closeRef) return;
    closeRef.current = close;
    return () => { closeRef.current = null; };
  }, [close, closeRef]);

  const handleAdd = async () => {
    if (busyRef.current || !activeRef.current || loading || loadFailed) return;
    const name = newName.trim();
    if (!name) {
      alert.showWarning('请输入供应商名称');
      return;
    }
    if (suppliers.some(supplier => nameKey(supplier.name) === nameKey(name))) {
      alert.showWarning('该供应商已在列表中，无需重复添加');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      await addInventorySupplier(name);
      if (!activeRef.current) return;
      setNewName('');
      setKeyword('');
      await refreshSuppliers();
    } catch (error) {
      logger.error('新增供应商失败:', error);
      if (activeRef.current) alert.showError(error instanceof Error ? error.message : '新增供应商失败，请重试');
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  };

  const handleDelete = (supplier: InventorySupplier) => {
    if (busyRef.current) return;
    if (supplier.binding_count + (supplier.rule_count || 0) > 0) {
      alert.showWarning(`「${supplier.name}」正在被 ${supplier.binding_count} 条物料、${supplier.rule_count || 0} 条解析规则使用，不能删除。请先修改相应关联。`);
      return;
    }
    alert.showConfirm('删除供应商', `确定从供应商列表删除「${supplier.name}」吗？`, async () => {
      if (busyRef.current || !activeRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await deleteInventorySupplier(supplier.id);
        if (!activeRef.current) return;
        onDeleted(supplier.name);
        await refreshSuppliers();
      } catch (error) {
        logger.error('删除供应商失败:', error);
        if (activeRef.current) alert.showError(error instanceof Error ? error.message : '删除供应商失败，请重试');
      } finally {
        busyRef.current = false;
        if (activeRef.current) setBusy(false);
      }
    }, true);
  };

  const filteredSuppliers = useMemo(() => {
    const search = nameKey(keyword);
    return suppliers.filter(supplier => nameKey(supplier.name).includes(search));
  }, [keyword, suppliers]);

  const selectSupplier = (name: string, id?: string) => {
    if (busyRef.current || loading || loadFailed) return;
    Keyboard.dismiss();
    onSelect(name, id);
  };

  const content = (
        <View style={styles.modalOverlay}>
          <AppModalCard
            title={managing ? '维护供应商' : '选择供应商'}
            subtitle={managing ? '物料和解析规则共用供应商名录，导入物料的新名称也会自动加入' : '选择后返回当前表单，也可以不设置供应商'}
            onClose={busy ? undefined : close}
            style={styles.modalContent}
            bodyStyle={styles.supplierBody}
            size="largeForm"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                primaryLabel={managing && mode === 'select' ? '返回选择' : managing ? '完成' : '取消'}
                onPrimaryPress={close}
                primaryDisabled={busy}
                secondaryLabel={!managing ? '维护供应商' : undefined}
                onSecondaryPress={!managing ? () => { Keyboard.dismiss(); setKeyword(''); setManaging(true); } : undefined}
                secondaryDisabled={busy}
              />
            }
          >
            <MotionContent contentKey={managing} direction={managing ? 'forward' : 'back'} style={{ flex: 1 }}><KeyboardAwareFormFlatList
              style={styles.supplierList}
              data={loading || loadFailed ? [] : filteredSuppliers}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              ListHeaderComponent={
                <View style={styles.supplierListHeader}>
                  {managing ? (
                    <>
                      <AppFormField label="新增供应商">
                        <View style={styles.supplierAddRow}>
                          <TextInput
                            accessibilityLabel="供应商名称"
                            style={[styles.input, styles.supplierNameInput]}
                            value={newName}
                            onChangeText={setNewName}
                            editable={!busy}
                            autoCorrect={false}
                            placeholder="输入完整供应商名称"
                            placeholderTextColor={theme.textMuted}
                            returnKeyType="done"
                            onSubmitEditing={() => { void handleAdd(); }}
                          />
                          <View style={styles.supplierAddButtonWrap}>
                            <UiToolbarButton label="添加" icon="plus" compact variant="primary" style={styles.supplierAddButton} disabled={busy || loading || loadFailed} onPress={() => { void handleAdd(); }} />
                          </View>
                        </View>
                      </AppFormField>
                      <Text style={styles.supplierHint}>用于打印的供应商名称应与同步助手中的模板名称一致。正在使用的名称不能删除。</Text>
                    </>
                  ) : null}
                  <TextInput
                    accessibilityLabel="搜索供应商"
                    style={styles.input}
                    value={keyword}
                    onChangeText={setKeyword}
                    placeholder="搜索供应商"
                    placeholderTextColor={theme.textMuted}
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {!managing && !loading && !loadFailed ? (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="不设置供应商" style={styles.supplierOption} onPress={() => selectSupplier('')}>
                      <Text style={styles.supplierOptionName}>不设置供应商</Text>
                      {!value ? <Feather name="check" size={18} color={theme.primary} /> : null}
                    </TouchableOpacity>
                  ) : null}
                  {!loading && !loadFailed ? <Text style={styles.supplierHint}>共 {suppliers.length} 个供应商{keyword.trim() ? ` · 匹配 ${filteredSuppliers.length} 个` : ''}</Text> : null}
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.supplierOption, !managing && nameKey(value) === nameKey(item.name)
                  ? { backgroundColor: theme.backgroundTertiary } : null]}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`选择供应商 ${item.name}`}
                    accessibilityState={{ selected: nameKey(value) === nameKey(item.name), disabled: managing || busy }}
                    activeOpacity={0.86}
                    disabled={managing || busy}
                    style={styles.supplierOptionContent}
                    onPress={() => selectSupplier(item.name, item.id)}
                  >
                    <Text style={styles.supplierOptionName}>{item.name}</Text>
                    {managing ? <Text style={styles.supplierHint}>{item.binding_count + (item.rule_count || 0) > 0 ? `${item.binding_count} 条物料 · ${item.rule_count || 0} 条解析规则使用中` : '未被物料或解析规则使用'}</Text> : null}
                  </TouchableOpacity>
                  {managing ? (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`删除供应商 ${item.name}`} style={styles.supplierDelete} disabled={busy} onPress={() => handleDelete(item)}>
                      <Feather name="trash-2" size={18} color={item.binding_count + (item.rule_count || 0) > 0 ? theme.textMuted : theme.error} />
                    </TouchableOpacity>
                  ) : nameKey(value) === nameKey(item.name) ? <Feather name="check" size={18} color={theme.primary} /> : null}
                </View>
              )}
              ListEmptyComponent={
                <View>
                  <AppEmptyState compact style={styles.supplierEmptyState} icon="truck" loading={loading} title={loading ? '正在读取供应商' : loadFailed ? '供应商加载失败' : keyword.trim() ? '未找到匹配的供应商' : '暂无供应商'} description={loadFailed ? '请重试，暂时无法选择或维护供应商' : managing ? '可以在上方添加供应商' : '可选择不设置，或进入维护供应商添加'} />
                  {loadFailed ? <UiToolbarButton label="重新加载供应商" icon="refresh-cw" variant="secondary" onPress={() => { void refreshSuppliers(); }} /> : null}
                </View>
              }
            /></MotionContent>
          </AppModalCard>
        </View>
  );
  return (
    <>
      {embedded ? <MotionPresence visible={visible} overlay style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }}>{visible ? content : null}</MotionPresence>
        : <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>{content}</Modal>}
      {alert.AlertComponent}
    </>
  );
}
