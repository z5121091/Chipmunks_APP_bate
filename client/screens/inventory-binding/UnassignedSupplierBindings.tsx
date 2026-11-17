import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FlatList, Keyboard, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalActions } from '@/components/AppModalActions';
import { AppEmptyState } from '@/components/AppEmptyState';
import { UiToolbarButton } from '@/components/UiRedesign';
import { useTheme } from '@/hooks/useTheme';
import { useResponsiveStyles } from '@/hooks/useResponsiveStyles';
import { getBindingVersions } from '@/utils/bindingVersions';
import { assignInventoryBindingSupplier, getInventoryBindingsPage, type InventoryBinding, type InventorySupplier } from '@/utils/database';
import { logger } from '@/utils/logger';
import { createStyles } from './styles';

interface Props {
  closeRef: RefObject<(() => void) | null>;
  suppliers: InventorySupplier[];
  suppliersLoading: boolean;
  suppliersFailed: boolean;
  onReloadSuppliers: () => Promise<void>;
  isActive: () => boolean;
  onBack: () => void;
  onAssigned: (bindingId: string, supplierName: string) => void;
}

const PAGE_SIZE = 10;

/** Replaces the content of the existing supplier modal; never opens another modal. */
export function UnassignedSupplierBindings({ closeRef, suppliers, suppliersLoading, suppliersFailed,
  onReloadSuppliers, isActive, onBack, onAssigned }: Props) {
  const { theme } = useTheme();
  const styles = useResponsiveStyles(theme, createStyles);
  const [items, setItems] = useState<InventoryBinding[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [binding, setBinding] = useState<InventoryBinding | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [saving, setSaving] = useState(false);
  const [listHeights, setListHeights] = useState<{ materials?: number; suppliers?: number }>({});
  const [searchHeight, setSearchHeight] = useState(0);
  const [paginationHeight, setPaginationHeight] = useState(0);
  const mounted = useRef(false);
  const request = useRef(0);
  const savingRef = useRef(false);
  const query = useRef({ page: 1, keyword: '' });
  const isCurrent = useCallback(() => mounted.current && isActive(), [isActive]);

  const load = useCallback(async (nextPage: number, keyword: string) => {
    if (!isCurrent()) return;
    const id = ++request.current;
    query.current = { page: nextPage, keyword };
    setLoading(true); setError(''); setAppliedKeyword(keyword);
    try {
      const result = await getInventoryBindingsPage({ page: nextPage, pageSize: PAGE_SIZE, keyword, supplierStatus: 'unassigned' });
      if (!isCurrent() || id !== request.current) return;
      setItems(result.items); setTotal(result.total); setPage(result.page);
      query.current = { page: result.page, keyword };
    } catch (cause) {
      logger.error('读取未绑定供应商的物料失败:', cause);
      if (isCurrent() && id === request.current) {
        setItems([]); setError('物料列表加载失败，请重试');
      }
    } finally {
      if (isCurrent() && id === request.current) setLoading(false);
    }
  }, [isCurrent]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (isCurrent()) void load(1, ''); });
    return () => { mounted.current = false; request.current += 1; };
  }, [load, isCurrent]);

  const close = useCallback(() => {
    if (savingRef.current) return;
    Keyboard.dismiss();
    if (binding) {
      setBinding(null); setSupplierId(''); setSupplierSearch(''); setError('');
      // A failed assignment may mean this row was already changed/deleted elsewhere.
      void load(query.current.page, query.current.keyword);
    } else onBack();
  }, [binding, onBack, load]);
  useLayoutEffect(() => {
    closeRef.current = close;
    return () => { closeRef.current = null; };
  }, [close, closeRef]);

  const chooseBinding = (item: InventoryBinding) => {
    if (loading || savingRef.current || !isCurrent()) return;
    Keyboard.dismiss(); setBinding(item); setSupplierId(''); setSupplierSearch(''); setError(''); setNotice('');
  };
  const selectedSupplier = suppliers.find(item => item.id === supplierId);
  const filteredSuppliers = useMemo(() => {
    const keyword = supplierSearch.trim().toUpperCase();
    return suppliers.filter(item => item.name.toUpperCase().includes(keyword));
  }, [supplierSearch, suppliers]);

  const save = async () => {
    if (!binding || !selectedSupplier || savingRef.current || suppliersLoading || suppliersFailed || !isCurrent()) return;
    const currentBinding = binding;
    const chosen = selectedSupplier;
    savingRef.current = true; setSaving(true); setError(''); Keyboard.dismiss();
    try {
      await assignInventoryBindingSupplier(currentBinding.id, chosen.id);
      if (!isCurrent()) return;
      setBinding(null); setSupplierId(''); setSupplierSearch('');
      setNotice(`已为 ${currentBinding.inventory_code} 分配供应商：${chosen.name}`);
      onAssigned(currentBinding.id, chosen.name);
      await load(query.current.page, query.current.keyword);
    } catch (cause) {
      logger.error('分配物料供应商失败:', cause);
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '分配失败，请重试');
    } finally {
      savingRef.current = false;
      if (isCurrent()) setSaving(false);
    }
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginated = !binding && totalPages > 1;
  const listHeight = binding ? listHeights.suppliers : listHeights.materials;
  const bodyContentHeight = listHeight === undefined ? undefined
    : listHeight + searchHeight + styles.unassignedBody.gap +
      (paginated ? paginationHeight + styles.unassignedBody.gap : 0);
  const searchBindings = () => {
    if (savingRef.current) return;
    Keyboard.dismiss(); setNotice(''); void load(1, search.trim());
  };

  return <AppModalCard title={binding ? '分配供应商' : '未绑定供应商的物料'}
    subtitle={binding ? '选择供应商后保存，仅修改当前物料的供应商' : '可以补充分配，也可以继续保留未绑定'}
    size="list" bodyContentHeight={bodyContentHeight} stretchBody scrollMode="body" style={styles.modalContent} bodyStyle={styles.unassignedBody}
    onClose={saving ? undefined : close}
    footer={<AppModalActions containerStyle={styles.modalActions}
      primaryLabel={binding ? saving ? '保存中' : '保存分配' : '返回维护'}
      onPrimaryPress={binding ? () => { void save(); } : close}
      primaryDisabled={saving || Boolean(binding && (!selectedSupplier || suppliersLoading || suppliersFailed))}
      secondaryLabel={binding ? '返回物料' : undefined} onSecondaryPress={binding ? close : undefined} secondaryDisabled={saving} />}>
    {binding ? <>
      <TextInput accessibilityLabel="搜索可分配的供应商" style={styles.input} value={supplierSearch}
        onLayout={({ nativeEvent }) => setSearchHeight(nativeEvent.layout.height)}
        onChangeText={setSupplierSearch} editable={!saving} placeholder="搜索供应商" placeholderTextColor={theme.textMuted} autoCorrect={false} />
      <FlatList key="supplier-options" testID="unassigned-supplier-options" style={styles.supplierList} data={suppliersLoading || suppliersFailed ? [] : filteredSuppliers}
        onContentSizeChange={(_width, height) => setListHeights(current => ({ ...current, suppliers: height }))}
        scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled" keyExtractor={item => item.id} initialNumToRender={12}
        ListHeaderComponent={<View style={styles.unassignedSummary}>
          {error ? <Text accessibilityRole="alert" style={styles.unassignedError}>{error}</Text> : null}
          <Text style={styles.unassignedModel}>{binding.scan_model}</Text>
          <Text style={styles.unassignedDetail}>存货编码：{binding.inventory_code}</Text>
          <Text style={styles.unassignedDetail}>版本号：{getBindingVersions(binding).join('、') || '未设置'}</Text>
        </View>}
        renderItem={({ item }) => <AppPressable accessibilityRole="button" accessibilityLabel={`分配给供应商 ${item.name}`}
          accessibilityState={{ selected: supplierId === item.id, disabled: saving }} disabled={saving}
          style={[styles.supplierOption, supplierId === item.id && { backgroundColor: theme.backgroundTertiary }]}
          onPress={() => { if (!savingRef.current) { Keyboard.dismiss(); setSupplierId(item.id); setError(''); } }}>
          <Text style={styles.supplierOptionName}>{item.name}</Text>
          {supplierId === item.id ? <Feather name="check" size={18} color={theme.primary} /> : null}
        </AppPressable>}
        ListEmptyComponent={<View><AppEmptyState compact icon="truck" loading={suppliersLoading}
          title={suppliersLoading ? '正在读取供应商' : suppliersFailed ? '供应商加载失败' : supplierSearch.trim() ? '未找到匹配的供应商' : '暂无供应商'}
          description={suppliersFailed ? '请重新加载后选择' : '可返回维护供应商添加，未选择时不会修改物料'} />
          {suppliersFailed ? <UiToolbarButton label="重新加载供应商" compact onPress={() => { void onReloadSuppliers(); }} /> : null}</View>} />
    </> : <>
      <View testID="unassigned-search-tools" style={styles.supplierAddRow}
        onLayout={({ nativeEvent }) => setSearchHeight(nativeEvent.layout.height)}>
        <TextInput accessibilityLabel="搜索未绑定供应商的物料" value={search} onChangeText={setSearch}
          style={[styles.input, styles.supplierNameInput]} placeholder="搜索型号、编码、版本号" placeholderTextColor={theme.textMuted}
          autoCorrect={false} returnKeyType="search" onSubmitEditing={searchBindings} />
        <View style={styles.supplierAddButtonWrap}><UiToolbarButton label="查询" icon="search" compact
          style={styles.supplierAddButton} onPress={searchBindings} /></View>
      </View>
      <FlatList key={`unassigned-materials:${page}:${appliedKeyword}`} testID="unassigned-material-list" style={styles.supplierList} data={loading ? [] : items} keyExtractor={item => item.id}
        onContentSizeChange={(_width, height) => setListHeights(current => ({ ...current, materials: height }))}
        scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled" initialNumToRender={PAGE_SIZE}
        ListHeaderComponent={<View style={styles.unassignedSummary}>
          {error ? <Text accessibilityRole="alert" style={styles.unassignedError}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.supplierHint}>{notice}</Text> : null}
          <Text style={styles.supplierHint}>共 {total} 条{appliedKeyword ? '匹配记录' : '未绑定供应商的物料'}</Text>
        </View>}
        renderItem={({ item }) => <AppPressable accessibilityRole="button" accessibilityLabel={`分配供应商 ${item.inventory_code}`}
          style={styles.unassignedItem} onPress={() => chooseBinding(item)}>
          <View style={styles.supplierOptionContent}>
            <Text style={styles.unassignedModel}>{item.scan_model}</Text>
            <Text style={styles.unassignedDetail}>存货编码：{item.inventory_code}</Text>
            <Text style={styles.unassignedDetail}>版本号：{getBindingVersions(item).join('、') || '未设置'}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={theme.textMuted} />
        </AppPressable>}
        ListEmptyComponent={<View><AppEmptyState compact icon="layers" loading={loading}
          title={loading ? '正在读取物料' : error ? '物料列表加载失败' : appliedKeyword ? '未找到匹配的物料' : '没有未绑定供应商的物料'} />
          {error ? <UiToolbarButton label="重新加载物料" compact onPress={() => { void load(query.current.page, query.current.keyword); }} /> : null}</View>} />
      {paginated ? <View testID="unassigned-pagination" style={styles.unassignedPagination}
        onLayout={({ nativeEvent }) => setPaginationHeight(nativeEvent.layout.height)}>
        <UiToolbarButton label="上一页" compact disabled={loading || page <= 1} containerStyle={styles.unassignedPageAction}
          style={styles.unassignedPageButton} onPress={() => { void load(page - 1, query.current.keyword); }} />
        <Text style={styles.supplierHint}>{page} / {totalPages}</Text>
        <UiToolbarButton label="下一页" compact disabled={loading || page >= totalPages} containerStyle={styles.unassignedPageAction}
          style={styles.unassignedPageButton} onPress={() => { void load(page + 1, query.current.keyword); }} />
      </View> : null}
    </>}
  </AppModalCard>;
}
