// Spaced review (TASK_PACKS/M06.md): SM-2-like intervals from config, and the forgetting risk.
import { DAY_MS, type MasteryConfig } from './types.ts';

export interface ReviewEntry {
  repetitions: number;
  intervalDays: number;
  ease: number;
  /** Epoch milliseconds. */
  dueAt: number;
  lastReviewedAt: number;
}

/** SM-2 quality 0-5 of an answer: unaided 5, one hint 4, more hints 3, wrong 1. */
export function reviewQuality(correct: boolean, hintsUsed: number): number {
  if (!correct) return 1;
  return hintsUsed === 0 ? 5 : hintsUsed === 1 ? 4 : 3;
}

/**
 * Next schedule of a skill after an answer at `now`:
 * - no schedule yet: the first interval;
 * - wrong (quality < 3): a lapse, back to the first interval;
 * - correct before the review is due: unchanged (cramming does not stretch the interval);
 * - correct when due: the next configured first interval, then `interval × ease`.
 */
export function scheduleReview(
  config: MasteryConfig,
  previous: ReviewEntry | null,
  quality: number,
  now: number,
): ReviewEntry {
  const first = config.review.firstIntervalsDays;
  const at = (repetitions: number, intervalDays: number, ease: number): ReviewEntry => ({
    repetitions,
    intervalDays,
    ease,
    dueAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
  });
  if (previous === null) return at(quality >= 3 ? 1 : 0, first[0]!, config.review.startEase);
  const ease = Math.max(
    config.review.minEase,
    Math.round((previous.ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)) * 100) / 100,
  );
  if (quality < 3) return at(0, first[0]!, ease);
  if (now < previous.dueAt) return previous;
  const repetitions = previous.repetitions + 1;
  const intervalDays =
    repetitions <= first.length
      ? first[repetitions - 1]!
      : Math.round(previous.intervalDays * ease * 100) / 100;
  return at(repetitions, intervalDays, ease);
}

/**
 * Chance the skill has faded: `1 − 0.5^(days since the last attempt / review interval)`, so it is
 * 0 right after practice and 0.5 when the review is due. Mirrored by ops.learning_nightly().
 */
export function forgettingRisk(
  lastAttemptAt: number | null,
  intervalDays: number | null,
  now: number,
): number {
  if (lastAttemptAt === null || intervalDays === null || intervalDays <= 0) return 0;
  const days = Math.max(0, now - lastAttemptAt) / DAY_MS;
  return Math.round((1 - Math.pow(0.5, days / intervalDays)) * 1000) / 1000;
}
