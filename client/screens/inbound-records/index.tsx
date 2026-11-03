import { MotionPresence } from '@/components/AppMotion';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, FontAwesome6 } from '@expo/vector-icons';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppPillToast, AppPillToastType } from '@/components/AppPillToast';
import { Screen } from '@/components/Screen';
import { DocumentMetadata } from '@/components/DocumentMetadata';
import { ERP_ACCOUNTS } from '@/utils/erpAccounts';
import { useCustomAlert } from '@/components/CustomAlert';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { useHardwareBack } from '@/hooks/useHardwareBack';
import { feedbackDeleted } from '@/utils/feedback';
import {
  deleteInboundDocument,
  deleteInboundRecord,
  DocumentSyncStatus,
  getAllWarehouses,
  getInboundDocumentSummaries,
  getInboundRecordsByNo,
  InboundDocumentSummary,
  InboundRecord,
  updateInboundDocumentSyncStatus,
  Warehouse,
} from '@/utils/database';
import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import {
  buildInboundExportFileNameFromNo,
  buildInboundSheets,
  type InboundExportRecord,
} from '@/utils/inboundExport';
import { STORAGE_KEYS, type SyncConfig } from '@/constants/config';
import { safeJsonParseNullable } from '@/utils/json';
import {
  buildInboundModelKey,
  deduplicateInboundRowsById,
  normalizeInboundModel,
  normalizeInboundVersion,
} from '@/utils/inboundRecords';
import { createStyles } from './styles';

type DetailMap = Record<string, InboundRecord[]>;
type NoticeType = AppPillToastType;
type InboundDetailGroup = {
  key: string;
  inventoryCode: string;
  model: string;
  version: string;
  records: InboundRecord[];
  totalQuantity: number;
};

const getDocumentKey = (item: Pick<InboundDocumentSummary, 'warehouse_id' | 'inbound_no'>) =>
  `${item.warehouse_id}::${item.inbound_no}`;

const formatQuantity = (value?: number | string | null) => Number(value || 0).toLocaleString('zh-CN');

const formatVersion = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? ` / ${normalized}` : '';
};

const isSyncConfig = (value: unknown): value is SyncConfig => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SyncConfig).ip === 'string' &&
    typeof (value as SyncConfig).port === 'string'
  );
};

const getStoredSyncConfig = async (): Promise<SyncConfig | null> => {
  const saved = await AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
  if (!saved) return null;
  return safeJsonParseNullable<SyncConfig>(saved, 'inboundRecords.syncConfig', isSyncConfig);
};

export default function InboundRecordsScreen() {
  const { theme, isDark } = useTheme();
  const router = useSafeRouter();
  const insets = useSafeAreaInsets();
  const alert = useCustomAlert();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const selectedWarehouseRef = useRef(selectedWarehouseId);
  const pageActiveRef = useRef(false);
  const pageSessionRef = useRef(0);
  const documentRequestRef = useRef(0);
  const [documents, setDocuments] = useState<InboundDocumentSummary[]>([]);
  const [detailsByKey, setDetailsByKey] = useState<DetailMap>({});
  const [expandedKeys, setExpandedKeysState] = useState<Set<string>>(new Set());
  const expandedKeysRef = useRef(new Set<string>());
  const detailRequestsRef = useRef(new Map<string, number>());
  const setExpandedKeys = useCallback((update: Set<string> | ((previous: Set<string>) => Set<string>)) => {
    const next = typeof update === 'function' ? update(expandedKeysRef.current) : update;
    expandedKeysRef.current = next;
    setExpandedKeysState(next);
  }, []);
  const [expandedDetailGroupKeys, setExpandedDetailGroupKeys] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());
  const syncingKeysRef = useRef(new Set<string>());
  const [notice, setNotice] = useState<{ text: string; type: NoticeType } | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useHardwareBack(useCallback(() => {
    if (!showWarehousePicker) return false;
    setShowWarehousePicker(false);
    return true;
  }, [showWarehousePicker]));

  const showNotice = useCallback((text: string, type: NoticeType = 'success') => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    setNotice({ text, type });
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, type === 'error' ? 2800 : type === 'warning' ? 2400 : 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const selectedWarehouseName = useMemo(() => {
    if (!selectedWarehouseId) return '全部仓库';
    return warehouses.find((item) => item.id === selectedWarehouseId)?.name || '当前仓库';
  }, [selectedWarehouseId, warehouses]);

  const totalInfo = useMemo(() => {
    const documentCount = documents.length;
    return { documentCount };
  }, [documents]);

  const capturePageOwner = useCallback((warehouseId: string | null) => {
    const sessionId = pageSessionRef.current;
    return () => pageActiveRef.current && pageSessionRef.current === sessionId &&
      selectedWarehouseRef.current === warehouseId;
  }, []);

  const loadDocuments = useCallback(async (warehouseId: string | null, asRefresh = false, silent = false) => {
    const ownsPage = capturePageOwner(warehouseId);
    if (!ownsPage()) return null;
    const requestId = ++documentRequestRef.current;
    const isCurrent = () => ownsPage() && documentRequestRef.current === requestId;
    if (!silent) {
      setRefreshing(asRefresh);
      setLoading(!asRefresh);
    }

    try {
      const rows = await getInboundDocumentSummaries(warehouseId || undefined);
      if (!isCurrent()) return null;
      setDocuments(rows);
      return { rows, isCurrent };
    } catch {
      if (isCurrent()) showNotice('入库记录加载失败', 'error');
      return null;
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [capturePageOwner, showNotice]);

  const loadWarehouses = useCallback(async () => {
    const ownsPage = capturePageOwner(selectedWarehouseRef.current);
    try {
      const rows = await getAllWarehouses();
      if (ownsPage()) setWarehouses(rows);
    } catch {
      if (ownsPage()) showNotice('仓库加载失败', 'error');
    }
  }, [capturePageOwner, showNotice]);

  useFocusEffect(
    useCallback(() => {
      pageActiveRef.current = true;
      const sessionId = ++pageSessionRef.current;
      // A request from the previous visit cannot finish this visit's expansion.
      setExpandedKeys(previous => new Set([...previous].filter(key => !detailRequestsRef.current.has(key))));
      detailRequestsRef.current.clear();
      setLoadingKeys(new Set());
      setSyncingKeys(new Set(syncingKeysRef.current));
      void Promise.all([loadWarehouses(), loadDocuments(selectedWarehouseId)]);

      return () => {
        if (pageSessionRef.current !== sessionId) return;
        pageActiveRef.current = false;
        pageSessionRef.current += 1;
        documentRequestRef.current += 1;
      };
    }, [loadDocuments, loadWarehouses, selectedWarehouseId, setExpandedKeys])
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadWarehouses(),
      loadDocuments(selectedWarehouseId, true),
    ]);
  }, [loadDocuments, loadWarehouses, selectedWarehouseId]);

  const handleWarehouseSelect = useCallback((warehouseId: string | null) => {
    if (selectedWarehouseRef.current !== warehouseId) {
      selectedWarehouseRef.current = warehouseId;
      pageSessionRef.current += 1;
      documentRequestRef.current += 1;
    }
    setSelectedWarehouseId(warehouseId);
    setShowWarehousePicker(false);
    setExpandedKeys(new Set());
    setExpandedDetailGroupKeys(new Set());
    setDetailsByKey({});
  }, [setExpandedKeys]);

  const toggleDocument = useCallback(async (item: InboundDocumentSummary) => {
    const ownsPage = capturePageOwner(selectedWarehouseRef.current);
    const key = getDocumentKey(item);
    const isExpanded = expandedKeysRef.current.has(key);

    if (isExpanded) {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }

    setExpandedKeys((prev) => new Set(prev).add(key));

    if (detailsByKey[key]) {
      return;
    }

    const session = pageSessionRef.current;
    if (detailRequestsRef.current.get(key) === session) return;
    detailRequestsRef.current.set(key, session);
    setLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const records = await getInboundRecordsByNo(item.inbound_no, item.warehouse_id);
      if (!ownsPage()) return;
      setDetailsByKey((prev) => ({ ...prev, [key]: records }));
    } catch {
      if (ownsPage() && expandedKeysRef.current.has(key)) {
        setExpandedKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
        showNotice('明细加载失败，请点击单据重试', 'error');
      }
    } finally {
      if (ownsPage() && detailRequestsRef.current.get(key) === session) detailRequestsRef.current.delete(key);
      if (ownsPage()) setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [capturePageOwner, detailsByKey, setExpandedKeys, showNotice]);

  const reloadAfterDelete = useCallback(async (
    documentKey?: string,
    document?: InboundDocumentSummary
  ) => {
    const result = await loadDocuments(selectedWarehouseId, false, true);
    if (!result) return false;
    const { rows: nextDocuments, isCurrent } = result;

    if (!documentKey || !document) {
      return true;
    }

    const stillExists = nextDocuments.some((item) => getDocumentKey(item) === documentKey);
    if (!stillExists) {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.delete(documentKey);
        return next;
      });
      setExpandedDetailGroupKeys((prev) => {
        const next = new Set(prev);
        Array.from(next).forEach((key) => {
          if (key.startsWith(`${documentKey}::`)) {
            next.delete(key);
          }
        });
        return next;
      });
      setDetailsByKey((prev) => {
        const next = { ...prev };
        delete next[documentKey];
        return next;
      });
      return true;
    }

    const records = await getInboundRecordsByNo(document.inbound_no, document.warehouse_id);
    if (!isCurrent()) return false;
    setDetailsByKey((prev) => ({ ...prev, [documentKey]: records }));
    return true;
  }, [loadDocuments, selectedWarehouseId, setExpandedKeys]);

  const handleDeleteDocument = useCallback((item: InboundDocumentSummary) => {
    const key = getDocumentKey(item);
    const ownsPage = capturePageOwner(selectedWarehouseId);
    alert.showConfirm(
      '删除入库单',
      `将删除 ${item.inbound_no} 的 ${item.record_count} 条明细，并同步刷新入库汇总。`,
      () => {
        void (async () => {
          try {
            await deleteInboundDocument(item.inbound_no, item.warehouse_id);
            if (!ownsPage() || !await reloadAfterDelete(key, item) || !ownsPage()) return;
            showNotice('入库单已删除', 'success');
            void feedbackDeleted();
          } catch {
            if (ownsPage()) showNotice('删除失败', 'error');
          }
        })();
      },
      true
    );
  }, [alert, capturePageOwner, reloadAfterDelete, selectedWarehouseId, showNotice]);

  const handleDeleteRecord = useCallback((
    record: InboundRecord,
    document: InboundDocumentSummary
  ) => {
    const key = getDocumentKey(document);
    const ownsPage = capturePageOwner(selectedWarehouseId);
    alert.showConfirm(
      '删除入库明细',
      `将删除 ${record.scan_model}${formatVersion(record.version)}，数量 ${formatQuantity(record.quantity)}。`,
      () => {
        void (async () => {
          try {
            await deleteInboundRecord(record.id);
            try {
              await updateInboundDocumentSyncStatus(
                document.inbound_no,
                document.warehouse_id,
                'pending'
              );
            } catch {
              // 明细已删除时，同步状态刷新失败不应反向提示删除失败。
            }
            if (!ownsPage() || !await reloadAfterDelete(key, document) || !ownsPage()) return;
            showNotice('明细已删除', 'success');
            void feedbackDeleted();
          } catch {
            if (ownsPage()) showNotice('删除失败', 'error');
          }
        })();
      },
      true
    );
  }, [alert, capturePageOwner, reloadAfterDelete, selectedWarehouseId, showNotice]);

  const refreshDocumentSummaries = useCallback(async () => {
    return loadDocuments(selectedWarehouseId, false, true);
  }, [loadDocuments, selectedWarehouseId]);

  const getSyncStatusMeta = useCallback((status: DocumentSyncStatus) => {
    if (status === 'success') {
      return { label: '已同步', icon: 'check-circle' as const, color: theme.success };
    }

    if (status === 'failed') {
      return { label: '同步失败', icon: 'alert-circle' as const, color: theme.error };
    }

    return { label: '待同步', icon: 'clock' as const, color: theme.warning };
  }, [theme.error, theme.success, theme.warning]);

  const handleResyncDocument = useCallback((item: InboundDocumentSummary) => {
    const key = getDocumentKey(item);
    const ownsPage = capturePageOwner(selectedWarehouseId);
    if (!ownsPage() || syncingKeysRef.current.has(key)) return;
    // Lock before the first await so rapid taps cannot submit the same document twice.
    syncingKeysRef.current.add(key);

    void (async () => {
      setSyncingKeys((prev) => new Set(prev).add(key));

      try {
        const syncConfig = await getStoredSyncConfig();
        if (!ownsPage()) return;
        if (!syncConfig?.ip) {
          showNotice('请先在设置中配置电脑同步', 'warning');
          return;
        }

        const records = await getInboundRecordsByNo(item.inbound_no, item.warehouse_id);
        if (!ownsPage()) return;
        if (records.length === 0) {
          showNotice('该入库单没有可同步明细', 'warning');
          return;
        }

        const fileName = buildInboundExportFileNameFromNo(item.warehouse_name, item.inbound_no);
        const exportRecords: InboundExportRecord[] = records.map((record) => ({ ...record }));
        const result = await syncExcelToComputer(
          buildInboundSheets(exportRecords),
          '/inbound',
          syncConfig,
          undefined,
          undefined,
          undefined,
          fileName
        );

        try {
          await updateInboundDocumentSyncStatus(
            item.inbound_no,
            item.warehouse_id,
            result.success ? 'success' : 'failed',
            result.fileName || fileName,
            result.message
          );
        } catch {
          // 同步结果已经产生，状态写入失败只影响列表标识，不影响文件同步结果。
        }

        if (!ownsPage()) return;
        if (result.success) {
          showNotice('入库单已重新同步', 'success');
        } else {
          showNotice(`同步失败：${formatSyncErrorMessage(result.message)}`, 'warning');
        }

        const refreshed = await refreshDocumentSummaries();
        if (!ownsPage() || !refreshed?.isCurrent()) return;
        setDetailsByKey((prev) => ({ ...prev, [key]: records }));
      } catch (error) {
        try {
          await updateInboundDocumentSyncStatus(
            item.inbound_no,
            item.warehouse_id,
            'failed',
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          // A status-write failure must not swallow the sync error or prevent a retry.
        }
        if (ownsPage()) {
          showNotice('重新同步失败，请检查同步助手', 'error');
          await refreshDocumentSummaries();
        }
      } finally {
        syncingKeysRef.current.delete(key);
        if (pageActiveRef.current) setSyncingKeys(new Set(syncingKeysRef.current));
      }
    })();
  }, [capturePageOwner, refreshDocumentSummaries, selectedWarehouseId, showNotice]);

  const getDetailGroups = useCallback((records: InboundRecord[]): InboundDetailGroup[] => {
    const groupMap = new Map<string, InboundDetailGroup>();

    deduplicateInboundRowsById(records).forEach((record) => {
      const model = normalizeInboundModel(record.scan_model) || '-';
      const version = normalizeInboundVersion(record.version);
      const inventoryCode = record.inventory_code?.trim() || '';
      const key = JSON.stringify([inventoryCode, buildInboundModelKey(model), version.toUpperCase()]);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          inventoryCode,
          model,
          version,
          records: [],
          totalQuantity: 0,
        });
      }

      const group = groupMap.get(key)!;
      group.records.push(record);
      group.totalQuantity += Number(record.quantity || 0);
    });

    return Array.from(groupMap.values()).sort((a, b) => {
      const aLatest = a.records[0]?.created_at || a.records[0]?.id || '';
      const bLatest = b.records[0]?.created_at || b.records[0]?.id || '';
      return bLatest.localeCompare(aLatest);
    });
  }, []);

  // Expanding/collapsing must not regroup every cached document's scan rows.
  const detailGroupsByKey = useMemo(() => Object.fromEntries(
    Object.entries(detailsByKey).map(([key, records]) => [key, getDetailGroups(records)])
  ), [detailsByKey, getDetailGroups]);

  const toggleDetailGroup = useCallback((key: string) => {
    setExpandedDetailGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const renderWarehousePickerItem = useCallback(({ item }: { item: Warehouse | null }) => {
    const warehouse = item;
    const isAll = warehouse === null;
    const id = warehouse?.id || null;
    const active = selectedWarehouseId === id;
    return (
      <TouchableOpacity
        key={warehouse?.id || 'all'}
        style={[styles.pickerItem, active && styles.pickerItemActive]}
        activeOpacity={0.86}
        onPress={() => handleWarehouseSelect(id)}
      >
        <View style={styles.pickerItemLeft}>
          <FontAwesome6
            name={isAll ? 'layer-group' : 'warehouse'}
            size={14}
            color={active ? theme.primary : theme.textSecondary}
          />
          <Text style={[styles.pickerItemText, active && styles.pickerItemTextActive]}>
            {isAll ? '全部仓库' : warehouse.name}
          </Text>
        </View>
        {active ? <FontAwesome6 name="check" size={14} color={theme.primary} /> : null}
      </TouchableOpacity>
    );
  }, [handleWarehouseSelect, selectedWarehouseId, styles, theme.primary, theme.textSecondary]);

  const renderDetail = useCallback((
    record: InboundRecord,
    document: InboundDocumentSummary
  ) => (
    <TouchableOpacity
      key={record.id}
      style={styles.detailRow}
        feedback="none"
      activeOpacity={0.86}
      onLongPress={() => handleDeleteRecord(record, document)}
    >
      <View style={styles.detailContent}>
        <Text style={styles.detailTitle}>
          批次：{record.batch || '-'}
        </Text>
        <Text style={styles.detailMeta}>
          生产日期：{record.productionDate || '-'}
        </Text>
        <Text style={styles.detailMeta}>
          追溯码：{record.traceNo?.trim() || '-'}
        </Text>
      </View>
      <View style={styles.detailQtyBox}>
        <View style={styles.detailQuantityRow}>
          <Text style={styles.detailQty}>{formatQuantity(record.quantity)}</Text>
          <Text style={styles.detailQtyUnit}>/ PCS</Text>
        </View>
      </View>
    </TouchableOpacity>
  ), [handleDeleteRecord, styles]);

  const renderDetailGroup = useCallback((
    group: InboundDetailGroup,
    document: InboundDocumentSummary,
    documentKey: string
  ) => {
    const groupKey = `${documentKey}::${group.key}`;
    const isExpanded = expandedDetailGroupKeys.has(groupKey);

    return (
      <View key={groupKey} style={styles.detailGroupCard}>
        <TouchableOpacity
          style={styles.detailGroupRow}
          feedback="none"
          activeOpacity={0.86}
          onPress={() => toggleDetailGroup(groupKey)}
        >
          <View style={styles.detailGroupContent}>
            <Text style={styles.detailGroupTitle}>
              存货编码：{group.inventoryCode || '-'}
            </Text>
            <Text style={styles.detailGroupMeta}>
              型号：{group.model}
            </Text>
            <Text style={styles.detailGroupMeta}>
              版本号：{group.version || '-'}
            </Text>
            <Text style={styles.detailGroupCount}>{group.records.length} 条明细</Text>
          </View>
          <View style={styles.detailGroupRight}>
            <View style={styles.detailGroupQuantityRow}>
              <Text style={styles.detailGroupQty}>{formatQuantity(group.totalQuantity)}</Text>
              <Text style={styles.detailQtyUnit}>PCS</Text>
            </View>
          </View>
          <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={theme.textSecondary} />
        </TouchableOpacity>

        {<View>{isExpanded ? (
          <View style={styles.detailGroupDetails}>
            {group.records.map(record => renderDetail(record, document))}
          </View>
        ) : null}</View>}
      </View>
    );
  }, [
    expandedDetailGroupKeys,
    renderDetail,
    styles,
    theme.textSecondary,
    toggleDetailGroup,
  ]);

  const renderDocument = useCallback(({ item }: { item: InboundDocumentSummary }) => {
    const key = getDocumentKey(item);
    const isExpanded = expandedKeys.has(key);
    const detailLoading = loadingKeys.has(key);
    const detailGroups = detailGroupsByKey[key] || [];
    const syncMeta = getSyncStatusMeta(item.sync_status);
    const accountLabel = item.erp_account_keys?.split(',').map(key =>
      ERP_ACCOUNTS.find(account => account.key === key)?.name || '未知账套'
    ).join('、') || '未记录账套';
    const syncing = syncingKeys.has(key);
    const syncActionLabel =
      syncing
        ? '同步中'
        : item.sync_status === 'success' || item.sync_status === 'failed'
          ? '重新同步'
          : '同步到电脑';

    return (
      <AnimatedCard disablePressAnimation onPress={() => toggleDocument(item)} onLongPress={() => handleDeleteDocument(item)}>
        <View style={styles.documentCard}>
          <View style={styles.documentHeader}>
            <View style={styles.documentIcon}>
              <Feather name="log-in" size={18} color={theme.primary} />
            </View>
            <View style={styles.documentTitleBlock}>
              <View style={styles.documentTitleRow}>
                <Text style={styles.documentNo} numberOfLines={1}>{item.inbound_no}</Text>
                <TouchableOpacity
                  feedback="none"
                  style={[
                    styles.syncInlineButton,
                    {
                      backgroundColor: `${syncMeta.color}14`,
                      borderColor: `${syncMeta.color}33`,
                    },
                    syncing && styles.syncInlineButtonDisabled,
                  ]}
                  activeOpacity={0.86}
                  disabled={syncing}
                  accessibilityRole="button"
                  accessibilityLabel={`${syncMeta.label}，${syncActionLabel}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    handleResyncDocument(item);
                  }}
                >
                  {syncing ? (
                    <ActivityIndicator size="small" color={syncMeta.color} />
                  ) : (
                    <Feather name={syncMeta.icon} size={12} color={syncMeta.color} />
                  )}
                  <Text style={[styles.syncInlineText, { color: syncMeta.color }]}>
                    {syncActionLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {detailLoading ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />}
          </View>

          <DocumentMetadata completion={item.completion_status === 'partial' ? '部分入库' : '已入库完成'}
            syncLabel={syncMeta.label} syncColor={syncMeta.color} date={item.in_date} account={accountLabel} />
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.model_count}</Text>
              <Text style={styles.statLabel}>型号</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.record_count}</Text>
              <Text style={styles.statLabel}>明细</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatQuantity(item.total_quantity)}</Text>
              <Text style={styles.statLabel}>PCS</Text>
            </View>
          </View>

          {<View>{isExpanded && !detailLoading ? (
            <View testID="document-expanded-details" style={styles.detailWrap}>
              {item.completion_status === 'partial' && <Text style={styles.detailHint}>可继续扫码</Text>}
              <View style={styles.detailHintRow}>
                <Text style={styles.detailHint}>点型号展开明细，长按明细可删除</Text>
              </View>
              {detailGroups.map((group) => renderDetailGroup(group, item, key))}
            </View>
          ) : null}</View>}
        </View>
      </AnimatedCard>
    );
  }, [
    detailGroupsByKey,
    expandedKeys,
    handleDeleteDocument,
    handleResyncDocument,
    getSyncStatusMeta,
    loadingKeys,
    renderDetailGroup,
    styles,
    theme.primary,
    theme.textSecondary,
    toggleDocument,
    syncingKeys,
  ]);

  const keyExtractor = useCallback(
    (item: InboundDocumentSummary) => getDocumentKey(item),
    []
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.86}
            onPress={() => router.back()} accessibilityLabel="返回上一页"
          >
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>入库记录</Text>
            <Text style={styles.subtitle}>按入库单查看明细，长按可删除本机记录</Text>
          </View>
        </View>

        <View style={styles.filterCard}>
          <View style={styles.filterTitleRow}>
            <TouchableOpacity
              style={styles.warehouseSelectButton}
              activeOpacity={0.86}
              onPress={() => setShowWarehousePicker(true)}
            >
              <View style={styles.warehouseIconBox}>
                <FontAwesome6
                  name={selectedWarehouseId ? 'warehouse' : 'layer-group'}
                  size={14}
                  color={theme.primary}
                />
              </View>
              <View style={styles.warehouseSelectTextBlock}>
                <Text style={styles.filterLabel}>当前范围</Text>
                <Text style={styles.filterTitle} numberOfLines={1} ellipsizeMode="tail">
                  {selectedWarehouseName}
                </Text>
              </View>
              <Feather name="chevron-down" size={18} color={theme.textMuted} />
            </TouchableOpacity>
            <View style={styles.filterSummary}>
              <Text style={styles.filterSummaryValue}>{totalInfo.documentCount}</Text>
              <Text style={styles.filterSummaryLabel}>单据</Text>
            </View>
          </View>

        </View>

        <FlatList
          data={documents}
          keyExtractor={keyExtractor}
          renderItem={renderDocument}
          contentContainerStyle={[
            styles.listContent,
            documents.length === 0 && styles.emptyListContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          }
          ListEmptyComponent={
            loading ? (
              <AppEmptyState icon="loader" title="正在加载入库记录" loading compact />
            ) : (
              <AppEmptyState
                icon="inbox"
                title="暂无入库记录"
                description="扫码入库确认保存后，会在这里按入库单归档。"
                compact
              />
            )
          }
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
        />

        {<MotionPresence visible={Boolean(showWarehousePicker)} overlay style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 50 }}>{showWarehousePicker ? (
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerBox}>
              <Text style={styles.pickerTitle}>选择仓库</Text>
              <FlatList
                data={[null, ...warehouses] as (Warehouse | null)[]}
                keyExtractor={(item) => item?.id || 'all'}
                renderItem={renderWarehousePickerItem}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.pickerList}
              />
              <TouchableOpacity
                style={styles.pickerClose}
                activeOpacity={0.86}
                onPress={() => setShowWarehousePicker(false)}
              >
                <Text style={styles.pickerCloseText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}</MotionPresence>}

        <AppPillToast text={notice?.text || ''} type={notice?.type || 'success'} visible={Boolean(notice)} bottom={insets.bottom + 28} />
      </View>

      {alert.AlertComponent}
    </Screen>
  );
}
