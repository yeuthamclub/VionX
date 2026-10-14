// Step 9 `check [--topic CODE]`: the code checks (lib/checks.ts) on every newly generated item:
// schema, one correct answer, math.js re-computation, KaTeX, 1,000-seed template test, n-gram copy
// check against the source books, duplicates, TTS where the profile reads aloud, SVG render and
// sanitising. Passing items go to `verify`; failing ones are REJECTED (one regeneration left).
import type { PackageGroup } from '@vionx/domain';
import type { BuildContext } from '../context.ts';
import { checkGroup, checkItem, ITEM_CHECKS, type MediaStatus } from '../lib/checks.ts';
import { readJsonl, writeJson } from '../lib/jsonl.ts';
import { NgramIndex, normaliseText } from '../lib/text.ts';
import { ItemStore, reject } from '../items.ts';
import { loadMedia } from './media.ts';
import { loadPlan } from './plan.ts';
import { loadPages } from './textlayer.ts';

export const TEMPLATE_SEEDS = 1000;

/** n-gram index over every page of the source books (SGK, SGV, SBT). */
export function sourceIndex(ctx: BuildContext): NgramIndex {
  const index = new NgramIndex(ctx.profile.ngram);
  for (const p of loadPages(ctx)) index.add(p.text);
  return index;
}

export async function check(ctx: BuildContext): Promise<void> {
  ctx.requireStep('textlayer');
  const plan = loadPlan(ctx);
  const slots = new Map(plan.slots.map((s) => [s.id, s]));
  const store = new ItemStore(ctx);
  const ngram = sourceIndex(ctx);
  const media = new Map<string, MediaStatus>(
    loadMedia(ctx).map((m) => [
      m.code,
      { code: m.code, ok: m.ok, ...(m.message ? { message: m.message } : {}) },
    ]),
  );
  // Duplicates are checked against every item still in play, not only the new ones.
  const seen = new Map<string, string>();
  const todo = store.list(
    (r) => r.item.status === 'AI_GENERATED' && ctx.inTopic(r.item.skills[0]!),
  );
  for (const r of store.list(
    (r) => r.item.status !== 'REJECTED' && r.item.status !== 'AI_GENERATED',
  )) {
    const stem = r.template ? r.template.render.stem : r.item.stemMd;
    seen.set(
      normaliseText([stem, ...r.item.options.map((o) => o.text ?? '')].join(' | ')),
      r.item.code,
    );
  }

  const failures: Record<string, number> = Object.fromEntries(ITEM_CHECKS.map((c) => [c, 0]));
  let passed = 0;
  for (const record of todo) {
    const results = checkItem(record.item, {
      ...(slots.has(record.slot) ? { slot: slots.get(record.slot)! } : {}),
      ...(record.template ? { template: record.template } : {}),
      ngram,
      seen,
      media,
      readAloud: ctx.profile.library.readAloudDefault,
      templateSeeds: TEMPLATE_SEEDS,
    });
    record.checks = results;
    const failed = results.filter((c) => !c.ok);
    for (const f of failed) failures[f.check] = (failures[f.check] ?? 0) + 1;
    if (failed.length === 0) {
      record.item.status = 'VALIDATING';
      passed++;
    } else {
      reject(
        record,
        failed.map((f) => `${f.check}: ${f.message}`),
      );
      ctx.log(
        `  ✗ ${record.item.code} (attempt ${record.attempt}): ${failed.map((f) => `${f.check}: ${f.message}`).join('; ')}`,
      );
    }
  }
  store.save();

  // Passages (item groups), when the profile has them.
  const groups = readJsonl<PackageGroup>(ctx.path('groups.jsonl'));
  const groupFailures = groups.flatMap((g) =>
    checkGroup(g, ngram, ctx.profile.readingLevel)
      .filter((c) => !c.ok)
      .map((c) => `${g.code} ${c.check}: ${c.message}`),
  );
  for (const f of groupFailures) ctx.log(`  ✗ group ${f}`);

  const summary = {
    checked: todo.length,
    passed,
    failed: todo.length - passed,
    failuresByCheck: failures,
    groupFailures,
    sourceNgrams: ngram.size,
  };
  writeJson(ctx.path('checks.json'), summary);
  ctx.markStep('check', 'done', { checked: todo.length, passed });
  ctx.log(
    `check: ${todo.length} item(s) checked, ${passed} passed, ${todo.length - passed} rejected (re-run generate for a second attempt)`,
  );
}
