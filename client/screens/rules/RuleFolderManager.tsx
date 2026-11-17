import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppModal as Modal } from '@/components/AppModal';
import { AppPressable } from '@/components/AppPressable';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppModalViewport } from '@/components/AppModalViewport';
import { UiInput, UiListItem } from '@/components/UiRedesign';
import { Spacing, Typography, type Theme } from '@/constants/theme';
import { useResponsiveStyles } from '@/hooks/useResponsiveStyles';
import { useTheme } from '@/hooks/useTheme';
import {
  addRuleFolder, deleteRuleFolder, renameRuleFolder, setRuleFoldersDisplayOrder,
  type QRCodeRule, type QRCodeRuleFolder,
} from '@/utils/database';
import { logger } from '@/utils/logger';

type Page = 'home' | 'create' | 'rename' | 'remove' | 'rules' | 'destination';

export interface RuleFolderManagerProps {
  visible: boolean;
  rules: QRCodeRule[];
  folders: QRCodeRuleFolder[];
  currentFolderId: string | null;
  onClose: () => void;
  onMoveRules: (ids: string[], folderId: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onSortRules: () => void;
}

/** One modal and one vertical scroll owner per page; grouping never changes scan configuration. */
export function RuleFolderManager({ visible, rules, folders, currentFolderId, onClose, onMoveRules, onChanged, onSortRules }: RuleFolderManagerProps) {
  const { theme } = useTheme();
  const styles = useResponsiveStyles(theme, createStyles);
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('home');
  const [name, setName] = useState('');
  const [editingFolder, setEditingFolder] = useState<QRCodeRuleFolder | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetId, setTargetId] = useState<string>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>();
  const [wasVisible, setWasVisible] = useState(visible);
  const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders]);
  const ungroupedRules = useMemo(() => rules.filter(rule => !rule.folderId || !folderIds.has(rule.folderId)), [rules, folderIds]);
  const ungroupedIds = useMemo(() => ungroupedRules.map(rule => rule.id), [ungroupedRules]);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const visibleRef = useRef(visible);
  const sessionRef = useRef(0);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);
  useLayoutEffect(() => {
    visibleRef.current = visible;
    if (!visible) sessionRef.current += 1;
  }, [visible]);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setPage('home'); setName(''); setEditingFolder(null); setSelectedIds([]);
      setTargetId(undefined); setError(''); setNotice(''); setContentHeight(undefined);
    }
  }

  const folderName = (id?: string | null) => folders.find(folder => folder.id === id)?.name ?? '未分组';
  const countFor = (id: string | null) => id ? rules.filter(rule => rule.folderId === id).length : ungroupedRules.length;
  const currentCount = countFor(currentFolderId);
  const selectedSet = new Set(selectedIds);
  const selectedUngroupedIds = ungroupedIds.filter(id => selectedSet.has(id));
  const selectedCount = selectedUngroupedIds.length;
  const allSelected = selectedCount > 0 && selectedCount === ungroupedIds.length;
  const canBatchMove = ungroupedIds.length > 0 && folders.length > 0;
  const validTarget = targetId !== undefined && folderIds.has(targetId);
  const go = (next: Page, folder: QRCodeRuleFolder | null = null) => {
    if (busyRef.current) return;
    Keyboard.dismiss(); setError(''); setNotice(''); setContentHeight(undefined);
    setEditingFolder(folder); setName(folder?.name ?? ''); setPage(next);
  };
  const closeOrBack = () => {
    if (busyRef.current) return;
    Keyboard.dismiss();
    if (page === 'home') onClose();
    else go(page === 'destination' ? 'rules' : 'home');
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); Keyboard.dismiss();
    const session = sessionRef.current;
    let committed = false;
    try {
      await action();
      committed = true;
      await onChanged();
      if (!activeRef.current || !visibleRef.current || session !== sessionRef.current) return;
      setPage('home'); setEditingFolder(null); setName(''); setSelectedIds([]);
      setTargetId(undefined); setContentHeight(undefined); setNotice(message);
    } catch (cause) {
      logger.error('规则文件夹操作失败:', cause);
      if (!activeRef.current || !visibleRef.current || session !== sessionRef.current) return;
      if (committed) {
        setPage('home'); setContentHeight(undefined);
        setError('操作已保存，但列表刷新失败，请关闭管理后重新进入查看。');
      } else setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  };
  const moveFolder = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= folders.length) return;
    const ids = folders.map(folder => folder.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    void run(() => setRuleFoldersDisplayOrder(ids), '文件夹顺序已保存');
  };
  const toggleRule = (id: string) => {
    if (busyRef.current) return;
    setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  };
  const iconButton = (icon: keyof typeof Feather.glyphMap, label: string, onPress: () => void, disabled = false, danger = false) => (
    <AppPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy} onPress={onPress} style={[styles.iconButton, (disabled || busy) && styles.disabled]}>
      <Feather name={icon} size={18} color={danger ? theme.error : theme.textSecondary} />
    </AppPressable>
  );
  const messages = <>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!notice && <Text accessibilityRole="text" style={styles.notice}>{notice}</Text>}
  </>;
  const titles: Record<Page, string> = {
    home: '管理解析规则', create: '新建文件夹', rename: '重命名文件夹', remove: '解散文件夹',
    rules: '选择未分组规则', destination: '选择目标文件夹',
  };
  const submit = () => {
    if (page === 'create') void run(() => addRuleFolder(name.trim()), '文件夹已创建');
    else if (page === 'rename' && editingFolder) void run(() => renameRuleFolder(editingFolder.id, name.trim()), '文件夹名称已保存');
    else if (page === 'remove' && editingFolder) void run(() => deleteRuleFolder(editingFolder.id), '文件夹已解散，规则已移到未分组');
    else if (page === 'rules') {
      if (!selectedCount || !canBatchMove) return;
      setTargetId(undefined); go('destination');
    } else if (page === 'destination') {
      if (!selectedCount || !validTarget) return;
      void run(() => onMoveRules(selectedUngroupedIds, targetId), `已将 ${selectedCount} 条规则移入${folderName(targetId)}`);
    } else onClose();
  };
  const primaryLabel = busy ? '保存中' : page === 'home' ? '完成'
    : page === 'rules' ? `下一步（${selectedCount}）` : page === 'destination' ? '确认移动'
      : page === 'remove' ? '解散文件夹' : '保存';
  const primaryDisabled = busy || ((page === 'create' || page === 'rename') && !name.trim())
    || (page === 'rules' && (!selectedCount || !canBatchMove)) || (page === 'destination' && (!selectedCount || !validTarget));
  const footer = <AppModalActions primaryLabel={primaryLabel} onPrimaryPress={submit} primaryDisabled={primaryDisabled}
    primaryVariant={page === 'remove' ? 'danger' : 'primary'}
    secondaryLabel={page === 'home' ? undefined : page === 'destination' ? '上一步' : '取消'}
    onSecondaryPress={closeOrBack} secondaryDisabled={busy} containerStyle={styles.actions} />;

  const folderList = <FlatList key="folders" testID="rule-folder-management-list" data={folders}
    keyExtractor={item => item.id} style={styles.list} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    onContentSizeChange={(_width, height) => setContentHeight(height)}
    ListHeaderComponent={<View>
      {messages}
      <UiListItem title="新建文件夹" icon="folder-plus" color={theme.primary} compact disabled={busy} onPress={() => go('create')} />
      <UiListItem title="批量移动规则" icon="folder" color={theme.primary} compact disabled={busy || !canBatchMove}
        subtitle={ungroupedIds.length === 0 ? '暂无未分组规则' : folders.length === 0 ? '请先新建文件夹' : `未分组 · ${ungroupedIds.length} 条规则`}
        onPress={() => { setSelectedIds([]); go('rules'); }} />
      <UiListItem title="调整当前规则顺序" subtitle={`${folderName(currentFolderId)} · ${currentCount} 条规则`}
        icon="list" color={theme.primary} compact disabled={busy || currentCount < 2}
        onPress={() => { if (!busyRef.current) { onClose(); onSortRules(); } }} />
      <Text style={styles.sectionTitle}>文件夹</Text>
    </View>}
    ListEmptyComponent={<Text style={styles.empty}>还没有文件夹，可以先新建，再将已有规则移入。</Text>}
    renderItem={({ item, index }) => <View style={styles.folderRow}>
      <View style={styles.folderHeading}>
        <Feather name="folder" size={18} color={theme.primary} />
        <Text numberOfLines={2} style={styles.folderName}>{item.name}</Text>
        <Text style={styles.count}>{countFor(item.id)} 条</Text>
      </View>
      <View style={styles.folderActions}>
        {iconButton('edit-2', `重命名文件夹${item.name}`, () => go('rename', item))}
        {iconButton('trash-2', `解散文件夹${item.name}`, () => go('remove', item), false, true)}
        {folders.length > 1 && <>
          {iconButton('arrow-up', `上移文件夹${item.name}`, () => moveFolder(index, -1), index === 0)}
          {iconButton('arrow-down', `下移文件夹${item.name}`, () => moveFolder(index, 1), index === folders.length - 1)}
        </>}
      </View>
    </View>} />;
  const rulesList = <FlatList key="rules" testID="rule-folder-select-rules" data={ungroupedRules}
    keyExtractor={item => item.id} style={styles.list} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    onContentSizeChange={(_width, height) => setContentHeight(height)}
    ListHeaderComponent={<View>{messages}<AppPressable accessibilityRole="checkbox" accessibilityLabel="全选规则"
      accessibilityState={{ checked: allSelected, disabled: busy || ungroupedIds.length === 0 }}
      disabled={busy || ungroupedIds.length === 0} onPress={() => setSelectedIds(allSelected ? [] : ungroupedIds)}
      style={styles.selectRow}>
      <Feather name={allSelected ? 'check-square' : 'square'} size={20} color={theme.primary} />
      <Text style={styles.rowTitle}>全选</Text><Text style={styles.count}>已选 {selectedCount} 条</Text>
    </AppPressable></View>}
    ListEmptyComponent={<Text style={styles.empty}>暂无未分组规则</Text>}
    renderItem={({ item }) => <AppPressable accessibilityRole="checkbox" accessibilityLabel={`选择规则${item.name}`}
      accessibilityState={{ checked: selectedSet.has(item.id), disabled: busy }} disabled={busy}
      onPress={() => toggleRule(item.id)} style={styles.selectRow}>
      <Feather name={selectedSet.has(item.id) ? 'check-square' : 'square'} size={20} color={theme.primary} />
      <Text style={[styles.rowTitle, styles.ruleText]}>{item.name}</Text>
    </AppPressable>} />;
  const destinationList = <FlatList key="destinations" testID="rule-folder-destinations" data={folders}
    keyExtractor={item => item.id} style={styles.list} scrollEnabled nestedScrollEnabled showsVerticalScrollIndicator
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    onContentSizeChange={(_width, height) => setContentHeight(height)}
    ListHeaderComponent={<View>{messages}<Text style={styles.caption}>将选中的 {selectedCount} 条规则移到</Text></View>}
    renderItem={({ item }) => <AppPressable accessibilityRole="radio" accessibilityLabel={`移入${item.name}`}
      accessibilityState={{ checked: targetId === item.id, disabled: busy }} disabled={busy}
      onPress={() => setTargetId(item.id)} style={styles.selectRow}>
      <Feather name={targetId === item.id ? 'check-circle' : 'circle'} size={20} color={theme.primary} />
      <Text style={styles.rowTitle}>{item.name}</Text>
    </AppPressable>} />;
  const listPage = page === 'home' || page === 'rules' || page === 'destination';
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={closeOrBack}>
    <AppModalViewport style={[styles.overlay, { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.md }]}>
      {listPage ? <AppModalCard title={titles[page]} onClose={busy ? undefined : closeOrBack} size="list" scrollMode="body"
        bodyContentHeight={contentHeight} bodyStyle={styles.listBody} footer={footer}>
        {page === 'home' ? folderList : page === 'rules' ? rulesList : destinationList}
      </AppModalCard> : <AppModalCard title={titles[page]} onClose={busy ? undefined : closeOrBack} size="auto" footer={footer}>
        {messages}
        {page === 'remove' ? <Text style={styles.bodyText}>解散“{editingFolder?.name}”后，其中的 {countFor(editingFolder?.id ?? null)} 条规则会移到未分组，规则内容和启用状态保持不变。</Text>
          : <View style={styles.nameForm}>
            <Text style={styles.rowTitle}>文件夹名称</Text>
            <UiInput accessibilityLabel="文件夹名称" placeholder="例如：东微常用标签" value={name}
              onChangeText={setName} maxLength={60} editable={!busy} autoCapitalize="none" autoCorrect={false} />
          </View>}
      </AppModalCard>}
    </AppModalViewport>
  </Modal>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: theme.overlay, paddingHorizontal: Spacing.md },
  actions: { marginTop: 0 },
  listBody: { flex: 1, minHeight: 0 },
  list: { flex: 1, minHeight: 0 },
  sectionTitle: { ...Typography.smallMedium, color: theme.textSecondary, marginTop: Spacing.md, paddingBottom: Spacing.sm },
  folderRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingTop: Spacing.sm },
  folderHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  folderName: { ...Typography.smallMedium, color: theme.textPrimary, flex: 1, minWidth: 0 },
  folderActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: Spacing.xs },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  count: { ...Typography.caption, color: theme.textMuted, flexShrink: 0 },
  selectRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', minHeight: 52, paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  rowTitle: { ...Typography.smallMedium, color: theme.textPrimary, flexShrink: 1 },
  ruleText: { flex: 1, minWidth: 0 },
  caption: { ...Typography.caption, color: theme.textSecondary, paddingVertical: Spacing.xs },
  empty: { ...Typography.small, color: theme.textMuted, paddingVertical: Spacing.md },
  error: { ...Typography.caption, color: theme.error, paddingVertical: Spacing.sm },
  notice: { ...Typography.caption, color: theme.success, paddingVertical: Spacing.sm },
  nameForm: { gap: Spacing.sm },
  bodyText: { ...Typography.body, color: theme.textSecondary },
});
