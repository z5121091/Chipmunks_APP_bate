export interface BindingVersionValues {
  version?: string | null;
  versions?: readonly string[];
}

/** Versions are separate complete values; punctuation inside a version is never a delimiter. */
export const normalizeBindingVersions = (versions: readonly string[]): string[] => {
  const seen = new Set<string>();
  return versions.flatMap(value => {
    const version = typeof value === 'string' ? value.trim() : '';
    const key = version.toUpperCase();
    if (!version || seen.has(key)) return [];
    seen.add(key);
    return [version];
  });
};

export const getBindingVersions = (binding: BindingVersionValues): string[] =>
  normalizeBindingVersions(binding.versions ?? [binding.version ?? '']);

/** An empty list is the legacy generic binding; callers decide whether to use it as a fallback. */
export const bindingMatchesVersion = (
  binding: BindingVersionValues,
  version?: string | null,
): boolean => {
  const key = (version ?? '').trim().toUpperCase();
  const versions = getBindingVersions(binding);
  return versions.length ? versions.some(value => value.toUpperCase() === key) : !key;
};
