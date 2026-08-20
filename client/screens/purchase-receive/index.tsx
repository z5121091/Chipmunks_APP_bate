import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { UiWorkflowSummary } from '@/components/UiRedesign';
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
  fetchPendingPurchaseReceives,
  fetchPurchaseReceiveVoucher,
  fetchPurchaseReceiveVoucherStatuses,
  loadCachedPendingPurchaseReceives,
  loadCachedPurchaseReceiveVoucher,
  loadCachedPurchaseReceiveVoucherStatuses,
  savePendingPurchaseReceivesCache,
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
const PURCHASE_RECEIVE_STATUS_POLL_INTERVAL_MS = 30_000;
const PURCHASE_RECEIVE_REQUIRED_FRESHNESS_MS = 5 * 60_000;
const PURCHASE_RECEIVE_LIST_AUTO_REFRESH_MS = 5 * 60_000;
const PURCHASE_RECEIVE_LOOKUP_AUTO_SUBMIT_MS = 180;
const STANDARD_PURCHASE_RECEIVE_CODE_PATTERN = /^II-\d{4}-\d{2}-\d{2}-\d{3}$/i;

type PendingListLoadOptions = {
  forceRefresh?: boolean;
  revalidateStaleCache?: boolean;
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
  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const [items, setItems] = useState<PurchaseReceiveListItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedCode, setExpandedCode] = useState('');
  const [loadingDetailCode, setLoadingDetailCode] = useState('');
  const [details, setDetails] = useState<Record<string, PurchaseReceiveVoucher>>({});
  const [detailLoadedAt, setDetailLoadedAt] = useState<Record<string, number>>({});
  const [manualVoucherCode, setManualVoucherCode] = useState('');
  const [completedVoucherCodes, setCompletedVoucherCodes] = useState<Set<string>>(new Set());
  const [auditedVoucherCodes, setAuditedVoucherCodes] = useState<Set<string>>(new Set());
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  const loadPendingList = useCallback(async (
    account: ErpAccountConfig,
    options: PendingListLoadOptions = {}
  ) => {
    const { forceRefresh = false, revalidateStaleCache = false } = options;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!isErpAccountAvailable(account)) {
      setItems([]);
      setUpdatedAt('');
      setErrorMessage(`${account.name}账套暂未开放`);
      return;
    }

    setErrorMessage('');
    if (forceRefresh) {
      setRefreshing(true);
    }

    try {
      if (!forceRefresh) {
        const cached = await loadCachedPendingPurchaseReceives(account.key);
        if (cached && requestId === requestIdRef.current) {
          setItems(cached.data.items);
          setUpdatedAt(cached.cachedAt);
          const cachedAt = Date.parse(cached.cachedAt);
          const cacheIsFresh =
            Number.isFinite(cachedAt) &&
            Date.now() - cachedAt <= PURCHASE_RECEIVE_LIST_AUTO_REFRESH_MS;
          if (!revalidateStaleCache || cacheIsFresh) {
            return;
          }
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }

      const result = await fetchPendingPurchaseReceives(account, 0, 100, {
        bypassCache: forceRefresh,
      });
      const cache = await savePendingPurchaseReceivesCache(account.key, result);
      if (requestId === requestIdRef.current) {
        setItems(result.items);
        setUpdatedAt(cache.cachedAt);
      }
    } catch (error) {
      logger.error('[采购入库] 加载未审单据失败:', error);
      if (requestId === requestIdRef.current) {
        setErrorMessage(
          formatUserFacingErrorMessage(error, '采购入库单查询失败，请稍后重试')
        );
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadCompletedVoucherCodes = useCallback(async (account: ErpAccountConfig) => {
    const requestId = completionRequestIdRef.current + 1;
    completionRequestIdRef.current = requestId;

    if (!isErpAccountAvailable(account)) {
      setCompletedVoucherCodes(new Set());
      return;
    }

    try {
      const documents = await getInboundDocumentSummaries();
      if (requestId !== completionRequestIdRef.current) {
        return;
      }

      setCompletedVoucherCodes(
        new Set(
          documents
            .filter(
              (document) => document.warehouse_name.trim() === account.expectedWarehouseName
            )
            .map((document) => normalizeVoucherCode(document.inbound_no))
            .filter(Boolean)
        )
      );
    } catch (error) {
      logger.error('[采购入库] 读取本地已入库单据失败:', error);
      if (requestId === completionRequestIdRef.current) {
        setCompletedVoucherCodes(new Set());
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
      void loadPendingList(selectedAccount, { revalidateStaleCache: true });
      void loadCompletedVoucherCodes(selectedAccount);
      void loadPurchaseReceiveStatuses(selectedAccount);

      const statusTimer = setInterval(() => {
        void loadPurchaseReceiveStatuses(selectedAccount, false);
      }, PURCHASE_RECEIVE_STATUS_POLL_INTERVAL_MS);

      return () => {
        clearInterval(statusTimer);
        if (manualLookupTimerRef.current) {
          clearTimeout(manualLookupTimerRef.current);
          manualLookupTimerRef.current = null;
        }
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
    if (manualLookupTimerRef.current) {
      clearTimeout(manualLookupTimerRef.current);
      manualLookupTimerRef.current = null;
    }
    requestIdRef.current += 1;
    completionRequestIdRef.current += 1;
    statusRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    manualLookupInProgressRef.current = '';
    setSelectedAccount(account);
    setItems([]);
    setCompletedVoucherCodes(new Set());
    setAuditedVoucherCodes(new Set());
    setUpdatedAt('');
    setLoading(false);
    setRefreshing(false);
    setErrorMessage('');
    setExpandedCode('');
    setLoadingDetailCode('');
    setDetails({});
    setDetailLoadedAt({});
    setManualVoucherCode('');
  }, []);

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
          : await fetchPurchaseReceiveVoucher(account, item.code);

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
    if (manualLookupTimerRef.current) {
      clearTimeout(manualLookupTimerRef.current);
      manualLookupTimerRef.current = null;
    }

    const voucherCode = normalizeVoucherCode(nextVoucherCode ?? manualVoucherCode);
    const requestKey = `${selectedAccount.key}:${voucherCode}`;
    if (
      !voucherCode ||
      !selectedAccountAvailable ||
      loadingDetailCode ||
      manualLookupInProgressRef.current
    ) {
      return;
    }
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
      setManualVoucherCode('');
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
    manualVoucherCode,
    router,
    selectedAccount,
    selectedAccountAvailable,
  ]);

  const handleManualVoucherCodeChange = useCallback(
    (text: string) => {
      if (manualLookupTimerRef.current) {
        clearTimeout(manualLookupTimerRef.current);
        manualLookupTimerRef.current = null;
      }

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

      manualLookupTimerRef.current = setTimeout(() => {
        manualLookupTimerRef.current = null;
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
                    {completed ? '已入库' : item.stateName || '未审'}
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
                    <Text style={styles.startButtonText}>开始扫码入库</Text>
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
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} activeOpacity={0.7} onPress={() => router.back()}>
              <Feather name="arrow-left" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>采购入库</Text>
            <TouchableOpacity
              style={styles.headerButton}
              activeOpacity={0.7}
              disabled={!selectedAccountAvailable || refreshing}
              accessibilityLabel="同步ERP未审采购入库单"
              onPress={handleRefresh}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Feather name="refresh-cw" size={19} color={theme.textPrimary} />
              )}
            </TouchableOpacity>
          </View>
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
