import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { UiAssetIcon, type UiAssetIconName } from '@/components/UiAssetIcon';
import { WarehouseGuide, shouldShowWarehouseGuide } from '@/components/WarehouseGuide';
import { useCustomAlert } from '@/components/CustomAlert';
import { ModuleColors } from '@/constants/theme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import {
  addWarehouse,
  getAllWarehouses,
  getRecentDocumentSummaries,
  hasAnyMaterials,
  initDatabase,
  type RecentDocumentSummary,
} from '@/utils/database';
import {
  loadHomeWorkspaceSnapshot,
  type HomeActiveWork,
  type HomeWorkspaceSnapshot,
} from '@/utils/homeWorkspace';
import { logger } from '@/utils/logger';
import { formatDateTime } from '@/utils/time';
import { withAlpha } from '@/utils/colors';
import { createStyles } from './styles';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

interface OperationItem {
  badge?: string;
  color: string;
  featherIcon?: FeatherIconName;
  icon?: UiAssetIconName;
  id: 'outbound' | 'inbound' | 'inventory' | 'stock';
  route: string;
  status: string;
  title: string;
}

interface BottomNavItem {
  active?: boolean;
  icon: FeatherIconName;
  id: string;
  label: string;
  route?: string;
}

const EMPTY_WORKSPACE: HomeWorkspaceSnapshot = {
  activeWork: [],
  pendingReceipts: [],
  pendingReceiptUpdatedAt: '',
};

const getTodayLabel = () =>
  new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).format(new Date());

const getWorkByKind = (
  activeWork: readonly HomeActiveWork[],
  kind: HomeActiveWork['kind']
) => activeWork.find((work) => work.kind === kind);

interface BottomNavigationProps {
  activeColor: string;
  items: BottomNavItem[];
  mutedColor: string;
  onNavigate: (route?: string) => void;
  styles: ReturnType<typeof createStyles>;
}

function BottomNavigation({
  activeColor,
  items,
  mutedColor,
  onNavigate,
  styles,
}: BottomNavigationProps) {
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.bottomNavItem}
          activeOpacity={0.78}
          disabled={item.active}
          onPress={() => onNavigate(item.route)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <View style={[styles.bottomNavIndicator, item.active && styles.bottomNavIndicatorActive]} />
          <Feather
            name={item.icon}
            size={19}
            color={item.active ? activeColor : mutedColor}
          />
          <Text style={[styles.bottomNavLabel, item.active && styles.bottomNavLabelActive]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const { theme, isDark } = useTheme();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(theme, screenWidth, screenHeight),
    [screenHeight, screenWidth, theme]
  );

  const [showWarehouseGuide, setShowWarehouseGuide] = useState(false);
  const [workspace, setWorkspace] = useState<HomeWorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocumentSummary[]>([]);

  const moduleColors = theme.isDark ? ModuleColors.dark : ModuleColors.light;
  const visibleRecentDocuments =
    screenWidth <= 360 || screenHeight <= 680
      ? recentDocuments.slice(0, 2)
      : recentDocuments.slice(0, 3);

  const navigateToRoute = useCallback(
    (route?: string, params?: Record<string, unknown>) => {
      if (route) {
        router.push(route, params || {});
      }
    },
    [router]
  );

  const loadHomeData = useCallback(async () => {
    await initDatabase();
    const [nextWorkspace, latestDocuments] = await Promise.all([
      loadHomeWorkspaceSnapshot(),
      getRecentDocumentSummaries(3),
    ]);
    setWorkspace(nextWorkspace);
    setRecentDocuments(latestDocuments);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const run = async () => {
        try {
          await initDatabase();
          const [warehouses, hasBusinessData] = await Promise.all([
            getAllWarehouses(),
            hasAnyMaterials(),
          ]);
          if (!cancelled) {
            setShowWarehouseGuide(
              shouldShowWarehouseGuide({
                hasBusinessData,
                hasWarehouseConfig: warehouses.length > 0,
              })
            );
          }
          await loadHomeData();
        } catch (error) {
          logger.error('[首页] 加载工作台失败:', error);
        }
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [loadHomeData])
  );

  const outboundWork = getWorkByKind(workspace.activeWork, 'outbound');
  const inboundWork = getWorkByKind(workspace.activeWork, 'inbound');
  const inventoryWork = getWorkByKind(workspace.activeWork, 'inventory');
  const pendingReceiptCount = workspace.pendingReceipts.length;

  const operations: OperationItem[] = [
    {
      color: moduleColors.outbound,
      icon: 'outboundScan',
      id: 'outbound',
      route: '/outbound',
      status: outboundWork ? `继续 ${outboundWork.title}` : '扫描销售出库单',
      title: '扫码出库',
    },
    {
      badge: pendingReceiptCount > 0 ? String(pendingReceiptCount) : undefined,
      color: moduleColors.inbound,
      icon: 'inboundScan',
      id: 'inbound',
      route: '/purchase-receive',
      status: inboundWork
        ? `继续 ${inboundWork.title}`
        : pendingReceiptCount > 0
          ? `${pendingReceiptCount} 张未审单据`
          : '查看未审采购单',
      title: '采购入库',
    },
    {
      color: moduleColors.inventory,
      icon: 'inventoryCount',
      id: 'inventory',
      route: '/inventory',
      status: inventoryWork ? `继续 ${inventoryWork.detail}` : '新建或继续盘点',
      title: '库存盘点',
    },
    {
      color: moduleColors.materials,
      featherIcon: 'search',
      id: 'stock',
      route: '/stock-query',
      status: '按型号或存货编码查询',
      title: '库存查询',
    },
  ];

  const handleSkipWarehouseGuide = useCallback(async () => {
    try {
      await initDatabase();
      const warehouses = await getAllWarehouses();
      if (warehouses.length === 0) {
        await addWarehouse({
          description: '系统自动创建，可在仓库档案中修改',
          is_default: true,
          name: '默认仓库',
        });
      }
      setShowWarehouseGuide(false);
      await loadHomeData();
    } catch (error) {
      logger.error('[首页] 创建默认仓库失败:', error);
      alert.showError('创建默认仓库失败，请重试或手动创建仓库');
    }
  }, [alert, loadHomeData]);

  const handleRecentDocumentPress = useCallback(
    (document: RecentDocumentSummary) => {
      if (document.type === 'outbound') {
        navigateToRoute('/orders', { orderNo: document.document_no });
        return;
      }
      navigateToRoute(
        document.type === 'inbound' ? '/inbound-records' : '/inventory-records'
      );
    },
    [navigateToRoute]
  );

  const bottomNavItems: BottomNavItem[] = [
    { active: true, icon: 'home', id: 'workbench', label: '工作台' },
    {
      icon: 'file-text',
      id: 'documents',
      label: '单据',
      route: '/document-management',
    },
    { icon: 'settings', id: 'settings', label: '设置', route: '/settings' },
  ];

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.appName}>掌上仓库</Text>
              <Text style={styles.todayText}>{getTodayLabel()}</Text>
            </View>
            <View style={styles.headerStatus}>
              <View style={styles.headerStatusDot} />
              <Text style={styles.headerStatusText}>
                {pendingReceiptCount > 0 ? `待办 ${pendingReceiptCount}` : '工作台'}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>仓库作业</Text>
              <Text style={styles.sectionHint}>选择作业开始</Text>
            </View>
            <View style={styles.operationGrid}>
              {operations.map((operation) => (
                <TouchableOpacity
                  key={operation.id}
                  style={styles.operationCard}
                  activeOpacity={0.76}
                  onPress={() => navigateToRoute(operation.route)}
                  accessibilityRole="button"
                  accessibilityLabel={operation.title}
                >
                  <View style={styles.operationTopRow}>
                    <View
                      style={[
                        styles.operationIcon,
                        {
                          backgroundColor: withAlpha(
                            operation.color,
                            isDark ? 0.18 : 0.1
                          ),
                        },
                      ]}
                    >
                      {operation.featherIcon ? (
                        <Feather
                          name={operation.featherIcon}
                          size={screenWidth <= 360 || screenHeight <= 680 ? 23 : 26}
                          color={operation.color}
                        />
                      ) : operation.icon ? (
                        <UiAssetIcon
                          name={operation.icon}
                          size={screenWidth <= 360 || screenHeight <= 680 ? 33 : 38}
                        />
                      ) : null}
                    </View>
                    {operation.badge ? (
                      <View
                        style={[
                          styles.operationBadge,
                          {
                            backgroundColor: withAlpha(
                              operation.color,
                              isDark ? 0.22 : 0.12
                            ),
                          },
                        ]}
                      >
                        <Text style={[styles.operationBadgeText, { color: operation.color }]}>
                          {operation.badge}
                        </Text>
                      </View>
                    ) : (
                      <Feather name="arrow-up-right" size={16} color={operation.color} />
                    )}
                  </View>
                  <Text style={styles.operationTitle}>{operation.title}</Text>
                  <Text style={styles.operationStatus} numberOfLines={1}>
                    {operation.status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>最近单据</Text>
              <TouchableOpacity
                style={styles.sectionAction}
                activeOpacity={0.72}
                onPress={() => navigateToRoute('/document-management')}
                accessibilityRole="button"
                accessibilityLabel="查看全部单据"
              >
                <Text style={styles.sectionActionText}>全部</Text>
                <Feather name="chevron-right" size={15} color={theme.primary} />
              </TouchableOpacity>
            </View>

            <View style={styles.recentList}>
              {visibleRecentDocuments.length > 0 ? (
                visibleRecentDocuments.map((document, index) => {
                  const color =
                    document.type === 'outbound'
                      ? moduleColors.outbound
                      : document.type === 'inbound'
                        ? moduleColors.inbound
                        : moduleColors.inventory;
                  const label =
                    document.type === 'outbound'
                      ? '出库'
                      : document.type === 'inbound'
                        ? '入库'
                        : '盘点';
                  return (
                    <TouchableOpacity
                      key={`${document.type}:${document.warehouse_id || 'none'}:${document.document_no}`}
                      style={[styles.recentRow, index > 0 && styles.rowDivider]}
                      activeOpacity={0.74}
                      onPress={() => handleRecentDocumentPress(document)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}单据 ${document.document_no}`}
                    >
                      <View style={[styles.recentMarker, { backgroundColor: color }]} />
                      <View style={styles.recentBody}>
                        <View style={styles.recentTitleRow}>
                          <Text style={styles.recentNo} numberOfLines={1}>
                            {document.document_no}
                          </Text>
                          <Text style={[styles.recentType, { color }]}>{label}</Text>
                        </View>
                        <Text style={styles.recentMeta} numberOfLines={1}>
                          {document.subject || document.warehouse_name || '仓库单据'} ·{' '}
                          {formatDateTime(document.created_at)}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={17} color={theme.textMuted} />
                    </TouchableOpacity>
                  );
                })
              ) : (
                <TouchableOpacity
                  style={styles.recentEmpty}
                  activeOpacity={0.74}
                  onPress={() => navigateToRoute('/document-management')}
                >
                  <View style={styles.recentEmptyText}>
                    <Text style={styles.recentEmptyTitle}>暂无最近单据</Text>
                    <Text style={styles.recentEmptySubtitle}>完成作业后会显示在这里</Text>
                  </View>
                  <Feather name="chevron-right" size={17} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>

        <BottomNavigation
          activeColor={theme.primary}
          items={bottomNavItems}
          mutedColor={theme.textMuted}
          styles={styles}
          onNavigate={(route) => navigateToRoute(route)}
        />
      </View>

      <WarehouseGuide
        visible={showWarehouseGuide}
        onSkip={() => {
          void handleSkipWarehouseGuide();
        }}
        onGoToSettings={() => {
          setShowWarehouseGuide(false);
          navigateToRoute('/warehouse-management');
        }}
      />
      {alert.AlertComponent}
    </Screen>
  );
}
