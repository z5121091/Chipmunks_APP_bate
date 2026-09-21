import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { AnimatedButton } from '@/components/AnimatedButton';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppFormField } from '@/components/AppFormField';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import { UiInput, UiToolbarButton } from '@/components/UiRedesign';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { logger } from '@/utils/logger';
import { feedbackClear } from '@/utils/feedback';
import { useCustomAlert } from '@/components/CustomAlert';
import {
  InventoryBinding,
  getAllInventoryBindings,
  getInventoryBindingsPage,
  addInventoryBinding,
  updateInventoryBinding,
  deleteInventoryBinding,
  importInventoryBindings,
} from '@/utils/database';
import { formatDate } from '@/utils/time';

const FileSystem = FileSystemLegacy;
const PAGE_SIZE = 10;
const normalizeBindingMatchKey = (value?: string): string =>
  (value || '').trim().toUpperCase();

export default function InventoryBindingScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const showBindingConfirm = alert.showConfirm;
  const showBindingError = alert.showError;
  const showBindingSuccess = alert.showSuccess;

  const [bindings, setBindings] = useState<InventoryBinding[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [dataToolsVisible, setDataToolsVisible] = useState(false);
  const [editingBinding, setEditingBinding] = useState<InventoryBinding | null>(null);
  const [formData, setFormData] = useState({
    scan_model: '',
    version: '',
    inventory_code: '',
    supplier: '',
    description: '',
  });
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedBindingIds, setExpandedBindingIds] = useState<Set<string>>(new Set());
  const loadBindingsRequestRef = useRef(0);

  const toggleBindingExpanded = useCallback((id: string) => {
    setExpandedBindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 加载绑定列表
  const loadBindings = useCallback(async (page = 1, keyword = '') => {
    const requestId = loadBindingsRequestRef.current + 1;
    loadBindingsRequestRef.current = requestId;
    setLoading(true);
    try {
      const result = await getInventoryBindingsPage({
        page,
        pageSize: PAGE_SIZE,
        keyword,
      });
      if (requestId !== loadBindingsRequestRef.current) {
        return;
      }
      setBindings(result.items);
      setTotalCount(result.total);
      setCurrentPage(result.page);
    } catch (error) {
      if (requestId !== loadBindingsRequestRef.current) {
        return;
      }
      logger.error('加载物料绑定失败:', error);
      showBindingError('物料绑定加载失败，请重试');
    } finally {
      if (requestId === loadBindingsRequestRef.current) {
        setLoading(false);
      }
    }
  }, [showBindingError]);

  useFocusEffect(
    useCallback(() => {
      void loadBindings(currentPage, searchKeyword);
      return () => {
        loadBindingsRequestRef.current += 1;
      };
    }, [currentPage, loadBindings, searchKeyword])
  );

  // 打开添加/编辑弹窗
  const handleOpenModal = useCallback((binding?: InventoryBinding) => {
    if (binding) {
      setEditingBinding(binding);
      setFormData({
        scan_model: binding.scan_model,
        version: binding.version || '',
        inventory_code: binding.inventory_code,
        supplier: binding.supplier || '',
        description: binding.description || '',
      });
    } else {
      setEditingBinding(null);
      setFormData({
        scan_model: '',
        version: '',
        inventory_code: '',
        supplier: '',
        description: '',
      });
    }
    setModalVisible(true);
  }, []);

  // 保存绑定
  const handleSave = async () => {
    if (saving) {
      return;
    }
    if (!formData.scan_model.trim()) {
      alert.showWarning('请输入扫描型号');
      return;
    }
    if (!formData.inventory_code.trim()) {
      alert.showWarning('请输入存货编码');
      return;
    }

    setSaving(true);
    try {
      // 检查存货编码、型号与版本组合，数据库约束之外也给出清晰提示。
      const allBindings = await getAllInventoryBindings();
      const inventoryCode = formData.inventory_code.trim();
      const scanModel = formData.scan_model.trim();
      const version = formData.version.trim();
      const inventoryCodeMatchKey = normalizeBindingMatchKey(inventoryCode);
      const modelMatchKey = normalizeBindingMatchKey(scanModel);
      const versionMatchKey = normalizeBindingMatchKey(version);
      const existingCode = allBindings.find(
        (binding) =>
          normalizeBindingMatchKey(binding.inventory_code) === inventoryCodeMatchKey &&
          (!editingBinding || binding.id !== editingBinding.id)
      );
      if (existingCode) {
        alert.showWarning(
          `存货编码「${formData.inventory_code.trim()}」已存在\n\n请使用其他编码或编辑已有记录`
        );
        return;
      }

      const existingModelVersion = allBindings.find(
        (binding) =>
          normalizeBindingMatchKey(binding.scan_model) === modelMatchKey &&
          normalizeBindingMatchKey(binding.version) === versionMatchKey &&
          (!editingBinding || binding.id !== editingBinding.id)
      );
      if (existingModelVersion) {
        alert.showWarning('该型号和版本号已存在绑定，请编辑已有记录');
        return;
      }

      const payload = {
        scan_model: scanModel,
        version,
        inventory_code: inventoryCode,
        supplier: formData.supplier.trim(),
        description: formData.description.trim(),
      };

      if (editingBinding) {
        await updateInventoryBinding(editingBinding.id, payload);
        alert.showSuccess('绑定已更新');
        await loadBindings(currentPage, searchKeyword);
      } else {
        await addInventoryBinding(payload);
        alert.showSuccess('绑定已添加');
        await loadBindings(1, searchKeyword);
      }
      setModalVisible(false);
    } catch (error) {
      logger.error('保存绑定失败:', error);
      alert.showError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  // 删除绑定
  const handleDelete = useCallback((binding: InventoryBinding) => {
    showBindingConfirm(
      '确认删除',
      `确定要删除「${binding.scan_model}」的绑定吗？`,
      async () => {
        try {
          await deleteInventoryBinding(binding.id);
          showBindingSuccess('绑定已删除');
          await loadBindings(currentPage, searchKeyword);
        } catch (error) {
          logger.error('删除绑定失败:', error);
          showBindingError('删除失败，请重试');
        }
      },
      true
    );
  }, [
    currentPage,
    loadBindings,
    searchKeyword,
    showBindingConfirm,
    showBindingError,
    showBindingSuccess,
  ]);

  // 从Excel导入
  const handleImportFromExcel = async () => {
    if (importing) return;

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        copyToCacheDirectory: true,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const fileUri = pickerResult.assets[0].uri;
      setImporting(true);

      // 读取Excel文件
      const fileContent = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const workbook = XLSX.read(fileContent, { type: 'base64' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
      const headers = (jsonData[0] || []).map((value) => String(value ?? '')
        .replace(/\s+/g, '')
        .replace(/[（(](?:可选|选填|必填)[）)]$/, '')
        .replace(/^扫描型号$/, '型号'));
      // 按表头读取，兼容旧版列顺序，避免供应商和版本号错位。
      const [modelColumn, codeColumn, supplierColumn, versionColumn, descriptionColumn] =
        ['型号', '存货编码', '供应商', '版本号', '描述'].map((header) => {
          const index = headers.indexOf(header);
          if (index !== headers.lastIndexOf(header)) {
            throw new Error(`Excel表头「${header}」重复，请检查后重新导入`);
          }
          return index;
        });
      if (modelColumn < 0 || codeColumn < 0) {
        throw new Error('Excel表头不正确，请使用物料绑定导出文件或导入模板');
      }

      // 跳过表头，从第二行开始
      const bindingsToImport: Array<{
        scan_model: string;
        version?: string;
        inventory_code: string;
        supplier?: string;
        description?: string;
      }> = [];

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row) continue;
        const readCell = (column: number) => String(row[column] ?? '').trim();
        const scanModel = readCell(modelColumn);
        const inventoryCode = readCell(codeColumn);
        if (scanModel && inventoryCode) {
          bindingsToImport.push({
            scan_model: scanModel,
            inventory_code: inventoryCode,
            supplier: readCell(supplierColumn) || undefined,
            version: readCell(versionColumn) || undefined,
            description: readCell(descriptionColumn) || undefined,
          });
        }
      }

      if (bindingsToImport.length === 0) {
        alert.showWarning('未找到有效的绑定数据\n\n请确保Excel格式正确');
        setImporting(false);
        return;
      }

      const importResult = await importInventoryBindings(bindingsToImport);
      const processedCount = importResult.inserted + importResult.updated;
      let message =
        `导入完成\n\n新增 ${importResult.inserted} 条` +
        `\n更新供应商/描述 ${importResult.updated} 条` +
        `\n内容未变化 ${importResult.unchanged} 条`;

      if (importResult.conflicts.length > 0) {
        const conflictList = importResult.conflicts.slice(0, 5).join('\n');
        message +=
          `\n\n跳过 ${importResult.conflicts.length} 条对应关系冲突：\n${conflictList}` +
          `${importResult.conflicts.length > 5 ? '\n...' : ''}`;
      }

      if (processedCount > 0) {
        alert.showSuccess(message);
      } else if (importResult.conflicts.length > 0) {
        alert.showWarning(message);
      } else {
        alert.showWarning('导入文件中的绑定与现有数据完全一致，无需更新');
      }
      await loadBindings(1, searchKeyword);
    } catch (error) {
      logger.error('导入失败:', error);
      alert.showError(error instanceof Error ? error.message : '导入失败，请检查文件格式');
    } finally {
      setImporting(false);
    }
  };

  // 导出为Excel
  const handleExportToExcel = async () => {
    const exportBindings = await getAllInventoryBindings();
    if (exportBindings.length === 0) {
      alert.showWarning('暂无数据可导出');
      return;
    }

    try {
      const headers = ['扫描型号', '存货编码', '供应商', '版本号', '描述', '创建时间'];
      const rows = exportBindings.map((b) => [
        b.scan_model,
        b.inventory_code,
        b.supplier || '',
        b.version || '',
        b.description || '',
        b.created_at ? formatDate(b.created_at) : '',
      ]);

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '物料绑定');

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 },
        { wch: 20 },
        { wch: 15 },
        { wch: 12 },
        { wch: 30 },
        { wch: 12 },
      ];

      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const fileName = `物料绑定_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, wbout, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: '导出物料绑定',
        });
        alert.showSuccess(`已导出 ${exportBindings.length} 条绑定数据`);
      }
    } catch (error) {
      logger.error('导出失败:', error);
      alert.showError('导出失败，请重试');
    }
  };

  // 导出导入模板
  const handleExportTemplate = async () => {
    try {
      // 模板表头 + 示例数据行
      const headers = ['扫描型号（必填）', '存货编码（必填）', '供应商（可选）', '版本号（可选）', '描述（可选）'];
      const exampleRow = ['示例型号ABC', 'INV001', '供应商A', 'A1', '这是示例描述'];

      const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '物料绑定模板');

      // 设置列宽
      ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 14 }, { wch: 30 }];

      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const fileName = `物料绑定导入模板.xlsx`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, wbout, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: '导出导入模板',
        });
        alert.showSuccess('模板已导出\n\n请按照模板格式填写数据后导入');
      } else {
        alert.showError('当前设备不支持文件分享，未能导出模板');
      }
    } catch (error) {
      logger.error('导出模板失败:', error);
      alert.showError('导出失败，请重试');
    }
  };

  // 渲染单个绑定卡片
  const renderBindingCard = useCallback(
    ({ item: binding }: { item: InventoryBinding }) => {
      const isExpanded = expandedBindingIds.has(binding.id);

      return (
        <View style={styles.bindingCard}>
          <TouchableOpacity
            style={styles.bindingHeaderRow}
            activeOpacity={0.75}
            onPress={() => toggleBindingExpanded(binding.id)}
          >
            <Text style={styles.bindingModel} numberOfLines={1} ellipsizeMode="tail">
              {binding.scan_model}
            </Text>
            <Feather
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textMuted}
            />
          </TouchableOpacity>

          {isExpanded ? (
            <View style={styles.bindingExpandedContent}>
              <View style={styles.bindingMetaRow}>
                <Text style={styles.bindingMetaLabel}>存货编码</Text>
                <Text style={styles.bindingMetaValue} numberOfLines={1} ellipsizeMode="tail">
                  {binding.inventory_code}
                </Text>
              </View>

              <View style={styles.bindingMetaRow}>
                <Text style={styles.bindingMetaLabel}>版本号</Text>
                <Text style={styles.bindingMetaValue} numberOfLines={1} ellipsizeMode="tail">
                  {binding.version || '未设置'}
                </Text>
              </View>

              <View style={styles.bindingMetaRow}>
                <Text style={styles.bindingMetaLabel}>供应商</Text>
                <Text style={styles.bindingMetaValue} numberOfLines={1} ellipsizeMode="tail">
                  {binding.supplier || '未设置'}
                </Text>
              </View>

              <View style={styles.bindingFooter}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  activeOpacity={0.75}
                  onPress={() => handleOpenModal(binding)}
                >
                  <Text style={styles.actionBtnText}>编辑</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  activeOpacity={0.75}
                  onPress={() => handleDelete(binding)}
                >
                  <Text style={[styles.actionBtnText, styles.actionBtnTextDanger]}>删除</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      );
    },
    [expandedBindingIds, handleDelete, handleOpenModal, styles, theme.textMuted, toggleBindingExpanded]
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), [totalCount]);

  const handleSearchSubmit = useCallback(async () => {
    const nextKeyword = searchInput.trim();
    setSearchKeyword(nextKeyword);
    await loadBindings(1, nextKeyword);
  }, [loadBindings, searchInput]);

  const handleClearSearch = useCallback(async () => {
    setSearchInput('');
    setSearchKeyword('');
    void feedbackClear();
    await loadBindings(1, '');
  }, [loadBindings]);

  const handlePrevPage = useCallback(async () => {
    if (currentPage <= 1) return;
    await loadBindings(currentPage - 1, searchKeyword);
  }, [currentPage, loadBindings, searchKeyword]);

  const handleNextPage = useCallback(async () => {
    if (currentPage >= totalPages) return;
    await loadBindings(currentPage + 1, searchKeyword);
  }, [currentPage, loadBindings, searchKeyword, totalPages]);

  // 空状态组件
  const renderEmptyState = useCallback(
    () => (
      <AppEmptyState
        icon="hash"
        loading={loading}
        title={loading ? '正在读取数据' : searchKeyword ? '未找到匹配数据' : '暂无绑定数据'}
        description={
          loading
            ? '正在加载物料绑定列表'
            : searchKeyword
              ? '请尝试其他型号、存货编码或供应商关键词'
              : '添加型号与存货编码的对应关系'
        }
        style={styles.emptyState}
      />
    ),
    [loading, searchKeyword, styles.emptyState]
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <FlatList
          data={bindings}
          keyExtractor={(item) => item.id}
          renderItem={renderBindingCard}
          extraData={expandedBindingIds}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={[
            styles.scrollContent,
            bindings.length === 0 && styles.emptyContainer,
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={true}
          ListHeaderComponent={
            <>
              <View style={styles.topSection}>
                <View style={styles.toolbarCard}>
                  <UiInput
                    containerStyle={styles.searchBar}
                    active={searchInput.length > 0}
                    leftElement={
                      <>
                        <TouchableOpacity
                          style={styles.backButton}
                          activeOpacity={0.7}
                          onPress={() => router.back()}
                        >
                          <Feather name="arrow-left" size={18} color={theme.textPrimary} />
                        </TouchableOpacity>
                      </>
                    }
                    rightElement={
                      <>
                        {searchInput ? (
                          <TouchableOpacity
                            style={styles.searchIconBtn}
                            activeOpacity={0.7}
                            onPress={() => {
                              void handleClearSearch();
                            }}
                          >
                            <Feather name="x" size={15} color={theme.textMuted} />
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={styles.searchSubmitPill}
                          activeOpacity={0.75}
                          onPress={() => {
                            void handleSearchSubmit();
                          }}
                        >
                          <Text style={styles.searchSubmitPillText}>搜索</Text>
                        </TouchableOpacity>
                      </>
                    }
                    style={styles.searchInput}
                    value={searchInput}
                    onChangeText={setSearchInput}
                    placeholder="型号/编码/供应商"
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      void handleSearchSubmit();
                    }}
                  />

                  <View style={styles.toolRow}>
                    <View style={styles.toolButtonWrap}>
                      <UiToolbarButton
                        label="新增"
                        icon="plus"
                        compact
                        variant="primary"
                        style={styles.toolButton}
                        onPress={() => handleOpenModal()}
                      />
                    </View>

                    <View style={styles.toolButtonWrap}>
                      <UiToolbarButton
                        label="数据工具"
                        icon="more-horizontal"
                        compact
                        variant="secondary"
                        style={styles.toolButton}
                        onPress={() => setDataToolsVisible(true)}
                      />
                    </View>
                  </View>
                </View>
              </View>

              {/* 列表区域 */}
              <View style={styles.listSection}>
                <Text style={styles.pageSummary}>
                  共 {totalCount} 条 · 第 {currentPage} / {totalPages} 页
                </Text>
              </View>
            </>
          }
          ListFooterComponent={
            totalCount > 0 ? (
              <View style={styles.paginationBar}>
                <AnimatedButton
                  containerStyle={styles.paginationBtnWrap}
                  style={[styles.paginationBtn, currentPage <= 1 && styles.paginationBtnDisabled]}
                  disabled={currentPage <= 1 || loading}
                  onPress={() => {
                    void handlePrevPage();
                  }}
                  activeScale={0.95}
                >
                  <View style={styles.paginationBtnInner}>
                    <Feather
                      name="chevron-left"
                      size={14}
                      color={currentPage <= 1 ? theme.textMuted : theme.textPrimary}
                    />
                    <Text
                      style={[
                        styles.paginationBtnText,
                        currentPage <= 1 && styles.paginationBtnTextDisabled,
                      ]}
                    >
                      上一页
                    </Text>
                  </View>
                </AnimatedButton>

                <View style={styles.paginationInfo}>
                  <Text style={styles.paginationInfoText}>
                    {currentPage} / {totalPages}
                  </Text>
                  <Text style={styles.paginationInfoSubText}>共 {totalCount} 条</Text>
                </View>

                <AnimatedButton
                  containerStyle={styles.paginationBtnWrap}
                  style={[
                    styles.paginationBtn,
                    currentPage >= totalPages && styles.paginationBtnDisabled,
                  ]}
                  disabled={currentPage >= totalPages || loading}
                  onPress={() => {
                    void handleNextPage();
                  }}
                  activeScale={0.95}
                >
                  <View style={styles.paginationBtnInner}>
                    <Text
                      style={[
                        styles.paginationBtnText,
                        currentPage >= totalPages && styles.paginationBtnTextDisabled,
                      ]}
                    >
                      下一页
                    </Text>
                    <Feather
                      name="chevron-right"
                      size={14}
                      color={currentPage >= totalPages ? theme.textMuted : theme.textPrimary}
                    />
                  </View>
                </AnimatedButton>
              </View>
            ) : null
          }
        />
      </View>

      {/* 添加/编辑弹窗 */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title={editingBinding ? '编辑绑定' : '添加绑定'}
            onClose={saving ? undefined : () => setModalVisible(false)}
            style={styles.modalContent}
            bodyStyle={styles.modalBody}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                secondaryLabel="取消"
                onSecondaryPress={() => setModalVisible(false)}
                secondaryDisabled={saving}
                primaryLabel={saving ? '保存中...' : '保存'}
                onPrimaryPress={handleSave}
                primaryDisabled={saving}
              />
            }
          >
            <KeyboardAwareFormScrollView bottomOffset={16} extraScrollHeight={8}>
              <AppFormField label="扫描型号" required>
                <TextInput
                  style={styles.input}
                  value={formData.scan_model}
                  onChangeText={(text) => setFormData({ ...formData, scan_model: text })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="二维码解析后的型号"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppFormField label="存货编码" required>
                <TextInput
                  style={styles.input}
                  value={formData.inventory_code}
                  onChangeText={(text) => setFormData({ ...formData, inventory_code: text })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="ERP系统中的编码"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppFormField label="供应商">
                <TextInput
                  style={styles.input}
                  value={formData.supplier}
                  onChangeText={(text) => setFormData({ ...formData, supplier: text })}
                  placeholder="供应商名称（选填）"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppFormField label="版本号">
                <TextInput
                  style={styles.input}
                  value={formData.version}
                  onChangeText={(text) => setFormData({ ...formData, version: text })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="同型号多版本时填写"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>

              <AppFormField label="描述" style={styles.formGroupLast}>
                <TextInput
                  style={styles.input}
                  value={formData.description}
                  onChangeText={(text) => setFormData({ ...formData, description: text })}
                  placeholder="备注说明（选填）"
                  placeholderTextColor={theme.textMuted}
                />
              </AppFormField>
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>

      <Modal
        visible={dataToolsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDataToolsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <AppModalCard
            title="物料绑定数据工具"
            subtitle="批量维护和备份型号对应关系"
            onClose={() => setDataToolsVisible(false)}
            style={styles.modalContent}
            bodyStyle={styles.dataToolsBody}
            size="compact"
          >
            <UiToolbarButton
              label="下载导入模板"
              icon="download"
              variant="secondary"
              onPress={() => {
                setDataToolsVisible(false);
                void handleExportTemplate();
              }}
            />
            <UiToolbarButton
              label={importing ? '导入中' : '从 Excel 导入'}
              icon="upload"
              variant="primary"
              loading={importing}
              disabled={importing}
              onPress={() => {
                setDataToolsVisible(false);
                void handleImportFromExcel();
              }}
            />
            <UiToolbarButton
              label="导出全部绑定"
              icon="share"
              variant="secondary"
              onPress={() => {
                setDataToolsVisible(false);
                void handleExportToExcel();
              }}
            />
          </AppModalCard>
        </View>
      </Modal>

      {/* 自定义弹窗 */}
      {alert.AlertComponent}
    </Screen>
  );
}
