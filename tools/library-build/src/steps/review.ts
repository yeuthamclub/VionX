// Step 11 `review-export [--topic CODE] [--media-base-url URL]` → review.csv (+ review/media/*.png)
// and `review-import --file review.csv --reviewer NAME [--hours H]`, which applies APPROVED /
// REJECTED / EDITED. Edited items are checked again before they count as approved. Rejected slots
// get one regeneration (`generate`); reviewer notes are collected in lessons.md for the prompts.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuildContext } from '../context.ts';
import { checkItem, type MediaStatus } from '../lib/checks.ts';
import { writeFileAtomic } from '../lib/jsonl.ts';
import { readReview, reviewCsv } from '../lib/review.ts';
import { normaliseText } from '../lib/text.ts';
import { ItemStore, MAX_ATTEMPTS, reject } from '../items.ts';
import { sourceIndex, TEMPLATE_SEEDS } from './check.ts';
import { loadMedia } from './media.ts';
import { loadPlan } from './plan.ts';
import { autoVerdict } from './verify.ts';

export async function reviewExport(ctx: BuildContext): Promise<void> {
  const store = new ItemStore(ctx);
  const rows = store.list(
    (r) => r.item.status === 'NEEDS_REVIEW' && ctx.inTopic(r.item.skills[0]!),
  );
  const base = ctx.arg('media-base-url')?.replace(/\/+$/, '');
  mkdirSync(ctx.path('review', 'media'), { recursive: true });
  const csv = reviewCsv(
    rows.map((r) => {
      const figure = r.item.media[0];
      if (figure)
        copyFileSync(
          ctx.path('media', 'png', `${figure}.png`),
          ctx.path('review', 'media', `${figure}.png`),
        );
      const flags = [
        ...(r.verify && !r.verify.hintsOk ? ['hints'] : []),
        ...(r.verify && !r.verify.ageAppropriate ? ['age'] : []),
        ...(r.verify?.issues ?? []),
        ...(r.attempt > 1 ? [`attempt ${r.attempt}`] : []),
      ];
      return {
        item: r.item,
        ...(r.template ? { template: r.template } : {}),
        autoVerdict: autoVerdict(r),
        flags,
        ...(figure ? { figureLink: `${base ?? 'media'}/${figure}.png` } : {}),
        verifierNote: r.verify
          ? `${r.verify.agree ? 'agrees' : `answers ${r.verify.answerJson}`}: ${r.verify.note}`
          : '',
        disputeNote: r.dispute ? `${r.dispute.verdict}: ${r.dispute.note}` : '',
      };
    }),
  );
  writeFileAtomic(ctx.path('review', 'review.csv'), csv);
  const pass = rows.filter((r) => autoVerdict(r) === 'PASS').length;
  ctx.markStep('review-export', 'done', { rows: rows.length });
  ctx.log(
    `review-export: ${rows.length} item(s) → ${ctx.path('review', 'review.csv')} (${pass} auto PASS, ${rows.length - pass} to check closely)`,
  );
  ctx.log(
    '  Import into Google Sheets (File → Import → Upload), fill `verdict` and `reviewer_note`, download as CSV, then run review-import.',
  );
}

export async function reviewImport(ctx: BuildContext): Promise<void> {
  const file = ctx.arg('file') ?? ctx.path('review', 'review.csv');
  const reviewer = ctx.arg('reviewer')?.trim();
  if (!reviewer)
    throw new Error('review-import needs --reviewer NAME (a person approves, never a model)');
  const store = new ItemStore(ctx);
  const current = new Map(
    store
      .list((r) => r.item.status === 'NEEDS_REVIEW')
      .map((r) => [r.item.code, { item: r.item, ...(r.template ? { template: r.template } : {}) }]),
  );
  const decisions = readReview(
    readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'),
    current,
  );
  const plan = loadPlan(ctx);
  const slots = new Map(plan.slots.map((s) => [s.id, s]));
  const media = new Map<string, MediaStatus>(
    loadMedia(ctx).map((m) => [m.code, { code: m.code, ok: m.ok }]),
  );
  const ngram = decisions.some((d) => d.verdict === 'EDITED') ? sourceIndex(ctx) : undefined;
  const at = new Date().toISOString();
  const counts = { APPROVED: 0, REJECTED: 0, EDITED: 0, editFailed: 0 };

  for (const d of decisions) {
    const record = store.get(d.code)!;
    record.review = { verdict: d.verdict, note: d.note, by: reviewer, at };
    if (d.verdict === 'APPROVED') {
      record.item.status = 'APPROVED';
      counts.APPROVED++;
    } else if (d.verdict === 'REJECTED') {
      reject(record, [`review: ${d.note || 'rejected by the reviewer'}`]);
      counts.REJECTED++;
      if (d.note)
        appendFileSync(
          ctx.path('lessons.md'),
          `- ${record.item.skills[0]} (${record.item.type}): ${d.note}\n`,
        );
    } else {
      const seen = new Map<string, string>();
      for (const other of store.list(
        (r) => r.slot !== record.slot && r.item.status !== 'REJECTED',
      )) {
        const stem = other.template ? other.template.render.stem : other.item.stemMd;
        seen.set(
          normaliseText([stem, ...other.item.options.map((o) => o.text ?? '')].join(' | ')),
          other.item.code,
        );
      }
      const results = checkItem(d.item!, {
        ...(slots.has(record.slot) ? { slot: slots.get(record.slot)! } : {}),
        ...(d.template ? { template: d.template } : {}),
        ngram: ngram!,
        seen,
        media,
        readAloud: ctx.profile.library.readAloudDefault,
        templateSeeds: TEMPLATE_SEEDS,
      });
      const failed = results.filter((c) => !c.ok);
      if (failed.length > 0) {
        counts.editFailed++;
        ctx.log(
          `  ✗ ${d.code}: the edit fails ${failed.map((f) => `${f.check} (${f.message})`).join('; ')}; it stays in review`,
        );
        continue;
      }
      record.item = {
        ...d.item!,
        status: 'APPROVED',
        provenance: { ...d.item!.provenance, editedBy: reviewer },
      };
      if (d.template) record.template = d.template;
      record.checks = results;
      counts.EDITED++;
    }
  }
  store.save();
  const state = ctx.state().steps['review-import'];
  const hours = Number(ctx.arg('hours') ?? 0) + Number(state?.hours ?? 0);
  const regen = store.list((r) => r.item.status === 'REJECTED' && r.attempt < MAX_ATTEMPTS).length;
  ctx.markStep('review-import', 'done', { reviewer, hours });
  ctx.log(
    `review-import: ${counts.APPROVED} approved, ${counts.EDITED} edited and approved, ${counts.REJECTED} rejected, ${counts.editFailed} edits failed a check (reviewer ${reviewer})`,
  );
  if (regen > 0)
    ctx.log(
      `  ${regen} rejected slot(s) can be generated once more: generate → check → verify → review-export`,
    );
}
