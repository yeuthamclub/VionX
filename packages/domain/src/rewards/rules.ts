// Reward rules (Master Spec §14.2): the household's configurable caps, weekend milestone goals and
// micro-action caps. Parents may make rules stricter (lower caps, higher goals) but never raise a
// cap above the system cap.
import { isoWeekday } from '../calendar/dates.ts';
import type { TaskType, VerificationMode } from '../calendar/types.ts';
import {
  SYSTEM_CAPS,
  XP_RULE_IDS,
  type SystemCaps,
  type WeekendTier,
  type XpRuleId,
} from './types.ts';

export interface RewardRulesConfig {
  weekdayCapCoins: number;
  weekendTierCaps: [number, number, number, number];
  weekendGoals: {
    /** Completed READING tasks needed for Tier 2. */
    readingTasks: number;
    /** Completed SPORT tasks needed for Tier 2. */
    activityTasks: number;
  };
  /** Micro-action caps per XP rule. */
  micro: Record<XpRuleId, { maxGrantsPerDay: number }>;
}

/** Same as the system default row of app.reward_rules (version 1). */
export const DEFAULT_REWARD_RULES: RewardRulesConfig = {
  weekdayCapCoins: 20,
  weekendTierCaps: [20, 30, 40, 50],
  weekendGoals: { readingTasks: 1, activityTasks: 1 },
  micro: { TASK_APPROVED: { maxGrantsPerDay: 20 } },
};

/** Weekend goals: at least 1 (a goal of 0 would hand out the tier), at most this. */
export const MAX_WEEKEND_GOAL = 10;

export type RewardRulesError =
  | 'ABOVE_SYSTEM_CAP'
  | 'NOT_AN_INTEGER'
  | 'NEGATIVE'
  | 'TIERS_NOT_ASCENDING'
  | 'GOAL_OUT_OF_RANGE'
  | 'MICRO_CAP_OUT_OF_RANGE';

export interface RuleViolation {
  field: string;
  error: RewardRulesError;
  limit?: number;
}

/** Every reason the config is not allowed under `caps` (empty when valid). */
export function validateRewardRules(
  config: RewardRulesConfig,
  caps: SystemCaps = SYSTEM_CAPS,
): RuleViolation[] {
  const out: RuleViolation[] = [];
  const cap = (field: string, value: number, max: number, min = 0) => {
    if (!Number.isInteger(value)) out.push({ field, error: 'NOT_AN_INTEGER' });
    else if (value < min) out.push({ field, error: 'NEGATIVE', limit: min });
    else if (value > max) out.push({ field, error: 'ABOVE_SYSTEM_CAP', limit: max });
  };
  cap('weekdayCapCoins', config.weekdayCapCoins, caps.weekdayCapCoins);
  config.weekendTierCaps.forEach((v, i) =>
    cap(
      `weekendTierCaps.${i}`,
      v,
      Math.min(caps.weekendTierCaps[i as WeekendTier], caps.weekendMaxCoins),
    ),
  );
  for (let i = 1; i < 4; i++) {
    if (config.weekendTierCaps[i]! < config.weekendTierCaps[i - 1]!) {
      out.push({ field: `weekendTierCaps.${i}`, error: 'TIERS_NOT_ASCENDING' });
    }
  }
  for (const key of ['readingTasks', 'activityTasks'] as const) {
    const v = config.weekendGoals[key];
    if (!Number.isInteger(v) || v < 1 || v > MAX_WEEKEND_GOAL) {
      out.push({
        field: `weekendGoals.${key}`,
        error: 'GOAL_OUT_OF_RANGE',
        limit: MAX_WEEKEND_GOAL,
      });
    }
  }
  for (const rule of XP_RULE_IDS) {
    const v = config.micro[rule]?.maxGrantsPerDay;
    if (v === undefined || !Number.isInteger(v) || v < 1 || v > caps.maxGrantsPerRulePerDay) {
      out.push({
        field: `micro.${rule}.maxGrantsPerDay`,
        error: 'MICRO_CAP_OUT_OF_RANGE',
        limit: caps.maxGrantsPerRulePerDay,
      });
    }
  }
  return out;
}

export interface RewardRulesPatch {
  weekdayCapCoins?: number | undefined;
  weekendTierCaps?: [number, number, number, number] | undefined;
  weekendGoals?:
    { readingTasks?: number | undefined; activityTasks?: number | undefined } | undefined;
  micro?: Partial<Record<XpRuleId, { maxGrantsPerDay: number }>> | undefined;
}

/** `base` with the fields of `patch` (a PATCH body) applied. */
export function mergeRewardRules(
  base: RewardRulesConfig,
  patch: RewardRulesPatch,
): RewardRulesConfig {
  const micro = { ...base.micro };
  for (const rule of XP_RULE_IDS) {
    const p = patch.micro?.[rule];
    if (p) micro[rule] = { maxGrantsPerDay: p.maxGrantsPerDay };
  }
  return {
    weekdayCapCoins: patch.weekdayCapCoins ?? base.weekdayCapCoins,
    weekendTierCaps: [...(patch.weekendTierCaps ?? base.weekendTierCaps)] as [
      number,
      number,
      number,
      number,
    ],
    weekendGoals: {
      readingTasks: patch.weekendGoals?.readingTasks ?? base.weekendGoals.readingTasks,
      activityTasks: patch.weekendGoals?.activityTasks ?? base.weekendGoals.activityTasks,
    },
    micro,
  };
}

/**
 * The rules in force: a stored config read defensively (missing fields fall back to the defaults)
 * and clamped to the current system caps, so a cap lowered by the product later always wins.
 */
export function effectiveRewardRules(
  stored: unknown,
  caps: SystemCaps = SYSTEM_CAPS,
): RewardRulesConfig {
  const s = (
    typeof stored === 'object' && stored !== null ? stored : {}
  ) as Partial<RewardRulesConfig>;
  const int = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;
  const d = DEFAULT_REWARD_RULES;
  const tiers =
    Array.isArray(s.weekendTierCaps) && s.weekendTierCaps.length === 4
      ? s.weekendTierCaps
      : d.weekendTierCaps;
  const clampedTiers = tiers.map((v, i) =>
    Math.min(
      int(v, d.weekendTierCaps[i]!),
      caps.weekendTierCaps[i as WeekendTier],
      caps.weekendMaxCoins,
    ),
  );
  // Keep tiers ascending after clamping.
  for (let i = 1; i < 4; i++) clampedTiers[i] = Math.max(clampedTiers[i]!, clampedTiers[i - 1]!);
  const goal = (v: unknown, fallback: number) =>
    Math.min(MAX_WEEKEND_GOAL, Math.max(1, int(v, fallback)));
  const micro = {} as RewardRulesConfig['micro'];
  for (const rule of XP_RULE_IDS) {
    const v = int(s.micro?.[rule]?.maxGrantsPerDay, d.micro[rule].maxGrantsPerDay);
    micro[rule] = { maxGrantsPerDay: Math.min(Math.max(1, v), caps.maxGrantsPerRulePerDay) };
  }
  return {
    weekdayCapCoins: Math.min(int(s.weekdayCapCoins, d.weekdayCapCoins), caps.weekdayCapCoins),
    weekendTierCaps: clampedTiers as [number, number, number, number],
    weekendGoals: {
      readingTasks: goal(s.weekendGoals?.readingTasks, d.weekendGoals.readingTasks),
      activityTasks: goal(s.weekendGoals?.activityTasks, d.weekendGoals.activityTasks),
    },
    micro,
  };
}

// --- Days, facts and tiers ------------------------------------------------------------------------

/** Saturday or Sunday (household-local day). */
export function isWeekend(day: string): boolean {
  return isoWeekday(day) >= 6;
}

/** Task types that count as daily learning for Tier 1. */
export const LEARNING_TASK_TYPES: readonly TaskType[] = [
  'HOMEWORK',
  'LEARNING',
  'READING',
  'ENGLISH',
];
/** Reading goal (Tier 2) until the reading library (M16) reports reading sessions. */
export const READING_TASK_TYPES: readonly TaskType[] = ['READING'];
/** Physical activity goal (Tier 2) until Health Connect / manual logs (M18). */
export const ACTIVITY_TASK_TYPES: readonly TaskType[] = ['SPORT'];

/** One task day of the child, as the facts query returns it. */
export interface TaskDayFact {
  type: TaskType;
  required: boolean;
  completed: boolean;
  verificationMode: VerificationMode;
}

export interface DayFacts {
  requiredLearningTasks: number;
  requiredLearningCompleted: number;
  readingCompleted: number;
  activityCompleted: number;
  /** Optional tasks completed and approved by a parent (bonus challenge / family mission). */
  bonusApproved: number;
}

export const NO_FACTS: DayFacts = {
  requiredLearningTasks: 0,
  requiredLearningCompleted: 0,
  readingCompleted: 0,
  activityCompleted: 0,
  bonusApproved: 0,
};

/** Facts of one day from its task days (Master Spec §14.2, until M16/M18 add their own facts). */
export function dayFactsFrom(tasks: readonly TaskDayFact[]): DayFacts {
  const facts = { ...NO_FACTS };
  for (const t of tasks) {
    if (t.required && LEARNING_TASK_TYPES.includes(t.type)) {
      facts.requiredLearningTasks++;
      if (t.completed) facts.requiredLearningCompleted++;
    }
    if (!t.completed) continue;
    if (READING_TASK_TYPES.includes(t.type)) facts.readingCompleted++;
    if (ACTIVITY_TASK_TYPES.includes(t.type)) facts.activityCompleted++;
    if (
      !t.required &&
      (t.verificationMode === 'PARENT_APPROVAL' || t.verificationMode === 'PHOTO_PROOF')
    ) {
      facts.bonusApproved++;
    }
  }
  return facts;
}

/**
 * Weekend milestone tier (Master Spec §14.2):
 * - 1: all required daily learning tasks completed (there must be at least one);
 * - 2: Tier 1 + reading goal + physical activity goal;
 * - 3: Tier 2 + one parent-approved bonus task.
 */
export function weekendTier(facts: DayFacts, rules: RewardRulesConfig): WeekendTier {
  const tier1 =
    facts.requiredLearningTasks > 0 &&
    facts.requiredLearningCompleted >= facts.requiredLearningTasks;
  if (!tier1) return 0;
  const tier2 =
    facts.readingCompleted >= rules.weekendGoals.readingTasks &&
    facts.activityCompleted >= rules.weekendGoals.activityTasks;
  if (!tier2) return 1;
  return facts.bonusApproved >= 1 ? 3 : 2;
}

/** Coin cap of a day: the weekday cap, or the weekend cap of the reached tier. */
export function dayCapCoins(
  day: string,
  tier: WeekendTier | null,
  rules: RewardRulesConfig,
  caps: SystemCaps = SYSTEM_CAPS,
): number {
  if (!isWeekend(day)) return Math.min(rules.weekdayCapCoins, caps.weekdayCapCoins);
  const t = tier ?? 0;
  return Math.min(rules.weekendTierCaps[t], caps.weekendTierCaps[t], caps.weekendMaxCoins);
}

/** The highest cap the day can reach (weekday cap, or the top weekend tier). */
export function maxDayCapCoins(
  day: string,
  rules: RewardRulesConfig,
  caps: SystemCaps = SYSTEM_CAPS,
): number {
  return isWeekend(day)
    ? Math.max(...([0, 1, 2, 3] as const).map((t) => dayCapCoins(day, t, rules, caps)))
    : dayCapCoins(day, null, rules, caps);
}
