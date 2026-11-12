import { findErpWarehouse } from '../erpWarehouse';

describe('ERP warehouse archive matching', () => {
  const archive = [
    { id: 'W1', name: '无锡总仓' },
    { id: 'W2', name: 'Suzhou Warehouse' },
  ];

  it('uses the exact archived name before equivalent text fallbacks', () => {
    expect(findErpWarehouse(' 无锡总仓 ', archive)).toBe(archive[0]);
    const namesDifferingByCase = [{ name: 'WH-A' }, { name: 'wh-a' }];
    expect(findErpWarehouse('WH-A', namesDifferingByCase)).toBe(namesDifferingByCase[0]);
  });

  it('accepts a unique case or full-width equivalent without changing the archive', () => {
    expect(findErpWarehouse(' SUZHOU WAREHOUSE ', archive)).toBe(archive[1]);
    expect(findErpWarehouse('Ｓｕｚｈｏｕ Ｗａｒｅｈｏｕｓｅ', archive)).toBe(archive[1]);
  });

  it('refuses missing names, unconfigured aliases and ambiguous matches', () => {
    expect(findErpWarehouse(null, archive)).toBeNull();
    expect(findErpWarehouse('  ', archive)).toBeNull();
    expect(findErpWarehouse('无锡仓库', archive)).toBeNull();
    expect(findErpWarehouse('SuzhouWarehouse', archive)).toBeNull();
    expect(findErpWarehouse('Wh-A', [{ name: 'WH-A' }, { name: 'wh-a' }])).toBeNull();
    expect(findErpWarehouse('无锡总仓', [{ name: '无锡总仓' }, { name: ' 无锡总仓 ' }])).toBeNull();
  });
});
