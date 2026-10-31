import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Screen } from '@/components/Screen';
import { AnimatedCard } from '@/components/AnimatedCard';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useCustomAlert } from '@/components/CustomAlert';
import { createStyles } from './styles';

type DocumentCard = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  route?: string;
  tone: 'primary' | 'muted';
};

export default function DocumentManagementScreen() {
  const { theme, isDark } = useTheme();
  const router = useSafeRouter();
  const alert = useCustomAlert();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const cards = useMemo<DocumentCard[]>(
    () => [
      {
        id: 'orders',
        title: '出库订单',
        description: '查询当前、当天及历史出库订单和明细',
        icon: 'file-text',
        route: '/orders',
        tone: 'primary',
      },
      {
        id: 'inbound',
        title: '入库记录',
        description: '按仓库查看入库单及明细，可删除本机记录',
        icon: 'log-in',
        route: '/inbound-records',
        tone: 'primary',
      },
      {
        id: 'inventory',
        title: '盘点记录',
        description: '按账套查看盘点单及明细，可删除本机记录',
        icon: 'check-square',
        route: '/inventory-records',
        tone: 'primary',
      },
    ],
    []
  );

  const handleCardPress = (card: DocumentCard) => {
    if (card.route) {
      router.push(card.route);
      return;
    }

    alert.showAlert(
      '功能待完善',
      `${card.title}管理入口已预留，下一步会补查看、删除和重新同步能力。`,
      [{ text: '知道了' }],
      'warning'
    );
  };

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}
      safeAreaEdges={['top', 'left', 'right']} disableAutoScroll>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>单据管理</Text>
            <Text style={styles.subtitle}>查看出库订单、入库记录和盘点记录</Text>
          </View>
        </View>

        <View style={styles.cardList}>
          {cards.map((card) => {
            const isPrimary = card.tone === 'primary';
            return (
              <AnimatedCard key={card.id} onPress={() => handleCardPress(card)}>
                <View style={[styles.card, isPrimary ? styles.cardPrimary : styles.cardMuted]}>
                  <View style={[styles.iconBox, isPrimary ? styles.iconBoxPrimary : styles.iconBoxMuted]}>
                    <Feather
                      name={card.icon}
                      size={isPrimary ? 24 : 22}
                      color={isPrimary ? theme.primary : theme.textSecondary}
                    />
                  </View>

                  <View style={styles.cardTextBlock}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                    </View>
                    <Text style={styles.cardDescription}>{card.description}</Text>
                  </View>

                  <Feather
                    name={card.route ? 'chevron-right' : 'clock'}
                    size={20}
                    color={isPrimary ? theme.primary : theme.textMuted}
                  />
                </View>
              </AnimatedCard>
            );
          })}
        </View>
      </ScrollView>

      {alert.AlertComponent}
    </Screen>
  );
}
