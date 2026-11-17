export const APP_MODAL_SIDE_MARGIN = 20;
export const APP_MODAL_MAX_WIDTH = 400;
export const APP_MODAL_MIN_WIDTH = 260;

export const getAppModalWidth = (screenWidth: number): number =>
  Math.max(0, Math.min(screenWidth - APP_MODAL_SIDE_MARGIN * 2, APP_MODAL_MAX_WIDTH));

/** A preset's preferred minimum must never exceed the actual usable overlay. */
export const getAppModalAvailableHeight = (windowHeight: number, measuredHeight?: number): number =>
  Math.max(0, Math.min(windowHeight, measuredHeight ?? windowHeight - APP_MODAL_SIDE_MARGIN * 2));

export function getAppModalMaxHeight(availableHeight: number, requestedMaxHeight?: unknown): number {
  const requested = typeof requestedMaxHeight === 'string' && requestedMaxHeight.endsWith('%')
    ? availableHeight * Number.parseFloat(requestedMaxHeight) / 100
    : requestedMaxHeight;
  return typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(0, Math.min(availableHeight, requested))
    : availableHeight;
}
