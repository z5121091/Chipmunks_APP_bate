import { bindingMatchesVersion, getBindingVersions } from './bindingVersions';

export type InventoryBindingIdentity = {
  scan_model?: string | null;
  version?: string | null;
  versions?: readonly string[];
  inventory_code?: string | null;
};

export const normalizeInboundModel = (value?: string | null): string =>
  (value || '').trim();

export const normalizeInboundVersion = (value?: string | null): string =>
  (value || '').trim();

export const buildInboundModelKey = (model?: string | null): string =>
  normalizeInboundModel(model).toUpperCase();

export const buildInboundModelVersionKey = (
  model?: string | null,
  version?: string | null
): string =>
  `${buildInboundModelKey(model)}\u0001${normalizeInboundVersion(version).toUpperCase()}`;

export const resolveInboundInventoryCodeFromBindings = (
  bindings: readonly InventoryBindingIdentity[],
  model?: string | null,
  version?: string | null
): string => {
  const modelKey = buildInboundModelKey(model);
  if (!modelKey) {
    return '';
  }

  let defaultInventoryCode = '';
  for (const binding of bindings) {
    if (normalizeInboundModel(binding.scan_model).toUpperCase() !== modelKey) {
      continue;
    }

    const inventoryCode = (binding.inventory_code || '').trim();
    if (!inventoryCode) {
      continue;
    }

    if (bindingMatchesVersion(binding, version)) {
      return inventoryCode;
    }
    if (getBindingVersions(binding).length === 0 && !defaultInventoryCode) {
      defaultInventoryCode = inventoryCode;
    }
  }

  return defaultInventoryCode;
};

export const deduplicateInboundRowsById = <T extends { id?: string | null }>(
  records: readonly T[]
): T[] => {
  const seenIds = new Set<string>();

  return records.filter((record) => {
    const id = (record.id || '').trim();
    if (!id) {
      return true;
    }
    if (seenIds.has(id)) {
      return false;
    }
    seenIds.add(id);
    return true;
  });
};
