import type { BarcodeScanningResult } from 'expo-camera';

export const getScanGuideSize = (width: number, height: number): number =>
  Math.floor(Math.min(width * 0.72, height * 0.65, 320));

/** Use all four QR corners, never just its center. Missing geometry fails closed. */
export function isQrInsideScanGuide(
  result: Pick<BarcodeScanningResult, 'type' | 'cornerPoints'>,
  width: number, height: number, size: number,
): boolean {
  if (result.type !== 'qr' || ![width, height, size].every(value => Number.isFinite(value) && value > 0) ||
    size > Math.min(width, height) || result.cornerPoints?.length !== 4) return false;
  const left = (width - size) / 2;
  const top = (height - size) / 2;
  const points = result.cornerPoints;
  if (!points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= left && point.x <= left + size && point.y >= top && point.y <= top + size)) return false;
  return Math.max(...points.map(p => p.x)) > Math.min(...points.map(p => p.x)) &&
    Math.max(...points.map(p => p.y)) > Math.min(...points.map(p => p.y));
}
