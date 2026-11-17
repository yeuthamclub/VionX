// M07 Today planner (TASK_PACKS/M07.md, Master Spec §11). Pure rules; the api and the worker run
// them through one shared regeneration. Weights come from app.planner_config.
import type {
  OccurrenceStatus,
  TaskPriority,
  TaskType,
  VerificationMode,
} from '../calendar/types.ts';
import type { PathSkill } from '../mastery/path.ts';

/** Mirrors version 1 of app.planner_config (supabase/migrations/0012_today_planner.sql). */
export interface PlannerConfig {
  /** Points of each §11 term when its factor is 1. */
  weights: {
    urgency: number;
    prerequisiteGap: number;
    forgettingRisk: number;
    curriculumImportance: number;
    examRelevance: number;
    parentPriority: number;
    recentWorkloadPenalty: number;
  };
  /** Length of one learning item by grade band, ascending by `maxGrade`. */
  sessionMinutes: readonly { maxGrade: number; minutes: number }[];
  /** Daily budget without a parent setting = this many sessions. */
  defaultBudgetSessions: number;
  /** Household-local hours a child can be asked to work in. */
  dayWindow: { start: string; end: string };
  /** Exams this many days ahead (or closer) create exam-prep items. */
  examHorizonDays: number;
  /** An exam without a skill list prepares this many of the subject's weakest skills. */
  examSkillsWithoutList: number;
  /** Urgency factor of a task that is not required (a required task due today is 1). */
  optionalTaskUrgency: number;
  /** Minutes of a task without a duration estimate. */
  defaultTaskMinutes: number;
  /** At most this many learning items are proposed a day. */
  maxLearningItems: number;
  /** A stored plan older than this is regenerated on read. */
  maxAgeMinutes: number;
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  weights: {
    urgency: 30,
    prerequisiteGap: 20,
    forgettingRisk: 20,
    curriculumImportance: 10,
    examRelevance: 40,
    parentPriority: 20,
    recentWorkloadPenalty: 15,
  },
  sessionMinutes: [
    { maxGrade: 3, minutes: 15 },
    { maxGrade: 6, minutes: 25 },
    { maxGrade: 9, minutes: 35 },
    { maxGrade: 12, minutes: 45 },
  ],
  defaultBudgetSessions: 3,
  dayWindow: { start: '06:00', end: '21:30' },
  examHorizonDays: 14,
  examSkillsWithoutList: 2,
  optionalTaskUrgency: 0.4,
  defaultTaskMinutes: 15,
  maxLearningItems: 6,
  maxAgeMinutes: 15,
};

/** Stored config merged over the defaults, so a missing key never breaks a plan. */
export function plannerConfigFrom(stored: unknown): PlannerConfig {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<PlannerConfig>;
  const d = DEFAULT_PLANNER_CONFIG;
  return {
    ...d,
    ...s,
    weights: { ...d.weights, ...s.weights },
    dayWindow: { ...d.dayWindow, ...s.dayWindow },
  };
}

export const PLAN_ITEM_KINDS = [
  'PARENT_TASK',
  'HOMEWORK',
  'EXAM_PREP',
  'WEAK_PREREQUISITE',
  'DUE_REVIEW',
  'READING_GOAL',
  'ACTIVITY_GOAL',
  'NEXT_SKILL',
] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

export const TASK_ITEM_KINDS: readonly PlanItemKind[] = [
  'PARENT_TASK',
  'HOMEWORK',
  'READING_GOAL',
  'ACTIVITY_GOAL',
];
export const isTaskKind = (kind: PlanItemKind) => TASK_ITEM_KINDS.includes(kind);

export const PLAN_ITEM_STATUSES = [
  'PLANNED',
  'STARTED',
  'PENDING_APPROVAL',
  'DONE',
  'SKIPPED',
  'REMOVED',
] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];

/** Why an item has its priority: one entry per §11 term that applies. */
export const PLAN_REASON_CODES = [
  'DUE_TODAY',
  'EXAM_SOON',
  'EXAM_RELEVANT',
  'PREREQUISITE_GAP',
  'REVIEW_DUE',
  'NEXT_IN_CURRICULUM',
  'PARENT_PRIORITY',
  'WORKLOAD_TODAY',
] as const;
export type PlanReasonCode = (typeof PLAN_REASON_CODES)[number];

export interface PlanReason {
  code: PlanReasonCode;
  /** Points this term adds to (or, when negative, takes from) the priority. */
  points: number;
  params?: Record<string, string | number | boolean>;
}

export type PlanLink =
  | { type: 'TASK'; taskId: string; occurrenceId: string; verificationMode: VerificationMode }
  | { type: 'SESSION'; mode: 'PRACTICE' | 'REVIEW'; skillIds: string[]; subject: string };

export interface PlanItem {
  kind: PlanItemKind;
  /** Stable identity inside a plan. */
  refKey: string;
  refId: string | null;
  title: string;
  /** Library subject (`math`, `viet`…) or null. */
  subject: string | null;
  minutes: number;
  priority: number;
  reasons: PlanReason[];
  status: PlanItemStatus;
  pinned: boolean;
  required: boolean;
  inBudget: boolean;
  rewardXp: number;
  link: PlanLink;
  detail: Record<string, string | number | boolean>;
}

export interface PlannerTask {
  occurrenceId: string;
  taskId: string;
  type: TaskType;
  title: string;
  subject: string | null;
  durationMinutes: number | null;
  priority: TaskPriority;
  required: boolean;
  rewardXp: number;
  verificationMode: VerificationMode;
  status: OccurrenceStatus;
}

export interface PlannerExam {
  eventId: string;
  title: string;
  /** Household-local days from today (0 = today). */
  daysUntil: number;
  subject: string | null;
  skillIds: readonly string[];
}

export interface PlannerSkill extends PathSkill {
  subject: string;
  title: string;
  /** 0-1 (Master Spec §10.1). */
  forgettingRisk: number;
}

export interface PlannerInput {
  grade: number;
  /** Epoch milliseconds. */
  now: number;
  tasks: readonly PlannerTask[];
  exams: readonly PlannerExam[];
  skills: readonly PlannerSkill[];
  /** Learning already done today (finished sessions with at least one answer). */
  finished: { skillIds: readonly string[]; reviewSubjects: readonly string[] };
  /** Minutes of the day window not taken by school or calendar events. */
  freeMinutes: number;
  /** Parent setting, or null for the default of the grade. */
  parentDailyMinutes: number | null;
  /** XP a learning item can give at most (reward hint). */
  sessionXp: number;
  /** Items of the stored plan of the same day. */
  existing: readonly PlanItem[];
}

export interface TodayPlan {
  budgetMinutes: number;
  sessionMinutes: number;
  items: PlanItem[];
}

/** School subject code (app.school_subjects) → library subject of the launch libraries. */
export const LIBRARY_SUBJECT_OF: Readonly<Record<string, string>> = {
  TOAN: 'math',
  TIENG_VIET: 'viet',
  NGU_VAN: 'lit',
  TIENG_ANH: 'eng',
  KHTN: 'sci',
  TNXH: 'natsoc',
};

export const PLANNER_EVENT_TYPES = { dayStartRequested: 'planner.day_start_requested' } as const;
/** Postgres advisory lock class for per-student plan regeneration. */
export const PLANNER_LOCK_CLASS = 4007;
