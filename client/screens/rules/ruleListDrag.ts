export function moveRuleForDrag(
  order: string[],
  index: number,
  accumulated: number,
  translation: number,
  heights: Record<string, number>,
  gap: number,
) {
  let nextOrder = order;
  let offset = translation - accumulated;
  if (index < 0 || index >= order.length) return { order, index, accumulated, offset: 0 };

  const swap = (neighbor: number, distance: number) => {
    if (nextOrder === order) nextOrder = order.slice();
    [nextOrder[index], nextOrder[neighbor]] = [nextOrder[neighbor], nextOrder[index]];
    index = neighbor;
    accumulated += distance;
    offset = translation - accumulated;
  };

  // 拖动项跨过一行后，位置按被跨过行的高度计算。
  while (index < nextOrder.length - 1) {
    const step = (heights[nextOrder[index + 1]] ?? 108) + gap;
    if (offset <= step / 2) break;
    swap(index + 1, step);
  }
  while (index > 0) {
    const step = (heights[nextOrder[index - 1]] ?? 108) + gap;
    if (offset >= -step / 2) break;
    swap(index - 1, -step);
  }
  return { order: nextOrder, index, accumulated, offset };
}
