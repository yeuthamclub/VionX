// M08 parent dashboard & school gradebook (TASK_PACKS/M08.md, Master Spec §7, §12). Pure rules.
// School grades and app mastery are separate facts: nothing here combines them into one number.
import { addDays, daysBetween } from '../calendar/dates.ts';
import type { MasteryState } from '../mastery/types.ts';

/** Mirrors version 1 of app.dashboard_config (supabase/migrations/0014_dashboard_gradebook.sql). */
export interface DashboardConfig {
  /** `low`: below it the data is INSUFFICIENT; `ok`: from it on the data is OK. */
  sufficiency: {
    skillAttempts: Threshold;
    subjectAttempts: Threshold;
    grades: Threshold;
    activeDays: Threshold;
  };
  /** Days of each `range` value. */
  ranges: Record<DashboardRange, number>;
  /** A grade trend smaller than this many percent points is FLAT. */
  trendMinDeltaPercent: number;
  /** Recent accuracy this far above the overall accuracy = improving. */
  improvingMargin: number;
  /** Recent accuracy this far below the overall accuracy = at risk. */
  atRiskMargin: number;
  /** Forgetting risk from which a learned skill is at risk. */
  atRiskForgetting: number;
  skillListLimit: number;
  examHorizonDays: number;
}
export interface Threshold {
  low: number;
  ok: number;
}

export const DASHBOARD_RANGES = ['7d', '30d', '90d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  sufficiency: {
    skillAttempts: { low: 3, ok: 8 },
    subjectAttempts: { low: 10, ok: 30 },
    grades: { low: 2, ok: 4 },
    activeDays: { low: 3, ok: 7 },
  },
  ranges: { '7d': 7, '30d': 30, '90d': 90 },
  trendMinDeltaPercent: 5,
  improvingMargin: 0.1,
  atRiskMargin: 0.15,
  atRiskForgetting: 0.6,
  skillListLimit: 5,
  examHorizonDays: 14,
};

/** Stored config merged over the defaults, so a missing key never breaks the dashboard. */
export function dashboardConfigFrom(stored: unknown): DashboardConfig {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<DashboardConfig>;
  const d = DEFAULT_DASHBOARD_CONFIG;
  return {
    ...d,
    ...s,
    sufficiency: { ...d.sufficiency, ...s.sufficiency },
    ranges: { ...d.ranges, ...s.ranges },
  };
}

/** Master Spec §7: every interpretive widget says how much data it stands on. */
export const DATA_SUFFICIENCY = ['INSUFFICIENT', 'LOW', 'OK'] as const;
export type DataSufficiency = (typeof DATA_SUFFICIENCY)[number];

export function sufficiency(count: number, threshold: Threshold): DataSufficiency {
  if (count >= threshold.ok) return 'OK';
  return count >= threshold.low ? 'LOW' : 'INSUFFICIENT';
}

/** First and last household-local day of a range ending today. */
export function rangeDays(
  config: DashboardConfig,
  range: DashboardRange,
  today: string,
): { from: string; to: string; days: number } {
  const days = config.ranges[range];
  return { from: addDays(today, -(days - 1)), to: today, days };
}

// --- School gradebook (§12) -----------------------------------------------------------------------

export const ASSESSMENT_TYPES = [
  'ORAL',
  'SHORT_QUIZ',
  'HOMEWORK',
  'PERIODIC_TEST',
  'MIDTERM',
  'FINAL',
  'MOCK',
  'CUSTOM',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const SEMESTERS = ['HK1', 'HK2', 'SUMMER'] as const;
export type Semester = (typeof SEMESTERS)[number];

export const ASSESSMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type AssessmentContentType = (typeof ASSESSMENT_CONTENT_TYPES)[number];
export const MAX_ASSESSMENT_FILE_BYTES = 10 * 1024 * 1024;
export const ASSESSMENT_FILE_URL_TTL_SECONDS = 15 * 60;

/**
 * School year and semester of a day in Vietnam: the year starts in September; HK1 runs to the
 * middle of January, HK2 to the end of May, then summer. A default the parent can change.
 */
export function schoolTermOf(day: string): { schoolYear: string; semester: Semester } {
  const year = Number(day.slice(0, 4));
  const monthDay = day.slice(5);
  const start = monthDay >= '09-01' ? year : year - 1;
  const semester: Semester =
    monthDay >= '09-01' || monthDay < '01-16' ? 'HK1' : monthDay < '06-01' ? 'HK2' : 'SUMMER';
  return { schoolYear: `${start}-${start + 1}`, semester };
}

/** A score as a share of its maximum, 0-100 with one decimal. */
export function gradePercent(score: number, maxScore: number): number {
  if (!(maxScore > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, score / maxScore)) * 1000) / 10;
}

const EXTENSIONS: Record<AssessmentContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.(jpg|png|webp|pdf)$`);

/** Storage path of an assessment attachment: one folder per household and child. */
export function assessmentFilePath(
  ids: { householdId: string; studentId: string; fileId: string },
  contentType: AssessmentContentType,
): string {
  return `${ids.householdId}/${ids.studentId}/${ids.fileId}.${EXTENSIONS[contentType]}`;
}

/** A client-supplied attachment path must be one we signed for this child. */
export function assessmentFileBelongsTo(
  path: string,
  ids: { householdId: string; studentId: string },
): boolean {
  const m = FILE_PATH_RE.exec(path);
  return Boolean(m && m[1] === ids.householdId && m[2] === ids.studentId);
}

export type TrendDirection = 'UP' | 'DOWN' | 'FLAT';

export interface GradePoint {
  /** Household-local day. */
  day: string;
  percent: number;
}

export interface GradeTrend {
  count: number;
  /** Mean of all points, or null without any. */
  averagePercent: number | null;
  /** Newer half against older half; FLAT below `trendMinDeltaPercent` or with one point. */
  direction: TrendDirection;
  deltaPercent: number;
  sufficiency: DataSufficiency;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Trend of one subject's school grades over time (the points may come in any order). */
export function gradeTrend(points: readonly GradePoint[], config: DashboardConfig): GradeTrend {
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const count = sorted.length;
  const level = sufficiency(count, config.sufficiency.grades);
  if (count === 0) {
    return { count, averagePercent: null, direction: 'FLAT', deltaPercent: 0, sufficiency: level };
  }
  const half = Math.floor(count / 2);
  const delta =
    half === 0
      ? 0
      : round1(
          mean(sorted.slice(count - half).map((p) => p.percent)) -
            mean(sorted.slice(0, half).map((p) => p.percent)),
        );
  return {
    count,
    averagePercent: round1(mean(sorted.map((p) => p.percent))),
    direction: Math.abs(delta) < config.trendMinDeltaPercent ? 'FLAT' : delta > 0 ? 'UP' : 'DOWN',
    deltaPercent: delta,
    sufficiency: level,
  };
}

// --- Activity -------------------------------------------------------------------------------------

/**
 * Consecutive active days ending today. A day without activity ends the streak, except today
 * itself: the child still has the rest of the day.
 */
export function activeStreak(activeDays: readonly string[], today: string): number {
  const active = new Set(activeDays);
  let day = active.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (active.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** Done over total as 0-1 with three decimals; null when nothing was planned. */
export function completionRate(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, done / total)) * 1000) / 1000;
}

// --- Skills improving / at risk -------------------------------------------------------------------

export interface DashboardSkill {
  skillId: string;
  subject: string;
  title: string;
  state: MasteryState;
  masteryScore: number;
  attemptCount: number;
  correctCount: number;
  /** 0-1, smoothed over the latest answers. */
  recentAccuracy: number;
  /** 0-1. */
  forgettingRisk: number;
  /** Household-local day of the last answer, or null. */
  lastAttemptDay: string | null;
}

export type SkillSignal = 'IMPROVING' | 'AT_RISK';
export type SkillSignalReason = 'RECENT_ABOVE_AVERAGE' | 'RECENT_BELOW_AVERAGE' | 'FORGETTING';

export interface SkillInsight {
  skillId: string;
  subject: string;
  title: string;
  state: MasteryState;
  masteryScore: number;
  signal: SkillSignal;
  reason: SkillSignalReason;
  sufficiency: DataSufficiency;
}

/**
 * Improving: practised inside the range and recently more accurate than overall. At risk:
 * recently less accurate than overall, or learned but likely forgotten. A skill with too few
 * answers (INSUFFICIENT) is in neither list.
 */
export function skillInsights(
  skills: readonly DashboardSkill[],
  range: { from: string; to: string },
  config: DashboardConfig,
): { improving: SkillInsight[]; atRisk: SkillInsight[] } {
  type Weighted = { insight: SkillInsight; weight: number };
  const improving: Weighted[] = [];
  const atRisk: Weighted[] = [];
  for (const s of skills) {
    const level = sufficiency(s.attemptCount, config.sufficiency.skillAttempts);
    if (level === 'INSUFFICIENT') continue;
    const diff = s.recentAccuracy - s.correctCount / s.attemptCount;
    const inRange =
      s.lastAttemptDay !== null && s.lastAttemptDay >= range.from && s.lastAttemptDay <= range.to;
    const base = {
      skillId: s.skillId,
      subject: s.subject,
      title: s.title,
      state: s.state,
      masteryScore: s.masteryScore,
      sufficiency: level,
    };
    if (diff <= -config.atRiskMargin) {
      atRisk.push({
        insight: { ...base, signal: 'AT_RISK', reason: 'RECENT_BELOW_AVERAGE' },
        weight: -diff,
      });
    } else if (s.state !== 'NOT_LEARNED' && s.forgettingRisk >= config.atRiskForgetting) {
      atRisk.push({
        insight: { ...base, signal: 'AT_RISK', reason: 'FORGETTING' },
        weight: s.forgettingRisk,
      });
    } else if (inRange && diff >= config.improvingMargin) {
      improving.push({
        insight: { ...base, signal: 'IMPROVING', reason: 'RECENT_ABOVE_AVERAGE' },
        weight: diff,
      });
    }
  }
  const top = (list: Weighted[]) =>
    list
      .sort((a, b) => b.weight - a.weight || (a.insight.skillId < b.insight.skillId ? -1 : 1))
      .slice(0, config.skillListLimit)
      .map((w) => w.insight);
  return { improving: top(improving), atRisk: top(atRisk) };
}

export interface SubjectMastery {
  subject: string;
  skills: number;
  /** Skills with at least one answer. */
  practised: number;
  /** Skills at Proficient or above. */
  proficient: number;
  /** Mean score of the practised skills (0-100), or null when none was practised. */
  meanScore: number | null;
  attempts: number;
  sufficiency: DataSufficiency;
}

const KNOWN: readonly MasteryState[] = ['PROFICIENT', 'MASTERED', 'RETAINED'];

/** App mastery per library subject (shown beside the school grades of that subject). */
export function subjectMastery(
  skills: readonly Pick<DashboardSkill, 'subject' | 'state' | 'masteryScore' | 'attemptCount'>[],
  config: DashboardConfig,
): SubjectMastery[] {
  const bySubject = new Map<string, (typeof skills)[number][]>();
  for (const s of skills) bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), s]);
  return [...bySubject]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([subject, list]) => {
      const practised = list.filter((s) => s.attemptCount > 0);
      const attempts = list.reduce((n, s) => n + s.attemptCount, 0);
      return {
        subject,
        skills: list.length,
        practised: practised.length,
        proficient: list.filter((s) => KNOWN.includes(s.state)).length,
        meanScore: practised.length ? round1(mean(practised.map((s) => s.masteryScore))) : null,
        attempts,
        sufficiency: sufficiency(attempts, config.sufficiency.subjectAttempts),
      };
    });
}

/** Days from today to a later day (0 = today); used for upcoming exams. */
export const daysUntil = (today: string, day: string) => daysBetween(today, day);
