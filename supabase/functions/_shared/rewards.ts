// Reward engine I/O (M04), shared by the worker (grants, day-end settlement) and the api (wallet,
// redemptions). The rules are in @vionx/domain; every write here happens inside the caller's
// transaction after `lockStudentRewards` (one advisory lock per child), so concurrent grants,
// settlements and redemptions of one child are serialised and multi-ledger writes are atomic.
import {
  addDays,
  dayFactsFrom,
  DEFAULT_REWARD_RULES,
  effectiveRewardRules,
  householdToday,
  isLateGrant,
  ledgerKey,
  LEDGER_SOURCE_TYPES,
  COIN_RULE_IDS,
  maxRewardableXp,
  planXpGrant,
  REWARD_EVENT_NAMES,
  REWARD_EVENT_TYPES,
  REWARD_LOCK_CLASS,
  settleDay,
  settlementChanged,
  settlementDays,
  systemCapsFromRows,
  type DayFacts,
  type RewardRulesConfig,
  type Settlement,
  type SystemCaps,
  type TaskDayFact,
  type XpRuleId,
} from '@vionx/domain';
import type { Sql, TxSql } from './db.ts';

type Db = Sql | TxSql;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serialises reward work for one child until the transaction ends. */
export async function lockStudentRewards(tx: TxSql, studentId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(${REWARD_LOCK_CLASS}::int, hashtext(${studentId}::text))`;
}

export async function loadSystemCaps(db: Db): Promise<SystemCaps> {
  const rows = await db<{ key: string; value: number }[]>`select key, value from app.system_caps`;
  return systemCapsFromRows(rows);
}

export interface RulesInForce {
  rules: RewardRulesConfig;
  defaults: RewardRulesConfig;
  /** Household version, 0 when the household uses the system default. */
  version: number;
  updatedAt: Date | null;
}

/** The household's latest rules (or the system default), clamped to the system caps. */
export async function loadRules(
  db: Db,
  householdId: string,
  caps: SystemCaps,
): Promise<RulesInForce> {
  const rows = await db<
    { household_id: string | null; version: number; config: unknown; created_at: Date }[]
  >`
    (select household_id, version, config, created_at from app.reward_rules
      where household_id = ${householdId} order by version desc limit 1)
    union all
    (select household_id, version, config, created_at from app.reward_rules
      where household_id is null order by version desc limit 1)`;
  const own = rows.find((r) => r.household_id !== null);
  const system = rows.find((r) => r.household_id === null);
  const defaults = effectiveRewardRules(system?.config ?? DEFAULT_REWARD_RULES, caps);
  return {
    rules: own ? effectiveRewardRules(own.config, caps) : defaults,
    defaults,
    version: own?.version ?? 0,
    updatedAt: own?.created_at ?? null,
  };
}

/** Facts of one child's day from its task days (until M16/M18 add reading/activity facts). */
export async function loadDayFacts(
  db: Db,
  householdId: string,
  studentId: string,
  day: string,
): Promise<DayFacts> {
  const rows = await db<
    {
      type: TaskDayFact['type'];
      required: boolean;
      status: string;
      verification_mode: TaskDayFact['verificationMode'];
    }[]
  >`
    select a.type, a.required, o.status, a.verification_mode
    from app.task_occurrences o
    join app.task_assignments a on a.id = o.assignment_id and a.household_id = o.household_id
    where o.household_id = ${householdId} and o.student_id = ${studentId} and o.occurs_on = ${day}::date`;
  return dayFactsFrom(
    rows.map((r) => ({
      type: r.type,
      required: r.required,
      completed: r.status === 'COMPLETED',
      verificationMode: r.verification_mode,
    })),
  );
}

export async function rewardableXpOn(db: Db, householdId: string, studentId: string, day: string) {
  const [row] = await db<{ rewardable: number; lifetime: number }[]>`
    select coalesce(sum(rewardable_xp_delta), 0)::int as rewardable,
           coalesce(sum(lifetime_xp_delta), 0)::int as lifetime
    from app.xp_ledger
    where household_id = ${householdId} and student_id = ${studentId} and reward_day = ${day}::date`;
  return row!;
}

// --- Grants ---------------------------------------------------------------------------------------

export interface GrantEvent {
  id: string;
  householdId: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export type GrantOutcome =
  | { granted: true; entryId: string; lifetimeXp: number; rewardableXp: number; settled: boolean }
  | { granted: false; reason: 'INVALID_PAYLOAD' | 'NOT_APPROVED' | 'DUPLICATE' };

/**
 * XP for an approved task day (TaskApproved, or TaskCompleted with status APPROVED). Both events
 * of a SELF_CHECK completion arrive; the ledger's unique (source_type, source_id, rule_id) lets the
 * first one grant and makes the second a no-op. The event time decides the grant day, so a replay
 * computes the same result whenever it runs.
 */
export async function grantTaskXp(tx: TxSql, event: GrantEvent): Promise<GrantOutcome> {
  const p = event.payload;
  const studentId = String(p.studentId ?? '');
  const completionId = String(p.completionId ?? '');
  const day = String(p.date ?? '');
  const xp = Number(p.rewardXp ?? 0);
  if (
    !event.householdId ||
    !UUID_RE.test(studentId) ||
    !UUID_RE.test(completionId) ||
    !DAY_RE.test(day) ||
    !Number.isInteger(xp) ||
    xp < 0
  ) {
    return { granted: false, reason: 'INVALID_PAYLOAD' };
  }
  const householdId = event.householdId;
  const [completion] = await tx<{ status: string; timezone: string }[]>`
    select c.status, h.timezone
    from app.task_completions c
    join app.households h on h.id = c.household_id
    where c.id = ${completionId} and c.household_id = ${householdId} and c.student_id = ${studentId}`;
  if (!completion || completion.status !== 'APPROVED')
    return { granted: false, reason: 'NOT_APPROVED' };

  await lockStudentRewards(tx, studentId);
  const rule: XpRuleId = 'TASK_APPROVED';
  const sourceType = LEDGER_SOURCE_TYPES.taskCompletion;
  const key = ledgerKey(sourceType, completionId, rule);
  const [existing] = await tx<{ id: string }[]>`
    select id from app.xp_ledger where idempotency_key = ${key}`;
  if (existing) return { granted: false, reason: 'DUPLICATE' };

  const caps = await loadSystemCaps(tx);
  const { rules, version } = await loadRules(tx, householdId, caps);
  const [counts] = await tx<{ rewardable: number; grants: number }[]>`
    select coalesce(sum(rewardable_xp_delta), 0)::int as rewardable,
           (count(*) filter (where rule_id = ${rule} and reversal_of is null
                              and capped_reason is distinct from 'MICRO_CAP'))::int as grants
    from app.xp_ledger
    where household_id = ${householdId} and student_id = ${studentId} and reward_day = ${day}::date`;
  const occurredAt = new Date(event.occurredAt);
  const grantDay = householdToday(occurredAt, completion.timezone);
  const plan = planXpGrant({
    xp,
    rewardDay: day,
    grantDay,
    rewardableSoFar: counts!.rewardable,
    grantsSoFar: counts!.grants,
    maxGrantsPerDay: rules.micro[rule].maxGrantsPerDay,
    maxRewardableXp: maxRewardableXp(day, rules, caps),
    lateGrantDays: caps.lateGrantDays,
  });
  const [entry] = await tx<{ id: string }[]>`
    insert into app.xp_ledger (household_id, student_id, reward_day, lifetime_xp_delta,
      rewardable_xp_delta, source_type, source_id, rule_id, rule_version, capped_reason, event_id,
      idempotency_key)
    values (${householdId}, ${studentId}, ${day}::date, ${plan.lifetimeXp}, ${plan.rewardableXp},
      ${sourceType}, ${completionId}, ${rule}, ${version}, ${plan.cappedReason}, ${event.id}, ${key})
    on conflict do nothing
    returning id`;
  if (!entry) return { granted: false, reason: 'DUPLICATE' };
  if (plan.lifetimeXp > 0) {
    await tx`
      insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
      values (${REWARD_EVENT_TYPES.xpGranted}, ${householdId}, 'xp_ledger', ${entry.id},
        ${tx.json({
          eventName: REWARD_EVENT_NAMES['xp.granted'],
          studentId,
          entryId: entry.id,
          rewardDay: day,
          lifetimeXp: plan.lifetimeXp,
          rewardableXp: plan.rewardableXp,
          cappedReason: plan.cappedReason,
          sourceType,
          sourceId: completionId,
          ruleId: rule,
          taskId: typeof p.taskId === 'string' ? p.taskId : null,
          causationId: event.id,
        } as never)}, ${entry.id})`;
  }
  // A grant for a day that has already ended (e.g. yesterday's homework approved this morning)
  // re-settles that day at once, inside the late-grant window.
  let settled = false;
  if (day < grantDay && !isLateGrant(day, grantDay, caps.lateGrantDays)) {
    settled =
      (await settleStudentDay(tx, {
        householdId,
        studentId,
        day,
        at: occurredAt,
        caps,
        causationId: event.id,
      })) !== null;
  }
  return {
    granted: true,
    entryId: entry.id,
    lifetimeXp: plan.lifetimeXp,
    rewardableXp: plan.rewardableXp,
    settled,
  };
}

// --- Settlement -----------------------------------------------------------------------------------

export interface SettledSnapshot {
  snapshotId: string;
  version: number;
  settlement: Settlement;
  coinEntryId: string | null;
}

/**
 * Settles one child's ended day: a new snapshot version when the result changed, and a Coin entry
 * for the difference (CoinGranted). Unchanged days write nothing, so running it again is a no-op.
 * The caller holds the child's reward lock (taken again here; advisory locks are re-entrant).
 */
export async function settleStudentDay(
  tx: TxSql,
  input: {
    householdId: string;
    studentId: string;
    day: string;
    at: Date;
    caps?: SystemCaps;
    causationId?: string;
  },
): Promise<SettledSnapshot | null> {
  const { householdId, studentId, day } = input;
  await lockStudentRewards(tx, studentId);
  const [student] = await tx<{ id: string }[]>`
    select id from app.students where id = ${studentId} and household_id = ${householdId}`;
  if (!student) return null;
  const caps = input.caps ?? (await loadSystemCaps(tx));
  const { rules, version } = await loadRules(tx, householdId, caps);
  const xp = await rewardableXpOn(tx, householdId, studentId, day);
  const [coins] = await tx<{ total: number }[]>`
    select coalesce(sum(amount), 0)::int as total from app.coin_ledger
    where household_id = ${householdId} and student_id = ${studentId} and reward_day = ${day}::date`;
  const facts = await loadDayFacts(tx, householdId, studentId, day);
  const settlement = settleDay({
    day,
    facts,
    rules,
    caps,
    rewardableXp: xp.rewardable,
    coinsAlreadyGranted: coins!.total,
  });
  const [previous] = await tx<
    {
      version: number;
      tier: number | null;
      cap_coins: number;
      rewardable_xp: number;
      coins_total: number;
    }[]
  >`
    select version, tier, cap_coins, rewardable_xp, coins_total from app.daily_reward_snapshots
    where student_id = ${studentId} and local_day = ${day}::date
    order by version desc limit 1`;
  const changed = settlementChanged(
    previous
      ? {
          tier: previous.tier,
          capCoins: previous.cap_coins,
          rewardableXp: previous.rewardable_xp,
          coinsTotal: previous.coins_total,
        }
      : null,
    settlement,
  );
  if (!changed) return null;
  const nextVersion = (previous?.version ?? 0) + 1;
  const [snapshot] = await tx<{ id: string }[]>`
    insert into app.daily_reward_snapshots (household_id, student_id, local_day, version, weekend,
      tier, cap_coins, rewardable_xp, lifetime_xp, coins_total, coins_granted, xp_forfeited, facts,
      rules_version, settled_at)
    values (${householdId}, ${studentId}, ${day}::date, ${nextVersion}, ${settlement.weekend},
      ${settlement.tier}, ${settlement.capCoins}, ${settlement.rewardableXp}, ${xp.lifetime},
      ${settlement.coinsTotal}, ${settlement.coinsToGrant}, ${settlement.xpForfeited},
      ${tx.json(facts as never)}, ${version}, ${input.at})
    returning id`;
  let coinEntryId: string | null = null;
  if (settlement.coinsToGrant > 0) {
    const sourceType = LEDGER_SOURCE_TYPES.dailySnapshot;
    const rule = COIN_RULE_IDS.dayConversion;
    const [entry] = await tx<{ id: string }[]>`
      insert into app.coin_ledger (household_id, student_id, amount, kind, reward_day, source_type,
        source_id, rule_id, event_id, idempotency_key)
      values (${householdId}, ${studentId}, ${settlement.coinsToGrant}, 'DAY_CONVERSION', ${day}::date,
        ${sourceType}, ${snapshot!.id}, ${rule}, ${input.causationId ?? null},
        ${ledgerKey(sourceType, snapshot!.id, rule)})
      returning id`;
    coinEntryId = entry!.id;
    await tx`
      insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
      values (${REWARD_EVENT_TYPES.coinGranted}, ${householdId}, 'coin_ledger', ${entry!.id},
        ${tx.json({
          eventName: REWARD_EVENT_NAMES['coin.granted'],
          studentId,
          entryId: entry!.id,
          rewardDay: day,
          coins: settlement.coinsToGrant,
          coinsTotal: settlement.coinsTotal,
          capCoins: settlement.capCoins,
          tier: settlement.tier,
          snapshotId: snapshot!.id,
          snapshotVersion: nextVersion,
          causationId: input.causationId ?? null,
        } as never)}, ${entry!.id})`;
  }
  return { snapshotId: snapshot!.id, version: nextVersion, settlement, coinEntryId };
}

/**
 * Day-end settlement (`reward.settlement_requested`, hourly pg_cron): for every household, the
 * local days that ended by `at` in its own timezone and are still inside the late-grant window,
 * for each child with XP on that day. Idempotent.
 */
export async function settleDueDays(
  tx: TxSql,
  at: Date,
  causationId?: string,
): Promise<{ days: number; settled: number; coins: number }> {
  const caps = await loadSystemCaps(tx);
  // Widest possible window across timezones (UTC−12 … UTC+14), filtered per household below.
  const utcToday = at.toISOString().slice(0, 10);
  const from = addDays(utcToday, -(caps.lateGrantDays + 2));
  const rows = await tx<
    { household_id: string; student_id: string; day: string; timezone: string }[]
  >`
    select distinct x.household_id, x.student_id, x.reward_day::text as day, h.timezone
    from app.xp_ledger x
    join app.households h on h.id = x.household_id
    join app.students s on s.id = x.student_id and s.household_id = x.household_id
    where x.reward_day >= ${from}::date
      and h.deletion_requested_at is null and s.disabled_at is null
    order by x.household_id, x.student_id, day`;
  let days = 0;
  let settled = 0;
  let coins = 0;
  for (const r of rows) {
    const due = settlementDays(householdToday(at, r.timezone), caps.lateGrantDays);
    if (!due.includes(r.day)) continue;
    days++;
    const result = await settleStudentDay(tx, {
      householdId: r.household_id,
      studentId: r.student_id,
      day: r.day,
      at,
      caps,
      ...(causationId ? { causationId } : {}),
    });
    if (result) {
      settled++;
      coins += result.settlement.coinsToGrant;
    }
  }
  return { days, settled, coins };
}

// --- Balances -------------------------------------------------------------------------------------

export async function balances(db: Db, householdId: string, studentId: string) {
  const [row] = await db<{ lifetime_xp: number; coins: number; held: number }[]>`
    select
      (select coalesce(sum(lifetime_xp_delta), 0)::int from app.xp_ledger
        where household_id = ${householdId} and student_id = ${studentId}) as lifetime_xp,
      (select coalesce(sum(amount), 0)::int from app.coin_ledger
        where household_id = ${householdId} and student_id = ${studentId}) as coins,
      (select coalesce(sum(cost_coins), 0)::int from app.reward_redemptions
        where household_id = ${householdId} and student_id = ${studentId} and status = 'PENDING') as held`;
  return { lifetimeXp: row!.lifetime_xp, coinBalance: row!.coins, coinsHeld: row!.held };
}
