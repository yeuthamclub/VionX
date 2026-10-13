// M04 reward engine against local Supabase (`pnpm db:start && pnpm fn:serve`).
// Grants from task events, day-end settlement per household timezone (driven by event and request
// times, so the past days below are deterministic), redemptions, rules, catalog, replay
// idempotency, cross-household denial (404) and child restrictions (403).
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogItemResponseSchema,
  CatalogResponseSchema,
  LedgerResponseSchema,
  PoliciesResponseSchema,
  RedemptionCreateResponseSchema,
  RedemptionsResponseSchema,
  RewardRulesResponseSchema,
  StudentCreateResponseSchema,
  TaskResponseSchema,
  WalletSchema,
} from '@vionx/contracts';
import {
  addDays,
  DEFAULT_REWARD_RULES,
  householdToday,
  SYSTEM_CAPS,
  systemCapRows,
} from '@vionx/domain';
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

// Past days used for the time-driven scenarios (2026-09-30 is a Wednesday).
const WED = '2026-09-30';
const SAT = '2026-10-03';

type Auth = { parent?: AuthSession; child?: string };

// See calendar.test.ts: the local Edge Runtime answers a request sent to a retiring isolate with
// its own 500 (no requestId); retry that once.
function isRuntimeRetirement(status: number, body: unknown): boolean {
  return (
    status === 500 &&
    typeof body === 'object' &&
    body !== null &&
    !('requestId' in body) &&
    (body as { message?: unknown }).message === 'Request failed due to an internal server error'
  );
}

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
    if (attempt === 1 && isRuntimeRetirement(res.status, parsed)) continue;
    return { status: res.status, body: parsed };
  }
}

async function tickWorker() {
  const res = await fetch(`${FUNCTIONS_URL}/worker`, {
    method: 'POST',
    headers: { 'x-vionx-service-secret': SERVICE_SECRET, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  await res.body?.cancel();
}

/**
 * Runs the worker until every given event is processed (pg_cron may run a worker tick at the same
 * time and hold some messages; wait for it).
 */
async function drain(eventIds: string[]) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await tickWorker();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events
      where consumer = 'worker' and event_id = any(${eventIds}::uuid[])`;
    if (row!.n === eventIds.length) return;
    if (Date.now() > deadline)
      throw new Error(`events not processed: ${row!.n}/${eventIds.length}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function eventIdsFor(aggregateIds: string[]) {
  const rows = await sql<{ id: string }[]>`
    select id from ops.domain_events where aggregate_id = any(${aggregateIds}::uuid[])`;
  return rows.map((r) => r.id);
}

let policyVersion = 1;
const createdUsers: string[] = [];
const familyEventIds: string[] = [];

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

async function newTask(f: Family, task: Record<string, unknown>) {
  const res = await api(
    'POST',
    `/students/${f.studentId}/tasks`,
    { parent: f.parent },
    { type: 'HOMEWORK', title: 'Bài tập', verificationMode: 'SELF_CHECK', ...task },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return TaskResponseSchema.parse(res.body).task;
}

/**
 * A task day approved at `at` (instant): the rows and the `task.approved` outbox event exactly as
 * the api writes them on approval, but at a chosen time. Returns the event id.
 */
async function approvedDay(
  f: Family,
  o: {
    date: string;
    xp: number;
    at: string;
    type?: string;
    required?: boolean;
    mode?: string;
  },
): Promise<string> {
  const task = await newTask(f, {
    type: o.type ?? 'HOMEWORK',
    title: `${o.type ?? 'HOMEWORK'} ${o.date}`,
    startsOn: o.date,
    rewardXp: o.xp,
    required: o.required ?? true,
    verificationMode: o.mode ?? 'PARENT_APPROVAL',
  });
  const [occ] = await sql<{ id: string }[]>`
    select id from app.task_occurrences where assignment_id = ${task.id} and occurs_on = ${o.date}`;
  const completionId = randomUUID();
  const eventId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      insert into app.task_completions (id, household_id, student_id, assignment_id, occurrence_id,
        client_uuid, status, completed_at, decided_at, decided_by_type)
      values (${completionId}, ${f.householdId}, ${f.studentId}, ${task.id}, ${occ!.id},
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
          taskId: task.id,
          occurrenceId: occ!.id,
          completionId,
          date: o.date,
          verificationMode: o.mode ?? 'PARENT_APPROVAL',
          rewardXp: o.xp,
          required: o.required ?? true,
          auto: false,
        })}, ${completionId}, ${o.at})`;
  });
  familyEventIds.push(eventId);
  return eventId;
}

async function requestSettlement(at: string) {
  const [row] = await sql<{ id: string }[]>`
    insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
    values ('reward.settlement_requested', 'system', ${sql.json({ requestedAt: at })},
            ${`it:${randomUUID()}`})
    returning id`;
  familyEventIds.push(row!.id);
  await drain([row!.id]);
}

async function snapshots(f: Family, day: string) {
  return sql<
    {
      version: number;
      tier: number | null;
      cap_coins: number;
      coins_total: number;
      coins_granted: number;
    }[]
  >`
    select version, tier, cap_coins, coins_total, coins_granted from app.daily_reward_snapshots
    where student_id = ${f.studentId} and local_day = ${day} order by version`;
}

async function coinsOn(f: Family, day: string) {
  const [row] = await sql<{ n: number }[]>`
    select coalesce(sum(amount), 0)::int as n from app.coin_ledger
    where student_id = ${f.studentId} and reward_day = ${day}`;
  return row!.n;
}

async function ledgerTotals(f: Family) {
  const [row] = await sql<
    {
      xp: number;
      lifetime: number;
      coins: number;
      xp_rows: number;
      coin_rows: number;
      snaps: number;
    }[]
  >`
    select
      (select coalesce(sum(rewardable_xp_delta), 0)::int from app.xp_ledger where student_id = ${f.studentId}) as xp,
      (select coalesce(sum(lifetime_xp_delta), 0)::int from app.xp_ledger where student_id = ${f.studentId}) as lifetime,
      (select coalesce(sum(amount), 0)::int from app.coin_ledger where student_id = ${f.studentId}) as coins,
      (select count(*)::int from app.xp_ledger where student_id = ${f.studentId}) as xp_rows,
      (select count(*)::int from app.coin_ledger where student_id = ${f.studentId}) as coin_rows,
      (select count(*)::int from app.daily_reward_snapshots where student_id = ${f.studentId}) as snaps`;
  return row!;
}

const wallet = async (f: Family, auth: Auth = { parent: f.parent }) => {
  const res = await api('GET', `/students/${f.studentId}/rewards/wallet`, auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return WalletSchema.parse(res.body);
};

let a: Family;
let b: Family;
let c: Family;

beforeAll(async () => {
  const res = await api('GET', '/policies/current');
  policyVersion = PoliciesResponseSchema.parse(res.body).policies.find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  // One family after the other (see calendar.test.ts).
  a = await newFamily('Thưởng A');
  b = await newFamily('Thưởng B');
  c = await newFamily('Thưởng C');
  await sql`update app.households set timezone = 'UTC' where id = ${c.householdId}`;
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

describe('schema', () => {
  it('stores the system caps and default rules of @vionx/domain', async () => {
    const rows = await sql<
      { key: string; value: number }[]
    >`select key, value from app.system_caps`;
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual(
      systemCapRows(SYSTEM_CAPS),
    );
    const [rules] = await sql<{ config: unknown }[]>`
      select config from app.reward_rules where household_id is null and version = 1`;
    expect(rules!.config).toEqual(DEFAULT_REWARD_RULES);
    const registry = await sql<{ table_name: string }[]>`
      select table_name from ops.ledger_registry where table_name in ('app.xp_ledger', 'app.coin_ledger')`;
    expect(registry).toHaveLength(2);
  });

  it('ledgers are append-only and grant once per (source_type, source_id, rule_id)', async () => {
    const source = randomUUID();
    const insert = (key: string) => sql`
      insert into app.xp_ledger (household_id, student_id, reward_day, lifetime_xp_delta,
        rewardable_xp_delta, source_type, source_id, rule_id, idempotency_key)
      values (${b.householdId}, ${b.studentId}, '2026-01-05', 10, 10, 'task_completion', ${source},
        'TASK_APPROVED', ${key})
      returning id`;
    const [entry] = await insert(`it:${source}`);
    await expect(insert(`it:${source}:again`)).rejects.toThrow(/duplicate key/);
    await expect(
      sql`update app.xp_ledger set lifetime_xp_delta = 0 where id = ${entry!.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`delete from app.xp_ledger where id = ${entry!.id}`).rejects.toThrow(
      /append-only/,
    );
    // A correction is a reversal entry; only one per entry.
    const reverse = (key: string) => sql`
      insert into app.xp_ledger (household_id, student_id, reward_day, lifetime_xp_delta,
        rewardable_xp_delta, source_type, source_id, rule_id, idempotency_key, reversal_of)
      values (${b.householdId}, ${b.studentId}, '2026-01-05', -10, -10, 'reversal', ${entry!.id},
        'TASK_APPROVED', ${key}, ${entry!.id})`;
    await reverse(`it:${source}:rev`);
    await expect(reverse(`it:${source}:rev2`)).rejects.toThrow(/duplicate key/);
    const [sum] = await sql<{ n: number }[]>`
      select sum(lifetime_xp_delta)::int as n from app.xp_ledger where source_id in (${source}, ${entry!.id})`;
    expect(sum!.n).toBe(0);
  });
});

describe('grants from task events', () => {
  it('a SELF_CHECK task day grants its XP once (TaskCompleted + TaskApproved)', async () => {
    const before = await wallet(a);
    const task = await newTask(a, { title: 'Đọc sách', type: 'READING', rewardXp: 30 });
    const done = await api(
      'POST',
      `/tasks/${task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    expect(done.status).toBe(200);
    const completionId = done.body.occurrence.completion.id as string;
    await drain(await eventIdsFor([completionId]));
    const entries = await sql<{ id: string; lifetime_xp_delta: number }[]>`
      select id, lifetime_xp_delta from app.xp_ledger where source_id = ${completionId}`;
    expect(entries).toHaveLength(1);
    const granted = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from ops.domain_events where type = 'xp.granted' and aggregate_id = ${entries[0]!.id}`;
    expect(granted).toHaveLength(1);
    expect(granted[0]!.payload).toMatchObject({
      eventName: 'XpGranted',
      lifetimeXp: 30,
      rewardableXp: 30,
    });
    const after = await wallet(a, { child: a.child });
    expect(after.lifetimeXp - before.lifetimeXp).toBe(30);
    expect(after.todayCap.rewardableXp - before.todayCap.rewardableXp).toBe(30);
    expect(after.today).toBe(today());
    const ledger = LedgerResponseSchema.parse(
      (
        await api('GET', `/students/${a.studentId}/rewards/ledger?kind=xp&limit=1`, {
          child: a.child,
        })
      ).body,
    );
    expect(ledger.entries[0]).toMatchObject({
      entryKind: 'GRANT',
      lifetimeXpDelta: 30,
      label: 'Đọc sách',
    });
  });

  it('parent approval grants XP; rejection grants nothing', async () => {
    const task = await newTask(a, {
      title: 'Bài Toán',
      rewardXp: 40,
      verificationMode: 'PARENT_APPROVAL',
    });
    const done = await api(
      'POST',
      `/tasks/${task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    const first = done.body.occurrence.completion.id as string;
    expect(
      (await api('POST', `/tasks/${task.id}/reject`, { parent: a.parent }, { date: today() }))
        .status,
    ).toBe(200);
    await drain(await eventIdsFor([first]));
    expect(await sql`select 1 from app.xp_ledger where source_id = ${first}`).toHaveLength(0);
    const again = await api(
      'POST',
      `/tasks/${task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID() },
    );
    const second = again.body.occurrence.completion.id as string;
    expect(
      (await api('POST', `/tasks/${task.id}/approve`, { parent: a.parent }, { date: today() }))
        .status,
    ).toBe(200);
    await drain(await eventIdsFor([second]));
    const [entry] = await sql<{ lifetime_xp_delta: number }[]>`
      select lifetime_xp_delta from app.xp_ledger where source_id = ${second}`;
    expect(entry!.lifetime_xp_delta).toBe(40);
  });

  it("yesterday's task approved today is settled at once (late-grant window)", async () => {
    const yesterday = addDays(today(), -1);
    const before = await wallet(a);
    const task = await newTask(a, { title: 'Hôm qua', startsOn: yesterday, rewardXp: 1000 });
    const done = await api(
      'POST',
      `/tasks/${task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID(), date: yesterday },
    );
    expect(done.status).toBe(200);
    await drain(await eventIdsFor([done.body.occurrence.completion.id as string]));
    const after = await wallet(a);
    expect(after.coinBalance - before.coinBalance).toBe(10);
    expect(after.lastSettled).toMatchObject({ day: yesterday, coinsTotal: 10 });
    const coins = LedgerResponseSchema.parse(
      (await api('GET', `/students/${a.studentId}/rewards/ledger?kind=coin`, { parent: a.parent }))
        .body,
    );
    expect(coins.entries[0]).toMatchObject({
      entryKind: 'DAY_CONVERSION',
      coinDelta: 10,
      rewardDay: yesterday,
    });
    const [event] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from ops.domain_events where type = 'coin.granted' and aggregate_id = ${coins.entries[0]!.id}`;
    expect(event!.payload).toMatchObject({ eventName: 'CoinGranted', coins: 10 });
  });

  it('a task day older than the late-grant window gives lifetime XP only', async () => {
    const old = addDays(today(), -5);
    const task = await newTask(a, { title: 'Cũ', startsOn: old, rewardXp: 500 });
    const done = await api(
      'POST',
      `/tasks/${task.id}/complete`,
      { child: a.child },
      { clientUuid: randomUUID(), date: old },
    );
    expect(done.status).toBe(200);
    const completionId = done.body.occurrence.completion.id as string;
    await drain(await eventIdsFor([completionId]));
    const [entry] = await sql<
      { lifetime_xp_delta: number; rewardable_xp_delta: number; capped_reason: string }[]
    >`
      select lifetime_xp_delta, rewardable_xp_delta, capped_reason from app.xp_ledger where source_id = ${completionId}`;
    expect(entry).toEqual({
      lifetime_xp_delta: 500,
      rewardable_xp_delta: 0,
      capped_reason: 'LATE',
    });
  });
});

describe('day-end settlement (Master Spec §14.2)', () => {
  it('a Wednesday with 3,500 XP gives exactly 20 Coin, at household-local midnight', async () => {
    for (const xp of [1000, 1000, 1000, 500]) {
      await drain([await approvedDay(a, { date: WED, xp, at: '2026-09-30T13:00:00Z' })]);
    }
    const xp = await sql<{ lifetime: number; rewardable: number; capped: number }[]>`
      select sum(lifetime_xp_delta)::int as lifetime, sum(rewardable_xp_delta)::int as rewardable,
             count(*) filter (where capped_reason = 'DAILY_XP_CAP')::int as capped
      from app.xp_ledger where student_id = ${a.studentId} and reward_day = ${WED}`;
    expect(xp[0]).toEqual({ lifetime: 3500, rewardable: 2000, capped: 2 });
    // 23:59:59 in Ho Chi Minh City: Wednesday has not ended.
    await requestSettlement('2026-09-30T16:59:59Z');
    expect(await snapshots(a, WED)).toHaveLength(0);
    await requestSettlement('2026-09-30T17:00:30Z');
    expect(await snapshots(a, WED)).toEqual([
      { version: 1, tier: null, cap_coins: 20, coins_total: 20, coins_granted: 20 },
    ]);
    expect(await coinsOn(a, WED)).toBe(20);
    // Again: nothing changes.
    await requestSettlement('2026-09-30T18:00:00Z');
    expect(await snapshots(a, WED)).toHaveLength(1);
    expect(await coinsOn(a, WED)).toBe(20);
  });

  it('settles each household at its own midnight (timezone boundary)', async () => {
    await drain([await approvedDay(c, { date: WED, xp: 500, at: '2026-09-30T12:00:00Z' })]);
    // 17:30 UTC: Wednesday is over in Ho Chi Minh City, not in a UTC household.
    await requestSettlement('2026-09-30T17:30:00Z');
    expect(await snapshots(c, WED)).toHaveLength(0);
    await requestSettlement('2026-09-30T23:59:59Z');
    expect(await snapshots(c, WED)).toHaveLength(0);
    await requestSettlement('2026-10-01T00:00:30Z');
    expect(await coinsOn(c, WED)).toBe(5);
    const w = await wallet(c, { child: c.child });
    expect(w.timezone).toBe('UTC');
  });

  it('a Saturday at Tier 2 gives at most 40 Coin; a later bonus reaches Tier 3', async () => {
    const at = '2026-10-03T11:00:00Z';
    for (const [type, required] of [
      ['HOMEWORK', true],
      ['HOMEWORK', true],
      ['HOMEWORK', true],
      ['READING', true],
      ['SPORT', true],
    ] as const) {
      await drain([await approvedDay(a, { date: SAT, xp: 1000, at, type, required })]);
    }
    await requestSettlement('2026-10-03T17:00:30Z');
    expect(await snapshots(a, SAT)).toEqual([
      { version: 1, tier: 2, cap_coins: 40, coins_total: 40, coins_granted: 40 },
    ]);
    // Sunday morning a parent approves Saturday's family mission (optional, parent-approved).
    await drain([
      await approvedDay(a, {
        date: SAT,
        xp: 100,
        at: '2026-10-04T02:00:00Z',
        type: 'HOUSEHOLD',
        required: false,
      }),
    ]);
    expect(await snapshots(a, SAT)).toEqual([
      { version: 1, tier: 2, cap_coins: 40, coins_total: 40, coins_granted: 40 },
      { version: 2, tier: 3, cap_coins: 50, coins_total: 50, coins_granted: 10 },
    ]);
    expect(await coinsOn(a, SAT)).toBe(50);
  });

  it('replaying every event changes nothing', async () => {
    const before = await Promise.all([a, c].map(ledgerTotals));
    // Forget that the worker saw them, re-enqueue them all, and run the worker again.
    await sql`delete from ops.processed_events where consumer = 'worker' and event_id = any(${familyEventIds}::uuid[])`;
    await sql`
      select pgmq.send('events', jsonb_build_object('event_id', id, 'type', type,
        'household_id', household_id, 'occurred_at', occurred_at))
      from ops.domain_events where id = any(${familyEventIds}::uuid[])`;
    await drain(familyEventIds);
    expect(await Promise.all([a, c].map(ledgerTotals))).toEqual(before);
  });
});

describe('rules', () => {
  it('parents may lower caps, never raise them; children cannot change rules', async () => {
    const got = RewardRulesResponseSchema.parse(
      (await api('GET', '/household/reward-rules', { parent: b.parent })).body,
    );
    expect(got).toMatchObject({ version: 0, custom: false, rules: DEFAULT_REWARD_RULES });
    expect(got.systemCaps.weekendTierCaps).toEqual([20, 30, 40, 50]);
    const raised = await api(
      'PATCH',
      '/household/reward-rules',
      { parent: b.parent },
      { weekdayCapCoins: 25 },
    );
    expect(raised.status).toBe(400);
    expect(raised.body.details.violations[0]).toMatchObject({
      field: 'weekdayCapCoins',
      error: 'ABOVE_SYSTEM_CAP',
    });
    const descending = await api(
      'PATCH',
      '/household/reward-rules',
      { parent: b.parent },
      { weekendTierCaps: [20, 10, 40, 50] },
    );
    expect(descending.status).toBe(400);
    const lowered = await api(
      'PATCH',
      '/household/reward-rules',
      { parent: b.parent },
      {
        weekdayCapCoins: 10,
        weekendGoals: { readingTasks: 2 },
      },
    );
    expect(lowered.status).toBe(200);
    expect(lowered.body).toMatchObject({
      version: 1,
      custom: true,
      rules: { weekdayCapCoins: 10, weekendGoals: { readingTasks: 2, activityTasks: 1 } },
    });
    const second = await api(
      'PATCH',
      '/household/reward-rules',
      { parent: b.parent },
      { weekdayCapCoins: 15 },
    );
    expect(second.body.version).toBe(2);
    expect((await api('GET', '/household/reward-rules', { child: b.child })).status).toBe(403);
    expect(
      (await api('PATCH', '/household/reward-rules', { child: b.child }, { weekdayCapCoins: 1 }))
        .status,
    ).toBe(403);
    expect((await api('GET', '/household/reward-rules')).status).toBe(401);
    const audits =
      await sql`select 1 from ops.audit_logs where action = 'reward.rules_updated' and household_id = ${b.householdId}`;
    expect(audits).toHaveLength(2);
    // The wallet's cap bar follows the household's rules.
    const w = await wallet(b, { child: b.child });
    if (!w.todayCap.weekend) expect(w.todayCap.capCoins).toBe(15);
  });
});

describe('catalog and redemptions', () => {
  let itemId: string;
  let expensiveId: string;

  it('parents manage the catalog; children see active items only and cannot edit', async () => {
    const created = await api(
      'POST',
      '/household/reward-catalog',
      { parent: a.parent },
      { title: '30 phút xem hoạt hình', costCoins: 5, icon: 'screen' },
    );
    expect(created.status).toBe(201);
    itemId = CatalogItemResponseSchema.parse(created.body).item.id;
    const expensive = await api(
      'POST',
      '/household/reward-catalog',
      { parent: a.parent },
      { title: 'Đi công viên', costCoins: 5000 },
    );
    expensiveId = expensive.body.item.id;
    const archived = await api(
      'POST',
      '/household/reward-catalog',
      { parent: a.parent },
      { title: 'Cũ', costCoins: 1 },
    );
    expect(
      (
        await api('DELETE', `/household/reward-catalog/${archived.body.item.id}`, {
          parent: a.parent,
        })
      ).status,
    ).toBe(204);
    const patched = await api(
      'PATCH',
      `/household/reward-catalog/${itemId}`,
      { parent: a.parent },
      { description: 'Cuối tuần' },
    );
    expect(patched.body.item).toMatchObject({
      description: 'Cuối tuần',
      costCoins: 5,
      icon: 'screen',
    });
    const childView = CatalogResponseSchema.parse(
      (await api('GET', '/household/reward-catalog', { child: a.child })).body,
    );
    expect(childView.items.map((i) => i.title).sort()).toEqual([
      '30 phút xem hoạt hình',
      'Đi công viên',
    ]);
    expect(childView.coinNominalVnd).toBe(1000);
    const parentView = CatalogResponseSchema.parse(
      (await api('GET', '/household/reward-catalog?includeArchived=true', { parent: a.parent }))
        .body,
    );
    expect(parentView.items).toHaveLength(3);
    expect(
      (
        await api(
          'POST',
          '/household/reward-catalog',
          { child: a.child },
          { title: 'x', costCoins: 1 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'PATCH',
          `/household/reward-catalog/${itemId}`,
          { child: a.child },
          { costCoins: 1 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'POST',
          '/household/reward-catalog',
          { parent: a.parent },
          { title: 'x', costCoins: 0 },
        )
      ).status,
    ).toBe(400);
  });

  it('a child redeems with held Coin; approve spends it, reject returns it by reversal', async () => {
    const start = await wallet(a);
    expect(start.coinBalance).toBeGreaterThanOrEqual(10);
    const poor = await api(
      'POST',
      '/reward-redemptions',
      { child: a.child },
      { clientUuid: randomUUID(), itemId: expensiveId },
    );
    expect(poor.status).toBe(409);
    expect(poor.body.details.reason).toBe('INSUFFICIENT_COINS');

    const clientUuid = randomUUID();
    const [first, retry] = await Promise.all([
      api('POST', '/reward-redemptions', { child: a.child }, { clientUuid, itemId }),
      api('POST', '/reward-redemptions', { child: a.child }, { clientUuid, itemId }),
    ]);
    expect([first.status, retry.status]).toEqual([200, 200]);
    const one = RedemptionCreateResponseSchema.parse(first.body);
    expect([first.body.replayed, retry.body.replayed].sort()).toEqual([false, true]);
    expect(
      await sql`select 1 from app.reward_redemptions where client_uuid = ${clientUuid}`,
    ).toHaveLength(1);
    const held = await wallet(a, { child: a.child });
    expect(held.coinBalance).toBe(start.coinBalance - 5);
    expect(held.coinsHeld).toBe(5);
    expect(
      (
        await api(
          'POST',
          '/reward-redemptions',
          { child: a.child },
          { clientUuid, itemId: expensiveId },
        )
      ).status,
    ).toBe(409);

    const inbox = RedemptionsResponseSchema.parse(
      (await api('GET', '/reward-redemptions?status=PENDING', { parent: a.parent })).body,
    );
    expect(inbox.pendingCount).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      id: one.redemption.id,
      studentName: 'Thưởng A con',
      costCoins: 5,
    });
    expect(
      (
        await api(
          'POST',
          `/reward-redemptions/${one.redemption.id}/approve`,
          { child: a.child },
          {},
        )
      ).status,
    ).toBe(403);
    const approved = await api(
      'POST',
      `/reward-redemptions/${one.redemption.id}/approve`,
      { parent: a.parent },
      {},
    );
    expect(approved.status).toBe(200);
    expect(approved.body.redemption.status).toBe('APPROVED');
    expect(
      (
        await api(
          'POST',
          `/reward-redemptions/${one.redemption.id}/reject`,
          { parent: a.parent },
          {},
        )
      ).status,
    ).toBe(409);
    const redeemed = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from ops.domain_events where type = 'reward.redeemed' and aggregate_id = ${one.redemption.id}`;
    expect(redeemed).toHaveLength(1);
    expect(redeemed[0]!.payload).toMatchObject({ eventName: 'RewardRedeemed', costCoins: 5 });
    const spent = await wallet(a);
    expect([spent.coinBalance, spent.coinsHeld]).toEqual([start.coinBalance - 5, 0]);

    const second = await api(
      'POST',
      '/reward-redemptions',
      { child: a.child },
      { clientUuid: randomUUID(), itemId },
    );
    const rejected = await api(
      'POST',
      `/reward-redemptions/${second.body.redemption.id}/reject`,
      { parent: a.parent },
      { note: 'Tuần sau nhé' },
    );
    expect(rejected.body.redemption).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Tuần sau nhé',
    });
    const back = await wallet(a);
    expect(back.coinBalance).toBe(start.coinBalance - 5);
    const coins = LedgerResponseSchema.parse(
      (
        await api('GET', `/students/${a.studentId}/rewards/ledger?kind=coin&limit=2`, {
          child: a.child,
        })
      ).body,
    );
    expect(coins.entries.map((e) => [e.entryKind, e.coinDelta, e.label])).toEqual([
      ['REVERSAL', 5, '30 phút xem hoạt hình'],
      ['REDEMPTION_HOLD', -5, '30 phút xem hoạt hình'],
    ]);
    expect(coins.nextCursor).not.toBeNull();
    const next = await api(
      'GET',
      `/students/${a.studentId}/rewards/ledger?kind=coin&limit=2&cursor=${coins.nextCursor}`,
      { child: a.child },
    );
    expect(next.status).toBe(200);
    expect(next.body.entries[0].id).not.toBe(coins.entries[1]!.id);
    const pushes = await sql`
      select 1 from ops.domain_events where type = 'notification.push_requested'
        and household_id = ${a.householdId} and payload->>'kind' = 'reward.redemption_requested'`;
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    // An archived item cannot be redeemed.
    await api('DELETE', `/household/reward-catalog/${itemId}`, { parent: a.parent });
    const gone = await api(
      'POST',
      '/reward-redemptions',
      { child: a.child },
      { clientUuid: randomUUID(), itemId },
    );
    expect(gone.body.details.reason).toBe('ITEM_ARCHIVED');
  });

  it('parents cannot redeem for a child', async () => {
    expect(
      (
        await api(
          'POST',
          '/reward-redemptions',
          { parent: a.parent },
          { clientUuid: randomUUID(), itemId },
        )
      ).status,
    ).toBe(403);
  });
});

describe('cross-household denial', () => {
  it('another household gets 404 on every child route', async () => {
    const ownItem = await api(
      'POST',
      '/household/reward-catalog',
      { parent: a.parent },
      { title: 'Kem', costCoins: 1 },
    );
    const itemA = ownItem.body.item.id as string;
    const r = await api(
      'POST',
      '/reward-redemptions',
      { child: a.child },
      { clientUuid: randomUUID(), itemId: itemA },
    );
    expect(r.status).toBe(200);
    const redemptionA = r.body.redemption.id as string;

    for (const auth of [{ parent: b.parent }, { child: b.child }]) {
      expect((await api('GET', `/students/${a.studentId}/rewards/wallet`, auth)).status).toBe(404);
      expect((await api('GET', `/students/${a.studentId}/rewards/ledger`, auth)).status).toBe(404);
      expect(
        (await api('GET', `/students/${a.studentId}/rewards/ledger?kind=xp`, auth)).status,
      ).toBe(404);
    }
    expect(
      (
        await api(
          'PATCH',
          `/household/reward-catalog/${itemA}`,
          { parent: b.parent },
          { costCoins: 9 },
        )
      ).status,
    ).toBe(404);
    expect(
      (await api('DELETE', `/household/reward-catalog/${itemA}`, { parent: b.parent })).status,
    ).toBe(404);
    expect(
      (await api('POST', `/reward-redemptions/${redemptionA}/approve`, { parent: b.parent }, {}))
        .status,
    ).toBe(404);
    expect(
      (await api('POST', `/reward-redemptions/${redemptionA}/reject`, { parent: b.parent }, {}))
        .status,
    ).toBe(404);
    expect(
      (
        await api(
          'POST',
          '/reward-redemptions',
          { child: b.child },
          { clientUuid: randomUUID(), itemId: itemA },
        )
      ).status,
    ).toBe(404);
    // A replayed clientUuid from another household is a conflict, never a leak.
    const replay = await api(
      'POST',
      '/reward-redemptions',
      { child: b.child },
      {
        clientUuid: (
          await sql<
            { client_uuid: string }[]
          >`select client_uuid from app.reward_redemptions where id = ${redemptionA}`
        )[0]!.client_uuid,
        itemId: itemA,
      },
    );
    expect(replay.status).toBe(409);
    const listB = RedemptionsResponseSchema.parse(
      (await api('GET', '/reward-redemptions', { parent: b.parent })).body,
    );
    expect(listB.items.map((i) => i.id)).not.toContain(redemptionA);
    const catalogB = CatalogResponseSchema.parse(
      (await api('GET', '/household/reward-catalog', { child: b.child })).body,
    );
    expect(catalogB.items.map((i) => i.id)).not.toContain(itemA);
    // The child sees only their own redemptions; the parent's studentId filter stays in scope.
    const listChildB = RedemptionsResponseSchema.parse(
      (await api('GET', '/reward-redemptions', { child: b.child })).body,
    );
    expect(listChildB.items).toHaveLength(0);
    const filtered = RedemptionsResponseSchema.parse(
      (await api('GET', `/reward-redemptions?studentId=${a.studentId}`, { parent: b.parent })).body,
    );
    expect(filtered.items).toHaveLength(0);
    await api('POST', `/reward-redemptions/${redemptionA}/reject`, { parent: a.parent }, {});
  });

  it('client roles have no privileges on the reward tables', async () => {
    for (const table of [
      'app.system_caps',
      'app.reward_rules',
      'app.xp_ledger',
      'app.coin_ledger',
      'app.daily_reward_snapshots',
      'app.reward_catalog_items',
      'app.reward_redemptions',
    ]) {
      const rows = await sql<{ allowed: boolean }[]>`
        select bool_or(has_table_privilege(r, ${table}, 'select,insert,update,delete')) as allowed
        from unnest(array['anon', 'authenticated']) as r`;
      expect(rows[0]!.allowed, table).toBe(false);
    }
    const [job] =
      await sql`select schedule from cron.job where jobname = 'vionx-reward-settlement'`;
    expect(job!.schedule).toBe('5 * * * *');
  });
});

describe('privacy', () => {
  it('a purge anonymises the reward ledgers instead of deleting them', async () => {
    const before = await ledgerTotals(c);
    expect(before.xp_rows).toBeGreaterThan(0);
    const [{ n }] = await sql<{ n: number }[]>`
      select ops.anonymise_ledgers(${c.householdId}::uuid, ${c.studentId}::uuid) as n`;
    expect(n).toBe(before.xp_rows + before.coin_rows);
    const after = await ledgerTotals(c);
    expect([after.xp_rows, after.coin_rows]).toEqual([0, 0]);
    const [kept] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.xp_ledger where household_id = ${c.householdId}`;
    expect(kept!.n).toBe(before.xp_rows);
  });
});
