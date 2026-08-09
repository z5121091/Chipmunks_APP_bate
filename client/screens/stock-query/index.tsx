import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { AppEmptyState } from '@/components/AppEmptyState';
import { Screen } from '@/components/Screen';
import { UiScanBox, UiWorkflowSummary } from '@/components/UiRedesign';
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
import { detectRule, getInventoryCodeByModel, initDatabase, parseWithRule } from '@/utils/database';
import { isQRCode } from '@/utils/qrcodeParser';
import { sanitizeStructuredScannerInput } from '@/utils/scannerInput';
import { logger } from '@/utils/logger';
import { formatUserFacingErrorMessage } from '@/utils/userFacingError';
import { createStyles } from './styles';

type ParsedStockScan = {
  model: string;
  quantity: string;
  rawContent: string;
  ruleName: string;
  traceNo: string;
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

const looksLikeInventoryCode = (value: string) => /^IC[-.\w]+$/i.test(value.trim());
const STOCK_QUERY_AUTO_SUBMIT_DEBOUNCE_MS = 450;
const STOCK_QUERY_MIN_AUTO_SUBMIT_LENGTH = 4;

const parseStockScan = async (content: string): Promise<ParsedStockScan> => {
  const normalizedContent = sanitizeStructuredScannerInput(content);
  const rule = await detectRule(normalizedContent);

  if (rule) {
    const { standardFields } = parseWithRule(normalizedContent, rule);
    return {
      model: standardFields.model || '',
      quantity: standardFields.quantity || '',
      rawContent: normalizedContent,
      ruleName: rule.name,
      traceNo: standardFields.traceNo || '',
      version: standardFields.version || '',
    };
  }

  if (isQRCode(normalizedContent)) {
    throw new Error('未找到匹配的二维码解析规则，请先到设置中配置规则');
  }

  return {
    model: normalizedContent,
    quantity: '',
    rawContent: normalizedContent,
    ruleName: '原始内容',
    traceNo: '',
    version: '',
  };
};

export default function StockQueryScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useSafeRouter();
  const inputRef = useRef<TextInput>(null);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryingRef = useRef(false);
  const [selectedAccount, setSelectedAccount] = useState<ErpAccountConfig>(ERP_ACCOUNTS[0]);
  const [inputValue, setInputValue] = useState('');
  const [querying, setQuerying] = useState(false);
  const [lastQuery, setLastQuery] = useState<LastQuery | null>(null);
  const [stockRows, setStockRows] = useState<CurrentStockRow[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const selectedAccountAvailable = isErpAccountAvailable(selectedAccount);

  const focusScannerInput = useCallback((delay = 80) => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, delay);
  }, []);

  useFocusEffect(
    useCallback(() => {
      focusScannerInput(120);
    }, [focusScannerInput])
  );

  useEffect(
    () => () => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    },
    []
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
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }

      const rawContent = sanitizeStructuredScannerInput(nextInput ?? inputValue);
      if (!rawContent || queryingRef.current) {
        return;
      }

      if (!selectedAccountAvailable) {
        setLastQuery(null);
        setStockRows([]);
        setInputValue('');
        setErrorMessage(`${getAccountLabel(selectedAccount)}账套暂未开放，暂不能查询库存`);
        focusScannerInput(120);
        return;
      }

      queryingRef.current = true;
      setQuerying(true);
      setErrorMessage('');
      setLastQuery(null);
      setStockRows([]);

      try {
        await initDatabase();
        const parsed = await parseStockScan(rawContent);
        const model = parsed.model.trim();

        if (!model) {
          throw new Error('未识别到型号');
        }

        const inventoryCode =
          (await getInventoryCodeByModel(model, parsed.version)) ||
          (looksLikeInventoryCode(model) ? model : '');

        if (!inventoryCode) {
          throw new Error(
            `未找到物料绑定：${model}${parsed.version ? ` / ${parsed.version}` : ''}`
          );
        }

        const result = await fetchCurrentStockByInventoryCode(selectedAccount, inventoryCode);
        setLastQuery({
          inventoryCode:
            result.rows.find((row) => row.inventoryCode)?.inventoryCode || result.inventoryCode,
          specification: result.rows.find((row) => row.specification)?.specification || '-',
        });
        setStockRows(result.rows);
        setInputValue('');
      } catch (error) {
        logger.error('[库存查询] 查询失败:', error);
        setErrorMessage(formatUserFacingErrorMessage(error, '库存查询失败，请稍后重试'));
        setLastQuery(null);
        setStockRows([]);
      } finally {
        queryingRef.current = false;
        setQuerying(false);
        focusScannerInput(120);
      }
    },
    [focusScannerInput, inputValue, selectedAccount, selectedAccountAvailable]
  );

  const handleInputChange = useCallback(
    (text: string) => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }

      setInputValue(text);

      const nextContent = sanitizeStructuredScannerInput(text);
      if (
        !nextContent ||
        queryingRef.current ||
        nextContent.length < STOCK_QUERY_MIN_AUTO_SUBMIT_LENGTH
      ) {
        return;
      }

      autoSubmitTimerRef.current = setTimeout(() => {
        autoSubmitTimerRef.current = null;
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
            if (autoSubmitTimerRef.current) {
              clearTimeout(autoSubmitTimerRef.current);
              autoSubmitTimerRef.current = null;
            }

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
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.7}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="返回"
            >
              <Feather name="arrow-left" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>库存查询</Text>
            <TouchableOpacity
              style={styles.headerMenuButton}
              activeOpacity={0.7}
              onPress={() => focusScannerInput(0)}
              accessibilityRole="button"
              accessibilityLabel="聚焦库存查询输入框"
            >
              <Feather name="crosshair" size={20} color={theme.textPrimary} />
            </TouchableOpacity>
          </View>

          <UiWorkflowSummary items={workflowSummaryItems} />
        </View>

        <View style={styles.accountPanel}>{ERP_ACCOUNTS.map(renderAccountButton)}</View>

        <UiScanBox
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
          onBlur={() => focusScannerInput(120)}
          placeholder={
            querying
              ? '正在查询ERP库存...'
              : selectedAccountAvailable
                ? '扫描物料标签 / 输入存货编码'
                : `${getAccountLabel(selectedAccount)}账套暂未开放`
          }
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoFocus={false}
          editable={selectedAccountAvailable}
          showSoftInputOnFocus={false}
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
                stockRows.length === 0 ? styles.listEmptyContent : styles.listContent
              }
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={Platform.OS === 'android'}
              ListEmptyComponent={
                <AppEmptyState
                  icon="search"
                  title={lastQuery ? 'ERP未返回库存' : '等待查询'}
                  description={lastQuery ? '请确认账套和物料绑定是否正确' : '扫描物料标签后显示现存量'}
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
