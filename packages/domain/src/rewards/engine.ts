// Reward engine rules (Master Spec §14): XP grants, day conversion to Coin, settlement, levels,
// reversals and redemptions. Pure functions; the worker and the api apply them inside one
// transaction under a per-student advisory lock.
import { addDays, daysBetween, householdToday } from '../calendar/dates.ts';
import { err, ok, type Result } from '../shared/result.ts';
import {
  dayCapCoins,
  isWeekend,
  maxDayCapCoins,
  weekendTier,
  type DayFacts,
  type RewardRulesConfig,
} from './rules.ts';
import {
  SYSTEM_CAPS,
  type CatalogItemStatus,
  type RedemptionStatus,
  type SystemCaps,
  type WeekendTier,
  type XpCappedReason,
} from './types.ts';

// --- XP grants ------------------------------------------------------------------------------------

export interface XpGrantInput {
  /** XP the source is worth (e.g. the task's reward_xp). */
  xp: number;
  /** Household-local day the XP belongs to (the task day). */
  rewardDay: string;
  /** Household-local day on which the grant happens (event time). */
  grantDay: string;
  /** Rewardable XP already on `rewardDay` (all rules, net of reversals). */
  rewardableSoFar: number;
  /** Grants of this rule already on `rewardDay`. */
  grantsSoFar: number;
  /** Micro-action cap of the rule. */
  maxGrantsPerDay: number;
  /** Most rewardable XP the day can hold: its highest Coin cap × XP per Coin. */
  maxRewardableXp: number;
  lateGrantDays: number;
}

export interface XpGrantPlan {
  lifetimeXp: number;
  rewardableXp: number;
  cappedReason: XpCappedReason | null;
}

/**
 * How much of a grant counts (Master Spec §14.3):
 * - past the rule's micro cap the grant is worth nothing;
 * - a grant more than `lateGrantDays` after its day counts toward lifetime XP only;
 * - rewardable XP above the day's highest cap counts toward lifetime XP only (no rollover).
 */
export function planXpGrant(input: XpGrantInput): XpGrantPlan {
  const xp = Math.max(0, Math.trunc(input.xp));
  if (input.grantsSoFar >= input.maxGrantsPerDay) {
    return { lifetimeXp: 0, rewardableXp: 0, cappedReason: 'MICRO_CAP' };
  }
  if (isLateGrant(input.rewardDay, input.grantDay, input.lateGrantDays)) {
    return { lifetimeXp: xp, rewardableXp: 0, cappedReason: xp > 0 ? 'LATE' : null };
  }
  const room = Math.max(0, input.maxRewardableXp - Math.max(0, input.rewardableSoFar));
  const rewardableXp = Math.min(xp, room);
  return {
    lifetimeXp: xp,
    rewardableXp,
    cappedReason: rewardableXp < xp ? 'DAILY_XP_CAP' : null,
  };
}

/** True when the grant happens more than `lateGrantDays` days after its reward day. */
export function isLateGrant(rewardDay: string, grantDay: string, lateGrantDays: number): boolean {
  return daysBetween(rewardDay, grantDay) > lateGrantDays;
}

/** Most rewardable XP a day can hold (its highest Coin cap in XP). */
export function maxRewardableXp(
  day: string,
  rules: RewardRulesConfig,
  caps: SystemCaps = SYSTEM_CAPS,
): number {
  return maxDayCapCoins(day, rules, caps) * caps.xpPerCoin;
}

/** Ledger key of a grant: one per (source_type, source_id, rule_id). Never contains a student id. */
export function ledgerKey(sourceType: string, sourceId: string, ruleId: string): string {
  return `${sourceType}:${sourceId}:${ruleId}`;
}

// --- Day conversion and settlement ----------------------------------------------------------------

export interface DayConversion {
  coins: number;
  xpConverted: number;
  /** Rewardable XP of the day that never converts (no rollover). */
  xpForfeited: number;
}

/** coins = min(floor(rewardable XP / XP per Coin), cap). */
export function convertDay(
  rewardableXp: number,
  capCoins: number,
  xpPerCoin = SYSTEM_CAPS.xpPerCoin,
): DayConversion {
  const xp = Math.max(0, Math.trunc(rewardableXp));
  const coins = Math.max(0, Math.min(Math.floor(xp / xpPerCoin), Math.trunc(capCoins)));
  return { coins, xpConverted: coins * xpPerCoin, xpForfeited: xp - coins * xpPerCoin };
}

export interface SettlementInput {
  day: string;
  facts: DayFacts;
  rules: RewardRulesConfig;
  caps?: SystemCaps;
  rewardableXp: number;
  /** Coin already granted for this day by earlier settlements. */
  coinsAlreadyGranted: number;
}

export interface Settlement {
  weekend: boolean;
  tier: WeekendTier | null;
  capCoins: number;
  rewardableXp: number;
  /** Coin of the day after this settlement (never below what was already granted). */
  coinsTotal: number;
  /** Coin to credit now (0 when nothing changed). */
  coinsToGrant: number;
  xpForfeited: number;
}

/**
 * Settles one household-local day. Coin already granted is never taken back (a parent lowering a
 * cap later does not claw back); a late grant or a higher weekend tier tops the day up.
 */
export function settleDay(input: SettlementInput): Settlement {
  const caps = input.caps ?? SYSTEM_CAPS;
  const weekend = isWeekend(input.day);
  const tier = weekend ? weekendTier(input.facts, input.rules) : null;
  const capCoins = dayCapCoins(input.day, tier, input.rules, caps);
  const conversion = convertDay(input.rewardableXp, capCoins, caps.xpPerCoin);
  const already = Math.max(0, input.coinsAlreadyGranted);
  const coinsTotal = Math.max(already, conversion.coins);
  return {
    weekend,
    tier,
    capCoins,
    rewardableXp: Math.max(0, input.rewardableXp),
    coinsTotal,
    coinsToGrant: coinsTotal - already,
    xpForfeited: Math.max(0, input.rewardableXp - coinsTotal * caps.xpPerCoin),
  };
}

/** A stored settlement differs from a new one (a new snapshot version is needed). */
export function settlementChanged(
  previous: {
    tier: number | null;
    capCoins: number;
    rewardableXp: number;
    coinsTotal: number;
  } | null,
  next: Settlement,
): boolean {
  if (!previous) return true;
  return (
    previous.tier !== next.tier ||
    previous.capCoins !== next.capCoins ||
    previous.rewardableXp !== next.rewardableXp ||
    previous.coinsTotal !== next.coinsTotal
  );
}

/** A household-local day has ended at `now`. */
export function isDayClosed(day: string, now: Date, timeZone: string): boolean {
  return day < householdToday(now, timeZone);
}

/**
 * Days a settlement run at household-local `today` looks at: the days that ended within the late
 * grant window (older days can no longer gain Coin).
 */
export function settlementDays(today: string, lateGrantDays: number): string[] {
  const out: string[] = [];
  for (let i = lateGrantDays + 1; i >= 1; i--) {
    out.push(addDays(today, -i));
  }
  return out;
}

// --- Today's cap bar ------------------------------------------------------------------------------

export interface CapView {
  day: string;
  weekend: boolean;
  tier: WeekendTier | null;
  capCoins: number;
  /** The highest cap the day can still reach (top weekend tier). */
  maxCapCoins: number;
  rewardableXp: number;
  /** XP needed to reach the current cap. */
  capXp: number;
  /** Coin the day would convert to now. */
  projectedCoins: number;
  reached: boolean;
}

export function capView(input: {
  day: string;
  facts: DayFacts;
  rules: RewardRulesConfig;
  caps?: SystemCaps;
  rewardableXp: number;
}): CapView {
  const caps = input.caps ?? SYSTEM_CAPS;
  const weekend = isWeekend(input.day);
  const tier = weekend ? weekendTier(input.facts, input.rules) : null;
  const capCoins = dayCapCoins(input.day, tier, input.rules, caps);
  const projectedCoins = convertDay(input.rewardableXp, capCoins, caps.xpPerCoin).coins;
  return {
    day: input.day,
    weekend,
    tier,
    capCoins,
    maxCapCoins: maxDayCapCoins(input.day, input.rules, caps),
    rewardableXp: Math.max(0, input.rewardableXp),
    capXp: capCoins * caps.xpPerCoin,
    projectedCoins,
    reached: projectedCoins >= capCoins,
  };
}

/** Nominal VND value of Coin (display only; Coin is never paid out). */
export function nominalVnd(coins: number, caps: SystemCaps = SYSTEM_CAPS): number {
  return coins * caps.coinNominalVnd;
}

// --- Levels ---------------------------------------------------------------------------------------

/** Lifetime XP at which `level` starts: 50·L·(L−1) (1: 0, 2: 100, 3: 300, 4: 600 …). */
export function levelStartXp(level: number): number {
  return 50 * level * (level - 1);
}

export interface LevelInfo {
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

export function levelFor(lifetimeXp: number): LevelInfo {
  const xp = Math.max(0, Math.trunc(lifetimeXp));
  // Largest L with 50·L·(L−1) ≤ xp.
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  while (levelStartXp(level + 1) <= xp) level++;
  while (level > 1 && levelStartXp(level) > xp) level--;
  const start = levelStartXp(level);
  const next = levelStartXp(level + 1);
  return {
    level,
    levelStartXp: start,
    nextLevelXp: next,
    xpIntoLevel: xp - start,
    xpForNextLevel: next - start,
  };
}

// --- Ledger corrections ---------------------------------------------------------------------------

export interface XpDelta {
  lifetimeXpDelta: number;
  rewardableXpDelta: number;
}

/** A reversal entry undoes one entry exactly (Master Spec §14.3: corrections are reversals). */
export function reverseXp(entry: XpDelta): XpDelta {
  return { lifetimeXpDelta: -entry.lifetimeXpDelta, rewardableXpDelta: -entry.rewardableXpDelta };
}

export function reverseCoins(amount: number): number {
  return -amount;
}

export type ReversalError = 'ALREADY_REVERSED' | 'IS_A_REVERSAL';

/** A ledger entry can be reversed once, and a reversal is never reversed itself. */
export function canReverse(entry: {
  reversalOf: string | null;
  reversedBy: string | null;
}): Result<true, ReversalError> {
  if (entry.reversalOf !== null) return err('IS_A_REVERSAL');
  if (entry.reversedBy !== null) return err('ALREADY_REVERSED');
  return ok(true);
}

// --- Redemptions ----------------------------------------------------------------------------------

export type RedemptionRequestError = 'ITEM_ARCHIVED' | 'INSUFFICIENT_COINS';

/** A child can ask for an active item they can afford (the cost is held at once). */
export function canRequestRedemption(input: {
  itemStatus: CatalogItemStatus;
  costCoins: number;
  balance: number;
}): Result<true, RedemptionRequestError> {
  if (input.itemStatus !== 'ACTIVE') return err('ITEM_ARCHIVED');
  if (input.balance < input.costCoins) return err('INSUFFICIENT_COINS');
  return ok(true);
}

export type RedemptionDecisionError = 'NOT_PENDING';

export function canDecideRedemption(
  status: RedemptionStatus,
): Result<true, RedemptionDecisionError> {
  return status === 'PENDING' ? ok(true) : err('NOT_PENDING');
}
