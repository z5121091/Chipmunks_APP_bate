import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const alert = useCustomAlert();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const cards = useMemo<DocumentCard[]>(
    () => [
      {
        id: 'orders',
        title: '出库订单',
        description: '编辑数量、拆包打印、查看出库追溯记录',
        icon: 'file-text',
        route: '/orders',
        tone: 'primary',
      },
      {
        id: 'inbound',
        title: '入库记录',
        description: '按仓库查看入库单，删除误保存的入库明细',
        icon: 'log-in',
        route: '/inbound-records',
        tone: 'primary',
      },
      {
        id: 'inventory',
        title: '盘点记录',
        description: '按仓库查看盘点单，删除误保存的盘点明细',
        icon: 'check-square',
        route: '/inventory-records',
        tone: 'primary',
      },
    ],
    []
  );

  const handleCardPress = (card: DocumentCard) => {
    if (card.route) {
      router.push(card.route as any);
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
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => router.back()}
          >
            <Feather name="arrow-left" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTextBlock}>
            <Text style={styles.title}>单据管理</Text>
            <Text style={styles.subtitle}>查历史、改错单、补同步都从这里进入</Text>
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
