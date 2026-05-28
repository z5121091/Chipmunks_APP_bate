import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Modal,
  Linking,
  Switch,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { KeyboardAwareFormScrollView } from '@/components/KeyboardAwareForm';
import * as Updates from 'expo-updates'; // 添加重启功能
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import * as MediaLibrary from 'expo-media-library';
import { logger } from '@/utils/logger';
import {
  getAllUnpackRecords,
  getAllInboundRecords,
  getAllInventoryCheckRecords,
  getInboundExportSummaryRows,
  getInventoryCheckExportSummaryRows,
  getOutboundExportRows,
  exportBackupData,
  importBackupData,
  getConfigStats,
  incrementExportCount,
  exportDatabaseFile,
  importDatabaseFile,
  BackupData,
  isBackupDataShape,
  STORAGE_KEYS,
} from '@/utils/database';
import { formatTime, formatDate, formatDateTimeExport } from '@/utils/time';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AppModalActions } from '@/components/AppModalActions';
import { AppModalCard } from '@/components/AppModalCard';
import { createStyles } from './styles';
import { AnimatedCard } from '@/components/AnimatedCard';
import { AnimatedButton } from '@/components/AnimatedButton';
import { getSpacing, Spacing } from '@/constants/theme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { useCustomAlert } from '@/components/CustomAlert';
import { rs } from '@/utils/responsive';
import { APP_VERSION, APP_NAME, COMPANY_NAME, COMPANY_WEBSITE, AUTHOR } from '@/constants/version';
import {
  setSoundEnabled as setSoundEnabledFn,
  initSoundSetting,
} from '@/utils/feedback';
import { formatSyncErrorMessage, syncExcelToComputer } from '@/utils/excel';
import { buildInventorySheets } from '@/utils/inventoryExport';
import { safeJsonParseNullable } from '@/utils/json';
import { testConnection } from '@/utils/heartbeat';
import { UPDATE_CONFIG, NETWORK_CONFIG, SyncConfig, ConnectionStatus } from '@/constants/config';
import { parseAuthFromUrl, base64Encode, compareVersions } from '@/utils/update';
import { parseQuantity } from '@/utils/quantity';
import { useToast } from '@/utils/toast';
import { scanQueue } from '@/utils/scanQueue';

// 使用 any 绕过类型检查
const FileSystem = FileSystemLegacy as any;

const isSyncConfig = (value: unknown): value is SyncConfig => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SyncConfig).ip === 'string' &&
    typeof (value as SyncConfig).port === 'string'
  );
};

// 更新服务器配置（完整 URL，包含认证信息和 AppUpdate 路径）
const DEFAULT_UPDATE_SERVER = UPDATE_CONFIG.DEFAULT_SERVER;
const UPDATE_RETRY_DELAYS = [1000, 2000, 4000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getUpdateRequestErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return '请求超时';
    }

    if (error.message.includes('Network request failed')) {
      return '网络请求失败';
    }

    return error.message || '未知错误';
  }

  return String(error || '未知错误');
};

const withUpdateCacheBuster = (url: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
};

const getNextDatedFileName = async (
  directory: string | null | undefined,
  prefix: string,
  dateStr: string,
  extension: string
): Promise<string> => {
  const fallbackSequence = '01';

  if (!directory) {
    return `${prefix}_${dateStr}_${fallbackSequence}.${extension}`;
  }

  try {
    const files = await FileSystem.readDirectoryAsync(directory);
    const sequencePrefix = `${prefix}_${dateStr}_`;
    const sequenceSuffix = `.${extension}`;
    const maxSequence = files.reduce((max: number, fileName: string) => {
      if (!fileName.startsWith(sequencePrefix) || !fileName.endsWith(sequenceSuffix)) {
        return max;
      }

      const sequenceText = fileName.slice(sequencePrefix.length, -sequenceSuffix.length);
      const sequence = Number(sequenceText);
      return Number.isInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
    const nextSequence = String(maxSequence + 1).padStart(2, '0');
    return `${prefix}_${dateStr}_${nextSequence}.${extension}`;
  } catch (error) {
    logger.warn('读取备份目录失败，使用默认序号:', error);
    return `${prefix}_${dateStr}_${fallbackSequence}.${extension}`;
  }
};

export default function SettingsScreen() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const { ToastContainer } = useToast();

  // 使用 useWindowDimensions 替代 Dimensions.addEventListener，
  // 避免键盘弹出/收起时触发不必要的重渲染和样式重建导致滚动卡顿
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    // 延迟初始化声音设置，避免阻塞页面渲染
    const timer = setTimeout(() => {
      initSoundSetting();
    }, 100); // 延迟 100ms，先完成页面渲染

    return () => {
      clearTimeout(timer); // 清理定时器
    };
  }, []);

  // 根据屏幕尺寸动态创建样式
  // 注意：insets 不放入依赖数组，避免键盘弹出/收起时触发不必要的样式重建
  const styles = useMemo(
    () => createStyles(theme, screenWidth, screenHeight, undefined),
    [theme, screenWidth, screenHeight]
  );

  // 配置统计
  const [configStats, setConfigStats] = useState({
    rules: 0,
    customFields: 0,
  });
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [dbBackupLoading, setDbBackupLoading] = useState(false);
  const [dbRestoreLoading, setDbRestoreLoading] = useState(false);

  // 数据库恢复后的重启提示弹窗
  const [showRestartModal, setShowRestartModal] = useState(false);

  // 电脑同步配置
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({ ip: '', port: '8080' });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');

  // 声音开关
  const [soundEnabled, setSoundEnabled] = useState(true);

  // 各数据类型的同步状态
  const [syncingInbound, setSyncingInbound] = useState(false);
  const [syncingOutbound, setSyncingOutbound] = useState(false);
  const [syncingInventory, setSyncingInventory] = useState(false);
  const syncingInboundRef = useRef(false);
  const syncingOutboundRef = useRef(false);
  const syncingInventoryRef = useRef(false);
  const syncingInventoryPartialRef = useRef(false);
  const [syncingLabels, setSyncingLabels] = useState(false);

  // 在线更新相关状态
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    downloadUrl: string;
    changelog: string;
    forceUpdate: boolean;
  } | null>(null);

  // 心跳检测相关
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureCountRef = useRef<number>(0);
  const scrollingRef = useRef(false); // 滚动中标记，避免滚动时心跳触发重渲染

  // 加载数据
  const loadData = useCallback(async () => {
    const [
      stats,
      savedSyncConfig,
      savedConnectionStatus,
      savedSoundEnabled,
    ] = await Promise.all([
      getConfigStats(),
      AsyncStorage.getItem(STORAGE_KEYS.SYNC_CONFIG),
      AsyncStorage.getItem(STORAGE_KEYS.CONNECTION_STATUS),
      AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED),
    ]);
    setConfigStats(stats);

    // 加载声音开关状态，默认为 true
    if (savedSoundEnabled !== null) {
      setSoundEnabled(savedSoundEnabled === 'true');
    }

    if (savedSyncConfig) {
      const config = safeJsonParseNullable<SyncConfig>(
        savedSyncConfig,
        'settings.syncConfig',
        isSyncConfig
      );
      if (!config) {
        setConnectionStatus('idle');
        return;
      }
      setSyncConfig(config);

      // 页面恢复时复测一次，避免电脑端同步助手已经退出但手机仍显示“已连接”。
      if (
        config.ip &&
        (savedConnectionStatus === 'success' || savedConnectionStatus === 'testing')
      ) {
        setConnectionStatus('testing');
        void testConnection(config)
          .then(async (success) => {
            const status: ConnectionStatus = success ? 'success' : 'disconnected';
            setConnectionStatus(status);
            await AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, status);
          })
          .catch(async () => {
            setConnectionStatus('disconnected');
            await AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, 'disconnected');
          });
      } else if (savedConnectionStatus === 'disconnected') {
        setConnectionStatus('disconnected');
      } else if (savedConnectionStatus === 'error') {
        setConnectionStatus('error');
      } else {
        setConnectionStatus('idle');
      }
    }
  }, []);

  // 切换声音开关
  const toggleSound = useCallback(async (value: boolean) => {
    setSoundEnabled(value);
    setSoundEnabledFn(value);
    await AsyncStorage.setItem(STORAGE_KEYS.SOUND_ENABLED, String(value));
  }, []);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        loadData();
      });
      return () => task.cancel();
    }, [loadData])
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    failureCountRef.current = 0;
    const targetUrl = `http://${syncConfig.ip}:${syncConfig.port || NETWORK_CONFIG.DEFAULT_PORT}/health`;

    const runHeartbeatCheck = async () => {
      // 滚动中标记，避免滚动时心跳触发重渲染 setState ????
      if (scrollingRef.current) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NETWORK_CONFIG.HEARTBEAT_TIMEOUT);

      try {
        const response = await fetch(targetUrl, { signal: controller.signal });

        if (response.ok) {
          failureCountRef.current = 0;
        } else {
          failureCountRef.current++;
        }
      } catch {
        failureCountRef.current++;
      } finally {
        clearTimeout(timeoutId);
      }

      if (failureCountRef.current >= NETWORK_CONFIG.MAX_FAILURE_COUNT) {
        setConnectionStatus('disconnected');
        await AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, 'disconnected');
        stopHeartbeat();
      }
    };

    void runHeartbeatCheck();
    heartbeatTimerRef.current = setInterval(runHeartbeatCheck, NETWORK_CONFIG.HEARTBEAT_INTERVAL);
  }, [stopHeartbeat, syncConfig.ip, syncConfig.port]);

  // 心跳检测
  useEffect(() => {
    if (connectionStatus === 'success' && syncConfig.ip) {
      startHeartbeat();
    }
    return () => stopHeartbeat();
  }, [connectionStatus, startHeartbeat, stopHeartbeat, syncConfig.ip]);

  // IP变更
  const handleIpChange = (text: string) => {
    setSyncConfig((prev) => ({ ...prev, ip: text }));
    setConnectionStatus('idle');
  };

  // 端口变更
  const handlePortChange = (text: string) => {
    setSyncConfig((prev) => ({ ...prev, port: text }));
    setConnectionStatus('idle');
  };

  // 测试连接
  const handleTestConnection = async () => {
    if (!syncConfig.ip) {
      alert.showWarning('请输入服务器地址');
      return;
    }

    setConnectionStatus('testing');
    const success = await testConnection(syncConfig);
    const status: ConnectionStatus = success ? 'success' : 'error';
    setConnectionStatus(status);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(syncConfig)),
      AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, status),
    ]);
  };

  // 生成 Excel 并同步到电脑（支持多Sheet）
  const syncToComputerMultiSheet = async (
    sheets: Array<{
      name: string;
      headers: string[];
      rows: any[][];
    }>,
    endpoint: string,
    setLoading: (loading: boolean) => void,
    nameSuffix?: string
  ) => {
    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    if (totalRows === 0) {
      alert.showWarning('暂无数据可同步');
      return;
    }

    setLoading(true);
    try {
      const result = await syncExcelToComputer(
        sheets,
        endpoint,
        syncConfig,
        nameSuffix,
        (fileName) =>
          alert.showSuccess(fileName ? `已同步到电脑\n文件：${fileName}` : '已同步到电脑'),
        undefined
      );

      if (!result.success && result.message) {
        if (result.message.includes('暂无数据可同步')) {
          alert.showWarning(result.message);
          return;
        }

        setConnectionStatus('disconnected');
        await AsyncStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, 'disconnected');
        alert.showError(formatSyncErrorMessage(result.message));
      }
    } catch (error: any) {
      alert.showError(`同步失败：${formatSyncErrorMessage(error.message, '请检查服务是否运行')}`);
    } finally {
      setLoading(false);
    }
  };

  // 同步入库单（包含所有扩展字段）
  const handleSyncInbound = async () => {
    if (syncingInboundRef.current) {
      return;
    }

    syncingInboundRef.current = true;
    setSyncingInbound(true);
    try {
      const records = await getAllInboundRecords();

      if (records.length === 0) {
        alert.showWarning('暂无数据可同步');
        return;
      }

      // 获取当天的导出序号（按天递增）
      const todayCount = await incrementExportCount('inbound');
      const seqNo = String(todayCount).padStart(2, '0');

      // 入库明细表
      const detailHeaders = [
        '入库单号',
        '仓库名称',
        '存货编码',
        '扫描型号',
        '批次',
        '数量',
        '版本号',
        '封装',
        '生产日期',
        '追溯码',
        '箱号',
        '入库日期',
        '备注',
        '创建时间',
      ];

      const detailRows = records.map((r) => [
        r.inbound_no || '',
        r.warehouse_name || '',
        r.inventory_code || '',
        r.scan_model || '',
        r.batch || '',
        r.quantity || 0,
        r.version || '',
        r.package || '',
        r.productionDate || '',
        r.traceNo || '',
        r.sourceNo || '',
        r.in_date || '',
        r.notes || '',
        formatDateTimeExport(r.created_at),
      ]);

      const summaryHeaders = ['仓库名称', '存货编码', '扫描型号', '版本号', '封装', '合计数量', '入库日期'];
      const summaryRows = (await getInboundExportSummaryRows()).map((s) => [
        s.warehouse_name,
        s.inventory_code,
        s.scan_model,
        s.version,
        s.package,
        s.total_quantity,
        s.in_date,
      ]);

      // 获取唯一仓库名称列表，文件名加入序号
      const warehouses = [...new Set(records.map((r) => r.warehouse_name).filter(Boolean))];
      const warehouseSuffix =
        warehouses.length === 1 ? warehouses[0] : warehouses.length > 1 ? '多仓库' : '';
      const nameSuffix = warehouseSuffix ? `${warehouseSuffix}_${seqNo}` : seqNo;

      await syncToComputerMultiSheet(
        [
          { name: '入库明细', headers: detailHeaders, rows: detailRows },
          { name: '型号汇总', headers: summaryHeaders, rows: summaryRows },
        ],
        '/inbound',
        setSyncingInbound,
        nameSuffix
      );
    } catch (error: any) {
      alert.showError(`同步失败：${formatSyncErrorMessage(error.message, '请检查服务是否运行')}`);
    } finally {
      syncingInboundRef.current = false;
      setSyncingInbound(false);
    }
  };

  // 同步出库单（扫码出库的物料信息）
  const handleSyncOutbound = async () => {
    if (syncingOutboundRef.current) {
      return;
    }

    syncingOutboundRef.current = true;
    setSyncingOutbound(true);
    try {
      const outboundQueueStats = await scanQueue.flushPendingWrites({
        timeoutMs: 15000,
        retryFailed: true,
      });
      if (outboundQueueStats.failed > 0) {
        alert.showError(`仍有 ${outboundQueueStats.failed} 条出库扫码记录写入失败，请回到扫码出库页确认后再同步`);
        return;
      }

      const records = await getOutboundExportRows();

      if (records.length === 0) {
        alert.showWarning('暂无出库数据可同步');
        return;
      }

      // 获取当天的导出序号（按天递增）
      const todayCount = await incrementExportCount('outbound');
      const seqNo = String(todayCount).padStart(2, '0');

      // 调整列顺序：生产日期放在封装后面（与入库单一致）
      const headers = [
        '订单号',
        '客户',
        '仓库名称',
        '存货编码',
        '型号',
        '批次',
        '封装',
        '生产日期',
        '版本',
        '数量',
        '追踪码',
        '箱号',
        '扫描日期',
        '扫描时间',
      ];

      const rows = records.map((r) => [
        r.order_no || '',
        r.customer_name || '',
        r.warehouse_name || '',
        r.inventory_code || '',
        r.model || '',
        r.batch || '',
        r.package || '',
        r.productionDate || '',
        r.version || '',
        parseQuantity(r.quantity, { min: 0 }) ?? 0,
        r.traceNo || '',
        r.sourceNo || '',
        formatDate(r.scanned_at),
        formatTime(r.scanned_at),
      ]);

      // 获取唯一仓库名称列表，文件名加入序号
      const warehouses = [...new Set(records.map((r) => r.warehouse_name).filter(Boolean))];
      const warehouseSuffix =
        warehouses.length === 1 ? warehouses[0] : warehouses.length > 1 ? '多仓库' : '';
      const nameSuffix = warehouseSuffix ? `${warehouseSuffix}_${seqNo}` : seqNo;

      await syncToComputerMultiSheet(
        [{ name: '出库明细', headers, rows }],
        '/outbound',
        setSyncingOutbound,
        nameSuffix
      );
    } catch (error: any) {
      alert.showError(`同步失败：${formatSyncErrorMessage(error.message, '请检查服务是否运行')}`);
    } finally {
      syncingOutboundRef.current = false;
      setSyncingOutbound(false);
    }
  };

  // 同步盘点单
  const handleSyncInventory = async () => {
    if (syncingInventoryRef.current) {
      return;
    }

    syncingInventoryRef.current = true;
    setSyncingInventory(true);
    try {
      const records = await getAllInventoryCheckRecords();

      if (records.length === 0) {
        alert.showWarning('暂无盘点数据可同步');
        return;
      }

      // 获取当天的导出序号（按天递增）
      const todayCount = await incrementExportCount('inventory');
      const seqNo = String(todayCount).padStart(2, '0');

      const sheets = buildInventorySheets(records);
      const inventorySummaryRows = (await getInventoryCheckExportSummaryRows()).map((s) => [
        s.warehouse_name,
        s.inventory_code,
        s.scan_model,
        s.version,
        s.package,
        s.total_quantity,
        s.check_date,
      ]);

      if (sheets[1]) {
        sheets[1] = {
          ...sheets[1],
          rows: inventorySummaryRows,
        };
      }

      // 获取唯一仓库名称列表，文件名加入序号
      const warehouses = [...new Set(records.map((r) => r.warehouse_name).filter(Boolean))];
      const warehouseSuffix =
        warehouses.length === 1 ? warehouses[0] : warehouses.length > 1 ? '多仓库' : '';
      const nameSuffix = warehouseSuffix ? `${warehouseSuffix}_${seqNo}` : seqNo;

      await syncToComputerMultiSheet(
        sheets,
        '/inventory',
        setSyncingInventory,
        nameSuffix
      );
      // 型号汇总：整包+拆包整合，按型号+版本+仓库+盘点日期汇总
      // 整包用原数量，拆包用实际数量，相同型号版本合并
      logger.log('盘点导出完成', {
        detailCount: sheets[0]?.rows.length || 0,
        summaryCount: sheets[1]?.rows.length || 0,
      });
    } catch (error: any) {
      alert.showError(`同步失败：${formatSyncErrorMessage(error.message, '请检查服务是否运行')}`);
    } finally {
      syncingInventoryRef.current = false;
      setSyncingInventory(false);
    }
  };

  // 导出盘点拆包标签
  const [syncingInventoryPartial, setSyncingInventoryPartial] = useState(false);
  const handleSyncInventoryPartial = async () => {
    if (syncingInventoryPartialRef.current) {
      return;
    }

    syncingInventoryPartialRef.current = true;
    setSyncingInventoryPartial(true);

    // 只获取拆包类型的盘点记录，避免先全量读取再在 JS 里过滤。
    try {
      const records = await getAllInventoryCheckRecords(undefined, 'partial');

      if (records.length === 0) {
        alert.showWarning('暂无盘点拆包记录');
        return;
      }

      const headers = [
        '盘点单号',
        '仓库名称',
        '存货编码',
        '扫描型号',
        '批次',
        '封装',
        '版本',
        '实际数量',
        '生产日期',
        '追踪码',
        '箱号',
        '盘点日期',
        '创建时间',
      ];

      const rows = records.map((r) => [
        r.check_no || '',
        r.warehouse_name || '',
        r.inventory_code || '',
        r.scan_model || '',
        r.batch || '',
        r.package || '',
        r.version || '',
        r.actual_quantity || '',
        r.productionDate || '',
        r.traceNo || '',
        r.sourceNo || '',
        r.check_date || '',
        formatDateTimeExport(r.created_at),
      ]);

      await syncToComputerMultiSheet(
        [{ name: '拆包标签', headers, rows }],
        '/inventory',
        setSyncingInventoryPartial,
        '拆包标签'
      );
    } catch (error: any) {
      alert.showError(`导出失败: ${error.message || '请检查服务是否运行'}`);
    } finally {
      syncingInventoryPartialRef.current = false;
      setSyncingInventoryPartial(false);
    }
  };

  // 同步标签数据（原有拆包记录）
  const handleSyncLabels = async () => {
    const records = await getAllUnpackRecords();

    if (records.length === 0) {
      alert.showWarning('暂无订单标签可同步');
      return;
    }

    const headers = [
      '仓库名称',
      '标签类型',
      '订单号',
      '客户',
      '型号',
      '存货编码',
      '批次',
      '封装',
      '版本',
      '原数量',
      '标签数量',
      '生产日期',
      '追踪码',
      '箱号',
      '拆包时间',
      '备注',
    ];

    const rows = records.map((r) => [
      r.warehouse_name || '',
      r.label_type === 'shipped' ? '发货标签' : '剩余标签',
      r.order_no || '',
      r.customer_name || '',
      r.model || '',
      r.inventory_code || '',
      r.batch || '',
      r.package || '',
      r.version || '',
      parseQuantity(r.original_quantity, { min: 0 }) ?? 0,
      parseQuantity(r.new_quantity, { min: 0 }) ?? 0,
      r.productionDate || '',
      r.label_type === 'shipped' ? r.new_traceNo || r.traceNo || '' : r.traceNo || '',
      r.sourceNo || '',
      formatTime(r.unpacked_at),
      r.notes || '',
    ]);

    await syncToComputerMultiSheet(
      [{ name: '标签明细', headers, rows }],
      '/labels',
      setSyncingLabels
    );
  };

  // ==================== 在线更新功能 ====================

  // 检查更新
  const checkForUpdate = async () => {
    if (checkingUpdate) return;

    setCheckingUpdate(true);
    setDownloadProgress(0);
    try {
      const baseUrl = DEFAULT_UPDATE_SERVER.trim().replace(/\/+$/, '');

      // 解析URL中的认证信息
      const authInfo = parseAuthFromUrl(baseUrl);
      const requestBaseUrl = (authInfo?.baseUrl || baseUrl).replace(/\/+$/, '');
      const versionUrl = `${requestBaseUrl}/version.json`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };

      // 如果URL包含认证信息，添加Authorization头
      if (authInfo) {
        const authString = `${authInfo.username}:${authInfo.password}`;
        const authBase64 = base64Encode(authString);
        headers['Authorization'] = `Basic ${authBase64}`;
      }

      let response: Response | null = null;
      let lastErrorMessage = '';

      // 覆盖安装或首次安装后，Android 网络栈偶尔会在刚启动时短暂失败，多次退避重试避免用户重启手机。
      for (let attempt = 0; attempt < UPDATE_RETRY_DELAYS.length; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const requestUrl = withUpdateCacheBuster(versionUrl);

        try {
          response = await fetch(requestUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
          lastErrorMessage = '';
          break;
        } catch (error) {
          lastErrorMessage = getUpdateRequestErrorMessage(error);
          logger.warn(
            `[checkForUpdate] 第 ${attempt + 1} 次请求失败:`,
            lastErrorMessage,
            requestUrl
          );
          if (attempt < UPDATE_RETRY_DELAYS.length - 1) {
            await sleep(UPDATE_RETRY_DELAYS[attempt]);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!response) {
        throw new Error(lastErrorMessage || '更新服务器无响应');
      }

      if (!response.ok) {
        let errorMessage = `无法连接到更新服务器 (${response.status})`;

        if (response.status === 401) {
          errorMessage = '认证失败，请检查服务器地址中的用户名和密码是否正确';
        } else if (response.status === 403) {
          errorMessage = '禁止访问，请检查服务器权限设置';
        } else if (response.status === 404) {
          errorMessage = '更新文件不存在，请检查服务器地址是否正确';
        } else {
          errorMessage = `无法连接到更新服务器 (${response.status})，请检查网络和服务器地址`;
        }

        alert.showError(`${errorMessage}。请检查网络连接后重试。`);
        return;
      }

      const data = await response.json();

      // 比较版本号
      const currentVersion = APP_VERSION.replace(/^V/, '');
      const latestVersion = (data.version || '0.0.0').replace(/^V/, '');

      const isNewVersion = compareVersions(latestVersion, currentVersion) > 0;

      if (isNewVersion) {
        // 处理 changelog：可能是数组（旧格式）或对象数组（新格式）
        let changelogText = '优化用户体验';
        if (Array.isArray(data.changelog)) {
          // 新格式：数组 [{version, date, changes}]
          changelogText =
            data.changelog[0]?.changes
              ?.map((c: { type: string; text: string }) => `${c.text}`)
              .join('\n') || '优化用户体验';
        } else if (typeof data.changelog === 'string') {
          // 旧格式：字符串
          changelogText = data.changelog;
        }
        setUpdateInfo({
          version: data.version || latestVersion,
          downloadUrl: data.downloadUrl || `${requestBaseUrl}/app-release.apk`,
          changelog: changelogText,
          forceUpdate: data.forceUpdate || false,
        });
        setUpdateModalVisible(true);
      } else {
        alert.showSuccess(`当前已是最新版本 (${APP_VERSION})`);
      }
    } catch (error) {
      const errorMessage = getUpdateRequestErrorMessage(error);
      logger.error('检查更新失败:', errorMessage, error);
      alert.showError(`检查更新失败：${errorMessage}。请确认网络可访问更新服务器。`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  // 下载并安装更新
  const downloadAndInstall = async () => {
    if (!updateInfo || downloading) return;

    // Android 平台检查
    if (Platform.OS !== 'android') {
      alert.showError('目前仅支持 Android 系统更新');
      return;
    }

    setDownloading(true);
    setDownloadProgress(0);

    try {
      // 下载目录：使用应用缓存目录
      let apkUri: string;

      if (FileSystem.cacheDirectory) {
        apkUri = FileSystem.cacheDirectory + 'ZhongCangWarehouse_update.apk';
      } else if (FileSystem.documentDirectory) {
        apkUri = FileSystem.documentDirectory + 'ZhongCangWarehouse_update.apk';
      } else {
        alert.showError('无法获取存储目录');
        setDownloading(false);
        return;
      }

      // 清理之前的下载
      await FileSystem.deleteAsync(apkUri, { idempotent: true });

      // 创建下载回调
      const downloadCallback = (downloadProgressData: {
        totalBytesWritten: number;
        totalBytesExpectedToWrite: number;
      }) => {
        const progress =
          downloadProgressData.totalBytesWritten / downloadProgressData.totalBytesExpectedToWrite;
        setDownloadProgress(Math.round(progress * 100));
      };

      // 解析URL中的认证信息
      const downloadUrl = updateInfo.downloadUrl;
      const authInfo = parseAuthFromUrl(downloadUrl);
      const requestDownloadUrl = authInfo?.baseUrl || downloadUrl;
      const downloadHeaders: Record<string, string> = {};

      if (authInfo) {
        const authString = `${authInfo.username}:${authInfo.password}`;
        const authBase64 = base64Encode(authString);
        downloadHeaders['Authorization'] = `Basic ${authBase64}`;
      }

      // 开始下载
      const downloadResumable = FileSystem.createDownloadResumable(
        requestDownloadUrl,
        apkUri,
        { headers: downloadHeaders },
        downloadCallback
      );

      const result = await downloadResumable.downloadAsync();

      if (result && result.uri && result.status >= 200 && result.status < 300) {
        const apkInfo = await FileSystem.getInfoAsync(result.uri);
        if (!apkInfo.exists || !('size' in apkInfo) || (apkInfo as { size?: number }).size === 0) {
          alert.showError('安装包下载失败：文件为空，请检查更新服务器');
          setDownloading(false);
          return;
        }

        // 下载完成
        setDownloadProgress(100);

        const installUri =
          typeof FileSystem.getContentUriAsync === 'function'
            ? await FileSystem.getContentUriAsync(result.uri)
            : result.uri;

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: installUri,
          type: 'application/vnd.android.package-archive',
          flags: 1,
        });

        alert.showSuccess('安装程序已打开，请按提示完成更新');

        setDownloading(false);
      } else {
        const statusText = result?.status ? `（${result.status}）` : '';
        alert.showError(`安装包下载失败${statusText}，请检查更新服务器地址或账号密码`);
        setDownloading(false);
      }
    } catch (error) {
      logger.error('下载失败:', error);
      const message = error instanceof Error ? error.message : String(error || '');
      const installHint = message
        ? `\n原因：${message}`
        : '';
      alert.showError(
        `安装程序打开失败，请确认已允许本应用安装未知来源应用${installHint}`
      );
      setDownloading(false);
    }
  };

  // 数据备份
  const handleBackup = async () => {
    if (backupLoading) return;

    setBackupLoading(true);
    try {
      const backupData = await exportBackupData();
      const backupJson = JSON.stringify(backupData, null, 2);

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const fileName = await getNextDatedFileName(
        FileSystem.cacheDirectory,
        '掌上仓库备份',
        dateStr,
        'json'
      );

      const filePath = `${FileSystem.cacheDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(filePath, backupJson, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // 检测 Android 版本（API 26 = Android 8.0）
      const isAndroid8OrAbove = Platform.OS === 'android' && Platform.Version >= 26;

      if (isAndroid8OrAbove) {
        // Android 8.0+：直接使用 Sharing 分享
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(filePath, {
            mimeType: 'application/json',
            dialogTitle: '保存配置备份',
            UTI: 'public.json',
          });
          alert.showSuccess(
            `已备份配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 自定义字段: ${backupData.customFields?.length || 0} 个\n• 物料绑定: ${backupData.inventoryBindings?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}\n\n请妥善保管备份文件！`
          );
        }
      } else {
        // Android 7.0 及以下：保存到 Downloads 文件夹
        try {
          // 请求媒体库权限
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status !== 'granted') {
            alert.showError('需要存储权限才能保存备份');
            // 备选方案：使用 Sharing
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(filePath, {
                mimeType: 'application/json',
                dialogTitle: '保存配置备份',
                UTI: 'public.json',
              });
            }
            return;
          }

          // 将文件保存到媒体库
          const asset = await MediaLibrary.createAssetAsync(filePath);

          // 获取 Downloads 相册
          try {
            const albums = await MediaLibrary.getAlbumsAsync();
            let downloadAlbum = albums.find(
              (album: any) => album.title === 'Download' || album.title === 'Downloads'
            );

            if (!downloadAlbum) {
              downloadAlbum = await MediaLibrary.createAlbumAsync('Downloads', asset, false);
            } else {
              await MediaLibrary.addAssetsToAlbumAsync([asset], downloadAlbum.id, false);
            }
          } catch (albumError) {
            logger.warn('保存到媒体库失败，继续保留 Downloads 目录文件:', albumError);
          }

          // 尝试打开 Downloads 文件夹
          try {
            await Linking.openURL('content://downloads/all_downloads');
          } catch {
            try {
              await Linking.openURL(
                'content://com.android.providers.downloads.documents/root/downloads'
              );
            } catch {
              // 都打不开就算了
            }
          }

          alert.showSuccess(
            `备份已保存到 Downloads 文件夹:\n${fileName}\n\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 自定义字段: ${backupData.customFields?.length || 0} 个\n• 物料绑定: ${backupData.inventoryBindings?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}`
          );
        } catch (mediaError) {
          logger.error('保存到Downloads失败:', mediaError);

          // 备选方案：使用 Sharing
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(filePath, {
              mimeType: 'application/json',
              dialogTitle: '保存配置备份',
              UTI: 'public.json',
            });
            alert.showSuccess(
              `已备份配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 自定义字段: ${backupData.customFields?.length || 0} 个\n• 物料绑定: ${backupData.inventoryBindings?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}`
            );
          } else {
            alert.showError('备份失败，请重试');
          }
        }
      }
    } catch (error) {
      logger.error('备份失败:', error);
      alert.showError('请重试');
    } finally {
      setBackupLoading(false);
    }
  };

  // 数据恢复
  const handleRestore = async () => {
    if (restoreLoading) return;

    try {
      // Android 7.0 及以下不支持 application/json 类型，使用 */* 替代
      const isAndroid7OrBelow =
        Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version <= 24;
      const documentType = isAndroid7OrBelow ? '*/*' : 'application/json';

      const result = await DocumentPicker.getDocumentAsync({
        type: documentType,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const fileUri = result.assets[0].uri;

      // 如果选择的是所有文件，需要检查扩展名
      if (isAndroid7OrBelow && !fileUri.toLowerCase().endsWith('.json')) {
        alert.showWarning('请选择 .json 格式的备份文件');
        return;
      }

      const fileContent = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let backupData: BackupData;
      const parsedBackupData = safeJsonParseNullable<BackupData>(
        fileContent,
        'settings.backupFile',
        isBackupDataShape
      );

      if (!parsedBackupData) {
        alert.showError('无效的备份文件格式');
        return;
      }
      backupData = parsedBackupData;

      alert.showConfirm(
        '确认恢复配置',
        `备份时间: ${formatDateTimeExport(backupData.backupTime)}\n\n即将恢复以下配置:\n• 解析规则: ${backupData.rules?.length || 0} 条\n• 自定义字段: ${backupData.customFields?.length || 0} 个\n• 物料绑定: ${backupData.inventoryBindings?.length || 0} 条\n• 仓库: ${backupData.warehouses?.length || 0} 个\n• 同步服务器: ${backupData.syncConfig ? backupData.syncConfig.ip : '未配置'}\n\n[注意] 恢复前会清空当前所有配置数据（规则、字段、绑定、仓库等），业务数据（订单、物料、拆包记录等）不受影响！此操作不可撤销！`,
        async () => {
          setRestoreLoading(true);
          try {
            const result = await importBackupData(backupData);
            if (result.success) {
              const syncConfigStatus = !result.stats?.hasSyncConfig
                ? '未配置'
                : result.stats?.syncConfigRestored
                  ? '已恢复'
                  : '恢复失败';
              const summary =
                `备份时间: ${formatDateTimeExport(backupData.backupTime)}\n\n恢复成功:\n• 解析规则: ${result.stats?.rules || 0} 条\n• 自定义字段: ${result.stats?.customFields || 0} 个\n• 物料绑定: ${result.stats?.inventoryBindings || 0} 条\n• 仓库: ${result.stats?.warehouses || 0} 个\n• 同步服务器: ${syncConfigStatus}`;

              if (result.warnings?.length) {
                alert.showWarning(`${summary}\n\n注意:\n• ${result.warnings.join('\n• ')}`);
              } else {
                alert.showSuccess(summary);
              }
              loadData();
            } else {
              alert.showError(result.message);
            }
          } catch (error) {
            logger.error('恢复失败:', error);
            alert.showError('请重试');
          } finally {
            setRestoreLoading(false);
          }
        },
        true
      );
    } catch (error) {
      logger.error('选择文件失败:', error);
      alert.showError('无法读取备份文件');
    }
  };

  // 处理数据库文件备份
  const handleDatabaseBackup = async () => {
    // Web 平台不支持数据库文件备份
    if (Platform.OS === 'web') {
      alert.showError('Web 平台不支持数据库文件备份，请在 Android 设备上使用此功能');
      return;
    }

    alert.showConfirm(
      '备份数据库文件',
      '即将备份完整的数据库文件（.db），包含所有数据：\n\n• 配置数据：规则、字段、绑定、仓库\n• 业务数据：订单、物料、拆包记录',
      async () => {
        setDbBackupLoading(true);
        try {
          const outboundQueueStats = await scanQueue.flushPendingWrites({
            timeoutMs: 15000,
            retryFailed: true,
          });
          if (outboundQueueStats.failed > 0) {
            alert.showError(`仍有 ${outboundQueueStats.failed} 条出库扫码记录写入失败，请回到扫码出库页确认后再备份`);
            return;
          }

          const result = await exportDatabaseFile();
          if (result.success && result.filePath) {
            // 使用 expo-sharing 分享文件
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(result.filePath, {
                mimeType: 'application/x-sqlite3',
                dialogTitle: '保存数据库备份',
              });
            } else {
              alert.showError('您的设备不支持文件分享');
            }
            alert.showSuccess('数据库文件备份成功');
          } else {
            alert.showError(result.message);
          }
        } catch (error) {
          logger.error('数据库备份失败:', error);
          alert.showError('备份失败，请重试');
        } finally {
          setDbBackupLoading(false);
        }
      },
      false
    );
  };

  // 处理数据库文件恢复
  const handleDatabaseRestore = async () => {
    // Web 平台不支持数据库文件恢复
    if (Platform.OS === 'web') {
      alert.showError('Web 平台不支持数据库文件恢复，请在 Android 设备上使用此功能');
      return;
    }

    alert.showAlert(
      '恢复数据库文件',
      '[严重警告] 即将从备份文件恢复数据库！\n\n此操作将：\n• 替换当前所有数据（配置 + 业务）\n• 恢复为备份时的完整状态\n\n恢复前会自动创建当前数据库的备份文件。此操作不可撤销！',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '导入',
          style: 'default',
          onPress: async () => {
            setDbRestoreLoading(true);
            try {
              const result = await importDatabaseFile();
              if (result.success) {
                // 检查是否需要重启应用
                if (result.needRestart) {
                  setShowRestartModal(true);
                } else {
                  alert.showSuccess(
                    `数据库文件恢复成功！\n\n恢复后的数据统计：\n• 订单: ${result.stats?.orders || 0} 条\n• 物料: ${result.stats?.materials || 0} 条\n• 规则: ${result.stats?.rules || 0} 条\n• 仓库: ${result.stats?.warehouses || 0} 个`
                  );
                  loadData();
                }
              } else {
                alert.showError(result.message);
              }
            } catch (error) {
              logger.error('数据库恢复失败:', error);
              alert.showError('恢复失败，请重试');
            } finally {
              setDbRestoreLoading(false);
            }
          },
        },
      ],
      'error'
    );
  };

  // 是否可以同步
  const canSync = syncConfig.ip && connectionStatus === 'success';
  const syncTarget = syncConfig.ip
    ? `${syncConfig.ip}:${syncConfig.port || NETWORK_CONFIG.DEFAULT_PORT}`
    : '未配置';
  const syncAssistantStatus = useMemo(() => {
    if (connectionStatus === 'success') {
      return {
        title: '同步助手已连接',
        desc: `电脑端 ${syncTarget} 可接收 Excel 文件`,
        color: theme.success,
        icon: 'check-circle' as keyof typeof Feather.glyphMap,
      };
    }

    if (connectionStatus === 'testing') {
      return {
        title: '正在连接同步助手',
        desc: `正在检测 ${syncTarget}`,
        color: theme.primary,
        icon: 'loader' as keyof typeof Feather.glyphMap,
      };
    }

    if (connectionStatus === 'error' || connectionStatus === 'disconnected') {
      return {
        title: '同步助手未连接',
        desc: '请确认电脑端同步助手已启动，且手机和电脑在同一网络',
        color: theme.error,
        icon: 'alert-circle' as keyof typeof Feather.glyphMap,
      };
    }

    return {
      title: '配置本地同步助手',
      desc: '填写电脑 IP 和端口，连接成功后可同步 Excel 到电脑',
      color: theme.textMuted,
      icon: 'monitor' as keyof typeof Feather.glyphMap,
    };
  }, [
    connectionStatus,
    syncTarget,
    theme.error,
    theme.primary,
    theme.success,
    theme.textMuted,
  ]);

  // 渲染菜单卡片
  const renderMenuCard = useCallback(
    (
      title: string,
      desc: string,
      iconName: keyof typeof Feather.glyphMap,
      color: string,
      onPress: () => void,
      disabled?: boolean,
      loading?: boolean,
      rightText?: string
    ) => (
      <AnimatedCard
        onPress={onPress}
        disabled={disabled || loading}
        style={[styles.exportCardContainer, disabled && styles.exportCardDisabled]}
        disablePressAnimation
      >
        <View style={styles.exportCard}>
          <View style={[styles.exportIcon, { backgroundColor: color + '15' }]}>
            {loading ? (
              <ActivityIndicator size="small" color={color} />
            ) : (
              <Feather name={iconName} size={20} color={color} />
            )}
          </View>
          <View style={styles.exportInfo}>
            <Text style={styles.exportTitle}>{loading ? '处理中...' : title}</Text>
            <Text style={styles.exportDesc}>{desc}</Text>
          </View>
          {rightText ? (
            <Text style={[styles.rightText, { color }]}>{rightText}</Text>
          ) : (
            <Feather name="chevron-right" size={16} color={theme.textMuted} />
          )}
        </View>
      </AnimatedCard>
    ),
    [styles, theme.textMuted]
  );

  // 渲染开关设置项
  const renderSwitchCard = useCallback(
    (
      title: string,
      desc: string,
      iconName: keyof typeof Feather.glyphMap,
      color: string,
      value: boolean,
      onValueChange: (value: boolean) => void
    ) => (
      <AnimatedCard
        onPress={() => onValueChange(!value)}
        style={styles.exportCardContainer}
        disablePressAnimation
      >
        <View style={styles.exportCard}>
          <View style={[styles.exportIcon, { backgroundColor: color + '15' }]}>
            <Feather name={iconName} size={20} color={color} />
          </View>
          <View style={styles.exportInfo}>
            <Text style={styles.exportTitle}>{title}</Text>
            <Text style={styles.exportDesc}>{desc}</Text>
          </View>
          <Switch
            value={value}
            onValueChange={onValueChange}
            trackColor={{ false: theme.border, true: color + '80' }}
            thumbColor={value ? color : theme.textMuted}
          />
        </View>
      </AnimatedCard>
    ),
    [styles, theme.border, theme.textMuted]
  );

  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      disableAutoScroll
    >
      <KeyboardAwareFormScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        bottomOffset={Math.max(insets.bottom + 120, 160)}
        scrollEventThrottle={16} // 控制滚动事件频率（16ms ≈ 60fps）
        decelerationRate="normal" // 正常减速率，改善滑动手感
        directionalLockEnabled={true} // 锁定滚动方向，提升跟手性
        onScrollBeginDrag={() => { scrollingRef.current = true; }}
        onScrollEndDrag={() => { scrollingRef.current = false; }}
        onMomentumScrollBegin={() => { scrollingRef.current = true; }}
        onMomentumScrollEnd={() => { scrollingRef.current = false; }}
      >
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.title}>设置</Text>
          </View>
        </View>

        {/* ========== 常用设置 ========== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>常用设置</Text>
        </View>

        <View style={{ gap: getSpacing().md }}>
          {renderMenuCard('仓库档案', '维护仓库与默认仓库', 'box', theme.primary, () =>
            router.push('/warehouse-management')
          )}

          {renderSwitchCard(
            '扫码提示音',
            '扫码成功、重复、异常反馈',
            'radio',
            theme.primary,
            soundEnabled,
            toggleSound
          )}

          {renderMenuCard(
            '检查更新',
            `当前版本 ${APP_VERSION}`,
            'refresh-cw',
            theme.success,
            checkForUpdate,
            checkingUpdate,
            checkingUpdate
          )}


        </View>

        {/* ========== 扫码解析 ========== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>扫码解析</Text>
        </View>

        <View style={{ gap: getSpacing().md }}>
          {renderMenuCard(
            '解析规则',
            '按分隔符识别二维码字段',
            'sliders',
            theme.accent,
            () => router.push('/rules'),
            false,
            false,
            `${configStats.rules} 条`
          )}

          {renderMenuCard(
            '自定义字段',
            '扩展二维码里的业务字段',
            'edit-3',
            theme.warning,
            () => router.push('/custom-fields'),
            false,
            false,
            `${configStats.customFields} 个`
          )}

          {renderMenuCard('前缀配置', '自动去除 PART NO.、QTY 等前缀', 'type', theme.success, () =>
            router.push('/rule-prefixes')
          )}

          {renderMenuCard('出库单号规则', '配置订单格式与仓库绑定', 'hash', theme.primary, () =>
            router.push('/outbound-order-rules')
          )}
        </View>

        {/* ========== 电脑同步 ========== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>电脑同步</Text>
        </View>

        {/* 服务器配置 */}
        <View style={styles.syncConfigCard}>
          <View style={styles.syncAssistantHeader}>
            <View
              style={[
                styles.syncAssistantIcon,
                { backgroundColor: `${syncAssistantStatus.color}18` },
              ]}
            >
              {connectionStatus === 'testing' ? (
                <ActivityIndicator size="small" color={syncAssistantStatus.color} />
              ) : (
                <Feather
                  name={syncAssistantStatus.icon}
                  size={20}
                  color={syncAssistantStatus.color}
                />
              )}
            </View>
            <View style={styles.syncAssistantInfo}>
              <Text style={styles.syncAssistantTitle}>{syncAssistantStatus.title}</Text>
              <Text style={styles.syncAssistantDesc}>{syncAssistantStatus.desc}</Text>
            </View>
          </View>

          <View style={styles.syncConfigRow}>
            <Text style={styles.syncConfigLabel}>电脑IP</Text>
            <TextInput
              style={styles.syncConfigInput}
              value={syncConfig.ip}
              onChangeText={handleIpChange}
              placeholder="例如 192.168.1.100"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.syncConfigRow}>
            <Text style={styles.syncConfigLabel}>端口</Text>
            <TextInput
              style={styles.syncConfigInput}
              value={syncConfig.port}
              onChangeText={handlePortChange}
              placeholder="默认: 8080"
              placeholderTextColor={theme.textMuted}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.syncConfigButtons}>
            <AnimatedButton
              containerStyle={styles.syncButtonWrap}
              style={[
                styles.syncButton,
                styles.syncButtonTest,
                connectionStatus === 'success' && styles.syncButtonSuccess,
                (connectionStatus === 'error' || connectionStatus === 'disconnected') &&
                  styles.syncButtonError,
              ]}
              onPress={handleTestConnection}
              disabled={connectionStatus === 'testing'}
              activeScale={0.96}
              activeOpacity={0.9}
            >
              {connectionStatus === 'testing' ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text
                  style={[
                    styles.syncButtonTestText,
                    connectionStatus === 'success' && styles.syncButtonSuccessText,
                    (connectionStatus === 'error' || connectionStatus === 'disconnected') &&
                      styles.syncButtonErrorText,
                  ]}
                >
                  {connectionStatus === 'success'
                    ? '已连接 ✓'
                    : connectionStatus === 'disconnected'
                      ? '断开连接 ✗'
                      : connectionStatus === 'error'
                        ? '连接失败 ✗'
                        : '测试连接'}
                </Text>
              )}
            </AnimatedButton>
          </View>
          {connectionStatus === 'success' && (
            <Text style={styles.syncStatusHint}>连接成功，配置已自动保存</Text>
          )}
          {connectionStatus === 'disconnected' && (
            <Text style={styles.syncStatusHintError}>网络连接已断开，请检查网络后重新连接</Text>
          )}
          {connectionStatus === 'error' && (
            <Text style={styles.syncStatusHintError}>请检查服务器地址和状态后重试</Text>
          )}
          {connectionStatus === 'idle' && !syncConfig.ip && (
            <Text style={styles.syncStatusHintIdle}>电脑端托盘菜单可查看服务地址</Text>
          )}
        </View>

        {/* 同步按钮 */}
        <View style={{ gap: getSpacing().sm }}>
          {renderMenuCard(
            '同步入库单',
            '生成入库 Excel 到电脑同步文件夹',
            'file-plus',
            theme.success,
            handleSyncInbound,
            !canSync,
            syncingInbound
          )}

          {renderMenuCard(
            '同步出库单',
            '生成出库 Excel 到电脑同步文件夹',
            'file-minus',
            theme.primary,
            handleSyncOutbound,
            !canSync,
            syncingOutbound
          )}

          {renderMenuCard(
            '同步盘点单',
            '生成盘点 Excel 到电脑同步文件夹',
            'bar-chart-2',
            theme.accent,
            handleSyncInventory,
            !canSync,
            syncingInventory
          )}

          {renderMenuCard(
            '同步盘点标签',
            '生成盘点拆包标签 Excel',
            'printer',
            theme.purple,
            handleSyncInventoryPartial,
            !canSync,
            syncingInventoryPartial
          )}

          {renderMenuCard(
            '同步订单标签',
            '生成订单拆包标签 Excel',
            'copy',
            theme.purple,
            handleSyncLabels,
            !canSync,
            syncingLabels
          )}
        </View>

        {/* ========== 数据维护 ========== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>数据维护</Text>
        </View>

        <View style={{ gap: getSpacing().md }}>
          {renderMenuCard(
            '备份配置',
            '备份规则、字段、绑定、仓库、服务器',
            'save',
            theme.cyan,
            handleBackup,
            false,
            backupLoading
          )}

          {renderMenuCard(
            '恢复配置',
            '从配置备份恢复设置',
            'rotate-ccw',
            theme.purple,
            handleRestore,
            false,
            restoreLoading
          )}

          {/* 数据库文件备份/恢复 */}
          {renderMenuCard(
            '备份数据库',
            '导出完整数据库文件',
            'database',
            theme.success,
            handleDatabaseBackup,
            false,
            dbBackupLoading
          )}

          {renderMenuCard(
            '恢复数据库',
            '用数据库备份替换当前数据',
            'hard-drive',
            theme.warning,
            handleDatabaseRestore,
            false,
            dbRestoreLoading
          )}

        </View>

        {/* ========== 关于 ========== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>关于</Text>
        </View>

        <View style={styles.aboutCard}>
          {/* App图标和名称 */}
          <View style={styles.aboutAppSection}>
            <View style={styles.aboutLogo}>
              <Feather name="package" size={rs(16)} color={theme.primary} />
            </View>
            <Text style={styles.aboutAppName}>{APP_NAME}</Text>
            <View style={styles.aboutVersionBadge}>
              <Text style={styles.aboutVersionText}>{APP_VERSION}</Text>
            </View>
          </View>

          <View style={styles.aboutDivider} />

          {/* 公司信息 */}
          <View style={styles.aboutDetailsSection}>
            <AnimatedButton
              style={styles.aboutDetailRow}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(COMPANY_WEBSITE)}
            >
              <View style={styles.aboutDetailIconWrapper}>
                <Feather name="briefcase" size={rs(14)} color={theme.textSecondary} />
              </View>
              <Text style={styles.aboutDetailLabel}>公司</Text>
              <View style={styles.aboutDetailRight}>
                <Text style={styles.aboutDetailValue}>{COMPANY_NAME}</Text>
                <Feather name="external-link" size={rs(12)} color={theme.textMuted} />
              </View>
            </AnimatedButton>

            <View style={styles.aboutDetailRow}>
              <View style={styles.aboutDetailIconWrapper}>
                <Feather name="user" size={rs(14)} color={theme.textSecondary} />
              </View>
              <Text style={styles.aboutDetailLabel}>作者</Text>
              <Text style={styles.aboutDetailValue}>{AUTHOR}</Text>
            </View>
          </View>

          <View style={styles.aboutDivider} />

          {/* 使用说明和更新日志 */}
          <View style={styles.helpRow}>
            <TouchableOpacity
              style={styles.helpEntry}
              activeOpacity={0.7}
              onPress={() => router.push('/help')}
            >
              <Feather
                name="book-open"
                size={rs(14)}
                color={theme.textMuted}
                style={styles.helpIconWrapper}
              />
              <Text style={styles.helpText}>使用说明</Text>
              <Feather name="chevron-right" size={rs(14)} color={theme.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.helpEntry}
              activeOpacity={0.7}
              onPress={() => router.push('/changelog')}
            >
              <Feather
                name="clock"
                size={rs(14)}
                color={theme.textMuted}
                style={styles.changelogIconWrapper}
              />
              <Text style={styles.changelogText}>更新日志</Text>
              <Feather name="chevron-right" size={rs(14)} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 底部留白 */}
        <View style={{ height: Spacing['4xl'] }} />
      </KeyboardAwareFormScrollView>

      {/* ==================== 在线更新模态框 ==================== */}
      <Modal
        visible={updateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !downloading && setUpdateModalVisible(false)}
      >
        <View style={styles.updateModalOverlay}>
          <AppModalCard
            title="发现新版本"
            subtitle={
              downloading
                ? '正在下载安装包，请保持网络稳定并稍候。'
                : '请确认版本信息与更新内容，再决定是否下载安装。'
            }
            onClose={
              downloading
                ? undefined
                : () => {
                    setUpdateModalVisible(false);
                  }
            }
            style={styles.modalContent}
            bodyStyle={styles.modalBody}
            size="largeForm"
            stretchBody
            footer={
              !downloading ? (
                <View style={styles.updateModalFooter}>
                  <AppModalActions
                    containerStyle={styles.modalActions}
                    secondaryLabel="关闭"
                    onSecondaryPress={() => {
                      setUpdateModalVisible(false);
                    }}
                    primaryLabel="下载更新"
                    onPrimaryPress={downloadAndInstall}
                  />
                </View>
              ) : undefined
            }
          >
            <KeyboardAwareFormScrollView
              style={styles.updateModalBody}
              contentContainerStyle={styles.updateModalBodyContent}
              bottomOffset={32}
              scrollEventThrottle={16}
            >
              {updateInfo && (
                <>
                  <View style={styles.updateVersionInfo}>
                    <Text style={styles.updateVersionLabel}>新版本</Text>
                    <Text style={styles.updateVersionText}>V{updateInfo.version}</Text>
                  </View>

                  <Text style={styles.updateChangelogTitle}>更新内容</Text>
                  <Text style={styles.updateChangelogText}>{updateInfo.changelog}</Text>

                  {downloading && (
                    <View style={styles.downloadProgress}>
                      <View style={styles.progressBarContainer}>
                        <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
                      </View>
                      <Text style={styles.progressText}>下载中... {downloadProgress}%</Text>
                    </View>
                  )}
                </>
              )}
            </KeyboardAwareFormScrollView>
          </AppModalCard>
        </View>
      </Modal>

      {alert.AlertComponent}
      <ToastContainer />

      {/* 数据库恢复后的重启提示弹窗 - 强制重启 */}
      <Modal
        visible={showRestartModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // 禁止点击遮罩关闭，必须点击重启按钮
          return false;
        }}
      >
        <View style={styles.restartModalOverlay}>
          <AppModalCard
            title="数据库恢复成功"
            subtitle="数据库已恢复到备份状态，需要立即重启应用后才能继续安全使用。"
            style={styles.restartModalContent}
            bodyStyle={styles.restartModalBody}
            size="form"
            stretchBody
            footer={
              <AppModalActions
                containerStyle={styles.modalActions}
                primaryLabel="立即重启应用"
                onPrimaryPress={async () => {
                  try {
                    await Updates.reloadAsync();
                  } catch (error) {
                    logger.error('重启应用失败:', error);
                    alert.showError('重启失败，请手动关闭应用后重新打开');
                  }
                }}
              />
            }
          >
            <View style={styles.restartModalIcon}>
              <Feather name="refresh-cw" size={48} color={theme.accent} />
            </View>

            <View style={styles.restartModalWarningContainer}>
              <Text style={styles.restartModalWarning}>⚠️ 必须重启应用才能继续使用</Text>
              <Text style={styles.restartModalWarningSub}>未重启可能导致数据错乱</Text>
            </View>
          </AppModalCard>
        </View>
      </Modal>
    </Screen>
  );
}
