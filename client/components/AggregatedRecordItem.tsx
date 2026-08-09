import React from 'react';
import {
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  getRecordRenderSignature,
  type RecordRenderSignatureField,
} from '@/utils/recordRenderSignature';

type AggregatedRecordItemProps<TRecord> = {
  groupKey: string;
  model: string;
  version?: string;
  totalQuantity: number;
  records: readonly TRecord[];
  isExpanded: boolean;
  onToggle: (key: string) => void;
  recordSignatureFields: readonly RecordRenderSignatureField<TRecord>[];
  compareValues?: readonly unknown[];
  containerStyle?: StyleProp<ViewStyle>;
  rowStyle: StyleProp<ViewStyle>;
  contentStyle: StyleProp<ViewStyle>;
  titleStyle: StyleProp<TextStyle>;
  subtitleStyle: StyleProp<TextStyle>;
  quantityStyle?: StyleProp<TextStyle>;
  detailsContainerStyle: StyleProp<ViewStyle>;
  chevronColor?: string;
  toggleOnRowPress?: boolean;
  renderLeading?: (groupKey: string) => React.ReactNode;
  renderRight?: () => React.ReactNode;
  renderDetail: (record: TRecord) => React.ReactNode;
};

const areCompareValuesEqual = (
  previousValues: readonly unknown[] = [],
  nextValues: readonly unknown[] = []
): boolean => {
  if (previousValues.length !== nextValues.length) {
    return false;
  }

  return previousValues.every((value, index) => Object.is(value, nextValues[index]));
};

function AggregatedRecordItemComponent<TRecord>({
  groupKey,
  model,
  version,
  totalQuantity,
  records,
  isExpanded,
  onToggle,
  containerStyle,
  rowStyle,
  contentStyle,
  titleStyle,
  subtitleStyle,
  quantityStyle,
  detailsContainerStyle,
  chevronColor = '#64748B',
  toggleOnRowPress = true,
  renderLeading,
  renderRight,
  renderDetail,
}: AggregatedRecordItemProps<TRecord>) {
  const toggle = () => onToggle(groupKey);

  const content = (
    <View style={contentStyle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Feather
          name={isExpanded ? 'chevron-down' : 'chevron-right'}
          size={14}
          color={chevronColor}
        />
        <Text style={titleStyle}>{model}</Text>
      </View>
      <Text style={subtitleStyle}>版本: {version || '-'}</Text>
    </View>
  );

  return (
    <View style={containerStyle}>
      <TouchableOpacity
        style={rowStyle}
        activeOpacity={0.7}
        onPress={toggleOnRowPress ? toggle : undefined}
      >
        {renderLeading?.(groupKey)}
        {toggleOnRowPress ? (
          content
        ) : (
          <TouchableOpacity style={contentStyle} activeOpacity={0.7} onPress={toggle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather
                name={isExpanded ? 'chevron-down' : 'chevron-right'}
                size={14}
                color={chevronColor}
              />
              <Text style={titleStyle}>{model}</Text>
            </View>
            <Text style={subtitleStyle}>版本: {version || '-'}</Text>
          </TouchableOpacity>
        )}
        {renderRight ? (
          renderRight()
        ) : (
          <Text style={quantityStyle}>{totalQuantity.toLocaleString()}</Text>
        )}
      </TouchableOpacity>

      {isExpanded ? (
        <View style={detailsContainerStyle}>{records.map((record) => renderDetail(record))}</View>
      ) : null}
    </View>
  );
}

export const AggregatedRecordItem = React.memo(
  AggregatedRecordItemComponent,
  (previous, next) =>
    previous.groupKey === next.groupKey &&
    previous.model === next.model &&
    previous.version === next.version &&
    previous.totalQuantity === next.totalQuantity &&
    previous.isExpanded === next.isExpanded &&
    previous.chevronColor === next.chevronColor &&
    previous.onToggle === next.onToggle &&
    previous.toggleOnRowPress === next.toggleOnRowPress &&
    previous.renderLeading === next.renderLeading &&
    previous.renderDetail === next.renderDetail &&
    previous.recordSignatureFields === next.recordSignatureFields &&
    areCompareValuesEqual(previous.compareValues, next.compareValues) &&
    getRecordRenderSignature(previous.records, previous.recordSignatureFields) ===
      getRecordRenderSignature(next.records, next.recordSignatureFields)
) as typeof AggregatedRecordItemComponent;
