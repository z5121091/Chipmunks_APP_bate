jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import { parseWithRule, type QRCodeRule } from '../database';

describe('二维码规则解析', () => {
  it('忽略记录末尾分隔符，同时保留占位字段的位置', () => {
    const rule: QRCodeRule = {
      id: 'semicolon-with-placeholders',
      name: '分号占位示例',
      description: '',
      separator: ';',
      fieldOrder: [
        'model',
        'batch',
        'productionDate',
        'quantity',
        'traceNo',
        'custom:slot-1',
        'custom:slot-2',
        'sourceNo',
        'custom:slot-3',
        'version',
      ],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule(
      'Pai 122M31;FFXW47.1;2622TC;4000;2606050190128;A;LEVEL2;3001-260605001;1;01-A0030;',
      rule
    );

    expect(parsed.standardFields).toEqual({
      model: 'Pai 122M31',
      batch: 'FFXW47.1',
      productionDate: '2622TC',
      quantity: '4000',
      traceNo: '2606050190128',
      sourceNo: '3001-260605001',
      version: '01-A0030',
    });
    expect(parsed.customFields).toEqual({
      'slot-1': 'A',
      'slot-2': 'LEVEL2',
      'slot-3': '1',
    });
  });

  it('不删除二维码中间的空字段', () => {
    const rule: QRCodeRule = {
      id: 'keep-empty-fields',
      name: '保留空字段',
      description: '',
      separator: ';',
      fieldOrder: ['model', 'custom:unused', 'quantity'],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule('MODEL-A;;2500;', rule);

    expect(parsed.standardFields).toEqual({
      model: 'MODEL-A',
      quantity: '2500',
    });
    expect(parsed.customFields).toEqual({
      unused: '',
    });
  });

  it('正式解析始终使用已配置分隔符，不被内容中的括号结构改写', () => {
    const rule: QRCodeRule = {
      id: 'semicolon-with-bracket-content',
      name: '分号内含括号',
      description: '',
      separator: ';',
      fieldOrder: ['model', 'batch', 'quantity'],
      isActive: true,
      created_at: '',
      updated_at: '',
    };

    const parsed = parseWithRule('{MODEL}{GRADE};LOT-A;2500', rule);

    expect(parsed.standardFields).toEqual({
      model: '{MODEL}{GRADE}',
      batch: 'LOT-A',
      quantity: '2500',
    });
  });
});
