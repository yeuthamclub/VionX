// Item selection for a session (TASK_PACKS/M06.md "Item selection").
import { seededRandom } from '../library/variants.ts';
import type { ItemKind } from '../library/types.ts';
import { clampDifficulty, type MasteryConfig, type SessionMode } from './types.ts';

export type SlotKind = 'CURRENT' | 'REVIEW';

/**
 * Whether slot `index` (0-based) of a session goes to a due review. PRACTICE spreads reviews so
 * that exactly `floor(n × reviewShare)` of the first n slots are reviews (70% current / 30%
 * review) whenever a review is due; REVIEW sessions are all reviews; a DIAGNOSTIC has none.
 */
export function slotKind(
  config: MasteryConfig,
  mode: SessionMode,
  index: number,
  hasDueReview: boolean,
): SlotKind {
  if (mode === 'REVIEW') return 'REVIEW';
  if (mode === 'DIAGNOSTIC' || !hasDueReview) return 'CURRENT';
  const share = config.reviewShare;
  return Math.floor((index + 1) * share + 1e-9) > Math.floor(index * share + 1e-9)
    ? 'REVIEW'
    : 'CURRENT';
}

export interface SkillCandidate {
  skillId: string;
  masteryScore: number;
  /** Answers this skill already got in the session. */
  servedInSession: number;
}

/**
 * Skill of a CURRENT slot: the skill served least in this session (round-robin over the topic);
 * in PRACTICE ties go to the weakest skill.
 */
export function pickSkill(mode: SessionMode, skills: readonly SkillCandidate[]): string | null {
  if (skills.length === 0) return null;
  const sorted = [...skills].sort((a, b) =>
    mode === 'DIAGNOSTIC'
      ? a.servedInSession - b.servedInSession
      : a.servedInSession - b.servedInSession || a.masteryScore - b.masteryScore,
  );
  return sorted[0]!.skillId;
}

export interface ItemCandidate {
  itemId: string;
  kind: ItemKind;
  difficulty: number;
  /** Times the child has seen the item before (0 = never). */
  seenCount: number;
  /** Epoch milliseconds of the last time, or null. */
  lastSeenAt: number | null;
}

/**
 * Picks an item for a skill:
 * 1. items already served in this session are out;
 * 2. difficulty within ±1 of the target; if none, the nearest difficulty that has items;
 * 3. never-seen items first, then TEMPLATE items (they get a new seed), then the STATIC item seen
 *    longest ago;
 * 4. ties are broken by the seeded random stream (deterministic per session slot).
 */
export function pickItem(
  candidates: readonly ItemCandidate[],
  targetDifficulty: number,
  servedInSession: ReadonlySet<string>,
  rand: () => number,
): ItemCandidate | null {
  const pool = candidates.filter((c) => !servedInSession.has(c.itemId));
  if (pool.length === 0) return null;
  const target = clampDifficulty(targetDifficulty);
  const distance = (c: ItemCandidate) => Math.abs(c.difficulty - target);
  const nearest = Math.max(1, Math.min(...pool.map(distance)));
  const window = pool.filter((c) => distance(c) <= nearest);
  const rank = (c: ItemCandidate) => (c.seenCount === 0 ? 0 : c.kind === 'TEMPLATE' ? 1 : 2);
  const best = Math.min(...window.map(rank));
  let tier = window.filter((c) => rank(c) === best);
  if (best === 2) {
    const oldest = Math.min(...tier.map((c) => c.lastSeenAt ?? 0));
    tier = tier.filter((c) => (c.lastSeenAt ?? 0) === oldest);
  }
  return tier[Math.min(tier.length - 1, Math.floor(rand() * tier.length))]!;
}

/** A seed for a TEMPLATE item the child has not had yet (uint32). */
export function newSeed(usedSeeds: readonly number[], rand: () => number): number {
  const used = new Set(usedSeeds);
  for (;;) {
    const seed = Math.floor(rand() * 4294967296) >>> 0;
    if (!used.has(seed)) return seed;
  }
}

/** Deterministic random stream of one session slot (retries of `next` pick the same item). */
export function slotRandom(sessionId: string, slot: number): () => number {
  let h = 2166136261 ^ slot;
  for (let i = 0; i < sessionId.length; i++) {
    h = Math.imul(h ^ sessionId.charCodeAt(i), 16777619);
  }
  return seededRandom(h >>> 0);
}
