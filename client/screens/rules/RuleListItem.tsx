import { useResponsiveStyles } from '@/hooks/useResponsiveStyles';
import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { memo } from 'react';
import { Text, View } from 'react-native';
import { UiSwitch } from '@/components/UiSwitch';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { FIELD_LABELS, type QRCodeRule, type QRCodeRuleFolder } from '@/utils/database';
import { isIgnoredRuleField, type RuleConditionMode } from '@/utils/ruleConditions';
import { displayRuleTerminator } from '@/utils/ruleTerminator';
import { createStyles } from './styles';

const CONDITION_MODE_LABELS: Record<RuleConditionMode, string> = {
  all: '全部满足（且）',
  any: '任意满足（或）',
  mixed: '分组满足（且＋或）',
};

const SEPARATOR_DISPLAY: Record<string, string> = {
  '{}': '{*}',
  '()': '(*)',
  '[]': '[*]',
  '<>': '<*>',
  '\r\n': '回车换行',
  '\n': '换行',
  '\r': '回车',
  '\t': '制表符',
  '\x1D': 'GS',
  '\x1E': 'RS',
};

interface RuleCardContentProps {
  rule: QRCodeRule;
  styles: ReturnType<typeof createStyles>;
}

export const RuleCardContent = memo(function RuleCardContent({ rule, styles }: RuleCardContentProps) {
  return (
    <>
      <Text style={styles.ruleName} numberOfLines={1}>
        {rule.name}
      </Text>
      <Text style={styles.ruleSeparator} numberOfLines={1}>
        分隔符：
        {rule.separator === ' ' ? '空格' : SEPARATOR_DISPLAY[rule.separator] || rule.separator}
        {` · ${rule.fieldOrder?.length || 0} 段`}
        {(rule.matchConditions?.length || 0) > 0
          ? ` · ${rule.matchConditions?.length} 个条件`
          : ''}
        {Object.values(rule.fieldPrefixes || {}).some((prefix) => prefix.trim())
          ? ` · ${Object.values(rule.fieldPrefixes || {}).filter((prefix) => prefix.trim()).length} 个前缀`
          : ''}
      </Text>
      {rule.conditionMode && rule.conditionMode !== 'all' && (
        <Text style={styles.ruleSeparator} numberOfLines={1}>
          条件关系：{CONDITION_MODE_LABELS[rule.conditionMode]}
        </Text>
      )}
      {!!rule.terminator && (
        <Text style={styles.ruleSeparator} numberOfLines={1}>
          结束符：{displayRuleTerminator(rule.terminator)}
        </Text>
      )}
      <Text style={styles.ruleFields} numberOfLines={1}>
        字段：
        {rule.fieldOrder?.length
          ? rule.fieldOrder
              .map((field, index) => {
                const label = isIgnoredRuleField(field) ? '忽略此段' : FIELD_LABELS[field] || field;
                return index === 0 ? label : ` → ${label}`;
              })
              .join('')
          : '未配置'}
      </Text>
    </>
  );
});

interface RuleListItemProps {
  rule: QRCodeRule;
  onEdit: (rule: QRCodeRule) => void;
  onToggle: (rule: QRCodeRule) => void;
  onMore: (rule: QRCodeRule) => void;
}

export const RuleListItem = memo(function RuleListItem({
  rule,
  onEdit,
  onToggle,
  onMore,
}: RuleListItemProps) {
  const { theme } = useTheme();
  const styles = useResponsiveStyles(theme, createStyles);
  return (
      <View style={styles.ruleItem}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`编辑规则${rule.name}`}
          style={styles.ruleContent}
          activeOpacity={0.86}
          onPress={() => onEdit(rule)}
        >
          <RuleCardContent rule={rule} styles={styles} />
        </TouchableOpacity>
        <View style={styles.ruleSwitch}>
          <UiSwitch
            size="compact"
            accessibilityLabel={`启用规则${rule.name}`}
            value={rule.isActive}
            onValueChange={() => onToggle(rule)}
          />
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`管理规则${rule.name}`}
          style={styles.ruleMore} onPress={() => onMore(rule)}>
          <Feather name="more-horizontal" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>
  );
});

export const RuleFolderCard = memo(function RuleFolderCard({ folder, count, onOpen }: {
  folder: QRCodeRuleFolder; count: number; onOpen: (id: string) => void;
}) {
  const { theme } = useTheme();
  const styles = useResponsiveStyles(theme, createStyles);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`打开文件夹${folder.name}`}
    onPress={() => onOpen(folder.id)} style={styles.folderCard}>
    <Feather name="folder" size={22} color={theme.primary} />
    <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
    <Text style={styles.folderCount}>{count} 条规则</Text>
    <Feather name="chevron-right" size={18} color={theme.textMuted} />
  </TouchableOpacity>;
});
