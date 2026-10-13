// M05 library against local Supabase (`pnpm db:start && pnpm fn:serve`). Library tables hold no
// household data, so the isolation checks here are about roles: parents, children and admins
// without a library permission are refused; LIBRARIAN reads, CONTENT_REVIEWER edits,
// CONTENT_ADMIN imports.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CoverageResponseSchema,
  CurriculumResponseSchema,
  GroupDetailSchema,
  ImportResultSchema,
  ItemDetailSchema,
  ItemListResponseSchema,
  LibraryOverviewSchema,
  VariantResponseSchema,
} from '@vionx/contracts';
import { signUpWithEmail, type AuthSession } from '../../../../scripts/lib/local-supabase.ts';
import { resetLibraryScope } from '../../../../scripts/lib/library-reset.ts';
import { readPackageDir, zipPackageDir } from '../../../../scripts/lib/library-files.ts';
import { packageInventory } from '../../../../packages/contracts/src/library-package.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const FIXTURES = resolve(import.meta.dirname, '../../../../scripts/acceptance/fixtures/m05');

async function api(
  method: string,
  path: string,
  who?: AuthSession,
  body?: unknown,
  zip?: Uint8Array,
) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${who.accessToken}`;
  if (zip) headers['content-type'] = 'application/zip';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(zip ? { body: zip } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const importZip = (who: AuthSession, zip: Uint8Array, mode: 'dry-run' | 'apply') =>
  api('POST', `/admin/library/import?mode=${mode}`, who, undefined, zip);

const users: string[] = [];
async function user(...permissions: string[]): Promise<AuthSession> {
  const session = await signUpWithEmail(`lib-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  users.push(session.userId);
  for (const p of permissions) {
    await sql`insert into ops.admin_permissions (user_id, permission) values (${session.userId}, ${p})`;
  }
  return session;
}

/** Copy of a fixture package in a temp dir (for edited variants), manifest refreshed. */
async function editedCopy(name: string, edit: (dir: string) => void): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'vionx-lib-'));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  edit(dir);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.checksums = (await packageInventory(readPackageDir(dir))).checksums;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const zip = zipPackageDir(dir);
  rmSync(dir, { recursive: true, force: true });
  return zip;
}

let admin: AuthSession;
let reviewer: AuthSession;
let librarian: AuthSession;
let analyst: AuthSession;
let parent: AuthSession;

beforeAll(async () => {
  for (const [grade, subject] of [
    [6, 'math'],
    [2, 'math'],
    [2, 'viet'],
  ] as const) {
    await resetLibraryScope(sql, grade, subject);
  }
  [admin, reviewer, librarian, analyst, parent] = await Promise.all([
    user('CONTENT_ADMIN'),
    user('CONTENT_REVIEWER'),
    user('LIBRARIAN'),
    user('ANALYST'),
    user(),
  ]);
});

afterAll(async () => {
  if (users.length > 0) await sql`delete from auth.users where id = any(${users}::uuid[])`;
  await sql.end({ timeout: 5 });
});

describe('package import', () => {
  const math6 = () => zipPackageDir(join(FIXTURES, 'gdpt2018/6-math'));

  it('refuses callers without the import permission', async () => {
    expect((await importZip(undefined as never, math6(), 'dry-run')).status).toBe(401);
    for (const who of [parent, analyst, librarian, reviewer]) {
      expect((await importZip(who, math6(), 'dry-run')).status).toBe(403);
    }
  });

  it('dry-run → apply → re-import is a no-op', async () => {
    const dry = await importZip(admin, math6(), 'dry-run');
    expect(dry.status).toBe(200);
    const d = ImportResultSchema.parse(dry.body);
    expect(d).toMatchObject({ mode: 'DRY_RUN', applied: false, noop: false });
    expect(d.diff.items.added).toHaveLength(10);
    expect(d.diff.nodes.added).toContain('MATH.6.NUM.FRAC.ADD');
    expect(d.coverage.totalItems).toBe(10);
    // Nothing written by the dry-run.
    const [{ n }] = await sql<
      { n: number }[]
    >`select count(*)::int as n from library.items where grade = 6 and subject = 'math'`;
    expect(n).toBe(0);

    const applied = ImportResultSchema.parse((await importZip(admin, math6(), 'apply')).body);
    expect(applied).toMatchObject({ mode: 'APPLY', applied: true, noop: false });
    expect(applied.diff.templates.added).toEqual(['T6-DEC-0001', 'T6-FRAC-0001', 'T6-GCD-0001']);

    const again = ImportResultSchema.parse((await importZip(admin, math6(), 'apply')).body);
    expect(again).toMatchObject({ applied: false, noop: true });
    for (const d of Object.values(again.diff)) {
      expect(d.added.length + d.updated.length + d.archived.length).toBe(0);
    }
    const audits = await sql`
      select details from ops.audit_logs where action = 'library.import_applied' and actor_id = ${admin.userId}`;
    expect(audits).toHaveLength(2);
    const events = await sql`
      select 1 from ops.domain_events e join library.import_runs r on r.id = e.aggregate_id
      where e.type = 'library.imported' and r.created_by = ${admin.userId}`;
    expect(events).toHaveLength(1);
  });

  it('imports the Toán 2 and Tiếng Việt 2 fixtures (SVG, read-aloud, groups, spelling template)', async () => {
    for (const name of ['gdpt2018/2-math', 'gdpt2018/2-viet']) {
      const res = await importZip(admin, zipPackageDir(join(FIXTURES, name)), 'apply');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.applied).toBe(true);
    }
    const svg = await sql<{ inline_svg: string }[]>`
      select inline_svg from library.media_assets where code = 'M2-APPLES-8'`;
    expect(svg[0]!.inline_svg).toMatch(/^<svg[^>]*>.*<\/svg>$/);
    // GRADE.2 is shared by both Grade 2 packages.
    const grades = await sql`select 1 from library.curriculum_nodes where code = 'GRADE.2'`;
    expect(grades).toHaveLength(1);
    const groups = await sql<{ code: string; source_note: string | null }[]>`
      select code, source_note from library.item_groups where grade = 2 and subject = 'viet' order by code`;
    expect(groups.map((g) => g.code)).toEqual(['GV2-PASSAGE-0001', 'GV2-POEM-0001']);
    expect(groups[1]!.source_note).toMatch(/Ca dao/);
  });

  it('rejects a package with a prerequisite cycle with a readable error', async () => {
    const res = await importZip(
      admin,
      zipPackageDir(join(FIXTURES, 'invalid/6-math-cycle')),
      'dry-run',
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PACKAGE_INVALID');
    expect(res.body.message).toBe(
      'Package is invalid: PREREQUISITE_OF edges form a cycle: MATH.6.NUM.FRAC.ADD → MATH.6.NUM.NAT.GCD → MATH.6.NUM.FRAC.SIMP → MATH.6.NUM.FRAC.ADD',
    );
    expect(res.body.details.errors[0].code).toBe('PREREQUISITE_CYCLE');
  });

  it('rejects tampered files, unsafe SVG source is sanitised, and junk bodies answer 400', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vionx-lib-'));
    cpSync(join(FIXTURES, 'gdpt2018/6-math'), dir, { recursive: true });
    writeFileSync(join(dir, 'edges.json'), '[]\n');
    const tampered = zipPackageDir(dir);
    rmSync(dir, { recursive: true, force: true });
    const res = await importZip(admin, tampered, 'dry-run');
    expect(res.status).toBe(422);
    expect(res.body.details.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CHECKSUM', ref: 'edges.json' })]),
    );

    const evil = await editedCopy('gdpt2018/6-math', (d) =>
      writeFileSync(
        join(d, 'media/rect-6x4.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="1" height="1"/></svg>',
      ),
    );
    const dry = ImportResultSchema.parse((await importZip(admin, evil, 'dry-run')).body);
    expect(dry.diff.media.updated).toEqual(['M6-RECT-6X4']);
    expect(dry.warnings.map((w) => w.code)).toContain('SVG_SANITISED');

    expect((await importZip(admin, new TextEncoder().encode('not a zip'), 'dry-run')).status).toBe(
      400,
    );
  });

  it('archives what a newer package drops, and never deletes', async () => {
    const smaller = await editedCopy('gdpt2018/6-math', (d) => {
      const lines = readFileSync(join(d, 'items.jsonl'), 'utf8').split('\n').filter(Boolean);
      writeFileSync(
        join(d, 'items.jsonl'),
        `${lines.filter((l) => !l.includes('"T6-FRAC-0002"')).join('\n')}\n`,
      );
    });
    const res = ImportResultSchema.parse((await importZip(admin, smaller, 'apply')).body);
    expect(res.diff.items.archived).toEqual(['T6-FRAC-0002']);
    const [row] = await sql<
      { status: string }[]
    >`select status from library.items where code = 'T6-FRAC-0002'`;
    expect(row!.status).toBe('ARCHIVED');
    // The original package restores it.
    const back = ImportResultSchema.parse(
      (await importZip(admin, zipPackageDir(join(FIXTURES, 'gdpt2018/6-math')), 'apply')).body,
    );
    expect(back.diff.items.restored).toEqual(['T6-FRAC-0002']);
  });

  it('refuses codes owned by another grade-subject', async () => {
    const thief = await editedCopy('gdpt2018/2-math', (d) => {
      const lines = readFileSync(join(d, 'items.jsonl'), 'utf8').split('\n').filter(Boolean);
      lines[0] = lines[0]!.replace('"T2-COUNT-0001"', '"T6-SIMP-0001"');
      writeFileSync(join(d, 'items.jsonl'), `${lines.join('\n')}\n`);
    });
    const res = await importZip(admin, thief, 'dry-run');
    expect(res.status).toBe(422);
    expect(res.body.details.errors[0]).toMatchObject({ code: 'CODE_TAKEN', ref: 'T6-SIMP-0001' });
  });
});

describe('reads', () => {
  it('overview, curriculum tree and coverage for readers only', async () => {
    expect((await api('GET', '/admin/library', parent)).status).toBe(403);
    const overview = LibraryOverviewSchema.parse(
      (await api('GET', '/admin/library', librarian)).body,
    );
    expect(overview.versions.map((v) => v.code)).toContain('gdpt2018');
    expect(overview.profiles).toHaveLength(8);
    expect(overview.libraries.find((l) => l.grade === 6 && l.subject === 'math')).toMatchObject({
      items: 10,
      approvedItems: 10,
      skills: 5,
      activeSkills: 5,
    });

    const tree = CurriculumResponseSchema.parse(
      (await api('GET', '/admin/library/curriculum?grade=2&subject=viet', librarian)).body,
    );
    expect(tree.nodes[0]).toMatchObject({ level: 'GRADE', code: 'GRADE.2', parentId: null });
    expect(tree.nodes.find((n) => n.code === 'VIET.2.READ.COMP.DETAIL')).toMatchObject({
      items: 3,
      approvedItems: 3,
      active: true,
    });
    expect(tree.nodes.find((n) => n.code === 'VIET.2.WRITE.SPELL.SX')).toMatchObject({
      active: false,
    });
    expect(tree.nodes.some((n) => n.code.startsWith('MATH.'))).toBe(false);

    const coverage = CoverageResponseSchema.parse(
      (await api('GET', '/admin/library/coverage?grade=2&subject=viet', librarian)).body,
    );
    expect(coverage.profile).toMatchObject({ titleVi: 'Tiếng Việt 2', groupShare: 0.4 });
    expect(coverage.coverage).toMatchObject({ totalItems: 7, targetItems: 500, readAloudShare: 1 });
    expect(coverage.coverage.inactiveSkills).toContain('VIET.2.WRITE.SPELL.SX');

    expect(
      (await api('GET', '/admin/library/curriculum?grade=2&subject=viet&version=nope', librarian))
        .status,
    ).toBe(404);
  });

  it('lists items with filters and a cursor', async () => {
    const all = ItemListResponseSchema.parse(
      (await api('GET', '/admin/library/items?grade=6&subject=math&limit=4', librarian)).body,
    );
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).not.toBeNull();
    const next = ItemListResponseSchema.parse(
      (
        await api(
          'GET',
          `/admin/library/items?grade=6&subject=math&limit=4&cursor=${encodeURIComponent(all.nextCursor!)}`,
          librarian,
        )
      ).body,
    );
    expect(next.items[0]!.code > all.items[3]!.code).toBe(true);

    const templates = ItemListResponseSchema.parse(
      (await api('GET', '/admin/library/items?grade=6&subject=math&kind=TEMPLATE', librarian)).body,
    );
    expect(templates.items.map((i) => i.code)).toEqual([
      'T6-DEC-0001',
      'T6-FRAC-0001',
      'T6-GCD-0001',
    ]);
    const bySkill = ItemListResponseSchema.parse(
      (await api('GET', '/admin/library/items?skill=MATH.6.NUM.FRAC.SIMP&level=L2', librarian))
        .body,
    );
    expect(bySkill.items.map((i) => i.code)).toEqual(['T6-SIMP-0001']);
    const byType = ItemListResponseSchema.parse(
      (await api('GET', '/admin/library/items?type=spelling_choice&status=APPROVED', librarian))
        .body,
    );
    expect(byType.items.map((i) => i.code)).toEqual(['TV2-SPELL-0001']);
    const search = ItemListResponseSchema.parse(
      (await api('GET', '/admin/library/items?q=táo', librarian)).body,
    );
    expect(search.items.map((i) => i.code)).toEqual(['T2-COUNT-0001', 'T2-COUNT-0002']);
  });

  it('item detail carries template, group and sanitised media; variants are deterministic', async () => {
    const [frac] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'T6-FRAC-0001'`;
    const detail = ItemDetailSchema.parse(
      (await api('GET', `/admin/library/items/${frac!.id}`, librarian)).body,
    );
    expect(detail.template).toMatchObject({
      answerExpr: expect.stringContaining('frac'),
      flaggedAt: null,
    });

    const v1 = VariantResponseSchema.parse(
      (await api('GET', `/admin/library/items/${frac!.id}/variant?seed=7`, librarian)).body,
    );
    const v2 = VariantResponseSchema.parse(
      (await api('GET', `/admin/library/items/${frac!.id}/variant?seed=7`, librarian)).body,
    );
    expect(v1).toEqual(v2);
    expect(v1.options).toHaveLength(3);

    const [pic] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'TV2-PIC-0001'`;
    const picture = ItemDetailSchema.parse(
      (await api('GET', `/admin/library/items/${pic!.id}`, librarian)).body,
    );
    expect(picture.media.map((m) => m.code)).toEqual(['MV2-CAT', 'MV2-DOG', 'MV2-FISH']);
    expect(picture.media[0]!.inlineSvg).toMatch(/^<svg/);
    expect(
      (await api('GET', `/admin/library/items/${pic!.id}/variant?seed=1`, librarian)).status,
    ).toBe(409);

    const [read] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'TV2-READ-0001'`;
    const grouped = ItemDetailSchema.parse(
      (await api('GET', `/admin/library/items/${read!.id}`, librarian)).body,
    );
    expect(grouped.group).toMatchObject({ code: 'GV2-PASSAGE-0001', sourceKind: 'ORIGINAL_AI' });
    expect(grouped.media.map((m) => m.code)).toEqual(['MV2-CAT']);

    expect((await api('GET', `/admin/library/items/${randomUUID()}`, librarian)).status).toBe(404);
    expect((await api('GET', `/admin/library/items/${read!.id}`, parent)).status).toBe(403);
  });

  it('children cannot reach admin library routes', async () => {
    const res = await fetch(`${API}/admin/library/items`, {
      headers: { 'x-vionx-child-session': 'not-a-session' },
    });
    expect(res.status).toBe(401);
  });
});

describe('edits', () => {
  it('reviewers edit items with version checks, rule checks and an audit log', async () => {
    const [row] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'T6-SIMP-0001'`;
    const id = row!.id;
    const detail = ItemDetailSchema.parse(
      (await api('GET', `/admin/library/items/${id}`, reviewer)).body,
    );

    expect(
      (
        await api('PATCH', `/admin/library/items/${id}`, librarian, {
          version: detail.version,
          status: 'PUBLISHED',
        })
      ).status,
    ).toBe(403);
    const badAnswer = await api('PATCH', `/admin/library/items/${id}`, reviewer, {
      version: detail.version,
      answer: { optionId: 'z' },
    });
    expect(badAnswer.status).toBe(400);
    expect(badAnswer.body.message).toMatch(/optionId/);
    expect(
      (
        await api('PATCH', `/admin/library/items/${id}`, reviewer, {
          version: detail.version,
          hints: detail.hints.slice(0, 2),
        })
      ).status,
    ).toBe(400);

    const ok = await api('PATCH', `/admin/library/items/${id}`, reviewer, {
      version: detail.version,
      stemMd: 'Rút gọn phân số $\\frac{18}{24}$ về phân số tối giản:',
      status: 'PUBLISHED',
    });
    expect(ok.status).toBe(200);
    const updated = ItemDetailSchema.parse(ok.body);
    expect(updated).toMatchObject({ version: detail.version + 1, status: 'PUBLISHED' });

    const stale = await api('PATCH', `/admin/library/items/${id}`, reviewer, {
      version: detail.version,
      status: 'APPROVED',
    });
    expect(stale.status).toBe(409);

    const audit = await sql`
      select details from ops.audit_logs where action = 'library.item_updated' and target_id = ${id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ code: 'T6-SIMP-0001', fields: ['stemMd', 'status'] });

    // An edited item shows up as "updated" when the original package is dry-run again.
    const dry = ImportResultSchema.parse(
      (await importZip(admin, zipPackageDir(join(FIXTURES, 'gdpt2018/6-math')), 'dry-run')).body,
    );
    expect(dry.diff.items.updated).toEqual(['T6-SIMP-0001']);
  });

  it('template edits must render; an unsatisfiable template is refused', async () => {
    const [row] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'T2-ADD-0002'`;
    const detail = ItemDetailSchema.parse(
      (await api('GET', `/admin/library/items/${row!.id}`, reviewer)).body,
    );
    const template = { ...detail.template!, flaggedAt: undefined, flagReason: undefined };
    const bad = await api('PATCH', `/admin/library/items/${row!.id}`, reviewer, {
      version: detail.version,
      template: { ...template, constraints: ['a > 1000'] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/constraints/);
    const good = await api('PATCH', `/admin/library/items/${row!.id}`, reviewer, {
      version: detail.version,
      template: { ...template, distractorExprs: ['a + b - 10', 'a + b + 10'] },
    });
    expect(good.status).toBe(200);
    expect(ItemDetailSchema.parse(good.body).template!.distractorExprs).toEqual([
      'a + b - 10',
      'a + b + 10',
    ]);
  });

  it('group edits keep the source-note rule', async () => {
    const [row] = await sql<
      { id: string }[]
    >`select id from library.item_groups where code = 'GV2-POEM-0001'`;
    const group = GroupDetailSchema.parse(
      (await api('GET', `/admin/library/groups/${row!.id}`, librarian)).body,
    );
    expect(group.items.map((i) => i.code)).toEqual(['TV2-POEM-0001']);
    const bad = await api('PATCH', `/admin/library/groups/${row!.id}`, reviewer, {
      version: group.version,
      sourceNote: ' ',
    });
    expect(bad.status).toBe(400);
    const ok = await api('PATCH', `/admin/library/groups/${row!.id}`, reviewer, {
      version: group.version,
      title: 'Công cha nghĩa mẹ (ca dao)',
    });
    expect(ok.status).toBe(200);
    expect(GroupDetailSchema.parse(ok.body)).toMatchObject({
      version: group.version + 1,
      title: 'Công cha nghĩa mẹ (ca dao)',
    });
    const list = await api('GET', '/admin/library/groups?grade=2&subject=viet', librarian);
    expect(list.body.groups).toHaveLength(2);
  });
});

describe('database guards', () => {
  it('library tables are closed to client roles and keep the no-personal-data shape', async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'library' and table_type = 'BASE TABLE'`;
    expect(tables.length).toBeGreaterThanOrEqual(14);
    for (const { table_name } of tables) {
      const [grant] = await sql<{ allowed: boolean }[]>`
        select bool_or(has_table_privilege(r, ${`library.${table_name}`}, 'select,insert,update,delete')) as allowed
        from unnest(array['anon', 'authenticated']) as r`;
      expect(grant!.allowed, table_name).toBe(false);
    }
    const personal = await sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'library' and column_name in ('household_id', 'student_id', 'user_id', 'child_id')`;
    expect(personal).toEqual([]);
  });

  it('rejects a template on a STATIC item and a PUBLIC_DOMAIN group without a source note', async () => {
    const [item] = await sql<
      { id: string }[]
    >`select id from library.items where code = 'T6-SIMP-0002'`;
    await expect(
      sql`insert into library.item_templates (item_id, params, answer_expr, render, content_hash)
          values (${item!.id}, '[]', 'x', '{}', 'h')`,
    ).rejects.toThrow(/not a TEMPLATE item/);
    await expect(
      sql`insert into library.item_groups (code, grade, subject, stimulus_kind, title, body_md, source_kind, content_hash)
          values ('X', 2, 'viet', 'POEM', 't', 'b', 'PUBLIC_DOMAIN', 'h')`,
    ).rejects.toThrow(/check constraint/);
  });
});
