// Judging a child's response against an item's answer (static, or the variant of a stored seed).
import type { ItemAnswer, ItemType } from '../library/types.ts';

/**
 * Response shapes mirror the answer shapes (library/types.ts ItemAnswer); numeric responses may be
 * text as typed on the keypad ("3,5").
 */
export type ItemResponse =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: number | string | boolean }
  | { blanks: string[] }
  | { blankOptionIds: string[] }
  | { order: string[] }
  | { pairs: [string, string][] };

/** Item types a session serves; `written` waits for M17. */
export const PRACTICE_ITEM_TYPES = [
  'single_choice',
  'multi_choice',
  'numeric',
  'fill_blank',
  'word_bank',
  'picture_choice',
  'ordering',
  'matching',
  'true_false',
  'spelling_choice',
] as const satisfies readonly ItemType[];

/** Lowercase, trimmed, single spaces, NFC; a decimal comma or point compare equal for numbers. */
export const normaliseText = (s: string) =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');

/** Parses "1 234,5", "3.5", "-2" (Vietnamese decimal comma accepted). */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set(a).size === a.length && a.every((v) => b.includes(v));

/** `null` when the response does not fit the item type (the api answers 400). */
export function judgeAnswer(type: ItemType, answer: ItemAnswer, response: unknown): boolean | null {
  const r = (response && typeof response === 'object' ? response : {}) as Record<string, unknown>;
  const a = answer as Record<string, unknown>;
  const strings = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  switch (type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return typeof r.optionId === 'string' ? r.optionId === a.optionId : null;
    case 'multi_choice': {
      const ids = strings(r.optionIds);
      return ids ? sameSet(ids, a.optionIds as string[]) : null;
    }
    case 'true_false':
      return typeof r.value === 'boolean' ? r.value === a.value : null;
    case 'numeric': {
      const n = parseNumber(r.value);
      if (n === null) return null;
      const tolerance = typeof a.tolerance === 'number' ? a.tolerance : 0;
      return Math.abs(n - (a.value as number)) <= tolerance + 1e-9;
    }
    case 'fill_blank': {
      const blanks = strings(r.blanks);
      const accepted = a.blanks as string[][];
      if (!blanks || blanks.length !== accepted.length) return null;
      return blanks.every((text, i) => {
        const n = parseNumber(text);
        return accepted[i]!.some((ok) =>
          n !== null && parseNumber(ok) !== null
            ? Math.abs(n - parseNumber(ok)!) < 1e-9
            : normaliseText(ok) === normaliseText(text),
        );
      });
    }
    case 'word_bank': {
      const ids = strings(r.blankOptionIds);
      return ids ? sameList(ids, a.blankOptionIds as string[]) : null;
    }
    case 'ordering': {
      const order = strings(r.order);
      return order ? sameList(order, a.order as string[]) : null;
    }
    case 'matching': {
      const pairs = r.pairs;
      if (!Array.isArray(pairs) || !pairs.every((p) => strings(p)?.length === 2)) return null;
      const key = (p: readonly string[]) => `${p[0]}\u0000${p[1]}`;
      return sameSet((pairs as string[][]).map(key), (a.pairs as string[][]).map(key));
    }
    case 'written':
      return null;
  }
}

/** The wrong option a response points at, for `distractor_feedback` (choice types only). */
export function chosenWrongOption(type: ItemType, answer: ItemAnswer, response: unknown) {
  const r = (response ?? {}) as { optionId?: unknown; optionIds?: unknown };
  const a = answer as { optionId?: string; optionIds?: string[] };
  if (typeof r.optionId === 'string') return r.optionId === a.optionId ? null : r.optionId;
  if (type === 'multi_choice' && Array.isArray(r.optionIds)) {
    const wrong = r.optionIds.find((id) => typeof id === 'string' && !a.optionIds?.includes(id));
    return typeof wrong === 'string' ? wrong : null;
  }
  return null;
}

/** Number of `___` gaps in a fill_blank / word_bank stem. */
export const countBlanks = (stemMd: string) => (stemMd.match(/_{3,}/g) ?? []).length;
