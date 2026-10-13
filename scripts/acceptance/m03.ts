// M03 acceptance (TASK_PACKS/M03.md). Requires `pnpm db:start && pnpm fn:serve` (local only: signs
// up throwaway email parents).
//   pnpm acceptance m03
// Criterion: a recurring PARENT_APPROVAL task; the child completes it twice with the same
// clientUuid → one completion is stored → the parent approves → exactly one TaskApproved event.
// Plus: 14-day materialisation (and the daily job is idempotent), the approvals inbox, children
// cannot edit tasks, another household gets 404, and the worker consumes each event once.
import { randomUUID } from 'node:crypto';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { householdToday } from '../../packages/domain/src/calendar/dates.ts';
import { MATERIALISE_DAYS } from '../../packages/domain/src/calendar/types.ts';
import { assert, connectDb, env, SkipStep, waitFor, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const sql = connectDb();
const TZ = 'Asia/Ho_Chi_Minh';

interface Res {
  status: number;
  body: Record<string, unknown> & { code?: string; details?: Record<string, unknown> };
}

async function call(
  method: string,
  path: string,
  auth?: { parent?: AuthSession; child?: string },
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth?.parent ? { authorization: `Bearer ${auth.parent.accessToken}` } : {}),
      ...(auth?.child ? { 'x-vionx-child-session': auth.child } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Res['body'] };
}

async function tickWorker(): Promise<void> {
  const res = await fetch(`${env.functionsUrl}/worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vionx-service-secret': env.serviceSecret },
    body: '{}',
  });
  assert(res.ok, `worker responded ${res.status}`);
  await res.body?.cancel();
}

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

const users: string[] = [];
const state: {
  a?: Family;
  b?: Family;
  taskId?: string;
  clientUuid?: string;
  completionId?: string;
} = {};

async function newFamily(label: string): Promise<Family> {
  const parent = await signUpWithEmail(
    `acceptance-m03-${label}-${randomUUID()}@vionx.test`,
    `pw-${randomUUID()}`,
  );
  users.push(parent.userId);
  const household = await call('POST', '/household', { parent }, { name: `Gia đình ${label}` });
  assert(household.status === 201, `POST /household ${household.status}`);
  const student = await call(
    'POST',
    '/students',
    { parent },
    { displayName: `Con ${label}`, grade: 6, birthYear: 2014 },
  );
  assert(student.status === 201, `POST /students ${student.status}`);
  const studentId = (student.body.student as { id: string }).id;
  const policies = await call('GET', '/policies/current');
  const version = (policies.body.policies as { type: string; version: number }[]).find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER']) {
    const g = await call(
      'POST',
      `/students/${studentId}/consents/${type}/grant`,
      { parent },
      { policyVersion: version },
    );
    assert(g.status === 200, `grant ${type} ${g.status}`);
  }
  const login = await call('POST', '/auth/child/login', undefined, {
    ...(student.body.credentials as object),
    deviceId: `acceptance-${randomUUID()}`,
  });
  assert(login.status === 200, `child login ${login.status}`);
  return {
    parent,
    householdId: (household.body.household as { id: string }).id,
    studentId,
    child: login.body.token as string,
  };
}

const eventCount = async (type: string, aggregateId: string) =>
  (
    await sql<{ n: number }[]>`
      select count(*)::int as n from ops.domain_events
      where type = ${type} and aggregate_id = ${aggregateId}`
  )[0]!.n;

export const scenario: Scenario = {
  name: 'M03 — Calendar, timetable & tasks',
  steps: [
    {
      name: 'Parent assigns a recurring PARENT_APPROVAL task → 14 days materialised, one TaskAssigned',
      run: async () => {
        state.a = await newFamily('A');
        state.b = await newFamily('B');
        const res = await call(
          'POST',
          `/students/${state.a.studentId}/tasks`,
          { parent: state.a.parent },
          {
            type: 'HOMEWORK',
            title: 'Làm bài tập về nhà',
            rrule: 'FREQ=DAILY',
            verificationMode: 'PARENT_APPROVAL',
            rewardXp: 20,
            windowStart: '19:30',
            windowEnd: '20:30',
          },
        );
        assert(res.status === 201, `POST tasks ${res.status} ${JSON.stringify(res.body)}`);
        const task = res.body.task as { id: string; rrule: string };
        state.taskId = task.id;
        const upcoming = res.body.upcoming as string[];
        assert(
          upcoming.length === MATERIALISE_DAYS,
          `expected ${MATERIALISE_DAYS} days, got ${upcoming.length}`,
        );
        assert((await eventCount('task.assigned', task.id)) === 1, 'expected one task.assigned');
        return `task ${task.id} (${task.rrule}); days ${upcoming[0]}..${upcoming.at(-1)}`;
      },
    },
    {
      name: 'Child sees today’s task and completes it twice with the same clientUuid → one completion',
      run: async () => {
        const a = state.a!;
        const today = householdToday(new Date(), TZ);
        const cal = await call(
          'GET',
          `/students/${a.studentId}/calendar?from=${today}&to=${today}`,
          { child: a.child },
        );
        assert(cal.status === 200, `calendar ${cal.status}`);
        const tasks = cal.body.tasks as { taskId: string; status: string }[];
        assert(
          tasks.some((t) => t.taskId === state.taskId && t.status === 'ASSIGNED'),
          'task not in the child’s today list',
        );
        state.clientUuid = randomUUID();
        const first = await call(
          'POST',
          `/tasks/${state.taskId}/complete`,
          { child: a.child },
          { clientUuid: state.clientUuid },
        );
        const second = await call(
          'POST',
          `/tasks/${state.taskId}/complete`,
          { child: a.child },
          { clientUuid: state.clientUuid },
        );
        assert(first.status === 200 && second.status === 200, `${first.status}/${second.status}`);
        assert(first.body.replayed === false && second.body.replayed === true, 'replay flags');
        const rows = await sql<{ id: string; status: string }[]>`
          select c.id, c.status from app.task_completions c
          join app.task_occurrences o on o.id = c.occurrence_id
          where c.assignment_id = ${state.taskId!} and o.occurs_on = ${today}::date`;
        assert(rows.length === 1, `expected 1 completion, found ${rows.length}`);
        assert(rows[0]!.status === 'PENDING_APPROVAL', `status ${rows[0]!.status}`);
        state.completionId = rows[0]!.id;
        assert(
          (await eventCount('task.completed', state.completionId)) === 1,
          'expected one task.completed',
        );
        return `1 completion (${state.completionId}) PENDING_APPROVAL, 1 TaskCompleted event`;
      },
    },
    {
      name: 'Children can only complete: editing or approving as the child answers 403',
      run: async () => {
        const a = state.a!;
        const today = householdToday(new Date(), TZ);
        const edit = await call(
          'PATCH',
          `/tasks/${state.taskId}`,
          { child: a.child },
          { title: 'Không làm' },
        );
        const approve = await call(
          'POST',
          `/tasks/${state.taskId}/approve`,
          { child: a.child },
          { date: today },
        );
        assert(edit.status === 403 && approve.status === 403, `${edit.status}/${approve.status}`);
        return 'PATCH /tasks/{id} 403, POST /tasks/{id}/approve 403 for the child';
      },
    },
    {
      name: 'Another household cannot see or decide the task (404)',
      run: async () => {
        const b = state.b!;
        const today = householdToday(new Date(), TZ);
        const checks = [
          await call('GET', `/tasks/${state.taskId}`, { parent: b.parent }),
          await call(
            'POST',
            `/tasks/${state.taskId}/approve`,
            { parent: b.parent },
            { date: today },
          ),
          await call('GET', `/students/${state.a!.studentId}/calendar?from=${today}&to=${today}`, {
            parent: b.parent,
          }),
          await call(
            'POST',
            `/tasks/${state.taskId}/complete`,
            { child: b.child },
            { clientUuid: randomUUID() },
          ),
        ];
        assert(
          checks.every((r) => r.status === 404),
          checks.map((r) => r.status).join(','),
        );
        const inbox = await call('GET', '/approvals', { parent: b.parent });
        assert(inbox.body.count === 0, `other inbox count ${String(inbox.body.count)}`);
        return 'task, approve, calendar, complete → 404; other inbox empty';
      },
    },
    {
      name: 'Parent sees it in the approvals inbox, approves → exactly one TaskApproved event',
      run: async () => {
        const a = state.a!;
        const today = householdToday(new Date(), TZ);
        const inbox = await call('GET', '/approvals', { parent: a.parent });
        assert(inbox.status === 200 && inbox.body.count === 1, `inbox ${inbox.body.count}`);
        const approve = await call(
          'POST',
          `/tasks/${state.taskId}/approve`,
          { parent: a.parent },
          { date: today },
        );
        assert(approve.status === 200, `approve ${approve.status}`);
        const again = await call(
          'POST',
          `/tasks/${state.taskId}/approve`,
          { parent: a.parent },
          { date: today },
        );
        assert(again.status === 409, `second approve ${again.status}`);
        const replay = await call(
          'POST',
          `/tasks/${state.taskId}/complete`,
          { child: a.child },
          { clientUuid: state.clientUuid },
        );
        assert(replay.status === 200 && replay.body.replayed === true, 'late replay');
        const approved = await sql<{ payload: Record<string, unknown> }[]>`
          select payload from ops.domain_events
          where type = 'task.approved' and payload->>'taskId' = ${state.taskId!}`;
        assert(approved.length === 1, `expected 1 TaskApproved, found ${approved.length}`);
        assert(approved[0]!.payload.eventName === 'TaskApproved', 'event name');
        const after = await call('GET', '/approvals', { parent: a.parent });
        assert(after.body.count === 0, `inbox after ${after.body.count}`);
        return `1 task.approved (TaskApproved, rewardXp ${String(approved[0]!.payload.rewardXp)}); second approve 409; inbox empty`;
      },
    },
    {
      name: 'Worker consumes TaskAssigned/TaskCompleted/TaskApproved exactly once',
      run: async () => {
        const ids = await sql<{ id: string }[]>`
          select id from ops.domain_events
          where type in ('task.assigned', 'task.completed', 'task.approved')
            and payload->>'taskId' = ${state.taskId!}`;
        assert(ids.length === 3, `expected 3 events, found ${ids.length}`);
        const processed = await waitFor(
          async () => {
            await tickWorker();
            const rows = await sql<{ n: number }[]>`
              select count(*)::int as n from ops.processed_events
              where event_id = any(${ids.map((r) => r.id)}::uuid[])`;
            return rows[0]!.n >= 3 ? rows[0]!.n : undefined;
          },
          30_000,
          1000,
        );
        assert(processed === 3, `processed ${String(processed)}`);
        return '3 events, 3 processed_events rows';
      },
    },
    {
      name: 'Daily pg_cron job materialises recurring days for 14 days, idempotently',
      run: async () => {
        const [job] = await sql<{ schedule: string }[]>`
          select schedule from cron.job where jobname = 'vionx-task-materialise'`;
        assert(job, 'cron job vionx-task-materialise missing');
        const today = householdToday(new Date(), TZ);
        await sql`
          delete from app.task_occurrences
          where assignment_id = ${state.taskId!} and occurs_on > ${today}::date and status = 'ASSIGNED'`;
        const count = async () =>
          (
            await sql<{ n: number }[]>`
              select count(*)::int as n from app.task_occurrences
              where assignment_id = ${state.taskId!}`
          )[0]!.n;
        const before = await count();
        const counts: number[] = [];
        for (let i = 0; i < 2; i++) {
          // What the cron job writes (one per day); a fresh key per run so the step can repeat.
          await sql`
            insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
            values ('task.materialise_requested', 'system', '{}', ${`acceptance-${randomUUID()}`})`;
          const n = await waitFor(
            async () => {
              await tickWorker();
              const c = await count();
              return c === MATERIALISE_DAYS ? c : undefined;
            },
            30_000,
            1000,
          );
          counts.push(n ?? (await count()));
        }
        assert(
          counts.every((c) => c === MATERIALISE_DAYS),
          `counts ${before} → ${counts.join(', ')}`,
        );
        return `cron "${job.schedule}" (00:05 ICT); ${before} → ${counts.join(' → ')} days`;
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m03-tasks.yaml',
      run: async () => {
        throw new SkipStep(
          'needs an Android emulator with the development build (not available here)',
        );
      },
    },
  ],
  cleanup: async () => {
    for (const id of users) {
      await sql`
        delete from app.households where id in (
          select household_id from app.household_memberships where user_id = ${id})`;
      await sql`delete from auth.users where id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  },
};
