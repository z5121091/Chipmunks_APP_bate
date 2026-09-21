import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AppEmptyState } from '@/components/AppEmptyState';
import { Screen } from '@/components/Screen';
import { UiPageHeader, UiWorkflowSummary } from '@/components/UiRedesign';
import { WarehouseScanInput, type WarehouseScanInputHandle } from '@/components/WarehouseScanInput';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import {
  ERP_ACCOUNTS,
  isErpAccountAvailable,
  type ErpAccountConfig,
} from '@/utils/erpAccounts';
import {
  fetchCurrentStockByInventoryCode,
  type CurrentStockRow,
} from '@/utils/erpCurrentStock';
import { detectRule, getActiveRules, getInventoryCodeByModel, initDatabase, parseWithRule, type QRCodeRule } from '@/utils/database';
import { feedbackNotBound, feedbackQueryFailed, feedbackQuerySuccess } from '@/utils/feedback';
import { isQRCode } from '@/utils/qrcodeParser';
import { cancelScanSubmit, scheduleScanSubmit, sanitizeStructuredScannerInput } from '@/utils/scannerInput';
import { logger } from '@/utils/logger';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { createStyles } from './styles';

type ParsedStockScan = {
  model: string;
  version: string;
};

type LastQuery = {
  inventoryCode: string;
  specification: string;
};

const ACCOUNT_LABELS: Record<ErpAccountConfig['key'], string> = {
  'wuxi-duneng': '无锡笃能',
  'shanghai-chipmunk': '上海花栗鼠',
};

const getAccountLabel = (account: ErpAccountConfig) => ACCOUNT_LABELS[account.key] || account.name;

const formatQuantity = (value: number | null) =>
  value === null ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: 4 });

const STOCK_QUERY_AUTO_SUBMIT_DEBOUNCE_MS = 150;

const parseStockScan = async (content: string, rules: readonly QRCodeRule[]): Promise<ParsedStockScan> => {
  const rule = await detectRule(content, rules);

  if (rule) {
    const { standardFields } = parseWithRule(content, rule);
    return {
      model: standardFields.model || '',
      version: standardFields.version || '',
    };
  }

  throw new Error('未找到匹配的二维码解析规则，请先到设置中配置规则');
};

export default function StockQueryScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const inputRef = useRef<WarehouseScanInputHandle>(null);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenActiveRef = useRef(false);
  const requestIdRef = useRef(0);
  const liveInputRef = useRef('');
  const activeRulesRef = useRef<QRCodeRule[] | null>(null);
  const queryingRef = useRef(false);
  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const [inputValue, setInputValue] = useState('');
  const [querying, setQuerying] = useState(false);
  const [lastQuery, setLastQuery] = useState<LastQuery | null>(null);
  const [stockRows, setStockRows] = useState<CurrentStockRow[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  const focusScannerInput = useCallback((delay = 0) => {
    if (screenActiveRef.current) inputRef.current?.focus(delay);
  }, []);

  useFocusEffect(
    useCallback(() => {
      screenActiveRef.current = true;
      activeRulesRef.current = null;
      queryingRef.current = false;
      setQuerying(false);
      focusScannerInput(120);
      return () => {
        screenActiveRef.current = false;
        requestIdRef.current += 1;
        liveInputRef.current = '';
        setInputValue('');
        cancelScanSubmit(autoSubmitTimerRef);
      };
    }, [focusScannerInput])
  );

  const workflowSummaryItems = useMemo(
    () => [
      {
        key: 'account',
        label: '账套',
        value: getAccountLabel(selectedAccount),
        icon: 'briefcase' as const,
        color: theme.primary,
      },
      {
        key: 'stock',
        label: '库存',
        value: lastQuery ? `${stockRows.length} 仓库` : selectedAccountAvailable ? '待查询' : '未开放',
        icon: 'package' as const,
        color: lastQuery ? theme.success : selectedAccountAvailable ? theme.textMuted : theme.warning,
      },
    ],
    [
      lastQuery,
      selectedAccount,
      selectedAccountAvailable,
      stockRows.length,
      theme.primary,
      theme.success,
      theme.textMuted,
      theme.warning,
    ]
  );

  const handleQuery = useCallback(
    async (nextInput?: string) => {
      cancelScanSubmit(autoSubmitTimerRef);

      const rawContent = sanitizeStructuredScannerInput(nextInput ?? liveInputRef.current);
      if (!rawContent || queryingRef.current) {
        return;
      }

      liveInputRef.current = '';
      setInputValue('');
      queryingRef.current = true;
      const requestId = ++requestIdRef.current;
      const isCurrent = () => screenActiveRef.current && requestIdRef.current === requestId;

      try {
        await initDatabase();
        const rules = activeRulesRef.current ?? await getActiveRules();
        if (!isCurrent()) return;
        activeRulesRef.current = rules;
        if (!isQRCode(rawContent, rules)) return;
        setQuerying(true);
        setErrorMessage('');
        setLastQuery(null);
        setStockRows([]);
        if (!selectedAccountAvailable) {
          throw new Error(`${getAccountLabel(selectedAccount)}账套暂未开放，暂不能查询库存`);
        }
        const parsed = await parseStockScan(rawContent, rules);
        if (!isCurrent()) return;
        const model = parsed.model.trim();

        if (!model) {
          throw new Error('未识别到型号');
        }

        const inventoryCode = await getInventoryCodeByModel(model, parsed.version);
        if (!isCurrent()) return;

        if (!inventoryCode) {
          setErrorMessage(
            `未找到物料绑定：${model}${parsed.version ? ` / ${parsed.version}` : ''}`
          );
          void feedbackNotBound();
          return;
        }

        const result = await fetchCurrentStockByInventoryCode(selectedAccount, inventoryCode);
        if (!isCurrent()) return;
        setLastQuery({
          inventoryCode:
            result.rows.find((row) => row.inventoryCode)?.inventoryCode || result.inventoryCode,
          specification: result.rows.find((row) => row.specification)?.specification || '-',
        });
        setStockRows(result.rows);
        void feedbackQuerySuccess();
      } catch (error) {
        if (!isCurrent()) return;
        logger.error('[库存查询] 查询失败:', error);
        setErrorMessage(formatUserFacingErrorMessage(error, '库存查询失败，请稍后重试'));
        setLastQuery(null);
        setStockRows([]);
        void feedbackQueryFailed();
      } finally {
        if (isCurrent()) {
          queryingRef.current = false;
          setQuerying(false);
          focusScannerInput(120);
        }
      }
    },
    [focusScannerInput, selectedAccount, selectedAccountAvailable]
  );

  const handleInputChange = useCallback(
    (text: string) => {
      cancelScanSubmit(autoSubmitTimerRef);
      if (queryingRef.current) return;

      liveInputRef.current = text;
      setInputValue(text);

      const nextContent = sanitizeStructuredScannerInput(text);
      if (!nextContent) return;

      scheduleScanSubmit(autoSubmitTimerRef, () => {
        void handleQuery(nextContent);
      }, STOCK_QUERY_AUTO_SUBMIT_DEBOUNCE_MS);
    },
    [handleQuery]
  );

  const renderAccountButton = useCallback(
    (account: ErpAccountConfig) => {
      const active = account.key === selectedAccount.key;
      const available = isErpAccountAvailable(account);
      return (
        <TouchableOpacity
          key={account.key}
          style={[styles.accountButton, active && styles.accountButtonActive]}
          activeOpacity={0.78}
          disabled={querying}
          onPress={() => {
            if (queryingRef.current) return;
            cancelScanSubmit(autoSubmitTimerRef);
            requestIdRef.current += 1;
            liveInputRef.current = '';

            setSelectedAccount(account);
            setInputValue('');
            setLastQuery(null);
            setStockRows([]);
            setErrorMessage(available ? '' : `${getAccountLabel(account)}账套暂未开放，暂不能查询库存`);
            focusScannerInput(120);
          }}
        >
          <Text
            style={[styles.accountButtonText, active && styles.accountButtonTextActive]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {available ? getAccountLabel(account) : `${getAccountLabel(account)}（未开放）`}
          </Text>
        </TouchableOpacity>
      );
    },
    [focusScannerInput, querying, selectedAccount.key, styles]
  );

  const renderStockRow = useCallback(
    ({ item }: { item: CurrentStockRow }) => (
      <View style={styles.stockCard}>
        <View style={styles.stockCardHeader}>
          <View style={styles.stockTitleBlock}>
            <Text style={styles.stockWarehouseName} numberOfLines={1}>
              {item.warehouseName || '未命名仓库'}
            </Text>
            <Text style={styles.stockWarehouseCode} numberOfLines={1}>
              {item.warehouseCode || '-'}
            </Text>
          </View>
          <View style={styles.stockQuantityBlock}>
            <Text style={styles.stockQuantity}>{formatQuantity(item.quantity)}</Text>
            <Text style={styles.stockQuantityLabel}>现存量</Text>
          </View>
        </View>
      </View>
    ),
    [styles]
  );

  const stockKeyExtractor = useCallback(
    (item: CurrentStockRow, index: number) =>
      `${item.inventoryCode}-${item.warehouseCode || item.warehouseName || index}`,
    []
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.topPanel}>
          <UiPageHeader
            title="库存查询"
            onBack={() => router.back()}
            rightIcon="crosshair"
            rightLabel="聚焦库存查询输入框"
            onRightPress={() => focusScannerInput(0)}
          />

          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        <View style={styles.accountPanel}>{ERP_ACCOUNTS.map(renderAccountButton)}</View>

        <WarehouseScanInput
          inputRef={inputRef}
          active={inputValue.length > 0 || querying}
          processing={querying}
          statusLabel={
            querying
              ? '正在查询ERP库存'
              : selectedAccountAvailable
                ? '库存扫码查询'
                : `${getAccountLabel(selectedAccount)}账套暂未开放`
          }
          value={inputValue}
          onChangeText={handleInputChange}
          onSubmitEditing={() => {
            void handleQuery();
          }}
          placeholder={
            querying
              ? '正在查询ERP库存...'
              : selectedAccountAvailable
                ? '扫描物料二维码'
                : `${getAccountLabel(selectedAccount)}账套暂未开放`
          }
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          editable={selectedAccountAvailable}
          showSoftInputOnFocus={false}
          actionLabel="查询ERP库存"
          actionDisabled={!selectedAccountAvailable}
          actionLoading={querying}
          onActionPress={() => {
            if (inputValue.trim()) {
              void handleQuery();
              return;
            }
            focusScannerInput(0);
          }}
        />

        <View style={styles.resultSection}>
          {lastQuery ? (
            <View style={styles.queryCard}>
              <View style={styles.queryMain}>
                <View style={styles.queryFieldRow}>
                  <Text style={styles.queryLabel}>规格型号</Text>
                  <Text style={styles.queryValue} numberOfLines={2}>
                    {lastQuery.specification}
                  </Text>
                </View>
                <View style={styles.queryFieldRow}>
                  <Text style={styles.queryLabel}>存货编码</Text>
                  <Text style={styles.queryValue} numberOfLines={1}>
                    {lastQuery.inventoryCode}
                  </Text>
                </View>
                <View style={styles.queryFieldRow}>
                  <Text style={styles.queryLabel}>ERP 总库存</Text>
                  <Text style={styles.queryValue}>
                    {formatQuantity(stockRows.some(row => row.quantity === null) ? null : stockRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0))}
                  </Text>
                </View>
              </View>
              <View style={styles.queryBadge}>
                <Text style={styles.queryBadgeText}>{stockRows.length} 仓库</Text>
              </View>
            </View>
          ) : null}

          {errorMessage ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={18} color={theme.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {querying ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.loadingText}>正在读取ERP库存...</Text>
            </View>
          ) : (
            <FlatList
              data={stockRows}
              keyExtractor={stockKeyExtractor}
              renderItem={renderStockRow}
              style={styles.list}
              contentContainerStyle={
                !lastQuery && stockRows.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="search"
                  title={lastQuery ? 'ERP未返回库存' : '等待查询'}
                  description={lastQuery ? '该账套未返回此物料的库存明细' : '扫描物料二维码后显示现存量'}
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
