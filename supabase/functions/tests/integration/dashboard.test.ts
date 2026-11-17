// M08 parent dashboard & gradebook (`pnpm cloud pnpm test:api`, or CI's local Supabase). Uses
// whatever approved Toán 6 items the library holds and never changes them; an empty library gets
// the M05 fixture. Gradebook CRUD with audit and attachment, dashboard numbers after a task and a
// practice session, grades beside mastery (never merged), overview, cross-household denial (404).
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssessmentUploadSignResponseSchema,
  DashboardResponseSchema,
  HouseholdOverviewResponseSchema,
  NextItemResponseSchema,
  PoliciesResponseSchema,
  SchoolAssessmentListResponseSchema,
  SchoolAssessmentResponseSchema,
  SessionCreateResponseSchema,
  StudentCreateResponseSchema,
  type DashboardResponse,
} from '@vionx/contracts';
import { DEFAULT_DASHBOARD_CONFIG, schoolTermOf } from '@vionx/domain';
import { findTopic, solve } from '../../../../scripts/lib/learning-solver.ts';
import { zipPackageDir } from '../../../../scripts/lib/library-files.ts';
import { signUpWithEmail, type AuthSession } from '../../../../scripts/lib/local-supabase.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SERVICE_SECRET = process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });

type Auth = { parent?: AuthSession; child?: string };

async function api(method: string, path: string, auth: Auth = {}, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.parent) headers.authorization = `Bearer ${auth.parent.accessToken}`;
  if (auth.child) headers['x-vionx-child-session'] = auth.child;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    // The local Edge Runtime answers a request sent to a retiring isolate itself (no requestId).
    if (attempt === 1 && res.status === 500 && parsed && !('requestId' in parsed)) continue;
    return { status: res.status, body: parsed };
  }
}

async function drain(eventIds: string[]) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${FUNCTIONS_URL}/worker`, {
      method: 'POST',
      headers: { 'x-vionx-service-secret': SERVICE_SECRET, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events
      where consumer = 'worker' and event_id = any(${eventIds}::uuid[])`;
    if (row!.n === eventIds.length) return;
    if (Date.now() > deadline) throw new Error(`events not processed: ${row!.n}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let policyVersion = 1;
const createdUsers: string[] = [];

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

async function newFamily(grade: number): Promise<Family> {
  const parent = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  createdUsers.push(parent.userId);
  const household = await api('POST', '/household', { parent }, { name: 'Gia đình sổ điểm' });
  expect(household.status).toBe(201);
  const created = await api(
    'POST',
    '/students',
    { parent },
    { displayName: 'Con', birthYear: 2026 - 6 - grade, grade, pin: '4826' },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const body = StudentCreateResponseSchema.parse(created.body);
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS']) {
    const g = await api(
      'POST',
      `/students/${body.student.id}/consents/${type}/grant`,
      { parent },
      { policyVersion },
    );
    expect(g.status, JSON.stringify(g.body)).toBe(200);
  }
  const login = await api(
    'POST',
    '/auth/child/login',
    {},
    { ...body.credentials, deviceId: `it-${randomUUID()}` },
  );
  expect(login.status).toBe(200);
  return {
    parent,
    householdId: household.body.household.id,
    studentId: body.student.id,
    child: login.body.token as string,
  };
}

async function importMath6Fixture() {
  const admin = await signUpWithEmail(`m08-lib-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  try {
    await sql`insert into ops.admin_permissions (user_id, permission) values (${admin.userId}, 'CONTENT_ADMIN')`;
    const zip = zipPackageDir(
      resolve(import.meta.dirname, '../../../../scripts/acceptance/fixtures/m05/gdpt2018/6-math'),
    );
    const res = await fetch(`${API}/admin/library/import?mode=apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': 'application/zip',
      },
      body: zip as Uint8Array<ArrayBuffer>,
    });
    expect(res.status).toBe(200);
  } finally {
    await sql`delete from ops.admin_permissions where user_id = ${admin.userId}`;
    await sql`delete from auth.users where id = ${admin.userId}`;
  }
}

async function dashboard(f: Family, range?: string): Promise<DashboardResponse> {
  const res = await api(
    'GET',
    `/students/${f.studentId}/dashboard${range ? `?range=${range}` : ''}`,
    { parent: f.parent },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return DashboardResponseSchema.parse(res.body);
}

const grade = (f: Family, body: Record<string, unknown>) =>
  api('POST', `/students/${f.studentId}/school-assessments`, { parent: f.parent }, body);

// Household-local "today" in Asia/Ho_Chi_Minh (UTC+7, no daylight saving).
const TODAY = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const dayBefore = (n: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

let a: Family;
let b: Family; // another household
let skillId: string;

beforeAll(async () => {
  const policies = PoliciesResponseSchema.parse((await api('GET', '/policies/current')).body);
  policyVersion = policies.policies.find((p) => p.type === 'PRIVACY_POLICY')!.version;
  let found = await findTopic(sql, 6, 'math', null, 1);
  if (!found) {
    await importMath6Fixture();
    found = await findTopic(sql, 6, 'math', null, 1);
  }
  if (!found) throw new Error('No approved Toán 6 items after importing the M05 fixture');
  skillId = found.skillIds[0]!;
  a = await newFamily(6);
  b = await newFamily(6);
}, 180_000);

afterAll(async () => {
  if (createdUsers.length > 0) {
    await sql`
      delete from app.households where id in (
        select household_id from app.household_memberships where user_id = any(${createdUsers}::uuid[]))`;
    await sql`delete from auth.users where id = any(${createdUsers}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

const TABLES = [
  'dashboard_config',
  'school_assessments',
  'school_assessment_skill_mappings',
  'student_day_summaries',
];

describe('schema', () => {
  it('stores the dashboard config of @vionx/domain', async () => {
    const [row] = await sql<{ config: unknown }[]>`
      select config from app.dashboard_config order by version desc limit 1`;
    expect(row!.config).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });

  it('has RLS on every M08 table and no privilege for client roles', async () => {
    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = any(${TABLES})`;
    expect(rls).toHaveLength(TABLES.length);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    const grants = await sql`
      select table_name, grantee from information_schema.role_table_grants
      where table_schema = 'app' and table_name = any(${TABLES})
        and grantee in ('anon', 'authenticated', 'PUBLIC')`;
    expect(grants).toHaveLength(0);
  });

  it('keeps test photos in a private bucket', async () => {
    const buckets = await sql`
      select public, file_size_limit from storage.buckets where id = 'assessment-files'`;
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.public).toBe(false);
    expect(Number(buckets[0]!.file_size_limit)).toBe(10 * 1024 * 1024);
  });
});

describe('an empty dashboard', () => {
  it('has numbers for a new child and labels everything INSUFFICIENT', async () => {
    const d = await dashboard(a);
    expect(d).toMatchObject({
      studentId: a.studentId,
      grade: 6,
      range: '7d',
      to: TODAY,
      from: dayBefore(6),
      streak: { days: 0, activeDays: 0, sufficiency: 'INSUFFICIENT' },
      tasks: { total: 0, done: 0, completion: null, sufficiency: 'INSUFFICIENT' },
      learning: { sessions: 0, answers: 0, accuracy: null, sufficiency: 'INSUFFICIENT' },
      school: { schoolYear: schoolTermOf(TODAY).schoolYear, subjects: [] },
      sideBySide: [],
      upcomingExams: [],
    });
    expect(d.rewards).toMatchObject({ coinBalance: 0, coinsToday: 0, coinsWeek: 0, level: 1 });
    expect(d.days).toHaveLength(7);
    expect(d.days.at(-1)!.day).toBe(TODAY);
    expect(d.today.itemsTotal).toBeGreaterThan(0); // the planner proposes the next skill
    expect(d.today.itemsDone).toBe(0);
    const math = d.learning.subjects.find((s) => s.subject === 'math')!;
    expect(math).toMatchObject({ practised: 0, meanScore: null, sufficiency: 'INSUFFICIENT' });
    expect(math.skills).toBeGreaterThan(0);
  });

  it('accepts 7d, 30d and 90d only', async () => {
    expect((await dashboard(a, '30d')).days).toHaveLength(30);
    expect((await dashboard(a, '90d')).days).toHaveLength(90);
    const bad = await api('GET', `/students/${a.studentId}/dashboard?range=1y`, {
      parent: a.parent,
    });
    expect(bad.status).toBe(400);
  });
});

describe('gradebook', () => {
  let firstId: string;

  it('a parent enters a grade; defaults come from the day; the child cannot', async () => {
    const res = await grade(a, {
      subjectCode: 'TOAN',
      assessedOn: dayBefore(20),
      type: 'SHORT_QUIZ',
      score: 7.5,
      topicTags: ['Phân số'],
      teacherComment: 'Cần cẩn thận hơn',
      skillIds: [skillId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { assessment } = SchoolAssessmentResponseSchema.parse(res.body);
    expect(assessment).toMatchObject({
      studentId: a.studentId,
      subjectCode: 'TOAN',
      type: 'SHORT_QUIZ',
      score: 7.5,
      maxScore: 10,
      percent: 75,
      ...schoolTermOf(dayBefore(20)),
      topicTags: ['Phân số'],
      note: null,
      teacherComment: 'Cần cẩn thận hơn',
      skillIds: [skillId],
      attachmentUrl: null,
    });
    firstId = assessment.id;

    const path = `/students/${a.studentId}/school-assessments`;
    expect((await api('GET', path, { child: a.child })).status).toBe(403);
    expect(
      (
        await api(
          'POST',
          path,
          { child: a.child },
          { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 10 },
        )
      ).status,
    ).toBe(403);
    expect((await api('GET', path)).status).toBe(401);
  });

  it('rejects impossible grades, unknown skills and files that are not ours', async () => {
    const base = { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 8 };
    const cases: Record<string, unknown>[] = [
      { ...base, score: 11 },
      { ...base, score: 8, maxScore: 5 },
      { ...base, score: -1 },
      { ...base, subjectCode: 'NOPE' },
      { ...base, assessedOn: '2026-02-30' },
      { ...base, schoolYear: '2026-2028' },
      { ...base, skillIds: [randomUUID()] },
      { ...base, attachmentPath: `${b.householdId}/${b.studentId}/${randomUUID()}.png` },
      { ...base, attachmentPath: `${a.householdId}/${a.studentId}/${randomUUID()}.png` },
    ];
    for (const body of cases) {
      const res = await grade(a, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const rows = await sql`
      select id from app.school_assessments where student_id = ${a.studentId}`;
    expect(rows).toHaveLength(1);
  });

  it('lists newest first with filters and a cursor', async () => {
    for (const [n, score, subjectCode] of [
      [10, 8, 'TOAN'],
      [5, 9, 'TOAN'],
      [3, 6, 'NGU_VAN'],
    ] as const) {
      const res = await grade(a, {
        subjectCode,
        assessedOn: dayBefore(n),
        type: 'PERIODIC_TEST',
        score,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const path = `/students/${a.studentId}/school-assessments`;
    const all = SchoolAssessmentListResponseSchema.parse(
      (await api('GET', path, { parent: a.parent })).body,
    );
    expect(all.assessments.map((x) => x.assessedOn)).toEqual([
      dayBefore(3),
      dayBefore(5),
      dayBefore(10),
      dayBefore(20),
    ]);
    expect(all.nextCursor).toBeNull();

    const math = SchoolAssessmentListResponseSchema.parse(
      (await api('GET', `${path}?subjectCode=TOAN`, { parent: a.parent })).body,
    );
    expect(math.assessments.map((x) => x.score)).toEqual([9, 8, 7.5]);

    const page1 = SchoolAssessmentListResponseSchema.parse(
      (await api('GET', `${path}?limit=3`, { parent: a.parent })).body,
    );
    expect(page1.assessments).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = SchoolAssessmentListResponseSchema.parse(
      (await api('GET', `${path}?limit=3&cursor=${page1.nextCursor}`, { parent: a.parent })).body,
    );
    expect(page2.assessments.map((x) => x.id)).toEqual([firstId]);
    expect(page2.nextCursor).toBeNull();
    expect((await api('GET', `${path}?cursor=nonsense`, { parent: a.parent })).status).toBe(400);
  });

  it('corrects and deletes a grade; every edit is audited', async () => {
    const patched = await api(
      'PATCH',
      `/school-assessments/${firstId}`,
      { parent: a.parent },
      { score: 8, note: 'Chấm lại', skillIds: [] },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(SchoolAssessmentResponseSchema.parse(patched.body).assessment).toMatchObject({
      score: 8,
      percent: 80,
      note: 'Chấm lại',
      skillIds: [],
      teacherComment: 'Cần cẩn thận hơn',
    });
    expect(
      (await api('PATCH', `/school-assessments/${firstId}`, { parent: a.parent }, { maxScore: 5 }))
        .status,
    ).toBe(400);
    expect(
      (await api('PATCH', `/school-assessments/${firstId}`, { child: a.child }, { score: 10 }))
        .status,
    ).toBe(403);

    const extra = SchoolAssessmentResponseSchema.parse(
      (await grade(a, { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 1 })).body,
    ).assessment;
    expect(
      (await api('DELETE', `/school-assessments/${extra.id}`, { child: a.child })).status,
    ).toBe(403);
    expect(
      (await api('DELETE', `/school-assessments/${extra.id}`, { parent: a.parent })).status,
    ).toBe(204);
    expect(
      (await api('DELETE', `/school-assessments/${extra.id}`, { parent: a.parent })).status,
    ).toBe(404);

    const audit = await sql<{ action: string; details: Record<string, unknown> }[]>`
      select action, details from ops.audit_logs
      where household_id = ${a.householdId} and action like 'school_assessment.%'
      order by created_at`;
    expect(audit.map((r) => r.action)).toEqual([
      'school_assessment.created',
      'school_assessment.created',
      'school_assessment.created',
      'school_assessment.created',
      'school_assessment.updated',
      'school_assessment.created',
      'school_assessment.deleted',
    ]);
    expect(audit[4]!.details).toMatchObject({ fields: ['score', 'note', 'skillIds'] });
  });

  it('stores an attached photo privately and removes it with the grade', async () => {
    const signed = await api(
      'POST',
      `/students/${a.studentId}/school-assessments/upload-sign`,
      { parent: a.parent },
      { contentType: 'image/png' },
    );
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const target = AssessmentUploadSignResponseSchema.parse(signed.body);
    expect(target.path.startsWith(`${a.householdId}/${a.studentId}/`)).toBe(true);
    expect(
      (
        await api(
          'POST',
          `/students/${a.studentId}/school-assessments/upload-sign`,
          { child: a.child },
          { contentType: 'image/png' },
        )
      ).status,
    ).toBe(403);
    // A 1×1 PNG.
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      ),
      (ch) => ch.charCodeAt(0),
    );
    const put = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(put.ok, await put.text()).toBe(true);

    const res = await grade(a, {
      subjectCode: 'TIENG_ANH',
      assessedOn: TODAY,
      type: 'MIDTERM',
      score: 18,
      maxScore: 20,
      attachmentPath: target.path,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { assessment } = SchoolAssessmentResponseSchema.parse(res.body);
    expect(assessment.percent).toBe(90);
    expect(assessment.attachmentUrl).toMatch(/^https?:\/\//);
    const file = await fetch(assessment.attachmentUrl!);
    expect(file.status).toBe(200);
    expect((await file.arrayBuffer()).byteLength).toBe(png.byteLength);

    expect(
      (await api('DELETE', `/school-assessments/${assessment.id}`, { parent: a.parent })).status,
    ).toBe(204);
    const objects = await sql`
      select name from storage.objects where bucket_id = 'assessment-files' and name = ${target.path}`;
    expect(objects).toHaveLength(0);
  });
});

describe('dashboard after a day of work', () => {
  it('counts a completed task and a practice session, and keeps the streak', async () => {
    const task = await api(
      'POST',
      `/students/${a.studentId}/tasks`,
      { parent: a.parent },
      {
        type: 'HOMEWORK',
        title: 'Bài tập Toán',
        verificationMode: 'SELF_CHECK',
        rewardXp: 20,
        durationMinutes: 10,
      },
    );
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    await api(
      'POST',
      `/students/${a.studentId}/tasks`,
      { parent: a.parent },
      { type: 'READING', title: 'Đọc sách', verificationMode: 'SELF_CHECK', required: false },
    );
    const done = await api(
      'POST',
      `/tasks/${task.body.task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const session = SessionCreateResponseSchema.parse(
      (
        await api(
          'POST',
          '/learning/sessions',
          { child: a.child },
          { clientUuid: randomUUID(), skillIds: [skillId], mode: 'PRACTICE', targetItems: 2 },
        )
      ).body,
    ).session;
    for (let i = 0; i < 2; i++) {
      const next = NextItemResponseSchema.parse(
        (await api('GET', `/learning/sessions/${session.id}/next`, { child: a.child })).body,
      );
      if (next.done) break;
      const solved = await solve(sql, next.item!.id, next.item!.seed);
      const answered = await api(
        'POST',
        `/learning/sessions/${session.id}/answers`,
        { child: a.child },
        {
          clientUuid: randomUUID(),
          itemId: next.item!.id,
          response: solved.correct,
          responseMs: 4000,
        },
      );
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    }
    expect(
      (await api('POST', `/learning/sessions/${session.id}/finish`, { child: a.child })).status,
    ).toBe(200);

    // Before the worker ran: tasks and practice are already there (rebuilt on read).
    const early = await dashboard(a);
    expect(early.tasks).toMatchObject({ total: 2, done: 1, requiredTotal: 1, requiredDone: 1 });
    expect(early.tasks.completion).toBe(0.5);
    expect(early.learning).toMatchObject({ sessions: 1, accuracy: 1 });
    expect(early.learning.answers).toBeGreaterThan(0);
    expect(early.streak).toMatchObject({ days: 1, activeDays: 1, sufficiency: 'INSUFFICIENT' });
    expect(early.days.at(-1)).toMatchObject({
      day: TODAY,
      tasksTotal: 2,
      tasksDone: 1,
      sessions: 1,
    });
    expect(early.today.itemsDone).toBeGreaterThanOrEqual(1);
    expect(early.today.completion).toBeGreaterThan(0);

    // The worker grants the XP and rebuilds the day's summary itself.
    const events = await sql<{ id: string }[]>`
      select id from ops.domain_events
      where household_id = ${a.householdId}
        and type in ('task.completed', 'task.approved', 'learning.session_finished')`;
    await drain(events.map((e) => e.id));
    const [summary] = await sql<{ xp_earned: number; tasks_done: number; sessions: number }[]>`
      select xp_earned, tasks_done, sessions from app.student_day_summaries
      where student_id = ${a.studentId} and local_day = ${TODAY}::date`;
    expect(summary).toMatchObject({ tasks_done: 1, sessions: 1 });
    expect(summary!.xp_earned).toBeGreaterThanOrEqual(20);

    const d = await dashboard(a);
    expect(d.rewards.xpInRange).toBe(summary!.xp_earned);
    expect(d.rewards.lifetimeXp).toBe(summary!.xp_earned);
    expect(d.rewards.capCoinsToday).toBeGreaterThan(0);
    expect(d.rewards.coinsToday).toBe(0); // less than 100 XP: no Coin yet
    expect(d.days.at(-1)!.xpEarned).toBe(summary!.xp_earned);
  });

  it('a streak needs consecutive days; a gap ends it', async () => {
    // Earlier days of this throwaway child, written the way the worker writes them.
    await sql`
      insert into app.student_day_summaries (student_id, local_day, household_id, tasks_total, tasks_done)
      select ${a.studentId}, d::date, ${a.householdId}, 1, 1
      from unnest(${[dayBefore(1), dayBefore(2), dayBefore(4)]}::text[]) as d
      on conflict (student_id, local_day) do update set tasks_total = 1, tasks_done = 1`;
    const d = await dashboard(a);
    expect(d.streak).toMatchObject({ days: 3, activeDays: 4, sufficiency: 'LOW' });
    expect(d.tasks.sufficiency).toBe('LOW');
    expect(d.tasks.done).toBe(4);
  });

  it('shows school grades beside app mastery of the same subject, never merged', async () => {
    const d = await dashboard(a);
    const toan = d.school.subjects.find((s) => s.subjectCode === 'TOAN')!;
    // 80 (20 days ago), 80, 90: three grades.
    expect(toan).toMatchObject({
      count: 3,
      averagePercent: 83.3,
      direction: 'UP',
      deltaPercent: 10,
      sufficiency: 'LOW',
    });
    expect(toan.points.map((p) => p.percent)).toEqual([80, 80, 90]);
    expect(d.school.subjects.map((s) => s.subjectCode)).toEqual(['NGU_VAN', 'TOAN']);

    const side = d.sideBySide.find((s) => s.subjectCode === 'TOAN')!;
    expect(side.librarySubject).toBe('math');
    expect(side.school).toEqual({ averagePercent: 83.3, count: 3, sufficiency: 'LOW' });
    expect(side.mastery).toMatchObject({ practised: 1, sufficiency: 'INSUFFICIENT' });
    expect(side.mastery!.meanScore).toBeGreaterThan(0);
    // Two measures, two objects: no field holds a blend of both.
    expect(Object.keys(side).sort()).toEqual([
      'librarySubject',
      'mastery',
      'school',
      'subjectCode',
    ]);
    expect(side.mastery!.meanScore).not.toBe(side.school.averagePercent);
    const van = d.sideBySide.find((s) => s.subjectCode === 'NGU_VAN')!;
    expect(van.mastery).toBeNull(); // no Ngữ văn 6 library on this database

    // A grade does not touch mastery.
    const before = d.learning.subjects.find((s) => s.subject === 'math')!;
    await grade(a, { subjectCode: 'TOAN', assessedOn: TODAY, type: 'FINAL', score: 10 });
    const after = (await dashboard(a)).learning.subjects.find((s) => s.subject === 'math')!;
    expect(after).toEqual(before);
  });

  it('lists exams of the next 14 days', async () => {
    for (const [title, days] of [
      ['Kiểm tra Toán', 2],
      ['Thi cuối kì', 30],
    ] as const) {
      const at = new Date(Date.now() + days * 86_400_000);
      const res = await api(
        'POST',
        `/students/${a.studentId}/events`,
        { parent: a.parent },
        {
          type: 'EXAM',
          title,
          subjectCode: 'TOAN',
          startsAt: at.toISOString(),
          endsAt: new Date(at.getTime() + 3_600_000).toISOString(),
        },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const d = await dashboard(a);
    expect(d.upcomingExams).toHaveLength(1);
    expect(d.upcomingExams[0]).toMatchObject({
      title: 'Kiểm tra Toán',
      subjectCode: 'TOAN',
      daysUntil: 2,
    });
  });
});

describe('household overview', () => {
  it('gives one card per child of the parent, and only theirs', async () => {
    const res = await api('GET', '/household/overview', { parent: a.parent });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { children } = HouseholdOverviewResponseSchema.parse(res.body);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      studentId: a.studentId,
      displayName: 'Con',
      grade: 6,
      streak: { days: 3 },
      coinBalance: 0,
      skillsImproving: 0,
      skillsAtRisk: 0,
      skillsSufficiency: 'INSUFFICIENT',
    });
    expect(children[0]!.upcomingExams).toHaveLength(1);
    expect(children[0]!.today.itemsTotal).toBeGreaterThan(0);

    const other = HouseholdOverviewResponseSchema.parse(
      (await api('GET', '/household/overview', { parent: b.parent })).body,
    );
    expect(other.children.map((c) => c.studentId)).toEqual([b.studentId]);
    expect((await api('GET', '/household/overview', { child: a.child })).status).toBe(403);
    expect((await api('GET', '/household/overview')).status).toBe(401);
  });
});

describe('household isolation', () => {
  it('answers 404 for another household on every route', async () => {
    const [row] = await sql<{ id: string }[]>`
      select id from app.school_assessments where student_id = ${a.studentId} limit 1`;
    const base = `/students/${a.studentId}`;
    const denied = await Promise.all([
      api('GET', `${base}/dashboard`, { parent: b.parent }),
      api('GET', `${base}/school-assessments`, { parent: b.parent }),
      api(
        'POST',
        `${base}/school-assessments`,
        { parent: b.parent },
        { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 1 },
      ),
      api(
        'POST',
        `${base}/school-assessments/upload-sign`,
        { parent: b.parent },
        { contentType: 'image/png' },
      ),
      api('PATCH', `/school-assessments/${row!.id}`, { parent: b.parent }, { score: 0 }),
      api('DELETE', `/school-assessments/${row!.id}`, { parent: b.parent }),
    ]);
    expect(denied.map((r) => r.status)).toEqual(Array(6).fill(404));
    const [still] = await sql<{ score: string }[]>`
      select score from app.school_assessments where id = ${row!.id}`;
    expect(Number(still!.score)).toBeGreaterThan(0);
    // The child of household A cannot open the parent dashboard either.
    expect((await api('GET', `${base}/dashboard`, { child: a.child })).status).toBe(403);
  });
});
