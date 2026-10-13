// M05 acceptance (TASK_PACKS/M05.md). Requires `pnpm db:start && pnpm fn:serve` (local only: signs
// up a throwaway CONTENT_ADMIN and clears the three fixture libraries first).
//   pnpm acceptance m05
// Flow: Toán 6 (templates), Toán 2 (SVG counting, read-aloud) and Tiếng Việt 2 (passage group,
// spelling template, picture choice) each run dry-run → apply → re-import as a no-op; a package
// with a PREREQUISITE_OF cycle is rejected with a readable error; `pnpm library:validate` accepts
// the fixtures; every fixture template holds over 10,000 seeds.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { readPackageDir, zipPackageDir } from '../lib/library-files.ts';
import { resetLibraryScope } from '../lib/library-reset.ts';
import { parseLibraryPackage } from '../../packages/contracts/src/library-package.ts';
import { probeTemplate } from '../../packages/domain/src/index.ts';
import { assert, connectDb, env, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const root = resolve(import.meta.dirname, '../..');
const FIXTURES = join(import.meta.dirname, 'fixtures/m05');
const sql = connectDb();
const users: string[] = [];
const state: { admin?: AuthSession } = {};

const LIBRARIES = [
  { dir: 'gdpt2018/6-math', grade: 6, subject: 'math', label: 'Toán 6' },
  { dir: 'gdpt2018/2-math', grade: 2, subject: 'math', label: 'Toán 2' },
  { dir: 'gdpt2018/2-viet', grade: 2, subject: 'viet', label: 'Tiếng Việt 2' },
] as const;

interface DiffCounts {
  added: string[];
  updated: string[];
  archived: string[];
  unchanged: number;
}
interface ImportBody {
  applied?: boolean;
  noop?: boolean;
  diff?: Record<string, DiffCounts>;
  code?: string;
  message?: string;
  details?: { errors: { code: string; message: string }[] };
  coverage?: { totalItems: number; templateShare: number; groupShare: number; readAloudShare: number };
}

async function importPackage(dir: string, mode: 'dry-run' | 'apply') {
  const res = await fetch(`${API}/admin/library/import?mode=${mode}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.admin!.accessToken}`,
      'content-type': 'application/zip',
    },
    body: zipPackageDir(join(FIXTURES, dir)),
  });
  return { status: res.status, body: (await res.json()) as ImportBody };
}

const changes = (diff: Record<string, DiffCounts>) =>
  Object.entries(diff)
    .filter(([, d]) => d.added.length + d.updated.length + d.archived.length > 0)
    .map(([k, d]) => `${k} +${d.added.length}`)
    .join(', ');

export const scenario: Scenario = {
  name: 'M05 — Curriculum & shared content library core',
  steps: [
    {
      name: 'A content admin signs in; the fixture libraries start empty',
      run: async () => {
        const admin = await signUpWithEmail(`acceptance-m05-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
        users.push(admin.userId);
        await sql`insert into ops.admin_permissions (user_id, permission) values (${admin.userId}, 'CONTENT_ADMIN')`;
        state.admin = admin;
        for (const l of LIBRARIES) await resetLibraryScope(sql, l.grade, l.subject);
        return `admin ${admin.userId}`;
      },
    },
    ...LIBRARIES.map((l) => ({
      name: `${l.label}: dry-run → apply → re-import is a no-op`,
      run: async () => {
        const dry = await importPackage(l.dir, 'dry-run');
        assert(dry.status === 200, `dry-run ${dry.status} ${JSON.stringify(dry.body)}`);
        assert(dry.body.applied === false && dry.body.noop === false, 'dry-run should report changes without applying');
        const [before] = await sql<{ n: number }[]>`
          select count(*)::int as n from library.items where grade = ${l.grade} and subject = ${l.subject}`;
        assert(before!.n === 0, 'dry-run must not write');

        const apply = await importPackage(l.dir, 'apply');
        assert(apply.status === 200 && apply.body.applied === true, `apply ${apply.status} ${JSON.stringify(apply.body)}`);
        const [after] = await sql<{ n: number }[]>`
          select count(*)::int as n from library.items where grade = ${l.grade} and subject = ${l.subject}`;
        assert(after!.n === apply.body.diff!.items!.added.length, 'every item written');

        const again = await importPackage(l.dir, 'apply');
        assert(again.status === 200, `re-import ${again.status}`);
        assert(again.body.noop === true && again.body.applied === false, 're-import must be a no-op');
        const c = apply.body.coverage!;
        return `${changes(apply.body.diff!)}; re-import no-op; ${c.totalItems} items, TEMPLATE ${Math.round(c.templateShare * 100)}%, groups ${Math.round(c.groupShare * 100)}%, read-aloud ${Math.round(c.readAloudShare * 100)}%`;
      },
    })),
    {
      name: 'Imported content is where the fixtures put it (SVG sanitised, passage group, spelling template)',
      run: async () => {
        const [svg] = await sql<{ inline_svg: string }[]>`
          select inline_svg from library.media_assets where code = 'M2-APPLES-8'`;
        assert(svg && /^<svg[\s>]/.test(svg.inline_svg) && !/script|on\w+=/i.test(svg.inline_svg), 'counting SVG stored sanitised');
        const tts = await sql`
          select code from library.items where grade = 2 and subject = 'math' and coalesce(tts_text, '') = ''`;
        assert(tts.length === 0, 'Toán 2 items all carry tts text');
        const grouped = await sql<{ n: number }[]>`
          select count(*)::int as n from library.items i join library.item_groups g on g.id = i.group_id
          where g.code = 'GV2-PASSAGE-0001'`;
        assert(grouped[0]!.n === 3, 'passage group has its 3 items');
        const spelling = await sql`
          select 1 from library.items i join library.item_templates t on t.item_id = i.id
          where i.code = 'TV2-SPELL-0001' and i.type = 'spelling_choice'`;
        assert(spelling.length === 1, 'spelling template stored');
        const pic = await sql`select 1 from library.items where code = 'TV2-PIC-0001' and type = 'picture_choice'`;
        assert(pic.length === 1, 'picture choice stored');
        return 'SVG sanitised, read-aloud text on every Toán 2 item, passage group with 3 items, spelling template, picture choice';
      },
    },
    {
      name: 'A package with a PREREQUISITE_OF cycle is rejected with a readable error',
      run: async () => {
        const res = await importPackage('invalid/6-math-cycle', 'dry-run');
        assert(res.status === 422 && res.body.code === 'PACKAGE_INVALID', `expected 422 PACKAGE_INVALID, got ${res.status}`);
        assert(/cycle: .+ → .+ → .+ → /.test(res.body.message ?? ''), `unreadable message: ${res.body.message}`);
        return res.body.message!;
      },
    },
    {
      name: '`pnpm library:validate` accepts the fixtures and rejects the cycle',
      run: async () => {
        const out: string[] = [];
        for (const dir of [...LIBRARIES.map((l) => l.dir), 'invalid/6-math-cycle']) {
          const r = spawnSync('pnpm', ['-s', 'library:validate', join(FIXTURES, dir), '--seeds', '200'], {
            cwd: root,
            encoding: 'utf8',
          });
          const expected = dir.startsWith('invalid/') ? 1 : 0;
          assert(r.status === expected, `${dir}: exit ${r.status}\n${r.stdout}${r.stderr}`);
          out.push(`${dir}: exit ${r.status}`);
        }
        return out.join('; ');
      },
    },
    {
      name: 'Template property test: every fixture template over 10,000 seeds',
      run: async () => {
        const counted: string[] = [];
        for (const l of LIBRARIES) {
          const parsed = await parseLibraryPackage(readPackageDir(join(FIXTURES, l.dir)));
          assert(parsed.ok, `${l.dir} does not parse`);
          for (const t of parsed.pkg.templates) {
            const item = parsed.pkg.items.find((i) => i.code === t.item)!;
            const probe = probeTemplate({ ...t, type: item.type }, 10_000);
            assert(probe.ok, `${t.item}: ${JSON.stringify(probe)}`);
            counted.push(t.item);
          }
        }
        return `${counted.length} templates × 10,000 seeds: ${counted.join(', ')}`;
      },
    },
  ],
  cleanup: async () => {
    if (users.length > 0) await sql`delete from auth.users where id = any(${users}::uuid[])`;
    await sql.end({ timeout: 5 });
  },
};
