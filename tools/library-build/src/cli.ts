// `pnpm library:build <grade-subject> <step>[,<step>...] [--topic CODE] [options]`
// Builds one launch library (TASK_PACKS/X01.md). Steps, in order:
//   textlayer --source DIR|bucket:B/P   text layer + vision reading of hard pages  (Batch)
//   backbone [--gdpt FILE|DIR]          GDPT program → DOMAIN/TOPIC/SKILL tree     (Batch)
//   map                                 TOC pages → lesson → skill mappings          (Batch)
//   edges                               prerequisite edges with reasons               (Batch)
//   plan [--target N] | plan --approve [--by NAME]     plan.csv for owner approval
//   passages                            item-group stimuli (no-op for MATH.6)
//   media                               SVG figures, sanitised + PNG render          (Batch)
//   generate                            items, hints, solutions, templates            (Batch)
//   check                               code checks
//   verify (alias dispute)              blind solve, then disputes                    (Batch)
//   review-export [--media-base-url U]  review/review.csv for Google Sheets
//   review-import --reviewer NAME [--file F] [--hours H]
//   package [--upload [--bucket B]]     M05 package + validation + report + cost
//   status                              step states and AI cost so far
// Options: --fake (recorded fixtures, no network; work dir .library-build/<ID>-fake), --force,
// --work-dir DIR, --wait-minutes N (default 60), --poll-seconds N (default 60).
// Claude is called only with AI_LIVE=1 and ANTHROPIC_API_KEY. Exit codes: 0 done, 1 error,
// 2 usage, 75 a batch is still running (re-run the same command later).
import { costSummary } from './ai/runs.ts';
import { BuildContext, type BuildOptions } from './context.ts';
import { buildProfile } from './profile.ts';
import { check } from './steps/check.ts';
import { generate } from './steps/generate.ts';
import { media } from './steps/media.ts';
import { packageStep } from './steps/package.ts';
import { passages } from './steps/passages.ts';
import { plan } from './steps/plan.ts';
import { reviewExport, reviewImport } from './steps/review.ts';
import { backbone, edges, map } from './steps/structure.ts';
import { textlayer } from './steps/textlayer.ts';
import { verify } from './steps/verify.ts';

export const STEPS: Record<string, (ctx: BuildContext) => Promise<void>> = {
  textlayer,
  backbone,
  map,
  edges,
  plan,
  passages,
  media,
  generate,
  check,
  verify,
  dispute: verify,
  'review-export': reviewExport,
  'review-import': reviewImport,
  package: packageStep,
  status: async (ctx) => {
    for (const [step, s] of Object.entries(ctx.state().steps)) {
      const { status, at, ...rest } = s;
      ctx.log(`${step.padEnd(14)} ${status.padEnd(8)} ${at}  ${JSON.stringify(rest)}`);
    }
    ctx.log(`AI cost so far: US$${costSummary(ctx.runs.records()).totalUsd.toFixed(2)}`);
  },
};

export const EXIT_PENDING = 75;

export function parseArgs(argv: string[]): {
  positional: string[];
  args: Record<string, string | true>;
} {
  const positional: string[] = [];
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    const next = argv[i + 1];
    if (inline !== undefined) args[name] = inline;
    else if (next !== undefined && !next.startsWith('--')) {
      args[name] = next;
      i++;
    } else args[name] = true;
  }
  return { positional, args };
}

/** Runs the steps in order; stops at the first one left pending. Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  const { positional, args } = parseArgs(argv);
  const [id, stepList] = positional;
  const steps = stepList?.split(',').map((s) => s.trim()) ?? [];
  const unknown = steps.filter((s) => !STEPS[s]);
  if (!id || steps.length === 0 || unknown.length > 0) {
    console.error(
      `Usage: pnpm library:build <grade-subject> <step>[,<step>...] [--topic CODE] [--fake]\nSteps: ${Object.keys(STEPS).join(', ')}${unknown.length ? `\nUnknown: ${unknown.join(', ')}` : ''}`,
    );
    return 2;
  }
  const {
    fake,
    force,
    topic,
    'work-dir': workDir,
    'wait-minutes': wait,
    'poll-seconds': poll,
    ...rest
  } = args;
  const opts: BuildOptions = {
    fake: fake !== undefined,
    force: force !== undefined,
    ...(typeof topic === 'string' ? { topic } : {}),
    ...(typeof workDir === 'string' ? { workDir } : {}),
    waitMinutes: typeof wait === 'string' ? Number(wait) : 60,
    pollSeconds: typeof poll === 'string' ? Number(poll) : 60,
    args: rest,
  };
  const ctx = new BuildContext(buildProfile(id), opts);
  console.log(
    `library:build ${ctx.profile.id} → ${ctx.dir}${opts.fake ? ' (fake: recorded fixtures, no network)' : ''}`,
  );
  for (const step of steps) {
    ctx.runs.step = step === 'dispute' ? 'verify' : step;
    console.log(`\n== ${step}${opts.topic ? ` (topic ${opts.topic})` : ''}`);
    await STEPS[step]!(ctx);
    const name = step === 'dispute' ? 'verify' : step;
    if (
      ctx.state().steps[name]?.status === 'pending' &&
      !(name === 'plan' && !ctx.flag('approve'))
    ) {
      console.log(`\n${name} is waiting on a batch; re-run the same command to continue.`);
      return EXIT_PENDING;
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
