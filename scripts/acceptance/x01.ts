// X01 acceptance (TASK_PACKS/X01.md), fake run only: no Supabase, no network, no model cost.
//   pnpm acceptance x01
// Runs every `pnpm library:build MATH.6 <step> --fake` step for one topic (about 10 items) in a temp
// work dir, then checks the package with `pnpm library:validate`. The real criteria (≥480 approved
// items, profile shares) are checked too and must FAIL on this tiny package: they are never faked.
// The live run is in docs/milestones/X01_REPORT.md ("Live run runbook").
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { simulateReview } from '../../tools/library-build/fixtures/simulate-review.ts';
import { assert, type Scenario } from './lib.ts';

const root = resolve(import.meta.dirname, '../..');
const FIXTURES = join(root, 'tools/library-build/fixtures/MATH.6');
const dir = mkdtempSync(join(tmpdir(), 'x01-acceptance-'));
const TOPIC = ['--topic', 'MATH.6.GEO.SHAPE'];
// Never let a run here reach Claude, whatever the shell has set.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => k !== 'AI_LIVE' && k !== 'ANTHROPIC_API_KEY' && k !== 'VIONX_DB_URL',
  ),
);

function pnpm(args: string[], workDir = dir) {
  const r = spawnSync('pnpm', ['-s', ...args, ...(workDir ? ['--work-dir', workDir] : [])], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnv,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const build = (steps: string, ...rest: string[]) => {
  const r = pnpm(['library:build', 'MATH.6', steps, '--fake', ...rest]);
  assert(r.status === 0, `${steps}: exit ${r.status}\n${r.out}`);
  return r.out;
};
const jsonl = (name: string) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, any>)
    : [];
const modelCalls = () => jsonl('ai_runs.jsonl').length;

export const scenario: Scenario = {
  name: 'X01 Toán 6 library build (fake run)',
  steps: [
    {
      name: 'Without --fake, a step that calls Claude refuses to run unless AI_LIVE=1 and ANTHROPIC_API_KEY are set',
      run: async () => {
        const live = mkdtempSync(join(tmpdir(), 'x01-live-'));
        const r = pnpm(
          [
            'library:build',
            'MATH.6',
            'backbone',
            '--gdpt',
            join(FIXTURES, 'gdpt-lop6-excerpt.txt'),
          ],
          live,
        );
        rmSync(live, { recursive: true, force: true });
        assert(
          r.status === 1 && /AI_LIVE=1 and ANTHROPIC_API_KEY/.test(r.out),
          `exit ${r.status}\n${r.out}`,
        );
        return 'refused: "This step calls Claude. Run it with AI_LIVE=1 and ANTHROPIC_API_KEY set, or add --fake"';
      },
    },
    {
      name: 'textlayer → backbone → map → edges → plan: text-layer page read locally, image-only page sent to the vision model',
      run: async () => {
        build(
          'textlayer,backbone,map,edges,plan',
          '--source',
          join(FIXTURES, 'source'),
          '--gdpt',
          join(FIXTURES, 'gdpt-lop6-excerpt.txt'),
          '--target',
          '28',
        );
        const pages = jsonl('pages.jsonl');
        assert(
          pages.length === 2 && pages[0]!.route === 'TEXT' && pages[1]!.route === 'AI',
          JSON.stringify(pages.map((p) => p.route)),
        );
        const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')) as {
          slots: { kind: string; svg: boolean }[];
        };
        assert(existsSync(join(dir, 'plan.csv')), 'plan.csv missing');
        const template = plan.slots.filter((s) => s.kind === 'TEMPLATE').length / plan.slots.length;
        assert(template >= 0.4, `TEMPLATE share ${template}`);
        return `2 pages (1 text layer, 1 vision); plan ${plan.slots.length} slots, TEMPLATE ${Math.round(template * 100)}%, ${plan.slots.filter((s) => s.svg).length} figures → plan.csv`;
      },
    },
    {
      name: 'Generation waits for an approved plan',
      run: async () => {
        const r = pnpm(['library:build', 'MATH.6', 'generate', '--fake', ...TOPIC]);
        assert(r.status === 1 && /plan/.test(r.out), `exit ${r.status}\n${r.out}`);
        build('plan', '--approve', '--by', 'acceptance');
        return 'refused before `plan --approve`; approved';
      },
    },
    {
      name: 'media → generate → check: an item copying SGK text is rejected by the n-gram check and regenerated',
      run: async () => {
        build('passages,media,generate,check,generate,check', ...TOPIC);
        const copied = jsonl('items-history.jsonl').find(
          (r) => r.slot === 'MATH.6.GEO.SHAPE.PERIM.Q03' && r.attempt === 1,
        );
        assert(
          copied && (copied.rejectedFor as string[]).some((f) => f.startsWith('ngram')),
          `no n-gram rejection: ${JSON.stringify(copied?.rejectedFor)}`,
        );
        const items = jsonl('items.jsonl');
        assert(
          items.length === 9 && items.every((r) => r.item.status === 'VALIDATING'),
          items.map((r) => r.item.status).join(','),
        );
        const calls = modelCalls();
        build('media,generate,check', ...TOPIC);
        assert(modelCalls() === calls, 're-run called a model again');
        return `PERIM.Q03 attempt 1 rejected (${(copied.rejectedFor as string[])[0]}); 9 items pass every check; re-run made 0 new model calls`;
      },
    },
    {
      name: 'verify: a verifier disagreement goes to dispute; review CSV round-trip with a human reviewer',
      run: async () => {
        build('verify,review-export', ...TOPIC);
        const disputed = jsonl('items.jsonl').filter((r) => r.dispute);
        assert(disputed.length === 1, `${disputed.length} disputes`);
        const reviewed = simulateReview(dir);
        build('review-import', '--file', reviewed, '--reviewer', 'Acceptance Reviewer');
        const items = jsonl('items.jsonl');
        assert(
          items.every((r) => r.item.status === 'APPROVED'),
          items.map((r) => r.item.status).join(','),
        );
        return `1 dispute (${disputed[0]!.dispute.verdict}); 9 rows reviewed (8 approved, 1 edited and re-checked)`;
      },
    },
    {
      name: 'package: M05 package that passes `pnpm library:validate`; cost printed from ai_runs',
      run: async () => {
        const out = build('package');
        assert(/US\$\d+\.\d{4}/.test(out), 'no cost table');
        const zip = join(dir, 'package', '6-math.zip');
        const r = pnpm(['library:validate', zip, '--seeds', '1000'], '');
        assert(r.status === 0, `library:validate exit ${r.status}\n${r.out}`);
        return r.out.split('\n')[0]!;
      },
    },
    {
      name: 'The real acceptance criteria are checked and fail on the 9-item fake package (not faked)',
      run: async () => {
        const r = pnpm(
          ['library:validate', join(dir, 'package', '6-math.zip'), '--acceptance'],
          '',
        );
        assert(
          r.status === 1 && /✗ 9 approved items \(need ≥480\)/.test(r.out),
          `exit ${r.status}\n${r.out}`,
        );
        return 'library:validate --acceptance exits 1: "✗ 9 approved items (need ≥480)"';
      },
    },
  ],
  cleanup: async () => {
    rmSync(dir, { recursive: true, force: true });
  },
};
