// M04 reward economy constants (Master Spec §14). Mirrored by app.system_caps and the default row of
// app.reward_rules in supabase/migrations/0009_rewards.sql (an integration test keeps them equal).

/** Product-level safety caps (§14.1, §14.2). Parents can lower caps, never raise them. */
export interface SystemCaps {
  /** Rewardable XP that convert to one Coin. */
  xpPerCoin: number;
  /** Nominal VND value of one Coin (display only, never paid out). */
  coinNominalVnd: number;
  /** Monday-Friday: most Coin per child per household-local day. */
  weekdayCapCoins: number;
  /** Saturday-Sunday milestone tiers 0-3. */
  weekendTierCaps: readonly [number, number, number, number];
  /** Absolute weekend maximum per child per day. */
  weekendMaxCoins: number;
  /** Micro-action cap: grants of one rule per child per day. */
  maxGrantsPerRulePerDay: number;
  /** A grant counts toward Coin only up to this many days after its reward day. */
  lateGrantDays: number;
}

export const SYSTEM_CAPS: SystemCaps = {
  xpPerCoin: 100,
  coinNominalVnd: 1000,
  weekdayCapCoins: 20,
  weekendTierCaps: [20, 30, 40, 50],
  weekendMaxCoins: 50,
  maxGrantsPerRulePerDay: 30,
  lateGrantDays: 2,
};

/** `app.system_caps` keys → values (the database form of SYSTEM_CAPS). */
export function systemCapRows(caps: SystemCaps = SYSTEM_CAPS): Record<string, number> {
  return {
    XP_PER_COIN: caps.xpPerCoin,
    COIN_NOMINAL_VND: caps.coinNominalVnd,
    WEEKDAY_CAP_COINS: caps.weekdayCapCoins,
    WEEKEND_TIER0_CAP_COINS: caps.weekendTierCaps[0],
    WEEKEND_TIER1_CAP_COINS: caps.weekendTierCaps[1],
    WEEKEND_TIER2_CAP_COINS: caps.weekendTierCaps[2],
    WEEKEND_TIER3_CAP_COINS: caps.weekendTierCaps[3],
    WEEKEND_MAX_COINS: caps.weekendMaxCoins,
    MAX_GRANTS_PER_RULE_PER_DAY: caps.maxGrantsPerRulePerDay,
    LATE_GRANT_DAYS: caps.lateGrantDays,
  };
}

/**
 * Reads `app.system_caps` rows. A missing key falls back to the built-in cap, and a stored value
 * can only make a cap stricter than the built-in one (a bad row never loosens the economy).
 */
export function systemCapsFromRows(rows: readonly { key: string; value: number }[]): SystemCaps {
  const stored = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const pick = (key: string, fallback: number) => {
    const v = stored.get(key);
    return v === undefined || !Number.isInteger(v) || v < 0 ? fallback : Math.min(v, fallback);
  };
  const d = SYSTEM_CAPS;
  return {
    // Not caps but the exchange rate and display value: taken as stored when valid.
    xpPerCoin: Math.max(1, stored.get('XP_PER_COIN') ?? d.xpPerCoin),
    coinNominalVnd: stored.get('COIN_NOMINAL_VND') ?? d.coinNominalVnd,
    weekdayCapCoins: pick('WEEKDAY_CAP_COINS', d.weekdayCapCoins),
    weekendTierCaps: [
      pick('WEEKEND_TIER0_CAP_COINS', d.weekendTierCaps[0]),
      pick('WEEKEND_TIER1_CAP_COINS', d.weekendTierCaps[1]),
      pick('WEEKEND_TIER2_CAP_COINS', d.weekendTierCaps[2]),
      pick('WEEKEND_TIER3_CAP_COINS', d.weekendTierCaps[3]),
    ],
    weekendMaxCoins: pick('WEEKEND_MAX_COINS', d.weekendMaxCoins),
    maxGrantsPerRulePerDay: pick('MAX_GRANTS_PER_RULE_PER_DAY', d.maxGrantsPerRulePerDay),
    lateGrantDays: pick('LATE_GRANT_DAYS', d.lateGrantDays),
  };
}

/** XP rules (the `rule_id` of an XP grant). LearningSessionFinished joins in M06. */
export const XP_RULE_IDS = ['TASK_APPROVED'] as const;
export type XpRuleId = (typeof XP_RULE_IDS)[number];

/** Rule ids of Coin entries. */
export const COIN_RULE_IDS = {
  dayConversion: 'DAY_CONVERSION',
  redemption: 'REDEMPTION',
  reversal: 'REVERSAL',
} as const;

/** `source_type` values of ledger entries. */
export const LEDGER_SOURCE_TYPES = {
  taskCompletion: 'task_completion',
  dailySnapshot: 'daily_snapshot',
  redemption: 'reward_redemption',
  reversal: 'reversal',
} as const;

export const COIN_ENTRY_KINDS = ['DAY_CONVERSION', 'REDEMPTION_HOLD', 'REVERSAL'] as const;
export type CoinEntryKind = (typeof COIN_ENTRY_KINDS)[number];

/** Why a grant gave less than its XP (stored as `capped_reason`). */
export const XP_CAPPED_REASONS = ['DAILY_XP_CAP', 'MICRO_CAP', 'LATE'] as const;
export type XpCappedReason = (typeof XP_CAPPED_REASONS)[number];

export const WEEKEND_TIERS = [0, 1, 2, 3] as const;
export type WeekendTier = (typeof WEEKEND_TIERS)[number];

export const REDEMPTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

export const CATALOG_ITEM_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number];

/** Icons the app can draw for a catalog item. */
export const CATALOG_ICONS = [
  'gift',
  'screen',
  'game',
  'book',
  'outing',
  'food',
  'toy',
  'star',
] as const;
export type CatalogIcon = (typeof CATALOG_ICONS)[number];

/** Most Coin one catalog item may cost. */
export const MAX_CATALOG_COST_COINS = 10_000;

/** Outbox event types (lowercase dotted, like M03); Master Spec §25 names go in `eventName`. */
export const REWARD_EVENT_TYPES = {
  xpGranted: 'xp.granted',
  coinGranted: 'coin.granted',
  redeemed: 'reward.redeemed',
  settlementRequested: 'reward.settlement_requested',
} as const;

export const REWARD_EVENT_NAMES = {
  'xp.granted': 'XpGranted',
  'coin.granted': 'CoinGranted',
  'reward.redeemed': 'RewardRedeemed',
} as const;

/** Postgres advisory lock class for per-student reward work (`pg_advisory_xact_lock(class, key)`). */
export const REWARD_LOCK_CLASS = 4004;
