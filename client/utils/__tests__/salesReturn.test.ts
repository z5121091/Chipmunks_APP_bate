import type { SaleDispatchLine } from '../erpSaleDispatch';
import { buildSalesReturnNotes, getSaleDispatchDirection, normalizeSaleReturnLines } from '../salesReturn';

const line = (quantity: number, inventoryCode = 'A'): SaleDispatchLine => ({
  inventoryCode, quantity, inventoryName: inventoryCode, specification: inventoryCode,
  unitName: 'PCS', raw: { Quantity: quantity },
});

describe('sales dispatch direction', () => {
  it('accepts repeated inventory lines with a single positive or negative direction', () => {
    expect(getSaleDispatchDirection([line(100), line(20)])).toBe('outbound');
    expect(getSaleDispatchDirection([line(-100), line(-20)])).toBe('sales_return');
  });

  it.each([0, -0, 1.5, -1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantity %s even beside a valid return line', (quantity) => {
      expect(getSaleDispatchDirection([line(-100), line(quantity)])).toBe('invalid');
    }
  );

  it('rejects empty and mixed direction vouchers without netting quantities', () => {
    expect(getSaleDispatchDirection([])).toBe('invalid');
    expect(getSaleDispatchDirection([line(-100), line(100)])).toBe('invalid');
    expect(getSaleDispatchDirection([line(100), line(-20)])).toBe('invalid');
  });
});

it('normalizes a separate calculation copy while preserving frozen ERP negative quantities', () => {
  const original = line(-100);
  Object.freeze(original.raw);
  Object.freeze(original);
  const source = Object.freeze([original]);
  const normalized = normalizeSaleReturnLines(source);
  expect(normalized).not.toBe(source);
  expect(normalized[0]).not.toBe(original);
  expect(normalized[0]).toMatchObject({ quantity: 100, inventoryCode: 'A' });
  expect(normalized[0].raw).toBe(original.raw);
  expect(original.quantity).toBe(-100);
  expect(original.raw.Quantity).toBe(-100);
});

it('rejects invalid normalization so a normal dispatch cannot be silently converted to a return', () => {
  for (const lines of [[], [line(100)], [line(-100), line(20)], [line(-1.5)], [line(0)]]) {
    expect(() => normalizeSaleReturnLines(lines)).toThrow('销售退货单必须全部为负整数数量');
  }
});

describe('sales return audit notes', () => {
  it('records the actual trace verification level without repeating the customer field', () => {
    expect(buildSalesReturnNotes('trace_matched'))
      .toBe('销售退货；已匹配历史发货记录');
    expect(buildSalesReturnNotes('trace_unknown'))
      .toBe('销售退货；未查到该追溯码的历史发货记录；历史来源未知');
    expect(buildSalesReturnNotes('batch'))
      .toBe('销售退货；按批次核对，未校验原追溯码；批次不限制客户');
  });

  it('appends operator notes without replacing verification evidence', () => {
    expect(buildSalesReturnNotes('batch', ' 外包装破损 '))
      .toBe('销售退货；按批次核对，未校验原追溯码；批次不限制客户；外包装破损');
    expect(buildSalesReturnNotes('trace_unknown', '  '))
      .toBe('销售退货；未查到该追溯码的历史发货记录；历史来源未知');
  });
});
