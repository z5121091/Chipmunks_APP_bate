export interface ParseQuantityOptions {
  min?: number;
  max?: number;
}

export const parseQuantity = (
  value: unknown,
  options: ParseQuantityOptions = {}
): number | null => {
  const { min = 1, max } = options;

  let normalized: number | null = null;

  if (typeof value === 'number') {
    normalized = Number.isFinite(value) ? value : null;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d+)(?:\s*(?:pcs?|个|件|片|只|箱))?$/iu);
    if (!match) {
      return null;
    }
    normalized = Number(match[1]);
  }

  if (normalized === null || !Number.isSafeInteger(normalized)) {
    return null;
  }

  if (normalized < min) {
    return null;
  }

  if (max !== undefined && normalized > max) {
    return null;
  }

  return normalized;
};
