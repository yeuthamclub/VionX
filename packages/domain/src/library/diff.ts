// Import planning (TASK_PACKS/M05.md): idempotent by code + content hash. Changed entities are
// updated (version + 1), entities of the package's scope missing from the package are archived,
// never deleted.

/** Stable JSON: object keys sorted, undefined dropped. Hash input for `content_hash`. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export interface ExistingEntity {
  hash: string;
  archived: boolean;
}

export interface EntityDiff {
  added: string[];
  updated: string[];
  /** Present before, absent from the package: archived on apply. */
  archived: string[];
  /** Archived before, present again: restored on apply (counted as updated too). */
  restored: string[];
  unchanged: number;
}

export function diffEntities(
  existing: ReadonlyMap<string, ExistingEntity>,
  incoming: ReadonlyMap<string, string>,
): EntityDiff {
  const diff: EntityDiff = { added: [], updated: [], archived: [], restored: [], unchanged: 0 };
  for (const [code, hash] of incoming) {
    const before = existing.get(code);
    if (!before) diff.added.push(code);
    else if (before.hash !== hash || before.archived) {
      diff.updated.push(code);
      if (before.archived) diff.restored.push(code);
    } else diff.unchanged++;
  }
  for (const [code, before] of existing) {
    if (!incoming.has(code) && !before.archived) diff.archived.push(code);
  }
  for (const list of [diff.added, diff.updated, diff.archived, diff.restored]) list.sort();
  return diff;
}

export const isNoopDiff = (diffs: Record<string, EntityDiff>) =>
  Object.values(diffs).every((d) => d.added.length + d.updated.length + d.archived.length === 0);
