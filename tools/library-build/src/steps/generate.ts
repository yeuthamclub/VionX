// Step 8 `generate [--topic CODE] [--retry-rejected]`: per skill, the planned slots in requests of
// two (item_generation, Batch): hints[4], worked solution, distractor feedback, misconception tags,
// templates with math.js expressions. SGK/SGV pages of the skill's lessons are attached as reference
// only. Slots rejected by `check` or by the reviewer are generated once more with the reason
// attached; `--retry-rejected` gives slots that used up their attempts one more (top-up run).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { itemGenerationOutputSchema } from '@vionx/ai/schemas';
import { runBatch, type BatchJob } from '../ai/batch.ts';
import { PROMPT_VERSIONS, systemPrompt } from '../ai/prompts.ts';
import type { BuildContext } from '../context.ts';
import { draftToItem, type ItemDraft } from '../lib/draft.ts';
import { readJson, readJsonl } from '../lib/jsonl.ts';
import type { PlanSlot } from '../lib/plan.ts';
import { ItemStore, MAX_ATTEMPTS, reject } from '../items.ts';
import { profileNotes } from '../profile.ts';
import { loadMedia, mediaCode } from './media.ts';
import { loadPlan } from './plan.ts';
import { backboneSkills, loadBackbone, type LessonMap } from './structure.ts';
import { loadPages } from './textlayer.ts';

/** Reference text budget per skill (characters); scope and terms only, not exercises to copy. */
const REFERENCE_CHARS = 4_000;
/** A page's exercise section starts at a "BÀI TẬP" heading line (SGK), e.g. "BÀI TẬP CUỐI CHƯƠNG". */
const EXERCISES = /^[\s#*|]*BÀI TẬP\b/m;

export type ReferencePage = { book: string; kind: string; page: number; text: string };

/** The skill's lesson pages in book order, exercise sections dropped, within `budget` characters. */
export function skillReferences(
  skill: string,
  lessons: LessonMap,
  pages: { book: string; page: number; text: string }[],
  budget = REFERENCE_CHARS,
): ReferencePage[] {
  const refs: ReferencePage[] = [];
  for (const [book, { kind, lessons: ls }] of Object.entries(lessons)) {
    for (const lesson of ls.filter((l) => l.skills.includes(skill))) {
      for (const p of pages.filter(
        (p) => p.book === book && p.page >= lesson.pageStart && p.page <= lesson.pageEnd && p.text,
      )) {
        const cut = p.text.search(EXERCISES);
        const theory = (cut >= 0 ? p.text.slice(0, cut) : p.text).trim();
        if (budget <= 0) return refs;
        if (!theory) continue;
        const text = theory.slice(0, budget);
        budget -= text.length;
        refs.push({ book, kind, page: p.page, text });
      }
    }
  }
  return refs;
}
/** Slots per request: a whole skill in one request can run past the output token limit. */
const SLOTS_PER_REQUEST = 2;

/**
 * Slots that need a (new) draft: never generated, or rejected with an attempt left.
 * `retryRejected` reopens rejected slots that used up their attempts.
 */
export function pendingSlots(
  slots: PlanSlot[],
  store: Pick<ItemStore, 'get'>,
  retryRejected = false,
): { slot: PlanSlot; attempt: number; problems: string[] }[] {
  return slots.flatMap((slot) => {
    const r = store.get(slot.id);
    if (!r) return [{ slot, attempt: 1, problems: [] }];
    if (r.item.status !== 'REJECTED' || (r.attempt >= MAX_ATTEMPTS && !retryRejected)) return [];
    return [{ slot, attempt: r.attempt + 1, problems: r.rejectedFor ?? [] }];
  });
}

export async function generate(ctx: BuildContext): Promise<void> {
  const plan = loadPlan(ctx);
  ctx.requireStep('map');
  const skills = new Map(backboneSkills(loadBackbone(ctx)).map((s) => [s.code, s]));
  const lessons = readJson<LessonMap>(ctx.path('map.json'));
  const pages = loadPages(ctx);
  const media = new Map(loadMedia(ctx).map((m) => [m.slot, m]));
  const store = new ItemStore(ctx);
  const lessonsMd = ctx.path('lessons.md');
  const reviewNotes = existsSync(lessonsMd) ? readFileSync(lessonsMd, 'utf8') : '';
  const system = systemPrompt(PROMPT_VERSIONS.generate, profileNotes(ctx.profile));

  const pending = pendingSlots(
    plan.slots.filter((s) => ctx.inTopic(s.skill)),
    store,
    ctx.flag('retry-rejected'),
  );
  const waitingForFigure = pending.filter((p) => p.slot.svg && !media.get(p.slot.id)?.ok);
  for (const p of waitingForFigure)
    ctx.log(`  ! ${p.slot.id}: its figure is not ready (run media first)`);
  const ready = pending.filter((p) => !waitingForFigure.includes(p));

  const groups = new Map<string, typeof ready>();
  for (const p of ready) {
    const key = `${p.slot.skill}@${p.attempt}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const [key, list] of [...groups]) {
    if (list.length <= SLOTS_PER_REQUEST) continue;
    groups.delete(key);
    for (let i = 0; i < list.length; i += SLOTS_PER_REQUEST)
      groups.set(`${key}#${i / SLOTS_PER_REQUEST + 1}`, list.slice(i, i + SLOTS_PER_REQUEST));
  }
  // A request that already ran past the output limit is retried one slot per request.
  const jobKey = (group: string, list: typeof ready) =>
    `${group}:${createHash('sha1')
      .update(
        list
          .map((p) => p.slot.id)
          .sort()
          .join(','),
      )
      .digest('hex')
      .slice(0, 8)}`;
  const resultsPath = ctx.path('batches', 'generate.results.jsonl');
  const truncated = new Set(
    (existsSync(resultsPath)
      ? readJsonl<{ key: string; ok: boolean; error?: string }>(resultsPath)
      : []
    )
      .filter((r) => !r.ok && /MAX_TOKENS/i.test(r.error ?? ''))
      .map((r) => r.key),
  );
  for (const [group, list] of [...groups]) {
    if (list.length < 2 || !truncated.has(jobKey(group, list))) continue;
    groups.delete(group);
    list.forEach((p, i) => groups.set(`${group}~${i + 1}`, [p]));
  }
  const jobs: BatchJob[] = [];
  // Requests of one skill share a cached context (system + skill + pages + notes), so keep them
  // next to each other in the batch.
  const bySkill = [...groups].sort(([, a], [, b]) =>
    a[0]!.slot.skill.localeCompare(b[0]!.slot.skill),
  );
  for (const [group, list] of bySkill) {
    const skill = skills.get(list[0]!.slot.skill)!;
    const refs = skillReferences(skill.code, lessons, pages);
    jobs.push({
      key: jobKey(group, list),
      item: {
        system,
        context: JSON.stringify({
          grade: ctx.profile.grade,
          skill: { code: skill.code, title: skill.title, gdptRef: skill.gdptRef },
          references: refs,
          ...(reviewNotes ? { reviewNotes } : {}),
        }),
        input: {
          attempt: list[0]!.attempt,
          slots: list.map(({ slot, problems }) => {
            const m = media.get(slot.id);
            return {
              slotId: slot.id,
              level: slot.level,
              difficulty: slot.difficulty,
              kind: slot.kind,
              type: slot.type,
              figure: slot.svg && m ? { mediaCode: m.code, brief: m.brief } : null,
              ...(problems.length ? { previousAttemptRejectedFor: problems } : {}),
            };
          }),
        },
        outputSchema: itemGenerationOutputSchema,
        sourceRefs: refs.map((r) => `${r.kind}:${r.book}:${r.page}`),
      },
    });
  }
  if (jobs.length === 0) {
    ctx.log(
      `generate: nothing to generate in ${ctx.opts.topic ?? 'the library'} (${waitingForFigure.length} waiting for figures)`,
    );
    ctx.markStep('generate', 'done');
    return;
  }

  const outcome = await runBatch<{ items: ItemDraft[] }>(
    ctx,
    'generate',
    'item_generation',
    PROMPT_VERSIONS.generate,
    jobs,
  );
  const slotById = new Map(plan.slots.map((s) => [s.id, s]));
  let written = 0;
  const missing: string[] = [];
  for (const job of jobs) {
    const result = outcome.results.get(job.key);
    if (!result?.ok) continue;
    const input = job.item.input as { attempt: number; slots: { slotId: string }[] };
    const drafts = new Map(result.output!.items.map((d) => [d.slotId, d]));
    for (const { slotId } of input.slots) {
      const draft = drafts.get(slotId);
      const slot = slotById.get(slotId)!;
      if (!draft) {
        missing.push(slotId);
        continue;
      }
      // A re-collected batch must not overwrite a slot that moved on.
      const current = store.get(slotId);
      if (current && current.attempt >= input.attempt) continue;
      const provenance = {
        model: result.model ?? 'unknown',
        promptVersion: PROMPT_VERSIONS.generate,
        attempt: input.attempt,
        batchId: result.batchId,
      };
      const mediaCodes = slot.svg ? [mediaCode(slotId)] : [];
      try {
        const { item, template } = draftToItem(draft, slot, mediaCodes, provenance);
        store.put({
          slot: slotId,
          attempt: input.attempt,
          item,
          ...(template ? { template } : {}),
        });
      } catch (e) {
        const { item } = draftToItem({ ...draft, answerJson: null }, slot, mediaCodes, provenance);
        const record = { slot: slotId, attempt: input.attempt, item };
        reject(record, [`schema: answerJson is not valid JSON (${(e as Error).message})`]);
        store.put(record);
      }
      written++;
    }
  }
  store.save();
  if (missing.length)
    ctx.log(
      `  ! the model skipped ${missing.length} slot(s): ${missing.slice(0, 5).join(', ')} (re-run generate)`,
    );
  ctx.markStep('generate', outcome.complete && missing.length === 0 ? 'done' : 'pending', {
    generated: written,
  });
  ctx.log(`generate: ${written} item(s) written to items.jsonl`);
}
