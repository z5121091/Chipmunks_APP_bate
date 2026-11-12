export function findErpWarehouse<T extends { name: string }>(
  warehouseName: string | null | undefined,
  warehouses: readonly T[],
): T | null {
  const name = warehouseName?.trim();
  if (!name) return null;

  const exactMatches = warehouses.filter((warehouse) => warehouse.name.trim() === name);
  if (exactMatches.length) return exactMatches.length === 1 ? exactMatches[0] : null;

  // Only normalize equivalent text forms. Different warehouse names/aliases must
  // still be archived explicitly, and an ambiguous fallback must never pick one.
  const normalizedName = name.normalize('NFKC').toLowerCase();
  const normalizedMatches = warehouses.filter((warehouse) =>
    warehouse.name.trim().normalize('NFKC').toLowerCase() === normalizedName
  );
  return normalizedMatches.length === 1 ? normalizedMatches[0] : null;
}
