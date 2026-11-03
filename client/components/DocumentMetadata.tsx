import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export function DocumentMetadata({ completion, syncLabel, syncColor, date, account }: {
  completion?: string; syncLabel: string; syncColor: string; date: string; account: string;
}) {
  const { theme } = useTheme();
  // Keep the year for historical records; never reinterpret a document's date/time zone.
  const compactDate = (date || '未记录日期').replace(/^(\d{4})[-/](\d{2})[-/](\d{2}).*$/, '$1-$2-$3');
  return (
    <View style={styles.row} accessibilityLabel={[completion, syncLabel, date, account].filter(Boolean).join('，')}>
      {completion ? <Text style={[styles.text, { color: theme.textSecondary }]}>{completion} ·</Text> : null}
      <Text style={[styles.text, { color: syncColor }]}>{syncLabel} ·</Text>
      <Text style={[styles.text, { color: theme.textMuted }]}>{compactDate} ·</Text>
      <Text numberOfLines={1} style={[styles.text, styles.account, { color: theme.textMuted }]}>{account}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginTop: 4 },
  text: { fontSize: 11, lineHeight: 17 },
  account: { flexShrink: 1, maxWidth: '100%' },
});
