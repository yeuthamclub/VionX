// Pure helpers for the reward screens (no React, tested with Vitest).
import type {
  CapView,
  LedgerEntry,
  LevelInfo,
  RewardRulesConfig,
  SystemCaps,
} from '@vionx/contracts/client';
import {
  validateRewardRules,
  type RewardRulesConfig as DomainRules,
  type RuleViolation,
} from '@vionx/domain';
import { getLocale, t, type MessageKey } from '../i18n/index.ts';

/** 20000 → "20.000 ₫" (vi) or "20,000 VND" (en); display only, Coin is never paid out. */
export function formatVnd(amount: number, locale = getLocale()): string {
  const n = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'vi' ? '.' : ',');
  return locale === 'vi' ? `${n} ₫` : `${n} VND`;
}

/** Today's cap bar: how full it is (0..1) and its caption. */
export function capBar(cap: CapView): {
  fraction: number;
  caption: string;
  tierLine: string | null;
} {
  const fraction = cap.capXp === 0 ? 1 : Math.min(1, cap.rewardableXp / cap.capXp);
  const caption = cap.reached
    ? t('wallet.capReached', { coins: cap.capCoins })
    : t('wallet.capProgress', {
        xp: cap.rewardableXp,
        capXp: cap.capXp,
        coins: cap.projectedCoins,
      });
  const tierLine = cap.weekend
    ? t('wallet.weekendTier', { tier: cap.tier ?? 0, coins: cap.capCoins, max: cap.maxCapCoins })
    : null;
  return { fraction, caption, tierLine };
}

/** Level bar fraction (0..1). */
export function levelFraction(level: LevelInfo): number {
  return level.xpForNextLevel === 0 ? 1 : Math.min(1, level.xpIntoLevel / level.xpForNextLevel);
}

/** One ledger line: what happened and the signed amount ("+20 XP", "−5 Coin"). */
export function ledgerLine(entry: LedgerEntry): {
  title: string;
  amount: string;
  detail: string | null;
} {
  const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  if (entry.coinDelta !== null) {
    const title =
      entry.entryKind === 'DAY_CONVERSION'
        ? t('ledger.dayConversion', { day: entry.rewardDay ?? '' })
        : entry.entryKind === 'REDEMPTION_HOLD'
          ? t('ledger.redemption', { title: entry.label ?? '' })
          : t('ledger.reversal', { title: entry.label ?? '' });
    return { title, amount: `${sign(entry.coinDelta)} Coin`, detail: null };
  }
  const lifetime = entry.lifetimeXpDelta ?? 0;
  const title =
    entry.entryKind === 'REVERSAL' ? t('ledger.xpReversal') : (entry.label ?? t('ledger.xpGrant'));
  const detail = entry.cappedReason ? t(`ledger.capped.${entry.cappedReason}` as MessageKey) : null;
  return { title, amount: `${sign(lifetime)} XP`, detail };
}

/** Text form of the rules editor. */
export interface RulesForm {
  weekdayCapCoins: string;
  tier0: string;
  tier1: string;
  tier2: string;
  tier3: string;
  readingTasks: string;
  activityTasks: string;
  maxGrantsPerDay: string;
}

export function rulesToForm(rules: RewardRulesConfig): RulesForm {
  return {
    weekdayCapCoins: String(rules.weekdayCapCoins),
    tier0: String(rules.weekendTierCaps[0]),
    tier1: String(rules.weekendTierCaps[1]),
    tier2: String(rules.weekendTierCaps[2]),
    tier3: String(rules.weekendTierCaps[3]),
    readingTasks: String(rules.weekendGoals.readingTasks),
    activityTasks: String(rules.weekendGoals.activityTasks),
    maxGrantsPerDay: String(rules.micro.TASK_APPROVED.maxGrantsPerDay),
  };
}

/**
 * Parses the form into a full rules config and checks it against the system caps with the same
 * rule the server applies (stricter only). Field → message for each problem.
 */
export function formToRules(
  form: RulesForm,
  caps: SystemCaps,
): { rules: RewardRulesConfig | null; errors: Partial<Record<keyof RulesForm, string>> } {
  const errors: Partial<Record<keyof RulesForm, string>> = {};
  const num = (key: keyof RulesForm) => {
    const v = form[key].trim();
    if (!/^\d{1,5}$/.test(v)) {
      errors[key] = t('rules.notANumber');
      return 0;
    }
    return Number(v);
  };
  const rules: DomainRules = {
    weekdayCapCoins: num('weekdayCapCoins'),
    weekendTierCaps: [num('tier0'), num('tier1'), num('tier2'), num('tier3')],
    weekendGoals: { readingTasks: num('readingTasks'), activityTasks: num('activityTasks') },
    micro: { TASK_APPROVED: { maxGrantsPerDay: num('maxGrantsPerDay') } },
  };
  if (Object.keys(errors).length > 0) return { rules: null, errors };
  const fieldOf: Record<string, keyof RulesForm> = {
    weekdayCapCoins: 'weekdayCapCoins',
    'weekendTierCaps.0': 'tier0',
    'weekendTierCaps.1': 'tier1',
    'weekendTierCaps.2': 'tier2',
    'weekendTierCaps.3': 'tier3',
    'weekendGoals.readingTasks': 'readingTasks',
    'weekendGoals.activityTasks': 'activityTasks',
    'micro.TASK_APPROVED.maxGrantsPerDay': 'maxGrantsPerDay',
  };
  const systemCaps = {
    ...caps,
    weekendTierCaps: [0, 1, 2, 3].map((i) => caps.weekendTierCaps[i] ?? 0) as [
      number,
      number,
      number,
      number,
    ],
  };
  for (const v of validateRewardRules(rules, systemCaps)) {
    const key = fieldOf[v.field];
    if (key && !errors[key]) errors[key] = violationMessage(v);
  }
  return Object.keys(errors).length > 0 ? { rules: null, errors } : { rules, errors };
}

export function violationMessage(v: Pick<RuleViolation, 'error' | 'limit'>): string {
  return t(`rules.error.${v.error}` as MessageKey, { limit: v.limit ?? '' });
}
