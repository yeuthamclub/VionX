// Code checks run on every generated item before the verifier (TASK_PACKS/X01.md step 9).
// Each check returns ok/message; an item passes when every check is ok.
import {
  HINT_LADDER_LENGTH,
  answerProblem,
  isTemplateItemType,
  probeTemplate,
  renderVariant,
  type ItemTemplate,
  type PackageGroup,
  type PackageItem,
} from '@vionx/domain';
import { ItemTemplateSchema, PackageItemSchema } from '@vionx/contracts';
import { katexProblem } from './katex-check.ts';
import { evaluateExpr, parseNumberText, sameNumber } from './math.ts';
import { normaliseText, readingLevel, type NgramIndex } from './text.ts';
import type { PlanSlot } from './plan.ts';

export const ITEM_CHECKS = [
  'slot',
  'schema',
  'one_correct',
  'recompute',
  'katex',
  'template_seeds',
  'ngram',
  'duplicate',
  'tts',
  'svg',
] as const;
export type ItemCheckName = (typeof ITEM_CHECKS)[number];

export interface CheckResult {
  check: ItemCheckName | 'reading_level';
  ok: boolean;
  message?: string;
}

export interface MediaStatus {
  code: string;
  /** Sanitised without removals and rendered to a non-empty PNG. */
  ok: boolean;
  message?: string;
}

export interface ItemCheckContext {
  slot?: PlanSlot;
  template?: ItemTemplate;
  ngram: NgramIndex;
  /** Normalised content key → code of the first item that used it (filled as items are checked). */
  seen: Map<string, string>;
  media: Map<string, MediaStatus>;
  readAloud: boolean;
  /** Seeds for the template constraint test (1,000 per TASK_PACKS/X01.md). */
  templateSeeds: number;
}

const CHOICE = ['single_choice', 'picture_choice', 'spelling_choice'];
const pass = (check: CheckResult['check']): CheckResult => ({ check, ok: true });
const fail = (check: CheckResult['check'], message: string): CheckResult => ({
  check,
  ok: false,
  message,
});

/** Every text a student sees (stem, options, hints, solutions, feedback). */
export function itemTexts(item: PackageItem, template?: ItemTemplate): string[] {
  return [
    item.stemMd,
    ...item.options.map((o) => o.text ?? ''),
    item.explanationMd,
    item.workedSolutionMd,
    ...item.hints.map((h) => h.md),
    ...Object.values(item.distractorFeedback).map((f) => f.md),
    ...(template ? [template.render.stem, template.render.explanation ?? ''] : []),
  ].filter((t) => t.trim() !== '');
}

function checkSlot(item: PackageItem, slot?: PlanSlot): CheckResult {
  if (!slot) return fail('slot', 'item does not belong to a planned slot');
  const problems: string[] = [];
  if (item.skills.length !== 1 || item.skills[0] !== slot.skill)
    problems.push(`skill ≠ ${slot.skill}`);
  if (item.kind !== slot.kind) problems.push(`kind ${item.kind} ≠ ${slot.kind}`);
  if (item.type !== slot.type) problems.push(`type ${item.type} ≠ ${slot.type}`);
  if (slot.svg && item.media.length === 0) problems.push('planned figure missing');
  return problems.length ? fail('slot', problems.join('; ')) : pass('slot');
}

function checkSchema(item: PackageItem, template?: ItemTemplate): CheckResult {
  const parsed = PackageItemSchema.safeParse(item);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    return fail('schema', `${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  if (item.hints.length !== HINT_LADDER_LENGTH)
    return fail('schema', `needs exactly ${HINT_LADDER_LENGTH} hints (has ${item.hints.length})`);
  if (item.type === 'written') return fail('schema', 'written items are not in this profile');
  if (item.kind === 'TEMPLATE') {
    if (!isTemplateItemType(item.type)) return fail('schema', `${item.type} cannot be a TEMPLATE`);
    if (!template) return fail('schema', 'TEMPLATE item without a template');
    const t = ItemTemplateSchema.safeParse(template);
    if (!t.success) {
      const i = t.error.issues[0]!;
      return fail('schema', `template ${i.path.join('.')}: ${i.message}`);
    }
    const keys = template.distractorExprs.map((_, i) => `d${i + 1}`);
    const unknown = Object.keys(item.distractorFeedback).filter((k) => !keys.includes(k));
    if (unknown.length)
      return fail('schema', `feedback for unknown distractors ${unknown.join(', ')}`);
    return pass('schema');
  }
  const problem = answerProblem(item);
  if (problem) return fail('schema', problem);
  if (CHOICE.includes(item.type) && item.options.length < 2)
    return fail('schema', 'choice items need at least 2 options');
  const ids = new Set(item.options.map((o) => o.id));
  const unknown = Object.keys(item.distractorFeedback).filter((k) => !ids.has(k));
  if (unknown.length) return fail('schema', `feedback for unknown options ${unknown.join(', ')}`);
  return pass('schema');
}

function checkOneCorrect(item: PackageItem): CheckResult {
  if (item.kind === 'TEMPLATE' || item.type === 'multi_choice' || item.type === 'written')
    return pass('one_correct');
  const texts = item.options.map((o) => normaliseText(o.text ?? o.media ?? ''));
  const repeated = texts.find((t, i) => t !== '' && texts.indexOf(t) !== i);
  if (repeated !== undefined) return fail('one_correct', `two options read "${repeated}"`);
  if (CHOICE.includes(item.type)) {
    const answer = (item.answer as { optionId?: string } | null)?.optionId;
    if (answer && item.distractorFeedback[answer])
      return fail('one_correct', `the correct option ${answer} has distractor feedback`);
  }
  return pass('one_correct');
}

function checkRecompute(item: PackageItem): CheckResult {
  if (item.kind === 'TEMPLATE') return pass('recompute'); // computed per variant by math.js
  const expr = item.provenance.answerCheckExpr;
  if (typeof expr !== 'string' || expr.trim() === '') {
    return item.type === 'numeric'
      ? fail('recompute', 'numeric items need answerCheckExpr')
      : pass('recompute');
  }
  let value: number | boolean;
  try {
    value = evaluateExpr(expr);
  } catch (e) {
    return fail('recompute', (e as Error).message);
  }
  const answer = item.answer as Record<string, unknown> | null;
  switch (item.type) {
    case 'numeric': {
      const ok =
        typeof value === 'number' &&
        typeof answer?.value === 'number' &&
        sameNumber(answer.value, value, (answer.tolerance as number | undefined) ?? 0);
      return ok
        ? pass('recompute')
        : fail('recompute', `key ${String(answer?.value)} ≠ ${expr} = ${value}`);
    }
    case 'true_false':
      return answer?.value === value
        ? pass('recompute')
        : fail('recompute', `key ${String(answer?.value)} ≠ ${expr} = ${value}`);
    case 'fill_blank': {
      const blanks = (answer?.blanks as string[][] | undefined)?.[0] ?? [];
      const ok =
        typeof value === 'number' &&
        blanks.some((b) => {
          const n = parseNumberText(b);
          return n !== null && sameNumber(n, value);
        });
      return ok
        ? pass('recompute')
        : fail('recompute', `no accepted blank equals ${expr} = ${value}`);
    }
    default: {
      if (!CHOICE.includes(item.type) || typeof value !== 'number') return pass('recompute');
      const parsed = item.options.map((o) => ({ id: o.id, n: parseNumberText(o.text ?? '') }));
      if (parsed.some((p) => p.n === null))
        return fail('recompute', 'answerCheckExpr is set but some options are not numbers');
      const matching = parsed.filter((p) => sameNumber(p.n!, value)).map((p) => p.id);
      const key = (answer as { optionId?: string } | null)?.optionId;
      if (matching.length !== 1)
        return fail('recompute', `${matching.length} options equal ${value}`);
      return matching[0] === key
        ? pass('recompute')
        : fail('recompute', `option ${matching[0]} equals ${expr} = ${value}, key is ${key}`);
    }
  }
}

function checkKatex(item: PackageItem, template?: ItemTemplate): CheckResult {
  const problem = katexProblem(itemTexts(item, template).filter((t) => !t.includes('{{')));
  if (problem) return fail('katex', problem);
  if (template && isTemplateItemType(item.type)) {
    for (let seed = 0; seed < 5; seed++) {
      const v = renderVariant({ ...template, type: item.type }, seed);
      if (!v.ok) return pass('katex'); // reported by template_seeds
      const p = katexProblem([
        v.value.stemMd,
        v.value.explanationMd,
        ...v.value.options.map((o) => o.text),
      ]);
      if (p) return fail('katex', `variant seed ${seed}: ${p}`);
    }
  }
  return pass('katex');
}

function checkTemplateSeeds(item: PackageItem, template: ItemTemplate | undefined, seeds: number) {
  if (item.kind !== 'TEMPLATE' || !template || !isTemplateItemType(item.type))
    return pass('template_seeds');
  const probe = probeTemplate({ ...template, type: item.type }, seeds);
  return probe.ok
    ? pass('template_seeds')
    : fail('template_seeds', `seed ${probe.seed}: ${probe.message ?? probe.error}`);
}

function checkNgram(texts: string[], index: NgramIndex): CheckResult {
  const o = index.overlap(texts.join('\n'));
  return o.shared === 0
    ? pass('ngram')
    : fail(
        'ngram',
        `${o.shared} ${index.n}-grams copied from the source books (longest run ${o.longestRun} words)`,
      );
}

function contentKey(item: PackageItem, template?: ItemTemplate): string {
  const stem = template ? template.render.stem : item.stemMd;
  return normaliseText([stem, ...item.options.map((o) => o.text ?? '')].join(' | '));
}

function checkDuplicate(item: PackageItem, ctx: ItemCheckContext): CheckResult {
  const key = contentKey(item, ctx.template);
  const first = ctx.seen.get(key);
  if (first && first !== item.code) return fail('duplicate', `same text as ${first}`);
  ctx.seen.set(key, item.code);
  return pass('duplicate');
}

function checkTts(item: PackageItem, template: ItemTemplate | undefined, readAloud: boolean) {
  if (!readAloud) return pass('tts');
  const missing: string[] = [];
  if (!(template?.render.ttsText ?? item.ttsText)?.trim()) missing.push('stem');
  if (item.options.some((o) => o.text && !o.ttsText?.trim())) missing.push('options');
  if (item.hints.some((h) => !h.ttsText?.trim())) missing.push('hints');
  return missing.length ? fail('tts', `tts text missing: ${missing.join(', ')}`) : pass('tts');
}

function checkSvg(item: PackageItem, media: Map<string, MediaStatus>): CheckResult {
  const codes = [...item.media, ...item.options.flatMap((o) => (o.media ? [o.media] : []))];
  for (const code of codes) {
    const m = media.get(code);
    if (!m) return fail('svg', `media ${code} is not in media.jsonl`);
    if (!m.ok) return fail('svg', `media ${code}: ${m.message ?? 'failed render or sanitising'}`);
  }
  return pass('svg');
}

export function checkItem(item: PackageItem, ctx: ItemCheckContext): CheckResult[] {
  const results = [checkSlot(item, ctx.slot), checkSchema(item, ctx.template)];
  if (!results[1]!.ok) return results; // later checks assume a well-formed item
  const texts = itemTexts(item, ctx.template);
  results.push(
    checkOneCorrect(item),
    checkRecompute(item),
    checkKatex(item, ctx.template),
    checkTemplateSeeds(item, ctx.template, ctx.templateSeeds),
    checkNgram(texts, ctx.ngram),
    checkDuplicate(item, ctx),
    checkTts(item, ctx.template, ctx.readAloud),
    checkSvg(item, ctx.media),
  );
  return results;
}

/** Passages (item groups): copy check and reading level within the profile range. */
export function checkGroup(
  group: PackageGroup,
  ngram: NgramIndex,
  limits?: { minWords: number; maxWords: number; maxSentenceWords: number },
): CheckResult[] {
  const results: CheckResult[] = [checkNgram([group.title, group.bodyMd], ngram)];
  if (limits) {
    const level = readingLevel(group.bodyMd);
    const problems: string[] = [];
    if (level.words < limits.minWords || level.words > limits.maxWords)
      problems.push(`${level.words} words (range ${limits.minWords}-${limits.maxWords})`);
    if (level.maxSentenceWords > limits.maxSentenceWords)
      problems.push(
        `a sentence of ${level.maxSentenceWords} words (max ${limits.maxSentenceWords})`,
      );
    results.push(
      problems.length ? fail('reading_level', problems.join('; ')) : pass('reading_level'),
    );
  }
  return results;
}
