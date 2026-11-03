import { isQrInsideScanGuide } from '../scanGuide';
const qr = (left: number, top: number, right: number, bottom: number) => ({ type: 'qr', cornerPoints: [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
] });
it('accepts only the complete QR in the centered square', () => {
  // Camera 300x500, guide 200x200: x=50..250, y=150..350.
  expect(isQrInsideScanGuide(qr(60, 160, 240, 340), 300, 500, 200)).toBe(true);
  expect(isQrInsideScanGuide(qr(50, 150, 250, 350), 300, 500, 200)).toBe(true);
});
it.each([[0, 0, 30, 30], [49, 160, 240, 340], [60, 149, 240, 340],
  [60, 160, 251, 340], [60, 160, 240, 351], [20, 100, 280, 400]])(
  'rejects outside, crossing and larger-than-guide QR', (l, t, r, b) => {
    expect(isQrInsideScanGuide(qr(l, t, r, b), 300, 500, 200)).toBe(false);
  });
it('handles rotated and unordered corners without relying on their order', () => {
  const rotated = { type: 'qr', cornerPoints: [{ x: 150, y: 160 }, { x: 60, y: 250 }, { x: 240, y: 250 }, { x: 150, y: 340 }] };
  expect(isQrInsideScanGuide(rotated, 300, 500, 200)).toBe(true);
});
it('rejects unknown, degenerate or nonfinite geometry', () => {
  expect(isQrInsideScanGuide({ type: 'qr', cornerPoints: [] }, 300, 500, 200)).toBe(false);
  expect(isQrInsideScanGuide(qr(100, 200, 100, 200), 300, 500, 200)).toBe(false);
  expect(isQrInsideScanGuide(qr(NaN, 200, 200, 300), 300, 500, 200)).toBe(false);
  expect(isQrInsideScanGuide(qr(100, 200, 200, 300), 0, 0, 0)).toBe(false);
});
