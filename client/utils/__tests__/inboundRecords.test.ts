import {
  buildInboundModelKey,
  buildInboundModelVersionKey,
  deduplicateInboundRowsById,
  normalizeInboundModel,
  normalizeInboundVersion,
  resolveInboundInventoryCodeFromBindings,
} from '../inboundRecords';

describe('inboundRecords', () => {
  it('groups model and version without being affected by spaces or letter case', () => {
    expect(buildInboundModelVersionKey(' APM32E030C8T6 ', ' b1 ')).toBe(
      buildInboundModelVersionKey('apm32e030c8t6', 'B1')
    );
    expect(normalizeInboundModel(' MODEL-A ')).toBe('MODEL-A');
    expect(normalizeInboundVersion(' V2 ')).toBe('V2');
  });

  it('keeps two versions under one model group', () => {
    expect(buildInboundModelKey(' MODEL-A ')).toBe(buildInboundModelKey('model-a'));
    expect(buildInboundModelVersionKey('MODEL-A', 'V1')).not.toBe(
      buildInboundModelVersionKey('MODEL-A', 'V2')
    );
  });

  it('prefers an exact version binding and falls back to the unversioned binding', () => {
    const bindings = [
      { scan_model: 'MODEL-A', version: '', inventory_code: 'ic.default' },
      { scan_model: 'model-a', version: 'V2', inventory_code: 'ic.v2' },
    ];

    expect(resolveInboundInventoryCodeFromBindings(bindings, ' MODEL-A ', 'v2')).toBe('ic.v2');
    expect(resolveInboundInventoryCodeFromBindings(bindings, 'model-a', 'V3')).toBe('ic.default');
  });

  it('removes duplicate query rows with the same database id only', () => {
    const records = [
      { id: 'row-1', quantity: 100 },
      { id: 'row-1', quantity: 100 },
      { id: 'row-2', quantity: 100 },
      { id: '', quantity: 100 },
      { id: '', quantity: 100 },
    ];

    expect(deduplicateInboundRowsById(records)).toHaveLength(4);
  });
});
