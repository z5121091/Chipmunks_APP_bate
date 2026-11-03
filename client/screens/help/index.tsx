import { useMemo, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppPressable } from '@/components/AppPressable';
import { Screen } from '@/components/Screen';
import { UiAssetIcon } from '@/components/UiAssetIcon';
import { UiInput, UiPageHeader } from '@/components/UiRedesign';
import { useHardwareBack } from '@/hooks/useHardwareBack';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useTheme } from '@/hooks/useTheme';
import { Spacing } from '@/constants/theme';
import {
  HELP_CATEGORIES,
  HELP_QUICK_STARTS,
  HELP_TOPICS,
  searchHelp,
  type HelpArticle,
  type HelpTopic,
} from './content';
import { createStyles } from './styles';

export default function HelpScreen() {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof HELP_CATEGORIES)[number]['id']>('all');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const topic = HELP_TOPICS.find((item) => item.id === topicId);
  const searching = Boolean(query.trim());
  const results = useMemo(() => searchHelp(query), [query]);
  const topics = HELP_TOPICS.filter((item) => category === 'all' || item.category === category);

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: false });
  const goBackInHelp = () => {
    if (searching || query) {
      setQuery('');
      setArticleId(null);
      Keyboard.dismiss();
      scrollTop();
      return true;
    }
    if (topicId) {
      setTopicId(null);
      setArticleId(null);
      scrollTop();
      return true;
    }
    return false;
  };
  useHardwareBack(goBackInHelp);

  const openTopic = (nextTopic: HelpTopic, nextArticleId?: string) => {
    Keyboard.dismiss();
    setQuery('');
    setTopicId(nextTopic.id);
    setArticleId(nextArticleId ?? nextTopic.articles[0]?.id ?? null);
    scrollTop();
  };

  const renderArticle = (article: HelpArticle, owner: HelpTopic, showTopic = false) => {
    const expanded = articleId === article.id;
    return (
      <View key={article.id} style={styles.articleCard}>
        <AppPressable
          style={styles.articleHeader}
          onPress={() => {
            Keyboard.dismiss();
            setArticleId((current) => (current === article.id ? null : article.id));
          }}
          accessibilityRole="button"
          accessibilityLabel={article.title}
          accessibilityState={{ expanded }}
        >
          <View style={styles.rowText}>
            {showTopic && <Text style={styles.topicLabel}>{owner.title}</Text>}
            <Text style={styles.articleTitle}>{article.title}</Text>
            <Text style={styles.summary}>{article.summary}</Text>
          </View>
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.textMuted}
          />
        </AppPressable>
        {expanded && (
          <View style={styles.articleBody}>
            {article.steps.map((step, index) => (
              <View key={index} style={styles.stepRow}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
                <Text selectable style={styles.stepText}>
                  {step}
                </Text>
              </View>
            ))}
            {article.note && (
              <View style={styles.note}>
                <Text style={styles.noteTitle}>操作提醒</Text>
                <Text selectable style={styles.noteText}>
                  {article.note}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <Screen
      backgroundColor={theme.backgroundRoot}
      statusBarStyle={isDark ? 'light' : 'dark'}
      disableAutoScroll
    >
      <View style={[styles.headerShell, { paddingTop: insets.top }]}>
        <UiPageHeader
          title={searching ? '搜索使用说明' : topic?.title || '使用说明'}
          onBack={() => {
            if (!goBackInHelp()) router.back();
          }}
        />
        <View style={styles.searchShell}>
          <UiInput
            accessibilityLabel="搜索使用说明"
            placeholder="搜索操作或问题，如：补打、未绑定"
            value={query}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onChangeText={(value) => {
              setQuery(value);
              setTopicId(null);
              setArticleId(null);
              scrollTop();
            }}
            onSubmitEditing={() => Keyboard.dismiss()}
            leftElement={<Feather name="search" size={18} color={theme.textMuted} />}
            rightElement={
              query ? (
                <AppPressable
                  accessibilityRole="button"
                  accessibilityLabel="清空搜索"
                  style={styles.clearButton}
                  onPress={() => {
                    setQuery('');
                    setArticleId(null);
                    Keyboard.dismiss();
                    scrollTop();
                  }}
                >
                  <Feather name="x" size={18} color={theme.textMuted} />
                </AppPressable>
              ) : undefined
            }
          />
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: Spacing['3xl'] + insets.bottom }]}
      >
        {searching ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.sectionMeta}>
              找到 {results.length} 篇说明 · 点击问题查看步骤
            </Text>
            {results.length ? (
              results.map((result) => renderArticle(result.article, result.topic, true))
            ) : (
              <View style={styles.empty}>
                <Feather name="search" size={28} color={theme.textMuted} />
                <Text style={styles.sectionTitle}>没有找到相关说明</Text>
                <Text style={styles.emptyText}>
                  试试更短的词，如“入库”“配对”“数量”，或清空搜索按功能查找。
                </Text>
                <AppPressable
                  accessibilityRole="button"
                  style={styles.resetButton}
                  onPress={() => {
                    setQuery('');
                    Keyboard.dismiss();
                    scrollTop();
                  }}
                >
                  <Text style={styles.resetText}>返回功能目录</Text>
                </AppPressable>
              </View>
            )}
          </>
        ) : topic ? (
          <>
            <Text style={styles.sectionMeta}>
              {topic.summary} · {topic.articles.length} 篇说明
            </Text>
            {topic.articles.map((article) => renderArticle(article, topic))}
          </>
        ) : (
          <>
            <View style={styles.intro}>
              <Text style={styles.introTitle}>你现在想做什么？</Text>
              <Text style={styles.introText}>
                按功能查步骤，遇到问题搜关键词。说明保存在本机，无需连接 ERP。
              </Text>
              <View style={styles.quickGrid}>
                {HELP_QUICK_STARTS.map((quick) => (
                  <AppPressable
                    key={quick.articleId}
                    style={styles.quickButton}
                    accessibilityRole="button"
                    onPress={() =>
                      openTopic(
                        HELP_TOPICS.find((item) => item.id === quick.topicId)!,
                        quick.articleId
                      )
                    }
                  >
                    <Text style={styles.quickText}>{quick.title}</Text>
                    <Feather name="arrow-up-right" size={15} color={theme.primary} />
                  </AppPressable>
                ))}
              </View>
            </View>
            <View style={styles.categories}>
              {HELP_CATEGORIES.map((item) => (
                <AppPressable
                  key={item.id}
                  style={[styles.category, category === item.id && styles.categoryActive]}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  accessibilityState={{ selected: category === item.id }}
                  onPress={() => {
                    setCategory(item.id);
                    scrollTop();
                  }}
                >
                  <Text
                    style={[styles.categoryText, category === item.id && styles.categoryTextActive]}
                  >
                    {item.title}
                  </Text>
                </AppPressable>
              ))}
            </View>
            <Text style={styles.sectionMeta}>选择功能，查看操作步骤</Text>
            {topics.map((item) => (
              <AppPressable
                key={item.id}
                style={styles.topicRow}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${item.summary}`}
                onPress={() => openTopic(item)}
              >
                <View style={styles.topicIcon}>
                  <UiAssetIcon name={item.icon} size={28} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.topicTitle}>{item.title}</Text>
                  <Text style={styles.summary}>{item.summary}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.textMuted} />
              </AppPressable>
            ))}
            <Text style={styles.footer}>
              扫码以 APP 的数量和记录为准，扫描头响声不代表保存成功。
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
