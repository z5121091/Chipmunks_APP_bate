import { AppPressable as TouchableOpacity } from '@/components/AppPressable';
import { APP_MOTION } from '@/constants/motion';
import { memo, useCallback, useMemo } from 'react';
import { Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '@/hooks/useTheme';
import { FIELD_LABELS, type QRCodeRule } from '@/utils/database';
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
  onDelete: (rule: QRCodeRule) => void;
  onEnterSort: () => void;
  onRegister: (id: string, instance: Swipeable | null) => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}

export const RuleListItem = memo(function RuleListItem({
  rule,
  onEdit,
  onToggle,
  onDelete,
  onEnterSort,
  onRegister,
  onOpen,
  onClose,
}: RuleListItemProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const register = useCallback(
    (instance: Swipeable | null) => onRegister(rule.id, instance),
    [onRegister, rule.id]
  );
  return (
    <Swipeable
      containerStyle={styles.swipeContainer}
      ref={register}
      onSwipeableWillOpen={() => onOpen(rule.id)}
      onSwipeableClose={() => onClose(rule.id)}
      renderLeftActions={() => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`删除规则${rule.name}`}
          style={styles.deleteAction}
          activeOpacity={0.86}
          onPress={() => onDelete(rule)}
        >
          <Feather name="trash-2" size={18} color={theme.buttonPrimaryText} />
          <Text style={styles.deleteActionText}>删除</Text>
        </TouchableOpacity>
      )}
      overshootLeft={false}
      leftThreshold={48}
      failOffsetY={[-18, 18]}
      friction={2}
      animationOptions={APP_MOTION.swipe}
    >
      <View style={styles.ruleItem}>
        <TouchableOpacity
          style={styles.ruleContent}
          activeOpacity={0.86}
          onPress={() => onEdit(rule)}
          onLongPress={onEnterSort}
          delayLongPress={500}
        >
          <RuleCardContent rule={rule} styles={styles} />
        </TouchableOpacity>
        <View style={styles.ruleSwitch}>
          <Switch
            value={rule.isActive}
            onValueChange={() => onToggle(rule)}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor={theme.buttonPrimaryText}
          />
        </View>
      </View>
    </Swipeable>
  );
});
