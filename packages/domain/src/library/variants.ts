// Variant engine for TEMPLATE items (TASK_PACKS/M05.md "Variant engine"). Deterministic: the same
// (template, seed) always gives the same variant, in the API and offline in the mobile app.
import { all, create, type EvalFunction } from 'mathjs';
import { err, ok, type Result } from '../shared/result.ts';
import type { ItemAnswer, ItemOption, ItemTemplate, ItemType, TemplateParam } from './types.ts';
import { TEMPLATE_ITEM_TYPES, type TemplateItemType } from './types.ts';

/** After this many parameter draws without satisfying the constraints the template is flagged. */
export const MAX_VARIANT_TRIES = 50;

/** Option ids of rendered choice variants, in display order. */
export const VARIANT_OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

export type VariantFailure = 'CONSTRAINTS_UNSATISFIABLE' | 'INVALID_TEMPLATE';

export interface VariantTemplate extends ItemTemplate {
  type: ItemType;
}

export interface Variant {
  seed: number;
  params: Record<string, unknown>;
  /** The computed answer before formatting. */
  answerValue: number | string;
  /** Wrong answers in distractorExprs order (formatted). */
  distractors: string[];
  stemMd: string;
  ttsText?: string;
  explanationMd?: string;
  options: ItemOption[];
  /** Option id → distractor feedback key (`d1`, `d2`…, matching distractorExprs order). */
  optionFeedbackKeys: Record<string, string>;
  answer: ItemAnswer;
}

// --- Sandboxed math.js --------------------------------------------------------------------------

const math = create(all!, { matrix: 'Array', number: 'number' });
const compileExpr = math.compile.bind(math);
// Package expressions are reviewed content, but still: no imports, units, parsing or evaluation of
// nested strings from inside an expression (math.js security guide).
const disabled = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};
math.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    compile: disabled('compile'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    resolve: disabled('resolve'),
    reviver: disabled('reviver'),
  },
  { override: true },
);

const compiled = new Map<string, EvalFunction>();

function evaluate(expr: string, scope: Record<string, unknown>): unknown {
  let fn = compiled.get(expr);
  if (!fn) {
    fn = compileExpr(expr);
    compiled.set(expr, fn);
  }
  // math.js may write assignments into the scope; give it a copy.
  return fn.evaluate({ ...scope });
}

// --- Seeded PRNG ----------------------------------------------------------------------------------

/** mulberry32: small, fast, good enough for picking parameters. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const decimalsOf = (n: number) => (String(n).split('.')[1] ?? '').length;

function pickParam(param: TemplateParam, rand: () => number): unknown {
  const index = (count: number) => Math.min(count - 1, Math.floor(rand() * count));
  switch (param.type) {
    case 'int': {
      const step = param.step ?? 1;
      const count = Math.floor((param.max - param.min) / step) + 1;
      return param.min + index(count) * step;
    }
    case 'decimal': {
      const count = Math.floor((param.max - param.min) / param.step + 1e-9) + 1;
      const dp = Math.max(decimalsOf(param.step), decimalsOf(param.min));
      return Number((param.min + index(count) * param.step).toFixed(dp));
    }
    case 'choice':
      return param.values[index(param.values.length)];
    case 'words':
      return param.list[index(param.list.length)];
  }
}

// --- Formatting -----------------------------------------------------------------------------------

/** Rounds away floating noise (0.1 + 0.2) so answers compare and print cleanly. */
const clean = (n: number) => Number(n.toPrecision(12));

function normalise(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? clean(value) : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function format(value: number | string, decimal: 'comma' | 'point'): string {
  if (typeof value === 'string') return value;
  const text = String(value);
  return decimal === 'comma' ? text.replace('.', ',') : text;
}

function renderText(
  text: string,
  scope: Record<string, unknown>,
  decimal: 'comma' | 'point',
): string | null {
  let failed = false;
  const out = text.replace(/\{\{([^{}]+)\}\}/g, (_, expr: string) => {
    const value = normalise(evaluate(expr.trim(), scope));
    if (value === null) {
      failed = true;
      return '';
    }
    return format(value, decimal);
  });
  return failed ? null : out;
}

// --- Engine ---------------------------------------------------------------------------------------

export const isTemplateItemType = (type: ItemType): type is TemplateItemType =>
  (TEMPLATE_ITEM_TYPES as readonly string[]).includes(type);

const CHOICE_TYPES: readonly ItemType[] = ['single_choice', 'spelling_choice'];

type Attempt = { kind: 'ok'; variant: Variant } | { kind: 'retry' };

function attempt(template: VariantTemplate, seed: number, rand: () => number): Attempt {
  const params: Record<string, unknown> = {};
  for (const param of template.params) params[param.name] = pickParam(param, rand);

  for (const constraint of template.constraints) {
    if (evaluate(constraint, params) !== true) return { kind: 'retry' };
  }

  const answerValue = normalise(evaluate(template.answerExpr, params));
  if (answerValue === null) return { kind: 'retry' };
  const decimal = template.render.decimal ?? 'comma';
  const answerText = format(answerValue, decimal);

  const distractors: string[] = [];
  for (const expr of template.distractorExprs) {
    const value = normalise(evaluate(expr, params));
    if (value === null) return { kind: 'retry' };
    const text = format(value, decimal);
    // Every wrong answer must differ from the answer and from the other wrong answers.
    if (text === answerText || distractors.includes(text)) return { kind: 'retry' };
    distractors.push(text);
  }

  const scope = { ...params, answer: answerValue };
  const stemMd = renderText(template.render.stem, scope, decimal);
  if (stemMd === null) return { kind: 'retry' };
  const ttsText =
    template.render.ttsText === undefined
      ? undefined
      : renderText(template.render.ttsText, scope, decimal);
  const explanationMd =
    template.render.explanation === undefined
      ? undefined
      : renderText(template.render.explanation, scope, decimal);
  if (ttsText === null || explanationMd === null) return { kind: 'retry' };

  let options: ItemOption[] = [];
  const optionFeedbackKeys: Record<string, string> = {};
  let answer: ItemAnswer;
  if (CHOICE_TYPES.includes(template.type)) {
    const entries = [
      { text: answerText, key: null as string | null },
      ...distractors.map((text, i) => ({ text, key: `d${i + 1}` })),
    ];
    // Fisher–Yates with the same seeded stream.
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [entries[i], entries[j]] = [entries[j]!, entries[i]!];
    }
    options = entries.map((entry, i) => ({ id: VARIANT_OPTION_IDS[i]!, text: entry.text }));
    entries.forEach((entry, i) => {
      if (entry.key) optionFeedbackKeys[VARIANT_OPTION_IDS[i]!] = entry.key;
    });
    answer = { optionId: VARIANT_OPTION_IDS[entries.findIndex((e) => e.key === null)]! };
  } else if (template.type === 'numeric') {
    if (typeof answerValue !== 'number') return { kind: 'retry' };
    answer = { value: answerValue };
  } else {
    answer = { blanks: [[answerText]] };
  }

  return {
    kind: 'ok',
    variant: {
      seed,
      params,
      answerValue,
      distractors,
      stemMd,
      ...(ttsText === undefined ? {} : { ttsText }),
      ...(explanationMd === undefined ? {} : { explanationMd }),
      options,
      optionFeedbackKeys,
      answer,
    },
  };
}

/**
 * Renders the variant of `template` for `seed` (stored with each attempt):
 * 1. a seeded PRNG draws params until the constraints hold (at most MAX_VARIANT_TRIES draws);
 * 2. the answer and distractors come from math.js expressions (or word-list fields);
 * 3. stem, TTS text and explanation placeholders are rendered; choice options are shuffled.
 */
export function renderVariant(
  template: VariantTemplate,
  seed: number,
): Result<Variant, VariantFailure> {
  if (!isTemplateItemType(template.type)) {
    return err('INVALID_TEMPLATE', `type ${template.type} cannot be a TEMPLATE item`);
  }
  if (CHOICE_TYPES.includes(template.type) && template.distractorExprs.length === 0) {
    return err('INVALID_TEMPLATE', 'choice templates need at least one distractor expression');
  }
  if (template.distractorExprs.length > VARIANT_OPTION_IDS.length - 1) {
    return err('INVALID_TEMPLATE', `at most ${VARIANT_OPTION_IDS.length - 1} distractors`);
  }
  const rand = seededRandom(seed);
  for (let i = 0; i < MAX_VARIANT_TRIES; i++) {
    let result: Attempt;
    try {
      result = attempt(template, seed, rand);
    } catch (error) {
      return err('INVALID_TEMPLATE', error instanceof Error ? error.message : String(error));
    }
    if (result.kind === 'ok') return ok(result.variant);
  }
  return err(
    'CONSTRAINTS_UNSATISFIABLE',
    `no parameters satisfied the constraints in ${MAX_VARIANT_TRIES} tries (seed ${seed})`,
  );
}

/**
 * Probes a template over `count` consecutive seeds starting at `from`; returns the first failure.
 * Used by package validation (a few hundred seeds) and the property tests (10,000).
 */
export function probeTemplate(
  template: VariantTemplate,
  count: number,
  from = 0,
): { ok: true } | { ok: false; seed: number; error: VariantFailure; message?: string } {
  for (let seed = from; seed < from + count; seed++) {
    const result = renderVariant(template, seed);
    if (!result.ok) {
      return {
        ok: false,
        seed,
        error: result.error,
        ...(result.message === undefined ? {} : { message: result.message }),
      };
    }
  }
  return { ok: true };
}
