// M07 Today planner (`pnpm cloud pnpm test:api`, or CI's local Supabase). Uses whatever approved
// Toán 6 items the library holds and never changes them; an empty library gets the M05 fixture.
// Plan lifecycle, exam ranking, a finished session completing its item without a recalculation,
// item actions, parent pins and removals, the day-start job, cross-household denial (404).
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NextItemResponseSchema,
  PoliciesResponseSchema,
  SessionCreateResponseSchema,
  StudentCreateResponseSchema,
  TodayItemResponseSchema,
  TodayResponseSchema,
  type TodayItem,
  type TodayResponse,
} from '@vionx/contracts';
import { DEFAULT_PLANNER_CONFIG } from '@vionx/domain';
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
  const household = await api('POST', '/household', { parent }, { name: 'Gia đình hôm nay' });
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
  const admin = await signUpWithEmail(`m07-lib-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
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

async function today(f: Family, as: 'child' | 'parent' = 'child'): Promise<TodayResponse> {
  const auth = as === 'child' ? { child: f.child } : { parent: f.parent };
  const res = await api('GET', `/students/${f.studentId}/today`, auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return TodayResponseSchema.parse(res.body);
}

async function act(f: Family, as: 'child' | 'parent', item: TodayItem, action: string, body = {}) {
  const auth = as === 'child' ? { child: f.child } : { parent: f.parent };
  const res = await api('POST', `/today-items/${item.id}/${action}`, auth, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return TodayItemResponseSchema.parse(res.body);
}

async function newTask(f: Family, body: Record<string, unknown>): Promise<string> {
  const res = await api(
    'POST',
    `/students/${f.studentId}/tasks`,
    { parent: f.parent },
    { type: 'CUSTOM', verificationMode: 'SELF_CHECK', durationMinutes: 10, ...body },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.task.id as string;
}

const taskItem = (t: TodayResponse, taskId: string) =>
  t.items.find((i) => i.link.type === 'TASK' && i.link.taskId === taskId);
const skillItem = (t: TodayResponse, skillId: string) =>
  t.items.find((i) => i.link.type === 'SESSION' && i.link.skillIds[0] === skillId);
const index = (t: TodayResponse, item: TodayItem | undefined) =>
  t.items.findIndex((i) => i.id === item?.id);

let a: Family;
let b: Family; // another household
let examSkills: string[];
let requiredTask: string;
let optionalTask: string;

beforeAll(async () => {
  const policies = PoliciesResponseSchema.parse((await api('GET', '/policies/current')).body);
  policyVersion = policies.policies.find((p) => p.type === 'PRIVACY_POLICY')!.version;
  let found = await findTopic(sql, 6, 'math', null, 2);
  if (!found) {
    await importMath6Fixture();
    found = await findTopic(sql, 6, 'math', null, 2);
  }
  if (!found) throw new Error('No Toán 6 topic with 2 practicable skills after the M05 fixture');
  examSkills = found.skillIds.slice(0, 2);
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

const TABLES = ['planner_config', 'planner_settings', 'today_plans', 'today_plan_items'];

describe('schema', () => {
  it('stores the planner config of @vionx/domain', async () => {
    const [row] = await sql<{ config: unknown }[]>`
      select config from app.planner_config order by version desc limit 1`;
    expect(row!.config).toEqual(DEFAULT_PLANNER_CONFIG);
  });

  it('has RLS on every planner table and no privilege for client roles', async () => {
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

  it('schedules the hourly day-start request', async () => {
    const jobs = await sql`select schedule from cron.job where jobname = 'vionx-today-plans'`;
    expect(jobs.map((j) => j.schedule)).toEqual(['10 * * * *']);
  });
});

describe('today plan', () => {
  it('is generated on first read and stays the same while nothing changes', async () => {
    const first = await today(a);
    expect(first).toMatchObject({
      studentId: a.studentId,
      version: 1,
      sessionMinutes: 25,
      budgetMinutes: 75,
      dailyMinutes: null,
      doneMinutes: 0,
    });
    expect(first.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A new child with nothing assigned still gets the next step of the curriculum.
    const next = first.items.find((i) => i.kind === 'NEXT_SKILL' && i.subject === 'math');
    expect(next).toMatchObject({ status: 'PLANNED', minutes: 25, required: false });
    expect(next!.reasons.map((r) => r.code)).toEqual(['NEXT_IN_CURRICULUM']);
    expect(first.items.every((i) => i.reasons.length > 0)).toBe(true);

    const again = await today(a, 'parent');
    expect(again.version).toBe(1);
    expect(again.generatedAt).toBe(first.generatedAt);
    expect(again.items).toEqual(first.items);
  });

  it('picks up new tasks without a recalculation, required above optional', async () => {
    requiredTask = await newTask(a, { title: 'Dọn bàn học', rewardXp: 10 });
    optionalTask = await newTask(a, {
      title: 'Tưới cây',
      required: false,
      priority: 'HIGH',
      type: 'HOUSEHOLD',
    });
    const homework = await newTask(a, { title: 'Bài tập Toán', type: 'HOMEWORK' });
    const plan = await today(a);
    expect(plan.version).toBe(2);
    expect(taskItem(plan, requiredTask)).toMatchObject({
      kind: 'PARENT_TASK',
      title: 'Dọn bàn học',
      minutes: 10,
      required: true,
      rewardXp: 10,
      status: 'PLANNED',
      inBudget: true,
    });
    expect(taskItem(plan, requiredTask)!.reasons.map((r) => r.code)).toEqual([
      'DUE_TODAY',
      'PARENT_PRIORITY',
    ]);
    expect(taskItem(plan, homework)!.kind).toBe('HOMEWORK');
    expect(index(plan, taskItem(plan, requiredTask))).toBeLessThan(
      index(plan, taskItem(plan, optionalTask)),
    );
    const priorities = plan.items.map((i) => i.priority);
    expect(priorities).toEqual([...priorities].sort((x, y) => y - x));
  });

  it('acceptance: an exam in 3 days on 2 skills ranks above optional tasks', async () => {
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    const created = await api(
      'POST',
      `/students/${a.studentId}/events`,
      { parent: a.parent },
      {
        type: 'EXAM',
        title: 'Kiểm tra giữa kì',
        subjectCode: 'TOAN',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
        skillIds: examSkills,
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.event.skillIds).toEqual(examSkills);

    const plan = await today(a);
    const prep = examSkills.map((id) => skillItem(plan, id)!);
    expect(prep.map((i) => i?.kind)).toEqual(['EXAM_PREP', 'EXAM_PREP']);
    const optional = index(plan, taskItem(plan, optionalTask));
    for (const item of prep) {
      expect(index(plan, item)).toBeLessThan(optional);
      expect(item.reasons.map((r) => r.code)).toEqual([
        'EXAM_SOON',
        'NEXT_IN_CURRICULUM',
        'EXAM_RELEVANT',
      ]);
      expect(item.reasons[0]!.params).toEqual({ examTitle: 'Kiểm tra giữa kì', days: 3 });
      expect(item.detail).toMatchObject({ examTitle: 'Kiểm tra giữa kì', daysUntil: 3 });
      expect(item.link).toEqual({
        type: 'SESSION',
        mode: 'PRACTICE',
        skillIds: [item.link.type === 'SESSION' ? item.link.skillIds[0] : ''],
        subject: 'math',
      });
    }
  });

  it('recalculate keeps the version when nothing changed', async () => {
    const before = await today(a);
    const res = await api('POST', `/students/${a.studentId}/today/recalculate`, { child: a.child });
    expect(res.status).toBe(200);
    const after = TodayResponseSchema.parse(res.body);
    expect(after.version).toBe(before.version);
    expect(after.items).toEqual(before.items);
    expect(Date.parse(after.generatedAt)).toBeGreaterThan(Date.parse(before.generatedAt));
  });
});

describe('learning items', () => {
  it('a finished session completes its item on the next read (SYSTEM_VERIFIED)', async () => {
    const before = await today(a);
    const item = skillItem(before, examSkills[0]!)!;

    const refused = await api(
      'POST',
      `/today-items/${item.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.details).toEqual({ reason: 'SYSTEM_VERIFIED_ONLY' });

    const started = await act(a, 'child', item, 'start');
    expect(started.item.status).toBe('STARTED');
    expect(item.link.type).toBe('SESSION');
    if (item.link.type !== 'SESSION') return;

    const session = SessionCreateResponseSchema.parse(
      (
        await api(
          'POST',
          '/learning/sessions',
          { child: a.child },
          {
            clientUuid: randomUUID(),
            mode: item.link.mode,
            skillIds: item.link.skillIds,
            targetItems: 1,
          },
        )
      ).body,
    ).session;
    const next = NextItemResponseSchema.parse(
      (await api('GET', `/learning/sessions/${session.id}/next`, { child: a.child })).body,
    );
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
    const finished = await api('POST', `/learning/sessions/${session.id}/finish`, {
      child: a.child,
    });
    expect(finished.status).toBe(200);

    // No recalculation and no worker run in between: the read itself sees the finished session.
    const after = await today(a);
    expect(after.version).toBeGreaterThan(started.today.version);
    expect(after.items.find((i) => i.id === item.id)).toMatchObject({ status: 'DONE' });
    expect(after.doneMinutes).toBe(25);
    // Workload: the other learning items lose points.
    const other = skillItem(after, examSkills[1]!)!;
    expect(other.reasons.at(-1)!.code).toBe('WORKLOAD_TODAY');
    expect(other.priority).toBeLessThan(skillItem(before, examSkills[1]!)!.priority);

    // The worker handles the same event without changing the plan again.
    const events = await sql<{ id: string }[]>`
      select id from ops.domain_events
      where type = 'learning.session_finished' and aggregate_id = ${session.id}`;
    await drain(events.map((e) => e.id));
    const settled = await today(a);
    expect(settled.version).toBe(after.version);
    expect(settled.items.find((i) => i.id === item.id)!.status).toBe('DONE');
  });
});

describe('task items', () => {
  it('skip: optional items only', async () => {
    const plan = await today(a);
    const refused = await api('POST', `/today-items/${taskItem(plan, requiredTask)!.id}/skip`, {
      child: a.child,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.details).toEqual({ reason: 'REQUIRED_ITEM' });

    const skipped = await act(a, 'child', taskItem(plan, optionalTask)!, 'skip');
    expect(skipped.item.status).toBe('SKIPPED');
    // Kept across a regeneration; can still be started.
    await api('POST', `/students/${a.studentId}/today/recalculate`, { child: a.child });
    expect(taskItem(await today(a), optionalTask)!.status).toBe('SKIPPED');
    expect((await act(a, 'child', skipped.item, 'start')).item.status).toBe('STARTED');
  });

  it('complete goes through the task rules and is idempotent by clientUuid', async () => {
    const item = taskItem(await today(a), requiredTask)!;
    const clientUuid = randomUUID();
    const done = await act(a, 'child', item, 'complete', { clientUuid });
    expect(done.item.status).toBe('DONE');
    expect(done.today.doneMinutes).toBeGreaterThanOrEqual(35);
    const [occurrence] = await sql<{ status: string }[]>`
      select status from app.task_occurrences where assignment_id = ${requiredTask}`;
    expect(occurrence!.status).toBe('COMPLETED');

    const replay = await act(a, 'child', item, 'complete', { clientUuid });
    expect(replay.item.status).toBe('DONE');
    const completions = await sql`
      select id from app.task_completions where assignment_id = ${requiredTask}`;
    expect(completions).toHaveLength(1);

    const second = await api(
      'POST',
      `/today-items/${item.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    expect(second.status).toBe(409);
  });

  it('a task waiting for the parent shows as PENDING_APPROVAL, then DONE once approved', async () => {
    const taskId = await newTask(a, { title: 'Đọc sách', verificationMode: 'PARENT_APPROVAL' });
    const item = taskItem(await today(a), taskId)!;
    const waiting = await act(a, 'child', item, 'complete', { clientUuid: randomUUID() });
    expect(waiting.item.status).toBe('PENDING_APPROVAL');
    const approved = await api(
      'POST',
      `/tasks/${taskId}/approve`,
      { parent: a.parent },
      { date: waiting.today.localDate },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(taskItem(await today(a), taskId)!.status).toBe('DONE');
  });
});

describe('parent', () => {
  it('pins an item to the top and unpins it', async () => {
    const plan = await today(a, 'parent');
    const target = plan.items.findLast((i) => i.status === 'PLANNED')!;
    const pinned = await act(a, 'parent', target, 'pin');
    expect(pinned.item).toMatchObject({ pinned: true, inBudget: true });
    expect(pinned.today.items[0]!.id).toBe(target.id);
    expect((await today(a)).items[0]!.id).toBe(target.id);
    const unpinned = await act(a, 'parent', target, 'pin', { pinned: false });
    expect(unpinned.item.pinned).toBe(false);
    expect(unpinned.today.items[0]!.id).not.toBe(target.id);
  });

  it('removes an item for the day: hidden from the child, visible to the parent, restorable', async () => {
    const plan = await today(a, 'parent');
    const target = plan.items.find((i) => i.status === 'PLANNED' && i.link.type === 'SESSION')!;
    const removed = await act(a, 'parent', target, 'remove');
    expect(removed.item.status).toBe('REMOVED');
    expect((await today(a)).items.some((i) => i.id === target.id)).toBe(false);
    expect((await today(a, 'parent')).items.find((i) => i.id === target.id)!.status).toBe(
      'REMOVED',
    );
    const start = await api('POST', `/today-items/${target.id}/start`, { child: a.child });
    expect(start.status).toBe(409);
    expect(start.body.details).toEqual({ reason: 'REMOVED_ITEM' });

    const back = await act(a, 'parent', target, 'remove', { removed: false });
    expect(back.item.status).toBe('PLANNED');
    expect((await today(a)).items.some((i) => i.id === target.id)).toBe(true);

    const audit = await sql<{ action: string }[]>`
      select action from ops.audit_logs
      where household_id = ${a.householdId} and action like 'planner.%' order by created_at`;
    expect(audit.map((r) => r.action)).toEqual([
      'planner.item_pinned',
      'planner.item_pinned',
      'planner.item_removed',
      'planner.item_removed',
    ]);
  });

  it('sets the minutes a day; the child cannot', async () => {
    const path = `/students/${a.studentId}/today/settings`;
    expect((await api('PUT', path, { child: a.child }, { dailyMinutes: 30 })).status).toBe(403);
    expect((await api('PUT', path, { parent: a.parent }, { dailyMinutes: 5 })).status).toBe(400);
    const set = await api('PUT', path, { parent: a.parent }, { dailyMinutes: 30 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const small = TodayResponseSchema.parse(set.body);
    expect(small).toMatchObject({ budgetMinutes: 30, dailyMinutes: 30 });
    // More than 30 minutes are done already: optional open items no longer fit.
    expect(
      small.items.filter((i) => i.status === 'PLANNED' && !i.required).every((i) => !i.inBudget),
    ).toBe(true);
    const reset = await api('PUT', path, { parent: a.parent }, { dailyMinutes: null });
    expect(TodayResponseSchema.parse(reset.body)).toMatchObject({
      budgetMinutes: 75,
      dailyMinutes: null,
    });
  });

  it('only acts through parent routes; the child only through child routes', async () => {
    const item = (await today(a)).items[0]!;
    expect((await api('POST', `/today-items/${item.id}/pin`, { child: a.child }, {})).status).toBe(
      403,
    );
    expect((await api('POST', `/today-items/${item.id}/skip`, { parent: a.parent })).status).toBe(
      403,
    );
    expect((await api('GET', `/students/${a.studentId}/today`)).status).toBe(401);
  });
});

describe('deleted sources', () => {
  it('a deleted exam or timetable entry changes Today on the next read', async () => {
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    const exam = await api(
      'POST',
      `/students/${b.studentId}/events`,
      { parent: b.parent },
      {
        type: 'EXAM',
        title: 'Kiểm tra 15 phút',
        subjectCode: 'TOAN',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 900_000).toISOString(),
      },
    );
    expect(exam.status, JSON.stringify(exam.body)).toBe(201);
    // ISO weekday of today in Asia/Ho_Chi_Minh (UTC+7, no daylight saving).
    const weekday = new Date(Date.now() + 7 * 3_600_000).getUTCDay() || 7;
    const entry = await api(
      'POST',
      `/students/${b.studentId}/timetable`,
      { parent: b.parent },
      { weekday, startTime: '07:00', endTime: '11:30', subjectCode: 'TOAN' },
    );
    expect(entry.status, JSON.stringify(entry.body)).toBe(201);

    const withBoth = await today(b);
    // Without a skill list the exam prepares the 2 weakest skills of the subject.
    expect(withBoth.items.filter((i) => i.kind === 'EXAM_PREP')).toHaveLength(2);
    expect(withBoth.freeMinutes).toBe(930 - 270);

    expect(
      (await api('DELETE', `/events/${exam.body.event.id}`, { parent: b.parent })).status,
    ).toBe(204);
    const withoutExam = await today(b);
    expect(withoutExam.items.filter((i) => i.kind === 'EXAM_PREP')).toHaveLength(0);
    expect(withoutExam.version).toBeGreaterThan(withBoth.version);

    expect(
      (await api('DELETE', `/timetable/${entry.body.entry.id}`, { parent: b.parent })).status,
    ).toBe(204);
    expect((await today(b)).freeMinutes).toBe(930);
  });
});

describe('day start', () => {
  it('writes the plan of a child that has none today', async () => {
    await today(b);
    await sql`delete from app.today_plans where student_id = ${b.studentId}`;
    const [event] = await sql<{ id: string }[]>`
      insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
      values ('planner.day_start_requested', 'system',
              ${sql.json({ requestedAt: new Date().toISOString() })}, ${`it:${randomUUID()}`})
      returning id`;
    await drain([event!.id]);
    const plans = await sql<{ version: number }[]>`
      select version from app.today_plans where student_id = ${b.studentId}`;
    expect(plans).toEqual([{ version: 1 }]);
  });
});

describe('household isolation', () => {
  it('answers 404 for another household on every route', async () => {
    const item = (await today(a)).items[0]!;
    const student = `/students/${a.studentId}/today`;
    const denied = await Promise.all([
      api('GET', student, { parent: b.parent }),
      api('GET', student, { child: b.child }),
      api('POST', `${student}/recalculate`, { parent: b.parent }),
      api('POST', `${student}/recalculate`, { child: b.child }),
      api('PUT', `${student}/settings`, { parent: b.parent }, { dailyMinutes: 60 }),
      api('POST', `/today-items/${item.id}/start`, { child: b.child }),
      api('POST', `/today-items/${item.id}/skip`, { child: b.child }),
      api(
        'POST',
        `/today-items/${item.id}/complete`,
        { child: b.child },
        { clientUuid: randomUUID() },
      ),
      api('POST', `/today-items/${item.id}/pin`, { parent: b.parent }, {}),
      api('POST', `/today-items/${item.id}/remove`, { parent: b.parent }, {}),
    ]);
    expect(denied.map((r) => r.status)).toEqual(Array(10).fill(404));
    const [settings] = await sql`
      select daily_minutes from app.planner_settings where student_id = ${a.studentId}`;
    expect(settings?.daily_minutes ?? null).toBeNull();
    expect((await today(a, 'parent')).items.find((i) => i.id === item.id)).toMatchObject({
      status: item.status,
      pinned: item.pinned,
    });
  });
});
