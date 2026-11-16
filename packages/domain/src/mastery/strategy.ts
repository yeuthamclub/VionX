// Mastery strategy (Master Spec §10.3). The formula sits behind `MasteryStrategy` so a Bayesian/IRT
// model can replace it later without touching sessions.
import {
  clampDifficulty,
  DAY_MS,
  type AnswerEvidence,
  type MasteryConfig,
  type MasteryState,
  type SkillState,
} from './types.ts';

export interface MasteryUpdate {
  state: SkillState;
  /** Change of `masteryScore` caused by this answer (after clamping to 0-100). */
  delta: number;
}

export interface MasteryStrategy {
  /** Applies one answer to a skill state. */
  apply(state: SkillState, evidence: AnswerEvidence): MasteryUpdate;
  displayState(state: SkillState): MasteryState;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function difficultyWeight(config: MasteryConfig, difficulty: number, correct: boolean) {
  const d = clampDifficulty(difficulty);
  // A wrong answer on an easy item says more than one on a hard item.
  return config.difficultyWeights[correct ? d - 1 : 5 - d]!;
}

/** Hints reduce the independence weight of a correct answer. */
export function independenceWeight(config: MasteryConfig, hintsUsed: number): number {
  return Math.max(config.minIndependence, 1 - config.hintPenalty * Math.max(0, hintsUsed));
}

/** Diminishing impact of answers given within `minIntervalSec` of the previous one on the skill. */
export function recencyWeight(config: MasteryConfig, lastAttemptAt: number | null, at: number) {
  if (lastAttemptAt === null || config.minIntervalSec <= 0) return 1;
  const share = Math.min(1, Math.max(0, (at - lastAttemptAt) / 1000 / config.minIntervalSec));
  return config.recencyFloor + (1 - config.recencyFloor) * share;
}

/** Evidence weight of one answer in 0..1 terms: difficulty × independence × recency. */
export function evidenceWeight(
  config: MasteryConfig,
  state: Pick<SkillState, 'lastAttemptAt'>,
  e: AnswerEvidence,
): number {
  return (
    difficultyWeight(config, e.difficulty, e.correct) *
    (e.correct ? independenceWeight(config, e.hintsUsed) : 1) *
    recencyWeight(config, state.lastAttemptAt, e.at)
  );
}

export function displayState(config: MasteryConfig, state: SkillState): MasteryState {
  if (state.attemptCount === 0 && state.masteryScore === 0) return 'NOT_LEARNED';
  const t = config.thresholds;
  if (state.masteryScore >= t.mastered) return state.retainedAt === null ? 'MASTERED' : 'RETAINED';
  if (state.masteryScore >= t.proficient) return 'PROFICIENT';
  if (state.masteryScore >= t.learning) return 'LEARNING';
  return 'INTRODUCED';
}

/** Next target difficulty: up after an (almost) unaided correct answer, down after a wrong one. */
export function nextDifficulty(current: number, correct: boolean, hintsUsed: number): number {
  if (!correct) return clampDifficulty(current - 1);
  return hintsUsed <= 1 ? clampDifficulty(current + 1) : clampDifficulty(current);
}

/** Counters every answer moves, whatever the mode (score and Mastered/Retained excluded). */
export function recordAttempt(
  config: MasteryConfig,
  state: SkillState,
  e: AnswerEvidence,
): SkillState {
  const attemptCount = state.attemptCount + 1;
  const hit = e.correct ? 1 : 0;
  const ms = e.responseMs ?? null;
  return {
    ...state,
    attemptCount,
    correctCount: state.correctCount + hit,
    recentAccuracy: round3(
      state.attemptCount === 0
        ? hit
        : state.recentAccuracy + config.recentAlpha * (hit - state.recentAccuracy),
    ),
    confidenceScore: round3(attemptCount / (attemptCount + config.confidenceHalf)),
    avgResponseMs:
      ms === null
        ? state.avgResponseMs
        : Math.round(
            state.avgResponseMs === null
              ? ms
              : state.avgResponseMs + (ms - state.avgResponseMs) / attemptCount,
          ),
    currentDifficulty: nextDifficulty(state.currentDifficulty, e.correct, e.hintsUsed),
    lastAttemptAt: e.at,
  };
}

/** Sets Mastered/Retained marks after the score changed. */
export function withMilestones(
  config: MasteryConfig,
  state: SkillState,
  e: Pick<AnswerEvidence, 'correct' | 'at'>,
): SkillState {
  if (state.masteryScore < config.thresholds.mastered) {
    return { ...state, lastMasteredAt: null, retainedAt: null };
  }
  if (state.lastMasteredAt === null) return { ...state, lastMasteredAt: e.at };
  const retained =
    state.retainedAt === null &&
    e.correct &&
    e.at - state.lastMasteredAt >= config.retentionMinDays * DAY_MS;
  return retained ? { ...state, retainedAt: e.at } : state;
}

/**
 * V1 transparent weighted model:
 * `mastery_delta = correctness_weight × difficulty_weight × independence_weight × recency_weight`.
 */
export class WeightedMasteryStrategy implements MasteryStrategy {
  constructor(private readonly config: MasteryConfig) {}

  apply(state: SkillState, e: AnswerEvidence): MasteryUpdate {
    const correctness = e.correct ? this.config.gainCorrect : -this.config.lossIncorrect;
    const raw = correctness * evidenceWeight(this.config, state, e);
    const masteryScore = round2(Math.min(100, Math.max(0, state.masteryScore + raw)));
    const next = withMilestones(
      this.config,
      { ...recordAttempt(this.config, state, e), masteryScore },
      e,
    );
    return { state: next, delta: round2(masteryScore - state.masteryScore) };
  }

  displayState(state: SkillState): MasteryState {
    return displayState(this.config, state);
  }
}

// --- Diagnostic placement ---------------------------------------------------------------------------

export interface DiagnosticAnswer {
  skillId: string;
  correct: boolean;
  difficulty: number;
  hintsUsed: number;
  /** Recency weight at answer time (1 when the answers were spaced normally). */
  recency: number;
}

/**
 * Places every skill of a diagnosed topic. Accuracy is weighted by item difficulty; a correct
 * answer counts by its independence and recency. Tested skills: half their own accuracy, half the
 * topic's; untested skills: the topic accuracy × `untestedFactor`. Scores never exceed
 * `placementCeiling`, so a diagnostic alone cannot give Mastered.
 */
export function placeDiagnostic(
  config: MasteryConfig,
  skillIds: readonly string[],
  answers: readonly DiagnosticAnswer[],
): Map<string, number> {
  const acc = (list: readonly DiagnosticAnswer[]) => {
    let got = 0;
    let all = 0;
    for (const a of list) {
      const w = difficultyWeight(config, a.difficulty, true);
      all += w;
      if (a.correct) got += w * independenceWeight(config, a.hintsUsed) * a.recency;
    }
    return all === 0 ? 0 : got / all;
  };
  const topic = acc(answers);
  const ceiling = config.diagnostic.placementCeiling;
  const out = new Map<string, number>();
  for (const skillId of skillIds) {
    const own = answers.filter((a) => a.skillId === skillId);
    const share =
      own.length > 0 ? 0.5 * acc(own) + 0.5 * topic : topic * config.diagnostic.untestedFactor;
    out.set(skillId, round2(Math.min(ceiling, ceiling * share)));
  }
  return out;
}

/** Diagnostic length: the default, or the client's wish clamped to the configured 8-12. */
export function diagnosticLength(config: MasteryConfig, wanted?: number | null): number {
  const d = config.diagnostic;
  return Math.min(d.maxItems, Math.max(d.minItems, Math.round(wanted ?? d.defaultItems)));
}

/** Session size by grade (young learners: ~15 minutes). */
export function sessionShape(config: MasteryConfig, grade: number, wanted?: number | null) {
  const young = grade <= config.session.youngMaxGrade;
  const items = wanted ?? (young ? config.session.itemsYoung : config.session.items);
  return {
    young,
    targetItems: Math.min(50, Math.max(1, Math.round(items))),
    maxMinutes: young ? config.session.minutesYoung : config.session.minutes,
  };
}

/** XP of a finished session: per correct answer, capped per session. XP is not mastery. */
export function sessionXp(config: MasteryConfig, correctCount: number): number {
  return Math.min(config.xp.maxPerSession, Math.max(0, correctCount) * config.xp.perCorrect);
}
