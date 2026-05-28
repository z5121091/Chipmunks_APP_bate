import React, { useCallback, useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AnimatedButton } from '@/components/AnimatedButton';
import { createStyles } from './styles';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { addWarehouse, getAllWarehouses, hasAnyMaterials, initDatabase } from '@/utils/database';
import { ModuleColors } from '@/constants/theme';
import { Str } from '@/resources/strings';
import { WarehouseGuide, shouldShowWarehouseGuide } from '@/components/WarehouseGuide';
import { logger } from '@/utils/logger';
import { useCustomAlert } from '@/components/CustomAlert';

interface Module {
  id: string;
  name: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  route: string;
  priority: 'primary' | 'secondary';
  action: string;
}

const HomeModuleCard = React.memo<{
  module: Module;
  variant: 'primary' | 'secondary';
  styles: ReturnType<typeof createStyles>;
  screenWidth: number;
  onPress: () => void;
}>(
  ({ module, variant, styles, screenWidth, onPress }) => {
    const isPrimary = variant === 'primary';
    const iconSize = isPrimary ? (screenWidth <= 410 ? 38 : 42) : screenWidth <= 410 ? 25 : 28;

    return (
      <AnimatedButton
        containerStyle={isPrimary ? styles.primaryCardWrapper : styles.secondaryCardWrapper}
        style={
          isPrimary ? [styles.primaryCard, { borderColor: module.color }] : styles.secondaryCard
        }
        activeScale={0.975}
        activeOpacity={0.92}
        onPress={onPress}
      >
        <View style={isPrimary ? styles.primaryCardInner : styles.secondaryCardInner}>
          <View
            style={[
              isPrimary ? styles.primaryIconContainer : styles.secondaryIconContainer,
              { backgroundColor: `${module.color}18` },
            ]}
          >
            <Feather name={module.icon} size={iconSize} color={module.color} />
          </View>

          <Text style={isPrimary ? styles.primaryTitle : styles.secondaryTitle} numberOfLines={1}>
            {module.name}
          </Text>

          <View style={isPrimary ? styles.primaryFooter : styles.secondaryFooter}>
            <Text style={isPrimary ? styles.primaryAction : styles.secondaryAction}>
              {module.action}
            </Text>
            <Feather name="arrow-up-right" size={isPrimary ? 16 : 14} color={module.color} />
          </View>

          {isPrimary && <View style={[styles.primaryAccent, { backgroundColor: module.color }]} />}
        </View>
      </AnimatedButton>
    );
  },
  (prevProps, nextProps) =>
    prevProps.module.id === nextProps.module.id &&
    prevProps.module.route === nextProps.module.route &&
    prevProps.module.name === nextProps.module.name &&
    prevProps.module.action === nextProps.module.action &&
    prevProps.variant === nextProps.variant &&
    prevProps.screenWidth === nextProps.screenWidth
);

export default function HomeScreen() {
  const { theme, isDark } = useTheme();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [showWarehouseGuide, setShowWarehouseGuide] = useState(false);

  const styles = useMemo(
    () => createStyles(theme, screenWidth, screenHeight),
    [theme, screenWidth, screenHeight]
  );

  const checkWarehouseGuide = useCallback(async () => {
    await initDatabase();

    const [warehouses, hasBusinessData] = await Promise.all([getAllWarehouses(), hasAnyMaterials()]);

    return shouldShowWarehouseGuide({
      hasBusinessData,
      hasWarehouseConfig: warehouses.length > 0,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const run = async () => {
        try {
          const needsGuide = await checkWarehouseGuide();
          if (!cancelled) {
            setShowWarehouseGuide(needsGuide);
          }
        } catch (error) {
      logger.error('[首页] 检查仓库引导失败:', error);
        }
      };

      void run();

      return () => {
        cancelled = true;
      };
    }, [checkWarehouseGuide])
  );

  const handleSkipWarehouseGuide = useCallback(async () => {
    try {
      await initDatabase();
      const warehouses = await getAllWarehouses();

      if (warehouses.length === 0) {
        await addWarehouse({
          name: '默认仓库',
          description: '系统自动创建，可在仓库档案中修改',
          is_default: true,
        });
      }

      setShowWarehouseGuide(false);
    } catch (error) {
      logger.error('[首页] 跳过引导并创建默认仓库失败:', error);
      alert.showError('创建默认仓库失败，请重试或手动创建仓库');
    }
  }, [alert]);

  const handleGoToWarehouseSettings = useCallback(() => {
    setShowWarehouseGuide(false);
    router.push('/warehouse-management');
  }, [router]);

  const moduleColors = theme.isDark
    ? [
        ModuleColors.dark.inbound,
        ModuleColors.dark.outbound,
        ModuleColors.dark.orders,
        ModuleColors.dark.inventory,
        ModuleColors.dark.materials,
        ModuleColors.dark.settings,
      ]
    : [
        ModuleColors.light.inbound,
        ModuleColors.light.outbound,
        ModuleColors.light.orders,
        ModuleColors.light.inventory,
        ModuleColors.light.materials,
        ModuleColors.light.settings,
      ];

  const modules: Module[] = [
    {
      id: 'inbound',
      name: Str.moduleInbound,
      icon: 'log-in',
      color: moduleColors[0],
      route: '/inbound',
      priority: 'primary',
      action: '收货扫码',
    },
    {
      id: 'outbound',
      name: Str.moduleOutbound,
      icon: 'truck',
      color: moduleColors[1],
      route: '/outbound',
      priority: 'primary',
      action: '发货扫码',
    },
    {
      id: 'documents',
      name: Str.moduleDocuments,
      icon: 'folder',
      color: moduleColors[2],
      route: '/document-management',
      priority: 'secondary',
      action: '查单改错',
    },
    {
      id: 'inventory',
      name: Str.moduleInventory,
      icon: 'check-square',
      color: moduleColors[3],
      route: '/inventory',
      priority: 'secondary',
      action: '扫码盘点',
    },
    {
      id: 'material',
      name: Str.moduleMaterials,
      icon: 'git-merge',
      color: moduleColors[4],
      route: '/inventory-binding',
      priority: 'secondary',
      action: '型号编码',
    },
    {
      id: 'settings',
      name: Str.moduleSettings,
      icon: 'tool',
      color: moduleColors[5],
      route: '/settings',
      priority: 'secondary',
      action: '参数维护',
    },
  ];

  const primaryModules = modules.filter((module) => module.priority === 'primary');
  const secondaryModules = modules.filter((module) => module.priority === 'secondary');
  const secondaryRows = [
    secondaryModules.slice(0, 2),
    secondaryModules.slice(2, 4),
  ];

  const renderPrimaryCard = useCallback(
    (module: Module) => (
      <HomeModuleCard
        key={module.id}
        module={module}
        variant="primary"
        styles={styles}
        screenWidth={screenWidth}
        onPress={() => router.push(module.route as any)}
      />
    ),
    [router, screenWidth, styles]
  );

  const renderSecondaryCard = useCallback(
    (module: Module) => (
      <HomeModuleCard
        key={module.id}
        module={module}
        variant="secondary"
        styles={styles}
        screenWidth={screenWidth}
        onPress={() => router.push(module.route as any)}
      />
    ),
    [router, screenWidth, styles]
  );

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.workbench}>
            <View style={[styles.sectionSurface, styles.primarySurface]}>
              <View style={styles.primarySection}>
                <Text style={styles.sectionLabel}>扫码作业</Text>
                <View style={styles.primaryGrid}>{primaryModules.map(renderPrimaryCard)}</View>
              </View>
            </View>

            <View style={[styles.sectionSurface, styles.secondarySurface]}>
              <View style={styles.secondarySection}>
                <Text style={styles.sectionLabel}>单据与配置</Text>
                <View style={styles.secondaryGrid}>
                  {secondaryRows.map((row, rowIndex) => (
                    <View key={`row-${rowIndex}`} style={styles.secondaryRow}>
                      {row.map(renderSecondaryCard)}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>

      <WarehouseGuide
        visible={showWarehouseGuide}
        onSkip={() => {
          void handleSkipWarehouseGuide();
        }}
        onGoToSettings={handleGoToWarehouseSettings}
      />
      {alert.AlertComponent}
    </Screen>
  );
}
