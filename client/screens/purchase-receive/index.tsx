import { cancelScanSubmit, scheduleScanSubmit } from '@/utils/scannerInput';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AppEmptyState } from '@/components/AppEmptyState';
import { Screen } from '@/components/Screen';
import { UiPageHeader, UiWorkflowSummary } from '@/components/UiRedesign';
import { WarehouseScanInput } from '@/components/WarehouseScanInput';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { getInboundDocumentSummaries } from '@/utils/database';
import {
  ERP_ACCOUNTS,
  getErpAccountByKey,
  isErpAccountAvailable,
  type ErpAccountConfig,
} from '@/utils/erpAccounts';
import {
  fetchPurchaseReceiveVoucher,
  fetchPurchaseReceiveVoucherStatuses,
  getPendingPurchaseReceivesSnapshot,
  loadCachedPendingPurchaseReceives,
  loadCachedPurchaseReceiveVoucher,
  loadCachedPurchaseReceiveVoucherStatuses,
  revalidatePendingPurchaseReceives,
  savePurchaseReceiveVoucherCache,
  savePurchaseReceiveVoucherStatusesCache,
  type PurchaseReceiveListItem,
  type PurchaseReceiveVoucher,
  type PurchaseReceiveVoucherStatus,
} from '@/utils/erpPurchaseReceive';
import { logger } from '@/utils/logger';
import { formatDateTime } from '@/utils/time';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { feedbackInboundStart } from '@/utils/feedback';
import { createStyles } from './styles';

const getUpdatedLabel = (value: string) =>
  value ? formatDateTime(value) : '尚未同步';

const normalizeVoucherCode = (value: string) => value.trim().toUpperCase();
const isForegroundState = (state: typeof AppState.currentState) => !state || state === 'active';
const PURCHASE_RECEIVE_STATUS_POLL_INTERVAL_MS = 30_000;
const PURCHASE_RECEIVE_REQUIRED_FRESHNESS_MS = 5 * 60_000;
const PURCHASE_RECEIVE_LOOKUP_AUTO_SUBMIT_MS = 180;
const STANDARD_PURCHASE_RECEIVE_CODE_PATTERN = /^II-\d{4}-\d{2}-\d{2}-\d{2,3}$/i;

type PendingListLoadOptions = {
  forceRefresh?: boolean;
  background?: boolean;
};

export default function PurchaseReceiveScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const requestIdRef = useRef(0);
  const completionRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const manualLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualLookupInProgressRef = useRef('');
  const manualVoucherCodeRef = useRef('');
  const focusedRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const loadingDetailCodeRef = useRef('');
  const pendingListLoadRef = useRef<{ accountKey: ErpAccountConfig['key']; requestId: number } | null>(null);
  const [initialPendingSnapshot] = useState(() => getPendingPurchaseReceivesSnapshot(ERP_ACCOUNTS[0].key));
  const hasPendingListRef = useRef(Boolean(initialPendingSnapshot));
  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const [items, setItems] = useState<PurchaseReceiveListItem[]>(initialPendingSnapshot?.data.items || []);
  const [updatedAt, setUpdatedAt] = useState(initialPendingSnapshot?.cachedAt || '');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedCode, setExpandedCode] = useState('');
  const [loadingDetailCode, setLoadingDetailCode] = useState('');
  const [details, setDetails] = useState<Record<string, PurchaseReceiveVoucher>>({});
  const [detailLoadedAt, setDetailLoadedAt] = useState<Record<string, number>>({});
  const [manualVoucherCode, setManualVoucherCode] = useState('');
  const [completedVoucherCodes, setCompletedVoucherCodes] = useState<Set<string>>(new Set());
  const [partialVoucherCodes, setPartialVoucherCodes] = useState<Set<string>>(new Set());
  const [auditedVoucherCodes, setAuditedVoucherCodes] = useState<Set<string>>(new Set());
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  const loadPendingList = useCallback(async (
    account: ErpAccountConfig,
    options: PendingListLoadOptions = {}
  ) => {
    const { forceRefresh = false, background = false } = options;
    if (pendingListLoadRef.current?.accountKey === account.key) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!isErpAccountAvailable(account)) {
      setItems([]);
      setUpdatedAt('');
      setErrorMessage(`${account.name}账套暂未开放`);
      return;
    }

    pendingListLoadRef.current = { accountKey: account.key, requestId };
    if (!background) setErrorMessage('');
    if (forceRefresh) {
      setRefreshing(true);
    }

    try {
      const snapshot = getPendingPurchaseReceivesSnapshot(account.key);
      if (snapshot) {
        hasPendingListRef.current = true;
        setItems(snapshot.data.items);
        setUpdatedAt(snapshot.cachedAt);
      } else if (!hasPendingListRef.current) {
        setLoading(true);
        const cached = await loadCachedPendingPurchaseReceives(account.key);
        if (
          requestId !== requestIdRef.current ||
          !focusedRef.current ||
          !isForegroundState(appStateRef.current)
        ) return;
        if (cached) {
          hasPendingListRef.current = true;
          setItems(cached.data.items);
          setUpdatedAt(cached.cachedAt);
          setLoading(false);
        }
      }

      const cache = await revalidatePendingPurchaseReceives(account, { forceRefresh });
      if (
        requestId === requestIdRef.current &&
        focusedRef.current &&
        isForegroundState(appStateRef.current)
      ) {
        hasPendingListRef.current = true;
        setItems(cache.data.items);
        setUpdatedAt(cache.cachedAt);
      }
    } catch (error) {
      logger.error('[采购入库] 加载未审单据失败:', error);
      if (requestId === requestIdRef.current && !background) {
        setErrorMessage(
          formatUserFacingErrorMessage(error, '采购入库单查询失败，请稍后重试')
        );
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      if (pendingListLoadRef.current?.requestId === requestId) {
        pendingListLoadRef.current = null;
      }
    }
  }, []);

  const loadCompletedVoucherCodes = useCallback(async (account: ErpAccountConfig) => {
    const requestId = completionRequestIdRef.current + 1;
    completionRequestIdRef.current = requestId;

    if (!isErpAccountAvailable(account)) {
      setCompletedVoucherCodes(new Set());
      setPartialVoucherCodes(new Set());
      return;
    }

    try {
      const documents = await getInboundDocumentSummaries();
      if (requestId !== completionRequestIdRef.current) {
        return;
      }

      setPartialVoucherCodes(new Set(documents.filter(document =>
        document.warehouse_name.trim() === account.expectedWarehouseName && document.completion_status === 'partial'
      ).map(document => normalizeVoucherCode(document.inbound_no))));
      setCompletedVoucherCodes(
        new Set(
          documents
            .filter(
              (document) => document.warehouse_name.trim() === account.expectedWarehouseName && document.completion_status !== 'partial'
            )
            .map((document) => normalizeVoucherCode(document.inbound_no))
            .filter(Boolean)
        )
      );
    } catch (error) {
      logger.error('[采购入库] 读取本地已入库单据失败:', error);
      if (requestId === completionRequestIdRef.current) {
        setCompletedVoucherCodes(new Set());
        setPartialVoucherCodes(new Set());
      }
    }
  }, []);

  const applyPurchaseReceiveStatuses = useCallback(
    (statuses: PurchaseReceiveVoucherStatus[]) => {
      setAuditedVoucherCodes(
        new Set(
          statuses
            .filter((status) => status.status === 'audited')
            .map((status) => normalizeVoucherCode(status.voucherCode))
            .filter(Boolean)
        )
      );
    },
    []
  );

  const loadPurchaseReceiveStatuses = useCallback(
    async (account: ErpAccountConfig, useCache = true) => {
      const requestId = statusRequestIdRef.current + 1;
      statusRequestIdRef.current = requestId;

      if (!isErpAccountAvailable(account)) {
        setAuditedVoucherCodes(new Set());
        return;
      }

      try {
        if (useCache) {
          const cached = await loadCachedPurchaseReceiveVoucherStatuses(account.key);
          if (cached && requestId === statusRequestIdRef.current) {
            applyPurchaseReceiveStatuses(cached.data);
          }
        }

        const statuses = await fetchPurchaseReceiveVoucherStatuses(account);
        await savePurchaseReceiveVoucherStatusesCache(account.key, statuses);
        if (requestId === statusRequestIdRef.current) {
          applyPurchaseReceiveStatuses(statuses);
        }
      } catch (error) {
        logger.warn('[采购入库] 读取审核消息状态失败:', error);
      }
    },
    [applyPurchaseReceiveStatuses]
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      appStateRef.current = AppState.currentState;
      let entryListRefreshRequired = true;
      const refreshWhenIdle = (options: {
        includeList?: boolean;
        background?: boolean;
        useStatusCache?: boolean;
      } = {}) => {
        const { includeList = false, background = true, useStatusCache = false } = options;
        if (
          !focusedRef.current ||
          !isForegroundState(appStateRef.current) ||
          manualLookupInProgressRef.current ||
          manualVoucherCodeRef.current.trim() ||
          loadingDetailCodeRef.current
        ) return;
        if (includeList) {
          // 每次进入页面查一次最新单据；之后回到前台仍采用每日预加载策略。
          const forceRefresh = entryListRefreshRequired;
          entryListRefreshRequired = false;
          void loadPendingList(selectedAccount, {
            background: background && !forceRefresh,
            forceRefresh,
          });
        }
        void loadPurchaseReceiveStatuses(selectedAccount, useStatusCache);
      };
      refreshWhenIdle({ includeList: true, background: false, useStatusCache: true });
      void loadCompletedVoucherCodes(selectedAccount);

      const statusTimer = setInterval(() => {
        // Audit messages come from our server; do not poll the metered ERP list.
        refreshWhenIdle();
      }, PURCHASE_RECEIVE_STATUS_POLL_INTERVAL_MS);
      const subscription = AppState.addEventListener('change', state => {
        appStateRef.current = state;
        if (state !== 'active') return;
        refreshWhenIdle({ includeList: true });
        void loadCompletedVoucherCodes(selectedAccount);
      });

      return () => {
        focusedRef.current = false;
        clearInterval(statusTimer);
        subscription.remove();
        requestIdRef.current += 1;
        completionRequestIdRef.current += 1;
        statusRequestIdRef.current += 1;
        detailRequestIdRef.current += 1;
        pendingListLoadRef.current = null;
        loadingDetailCodeRef.current = '';
        setLoading(false);
        setRefreshing(false);
        setLoadingDetailCode('');
        cancelScanSubmit(manualLookupTimerRef);
        manualVoucherCodeRef.current = '';
        setManualVoucherCode('');
      };
    }, [
      loadCompletedVoucherCodes,
      loadPendingList,
      loadPurchaseReceiveStatuses,
      selectedAccount,
    ])
  );

  const { completedItems, displayItems, pendingItems } = useMemo(() => {
    const pending: PurchaseReceiveListItem[] = [];
    const completed: PurchaseReceiveListItem[] = [];

    items.forEach((item) => {
      const voucherCode = normalizeVoucherCode(item.code);
      if (auditedVoucherCodes.has(voucherCode)) {
        return;
      }
      if (completedVoucherCodes.has(voucherCode)) {
        completed.push(item);
      } else {
        pending.push(item);
      }
    });

    return {
      completedItems: completed,
      displayItems: [...pending, ...completed],
      pendingItems: pending,
    };
  }, [auditedVoucherCodes, completedVoucherCodes, items]);

  const workflowSummaryItems = useMemo(
    () => [
      {
        key: 'account',
        label: '账套',
        value: selectedAccount.name,
        icon: 'layers' as const,
        color: selectedAccountAvailable ? theme.primary : theme.warning,
      },
      {
        key: 'pending',
        label: '待入库',
        value: selectedAccountAvailable
          ? completedItems.length > 0
            ? `${pendingItems.length} 待 / ${completedItems.length} 已入`
            : `${pendingItems.length} 张`
          : '未开放',
        icon: 'file-text' as const,
        color: pendingItems.length > 0 ? theme.success : theme.textMuted,
      },
      {
        key: 'updated',
        label: 'ERP同步',
        value: updatedAt ? getUpdatedLabel(updatedAt) : '尚未同步',
        icon: 'clock' as const,
        color: updatedAt ? theme.primary : theme.textMuted,
      },
    ],
    [
      completedItems.length,
      pendingItems.length,
      selectedAccount,
      selectedAccountAvailable,
      theme,
      updatedAt,
    ]
  );

  const handleAccountPress = useCallback((account: ErpAccountConfig) => {
    if (account.key === selectedAccount.key) return;
    cancelScanSubmit(manualLookupTimerRef);
    requestIdRef.current += 1;
    completionRequestIdRef.current += 1;
    statusRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    manualLookupInProgressRef.current = '';
    pendingListLoadRef.current = null;
    loadingDetailCodeRef.current = '';
    manualVoucherCodeRef.current = '';
    setSelectedAccount(account);
    const snapshot = getPendingPurchaseReceivesSnapshot(account.key);
    hasPendingListRef.current = Boolean(snapshot);
    setItems(snapshot?.data.items || []);
    setCompletedVoucherCodes(new Set());
      setPartialVoucherCodes(new Set());
    setAuditedVoucherCodes(new Set());
    setUpdatedAt(snapshot?.cachedAt || '');
    setLoading(false);
    setRefreshing(false);
    setErrorMessage('');
    setExpandedCode('');
    setLoadingDetailCode('');
    setDetails({});
    setDetailLoadedAt({});
    setManualVoucherCode('');
  }, [selectedAccount.key]);

  const handleRefresh = useCallback(() => {
    void loadPendingList(selectedAccount, { forceRefresh: true });
    void loadCompletedVoucherCodes(selectedAccount);
    void loadPurchaseReceiveStatuses(selectedAccount, false);
  }, [
    loadCompletedVoucherCodes,
    loadPendingList,
    loadPurchaseReceiveStatuses,
    selectedAccount,
  ]);

  const loadVoucherDetail = useCallback(
    async (
      item: PurchaseReceiveListItem,
      options: { requireFresh?: boolean } = {}
    ): Promise<PurchaseReceiveVoucher | null> => {
      const existing = details[item.code];
      const existingLoadedAt = detailLoadedAt[item.code] || 0;
      const existingIsFresh =
        existingLoadedAt > 0 &&
        Date.now() - existingLoadedAt <= PURCHASE_RECEIVE_REQUIRED_FRESHNESS_MS;
      if (existing && (!options.requireFresh || existingIsFresh)) {
        return existing;
      }

      const requestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = requestId;
      loadingDetailCodeRef.current = item.code;
      setLoadingDetailCode(item.code);
      setErrorMessage('');
      try {
        const account = getErpAccountByKey(item.accountKey);
        if (!account) {
          throw new Error('未找到采购入库单所属账套');
        }
        const cached = await loadCachedPurchaseReceiveVoucher(item.accountKey, item.code);
        const cachedAt = cached ? Date.parse(cached.cachedAt) : Number.NaN;
        const cacheIsFresh =
          Number.isFinite(cachedAt) &&
          Date.now() - cachedAt <= PURCHASE_RECEIVE_REQUIRED_FRESHNESS_MS;
        const canUseCache = Boolean(cached && (!options.requireFresh || cacheIsFresh));
        const voucher = canUseCache
          ? cached!.data
          : await fetchPurchaseReceiveVoucher(account, item.code, { bypassCache: options.requireFresh });

        if (!canUseCache) {
          await savePurchaseReceiveVoucherCache(voucher);
        }
        if (requestId !== detailRequestIdRef.current) {
          return null;
        }
        setDetails((current) => ({ ...current, [item.code]: voucher }));
        setDetailLoadedAt((current) => ({
          ...current,
          [item.code]: canUseCache && Number.isFinite(cachedAt) ? cachedAt : Date.now(),
        }));
        return voucher;
      } catch (error) {
        logger.error('[采购入库] 加载单据明细失败:', error);
        if (requestId === detailRequestIdRef.current) {
          setErrorMessage(
            formatUserFacingErrorMessage(error, '采购入库单详情查询失败，请稍后重试')
          );
        }
        return null;
      } finally {
        if (requestId === detailRequestIdRef.current) {
          loadingDetailCodeRef.current = '';
          setLoadingDetailCode('');
        }
      }
    },
    [detailLoadedAt, details]
  );

  const handleToggleItem = useCallback(
    async (item: PurchaseReceiveListItem) => {
      const voucherCode = normalizeVoucherCode(item.code);
      if (auditedVoucherCodes.has(voucherCode) || completedVoucherCodes.has(voucherCode)) {
        return;
      }
      if (expandedCode === item.code) {
        setExpandedCode('');
        return;
      }

      setExpandedCode(item.code);
      await loadVoucherDetail(item);
    },
    [auditedVoucherCodes, completedVoucherCodes, expandedCode, loadVoucherDetail]
  );

  const handleStartScan = useCallback(
    async (item: PurchaseReceiveListItem) => {
      const voucherCode = normalizeVoucherCode(item.code);
      if (auditedVoucherCodes.has(voucherCode)) {
        setErrorMessage(`${item.code} 已在ERP审核，不再允许扫码入库`);
        return;
      }
      if (completedVoucherCodes.has(voucherCode)) {
        setErrorMessage(`${item.code} 已在本机完成入库，请先在ERP审核该单据`);
        return;
      }
      const voucher = await loadVoucherDetail(item, { requireFresh: true });
      if (!voucher) {
        return;
      }

      void feedbackInboundStart();
      router.push('/inbound', {
        accountKey: voucher.accountKey,
        voucherCode: voucher.code,
      });
    },
    [auditedVoucherCodes, completedVoucherCodes, loadVoucherDetail, router]
  );

  const handleManualLookup = useCallback(async (nextVoucherCode?: string) => {
    cancelScanSubmit(manualLookupTimerRef);

    const voucherCode = normalizeVoucherCode(nextVoucherCode ?? manualVoucherCodeRef.current);
    const requestKey = `${selectedAccount.key}:${voucherCode}`;
    if (
      !voucherCode ||
      !selectedAccountAvailable ||
      loadingDetailCode ||
      manualLookupInProgressRef.current
    ) {
      return;
    }
    manualVoucherCodeRef.current = '';
    setManualVoucherCode('');
    if (auditedVoucherCodes.has(voucherCode)) {
      setErrorMessage(`${voucherCode} 已在ERP审核，不再属于待入库单`);
      setExpandedCode('');
      return;
    }
    if (completedVoucherCodes.has(voucherCode)) {
      setErrorMessage(`${voucherCode} 已在本机完成入库，正在等待ERP审核`);
      setExpandedCode('');
      return;
    }

    manualLookupInProgressRef.current = requestKey;
    const probe: PurchaseReceiveListItem = {
      accountKey: selectedAccount.key,
      code: voucherCode,
      id: '',
      partnerCode: '',
      partnerName: '',
      stateCode: '00',
      stateName: '未审',
      voucherDate: '',
      warehouseCode: '',
      warehouseName: '',
    };
    try {
      const voucher = await loadVoucherDetail(probe, { requireFresh: true });
      if (!voucher) {
        return;
      }

      const listItem: PurchaseReceiveListItem = {
        accountKey: voucher.accountKey,
        code: voucher.code,
        id: voucher.id,
        partnerCode: voucher.partnerCode,
        partnerName: voucher.partnerName,
        stateCode: voucher.stateCode,
        stateName: voucher.stateName,
        voucherDate: voucher.voucherDate,
        warehouseCode: voucher.warehouseCode,
        warehouseName: voucher.warehouseName,
      };
      setItems((current) => [listItem, ...current.filter((item) => item.code !== voucher.code)]);
      setErrorMessage('');
      router.push('/inbound', {
        accountKey: voucher.accountKey,
        voucherCode: voucher.code,
      });
    } finally {
      if (manualLookupInProgressRef.current === requestKey) {
        manualLookupInProgressRef.current = '';
      }
    }
  }, [
    auditedVoucherCodes,
    completedVoucherCodes,
    loadVoucherDetail,
    loadingDetailCode,
    router,
    selectedAccount,
    selectedAccountAvailable,
  ]);

  const handleManualVoucherCodeChange = useCallback(
    (text: string) => {
      cancelScanSubmit(manualLookupTimerRef);
      if (manualLookupInProgressRef.current || loadingDetailCode) return;
      manualVoucherCodeRef.current = text;
      setManualVoucherCode(text);
      const voucherCode = normalizeVoucherCode(text);
      if (!voucherCode || !selectedAccountAvailable || loadingDetailCode) {
        return;
      }

      const matchesLoadedVoucher = items.some(
        (item) => normalizeVoucherCode(item.code) === voucherCode
      );
      if (!matchesLoadedVoucher && !STANDARD_PURCHASE_RECEIVE_CODE_PATTERN.test(voucherCode)) {
        return;
      }

      scheduleScanSubmit(manualLookupTimerRef, () => {
        void handleManualLookup(voucherCode);
      }, PURCHASE_RECEIVE_LOOKUP_AUTO_SUBMIT_MS);
    },
    [handleManualLookup, items, loadingDetailCode, selectedAccountAvailable]
  );

  const renderItem = useCallback(
    ({ item }: { item: PurchaseReceiveListItem }) => {
      const expanded = expandedCode === item.code;
      const detail = details[item.code];
      const detailLoading = loadingDetailCode === item.code;
      const completed = completedVoucherCodes.has(normalizeVoucherCode(item.code));
      const partial = partialVoucherCodes.has(normalizeVoucherCode(item.code));

      return (
        <View style={[styles.voucherCard, completed && styles.voucherCardCompleted]}>
          <TouchableOpacity
            style={styles.voucherHeader}
            activeOpacity={0.76}
            disabled={completed}
            onPress={() => {
              void handleToggleItem(item);
            }}
          >
            <View style={styles.voucherMain}>
              <View style={styles.voucherTitleRow}>
                <Text style={styles.voucherCode} numberOfLines={1}>{item.code}</Text>
                <View style={[styles.pendingBadge, completed && styles.completedBadge]}>
                  <Text
                    style={[styles.pendingBadgeText, completed && styles.completedBadgeText]}
                  >
                    {completed ? '已入库完成' : partial ? '部分入库' : item.stateName || '未审'}
                  </Text>
                </View>
              </View>
              <Text style={styles.partnerName} numberOfLines={1}>
                {item.partnerName || '供应商未返回'}
              </Text>
              <Text style={styles.voucherMeta} numberOfLines={1}>
                {item.voucherDate || '-'} · {item.warehouseName || '仓库未返回'}
              </Text>
            </View>
            {completed ? (
              <Feather name="check-circle" size={20} color={theme.success} />
            ) : (
              <Feather
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={19}
                color={theme.textMuted}
              />
            )}
          </TouchableOpacity>

          {completed ? (
            <View style={styles.completedNotice}>
              <Feather name="check" size={16} color={theme.success} />
              <Text style={styles.completedNoticeText}>本地已完成扫码，等待ERP审核</Text>
            </View>
          ) : expanded ? (
            <View style={styles.detailSection}>
              {detailLoading ? (
                <View style={styles.detailLoading}>
                  <ActivityIndicator color={theme.primary} />
                  <Text style={styles.detailLoadingText}>正在读取单据明细...</Text>
                </View>
              ) : detail ? (
                <>
                  {detail.lines.map((line) => (
                    <View key={line.id || `${line.inventoryCode}-${line.quantity}`} style={styles.lineRow}>
                      <View style={styles.lineMain}>
                        <Text style={styles.lineSpecification} numberOfLines={2}>
                          {line.specification || line.inventoryName || '物料明细'}
                        </Text>
                        <Text style={styles.lineCode} numberOfLines={1}>{line.inventoryCode || '-'}</Text>
                      </View>
                      <View style={styles.lineQuantityBlock}>
                        <Text style={styles.lineQuantity}>{line.quantity.toLocaleString()}</Text>
                        <Text style={styles.lineUnit}>{line.unitName || 'PCS'}</Text>
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.startButton}
                    activeOpacity={0.78}
                    onPress={() => {
                      void handleStartScan(item);
                    }}
                  >
                    <Feather name="maximize" size={18} color={theme.buttonPrimaryText} />
                    <Text style={styles.startButtonText}>{partial ? '继续扫码入库' : '开始扫码入库'}</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    },
    [
      details,
      completedVoucherCodes,
      partialVoucherCodes,
      expandedCode,
      handleStartScan,
      handleToggleItem,
      loadingDetailCode,
      styles,
      theme.buttonPrimaryText,
      theme.primary,
      theme.success,
      theme.textMuted,
    ]
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title="采购入库"
            onBack={() => router.back()}
            rightIcon="refresh-cw"
            rightLabel="同步ERP未审采购入库单"
            rightDisabled={!selectedAccountAvailable || refreshing}
            rightLoading={refreshing}
            onRightPress={() => {
              void handleRefresh();
            }}
          />
          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        <View style={styles.accountPanel}>
          {ERP_ACCOUNTS.map((account) => {
            const active = account.key === selectedAccount.key;
            const available = isErpAccountAvailable(account);
            return (
              <TouchableOpacity
                key={account.key}
                style={[styles.accountButton, active && styles.accountButtonActive]}
                activeOpacity={0.78}
                onPress={() => handleAccountPress(account)}
              >
                <Text
                  style={[styles.accountButtonText, active && styles.accountButtonTextActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {available ? account.name : `${account.name}（未开放）`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <WarehouseScanInput
          active={manualVoucherCode.trim().length > 0}
          processing={Boolean(loadingDetailCode)}
          statusLabel="采购入库单号查询"
          value={manualVoucherCode}
          onChangeText={handleManualVoucherCodeChange}
          onSubmitEditing={() => {
            void handleManualLookup();
          }}
          editable={selectedAccountAvailable}
          placeholder="扫描或输入采购入库单号"
          placeholderTextColor={theme.textMuted}
          autoCapitalize="characters"
          showSoftInputOnFocus={false}
          returnKeyType="search"
          actionLabel="打开采购入库单并开始扫码"
          actionDisabled={!manualVoucherCode.trim() || !selectedAccountAvailable}
          actionLoading={
            Boolean(loadingDetailCode) &&
            loadingDetailCode === manualVoucherCode.trim().toUpperCase()
          }
          onActionPress={() => {
            void handleManualLookup();
          }}
        />

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Feather name="alert-circle" size={18} color={theme.error} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>采购入库单</Text>
            <Text style={styles.listCount}>
              {pendingItems.length} 待入
              {completedItems.length > 0 ? ` · ${completedItems.length} 已入` : ''}
            </Text>
          </View>
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.loadingText}>正在读取ERP未审单据...</Text>
            </View>
          ) : (
            <FlatList
              data={displayItems}
              keyExtractor={(item) => `${item.accountKey}:${item.code}`}
              renderItem={renderItem}
              style={styles.list}
              contentContainerStyle={
                displayItems.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  colors={[theme.primary]}
                  tintColor={theme.primary}
                  progressBackgroundColor={theme.backgroundElevated}
                />
              }
              alwaysBounceVertical
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="inbox"
                  title={selectedAccountAvailable ? '暂无未审采购入库单' : '账套暂未开放'}
                  description={
                    selectedAccountAvailable
                      ? '下拉刷新读取ERP待入库单'
                      : `${selectedAccount.name}暂不能查询采购入库单`
                  }
                  compact
                  style={styles.empty}
                />
              }
            />
          )}
        </View>
      </View>
    </Screen>
  );
}
