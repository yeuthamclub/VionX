// Comparing answer keys with a verifier's blind answer (TASK_PACKS/X01.md step 10).
import type { ItemAnswer, ItemType } from '@vionx/domain';
import { parseNumberText, sameNumber } from './math.ts';
import { normaliseText } from './text.ts';

export function parseAnswerJson(text: string | null | undefined): ItemAnswer | null {
  if (text === null || text === undefined || text.trim() === '' || text.trim() === 'null')
    return null;
  const value = JSON.parse(text) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('answer must be a JSON object');
  return value as ItemAnswer;
}

const sorted = (xs: unknown) => (Array.isArray(xs) ? [...xs].map(String).sort() : []);
const sameList = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

function sameBlank(accepted: string[], given: string): boolean {
  const g = parseNumberText(given);
  return accepted.some((a) => {
    const n = parseNumberText(a);
    return n !== null && g !== null ? sameNumber(n, g) : normaliseText(a) === normaliseText(given);
  });
}

/** True when `given` (verifier) answers the item the same way as `key`. */
export function answersAgree(
  type: ItemType,
  key: ItemAnswer | null,
  given: ItemAnswer | null,
): boolean {
  if (key === null || given === null) return false;
  const k = key as Record<string, unknown>;
  const g = given as Record<string, unknown>;
  switch (type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return typeof k.optionId === 'string' && k.optionId === g.optionId;
    case 'multi_choice':
      return sameList(k.optionIds, g.optionIds);
    case 'numeric':
      return (
        typeof k.value === 'number' &&
        typeof g.value === 'number' &&
        sameNumber(k.value, g.value, (k.tolerance as number | undefined) ?? 0)
      );
    case 'true_false':
      return typeof k.value === 'boolean' && k.value === g.value;
    case 'fill_blank': {
      const kb = (k.blanks as string[][] | undefined) ?? [];
      const gb = (g.blanks as string[][] | undefined) ?? [];
      return kb.length === gb.length && kb.every((acc, i) => gb[i]?.some((x) => sameBlank(acc, x)));
    }
    case 'word_bank':
      return JSON.stringify(k.blankOptionIds) === JSON.stringify(g.blankOptionIds);
    case 'ordering':
      return JSON.stringify(k.order) === JSON.stringify(g.order);
    case 'matching': {
      const norm = (p: unknown) =>
        JSON.stringify(((p as [string, string][]) ?? []).map((x) => x.join('→')).sort());
      return norm(k.pairs) === norm(g.pairs);
    }
    case 'written':
      return false;
  }
}
