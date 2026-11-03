import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { BarcodeScanningResult } from 'expo-camera';
import { isQrInsideScanGuide } from '../scanGuide';

// Exercise the installed dependency, so dropping the pnpm patch fails this regression.
const file = join(dirname(require.resolve('expo-camera/package.json')), 'build/web/useWebBarcodeScanner.js');
const source = readFileSync(file, 'utf8');
const start = source.indexOf('export function mapToViewCoordinates');
const end = source.indexOf('export function useWebBarcodeScanner');
if (start < 0 || end < start) throw new Error('Camera Web coordinate patch is missing');
const map = runInNewContext(source.slice(start, end).replace('export ', '') + ';mapToViewCoordinates') as
  (result: BarcodeScanningResult, videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number, mirrored: boolean) => BarcodeScanningResult;
const qr = (x: number, y: number, size: number): BarcodeScanningResult => ({ type: 'qr', data: 'test',
  bounds: { origin: { x, y }, size: { width: size, height: size } },
  cornerPoints: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }],
});
it('accounts for horizontal cropping in a portrait preview', () => {
  const result = map(qr(180, 80, 40), 400, 200, 200, 400, false);
  expect(result.cornerPoints[0]).toEqual({ x: 60, y: 160 });
  expect(isQrInsideScanGuide(result, 200, 400, 150)).toBe(true);
  expect(isQrInsideScanGuide(map(qr(0, 0, 40), 400, 200, 200, 400, false), 200, 400, 150)).toBe(false);
});
it('accounts for vertical cropping in a landscape preview', () => {
  const result = map(qr(80, 180, 40), 200, 400, 400, 200, false);
  expect(result.cornerPoints[0]).toEqual({ x: 160, y: 60 });
  expect(isQrInsideScanGuide(result, 400, 200, 150)).toBe(true);
});
it('maps mirrored bounds and corners together', () => {
  const result = map(qr(160, 80, 20), 400, 200, 200, 400, true);
  expect(result.bounds.origin).toEqual({ x: 140, y: 160 });
  expect(result.cornerPoints[0]).toEqual({ x: 180, y: 160 });
});
