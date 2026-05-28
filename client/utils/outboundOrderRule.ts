import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/config';
import { safeJsonParseNullable } from '@/utils/json';

export interface OutboundOrderRuleConfig {
  sample: string;
  prefix: string;
  separator: string;
  segmentCount: number;
  sequenceSegmentIndex: number;
  sequenceLengths: number[];
}

interface LegacyOutboundOrderRuleConfig {
  prefix?: string;
  separator?: string;
  dateFormat?: 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY/MM/DD';
  sequenceLengths?: number[];
}

export interface ParsedOutboundOrderNo {
  orderNo: string;
  sequence: string;
  sequenceLength: number;
}

export interface OutboundOrderRuleSummary {
  prefix: string;
  separator: string;
  segmentCount: number;
  sequence: string;
  sequenceLength: number;
}

export type OutboundWarehouseOrderRuleMap = Record<string, number[]>;
export type OutboundWarehouseSampleRuleMap = Record<string, OutboundOrderRuleConfig>;

export const DEFAULT_OUTBOUND_ORDER_RULE: OutboundOrderRuleConfig = {
  sample: 'IO-2000-01-01-01',
  prefix: 'IO',
  separator: '-',
  segmentCount: 5,
  sequenceSegmentIndex: 4,
  sequenceLengths: [2],
};

const MAX_SEQUENCE_LENGTH = 6;
const SUPPORTED_SEPARATORS = ['-', '/', '_'] as const;

const isValidSequenceLength = (length: unknown): length is number => {
  return (
    typeof length === 'number' &&
    Number.isInteger(length) &&
    length > 0 &&
    length <= MAX_SEQUENCE_LENGTH
  );
};

export const isOutboundOrderRuleConfig = (value: unknown): value is OutboundOrderRuleConfig => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as OutboundOrderRuleConfig;
  return (
    typeof candidate.sample === 'string' &&
    typeof candidate.prefix === 'string' &&
    typeof candidate.separator === 'string' &&
    typeof candidate.segmentCount === 'number' &&
    typeof candidate.sequenceSegmentIndex === 'number' &&
    Array.isArray(candidate.sequenceLengths) &&
    candidate.sequenceLengths.every(isValidSequenceLength)
  );
};

const isStoredOutboundOrderRuleConfig = (
  value: unknown
): value is Partial<OutboundOrderRuleConfig> & LegacyOutboundOrderRuleConfig => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<OutboundOrderRuleConfig> & LegacyOutboundOrderRuleConfig;
  return typeof candidate.sample === 'string' || typeof candidate.prefix === 'string';
};

const isOutboundWarehouseOrderRuleMap = (
  value: unknown
): value is OutboundWarehouseOrderRuleMap => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).every(([warehouseId, lengths]) => {
    return (
      typeof warehouseId === 'string' &&
      Array.isArray(lengths) &&
      lengths.every(isValidSequenceLength)
    );
  });
};

const isOutboundWarehouseSampleRuleMap = (
  value: unknown
): value is OutboundWarehouseSampleRuleMap => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).every(([warehouseId, rule]) => {
    return typeof warehouseId === 'string' && isOutboundOrderRuleConfig(rule);
  });
};

const getSeparatorLabel = (separator: string) => (separator === ' ' ? '空格' : separator);

const getSampleSeparator = (sample: string): string => {
  const matched = SUPPORTED_SEPARATORS.filter((separator) => sample.includes(separator));
  if (matched.length === 0) {
    throw new Error('样例需要包含分隔符，例如 - / _');
  }
  if (matched.length > 1) {
    throw new Error('样例暂只支持一种分隔符');
  }
  return matched[0];
};

const splitBySeparator = (value: string, separator: string) => {
  return value.split(separator);
};

const isDigits = (value: string) => /^\d+$/.test(value);

export const inferOutboundOrderRuleFromSample = (sample: string): OutboundOrderRuleConfig => {
  const normalizedSample = sample.trim().replace(/\s+/g, '').toUpperCase();
  if (!normalizedSample) {
    throw new Error('请填写订单号样例');
  }

  const separator = getSampleSeparator(normalizedSample);
  const segments = splitBySeparator(normalizedSample, separator);
  if (segments.length < 3 || segments.some((segment) => !segment)) {
    throw new Error('样例格式不完整，请确认前缀、分隔符和序号');
  }

  const prefix = segments[0];
  if (!prefix || isDigits(prefix)) {
    throw new Error('样例第一段需要是订单号前缀');
  }

  const numericSegments = segments.slice(1);
  if (!numericSegments.every(isDigits)) {
    throw new Error('样例除前缀外，每一段都需要是数字');
  }

  const sequence = segments[segments.length - 1];
  if (sequence.length > MAX_SEQUENCE_LENGTH) {
    throw new Error(`序号最多支持 ${MAX_SEQUENCE_LENGTH} 位`);
  }

  return {
    sample: normalizedSample,
    prefix,
    separator,
    segmentCount: segments.length,
    sequenceSegmentIndex: segments.length - 1,
    sequenceLengths: [sequence.length],
  };
};

const createLegacySample = (value: LegacyOutboundOrderRuleConfig) => {
  const prefix = (value.prefix || DEFAULT_OUTBOUND_ORDER_RULE.prefix)
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  const separator = (value.separator || DEFAULT_OUTBOUND_ORDER_RULE.separator).trim() || '-';
  const sequenceLength = value.sequenceLengths?.find(isValidSequenceLength) || 2;
  const sequence = '1'.padStart(sequenceLength, '0');

  if (value.dateFormat === 'YYYYMMDD') {
    return `${prefix}${separator}20000101${separator}${sequence}`;
  }

  return `${prefix}${separator}2000${separator}01${separator}01${separator}${sequence}`;
};

export const normalizeOutboundOrderRule = (
  value: Partial<OutboundOrderRuleConfig> & LegacyOutboundOrderRuleConfig
): OutboundOrderRuleConfig => {
  if (value.sample) {
    const inferred = inferOutboundOrderRuleFromSample(value.sample);
    const sequenceLengths =
      value.sequenceLengths && value.sequenceLengths.length > 0
        ? parseSequenceLengthsText(formatSequenceLengths(value.sequenceLengths))
        : inferred.sequenceLengths;
    return { ...inferred, sequenceLengths };
  }

  if (value.prefix || value.separator || value.dateFormat) {
    const inferred = inferOutboundOrderRuleFromSample(createLegacySample(value));
    const sequenceLengths =
      value.sequenceLengths && value.sequenceLengths.length > 0
        ? parseSequenceLengthsText(formatSequenceLengths(value.sequenceLengths))
        : inferred.sequenceLengths;
    return { ...inferred, sequenceLengths };
  }

  return DEFAULT_OUTBOUND_ORDER_RULE;
};

export const loadOutboundOrderRule = async (): Promise<OutboundOrderRuleConfig> => {
  const saved = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_ORDER_RULE);
  const parsed = saved
    ? safeJsonParseNullable<Partial<OutboundOrderRuleConfig> & LegacyOutboundOrderRuleConfig>(
        saved,
        'outboundOrderRule',
        isStoredOutboundOrderRuleConfig
      )
    : null;

  return parsed ? normalizeOutboundOrderRule(parsed) : DEFAULT_OUTBOUND_ORDER_RULE;
};

export const saveOutboundOrderRule = async (rule: OutboundOrderRuleConfig): Promise<void> => {
  const normalized = normalizeOutboundOrderRule(rule);
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_ORDER_RULE, JSON.stringify(normalized));
};

export const parseSequenceLengthsText = (value: string): number[] => {
  const lengths = value
    .split(/[,\s，、]+/)
    .map((item) => Number(item.trim()))
    .filter(isValidSequenceLength);

  return Array.from(new Set(lengths)).sort((a, b) => a - b);
};

export const formatSequenceLengths = (lengths: number[]) => lengths.join(',');

export const normalizeOutboundWarehouseOrderRuleMap = (
  value: OutboundWarehouseOrderRuleMap
): OutboundWarehouseOrderRuleMap => {
  return Object.entries(value).reduce<OutboundWarehouseOrderRuleMap>(
    (result, [warehouseId, lengths]) => {
      const normalizedLengths = parseSequenceLengthsText(formatSequenceLengths(lengths));
      if (warehouseId && normalizedLengths.length > 0) {
        result[warehouseId] = normalizedLengths;
      }
      return result;
    },
    {}
  );
};

export const loadOutboundWarehouseOrderRules =
  async (): Promise<OutboundWarehouseSampleRuleMap> => {
    const saved = await AsyncStorage.getItem(STORAGE_KEYS.OUTBOUND_WAREHOUSE_ORDER_RULES);
    const parsed = saved
      ? safeJsonParseNullable<unknown>(
          saved,
          'outboundWarehouseOrderRules'
        )
      : null;

    if (isOutboundWarehouseSampleRuleMap(parsed)) {
      return Object.entries(parsed).reduce<OutboundWarehouseSampleRuleMap>(
        (result, [warehouseId, rule]) => {
          result[warehouseId] = normalizeOutboundOrderRule(rule);
          return result;
        },
        {}
      );
    }

    if (isOutboundWarehouseOrderRuleMap(parsed)) {
      const legacyGlobalRule = await loadOutboundOrderRule();
      return Object.entries(normalizeOutboundWarehouseOrderRuleMap(parsed)).reduce<OutboundWarehouseSampleRuleMap>(
        (result, [warehouseId, lengths]) => {
          const firstLength = lengths[0] || legacyGlobalRule.sequenceLengths[0] || 2;
          result[warehouseId] = {
            ...legacyGlobalRule,
            sample: getOutboundOrderRuleExample(legacyGlobalRule, firstLength),
            sequenceLengths: lengths,
          };
          return result;
        },
        {}
      );
    }

    return {};
  };

export const saveOutboundWarehouseOrderRule = async (
  warehouseId: string,
  rule: OutboundOrderRuleConfig
): Promise<OutboundWarehouseSampleRuleMap> => {
  const current = await loadOutboundWarehouseOrderRules();
  const next = {
    ...current,
    [warehouseId]: normalizeOutboundOrderRule(rule),
  };
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WAREHOUSE_ORDER_RULES, JSON.stringify(next));
  return next;
};

export const clearOutboundWarehouseOrderRule = async (
  warehouseId: string
): Promise<OutboundWarehouseSampleRuleMap> => {
  const current = await loadOutboundWarehouseOrderRules();
  const next = { ...current };
  delete next[warehouseId];
  await AsyncStorage.setItem(STORAGE_KEYS.OUTBOUND_WAREHOUSE_ORDER_RULES, JSON.stringify(next));
  return next;
};

export const parseOutboundOrderNo = (
  value: string,
  rule: OutboundOrderRuleConfig
): ParsedOutboundOrderNo | null => {
  const normalizedRule = normalizeOutboundOrderRule(rule);
  const normalizedValue = value.trim().replace(/\s+/g, '').toUpperCase();
  const segments = splitBySeparator(normalizedValue, normalizedRule.separator);

  if (
    segments.length !== normalizedRule.segmentCount ||
    segments[0] !== normalizedRule.prefix ||
    segments.some((segment) => !segment) ||
    !segments.slice(1).every(isDigits)
  ) {
    return null;
  }

  const sequence = segments[normalizedRule.sequenceSegmentIndex];
  if (
    !sequence ||
    !isDigits(sequence) ||
    sequence.length > MAX_SEQUENCE_LENGTH ||
    !normalizedRule.sequenceLengths.includes(sequence.length)
  ) {
    return null;
  }

  return {
    orderNo: normalizedValue,
    sequence,
    sequenceLength: sequence.length,
  };
};

export const isOutboundOrderNo = (value: string, rule: OutboundOrderRuleConfig): boolean => {
  return parseOutboundOrderNo(value, rule) !== null;
};

export const getOutboundOrderRuleSummary = (
  rule: OutboundOrderRuleConfig
): OutboundOrderRuleSummary => {
  const normalized = normalizeOutboundOrderRule(rule);
  const segments = splitBySeparator(normalized.sample, normalized.separator);
  const sequence = segments[normalized.sequenceSegmentIndex] || '';

  return {
    prefix: normalized.prefix,
    separator: getSeparatorLabel(normalized.separator),
    segmentCount: normalized.segmentCount,
    sequence,
    sequenceLength: sequence.length,
  };
};

export const getOutboundOrderRuleExample = (
  rule: OutboundOrderRuleConfig,
  sequenceLength?: number
): string => {
  const normalized = normalizeOutboundOrderRule(rule);
  const segments = splitBySeparator(normalized.sample, normalized.separator);
  const length =
    sequenceLength && isValidSequenceLength(sequenceLength)
      ? sequenceLength
      : normalized.sequenceLengths[0] || segments[normalized.sequenceSegmentIndex]?.length || 2;
  segments[normalized.sequenceSegmentIndex] = '1'.padStart(length, '0');
  return segments.join(normalized.separator);
};

export const getMatchingOutboundWarehouseOrderRules = (
  value: string,
  warehouseRules: OutboundWarehouseSampleRuleMap
) => {
  return Object.entries(warehouseRules)
    .map(([warehouseId, rule]) => ({
      warehouseId,
      rule,
      parsed: parseOutboundOrderNo(value, rule),
    }))
    .filter((item) => item.parsed !== null);
};

export const doOutboundOrderRulesConflict = (
  first: OutboundOrderRuleConfig,
  second: OutboundOrderRuleConfig
) => {
  const a = normalizeOutboundOrderRule(first);
  const b = normalizeOutboundOrderRule(second);
  const overlaps = a.sequenceLengths.some((length) => b.sequenceLengths.includes(length));

  return (
    a.prefix === b.prefix &&
    a.separator === b.separator &&
    a.segmentCount === b.segmentCount &&
    a.sequenceSegmentIndex === b.sequenceSegmentIndex &&
    overlaps
  );
};

export const getOutboundOrderRuleHint = (rule: OutboundOrderRuleConfig): string => {
  const summary = getOutboundOrderRuleSummary(rule);
  return `${summary.prefix}${summary.separator}同结构，最后一段为数字序号`;
};
