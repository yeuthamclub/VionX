import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday, zonedDayStart } from '../calendar/dates.ts';
import {
  canDecideRedemption,
  canRequestRedemption,
  canReverse,
  capView,
  convertDay,
  isDayClosed,
  isLateGrant,
  ledgerKey,
  levelFor,
  levelStartXp,
  maxRewardableXp,
  nominalVnd,
  planXpGrant,
  reverseCoins,
  reverseXp,
  settleDay,
  settlementChanged,
  settlementDays,
} from './engine.ts';
import {
  dayCapCoins,
  dayFactsFrom,
  DEFAULT_REWARD_RULES,
  effectiveRewardRules,
  isWeekend,
  maxDayCapCoins,
  mergeRewardRules,
  NO_FACTS,
  validateRewardRules,
  weekendTier,
  type DayFacts,
  type RewardRulesConfig,
} from './rules.ts';
import { SYSTEM_CAPS, systemCapRows, systemCapsFromRows } from './types.ts';

// 2026-10-07 is a Wednesday, 2026-10-10 a Saturday, 2026-10-11 a Sunday.
const WED = '2026-10-07';
const SAT = '2026-10-10';
const SUN = '2026-10-11';
const ICT = 'Asia/Ho_Chi_Minh';

const facts = (f: Partial<DayFacts>): DayFacts => ({ ...NO_FACTS, ...f });
const TIER1: DayFacts = facts({ requiredLearningTasks: 2, requiredLearningCompleted: 2 });
const TIER2: DayFacts = { ...TIER1, readingCompleted: 1, activityCompleted: 1 };
const TIER3: DayFacts = { ...TIER2, bonusApproved: 1 };

/** Applies a sequence of grants on one day the way the worker does (running totals). */
function applyGrants(
  day: string,
  xps: number[],
  rules: RewardRulesConfig = DEFAULT_REWARD_RULES,
  grantDay = day,
) {
  let rewardable = 0;
  let lifetime = 0;
  let grants = 0;
  for (const xp of xps) {
    const plan = planXpGrant({
      xp,
      rewardDay: day,
      grantDay,
      rewardableSoFar: rewardable,
      grantsSoFar: grants,
      maxGrantsPerDay: rules.micro.TASK_APPROVED.maxGrantsPerDay,
      maxRewardableXp: maxRewardableXp(day, rules),
      lateGrantDays: SYSTEM_CAPS.lateGrantDays,
    });
    rewardable += plan.rewardableXp;
    lifetime += plan.lifetimeXp;
    grants++;
  }
  return { rewardable, lifetime };
}

describe('system caps and rules', () => {
  it('matches Master Spec §14.2', () => {
    expect(SYSTEM_CAPS.xpPerCoin).toBe(100);
    expect(SYSTEM_CAPS.coinNominalVnd).toBe(1000);
    expect(SYSTEM_CAPS.weekdayCapCoins).toBe(20);
    expect(SYSTEM_CAPS.weekendTierCaps).toEqual([20, 30, 40, 50]);
    expect(SYSTEM_CAPS.weekendMaxCoins).toBe(50);
    expect(validateRewardRules(DEFAULT_REWARD_RULES)).toEqual([]);
  });

  it('reads system cap rows; a row can only make a cap stricter', () => {
    expect(
      systemCapsFromRows(Object.entries(systemCapRows()).map(([key, value]) => ({ key, value }))),
    ).toEqual(SYSTEM_CAPS);
    const looser = systemCapsFromRows([{ key: 'WEEKDAY_CAP_COINS', value: 99 }]);
    expect(looser.weekdayCapCoins).toBe(20);
    const stricter = systemCapsFromRows([{ key: 'WEEKDAY_CAP_COINS', value: 10 }]);
    expect(stricter.weekdayCapCoins).toBe(10);
    expect(systemCapsFromRows([])).toEqual(SYSTEM_CAPS);
  });

  it('lets parents lower caps but never raise them', () => {
    const lower = mergeRewardRules(DEFAULT_REWARD_RULES, {
      weekdayCapCoins: 10,
      weekendTierCaps: [10, 15, 20, 25],
    });
    expect(validateRewardRules(lower)).toEqual([]);
    const higher = mergeRewardRules(DEFAULT_REWARD_RULES, { weekdayCapCoins: 21 });
    expect(validateRewardRules(higher)).toEqual([
      { field: 'weekdayCapCoins', error: 'ABOVE_SYSTEM_CAP', limit: 20 },
    ]);
    const tier = mergeRewardRules(DEFAULT_REWARD_RULES, { weekendTierCaps: [20, 30, 40, 60] });
    expect(validateRewardRules(tier)[0]).toMatchObject({
      field: 'weekendTierCaps.3',
      error: 'ABOVE_SYSTEM_CAP',
      limit: 50,
    });
  });

  it('rejects descending tiers, bad goals, micro caps and non-integers', () => {
    const errors = validateRewardRules({
      weekdayCapCoins: 1.5,
      weekendTierCaps: [30, 20, 40, 50],
      weekendGoals: { readingTasks: 0, activityTasks: 11 },
      micro: { TASK_APPROVED: { maxGrantsPerDay: 31 } },
    }).map((v) => `${v.field}:${v.error}`);
    expect(errors).toEqual([
      'weekdayCapCoins:NOT_AN_INTEGER',
      'weekendTierCaps.0:ABOVE_SYSTEM_CAP',
      'weekendTierCaps.1:TIERS_NOT_ASCENDING',
      'weekendGoals.readingTasks:GOAL_OUT_OF_RANGE',
      'weekendGoals.activityTasks:GOAL_OUT_OF_RANGE',
      'micro.TASK_APPROVED.maxGrantsPerDay:MICRO_CAP_OUT_OF_RANGE',
    ]);
    expect(validateRewardRules({ ...DEFAULT_REWARD_RULES, weekdayCapCoins: -1 })[0]?.error).toBe(
      'NEGATIVE',
    );
  });

  it('merges a patch field by field', () => {
    const merged = mergeRewardRules(DEFAULT_REWARD_RULES, {
      weekendGoals: { readingTasks: 2 },
      micro: { TASK_APPROVED: { maxGrantsPerDay: 5 } },
    });
    expect(merged.weekendGoals).toEqual({ readingTasks: 2, activityTasks: 1 });
    expect(merged.micro.TASK_APPROVED.maxGrantsPerDay).toBe(5);
    expect(merged.weekdayCapCoins).toBe(20);
  });

  it('clamps stored rules to the current system caps', () => {
    expect(effectiveRewardRules(null)).toEqual(DEFAULT_REWARD_RULES);
    expect(
      effectiveRewardRules({ weekdayCapCoins: 500, weekendTierCaps: [99, 99, 99, 99] }),
    ).toMatchObject({
      weekdayCapCoins: 20,
      weekendTierCaps: [20, 30, 40, 50],
    });
    const lowered = {
      ...SYSTEM_CAPS,
      weekdayCapCoins: 10,
      weekendTierCaps: [10, 10, 10, 10] as const,
    };
    expect(effectiveRewardRules(DEFAULT_REWARD_RULES, lowered)).toMatchObject({
      weekdayCapCoins: 10,
      weekendTierCaps: [10, 10, 10, 10],
    });
  });

  it('property: any validated household rules stay within the system caps', () => {
    const cap = fc.integer({ min: -5, max: 80 });
    fc.assert(
      fc.property(
        cap,
        cap,
        cap,
        cap,
        cap,
        fc.integer({ min: 0, max: 40 }),
        (w, t0, t1, t2, t3, m) => {
          const config = mergeRewardRules(DEFAULT_REWARD_RULES, {
            weekdayCapCoins: w,
            weekendTierCaps: [t0, t1, t2, t3],
            micro: { TASK_APPROVED: { maxGrantsPerDay: m } },
          });
          if (validateRewardRules(config).length > 0) return;
          expect(config.weekdayCapCoins).toBeLessThanOrEqual(SYSTEM_CAPS.weekdayCapCoins);
          config.weekendTierCaps.forEach((v, i) =>
            expect(v).toBeLessThanOrEqual(SYSTEM_CAPS.weekendTierCaps[i as 0]),
          );
          expect(config.micro.TASK_APPROVED.maxGrantsPerDay).toBeLessThanOrEqual(
            SYSTEM_CAPS.maxGrantsPerRulePerDay,
          );
        },
      ),
    );
  });

  it('property: effective rules are always valid, whatever was stored', () => {
    fc.assert(
      fc.property(fc.anything(), (stored) => {
        expect(validateRewardRules(effectiveRewardRules(stored))).toEqual([]);
      }),
    );
  });
});

describe('days, facts and weekend tiers', () => {
  it('knows weekends by household-local day', () => {
    expect([WED, SAT, SUN].map(isWeekend)).toEqual([false, true, true]);
    expect(isoWeekday(WED)).toBe(3);
  });

  it('derives facts from task days', () => {
    const f = dayFactsFrom([
      { type: 'HOMEWORK', required: true, completed: true, verificationMode: 'PARENT_APPROVAL' },
      { type: 'LEARNING', required: true, completed: false, verificationMode: 'SELF_CHECK' },
      { type: 'READING', required: false, completed: true, verificationMode: 'SELF_CHECK' },
      { type: 'SPORT', required: false, completed: true, verificationMode: 'SELF_CHECK' },
      { type: 'HOUSEHOLD', required: false, completed: true, verificationMode: 'PARENT_APPROVAL' },
      { type: 'CREATIVE', required: false, completed: false, verificationMode: 'PHOTO_PROOF' },
      { type: 'SPORT', required: true, completed: true, verificationMode: 'SELF_CHECK' },
    ]);
    expect(f).toEqual({
      requiredLearningTasks: 2,
      requiredLearningCompleted: 1,
      readingCompleted: 1,
      activityCompleted: 2,
      bonusApproved: 1,
    });
  });

  it('decides tiers from facts (§14.2)', () => {
    const rules = DEFAULT_REWARD_RULES;
    expect(weekendTier(NO_FACTS, rules)).toBe(0);
    // No required learning task that day: Tier 1 is not given for free.
    expect(
      weekendTier(facts({ readingCompleted: 3, activityCompleted: 3, bonusApproved: 1 }), rules),
    ).toBe(0);
    expect(
      weekendTier(facts({ requiredLearningTasks: 2, requiredLearningCompleted: 1 }), rules),
    ).toBe(0);
    expect(weekendTier(TIER1, rules)).toBe(1);
    expect(weekendTier({ ...TIER1, readingCompleted: 1 }, rules)).toBe(1);
    expect(weekendTier(TIER2, rules)).toBe(2);
    expect(weekendTier(TIER3, rules)).toBe(3);
    expect(weekendTier({ ...TIER1, bonusApproved: 1 }, rules)).toBe(1);
    const stricter = mergeRewardRules(rules, { weekendGoals: { readingTasks: 2 } });
    expect(weekendTier(TIER3, stricter)).toBe(1);
  });

  it('caps: weekday 20, weekend tiers 20/30/40/50', () => {
    const rules = DEFAULT_REWARD_RULES;
    expect(dayCapCoins(WED, null, rules)).toBe(20);
    expect(dayCapCoins(WED, 3, rules)).toBe(20);
    expect([0, 1, 2, 3].map((t) => dayCapCoins(SAT, t as 0, rules))).toEqual([20, 30, 40, 50]);
    expect(maxDayCapCoins(WED, rules)).toBe(20);
    expect(maxDayCapCoins(SUN, rules)).toBe(50);
    const lowered = mergeRewardRules(rules, { weekdayCapCoins: 5, weekendTierCaps: [5, 6, 7, 8] });
    expect(dayCapCoins(WED, null, lowered)).toBe(5);
    expect(maxDayCapCoins(SAT, lowered)).toBe(8);
  });
});

describe('XP grants', () => {
  const base = {
    rewardDay: WED,
    grantDay: WED,
    rewardableSoFar: 0,
    grantsSoFar: 0,
    maxGrantsPerDay: 20,
    maxRewardableXp: 2000,
    lateGrantDays: 2,
  };

  it('counts XP above the day cap toward lifetime XP only', () => {
    expect(planXpGrant({ ...base, xp: 500 })).toEqual({
      lifetimeXp: 500,
      rewardableXp: 500,
      cappedReason: null,
    });
    expect(planXpGrant({ ...base, xp: 500, rewardableSoFar: 1800 })).toEqual({
      lifetimeXp: 500,
      rewardableXp: 200,
      cappedReason: 'DAILY_XP_CAP',
    });
    expect(planXpGrant({ ...base, xp: 500, rewardableSoFar: 2000 }).rewardableXp).toBe(0);
  });

  it('caps repetitive micro-actions per rule', () => {
    expect(planXpGrant({ ...base, xp: 10, grantsSoFar: 20 })).toEqual({
      lifetimeXp: 0,
      rewardableXp: 0,
      cappedReason: 'MICRO_CAP',
    });
    expect(planXpGrant({ ...base, xp: 10, grantsSoFar: 19 }).lifetimeXp).toBe(10);
  });

  it('late grants count toward lifetime XP only', () => {
    expect(isLateGrant(WED, addDays(WED, 2), 2)).toBe(false);
    expect(isLateGrant(WED, addDays(WED, 3), 2)).toBe(true);
    expect(planXpGrant({ ...base, xp: 50, grantDay: addDays(WED, 1) }).rewardableXp).toBe(50);
    expect(planXpGrant({ ...base, xp: 50, grantDay: addDays(WED, 3) })).toEqual({
      lifetimeXp: 50,
      rewardableXp: 0,
      cappedReason: 'LATE',
    });
  });

  it('builds ledger keys without student ids', () => {
    expect(ledgerKey('task_completion', 'c1', 'TASK_APPROVED')).toBe(
      'task_completion:c1:TASK_APPROVED',
    );
  });

  it('property: rewardable XP of a day never exceeds its highest cap; lifetime never drops XP below the micro cap', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 40 }),
        fc.constantFrom(WED, SAT, SUN),
        (xps, day) => {
          const { rewardable, lifetime } = applyGrants(day, xps);
          expect(rewardable).toBeLessThanOrEqual(maxDayCapCoins(day, DEFAULT_REWARD_RULES) * 100);
          expect(rewardable).toBeLessThanOrEqual(lifetime);
          const counted = xps.slice(0, DEFAULT_REWARD_RULES.micro.TASK_APPROVED.maxGrantsPerDay);
          expect(lifetime).toBe(counted.reduce((a, b) => a + b, 0));
        },
      ),
    );
  });
});

describe('day conversion and settlement', () => {
  it('100 rewardable XP = 1 Coin, floored, capped', () => {
    expect(convertDay(0, 20)).toEqual({ coins: 0, xpConverted: 0, xpForfeited: 0 });
    expect(convertDay(199, 20)).toEqual({ coins: 1, xpConverted: 100, xpForfeited: 99 });
    expect(convertDay(3500, 20)).toEqual({ coins: 20, xpConverted: 2000, xpForfeited: 1500 });
    expect(nominalVnd(20)).toBe(20_000);
  });

  it('acceptance: a Wednesday with 3,500 XP gives exactly 20 Coin', () => {
    const { rewardable, lifetime } = applyGrants(WED, [1000, 1000, 1000, 500]);
    expect(lifetime).toBe(3500);
    const s = settleDay({
      day: WED,
      facts: TIER3,
      rules: DEFAULT_REWARD_RULES,
      rewardableXp: rewardable,
      coinsAlreadyGranted: 0,
    });
    expect(s).toMatchObject({
      weekend: false,
      tier: null,
      capCoins: 20,
      coinsTotal: 20,
      coinsToGrant: 20,
    });
  });

  it('acceptance: a Saturday at Tier 2 gives at most 40 Coin', () => {
    const { rewardable } = applyGrants(SAT, [1000, 1000, 1000, 1000, 1000, 1000]);
    expect(rewardable).toBe(5000);
    const s = settleDay({
      day: SAT,
      facts: TIER2,
      rules: DEFAULT_REWARD_RULES,
      rewardableXp: rewardable,
      coinsAlreadyGranted: 0,
    });
    expect(s).toMatchObject({ weekend: true, tier: 2, capCoins: 40, coinsTotal: 40 });
    expect(
      settleDay({
        ...s,
        day: SAT,
        facts: TIER3,
        rules: DEFAULT_REWARD_RULES,
        rewardableXp: 5000,
        coinsAlreadyGranted: 40,
      }),
    ).toMatchObject({ tier: 3, coinsTotal: 50, coinsToGrant: 10 });
  });

  it('tops a day up after a late grant and never claws Coin back', () => {
    const first = settleDay({
      day: WED,
      facts: NO_FACTS,
      rules: DEFAULT_REWARD_RULES,
      rewardableXp: 900,
      coinsAlreadyGranted: 0,
    });
    expect(first.coinsToGrant).toBe(9);
    const again = settleDay({
      day: WED,
      facts: NO_FACTS,
      rules: DEFAULT_REWARD_RULES,
      rewardableXp: 900,
      coinsAlreadyGranted: 9,
    });
    expect(again.coinsToGrant).toBe(0);
    expect(
      settlementChanged({ tier: null, capCoins: 20, rewardableXp: 900, coinsTotal: 9 }, again),
    ).toBe(false);
    const late = settleDay({
      day: WED,
      facts: NO_FACTS,
      rules: DEFAULT_REWARD_RULES,
      rewardableXp: 1300,
      coinsAlreadyGranted: 9,
    });
    expect(late.coinsToGrant).toBe(4);
    const lowered = mergeRewardRules(DEFAULT_REWARD_RULES, { weekdayCapCoins: 5 });
    const after = settleDay({
      day: WED,
      facts: NO_FACTS,
      rules: lowered,
      rewardableXp: 1300,
      coinsAlreadyGranted: 13,
    });
    expect(after).toMatchObject({ capCoins: 5, coinsTotal: 13, coinsToGrant: 0 });
  });

  it('property: settled Coin never exceeds the day cap and replays grant nothing', () => {
    const factsArb = fc.record({
      requiredLearningTasks: fc.integer({ min: 0, max: 4 }),
      requiredLearningCompleted: fc.integer({ min: 0, max: 4 }),
      readingCompleted: fc.integer({ min: 0, max: 3 }),
      activityCompleted: fc.integer({ min: 0, max: 3 }),
      bonusApproved: fc.integer({ min: 0, max: 2 }),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 30 }),
        factsArb,
        (offset, xps, f) => {
          const day = addDays('2026-01-01', offset);
          const { rewardable } = applyGrants(day, xps);
          const s = settleDay({
            day,
            facts: f,
            rules: DEFAULT_REWARD_RULES,
            rewardableXp: rewardable,
            coinsAlreadyGranted: 0,
          });
          const limit = isWeekend(day) ? 50 : 20;
          expect(s.coinsTotal).toBeLessThanOrEqual(limit);
          expect(s.coinsTotal).toBeLessThanOrEqual(s.capCoins);
          expect(s.coinsTotal).toBe(Math.min(Math.floor(rewardable / 100), s.capCoins));
          if (!isWeekend(day)) expect(s.coinsTotal).toBeLessThanOrEqual(20);
          // Replaying the settlement with what it granted changes nothing.
          const replay = settleDay({
            day,
            facts: f,
            rules: DEFAULT_REWARD_RULES,
            rewardableXp: rewardable,
            coinsAlreadyGranted: s.coinsTotal,
          });
          expect(replay.coinsToGrant).toBe(0);
          expect(
            settlementChanged(
              {
                tier: s.tier,
                capCoins: s.capCoins,
                rewardableXp: s.rewardableXp,
                coinsTotal: s.coinsTotal,
              },
              replay,
            ),
          ).toBe(false);
        },
      ),
    );
  });

  it('property: tiers are monotonic in their facts and caps rise with tiers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (t) => {
        const ladder = [NO_FACTS, TIER1, TIER2, TIER3];
        expect(weekendTier(ladder[t]!, DEFAULT_REWARD_RULES)).toBe(t);
        if (t > 0) {
          expect(dayCapCoins(SAT, t as 1, DEFAULT_REWARD_RULES)).toBeGreaterThan(
            dayCapCoins(SAT, (t - 1) as 0, DEFAULT_REWARD_RULES),
          );
        }
      }),
    );
  });

  it('no rollover: each day converts only its own XP', () => {
    const mon = applyGrants('2026-10-05', [1000, 1000, 1000]);
    const tue = applyGrants('2026-10-06', [100]);
    const coins = [
      settleDay({
        day: '2026-10-05',
        facts: NO_FACTS,
        rules: DEFAULT_REWARD_RULES,
        rewardableXp: mon.rewardable,
        coinsAlreadyGranted: 0,
      }),
      settleDay({
        day: '2026-10-06',
        facts: NO_FACTS,
        rules: DEFAULT_REWARD_RULES,
        rewardableXp: tue.rewardable,
        coinsAlreadyGranted: 0,
      }),
    ].map((s) => s.coinsTotal);
    expect(coins).toEqual([20, 1]);
  });
});

describe('timezone boundaries', () => {
  it('a day closes at household-local midnight', () => {
    // Wednesday ends at 2026-10-07T17:00Z in Asia/Ho_Chi_Minh (UTC+7).
    expect(zonedDayStart('2026-10-08', ICT).toISOString()).toBe('2026-10-07T17:00:00.000Z');
    expect(isDayClosed(WED, new Date('2026-10-07T16:59:59Z'), ICT)).toBe(false);
    expect(isDayClosed(WED, new Date('2026-10-07T17:00:00Z'), ICT)).toBe(true);
    // The same instant in UTC and in Los Angeles: Wednesday still running there.
    expect(isDayClosed(WED, new Date('2026-10-07T17:00:00Z'), 'UTC')).toBe(false);
    expect(isDayClosed(WED, new Date('2026-10-08T06:59:59Z'), 'America/Los_Angeles')).toBe(false);
    expect(isDayClosed(WED, new Date('2026-10-08T07:00:00Z'), 'America/Los_Angeles')).toBe(true);
  });

  it('settles the days inside the late-grant window', () => {
    expect(settlementDays('2026-10-08', 2)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});

describe('levels', () => {
  it('starts each level at 50·L·(L−1) XP', () => {
    expect([1, 2, 3, 4, 5].map(levelStartXp)).toEqual([0, 100, 300, 600, 1000]);
    expect(levelFor(0)).toEqual({
      level: 1,
      levelStartXp: 0,
      nextLevelXp: 100,
      xpIntoLevel: 0,
      xpForNextLevel: 100,
    });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(3500)).toMatchObject({ level: 8, levelStartXp: 2800, nextLevelXp: 3600 });
  });

  it('property: level is monotonic and consistent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (xp, more) => {
          const a = levelFor(xp);
          const b = levelFor(xp + more);
          expect(b.level).toBeGreaterThanOrEqual(a.level);
          expect(a.levelStartXp).toBeLessThanOrEqual(xp);
          expect(a.nextLevelXp).toBeGreaterThan(xp);
          expect(a.xpIntoLevel).toBe(xp - a.levelStartXp);
        },
      ),
    );
  });
});

describe('reversals and redemptions', () => {
  it('a reversal undoes an entry exactly, once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (a, b) => {
        const entry = { lifetimeXpDelta: Math.max(a, b), rewardableXpDelta: Math.min(a, b) };
        const r = reverseXp(entry);
        expect(entry.lifetimeXpDelta + r.lifetimeXpDelta).toBe(0);
        expect(entry.rewardableXpDelta + r.rewardableXpDelta).toBe(0);
        expect(a + reverseCoins(a)).toBe(0);
      }),
    );
    expect(canReverse({ reversalOf: null, reversedBy: null }).ok).toBe(true);
    expect(canReverse({ reversalOf: null, reversedBy: 'x' })).toEqual({
      ok: false,
      error: 'ALREADY_REVERSED',
    });
    expect(canReverse({ reversalOf: 'x', reversedBy: null })).toEqual({
      ok: false,
      error: 'IS_A_REVERSAL',
    });
  });

  it('redeems only active items the child can afford; decides only pending ones', () => {
    expect(canRequestRedemption({ itemStatus: 'ACTIVE', costCoins: 10, balance: 10 }).ok).toBe(
      true,
    );
    expect(canRequestRedemption({ itemStatus: 'ACTIVE', costCoins: 11, balance: 10 })).toEqual({
      ok: false,
      error: 'INSUFFICIENT_COINS',
    });
    expect(canRequestRedemption({ itemStatus: 'ARCHIVED', costCoins: 1, balance: 10 })).toEqual({
      ok: false,
      error: 'ITEM_ARCHIVED',
    });
    expect(canDecideRedemption('PENDING').ok).toBe(true);
    expect(canDecideRedemption('APPROVED')).toEqual({ ok: false, error: 'NOT_PENDING' });
  });
});

describe("today's cap bar", () => {
  it('shows the current cap, the projection and the top weekend cap', () => {
    expect(
      capView({ day: WED, facts: NO_FACTS, rules: DEFAULT_REWARD_RULES, rewardableXp: 1250 }),
    ).toEqual({
      day: WED,
      weekend: false,
      tier: null,
      capCoins: 20,
      maxCapCoins: 20,
      rewardableXp: 1250,
      capXp: 2000,
      projectedCoins: 12,
      reached: false,
    });
    expect(
      capView({ day: SAT, facts: TIER1, rules: DEFAULT_REWARD_RULES, rewardableXp: 3100 }),
    ).toMatchObject({
      tier: 1,
      capCoins: 30,
      maxCapCoins: 50,
      projectedCoins: 30,
      reached: true,
    });
  });
});
