export const APP_MODAL_SIDE_MARGIN = 20;
export const APP_MODAL_MAX_WIDTH = 400;
export const APP_MODAL_MIN_WIDTH = 260;

export const getAppModalWidth = (screenWidth: number): number =>
  Math.min(
    Math.max(screenWidth - APP_MODAL_SIDE_MARGIN * 2, APP_MODAL_MIN_WIDTH),
    APP_MODAL_MAX_WIDTH
  );
