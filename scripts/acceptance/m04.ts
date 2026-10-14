// M04 acceptance (TASK_PACKS/M04.md). Requires `pnpm db:start && pnpm fn:serve` (local only: signs
// up throwaway email parents).
//   pnpm acceptance m04
// Criteria:
//   - a Wednesday with 3,500 XP → exactly 20 Coin;
//   - a Saturday at Tier 2 → at most 40 Coin;
//   - replaying all events changes nothing;
//   - timezone boundary: a day is settled at its household's local midnight, not before.
// Past days are driven by event and request times (task days approved at a chosen instant, written
// exactly as the api writes them; settlement requests with a chosen `requestedAt`), so the scenario
// does not depend on today's weekday. Plus the live path (child completes, wallet, redemption),
// child restrictions and cross-household denial.
import { randomUUID } from 'node:crypto';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { assert, connectDb, env, SkipStep, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const sql = connectDb();

// 2026-09-23 is a Wednesday, 2026-09-26 a Saturday. Ho Chi Minh City is UTC+7.
const WED = '2026-09-23';
const SAT = '2026-09-26';

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

async function tickWorker(): Promise<void> {
  const res = await fetch(`${env.functionsUrl}/worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vionx-service-secret': env.serviceSecret },
    body: '{}',
  });
  assert(res.ok, `worker responded ${res.status}`);
  await res.body?.cancel();
}

/** Runs the worker until the events are processed (a pg_cron tick may hold some of them). */
async function drain(eventIds: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await tickWorker();
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
const scenarioEvents: string[] = [];
const state: { a?: Family; b?: Family; c?: Family } = {};

async function newFamily(label: string): Promise<Family> {
  const parent = await signUpWithEmail(
    `acceptance-m04-${label}-${randomUUID()}@vionx.test`,
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

/** A task day approved by the parent at instant `at`, written as the api writes an approval. */
async function approvedDay(
  f: Family,
  o: { date: string; xp: number; at: string; type?: string; required?: boolean },
): Promise<string> {
  const type = o.type ?? 'HOMEWORK';
  const created = await call(
    'POST',
    `/students/${f.studentId}/tasks`,
    { parent: f.parent },
    {
      type,
      title: `${type} ${o.date}`,
      startsOn: o.date,
      rewardXp: o.xp,
      required: o.required ?? true,
      verificationMode: 'PARENT_APPROVAL',
    },
  );
  assert(created.status === 201, `POST task ${created.status}`);
  const taskId = (created.body.task as { id: string }).id;
  const [occ] = await sql<{ id: string }[]>`
    select id from app.task_occurrences where assignment_id = ${taskId} and occurs_on = ${o.date}`;
  const completionId = randomUUID();
  const eventId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into app.task_completions (id, household_id, student_id, assignment_id, occurrence_id,
        client_uuid, status, completed_at, decided_at, decided_by_type)
      values (${completionId}, ${f.householdId}, ${f.studentId}, ${taskId}, ${occ!.id},
        ${randomUUID()}, 'APPROVED', ${o.at}, ${o.at}, 'parent')`;
    await tx`update app.task_occurrences set status = 'COMPLETED' where id = ${occ!.id}`;
    await tx`
      insert into ops.domain_events (id, type, household_id, aggregate_type, aggregate_id, payload,
        idempotency_key, occurred_at)
      values (${eventId}, 'task.approved', ${f.householdId}, 'task_completion', ${completionId},
        ${tx.json({
          eventName: 'TaskApproved',
          actorType: 'parent',
          studentId: f.studentId,
          taskId,
          occurrenceId: occ!.id,
          completionId,
          date: o.date,
          verificationMode: 'PARENT_APPROVAL',
          rewardXp: o.xp,
          required: o.required ?? true,
          auto: false,
        })}, ${completionId}, ${o.at})`;
  });
  scenarioEvents.push(eventId);
  return eventId;
}

async function requestSettlement(at: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
    values ('reward.settlement_requested', 'system', ${sql.json({ requestedAt: at })},
            ${`acceptance-m04:${randomUUID()}`})
    returning id`;
  scenarioEvents.push(row!.id);
  await drain([row!.id]);
}

async function coinsOn(f: Family, day: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select coalesce(sum(amount), 0)::int as n from app.coin_ledger
    where student_id = ${f.studentId} and reward_day = ${day}`;
  return row!.n;
}

async function latestSnapshot(f: Family, day: string) {
  const [row] = await sql<
    { version: number; tier: number | null; cap_coins: number; coins_total: number }[]
  >`
    select version, tier, cap_coins, coins_total from app.daily_reward_snapshots
    where student_id = ${f.studentId} and local_day = ${day} order by version desc limit 1`;
  return row ?? null;
}

async function totals(f: Family) {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from app.xp_ledger where student_id = ${f.studentId}) as xp_rows,
      (select coalesce(sum(lifetime_xp_delta), 0)::int from app.xp_ledger where student_id = ${f.studentId}) as lifetime,
      (select count(*)::int from app.coin_ledger where student_id = ${f.studentId}) as coin_rows,
      (select coalesce(sum(amount), 0)::int from app.coin_ledger where student_id = ${f.studentId}) as coins,
      (select count(*)::int from app.daily_reward_snapshots where student_id = ${f.studentId}) as snapshots,
      (select count(*)::int from ops.domain_events
        where household_id = ${f.householdId} and type in ('xp.granted', 'coin.granted')) as events`;
  return row!;
}

export const scenario: Scenario = {
  name: 'M04 — Reward engine',
  steps: [
    {
      name: 'Two families (Ho Chi Minh City) and one in UTC sign up',
      run: async () => {
        state.a = await newFamily('A');
        state.b = await newFamily('B');
        state.c = await newFamily('C');
        await sql`update app.households set timezone = 'UTC' where id = ${state.c.householdId}`;
        return 'households, children, consents and child sessions ready';
      },
    },
    {
      name: 'Wednesday with 3,500 XP → exactly 20 Coin',
      run: async () => {
        const a = state.a!;
        for (const xp of [1000, 1000, 1000, 500]) {
          await drain([await approvedDay(a, { date: WED, xp, at: '2026-09-23T12:00:00Z' })]);
        }
        const [xp] = await sql<{ lifetime: number; rewardable: number }[]>`
          select sum(lifetime_xp_delta)::int as lifetime, sum(rewardable_xp_delta)::int as rewardable
          from app.xp_ledger where student_id = ${a.studentId} and reward_day = ${WED}`;
        assert(xp!.lifetime === 3500, `lifetime XP ${xp!.lifetime}`);
        await requestSettlement('2026-09-23T17:05:00Z');
        const coins = await coinsOn(a, WED);
        assert(coins === 20, `Wednesday converted to ${coins} Coin`);
        return `3,500 XP (rewardable ${xp!.rewardable}, the rest lifetime only) → ${coins} Coin`;
      },
    },
    {
      name: 'Saturday at Tier 2 → at most 40 Coin',
      run: async () => {
        const a = state.a!;
        for (const [type, required] of [
          ['HOMEWORK', true],
          ['HOMEWORK', true],
          ['HOMEWORK', true],
          ['READING', true],
          ['SPORT', true],
          ['ENGLISH', true],
        ] as const) {
          await drain([
            await approvedDay(a, {
              date: SAT,
              xp: 1000,
              at: '2026-09-26T10:00:00Z',
              type,
              required,
            }),
          ]);
        }
        await requestSettlement('2026-09-26T17:05:00Z');
        const snap = await latestSnapshot(a, SAT);
        const coins = await coinsOn(a, SAT);
        assert(snap?.tier === 2, `tier ${snap?.tier}`);
        assert(coins === 40 && coins <= 40, `Saturday converted to ${coins} Coin`);
        return `6,000 XP, all required learning + reading + activity → Tier 2, ${coins} Coin (cap ${snap.cap_coins})`;
      },
    },
    {
      name: 'Timezone boundary: settled at each household’s local midnight',
      run: async () => {
        const a = state.a!;
        const c = state.c!;
        const tue = '2026-09-22';
        await drain([await approvedDay(a, { date: tue, xp: 700, at: '2026-09-22T05:00:00Z' })]);
        await drain([await approvedDay(c, { date: tue, xp: 700, at: '2026-09-22T05:00:00Z' })]);
        await requestSettlement('2026-09-22T16:59:59Z'); // 23:59:59 in Ho Chi Minh City
        assert((await coinsOn(a, tue)) === 0, 'Tuesday settled before local midnight');
        await requestSettlement('2026-09-22T17:00:01Z'); // 00:00:01 in Ho Chi Minh City
        assert((await coinsOn(a, tue)) === 7, 'Tuesday not settled after local midnight');
        assert((await coinsOn(c, tue)) === 0, 'the UTC household was settled at 17:00 UTC');
        await requestSettlement('2026-09-23T00:00:01Z');
        assert((await coinsOn(c, tue)) === 7, 'the UTC household not settled at its midnight');
        return 'Asia/Ho_Chi_Minh settles at 17:00 UTC, the UTC household at 00:00 UTC';
      },
    },
    {
      name: 'Replaying all events changes nothing',
      run: async () => {
        const families = [state.a!, state.c!];
        const before = await Promise.all(families.map(totals));
        await sql`delete from ops.processed_events
          where consumer = 'worker' and event_id = any(${scenarioEvents}::uuid[])`;
        await sql`
          select pgmq.send('events', jsonb_build_object('event_id', id, 'type', type,
            'household_id', household_id, 'occurred_at', occurred_at))
          from ops.domain_events where id = any(${scenarioEvents}::uuid[])`;
        await drain(scenarioEvents);
        const after = await Promise.all(families.map(totals));
        assert(
          JSON.stringify(after) === JSON.stringify(before),
          `changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
        );
        return `${scenarioEvents.length} events replayed (grants and settlements); ledgers, snapshots and reward events unchanged`;
      },
    },
    {
      name: 'Live path: child completes a task, sees the wallet, redeems; parent approves',
      run: async () => {
        const a = state.a!;
        const task = await call(
          'POST',
          `/students/${a.studentId}/tasks`,
          { parent: a.parent },
          { type: 'READING', title: 'Đọc 20 phút', rewardXp: 20, verificationMode: 'SELF_CHECK' },
        );
        assert(task.status === 201, `task ${task.status}`);
        const before = await call('GET', `/students/${a.studentId}/rewards/wallet`, {
          child: a.child,
        });
        const done = await call(
          'POST',
          `/tasks/${(task.body.task as { id: string }).id}/complete`,
          { child: a.child },
          { clientUuid: randomUUID() },
        );
        assert(done.status === 200, `complete ${done.status}`);
        const completionId = (done.body.occurrence as { completion: { id: string } }).completion.id;
        const ids = (
          await sql<
            { id: string }[]
          >`select id from ops.domain_events where aggregate_id = ${completionId}`
        ).map((r) => r.id);
        await drain(ids);
        const after = await call('GET', `/students/${a.studentId}/rewards/wallet`, {
          child: a.child,
        });
        const xpGain = (after.body.lifetimeXp as number) - (before.body.lifetimeXp as number);
        assert(xpGain === 20, `wallet XP +${xpGain}`);
        const item = await call(
          'POST',
          '/household/reward-catalog',
          { parent: a.parent },
          { title: '30 phút chơi game', costCoins: 30, icon: 'game' },
        );
        assert(item.status === 201, `catalog ${item.status}`);
        const itemId = (item.body.item as { id: string }).id;
        const clientUuid = randomUUID();
        const asked = await call(
          'POST',
          '/reward-redemptions',
          { child: a.child },
          { clientUuid, itemId },
        );
        const again = await call(
          'POST',
          '/reward-redemptions',
          { child: a.child },
          { clientUuid, itemId },
        );
        assert(asked.status === 200 && again.body.replayed === true, 'redemption not idempotent');
        const redemptionId = (asked.body.redemption as { id: string }).id;
        const ok = await call(
          'POST',
          `/reward-redemptions/${redemptionId}/approve`,
          { parent: a.parent },
          {},
        );
        assert(ok.status === 200, `approve ${ok.status}`);
        const [redeemed] = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.domain_events
          where type = 'reward.redeemed' and aggregate_id = ${redemptionId}`;
        assert(redeemed!.n === 1, `RewardRedeemed events: ${redeemed!.n}`);
        const wallet = await call('GET', `/students/${a.studentId}/rewards/wallet`, {
          parent: a.parent,
        });
        const cap = wallet.body.todayCap as { capCoins: number; rewardableXp: number };
        return `XP +20 (level ${(wallet.body.level as { level: number }).level}), today's cap bar ${cap.rewardableXp} XP / ${cap.capCoins} Coin; 30 Coin redeemed once → balance ${wallet.body.coinBalance as number}`;
      },
    },
    {
      name: 'Children cannot edit rules or the catalog or approve; other households get 404',
      run: async () => {
        const a = state.a!;
        const b = state.b!;
        const item = await call(
          'POST',
          '/household/reward-catalog',
          { parent: a.parent },
          { title: 'Kem', costCoins: 1 },
        );
        const itemId = (item.body.item as { id: string }).id;
        const asked = await call(
          'POST',
          '/reward-redemptions',
          { child: a.child },
          { clientUuid: randomUUID(), itemId },
        );
        const redemptionId = (asked.body.redemption as { id: string }).id;
        const forbidden = [
          await call(
            'PATCH',
            '/household/reward-rules',
            { child: a.child },
            { weekdayCapCoins: 5 },
          ),
          await call(
            'POST',
            '/household/reward-catalog',
            { child: a.child },
            { title: 'x', costCoins: 1 },
          ),
          await call(
            'PATCH',
            `/household/reward-catalog/${itemId}`,
            { child: a.child },
            { costCoins: 2 },
          ),
          await call('POST', `/reward-redemptions/${redemptionId}/approve`, { child: a.child }, {}),
        ].map((r) => r.status);
        assert(
          forbidden.every((s) => s === 403),
          `child answers ${forbidden.join(',')}`,
        );
        const raised = await call(
          'PATCH',
          '/household/reward-rules',
          { parent: a.parent },
          { weekdayCapCoins: 30 },
        );
        assert(raised.status === 400, `raising a cap answered ${raised.status}`);
        const lowered = await call(
          'PATCH',
          '/household/reward-rules',
          { parent: a.parent },
          { weekdayCapCoins: 15 },
        );
        assert(lowered.status === 200, `lowering a cap answered ${lowered.status}`);
        const denied = [
          await call('GET', `/students/${a.studentId}/rewards/wallet`, { parent: b.parent }),
          await call('GET', `/students/${a.studentId}/rewards/ledger`, { child: b.child }),
          await call(
            'PATCH',
            `/household/reward-catalog/${itemId}`,
            { parent: b.parent },
            { costCoins: 9 },
          ),
          await call(
            'POST',
            `/reward-redemptions/${redemptionId}/approve`,
            { parent: b.parent },
            {},
          ),
          await call(
            'POST',
            '/reward-redemptions',
            { child: b.child },
            { clientUuid: randomUUID(), itemId },
          ),
        ].map((r) => r.status);
        assert(
          denied.every((s) => s === 404),
          `other household answers ${denied.join(',')}`,
        );
        return 'child 403 ×4; cap raise 400, lower 200; other household 404 ×5';
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m04-rewards.yaml',
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
