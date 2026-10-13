// M03 calendar, timetable & tasks against local Supabase (`pnpm db:start && pnpm fn:serve`).
// Every child-data route is checked for cross-household denial (404) and children never edit.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApprovalsResponseSchema,
  CalendarResponseSchema,
  ErrorBodySchema,
  PoliciesResponseSchema,
  StudentCreateResponseSchema,
  TaskCompleteResponseSchema,
  TaskDecisionResponseSchema,
  TaskResponseSchema,
  TaskTemplatesResponseSchema,
  TimetableEntryResponseSchema,
  TimetableResponseSchema,
  UploadSignResponseSchema,
} from '@vionx/contracts';
import { addDays, householdToday, MATERIALISE_DAYS } from '@vionx/domain';
import { signUpWithEmail, type AuthSession } from '../../../../scripts/lib/local-supabase.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SERVICE_SECRET = process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const TZ = 'Asia/Ho_Chi_Minh';
const today = () => householdToday(new Date(), TZ);

type Auth = { parent?: AuthSession; child?: string };

async function api(method: string, path: string, auth: Auth = {}, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.parent) headers.authorization = `Bearer ${auth.parent.accessToken}`;
  if (auth.child) headers['x-vionx-child-session'] = auth.child;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function tickWorker() {
  const res = await fetch(`${FUNCTIONS_URL}/worker`, {
    method: 'POST',
    headers: { 'x-vionx-service-secret': SERVICE_SECRET, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { maintenance: Record<string, number> };
}

let policyVersion = 1;
const createdUsers: string[] = [];

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

async function newFamily(name: string): Promise<Family> {
  const parent = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  createdUsers.push(parent.userId);
  const household = await api('POST', '/household', { parent }, { name });
  expect(household.status).toBe(201);
  const created = await api(
    'POST',
    '/students',
    { parent },
    { displayName: `${name} con`, birthYear: 2014, grade: 6, pin: '4826' },
  );
  expect(created.status).toBe(201);
  const body = StudentCreateResponseSchema.parse(created.body);
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER']) {
    const g = await api(
      'POST',
      `/students/${body.student.id}/consents/${type}/grant`,
      { parent },
      { policyVersion },
    );
    expect(g.status).toBe(200);
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

const createTask = (f: Family, task: Record<string, unknown>) =>
  api('POST', `/students/${f.studentId}/tasks`, { parent: f.parent }, task);

async function newTask(f: Family, task: Record<string, unknown>) {
  const res = await createTask(f, { type: 'HOMEWORK', title: 'Bài tập', ...task });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return TaskResponseSchema.parse(res.body);
}

const complete = (f: Family, taskId: string, body: Record<string, unknown>) =>
  api('POST', `/tasks/${taskId}/complete`, { child: f.child }, body);

async function eventsOf(type: string, aggregateId: string) {
  return sql<{ payload: Record<string, unknown>; idempotency_key: string }[]>`
    select payload, idempotency_key from ops.domain_events
    where type = ${type} and aggregate_id = ${aggregateId}`;
}

async function uploadProof(f: Family, taskId: string) {
  const signed = await api(
    'POST',
    '/uploads/sign',
    { child: f.child },
    { purpose: 'TASK_PROOF', taskId, contentType: 'image/jpeg' },
  );
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  const body = UploadSignResponseSchema.parse(signed.body);
  const put = await fetch(body.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]),
  });
  expect(put.status, await put.clone().text()).toBe(200);
  return body.path;
}

let a: Family;
let b: Family;

beforeAll(async () => {
  const res = await api('GET', '/policies/current');
  policyVersion = PoliciesResponseSchema.parse(res.body).policies.find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  [a, b] = await Promise.all([newFamily('Lịch A'), newFamily('Lịch B')]);
});

afterAll(async () => {
  if (createdUsers.length > 0) {
    await sql`
      delete from app.households where id in (
        select household_id from app.household_memberships where user_id = any(${createdUsers}::uuid[]))`;
    await sql`delete from auth.users where id = any(${createdUsers}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

describe('reference data', () => {
  it('lists GDPT 2018 subjects publicly and task templates for parents', async () => {
    const subjects = await api('GET', '/subjects');
    expect(subjects.status).toBe(200);
    expect(subjects.body.subjects.map((s: { code: string }) => s.code)).toContain('KHTN');
    const templates = await api('GET', '/task-templates', { parent: a.parent });
    expect(templates.status).toBe(200);
    const body = TaskTemplatesResponseSchema.parse(templates.body);
    expect(body.templates.filter((t) => t.builtIn).length).toBeGreaterThanOrEqual(6);
    expect((await api('GET', '/task-templates', { child: a.child })).status).toBe(403);
    expect((await api('GET', '/task-templates')).status).toBe(401);
  });
});

describe('timetable and events', () => {
  it('parent manages the weekly timetable; the calendar expands it per day', async () => {
    const bad = await api(
      'POST',
      `/students/${a.studentId}/timetable`,
      { parent: a.parent },
      { weekday: 1, startTime: '08:00', endTime: '07:15', subjectCode: 'TOAN' },
    );
    expect(bad.status).toBe(400);
    const unknown = await api(
      'POST',
      `/students/${a.studentId}/timetable`,
      { parent: a.parent },
      { weekday: 1, startTime: '07:00', endTime: '07:45', subjectCode: 'NOPE' },
    );
    expect(unknown.status).toBe(400);
    const ids: string[] = [];
    for (let weekday = 1; weekday <= 5; weekday++) {
      const res = await api(
        'POST',
        `/students/${a.studentId}/timetable`,
        { parent: a.parent },
        { weekday, startTime: '07:00', endTime: '07:45', subjectCode: 'TOAN', room: '6A1' },
      );
      expect(res.status).toBe(201);
      ids.push(TimetableEntryResponseSchema.parse(res.body).entry.id);
    }
    const patched = await api(
      'PATCH',
      `/timetable/${ids[0]}`,
      { parent: a.parent },
      { subjectCode: 'NGU_VAN', note: 'Mang sách' },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.entry).toMatchObject({ subjectCode: 'NGU_VAN', startTime: '07:00' });
    expect((await api('DELETE', `/timetable/${ids[4]}`, { parent: a.parent })).status).toBe(204);
    expect((await api('DELETE', `/timetable/${ids[4]}`, { parent: a.parent })).status).toBe(404);

    const list = TimetableResponseSchema.parse(
      (await api('GET', `/students/${a.studentId}/timetable`, { child: a.child })).body,
    );
    expect(list.entries).toHaveLength(4);

    // 2026-10-12 is a Monday: Mon-Thu periods, none on Fri (deleted) or the weekend.
    const cal = CalendarResponseSchema.parse(
      (
        await api('GET', `/students/${a.studentId}/calendar?from=2026-10-12&to=2026-10-18`, {
          parent: a.parent,
        })
      ).body,
    );
    expect(cal.timetable.map((s) => [s.date, s.subjectCode])).toEqual([
      ['2026-10-12', 'NGU_VAN'],
      ['2026-10-13', 'TOAN'],
      ['2026-10-14', 'TOAN'],
      ['2026-10-15', 'TOAN'],
    ]);
    expect(cal.timezone).toBe(TZ);
  });

  it('events are returned by household-local day', async () => {
    // 2026-10-20 23:30 Vietnam time is 16:30 UTC on the 20th.
    const created = await api(
      'POST',
      `/students/${a.studentId}/events`,
      { parent: a.parent },
      {
        type: 'EXAM',
        title: 'Kiểm tra giữa kỳ Toán',
        subjectCode: 'TOAN',
        startsAt: '2026-10-20T16:30:00Z',
        endsAt: '2026-10-20T16:45:00Z',
      },
    );
    expect(created.status).toBe(201);
    const eventId = created.body.event.id as string;
    const bad = await api(
      'PATCH',
      `/events/${eventId}`,
      { parent: a.parent },
      { endsAt: '2026-10-20T16:00:00Z' },
    );
    expect(bad.status).toBe(400);
    const day = async (d: string) =>
      CalendarResponseSchema.parse(
        (
          await api('GET', `/students/${a.studentId}/calendar?from=${d}&to=${d}`, {
            child: a.child,
          })
        ).body,
      ).events.map((e) => e.id);
    expect(await day('2026-10-20')).toEqual([eventId]);
    expect(await day('2026-10-21')).toEqual([]);
    const moved = await api(
      'PATCH',
      `/events/${eventId}`,
      { parent: a.parent },
      { startsAt: '2026-10-20T17:30:00Z', endsAt: '2026-10-20T18:00:00Z', type: 'TUTORING' },
    );
    expect(moved.status).toBe(200);
    expect(await day('2026-10-21')).toEqual([eventId]);
    expect((await api('DELETE', `/events/${eventId}`, { parent: a.parent })).status).toBe(204);
    expect(await day('2026-10-21')).toEqual([]);
  });

  it('rejects invalid and too long calendar ranges', async () => {
    const path = `/students/${a.studentId}/calendar`;
    expect(
      (await api('GET', `${path}?from=2026-10-12&to=2026-10-11`, { parent: a.parent })).status,
    ).toBe(400);
    expect(
      (await api('GET', `${path}?from=2026-10-01&to=2026-12-31`, { parent: a.parent })).status,
    ).toBe(400);
    expect(
      (await api('GET', `${path}?from=2026-02-30&to=2026-03-01`, { parent: a.parent })).status,
    ).toBe(400);
  });
});

describe('tasks', () => {
  it('a recurring task is materialised for the next 14 days; one-off tasks on their day', async () => {
    const t = today();
    const daily = await newTask(a, { rrule: 'freq=daily', verificationMode: 'SELF_CHECK' });
    expect(daily.task.rrule).toBe('FREQ=DAILY');
    expect(daily.upcoming).toHaveLength(MATERIALISE_DAYS);
    expect(daily.upcoming[0]).toBe(t);
    const later = await newTask(a, {
      startsOn: addDays(t, 40),
      verificationMode: 'PARENT_APPROVAL',
    });
    expect(later.upcoming).toEqual([addDays(t, 40)]);
    const [assigned] = await eventsOf('task.assigned', daily.task.id);
    expect(assigned!.payload).toMatchObject({
      eventName: 'TaskAssigned',
      studentId: a.studentId,
      taskId: daily.task.id,
    });
    const invalid = await createTask(a, {
      type: 'READING',
      title: 'x',
      verificationMode: 'SELF_CHECK',
      rrule: 'FREQ=MONTHLY',
    });
    expect(invalid.status).toBe(400);
    const window = await createTask(a, {
      type: 'READING',
      title: 'x',
      verificationMode: 'SELF_CHECK',
      windowStart: '20:00',
    });
    expect(window.status).toBe(400);
  });

  it('save as template; the template shows up for this household only', async () => {
    await newTask(a, {
      title: 'Ôn từ vựng Unit 3',
      type: 'ENGLISH',
      verificationMode: 'SELF_CHECK',
      saveAsTemplate: true,
    });
    const mine = TaskTemplatesResponseSchema.parse(
      (await api('GET', '/task-templates', { parent: a.parent })).body,
    );
    expect(mine.templates.some((t) => !t.builtIn && t.title === 'Ôn từ vựng Unit 3')).toBe(true);
    const theirs = TaskTemplatesResponseSchema.parse(
      (await api('GET', '/task-templates', { parent: b.parent })).body,
    );
    expect(theirs.templates.some((t) => t.title === 'Ôn từ vựng Unit 3')).toBe(false);
  });

  it('PARENT_APPROVAL: completing twice with one clientUuid stores one completion; approve emits one TaskApproved', async () => {
    const { task } = await newTask(a, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      verificationMode: 'PARENT_APPROVAL',
      rewardXp: 20,
    });
    const clientUuid = randomUUID();
    const first = await complete(a, task.id, { clientUuid });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const one = TaskCompleteResponseSchema.parse(first.body);
    expect(one).toMatchObject({ replayed: false, occurrence: { status: 'PENDING_APPROVAL' } });
    const second = TaskCompleteResponseSchema.parse(
      (await complete(a, task.id, { clientUuid })).body,
    );
    expect(second.replayed).toBe(true);
    expect(second.occurrence.completion!.id).toBe(one.occurrence.completion!.id);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.task_completions where client_uuid = ${clientUuid}`;
    expect(n).toBe(1);
    expect(await eventsOf('task.completed', one.occurrence.completion!.id)).toHaveLength(1);
    // A new clientUuid on the same day is refused while it waits for the parent.
    const again = await complete(a, task.id, { clientUuid: randomUUID() });
    expect(again.status).toBe(409);
    expect(again.body.details.reason).toBe('PENDING_APPROVAL');

    // Push request to the parent and the inbox badge.
    const pushes = await sql`
      select 1 from ops.domain_events where type = 'notification.push_requested'
        and idempotency_key = ${`task-approval:${one.occurrence.completion!.id}:${a.parent.userId}`}`;
    expect(pushes).toHaveLength(1);
    const inbox = ApprovalsResponseSchema.parse(
      (await api('GET', '/approvals', { parent: a.parent })).body,
    );
    expect(inbox.count).toBeGreaterThanOrEqual(1);
    expect(inbox.items.some((i) => i.occurrence.id === one.occurrence.id)).toBe(true);

    const approve = await api(
      'POST',
      `/tasks/${task.id}/approve`,
      { parent: a.parent },
      { date: today() },
    );
    expect(approve.status).toBe(200);
    expect(TaskDecisionResponseSchema.parse(approve.body).occurrence).toMatchObject({
      status: 'COMPLETED',
      completion: { status: 'APPROVED', decidedByType: 'parent' },
    });
    const twice = await api(
      'POST',
      `/tasks/${task.id}/approve`,
      { parent: a.parent },
      { date: today() },
    );
    expect(twice.status).toBe(409);
    const approved = await eventsOf('task.approved', one.occurrence.completion!.id);
    expect(approved).toHaveLength(1);
    expect(approved[0]!.payload).toMatchObject({
      eventName: 'TaskApproved',
      rewardXp: 20,
      auto: false,
    });
    const done = await complete(a, task.id, { clientUuid: randomUUID() });
    expect(done.body.details.reason).toBe('ALREADY_COMPLETED');
    // Replaying the original clientUuid after approval still answers the stored result.
    const replay = TaskCompleteResponseSchema.parse(
      (await complete(a, task.id, { clientUuid })).body,
    );
    expect(replay).toMatchObject({ replayed: true, occurrence: { status: 'COMPLETED' } });
    const audit = await sql`
      select 1 from ops.audit_logs where action = 'task.approved' and target_id = ${one.occurrence.completion!.id}`;
    expect(audit).toHaveLength(1);
  });

  it('concurrent completions with one clientUuid store one completion', async () => {
    const { task } = await newTask(a, { verificationMode: 'PARENT_APPROVAL' });
    const clientUuid = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => complete(a, task.id, { clientUuid })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
    const rows = await sql`select id from app.task_completions where client_uuid = ${clientUuid}`;
    expect(rows).toHaveLength(1);
    expect(await eventsOf('task.completed', rows[0]!.id as string)).toHaveLength(1);
  });

  it('SELF_CHECK is done at once with an automatic TaskApproved', async () => {
    const { task } = await newTask(a, { verificationMode: 'SELF_CHECK', type: 'READING' });
    const res = TaskCompleteResponseSchema.parse(
      (await complete(a, task.id, { clientUuid: randomUUID() })).body,
    );
    expect(res.occurrence).toMatchObject({
      status: 'COMPLETED',
      completion: { status: 'APPROVED', decidedByType: 'system' },
    });
    const approved = await eventsOf('task.approved', res.occurrence.completion!.id);
    expect(approved).toHaveLength(1);
    expect(approved[0]!.payload).toMatchObject({ auto: true });
  });

  it('PHOTO_PROOF needs an uploaded photo; reject lets the child try again', async () => {
    const { task } = await newTask(a, { verificationMode: 'PHOTO_PROOF', type: 'HOUSEHOLD' });
    const without = await complete(a, task.id, { clientUuid: randomUUID() });
    expect(without.status).toBe(400);
    expect(without.body.details.reason).toBe('PROOF_REQUIRED');
    const forged = await complete(a, task.id, {
      clientUuid: randomUUID(),
      proofPath: `${b.householdId}/${b.studentId}/${task.id}/${randomUUID()}.jpg`,
    });
    expect(forged.status).toBe(400);
    const notUploaded = await complete(a, task.id, {
      clientUuid: randomUUID(),
      proofPath: `${a.householdId}/${a.studentId}/${task.id}/${randomUUID()}.jpg`,
    });
    expect(notUploaded.body.details.reason).toBe('PROOF_NOT_UPLOADED');

    const proofPath = await uploadProof(a, task.id);
    const res = TaskCompleteResponseSchema.parse(
      (await complete(a, task.id, { clientUuid: randomUUID(), proofPath })).body,
    );
    expect(res.occurrence).toMatchObject({
      status: 'PENDING_APPROVAL',
      completion: { hasProof: true },
    });
    const inbox = ApprovalsResponseSchema.parse(
      (await api('GET', '/approvals', { parent: a.parent })).body,
    );
    const item = inbox.items.find((i) => i.occurrence.id === res.occurrence.id)!;
    expect(item.studentName).toBe('Lịch A con');
    const photo = await fetch(item.proofUrl!);
    expect(photo.status).toBe(200);
    await photo.arrayBuffer();

    const reject = await api(
      'POST',
      `/tasks/${task.id}/reject`,
      { parent: a.parent },
      { date: today(), note: 'Chưa gọn, con dọn lại nhé' },
    );
    expect(reject.status).toBe(200);
    expect(reject.body.occurrence).toMatchObject({
      status: 'REJECTED',
      completion: { status: 'REJECTED', decisionNote: 'Chưa gọn, con dọn lại nhé' },
    });
    expect(await eventsOf('task.rejected', res.occurrence.completion!.id)).toHaveLength(1);
    const retry = await complete(a, task.id, {
      clientUuid: randomUUID(),
      proofPath: await uploadProof(a, task.id),
    });
    expect(retry.status).toBe(200);
    expect(retry.body.occurrence.status).toBe('PENDING_APPROVAL');
  });

  it('refuses future days, system-verified tasks, unscheduled days and a reused clientUuid', async () => {
    const t = today();
    const { task } = await newTask(a, { rrule: 'FREQ=DAILY', verificationMode: 'SELF_CHECK' });
    const future = await complete(a, task.id, { clientUuid: randomUUID(), date: addDays(t, 1) });
    expect(future.status).toBe(409);
    expect(future.body.details.reason).toBe('FUTURE_OCCURRENCE');
    const unscheduled = await complete(a, task.id, {
      clientUuid: randomUUID(),
      date: addDays(t, -3),
    });
    expect(unscheduled.status).toBe(404);
    const system = await newTask(a, { verificationMode: 'SYSTEM_VERIFIED', type: 'LEARNING' });
    const sys = await complete(a, system.task.id, { clientUuid: randomUUID() });
    expect(sys.status).toBe(409);
    expect(sys.body.details.reason).toBe('SYSTEM_VERIFIED_ONLY');
    const clientUuid = randomUUID();
    expect((await complete(a, task.id, { clientUuid })).status).toBe(200);
    const other = await newTask(a, { verificationMode: 'SELF_CHECK' });
    const reused = await complete(a, other.task.id, { clientUuid });
    expect(reused.status).toBe(409);
    expect(reused.body.details.reason).toBe('CLIENT_UUID_REUSED');
  });

  it('editing the schedule or archiving removes open future days, keeps completed ones', async () => {
    const t = today();
    const { task } = await newTask(a, { rrule: 'FREQ=DAILY', verificationMode: 'SELF_CHECK' });
    expect((await complete(a, task.id, { clientUuid: randomUUID() })).status).toBe(200);
    const weekly = await api(
      'PATCH',
      `/tasks/${task.id}`,
      { parent: a.parent },
      { rrule: 'FREQ=WEEKLY', title: 'Đọc sách' },
    );
    expect(weekly.status).toBe(200);
    const body = TaskResponseSchema.parse(weekly.body);
    expect(body.task).toMatchObject({ rrule: 'FREQ=WEEKLY', title: 'Đọc sách' });
    // Today (completed) stays; the next weekly day is materialised.
    expect(body.upcoming[0]).toBe(t);
    expect(body.upcoming.length).toBeLessThanOrEqual(3);
    const archived = TaskResponseSchema.parse(
      (await api('PATCH', `/tasks/${task.id}`, { parent: a.parent }, { archived: true })).body,
    );
    expect(archived.task.status).toBe('ARCHIVED');
    expect(archived.upcoming).toEqual([t]);
    const late = await complete(a, task.id, { clientUuid: randomUUID(), date: t });
    expect(late.status).toBe(409);
    const restored = TaskResponseSchema.parse(
      (await api('PATCH', `/tasks/${task.id}`, { parent: a.parent }, { archived: false })).body,
    );
    expect(restored.upcoming.length).toBeGreaterThan(1);
  });

  it('children only complete: every edit route answers 403 for a child', async () => {
    const { task } = await newTask(a, { verificationMode: 'PARENT_APPROVAL' });
    const child = { child: a.child };
    const attempts = [
      await api('PATCH', `/tasks/${task.id}`, child, { title: 'Không làm' }),
      await api('PATCH', `/tasks/${task.id}`, child, { archived: true }),
      await api('POST', `/students/${a.studentId}/tasks`, child, {
        type: 'CUSTOM',
        title: 'x',
        verificationMode: 'SELF_CHECK',
      }),
      await api('POST', `/tasks/${task.id}/approve`, child, { date: today() }),
      await api('POST', `/tasks/${task.id}/reject`, child, { date: today() }),
      await api('POST', `/students/${a.studentId}/timetable`, child, {
        weekday: 6,
        startTime: '08:00',
        endTime: '09:00',
        subjectCode: 'TOAN',
      }),
      await api('POST', `/students/${a.studentId}/events`, child, {
        type: 'SPORT',
        title: 'x',
        startsAt: '2026-10-20T01:00:00Z',
        endsAt: '2026-10-20T02:00:00Z',
      }),
      await api('GET', '/approvals', child),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(ErrorBodySchema.parse(res.body).code).toBe('FORBIDDEN');
    }
    // …and the parent cannot complete on the child's behalf.
    expect(
      (
        await api(
          'POST',
          `/tasks/${task.id}/complete`,
          { parent: a.parent },
          { clientUuid: randomUUID() },
        )
      ).status,
    ).toBe(403);
    const unchanged = TaskResponseSchema.parse((await api('GET', `/tasks/${task.id}`, child)).body);
    expect(unchanged.task.status).toBe('ACTIVE');
  });

  it('the child sees today’s tasks in their own calendar', async () => {
    const t = today();
    const cal = CalendarResponseSchema.parse(
      (await api('GET', `/students/${a.studentId}/calendar?from=${t}&to=${t}`, { child: a.child }))
        .body,
    );
    expect(cal.today).toBe(t);
    expect(cal.tasks.length).toBeGreaterThan(0);
    expect(cal.tasks.every((o) => o.date === t && o.studentId === a.studentId)).toBe(true);
  });
});

describe('cross-household isolation (404)', () => {
  it('another household’s parent and child see nothing and change nothing', async () => {
    const { task } = await newTask(a, { verificationMode: 'PARENT_APPROVAL' });
    const clientUuid = randomUUID();
    expect((await complete(a, task.id, { clientUuid })).status).toBe(200);
    const entry = TimetableEntryResponseSchema.parse(
      (
        await api(
          'POST',
          `/students/${a.studentId}/timetable`,
          { parent: a.parent },
          { weekday: 6, startTime: '08:00', endTime: '09:00', subjectCode: 'GDTC' },
        )
      ).body,
    ).entry;
    const event = (
      await api(
        'POST',
        `/students/${a.studentId}/events`,
        { parent: a.parent },
        {
          type: 'SPORT',
          title: 'Bơi',
          startsAt: '2026-10-24T01:00:00Z',
          endsAt: '2026-10-24T02:00:00Z',
        },
      )
    ).body.event as { id: string };
    const t = today();
    const parentB = { parent: b.parent };
    const childB = { child: b.child };
    const calls: [string, string, Auth, unknown?][] = [
      ['GET', `/students/${a.studentId}/calendar?from=${t}&to=${t}`, parentB],
      ['GET', `/students/${a.studentId}/calendar?from=${t}&to=${t}`, childB],
      ['GET', `/students/${a.studentId}/timetable`, parentB],
      ['GET', `/students/${a.studentId}/timetable`, childB],
      [
        'POST',
        `/students/${a.studentId}/timetable`,
        parentB,
        { weekday: 1, startTime: '07:00', endTime: '08:00', subjectCode: 'TOAN' },
      ],
      ['PATCH', `/timetable/${entry.id}`, parentB, { room: 'x' }],
      ['DELETE', `/timetable/${entry.id}`, parentB],
      [
        'POST',
        `/students/${a.studentId}/events`,
        parentB,
        {
          type: 'EXAM',
          title: 'x',
          startsAt: '2026-10-20T01:00:00Z',
          endsAt: '2026-10-20T02:00:00Z',
        },
      ],
      ['PATCH', `/events/${event.id}`, parentB, { title: 'x' }],
      ['DELETE', `/events/${event.id}`, parentB],
      [
        'POST',
        `/students/${a.studentId}/tasks`,
        parentB,
        { type: 'CUSTOM', title: 'x', verificationMode: 'SELF_CHECK' },
      ],
      ['GET', `/tasks/${task.id}`, parentB],
      ['GET', `/tasks/${task.id}`, childB],
      ['PATCH', `/tasks/${task.id}`, parentB, { title: 'x' }],
      ['POST', `/tasks/${task.id}/approve`, parentB, { date: t }],
      ['POST', `/tasks/${task.id}/reject`, parentB, { date: t }],
      ['POST', `/tasks/${task.id}/complete`, childB, { clientUuid: randomUUID() }],
      [
        'POST',
        '/uploads/sign',
        childB,
        { purpose: 'TASK_PROOF', taskId: task.id, contentType: 'image/jpeg' },
      ],
    ];
    for (const [method, path, auth, body] of calls) {
      const res = await api(method, path, auth, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Replaying A's clientUuid from B's child does not reveal A's completion.
    const replay = await complete(b, task.id, { clientUuid });
    expect(replay.status).toBe(404);
    const inboxB = ApprovalsResponseSchema.parse((await api('GET', '/approvals', parentB)).body);
    expect(inboxB.items.some((i) => i.studentId === a.studentId)).toBe(false);
    const after = await api('GET', `/tasks/${task.id}`, { parent: a.parent });
    expect(after.body.task.title).toBe('Bài tập');
    const [{ status }] = await sql<{ status: string }[]>`
      select status from app.task_occurrences where assignment_id = ${task.id} and occurs_on = ${t}::date`;
    expect(status).toBe('PENDING_APPROVAL');
  });
});

describe('daily materialisation job and maintenance', () => {
  it('pg_cron schedules a daily request; the worker fills 14 days idempotently', async () => {
    const jobs = await sql`
      select schedule from cron.job where jobname = 'vionx-task-materialise'`;
    expect(jobs).toHaveLength(1);
    const { task } = await newTask(a, { rrule: 'FREQ=DAILY', verificationMode: 'SELF_CHECK' });
    await sql`delete from app.task_occurrences where assignment_id = ${task.id}`;
    const count = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from app.task_occurrences where assignment_id = ${task.id}`
      )[0]!.n;
    expect(await count()).toBe(0);
    for (let i = 0; i < 2; i++) {
      await sql`
        insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
        values ('task.materialise_requested', 'system', '{}', ${`it-${randomUUID()}`})`;
      await tickWorker();
      expect(await count()).toBe(MATERIALISE_DAYS);
    }
    // The SQL helper writes at most one request per Vietnam day.
    const requests = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from ops.domain_events
          where type = 'task.materialise_requested' and idempotency_key like 'materialise:%'`
      )[0]!.n;
    const before = await requests();
    const days = 4000 + Math.floor(Math.random() * 30_000);
    await sql`select ops.request_task_materialisation(now() + make_interval(days => ${days}))`;
    await sql`select ops.request_task_materialisation(now() + make_interval(days => ${days}))`;
    expect(await requests()).toBe(before + 1);
  });

  it('removes proof files never attached to a completion after a day', async () => {
    const { task } = await newTask(a, { verificationMode: 'PHOTO_PROOF' });
    const path = await uploadProof(a, task.id);
    await sql`
      update storage.objects set created_at = now() - interval '2 days'
      where bucket_id = 'task-proofs' and name = ${path}`;
    const tick = await tickWorker();
    expect(tick.maintenance.removedOrphanProofs).toBeGreaterThanOrEqual(1);
    const left =
      await sql`select 1 from storage.objects where bucket_id = 'task-proofs' and name = ${path}`;
    expect(left).toHaveLength(0);
  });

  it('calendar tables are not reachable by client roles; the proof bucket is private', async () => {
    for (const table of [
      'app.school_subjects',
      'app.school_timetable_entries',
      'app.calendar_events',
      'app.task_templates',
      'app.task_assignments',
      'app.task_occurrences',
      'app.task_completions',
      'app.task_proofs',
    ]) {
      const rows = await sql<{ allowed: boolean }[]>`
        select bool_or(has_table_privilege(r, ${table}, 'select,insert,update,delete')) as allowed
        from unnest(array['anon', 'authenticated']) as r`;
      expect(rows[0]!.allowed, table).toBe(false);
    }
    const [bucket] = await sql`select public from storage.buckets where id = 'task-proofs'`;
    expect(bucket!.public).toBe(false);
    const policies = await sql`
      select 1 from pg_policies where schemaname = 'storage' and qual like '%task-proofs%'`;
    expect(policies).toHaveLength(0);
  });
});
