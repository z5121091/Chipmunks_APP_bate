
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { createStyles } from './styles';
import { Spacing } from '@/constants/theme';
import { CHANGELOG_DATA } from '@/constants/version';

export default function ChangelogScreen() {
  const { theme, isDark } = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();

  return (
    <Screen backgroundColor={theme.backgroundRoot} statusBarStyle={isDark ? 'light' : 'dark'}>
      <ScrollView 
        style={styles.container}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingTop: insets.top + Spacing.lg,
            paddingBottom: Spacing['5xl'] + insets.bottom 
          }
        ]}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.7} onPress={() => router.back()}>
            <Feather name="arrow-left" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>更新日志</Text>
        </View>

        {CHANGELOG_DATA.map((log) => (
          <View key={log.version} style={styles.versionBlock}>
            <View style={styles.versionHeader}>
              <Text style={styles.versionText}>{log.version}</Text>
              <Text style={styles.dateText}>{log.date}</Text>
            </View>
            
            {log.changes.map((change, index) => {
              const tagStyle = change.type === 'feat' 
                ? styles.tagFeat 
                : change.type === 'fix' 
                  ? styles.tagFix 
                  : styles.tagImprove;
              const tagTextStyle = change.type === 'feat'
                ? styles.tagTextFeat
                : change.type === 'fix'
                  ? styles.tagTextFix
                  : styles.tagTextImprove;
              const tagLabel = change.type === 'feat' ? '新增' : change.type === 'fix' ? '修复' : '优化';
              
              return (
                <View key={`${log.version}-${index}`} style={styles.changeItem}>
                  <View style={[styles.changeTag, tagStyle]}>
                    <Text style={tagTextStyle}>{tagLabel}</Text>
                  </View>
                  <Text style={styles.changeText}>{change.text}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
