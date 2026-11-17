// M08 acceptance (TASK_PACKS/M08.md). Requires `pnpm fn:serve` and the Toán 6 library (the real
// one, or the M05 fixture). Signs up throwaway email parents; it never changes library content.
//   pnpm cloud pnpm acceptance m08
// Criteria of the task pack, through the API (the Maestro suite on two emulators is skipped here):
//   A. Master Spec §43: parent signs up → 3 children → timetable + tasks → child logs in → task +
//      learning → XP → Coin within the cap → the dashboard updates;
//   B. a grade entry appears next to mastery (side by side, never merged).
// Also checked: sufficiency labels on every interpretive figure, only parents edit grades and
// every edit is audited, another household gets 404.
// The day is closed the M04 way: a settlement request with a chosen `requestedAt` (tomorrow).
import { randomUUID } from 'node:crypto';
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

interface Child {
  studentId: string;
  name: string;
  grade: number;
  loginId: string;
  token: string;
}
interface Family {
  parent: AuthSession;
  householdId: string;
  children: Child[];
}

const users: string[] = [];

async function newFamily(label: string, grades: number[]): Promise<Family> {
  const parent = await signUpWithEmail(
    `acceptance-m08-${label}-${randomUUID()}@vionx.test`,
    `pw-${randomUUID()}`,
  );
  users.push(parent.userId);
  const household = await ok('POST', '/household', { parent }, { name: `Gia đình ${label}` }, 201);
  const policies = await ok('GET', '/policies/current');
  const version = (policies.policies as { type: string; version: number }[]).find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  const children: Child[] = [];
  for (const [i, grade] of grades.entries()) {
    const name = `Con ${label}${i + 1}`;
    const student = await ok(
      'POST',
      '/students',
      { parent },
      { displayName: name, grade, birthYear: 2026 - 6 - grade },
      201,
    );
    const studentId = (student.student as { id: string }).id;
    for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS']) {
      await ok(
        'POST',
        `/students/${studentId}/consents/${type}/grant`,
        { parent },
        { policyVersion: version },
      );
    }
    const credentials = student.credentials as { childLoginId: string; pin: string };
    const login = await ok('POST', '/auth/child/login', undefined, {
      ...credentials,
      deviceId: `acceptance-${randomUUID()}`,
    });
    children.push({
      studentId,
      name,
      grade,
      loginId: credentials.childLoginId,
      token: login.token as string,
    });
  }
  return { parent, householdId: (household.household as { id: string }).id, children };
}

type Sufficiency = 'INSUFFICIENT' | 'LOW' | 'OK';
interface Dashboard {
  today: { itemsTotal: number; itemsDone: number; completion: number | null };
  streak: { days: number; sufficiency: Sufficiency };
  rewards: {
    coinBalance: number;
    coinsToday: number;
    capCoinsToday: number;
    coinsWeek: number;
    coinsInRange: number;
    xpInRange: number;
    lifetimeXp: number;
  };
  tasks: { total: number; done: number; completion: number | null; sufficiency: Sufficiency };
  learning: {
    sessions: number;
    answers: number;
    accuracy: number | null;
    sufficiency: Sufficiency;
    subjects: {
      subject: string;
      practised: number;
      meanScore: number | null;
      sufficiency: Sufficiency;
    }[];
  };
  school: {
    subjects: {
      subjectCode: string;
      count: number;
      averagePercent: number | null;
      direction: string;
      sufficiency: Sufficiency;
    }[];
  };
  sideBySide: {
    subjectCode: string;
    librarySubject: string | null;
    school: { averagePercent: number | null; count: number; sufficiency: Sufficiency };
    mastery: { meanScore: number | null; practised: number; sufficiency: Sufficiency } | null;
  }[];
}
interface Card {
  studentId: string;
  displayName: string;
  today: { itemsTotal: number; itemsDone: number };
  streak: { days: number };
  coinBalance: number;
  coinsToday: number;
  coinsWeek: number;
  skillsSufficiency: Sufficiency;
}

const dashboard = async (f: Family, c: Child, range = '7d') =>
  (await ok('GET', `/students/${c.studentId}/dashboard?range=${range}`, {
    parent: f.parent,
  })) as unknown as Dashboard;
const overview = async (f: Family) =>
  (await ok('GET', '/household/overview', { parent: f.parent })).children as Card[];

const LABELS = ['INSUFFICIENT', 'LOW', 'OK'];
// Household-local "today" in Asia/Ho_Chi_Minh (UTC+7, no daylight saving).
const TODAY = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const dayBefore = (n: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const state: {
  a?: Family;
  b?: Family;
  topic?: { topicTitle: string; skillIds: string[] };
  taskIds?: string[];
  xp?: number;
} = {};

export const scenario: Scenario = {
  name: 'M08 — Parent dashboard & gradebook',
  steps: [
    {
      name: '§43: a parent signs up and creates 3 children, each with a Child ID and PIN',
      run: async () => {
        const [count] = await sql<{ n: number }[]>`
          select count(*)::int as n from library.items
          where status in ('APPROVED', 'PUBLISHED') and type <> 'written'
            and grade = 6 and subject = 'math'`;
        assert(count!.n > 0, 'needs approved Toán 6 items');
        state.topic = (await findTopic(sql, 6, 'math', null, 1)) ?? undefined;
        assert(state.topic, 'no Toán 6 topic with practicable skills');
        state.a = await newFamily('A', [6, 6, 2]);
        state.b = await newFamily('B', [6]);
        const ids = state.a.children.map((c) => c.loginId);
        assert(new Set(ids).size === 3, `child login ids ${ids.join(',')}`);
        assert(
          ids.every((id) => /^vx-[2-9a-hjkmnp-z]{6}$/.test(id)),
          `unexpected login id format: ${ids.join(',')}`,
        );
        const cards = await overview(state.a);
        assert(cards.length === 3, `overview has ${cards.length} cards`);
        return `3 children signed in with ${ids.join(', ')}; overview has one card each; Toán 6: ${count!.n} items`;
      },
    },
    {
      name: '§43: the parent adds a timetable and tasks; the child sees them in Today',
      run: async () => {
        const a = state.a!;
        const child = a.children[0]!;
        const weekday = new Date(Date.now() + 7 * 3_600_000).getUTCDay() || 7;
        await ok(
          'POST',
          `/students/${child.studentId}/timetable`,
          { parent: a.parent },
          { weekday, startTime: '07:00', endTime: '11:30', subjectCode: 'TOAN' },
          201,
        );
        state.taskIds = [];
        for (const task of [
          { type: 'HOMEWORK', title: 'Bài tập Toán', rewardXp: 1000 },
          { type: 'READING', title: 'Đọc sách 20 phút', rewardXp: 1000 },
          { type: 'HOUSEHOLD', title: 'Dọn góc học tập', rewardXp: 1000 },
          { type: 'SPORT', title: 'Vận động 30 phút', rewardXp: 20, required: false },
        ]) {
          const res = await ok(
            'POST',
            `/students/${child.studentId}/tasks`,
            { parent: a.parent },
            { verificationMode: 'SELF_CHECK', durationMinutes: 10, ...task },
            201,
          );
          state.taskIds.push((res.task as { id: string }).id);
        }
        const today = await ok('GET', `/students/${child.studentId}/today`, {
          child: child.token,
        });
        const items = today.items as { kind: string; title: string }[];
        const kinds = items.map((i) => i.kind);
        for (const kind of ['HOMEWORK', 'READING_GOAL', 'PARENT_TASK', 'ACTIVITY_GOAL']) {
          assert(kinds.includes(kind), `Today has no ${kind} item: ${kinds.join(',')}`);
        }
        assert(today.freeMinutes === 660, `free minutes with school: ${today.freeMinutes}`);
        const before = await dashboard(a, child);
        assert(
          before.tasks.total === 4 && before.tasks.done === 0,
          'dashboard does not list the tasks',
        );
        return `timetable 07:00-11:30, 4 tasks → Today: ${kinds.join(', ')}; dashboard tasks 0/4`;
      },
    },
    {
      name: '§43: the child completes tasks and a practice session; mastery and XP are recorded',
      run: async () => {
        const a = state.a!;
        const child = a.children[0]!;
        for (const taskId of state.taskIds!.slice(0, 3)) {
          await ok(
            'POST',
            `/tasks/${taskId}/complete`,
            { child: child.token },
            { clientUuid: randomUUID() },
          );
        }
        const skillId = state.topic!.skillIds[0]!;
        const session = (
          await ok(
            'POST',
            '/learning/sessions',
            { child: child.token },
            { clientUuid: randomUUID(), skillIds: [skillId], mode: 'PRACTICE', targetItems: 3 },
          )
        ).session as { id: string };
        let answered = 0;
        for (let guard = 0; guard < 10; guard++) {
          const next = await ok('GET', `/learning/sessions/${session.id}/next`, {
            child: child.token,
          });
          if (next.done) break;
          const served = next.item as { id: string; seed: number | null };
          await ok(
            'POST',
            `/learning/sessions/${session.id}/answers`,
            { child: child.token },
            {
              clientUuid: randomUUID(),
              itemId: served.id,
              response: (await solve(sql, served.id, served.seed)).correct,
              responseMs: 4000,
            },
          );
          answered++;
        }
        await ok('POST', `/learning/sessions/${session.id}/finish`, { child: child.token });
        const events = await sql<{ id: string }[]>`
          select id from ops.domain_events
          where household_id = ${a.householdId}
            and type in ('task.completed', 'task.approved', 'learning.session_finished')`;
        await drain(events.map((e) => e.id));

        const map = await ok('GET', `/students/${child.studentId}/knowledge-map?subject=math`, {
          parent: a.parent,
        });
        const node = (
          map.subjects as { nodes: { id: string; attemptCount: number; masteryScore: number }[] }[]
        )[0]!.nodes.find((n) => n.id === skillId)!;
        assert(node.attemptCount === answered, `skill has ${node.attemptCount} attempts`);
        assert(node.masteryScore > 0, 'no mastery recorded');
        const [xp] = await sql<{ lifetime: number; rewardable: number; rows: number }[]>`
          select coalesce(sum(lifetime_xp_delta), 0)::int as lifetime,
                 coalesce(sum(rewardable_xp_delta), 0)::int as rewardable,
                 count(*)::int as rows
          from app.xp_ledger where student_id = ${child.studentId}`;
        assert(xp!.rows === 4, `XP ledger rows: ${xp!.rows} (3 tasks + 1 session)`);
        assert(xp!.lifetime === 3000 + answered * 5, `lifetime XP ${xp!.lifetime}`);
        assert(
          xp!.rewardable > 0 && xp!.rewardable <= xp!.lifetime,
          `rewardable ${xp!.rewardable}`,
        );
        state.xp = xp!.lifetime;
        return `3 tasks done, ${answered} correct answers → mastery ${node.masteryScore} on the skill; XP ${xp!.lifetime} lifetime, ${xp!.rewardable} rewardable (4 ledger rows)`;
      },
    },
    {
      name: '§43: XP converts to Coin within the daily cap, and the dashboard shows it',
      run: async () => {
        const a = state.a!;
        const child = a.children[0]!;
        const before = await dashboard(a, child);
        assert(before.rewards.coinBalance === 0, 'Coin granted before the day ended');
        assert(
          before.rewards.coinsToday > 0 &&
            before.rewards.coinsToday <= before.rewards.capCoinsToday,
          `projected ${before.rewards.coinsToday} Coin, cap ${before.rewards.capCoinsToday}`,
        );
        // The day ends: a settlement request dated tomorrow (the hourly job does this for real).
        const [event] = await sql<{ id: string }[]>`
          insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
          values ('reward.settlement_requested', 'system',
                  ${sql.json({ requestedAt: new Date(Date.now() + 86_400_000).toISOString() })},
                  ${`acceptance:${randomUUID()}`})
          returning id`;
        await drain([event!.id]);
        const [snapshot] = await sql<
          { cap_coins: number; coins_total: number; rewardable_xp: number }[]
        >`
          select cap_coins, coins_total, rewardable_xp from app.daily_reward_snapshots
          where student_id = ${child.studentId} and local_day = ${TODAY}::date
          order by version desc limit 1`;
        assert(snapshot, 'the day was not settled');
        assert(
          snapshot.coins_total > 0 && snapshot.coins_total <= snapshot.cap_coins,
          `Coin ${snapshot.coins_total}, cap ${snapshot.cap_coins}`,
        );
        // 100 XP = 1 Coin, never more than the cap of the day.
        const expected = Math.min(snapshot.cap_coins, Math.floor(snapshot.rewardable_xp / 100));
        assert(
          snapshot.coins_total === expected,
          `${snapshot.rewardable_xp} rewardable XP converted to ${snapshot.coins_total} Coin under a cap of ${snapshot.cap_coins}`,
        );
        assert(
          before.rewards.coinsToday === snapshot.coins_total,
          `the dashboard projected ${before.rewards.coinsToday} Coin, the day gave ${snapshot.coins_total}`,
        );
        const after = await dashboard(a, child);
        assert(
          after.rewards.coinBalance === snapshot.coins_total,
          `balance ${after.rewards.coinBalance}`,
        );
        assert(after.rewards.coinsWeek === snapshot.coins_total, `week ${after.rewards.coinsWeek}`);
        assert(after.rewards.xpInRange === state.xp, `XP in range ${after.rewards.xpInRange}`);
        assert(
          after.tasks.done === 3 && after.tasks.total === 4,
          `tasks ${after.tasks.done}/${after.tasks.total}`,
        );
        assert(after.learning.sessions === 1 && after.learning.accuracy === 1, 'practice missing');
        assert(after.streak.days === 1, `streak ${after.streak.days}`);
        assert(after.today.itemsDone >= 3, `Today done ${after.today.itemsDone}`);
        const cards = await overview(a);
        const card = cards.find((c) => c.studentId === child.studentId)!;
        assert(card.coinBalance === snapshot.coins_total, 'the home card has no Coin');
        assert(card.streak.days === 1 && card.today.itemsDone >= 3, 'the home card is stale');
        const idle = cards.filter((c) => c.studentId !== child.studentId);
        assert(
          idle.every((c) => c.coinBalance === 0 && c.streak.days === 0),
          'a sibling shows the first child’s numbers',
        );
        return `${state.xp} XP → ${snapshot.coins_total} Coin (cap ${snapshot.cap_coins}); dashboard: tasks 3/4, 1 session at 100%, streak 1, Today ${after.today.itemsDone}/${after.today.itemsTotal}, Coin balance ${after.rewards.coinBalance}; siblings unchanged`;
      },
    },
    {
      name: 'B. A grade entry appears next to mastery, side by side and never merged',
      run: async () => {
        const a = state.a!;
        const child = a.children[0]!;
        const path = `/students/${child.studentId}/school-assessments`;
        const mastery = (d: Dashboard) => d.learning.subjects.find((s) => s.subject === 'math')!;
        const before = await dashboard(a, child);
        assert(before.sideBySide.length === 0, 'grades before any was entered');
        for (const [n, score, type] of [
          [21, 6.5, 'SHORT_QUIZ'],
          [14, 7, 'PERIODIC_TEST'],
          [7, 8, 'SHORT_QUIZ'],
          [1, 9, 'MIDTERM'],
        ] as const) {
          await ok(
            'POST',
            path,
            { parent: a.parent },
            {
              subjectCode: 'TOAN',
              assessedOn: dayBefore(n),
              type,
              score,
              skillIds: [state.topic!.skillIds[0]!],
            },
            201,
          );
        }
        const d = await dashboard(a, child);
        const toan = d.school.subjects.find((s) => s.subjectCode === 'TOAN')!;
        assert(toan.count === 4 && toan.averagePercent === 76.3, `Toán: ${JSON.stringify(toan)}`);
        assert(toan.direction === 'UP' && toan.sufficiency === 'OK', `trend ${toan.direction}`);
        const side = d.sideBySide.find((s) => s.subjectCode === 'TOAN')!;
        assert(side.librarySubject === 'math', `library subject ${side.librarySubject}`);
        assert(side.school.averagePercent === 76.3, 'school average missing beside mastery');
        assert(
          side.mastery !== null && side.mastery.practised === 1,
          'mastery missing beside the grade',
        );
        assert(
          JSON.stringify(mastery(d)) === JSON.stringify(mastery(before)),
          'entering grades changed app mastery',
        );
        assert(
          Object.keys(side).sort().join(',') === 'librarySubject,mastery,school,subjectCode',
          `side-by-side fields: ${Object.keys(side).join(',')}`,
        );
        return `Toán: 4 grades, average ${toan.averagePercent}% (${toan.direction}, ${toan.sufficiency}) beside app mastery ${side.mastery.meanScore}/100 on ${side.mastery.practised} practised skill (${side.mastery.sufficiency}); mastery unchanged by the grades`;
      },
    },
    {
      name: 'Every interpretive figure carries a data sufficiency label',
      run: async () => {
        const a = state.a!;
        const busy = await dashboard(a, a.children[0]!);
        const idle = await dashboard(a, a.children[2]!, '30d');
        for (const d of [busy, idle]) {
          const labels = [
            d.streak.sufficiency,
            d.tasks.sufficiency,
            d.learning.sufficiency,
            ...d.learning.subjects.map((s) => s.sufficiency),
            ...d.school.subjects.map((s) => s.sufficiency),
            ...d.sideBySide.flatMap((s) => [s.school.sufficiency, s.mastery?.sufficiency ?? 'OK']),
          ];
          assert(
            labels.every((l) => LABELS.includes(l)),
            `labels ${labels.join(',')}`,
          );
        }
        assert(
          idle.streak.sufficiency === 'INSUFFICIENT' && idle.tasks.sufficiency === 'INSUFFICIENT',
          'a child without activity is not labelled INSUFFICIENT',
        );
        assert(idle.learning.accuracy === null, 'accuracy invented for a child without answers');
        const cards = await overview(a);
        assert(
          cards.every((c) => c.skillsSufficiency === 'INSUFFICIENT'),
          'skill counts shown as reliable after one short session',
        );
        return `busy child: streak ${busy.streak.sufficiency}, tasks ${busy.tasks.sufficiency}, practice ${busy.learning.sufficiency}, Toán grades ${busy.school.subjects[0]!.sufficiency}; idle Grade 2 child: all INSUFFICIENT, accuracy null`;
      },
    },
    {
      name: 'Only parents edit grades; every edit is audited',
      run: async () => {
        const a = state.a!;
        const child = a.children[0]!;
        const path = `/students/${child.studentId}/school-assessments`;
        const list = await ok('GET', `${path}?limit=2`, { parent: a.parent });
        const grades = list.assessments as { id: string; score: number }[];
        assert(grades.length === 2 && list.nextCursor !== null, 'pagination did not page');
        const denied = [
          await call('GET', path, { child: child.token }),
          await call(
            'POST',
            path,
            { child: child.token },
            { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 10 },
          ),
          await call(
            'PATCH',
            `/school-assessments/${grades[0]!.id}`,
            { child: child.token },
            { score: 10 },
          ),
          await call('DELETE', `/school-assessments/${grades[0]!.id}`, { child: child.token }),
          await call('GET', `/students/${child.studentId}/dashboard`, { child: child.token }),
        ];
        assert(
          denied.every((r) => r.status === 403),
          `child calls → ${denied.map((r) => r.status).join(',')}`,
        );
        const high = await call(
          'POST',
          path,
          { parent: a.parent },
          { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 11 },
        );
        assert(high.status === 400, `11 out of 10 → ${high.status}`);
        await ok(
          'PATCH',
          `/school-assessments/${grades[0]!.id}`,
          { parent: a.parent },
          { score: 9.5 },
        );
        await ok(
          'DELETE',
          `/school-assessments/${grades[1]!.id}`,
          { parent: a.parent },
          undefined,
          204,
        );
        const audit = await sql<{ action: string; n: number }[]>`
          select action, count(*)::int as n from ops.audit_logs
          where household_id = ${a.householdId} and action like 'school_assessment.%'
          group by action order by action`;
        const counts = audit.map((r) => `${r.action.split('.')[1]} ${r.n}`).join(', ');
        assert(counts === 'created 4, deleted 1, updated 1', `audit: ${counts}`);
        return `5 child calls → 403; 11/10 → 400; parent corrected one grade and deleted one; audit: ${counts}`;
      },
    },
    {
      name: 'Another household gets 404 on every dashboard and gradebook route',
      run: async () => {
        const a = state.a!;
        const b = state.b!;
        const child = a.children[0]!;
        const [row] = await sql<{ id: string }[]>`
          select id from app.school_assessments where student_id = ${child.studentId} limit 1`;
        const base = `/students/${child.studentId}`;
        const denied = await Promise.all([
          call('GET', `${base}/dashboard`, { parent: b.parent }),
          call('GET', `${base}/school-assessments`, { parent: b.parent }),
          call(
            'POST',
            `${base}/school-assessments`,
            { parent: b.parent },
            { subjectCode: 'TOAN', assessedOn: TODAY, type: 'ORAL', score: 1 },
          ),
          call(
            'POST',
            `${base}/school-assessments/upload-sign`,
            { parent: b.parent },
            { contentType: 'image/png' },
          ),
          call('PATCH', `/school-assessments/${row!.id}`, { parent: b.parent }, { score: 0 }),
          call('DELETE', `/school-assessments/${row!.id}`, { parent: b.parent }),
        ]);
        const statuses = denied.map((r) => r.status).join(',');
        assert(statuses === Array(6).fill(404).join(','), `statuses ${statuses}`);
        const theirs = await overview(b);
        assert(
          theirs.length === 1 && theirs[0]!.studentId === b.children[0]!.studentId,
          'the other household sees foreign children in its overview',
        );
        return '6 calls with another household’s parent → 404 each; its overview lists only its own child';
      },
    },
    {
      name: 'Maestro suite on two emulators (apps/mobile/.maestro/m08-parent.yaml, m08-child.yaml)',
      run: async () => {
        throw new SkipStep(
          'needs two Android emulators with the development build (not available here)',
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
