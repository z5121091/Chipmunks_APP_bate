import { moveRuleForDrag } from '../ruleListDrag';

const heights = { a: 90, b: 130, c: 100, d: 150 };
const gap = 10;

it('keeps a short card under the finger when crossing taller and shorter rows', () => {
  const original = ['a', 'b', 'c', 'd'];
  const first = moveRuleForDrag(original, 0, 0, 80, heights, gap);
  expect(first.order).toEqual(['b', 'a', 'c', 'd']);
  expect(first.accumulated).toBe(140);
  expect(first.offset + heights.b + gap).toBe(80);
  const second = moveRuleForDrag(first.order, first.index, first.accumulated, 260, heights, gap);
  expect(second.order).toEqual(['b', 'c', 'a', 'd']);
  expect(second.offset + heights.b + heights.c + 2 * gap).toBe(260);
  const reverse = moveRuleForDrag(second.order, second.index, second.accumulated, 0, heights, gap);
  expect(reverse.order).toEqual(original);
  expect(reverse.offset).toBe(0);
  expect(original).toEqual(['a', 'b', 'c', 'd']);
});

it('does not oscillate at mixed-height swap boundaries on repeated scroll events', () => {
  const first = moveRuleForDrag(['a', 'b', 'c', 'd'], 0, 0, 71, heights, gap);
  const repeat = moveRuleForDrag(first.order, first.index, first.accumulated, 71, heights, gap);
  expect(repeat).toEqual(first);
  expect(repeat.order).toBe(first.order);
});

it('keeps geometry stable across hundreds of rows in both directions', () => {
  const order = Array.from({ length: 500 }, (_, i) => String(i));
  const measured = Object.fromEntries(order.map((id, i) => [id, i % 2 ? 135 : 100]));
  const distance = order.slice(1).reduce((sum, id) => sum + measured[id] + gap, 0);
  const last = moveRuleForDrag(order, 0, 0, distance, measured, gap);
  expect(last.index).toBe(499);
  expect(last.offset).toBe(0);
  expect(last.order[499]).toBe('0');
  const back = moveRuleForDrag(last.order, last.index, last.accumulated, 0, measured, gap);
  expect(back.order).toEqual(order);
  expect(back.offset).toBe(0);
});
