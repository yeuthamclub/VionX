// M07 acceptance (TASK_PACKS/M07.md). Requires `pnpm fn:serve` and the Toán 6 library (the real
// one, or the M05 fixture). Signs up throwaway email parents; it never changes library content.
//   pnpm cloud pnpm acceptance m07
// Criteria of the task pack:
//   A. an exam in 3 days on 2 skills → exam-prep items rank above optional tasks;
//   B. finishing a session refreshes Today without a manual recalculation.
// Also checked: reasons on every item, session lengths by grade, the time budget (timetable free
// time + parent setting), pins and removals, task completion through Today, the day-start job,
// and that another household gets 404.
import { randomUUID } from 'node:crypto';
import { householdToday, isoWeekday } from '@vionx/domain';
import { findTopic, solve } from '../lib/learning-solver.ts';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { assert, connectDb, env, SkipStep, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const sql = connectDb();

interface Res {
  status: number;
  body: Record<string, unknown> & { code?: string };
}
type Auth = { parent?: AuthSession; child?: string };

async function call(method: string, path: string, auth?: Auth, body?: unknown): Promise<Res> {
  for (let attempt = 1; ; attempt++) {
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
    const parsed = (text ? JSON.parse(text) : {}) as Res['body'];
    // The local Edge Runtime answers a request sent to a retiring isolate itself (no requestId).
    if (attempt === 1 && res.status === 500 && !('requestId' in parsed)) continue;
    return { status: res.status, body: parsed };
  }
}

async function ok(method: string, path: string, auth?: Auth, body?: unknown, status = 200) {
  const res = await call(method, path, auth, body);
  assert(res.status === status, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function drain(eventIds: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${env.functionsUrl}/worker`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vionx-service-secret': env.serviceSecret },
      body: '{}',
    });
    assert(res.ok, `worker responded ${res.status}`);
    await res.body?.cancel();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events
      where consumer = 'worker' and event_id = any(${eventIds}::uuid[])`;
    if (row!.n === eventIds.length) return;
    assert(Date.now() < deadline, `events not processed: ${row!.n}/${eventIds.length}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

const users: string[] = [];

async function newFamily(label: string, grade: number): Promise<Family> {
  const parent = await signUpWithEmail(
    `acceptance-m07-${label}-${randomUUID()}@vionx.test`,
    `pw-${randomUUID()}`,
  );
  users.push(parent.userId);
  const household = await ok('POST', '/household', { parent }, { name: `Gia đình ${label}` }, 201);
  const student = await ok(
    'POST',
    '/students',
    { parent },
    { displayName: `Con ${label}`, grade, birthYear: 2026 - 6 - grade },
    201,
  );
  const studentId = (student.student as { id: string }).id;
  const policies = await ok('GET', '/policies/current');
  const version = (policies.policies as { type: string; version: number }[]).find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS']) {
    await ok(
      'POST',
      `/students/${studentId}/consents/${type}/grant`,
      { parent },
      { policyVersion: version },
    );
  }
  const login = await ok('POST', '/auth/child/login', undefined, {
    ...(student.credentials as object),
    deviceId: `acceptance-${randomUUID()}`,
  });
  return {
    parent,
    householdId: (household.household as { id: string }).id,
    studentId,
    child: login.token as string,
  };
}

interface Reason {
  code: string;
  points: number;
  params?: Record<string, unknown>;
}
interface Item {
  id: string;
  kind: string;
  title: string;
  subject: string | null;
  minutes: number;
  priority: number;
  reasons: Reason[];
  status: string;
  pinned: boolean;
  required: boolean;
  inBudget: boolean;
  rewardXp: number;
  link:
    | { type: 'TASK'; taskId: string }
    | { type: 'SESSION'; mode: string; skillIds: string[]; subject: string };
}
interface Today {
  localDate: string;
  version: number;
  generatedAt: string;
  budgetMinutes: number;
  freeMinutes: number;
  sessionMinutes: number;
  dailyMinutes: number | null;
  plannedMinutes: number;
  doneMinutes: number;
  items: Item[];
}

const today = async (f: Family, as: 'child' | 'parent' = 'child') =>
  (await ok(
    'GET',
    `/students/${f.studentId}/today`,
    as === 'child' ? { child: f.child } : { parent: f.parent },
  )) as unknown as Today;

const act = async (f: Family, as: 'child' | 'parent', item: Item, action: string, body = {}) =>
  (await ok(
    'POST',
    `/today-items/${item.id}/${action}`,
    as === 'child' ? { child: f.child } : { parent: f.parent },
    body,
  )) as unknown as { item: Item; today: Today };

async function newTask(f: Family, body: Record<string, unknown>): Promise<string> {
  const res = await ok(
    'POST',
    `/students/${f.studentId}/tasks`,
    { parent: f.parent },
    { type: 'CUSTOM', verificationMode: 'SELF_CHECK', durationMinutes: 10, ...body },
    201,
  );
  return (res.task as { id: string }).id;
}

const ofTask = (t: Today, taskId: string) =>
  t.items.find((i) => i.link.type === 'TASK' && i.link.taskId === taskId);
const ofSkill = (t: Today, skillId: string) =>
  t.items.find((i) => i.link.type === 'SESSION' && i.link.skillIds[0] === skillId);
const place = (t: Today, item: Item | undefined) => t.items.findIndex((i) => i.id === item?.id);
const line = (i: Item) =>
  `${i.kind} "${i.title}" ${i.priority} [${i.reasons.map((r) => `${r.code} ${r.points}`).join(', ')}]`;

const state: {
  a?: Family;
  b?: Family;
  g2?: Family;
  topic?: { topicTitle: string; skillIds: string[] };
  optional?: string[];
  homework?: string;
} = {};

export const scenario: Scenario = {
  name: 'M07 — Today planner',
  steps: [
    {
      name: 'Toán 6 library is present; two Grade 6 children and one Grade 2 child sign in',
      run: async () => {
        const [count] = await sql<{ n: number }[]>`
          select count(*)::int as n from library.items
          where status in ('APPROVED', 'PUBLISHED') and type <> 'written'
            and grade = 6 and subject = 'math'`;
        assert(count!.n > 0, 'needs approved Toán 6 items');
        state.topic =
          (await findTopic(sql, 6, 'math', '%phân số%')) ??
          (await findTopic(sql, 6, 'math', null)) ??
          undefined;
        assert(state.topic, 'no Toán 6 topic with at least 2 practicable skills');
        state.a = await newFamily('A', 6);
        state.b = await newFamily('B', 6);
        state.g2 = await newFamily('G2', 2);
        return `Toán 6: ${count!.n} items; exam topic "${state.topic.topicTitle}"`;
      },
    },
    {
      name: 'A day with nothing assigned still has a plan; every item has reasons; session length by grade',
      run: async () => {
        const g6 = await today(state.a!);
        const g2 = await today(state.g2!);
        assert(g6.version === 1, `first plan has version ${g6.version}`);
        assert(g6.sessionMinutes === 25, `Grade 6 session is ${g6.sessionMinutes} minutes`);
        assert(g2.sessionMinutes === 15, `Grade 2 session is ${g2.sessionMinutes} minutes`);
        assert(g6.budgetMinutes === 75, `Grade 6 default budget is ${g6.budgetMinutes}`);
        assert(g2.budgetMinutes === 45, `Grade 2 default budget is ${g2.budgetMinutes}`);
        const next = g6.items.find((i) => i.kind === 'NEXT_SKILL' && i.subject === 'math');
        assert(next, 'no next-skill item for Toán 6');
        assert(
          [...g6.items, ...g2.items].every((i) => i.reasons.length > 0),
          'an item has no reasons',
        );
        const again = await today(state.a!, 'parent');
        assert(
          again.version === 1 && again.generatedAt === g6.generatedAt,
          'an unchanged plan was regenerated',
        );
        return `Grade 6: ${g6.items.length} item(s), 25' each, budget 75'; Grade 2: ${g2.items.length} item(s), 15' each, budget 45'; first item: ${line(g6.items[0]!)}`;
      },
    },
    {
      name: 'A. An exam in 3 days on 2 skills → exam-prep items rank above optional tasks',
      run: async () => {
        const a = state.a!;
        const skills = state.topic!.skillIds.slice(0, 2);
        state.optional = [
          await newTask(a, { title: 'Tưới cây', required: false, priority: 'HIGH' }),
          await newTask(a, { title: 'Đọc truyện', required: false, type: 'READING' }),
          await newTask(a, { title: 'Đá bóng', required: false, type: 'SPORT', priority: 'LOW' }),
        ];
        state.homework = await newTask(a, { title: 'Bài tập Toán', type: 'HOMEWORK' });
        const startsAt = new Date(Date.now() + 3 * 86_400_000);
        await ok(
          'POST',
          `/students/${a.studentId}/events`,
          { parent: a.parent },
          {
            type: 'EXAM',
            title: 'Kiểm tra giữa kì',
            subjectCode: 'TOAN',
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
            skillIds: skills,
          },
          201,
        );
        const plan = await today(a);
        const prep = skills.map((id) => ofSkill(plan, id));
        assert(
          prep.every((i) => i?.kind === 'EXAM_PREP'),
          `exam skills are planned as ${prep.map((i) => i?.kind).join(',')}`,
        );
        const optional = state.optional.map((id) => ofTask(plan, id)!);
        assert(
          optional.every((i) => i && !i.required),
          'optional tasks are missing from Today',
        );
        const lastPrep = Math.max(...prep.map((i) => place(plan, i)));
        const firstOptional = Math.min(...optional.map((i) => place(plan, i)));
        assert(
          lastPrep < firstOptional,
          `exam prep at ${lastPrep}, first optional task at ${firstOptional}`,
        );
        const kinds = optional.map((i) => i.kind).join(',');
        assert(kinds === 'PARENT_TASK,READING_GOAL,ACTIVITY_GOAL', `task kinds ${kinds}`);
        assert(
          ofTask(plan, state.homework)?.kind === 'HOMEWORK',
          'homework is not a HOMEWORK item',
        );
        const reason = prep[0]!.reasons.find((r) => r.code === 'EXAM_SOON');
        assert(
          reason?.params?.days === 3 && reason.params.examTitle === 'Kiểm tra giữa kì',
          `exam reason ${JSON.stringify(reason)}`,
        );
        const sorted = [...plan.items].sort((x, y) => y.priority - x.priority);
        assert(
          plan.items.every((i, n) => i.priority === sorted[n]!.priority),
          'items are not in priority order',
        );
        return `order: ${plan.items.map((i) => `${i.kind} ${i.priority}`).join(' > ')}; exam prep: ${line(prep[0]!)}`;
      },
    },
    {
      name: 'B. Finishing a session refreshes Today without a manual recalculation',
      run: async () => {
        const a = state.a!;
        const before = await today(a);
        const item = ofSkill(before, state.topic!.skillIds[0]!)!;
        const refused = await call(
          'POST',
          `/today-items/${item.id}/complete`,
          { child: a.child },
          { clientUuid: randomUUID() },
        );
        assert(
          refused.status === 409 &&
            (refused.body.details as { reason: string }).reason === 'SYSTEM_VERIFIED_ONLY',
          `completing a learning item by hand → ${refused.status}`,
        );
        const started = await act(a, 'child', item, 'start');
        assert(started.item.status === 'STARTED', `started item is ${started.item.status}`);
        assert(item.link.type === 'SESSION', 'exam prep does not link to a session');
        const session = (
          await ok(
            'POST',
            '/learning/sessions',
            { child: a.child },
            {
              clientUuid: randomUUID(),
              mode: item.link.mode,
              skillIds: item.link.skillIds,
              targetItems: 3,
            },
          )
        ).session as { id: string };
        let answered = 0;
        for (let guard = 0; guard < 10; guard++) {
          const next = await ok('GET', `/learning/sessions/${session.id}/next`, {
            child: a.child,
          });
          if (next.done) break;
          const served = next.item as { id: string; seed: number | null };
          await ok(
            'POST',
            `/learning/sessions/${session.id}/answers`,
            { child: a.child },
            {
              clientUuid: randomUUID(),
              itemId: served.id,
              response: (await solve(sql, served.id, served.seed)).correct,
              responseMs: 4000,
            },
          );
          answered++;
        }
        await ok('POST', `/learning/sessions/${session.id}/finish`, { child: a.child });

        // The next read is all the app does after a session (query invalidation): no
        // recalculate call, no worker run in between.
        const after = await today(a);
        const done = after.items.find((i) => i.id === item.id);
        assert(done?.status === 'DONE', `item after the session is ${done?.status}`);
        assert(after.version > started.today.version, 'the plan version did not grow');
        assert(after.doneMinutes === 25, `done minutes ${after.doneMinutes}`);
        const other = ofSkill(after, state.topic!.skillIds[1]!)!;
        assert(
          other.reasons.some((r) => r.code === 'WORKLOAD_TODAY' && r.points < 0),
          'the workload of the day did not lower the other learning item',
        );

        // The worker handles the same event (XP once, plan unchanged).
        const events = await sql<{ id: string }[]>`
          select id from ops.domain_events
          where type = 'learning.session_finished' and aggregate_id = ${session.id}`;
        await drain(events.map((e) => e.id));
        const settled = await today(a);
        assert(settled.version === after.version, 'the worker changed an up-to-date plan');
        const xp = await sql<{ amount: number }[]>`
          select amount from app.xp_ledger
          where student_id = ${a.studentId} and source_type = 'learning_session'
            and source_id = ${session.id}`;
        assert(xp.length === 1, `session XP rows: ${xp.length}`);
        return `${answered} answers → "${item.title}" DONE on the next read (version ${started.today.version} → ${after.version}), +${xp[0]!.amount} XP once; other exam skill now ${other.priority} (${other.reasons.at(-1)!.points} workload)`;
      },
    },
    {
      name: 'Tasks through Today: complete (idempotent), required tasks cannot be skipped',
      run: async () => {
        const a = state.a!;
        const plan = await today(a);
        const homework = ofTask(plan, state.homework!)!;
        const skip = await call('POST', `/today-items/${homework.id}/skip`, { child: a.child });
        assert(skip.status === 409, `skipping a required task → ${skip.status}`);
        const clientUuid = randomUUID();
        const done = await act(a, 'child', homework, 'complete', { clientUuid });
        assert(done.item.status === 'DONE', `completed task item is ${done.item.status}`);
        await act(a, 'child', homework, 'complete', { clientUuid });
        const completions = await sql`
          select id from app.task_completions where assignment_id = ${state.homework!}`;
        assert(completions.length === 1, `completions after a replay: ${completions.length}`);
        const skipped = await act(a, 'child', ofTask(plan, state.optional![2]!)!, 'skip');
        assert(skipped.item.status === 'SKIPPED', `skipped item is ${skipped.item.status}`);
        return `homework DONE once (replay stored nothing), required skip → 409 REQUIRED_ITEM, optional "Đá bóng" SKIPPED; done ${done.today.doneMinutes}'`;
      },
    },
    {
      name: 'Time budget: timetable free time and the parent setting',
      run: async () => {
        const g2 = state.g2!;
        const before = await today(g2, 'parent');
        const weekday = isoWeekday(householdToday(new Date(), 'Asia/Ho_Chi_Minh'));
        await ok(
          'POST',
          `/students/${g2.studentId}/timetable`,
          { parent: g2.parent },
          { weekday, startTime: '07:00', endTime: '11:30', subjectCode: 'TOAN' },
          201,
        );
        const school = await today(g2, 'parent');
        assert(
          school.freeMinutes === before.freeMinutes - 270,
          `free minutes ${before.freeMinutes} → ${school.freeMinutes} after 4.5 h of school`,
        );
        const required = await newTask(g2, { title: 'Tập viết', durationMinutes: 20 });
        const optional = await newTask(g2, {
          title: 'Xếp đồ chơi',
          required: false,
          durationMinutes: 10,
        });
        const set = (await ok(
          'PUT',
          `/students/${g2.studentId}/today/settings`,
          { parent: g2.parent },
          { dailyMinutes: 20 },
        )) as unknown as Today;
        assert(set.budgetMinutes === 20, `budget with the parent setting is ${set.budgetMinutes}`);
        assert(ofTask(set, required)!.inBudget, 'a required task fell out of the budget');
        const beyond = set.items.filter((i) => !i.required && i.status === 'PLANNED');
        assert(
          beyond.length > 0 && beyond.every((i) => !i.inBudget),
          'optional items still fit a budget the required task uses up',
        );
        assert(ofTask(set, optional)!.inBudget === false, 'optional task marked as fitting');
        const child = await call(
          'PUT',
          `/students/${g2.studentId}/today/settings`,
          { child: g2.child },
          { dailyMinutes: 300 },
        );
        assert(child.status === 403, `a child changing the setting → ${child.status}`);
        const reset = (await ok(
          'PUT',
          `/students/${g2.studentId}/today/settings`,
          { parent: g2.parent },
          { dailyMinutes: null },
        )) as unknown as Today;
        assert(reset.budgetMinutes === 45, `default budget is ${reset.budgetMinutes}`);
        return `free ${before.freeMinutes}' → ${school.freeMinutes}' with school 07:00-11:30; setting 20' → required task fits, ${beyond.length} optional item(s) "if there is time"; default again 45'`;
      },
    },
    {
      name: 'Parent sees reasons, pins an item to the top and removes one for the day',
      run: async () => {
        const a = state.a!;
        const plan = await today(a, 'parent');
        const open = plan.items.filter((i) => i.status === 'PLANNED');
        const target = open.at(-1)!;
        const pinned = await act(a, 'parent', target, 'pin');
        assert(pinned.today.items[0]!.id === target.id, 'the pinned item is not first');
        assert(pinned.item.pinned && pinned.item.inBudget, 'pinned item is not kept in the budget');
        const victim = open[0]!;
        await act(a, 'parent', victim, 'remove');
        const child = await today(a);
        assert(!child.items.some((i) => i.id === victim.id), 'the child still sees a removed item');
        assert(child.items[0]!.id === target.id, 'the child does not see the pinned item first');
        const parent = await today(a, 'parent');
        assert(
          parent.items.find((i) => i.id === victim.id)?.status === 'REMOVED',
          'the parent does not see the removed item',
        );
        const denied = await call('POST', `/today-items/${target.id}/pin`, { child: a.child }, {});
        assert(denied.status === 403, `a child pinning → ${denied.status}`);
        await act(a, 'parent', victim, 'remove', { removed: false });
        await act(a, 'parent', target, 'pin', { pinned: false });
        const audit = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.audit_logs
          where household_id = ${a.householdId} and action like 'planner.item_%'`;
        assert(audit[0]!.n === 4, `audit rows for pin/remove: ${audit[0]!.n}`);
        return `pinned "${target.title || target.kind}" → first for parent and child; removed "${victim.title || victim.kind}" → hidden from the child, REMOVED for the parent; both undone; 4 audit rows`;
      },
    },
    {
      name: 'Day start: the hourly job writes the plan of a child that has none',
      run: async () => {
        const b = state.b!;
        const [none] = await sql<{ n: number }[]>`
          select count(*)::int as n from app.today_plans where student_id = ${b.studentId}`;
        assert(none!.n === 0, 'family B already has a plan');
        const [event] = await sql<{ id: string }[]>`
          insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
          values ('planner.day_start_requested', 'system',
                  ${sql.json({ requestedAt: new Date().toISOString() })},
                  ${`acceptance:${randomUUID()}`})
          returning id`;
        await drain([event!.id]);
        const plans = await sql<{ version: number; items: number }[]>`
          select p.version,
                 (select count(*)::int from app.today_plan_items i where i.plan_id = p.id) as items
          from app.today_plans p where p.student_id = ${b.studentId}`;
        assert(plans.length === 1 && plans[0]!.version === 1, `plans: ${JSON.stringify(plans)}`);
        const [job] = await sql<{ schedule: string }[]>`
          select schedule from cron.job where jobname = 'vionx-today-plans'`;
        assert(job?.schedule === '10 * * * *', `cron schedule ${job?.schedule}`);
        return `plan written by the worker (version 1, ${plans[0]!.items} item(s)); pg_cron "vionx-today-plans" at ${job.schedule}`;
      },
    },
    {
      name: 'Another household gets 404 on every Today route',
      run: async () => {
        const a = state.a!;
        const b = state.b!;
        const item = (await today(a)).items[0]!;
        const base = `/students/${a.studentId}/today`;
        const denied = await Promise.all([
          call('GET', base, { parent: b.parent }),
          call('GET', base, { child: b.child }),
          call('POST', `${base}/recalculate`, { parent: b.parent }),
          call('PUT', `${base}/settings`, { parent: b.parent }, { dailyMinutes: 60 }),
          call('POST', `/today-items/${item.id}/start`, { child: b.child }),
          call('POST', `/today-items/${item.id}/skip`, { child: b.child }),
          call(
            'POST',
            `/today-items/${item.id}/complete`,
            { child: b.child },
            { clientUuid: randomUUID() },
          ),
          call('POST', `/today-items/${item.id}/pin`, { parent: b.parent }, {}),
          call('POST', `/today-items/${item.id}/remove`, { parent: b.parent }, {}),
        ]);
        const statuses = denied.map((r) => r.status).join(',');
        assert(statuses === Array(9).fill(404).join(','), `statuses ${statuses}`);
        return '9 calls with another household’s parent or child → 404 each';
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m07-today.yaml (child home = Today, parent pin)',
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
