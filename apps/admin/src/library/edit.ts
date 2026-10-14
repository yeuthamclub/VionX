// Pure helpers for the item and group editors.
import { CONTENT_STATUSES, COGNITIVE_LEVELS, ITEM_KINDS, ITEM_TYPES } from './types.ts';

export type JsonField = { ok: true; value: unknown } | { ok: false; error: string };

/** Parses a JSON textarea; the error message is shown next to the field. */
export function parseJsonField(text: string): JsonField {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const toJsonText = (value: unknown): string => JSON.stringify(value ?? null, null, 2);

/** Structural equality for JSON values (key order ignored). */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
      : v,
  );
}

/** The fields of `draft` that differ from `original`; a PATCH sends only these plus `version`. */
export function changedFields<T extends object>(original: T, draft: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!sameJson(original[key], draft[key])) out[key] = draft[key];
  }
  return out;
}

/** Empty text inputs mean "no value" for nullable fields. */
export const nullIfBlank = (text: string): string | null => (text.trim() === '' ? null : text);

/** Readable message for an API error body (`{ code, message, details }`) and HTTP status. */
export function apiErrorText(body: unknown, status: number): string {
  const err = body as { code?: string; message?: string; details?: unknown } | undefined;
  if (status === 409 && err?.code === 'CONFLICT') {
    return `${err.message ?? 'Conflict'} (someone else saved a newer version).`;
  }
  const problems = (err?.details as { problems?: unknown } | undefined)?.problems;
  const extra =
    Array.isArray(problems) && problems.length > 1 ? ` Also: ${problems.slice(1).join('; ')}.` : '';
  if (err?.message) return `${err.message}${extra}`;
  if (status === 403) return 'You do not have permission for this action.';
  return `API responded ${status}`;
}

/** Browser speech-synthesis language for a library TTS language. */
export const speechLang = (lang: 'vi' | 'en' | null | undefined): string =>
  lang === 'en' ? 'en-US' : 'vi-VN';

/** A fresh seed for variant re-roll (the API accepts 0…2^32-1). */
export const randomSeed = (rand: () => number = Math.random): number =>
  Math.floor(rand() * 0x1_0000_0000);

export interface ItemFilters {
  grade?: number;
  subject?: string;
  skill?: string;
  status?: (typeof CONTENT_STATUSES)[number];
  kind?: (typeof ITEM_KINDS)[number];
  type?: (typeof ITEM_TYPES)[number];
  level?: (typeof COGNITIVE_LEVELS)[number];
  q?: string;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/** Item list filters from the URL search params; unknown or invalid values are dropped. */
export function parseItemFilters(search: Record<string, unknown>): ItemFilters {
  const grade = Number(search.grade);
  const filters: ItemFilters = {
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : undefined,
    subject: text(search.subject),
    skill: text(search.skill),
    status: oneOf(CONTENT_STATUSES, search.status),
    kind: oneOf(ITEM_KINDS, search.kind),
    type: oneOf(ITEM_TYPES, search.type),
    level: oneOf(COGNITIVE_LEVELS, search.level),
    q: text(search.q)?.slice(0, 200),
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined),
  ) as ItemFilters;
}
