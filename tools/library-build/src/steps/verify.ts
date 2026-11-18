// Step 10 `verify [--topic CODE]`: an independent model solves each checked item blind and grades
// its hints and age fit (item_verification, Batch). When its answer differs from the key or it
// finds the item unsolvable, a stronger model settles the dispute (item_dispute, Batch). A wrong
// answer on an item whose key code already recomputed skips the dispute and stays CHECK for the
// reviewer (cost plan A: in the first wave 54/55 disputes kept the key). Nothing is approved here:
// every item goes to the human review queue with the verdicts attached.
import { readFileSync } from 'node:fs';
import { itemDisputeOutputSchema, itemVerificationOutputSchema } from '@vionx/ai/schemas';
import { runBatch, type BatchJob } from '../ai/batch.ts';
import { PROMPT_VERSIONS, systemPrompt } from '../ai/prompts.ts';
import type { BuildContext } from '../context.ts';
import { answersAgree, parseAnswerJson } from '../lib/answers.ts';
import { blindView } from '../lib/draft.ts';
import { ItemStore, type DisputeRecord, type ItemRecord, type VerifyRecord } from '../items.ts';

type VerifyOutput = Omit<VerifyRecord, 'agree'>;

function verdictOf(record: ItemRecord, output: VerifyOutput): VerifyRecord {
  const { key } = blindView(record.item, record.template);
  let given: ReturnType<typeof parseAnswerJson> | null = null;
  try {
    given = parseAnswerJson(output.answerJson);
  } catch {
    // An unreadable answer counts as a disagreement.
  }
  return { ...output, agree: output.solvable && answersAgree(record.item.type, key, given) };
}

/** Digit runs of a text, with thousands separators ("200 000", "1.000") joined first. */
const digitRuns = (text: string) =>
  text.replace(/(\d)[ .\u00a0](?=\d{3}(?!\d))/g, '$1').match(/\d+/g) ?? [];

/**
 * The key was recomputed by code: a TEMPLATE whose answer expression held on every seed, or an
 * `answerCheckExpr` that passed `recompute` and uses only numbers printed in the stem (an
 * expression of constants could match a wrong key). Formula constants not in the stem (the 2 of a
 * perimeter) fall back to a dispute.
 */
export function codeConfirmed(r: ItemRecord): boolean {
  const passed = (check: string) => r.checks?.some((c) => c.check === check && c.ok) ?? false;
  if (r.item.kind === 'TEMPLATE') return passed('template_seeds');
  const expr = r.item.provenance.answerCheckExpr;
  if (typeof expr !== 'string' || !passed('recompute')) return false;
  const stem = new Set(digitRuns(r.item.stemMd));
  const used = digitRuns(expr);
  return used.length > 0 && used.every((n) => stem.has(n));
}

export async function verify(ctx: BuildContext): Promise<void> {
  const store = new ItemStore(ctx);
  const todo = store.list((r) => r.item.status === 'VALIDATING' && ctx.inTopic(r.item.skills[0]!));
  if (todo.length === 0) {
    ctx.log('verify: no checked items waiting (run check first)');
    ctx.markStep('verify', 'done');
    return;
  }
  const png = (code: string) =>
    readFileSync(ctx.path('media', 'png', `${code}.png`)).toString('base64');
  const jobKey = (r: ItemRecord) => `${r.slot}@${r.attempt}`;

  const system = systemPrompt(PROMPT_VERSIONS.verify);
  const jobs: BatchJob[] = todo.map((r) => ({
    key: jobKey(r),
    item: {
      system,
      input: { grade: ctx.profile.grade, item: blindView(r.item, r.template).view },
      attachments: r.item.media.map((code) => ({
        mediaType: 'image/png' as const,
        data: png(code),
      })),
      outputSchema: itemVerificationOutputSchema,
    },
  }));
  const first = await runBatch<VerifyOutput>(
    ctx,
    'verify',
    'item_verification',
    PROMPT_VERSIONS.verify,
    jobs,
  );
  if (!first.complete) return ctx.markStep('verify', 'pending');
  for (const r of todo) r.verify = verdictOf(r, first.results.get(jobKey(r))!.output!);

  const disagreed = todo.filter((r) => !r.verify!.agree);
  // An unsolvable verdict questions the wording, which code cannot settle.
  const settled = disagreed.filter((r) => r.verify!.solvable && codeConfirmed(r));
  const disputed = disagreed.filter((r) => !settled.includes(r));
  if (disputed.length > 0) {
    const disputeSystem = systemPrompt(PROMPT_VERSIONS.dispute);
    const disputeJobs: BatchJob[] = disputed.map((r) => {
      const { view, key } = blindView(r.item, r.template);
      return {
        key: jobKey(r),
        item: {
          system: disputeSystem,
          input: {
            grade: ctx.profile.grade,
            item: {
              ...view,
              answerKeyJson: JSON.stringify(key),
              workedSolutionMd: r.item.workedSolutionMd,
            },
            verifier: {
              answerJson: r.verify!.answerJson,
              solvable: r.verify!.solvable,
              issues: r.verify!.issues,
              note: r.verify!.note,
            },
          },
          attachments: r.item.media.map((code) => ({
            mediaType: 'image/png' as const,
            data: png(code),
          })),
          outputSchema: itemDisputeOutputSchema,
        },
      };
    });
    const second = await runBatch<DisputeRecord>(
      ctx,
      'dispute',
      'item_dispute',
      PROMPT_VERSIONS.dispute,
      disputeJobs,
    );
    if (!second.complete) {
      store.save();
      return ctx.markStep('verify', 'pending');
    }
    for (const r of disputed) r.dispute = second.results.get(jobKey(r))!.output!;
  }

  for (const r of todo) r.item.status = 'NEEDS_REVIEW';
  store.save();
  const rate = disputed.length / todo.length;
  ctx.markStep('verify', 'done', {
    verified: todo.length,
    disputed: disputed.length,
    codeConfirmed: settled.length,
  });
  ctx.log(
    `verify: ${todo.length} item(s) verified, ${disputed.length} disputed (${Math.round(rate * 100)}%) → review queue`,
  );
  for (const r of settled)
    ctx.log(`  ? ${r.item.code}: CHECK: verifier disagrees, key recomputed by code (no dispute)`);
  for (const r of disputed)
    ctx.log(`  ? ${r.item.code}: ${r.dispute!.verdict}: ${r.dispute!.note}`);
}

/** The verdict shown to the reviewer. */
export function autoVerdict(r: ItemRecord): 'PASS' | 'CHECK' | 'KEY_WRONG' | 'AMBIGUOUS' {
  if (r.dispute?.verdict === 'KEY_WRONG') return 'KEY_WRONG';
  if (r.dispute?.verdict === 'AMBIGUOUS') return 'AMBIGUOUS';
  const v = r.verify;
  if (!v) return 'CHECK';
  return v.agree && v.hintsOk && v.ageAppropriate && v.issues.length === 0 && !r.dispute
    ? 'PASS'
    : 'CHECK';
}
