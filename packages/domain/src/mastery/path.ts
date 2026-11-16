// Learning path: what a child should do next on a subject (GET /v1/students/:id/learning-path).
import type { MasteryState } from './types.ts';

export interface PathSkill {
  skillId: string;
  /** Topic (parent node) the skill belongs to. */
  topicId: string;
  /** Curriculum order. */
  order: number;
  state: MasteryState;
  masteryScore: number;
  /** Epoch milliseconds, or null without a schedule. */
  dueAt: number | null;
  /** Skills that are PREREQUISITE_OF this one. */
  prerequisites: readonly string[];
}

export type PathStepKind = 'REVIEW_DUE' | 'CONTINUE' | 'START';

export interface PathStep {
  kind: PathStepKind;
  skillId: string;
  topicId: string;
}

const KNOWN: readonly MasteryState[] = ['PROFICIENT', 'MASTERED', 'RETAINED'];

/**
 * Order of work:
 * 1. reviews that are due, most overdue first;
 * 2. skills in progress (Introduced, Learning), weakest first;
 * 3. skills not learned yet whose prerequisites are all at least Proficient, in curriculum order.
 */
export function buildLearningPath(
  skills: readonly PathSkill[],
  now: number,
  limit = 10,
): PathStep[] {
  const byId = new Map(skills.map((s) => [s.skillId, s]));
  const step = (kind: PathStepKind, s: PathSkill): PathStep => ({
    kind,
    skillId: s.skillId,
    topicId: s.topicId,
  });
  const due = skills
    .filter((s) => s.dueAt !== null && s.dueAt <= now)
    .sort((a, b) => a.dueAt! - b.dueAt!);
  const dueIds = new Set(due.map((s) => s.skillId));
  const inProgress = skills
    .filter((s) => !dueIds.has(s.skillId) && (s.state === 'INTRODUCED' || s.state === 'LEARNING'))
    .sort((a, b) => a.masteryScore - b.masteryScore || a.order - b.order);
  const ready = skills
    .filter(
      (s) =>
        s.state === 'NOT_LEARNED' &&
        s.prerequisites.every((p) => {
          const pre = byId.get(p);
          return !pre || KNOWN.includes(pre.state);
        }),
    )
    .sort((a, b) => a.order - b.order);
  return [
    ...due.map((s) => step('REVIEW_DUE', s)),
    ...inProgress.map((s) => step('CONTINUE', s)),
    ...ready.map((s) => step('START', s)),
  ].slice(0, limit);
}

/** Mean mastery of a topic's skills (two decimals); the topic's display state comes from it. */
export function meanScore(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}
