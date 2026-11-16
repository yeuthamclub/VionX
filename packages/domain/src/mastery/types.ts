// M06 mastery engine (TASK_PACKS/M06.md, Master Spec §10). Pure rules; the api applies them inside
// one transaction per answer. Weights and thresholds come from app.mastery_config.

/** Mirrors version 1 of app.mastery_config (supabase/migrations/0010_learning.sql). */
export interface MasteryConfig {
  /** Points a correct answer is worth before the other weights. */
  gainCorrect: number;
  /** Points a wrong answer costs before the other weights. */
  lossIncorrect: number;
  /** Weight per item difficulty 1-5. A wrong answer uses the mirrored weight (easy costs more). */
  difficultyWeights: readonly [number, number, number, number, number];
  /** Each hint lowers the independence weight by this much, down to `minIndependence`. */
  hintPenalty: number;
  minIndependence: number;
  /** Answers on one skill closer together than this have diminishing impact. */
  minIntervalSec: number;
  /** Recency weight of an answer given immediately after the previous one. */
  recencyFloor: number;
  thresholds: { learning: number; proficient: number; mastered: number };
  /** Retained needs a correct answer at least this many days after Mastered. */
  retentionMinDays: number;
  /** Smoothing of `recent_accuracy` (exponential moving average). */
  recentAlpha: number;
  /** Attempts at which confidence is 0.5. */
  confidenceHalf: number;
  startDifficulty: number;
  /** Share of session slots given to due reviews. */
  reviewShare: number;
  diagnostic: {
    minItems: number;
    maxItems: number;
    defaultItems: number;
    /** Highest score a diagnostic can place a skill at (below Mastered). */
    placementCeiling: number;
    /** Skills of the topic the diagnostic did not reach get the topic accuracy times this. */
    untestedFactor: number;
  };
  review: { firstIntervalsDays: readonly number[]; startEase: number; minEase: number };
  session: {
    itemsYoung: number;
    items: number;
    minutesYoung: number;
    minutes: number;
    /** Grades up to this one use the young-learner mode (large targets, read aloud, short). */
    youngMaxGrade: number;
  };
  xp: { perCorrect: number; maxPerSession: number; maxSessionGrantsPerDay: number };
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  gainCorrect: 8,
  lossIncorrect: 4,
  difficultyWeights: [0.6, 0.8, 1, 1.2, 1.4],
  hintPenalty: 0.2,
  minIndependence: 0.2,
  minIntervalSec: 20,
  recencyFloor: 0.25,
  thresholds: { learning: 25, proficient: 60, mastered: 85 },
  retentionMinDays: 7,
  recentAlpha: 0.3,
  confidenceHalf: 5,
  startDifficulty: 2,
  reviewShare: 0.3,
  diagnostic: {
    minItems: 8,
    maxItems: 12,
    defaultItems: 10,
    placementCeiling: 80,
    untestedFactor: 0.75,
  },
  review: { firstIntervalsDays: [1, 3], startEase: 2.5, minEase: 1.3 },
  session: { itemsYoung: 10, items: 15, minutesYoung: 15, minutes: 25, youngMaxGrade: 3 },
  xp: { perCorrect: 5, maxPerSession: 100, maxSessionGrantsPerDay: 10 },
};

/** Stored config merged over the defaults, so a missing key never breaks a session. */
export function masteryConfigFrom(stored: unknown): MasteryConfig {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<MasteryConfig>;
  const d = DEFAULT_MASTERY_CONFIG;
  return {
    ...d,
    ...s,
    thresholds: { ...d.thresholds, ...s.thresholds },
    diagnostic: { ...d.diagnostic, ...s.diagnostic },
    review: { ...d.review, ...s.review },
    session: { ...d.session, ...s.session },
    xp: { ...d.xp, ...s.xp },
  };
}

export const SESSION_MODES = ['PRACTICE', 'REVIEW', 'DIAGNOSTIC'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/** Display states (Master Spec §10.2). */
export const MASTERY_STATES = [
  'NOT_LEARNED',
  'INTRODUCED',
  'LEARNING',
  'PROFICIENT',
  'MASTERED',
  'RETAINED',
] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

/** Skill state (Master Spec §10.1). Times are epoch milliseconds or null. */
export interface SkillState {
  masteryScore: number;
  confidenceScore: number;
  attemptCount: number;
  correctCount: number;
  recentAccuracy: number;
  avgResponseMs: number | null;
  currentDifficulty: number;
  lastAttemptAt: number | null;
  lastMasteredAt: number | null;
  retainedAt: number | null;
}

export const newSkillState = (config: MasteryConfig = DEFAULT_MASTERY_CONFIG): SkillState => ({
  masteryScore: 0,
  confidenceScore: 0,
  attemptCount: 0,
  correctCount: 0,
  recentAccuracy: 0,
  avgResponseMs: null,
  currentDifficulty: config.startDifficulty,
  lastAttemptAt: null,
  lastMasteredAt: null,
  retainedAt: null,
});

export interface AnswerEvidence {
  correct: boolean;
  /** Item difficulty 1-5. */
  difficulty: number;
  /** Hints taken before answering (0-4). */
  hintsUsed: number;
  responseMs?: number | null | undefined;
  /** Epoch milliseconds of the answer. */
  at: number;
}

export const LEARNING_EVENT_TYPES = { sessionFinished: 'learning.session_finished' } as const;
export const LEARNING_EVENT_NAMES = {
  'learning.session_finished': 'LearningSessionFinished',
} as const;
/** XP rule of a finished session (task pack name `learning.correct_answer`). */
export const LEARNING_XP_RULE_ID = 'LEARNING_CORRECT_ANSWER';
export const LEARNING_XP_SOURCE_TYPE = 'learning_session';
/** Postgres advisory lock class for per-student learning work. */
export const LEARNING_LOCK_CLASS = 4006;

export const DAY_MS = 86_400_000;
export const clampDifficulty = (d: number) => Math.min(5, Math.max(1, Math.round(d)));
