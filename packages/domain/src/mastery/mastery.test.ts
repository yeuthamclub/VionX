import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildLearningPath,
  chosenWrongOption,
  countBlanks,
  DAY_MS,
  DEFAULT_MASTERY_CONFIG as C,
  diagnosticLength,
  displayState,
  forgettingRisk,
  judgeAnswer,
  masteryConfigFrom,
  newSeed,
  newSkillState,
  parseNumber,
  pickItem,
  pickSkill,
  placeDiagnostic,
  recencyWeight,
  reviewQuality,
  scheduleReview,
  sessionShape,
  sessionXp,
  slotKind,
  slotRandom,
  WeightedMasteryStrategy,
  type AnswerEvidence,
  type ItemCandidate,
  type PathSkill,
  type SkillState,
} from './index.ts';

const strategy = new WeightedMasteryStrategy(C);
const T0 = Date.UTC(2026, 10, 16, 3, 0, 0);
const MIN = 60_000;

const answer = (over: Partial<AnswerEvidence> = {}): AnswerEvidence => ({
  correct: true,
  difficulty: 3,
  hintsUsed: 0,
  at: T0,
  ...over,
});

/** `n` answers one minute apart (no short-interval damping). */
function run(n: number, over: (i: number) => Partial<AnswerEvidence> = () => ({})): SkillState {
  let state = newSkillState();
  for (let i = 0; i < n; i++)
    state = strategy.apply(state, answer({ at: T0 + i * MIN, ...over(i) })).state;
  return state;
}

const evidenceArb = fc.record({
  correct: fc.boolean(),
  difficulty: fc.integer({ min: 1, max: 5 }),
  hintsUsed: fc.integer({ min: 0, max: 4 }),
  gapSec: fc.integer({ min: 0, max: 3600 }),
});

describe('WeightedMasteryStrategy (§10.3)', () => {
  it('delta = correctness × difficulty × independence × recency', () => {
    const first = strategy.apply(newSkillState(), answer({ difficulty: 4 }));
    expect(first.delta).toBe(9.6); // 8 × 1.2 × 1 × 1
    const hinted = strategy.apply(newSkillState(), answer({ difficulty: 4, hintsUsed: 2 }));
    expect(hinted.delta).toBe(5.76); // × (1 − 0.2 × 2)
    const wrong = strategy.apply(
      { ...newSkillState(), masteryScore: 50 },
      answer({ correct: false, difficulty: 1 }),
    );
    expect(wrong.delta).toBe(-5.6); // −4 × 1.4 (a wrong answer on an easy item costs most)
  });

  it('hints reduce the delta of a correct answer, never below the floor', () => {
    const deltas = [0, 1, 2, 3, 4].map(
      (h) => strategy.apply(newSkillState(), answer({ hintsUsed: h })).delta,
    );
    expect(deltas).toEqual([8, 6.4, 4.8, 3.2, 1.6]);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 4 }),
        (difficulty, hints) => {
          const plain = strategy.apply(newSkillState(), answer({ difficulty })).delta;
          const hinted = strategy.apply(
            newSkillState(),
            answer({ difficulty, hintsUsed: hints }),
          ).delta;
          return hinted < plain && hinted > 0;
        },
      ),
    );
  });

  it('answers within minIntervalSec have diminishing impact', () => {
    const state = strategy.apply(newSkillState(), answer()).state;
    const spaced = strategy.apply(state, answer({ at: T0 + C.minIntervalSec * 1000 })).delta;
    const rushed = strategy.apply(state, answer({ at: T0 + 1000 })).delta;
    const instant = strategy.apply(state, answer({ at: T0 })).delta;
    expect(spaced).toBe(8);
    expect(instant).toBe(2); // recencyFloor 0.25
    expect(rushed).toBeGreaterThan(instant);
    expect(rushed).toBeLessThan(spaced);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return recencyWeight(C, T0, T0 + lo * 1000) <= recencyWeight(C, T0, T0 + hi * 1000);
      }),
    );
  });

  it('keeps the score in 0-100 and counters consistent for any answer sequence', () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { maxLength: 80 }), (list) => {
        let state = newSkillState();
        let at = T0;
        for (const e of list) {
          at += e.gapSec * 1000;
          const before = state.masteryScore;
          const update = strategy.apply(state, { ...e, at });
          state = update.state;
          // A correct answer never lowers the score; a wrong one never raises it.
          if (e.correct ? update.delta < 0 : update.delta > 0) return false;
          if (Math.abs(before + update.delta - state.masteryScore) > 0.011) return false;
        }
        return (
          state.masteryScore >= 0 &&
          state.masteryScore <= 100 &&
          state.attemptCount === list.length &&
          state.correctCount === list.filter((e) => e.correct).length &&
          state.recentAccuracy >= 0 &&
          state.recentAccuracy <= 1 &&
          state.confidenceScore >= 0 &&
          state.confidenceScore < 1 &&
          state.currentDifficulty >= 1 &&
          state.currentDifficulty <= 5
        );
      }),
    );
  });

  it('tracks counters, recent accuracy, average time and target difficulty', () => {
    let s = strategy.apply(newSkillState(), answer({ responseMs: 4000 })).state;
    s = strategy.apply(s, answer({ at: T0 + MIN, correct: false, responseMs: 8000 })).state;
    expect(s).toMatchObject({
      attemptCount: 2,
      correctCount: 1,
      avgResponseMs: 6000,
      recentAccuracy: 0.7,
    });
    expect(s.confidenceScore).toBe(0.286);
    expect(s.currentDifficulty).toBe(2); // 2 → 3 (correct) → 2 (wrong)
    expect(strategy.apply(newSkillState(), answer({ hintsUsed: 3 })).state.currentDifficulty).toBe(
      2,
    );
  });
});

describe('display states (§10.2)', () => {
  const at = (masteryScore: number, over: Partial<SkillState> = {}) =>
    displayState(C, { ...newSkillState(), attemptCount: 1, masteryScore, ...over });

  it('follows the thresholds', () => {
    expect(displayState(C, newSkillState())).toBe('NOT_LEARNED');
    expect(at(0)).toBe('INTRODUCED');
    expect(at(24.99)).toBe('INTRODUCED');
    expect(at(25)).toBe('LEARNING');
    expect(at(60)).toBe('PROFICIENT');
    expect(at(85)).toBe('MASTERED');
    expect(at(90, { retainedAt: T0 })).toBe('RETAINED');
    // A skill placed by a diagnostic without an own attempt shows its placed state.
    expect(displayState(C, { ...newSkillState(), masteryScore: 60 })).toBe('PROFICIENT');
  });

  it('Retained needs a correct answer retentionMinDays after Mastered', () => {
    let s = run(20, () => ({ difficulty: 5 }));
    expect(strategy.displayState(s)).toBe('MASTERED');
    const masteredAt = s.lastMasteredAt!;
    // Too early: still Mastered.
    s = strategy.apply(s, answer({ at: masteredAt + (C.retentionMinDays - 1) * DAY_MS })).state;
    expect(strategy.displayState(s)).toBe('MASTERED');
    // A wrong answer after the delay does not retain.
    const wrong = strategy.apply(
      s,
      answer({ correct: false, difficulty: 5, at: masteredAt + 8 * DAY_MS }),
    ).state;
    expect(wrong.retainedAt).toBeNull();
    // A correct one does.
    s = strategy.apply(s, answer({ at: masteredAt + C.retentionMinDays * DAY_MS })).state;
    expect(strategy.displayState(s)).toBe('RETAINED');
    // Falling below Mastered loses both marks.
    for (let i = 0; i < 6; i++) {
      s = strategy.apply(
        s,
        answer({ correct: false, difficulty: 1, at: masteredAt + (9 + i) * DAY_MS }),
      ).state;
    }
    expect(s.masteryScore).toBeLessThan(C.thresholds.mastered);
    expect(s).toMatchObject({ lastMasteredAt: null, retainedAt: null });
    expect(strategy.displayState(s)).toBe('PROFICIENT');
  });

  it('never shows Retained without the delay (property)', () => {
    fc.assert(
      fc.property(fc.array(evidenceArb, { maxLength: 120 }), (list) => {
        let state = newSkillState();
        let at = T0;
        for (const e of list) {
          at += e.gapSec * 1000;
          state = strategy.apply(state, { ...e, at }).state;
          if (state.retainedAt !== null) {
            if (state.lastMasteredAt === null) return false;
            if (state.retainedAt - state.lastMasteredAt < C.retentionMinDays * DAY_MS) return false;
          }
        }
        return true; // at most 120 h of answers: Retained can never appear
      }),
    );
  });
});

describe('diagnostic placement', () => {
  const ten = (over: (i: number) => object = () => ({})) =>
    Array.from({ length: 10 }, (_, i) => ({
      skillId: `s${i % 4}`,
      correct: true,
      difficulty: Math.min(5, 2 + i),
      hintsUsed: 0,
      recency: 1,
      ...over(i),
    }));
  const skills = ['s0', 's1', 's2', 's3', 's4'];

  it('10 correct answers place the topic at Proficient, never Mastered', () => {
    const placed = placeDiagnostic(C, skills, ten());
    expect(placed.get('s0')).toBe(80);
    expect(placed.get('s4')).toBe(60); // untested skill
    for (const score of placed.values()) {
      expect(displayState(C, { ...newSkillState(), masteryScore: score })).toBe('PROFICIENT');
    }
  });

  it('hints and wrong answers lower the placement', () => {
    const clean = placeDiagnostic(C, skills, ten()).get('s0')!;
    expect(
      placeDiagnostic(
        C,
        skills,
        ten(() => ({ hintsUsed: 2 })),
      ).get('s0')!,
    ).toBeLessThan(clean);
    const mixed = placeDiagnostic(
      C,
      skills,
      ten((i) => ({ correct: i % 4 !== 0 })),
    );
    expect(mixed.get('s0')).toBe(28.75); // every s0 answer wrong: half of the topic accuracy (9.2 / 12.8)
    expect(mixed.get('s1')!).toBeGreaterThan(mixed.get('s0')!);
    expect(
      placeDiagnostic(
        C,
        skills,
        ten(() => ({ correct: false })),
      ).get('s0'),
    ).toBe(0);
  });

  it('stays within 0..ceiling (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            skillId: fc.constantFrom('s0', 's1', 's2'),
            correct: fc.boolean(),
            difficulty: fc.integer({ min: 1, max: 5 }),
            hintsUsed: fc.integer({ min: 0, max: 4 }),
            recency: fc.double({ min: 0.25, max: 1, noNaN: true }),
          }),
          { maxLength: 12 },
        ),
        (answers) =>
          [...placeDiagnostic(C, skills, answers).values()].every(
            (v) => v >= 0 && v <= C.diagnostic.placementCeiling,
          ),
      ),
    );
  });

  it('is 8-12 items long, 10 by default', () => {
    expect([undefined, 3, 9, 40].map((n) => diagnosticLength(C, n))).toEqual([10, 8, 9, 12]);
  });
});

describe('session shape and XP', () => {
  it('young learners get shorter sessions', () => {
    expect(sessionShape(C, 2)).toEqual({ young: true, targetItems: 10, maxMinutes: 15 });
    expect(sessionShape(C, 6)).toEqual({ young: false, targetItems: 15, maxMinutes: 25 });
    expect(sessionShape(C, 6, 99).targetItems).toBe(50);
  });

  it('XP is per correct answer, capped per session', () => {
    expect([0, 7, 20, 500].map((n) => sessionXp(C, n))).toEqual([0, 35, 100, 100]);
  });

  it('a stored config is merged over the defaults', () => {
    const merged = masteryConfigFrom({ gainCorrect: 5, thresholds: { mastered: 90 } });
    expect(merged.gainCorrect).toBe(5);
    expect(merged.thresholds).toEqual({ learning: 25, proficient: 60, mastered: 90 });
    expect(masteryConfigFrom(null)).toEqual(C);
  });
});

describe('item selection', () => {
  const item = (itemId: string, over: Partial<ItemCandidate> = {}): ItemCandidate => ({
    itemId,
    kind: 'STATIC',
    difficulty: 3,
    seenCount: 0,
    lastSeenAt: null,
    ...over,
  });
  const rand = () => 0;

  it('70% current skill, 30% due reviews', () => {
    const kinds = Array.from({ length: 10 }, (_, i) => slotKind(C, 'PRACTICE', i, true));
    expect(kinds.filter((k) => k === 'REVIEW')).toHaveLength(3);
    expect(kinds.indexOf('REVIEW')).toBe(3);
    expect(slotKind(C, 'PRACTICE', 3, false)).toBe('CURRENT');
    expect(slotKind(C, 'DIAGNOSTIC', 3, true)).toBe('CURRENT');
    expect(slotKind(C, 'REVIEW', 0, false)).toBe('REVIEW');
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const reviews = Array.from({ length: n }, (_, i) =>
          slotKind(C, 'PRACTICE', i, true),
        ).filter((k) => k === 'REVIEW').length;
        return reviews === Math.floor(n * C.reviewShare + 1e-9);
      }),
    );
  });

  it('keeps the difficulty within ±1 of the target, widening only when empty', () => {
    const pool = [
      item('easy', { difficulty: 1 }),
      item('near', { difficulty: 4 }),
      item('hard', { difficulty: 5 }),
    ];
    expect(pickItem(pool, 3, new Set(), rand)!.itemId).toBe('near');
    expect(pickItem(pool, 3, new Set(['near']), rand)!.itemId).toBe('easy'); // nearest is 2 away
    expect(pickItem(pool, 3, new Set(['near', 'easy', 'hard']), rand)).toBeNull();
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 5 }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (difficulties, target, r) => {
          const candidates = difficulties.map((d, i) => item(`i${i}`, { difficulty: d }));
          const picked = pickItem(candidates, target, new Set(), () => r)!;
          const nearest = Math.min(...difficulties.map((d) => Math.abs(d - target)));
          return Math.abs(picked.difficulty - target) <= Math.max(1, nearest);
        },
      ),
    );
  });

  it('prefers unseen items, then templates (new seed), then the one seen longest ago', () => {
    const seenOld = item('old', { seenCount: 2, lastSeenAt: T0 - 5 * DAY_MS });
    const seenNew = item('new', { seenCount: 1, lastSeenAt: T0 });
    const template = item('tpl', { kind: 'TEMPLATE', seenCount: 9, lastSeenAt: T0 });
    const fresh = item('fresh');
    expect(pickItem([seenOld, seenNew, template, fresh], 3, new Set(), rand)!.itemId).toBe('fresh');
    expect(pickItem([seenOld, seenNew, template], 3, new Set(), rand)!.itemId).toBe('tpl');
    expect(pickItem([seenNew, seenOld], 3, new Set(), rand)!.itemId).toBe('old');
  });

  it('gives a template a seed the child has not had', () => {
    const stream = [0.5, 0.5, 0.25];
    const seed = newSeed([2147483648], () => stream.shift()!);
    expect(seed).toBe(1073741824);
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4294967295 }), { maxLength: 20 }),
        fc.string(),
        (used, id) => {
          const s = newSeed(used, slotRandom(id, 1));
          return Number.isInteger(s) && s >= 0 && s <= 4294967295 && !used.includes(s);
        },
      ),
    );
  });

  it('slot randomness is deterministic per session slot', () => {
    expect(slotRandom('abc', 2)()).toBe(slotRandom('abc', 2)());
    expect(slotRandom('abc', 2)()).not.toBe(slotRandom('abc', 3)());
  });

  it('rotates skills; practice starts with the weakest', () => {
    const skills = [
      { skillId: 'strong', masteryScore: 70, servedInSession: 0 },
      { skillId: 'weak', masteryScore: 10, servedInSession: 0 },
    ];
    expect(pickSkill('PRACTICE', skills)).toBe('weak');
    expect(pickSkill('DIAGNOSTIC', skills)).toBe('strong');
    expect(pickSkill('PRACTICE', [skills[0]!, { ...skills[1]!, servedInSession: 1 }])).toBe(
      'strong',
    );
    expect(pickSkill('PRACTICE', [])).toBeNull();
  });
});

describe('spaced review (SM-2-like)', () => {
  it('maps answers to quality', () => {
    expect([
      reviewQuality(true, 0),
      reviewQuality(true, 1),
      reviewQuality(true, 3),
      reviewQuality(false, 0),
    ]).toEqual([5, 4, 3, 1]);
  });

  it('first interval 1 day, then 3, then × ease', () => {
    const first = scheduleReview(C, null, 5, T0);
    expect(first).toMatchObject({ repetitions: 1, intervalDays: 1, ease: 2.5, dueAt: T0 + DAY_MS });
    // Practising again before it is due changes nothing.
    expect(scheduleReview(C, first, 5, T0 + MIN)).toBe(first);
    const second = scheduleReview(C, first, 5, first.dueAt);
    expect(second).toMatchObject({ repetitions: 2, intervalDays: 3, ease: 2.6 });
    const third = scheduleReview(C, second, 4, second.dueAt);
    expect(third).toMatchObject({ repetitions: 3, intervalDays: 7.8, ease: 2.6 });
    expect(third.dueAt).toBe(second.dueAt + 7.8 * DAY_MS);
  });

  it('a wrong answer is a lapse: back to 1 day, lower ease, never below minEase', () => {
    let entry = scheduleReview(C, scheduleReview(C, null, 5, T0), 5, T0 + DAY_MS);
    entry = scheduleReview(C, entry, 1, T0 + DAY_MS + MIN);
    expect(entry).toMatchObject({ repetitions: 0, intervalDays: 1, ease: 2.06 });
    for (let i = 0; i < 10; i++) entry = scheduleReview(C, entry, 1, entry.dueAt);
    expect(entry.ease).toBe(C.review.minEase);
    expect(scheduleReview(C, null, 1, T0)).toMatchObject({ repetitions: 0, intervalDays: 1 });
  });

  it('due dates are in the future and intervals positive (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 40 })), {
          maxLength: 40,
        }),
        (steps) => {
          let entry = null as ReturnType<typeof scheduleReview> | null;
          let now = T0;
          for (const [quality, days] of steps) {
            now += days * DAY_MS;
            entry = scheduleReview(C, entry, quality, now);
            if (entry.intervalDays <= 0 || entry.ease < C.review.minEase) return false;
            if (entry.dueAt !== entry.lastReviewedAt + entry.intervalDays * DAY_MS) return false;
          }
          return true;
        },
      ),
    );
  });

  it('forgetting risk is 0 after practice, 0.5 when due, and grows', () => {
    expect(forgettingRisk(T0, 3, T0)).toBe(0);
    expect(forgettingRisk(T0, 3, T0 + 3 * DAY_MS)).toBe(0.5);
    expect(forgettingRisk(T0, 3, T0 + 6 * DAY_MS)).toBe(0.75);
    expect(forgettingRisk(null, 3, T0)).toBe(0);
    expect(forgettingRisk(T0, null, T0 + DAY_MS)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 400 }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const r = (d: number) => forgettingRisk(T0, 5, T0 + d * DAY_MS);
        return r(lo) <= r(hi) && r(hi) <= 1 && r(lo) >= 0;
      }),
    );
  });
});

describe('judging answers', () => {
  it('choice types', () => {
    expect(judgeAnswer('single_choice', { optionId: 'b' }, { optionId: 'b' })).toBe(true);
    expect(judgeAnswer('picture_choice', { optionId: 'b' }, { optionId: 'a' })).toBe(false);
    expect(judgeAnswer('spelling_choice', { optionId: 'b' }, {})).toBeNull();
    expect(judgeAnswer('multi_choice', { optionIds: ['a', 'c'] }, { optionIds: ['c', 'a'] })).toBe(
      true,
    );
    expect(judgeAnswer('multi_choice', { optionIds: ['a', 'c'] }, { optionIds: ['a'] })).toBe(
      false,
    );
    expect(judgeAnswer('multi_choice', { optionIds: ['a', 'c'] }, { optionIds: ['a', 'a'] })).toBe(
      false,
    );
    expect(judgeAnswer('true_false', { value: false }, { value: false })).toBe(true);
    expect(judgeAnswer('true_false', { value: false }, { value: 'false' })).toBeNull();
  });

  it('numeric: decimal comma, tolerance, bad input', () => {
    expect(judgeAnswer('numeric', { value: 3.5 }, { value: '3,5' })).toBe(true);
    expect(judgeAnswer('numeric', { value: 3.5 }, { value: 3.6 })).toBe(false);
    expect(judgeAnswer('numeric', { value: 3.5, tolerance: 0.1 }, { value: '3.6' })).toBe(true);
    expect(judgeAnswer('numeric', { value: 12 }, { value: 'mười hai' })).toBeNull();
    expect([
      parseNumber('1 234,5'),
      parseNumber('-2'),
      parseNumber('1,2,3'),
      parseNumber(''),
    ]).toEqual([1234.5, -2, null, null]);
  });

  it('fill_blank ignores case, spacing and number formatting', () => {
    const answer = { blanks: [['Hà Nội', 'Ha Noi'], ['0,5']] };
    expect(judgeAnswer('fill_blank', answer, { blanks: ['  hà  nội ', '0.50'] })).toBe(true);
    expect(judgeAnswer('fill_blank', answer, { blanks: ['Huế', '0,5'] })).toBe(false);
    expect(judgeAnswer('fill_blank', answer, { blanks: ['Hà Nội'] })).toBeNull();
  });

  it('word_bank, ordering and matching', () => {
    expect(
      judgeAnswer('word_bank', { blankOptionIds: ['a', 'c'] }, { blankOptionIds: ['a', 'c'] }),
    ).toBe(true);
    expect(
      judgeAnswer('word_bank', { blankOptionIds: ['a', 'c'] }, { blankOptionIds: ['c', 'a'] }),
    ).toBe(false);
    expect(judgeAnswer('ordering', { order: ['c', 'a', 'b'] }, { order: ['c', 'a', 'b'] })).toBe(
      true,
    );
    expect(judgeAnswer('ordering', { order: ['c', 'a', 'b'] }, { order: ['a', 'c', 'b'] })).toBe(
      false,
    );
    const pairs: [string, string][] = [
      ['l1', 'r2'],
      ['l2', 'r1'],
    ];
    expect(
      judgeAnswer(
        'matching',
        { pairs },
        {
          pairs: [
            ['l2', 'r1'],
            ['l1', 'r2'],
          ],
        },
      ),
    ).toBe(true);
    expect(
      judgeAnswer(
        'matching',
        { pairs },
        {
          pairs: [
            ['l1', 'r1'],
            ['l2', 'r2'],
          ],
        },
      ),
    ).toBe(false);
    expect(judgeAnswer('matching', { pairs }, { pairs: [['l1']] })).toBeNull();
    expect(judgeAnswer('written', { value: 1 }, { value: 1 })).toBeNull();
  });

  it('finds the wrong option for distractor feedback, and counts blanks', () => {
    expect(chosenWrongOption('single_choice', { optionId: 'b' }, { optionId: 'c' })).toBe('c');
    expect(chosenWrongOption('single_choice', { optionId: 'b' }, { optionId: 'b' })).toBeNull();
    expect(chosenWrongOption('multi_choice', { optionIds: ['a'] }, { optionIds: ['a', 'd'] })).toBe(
      'd',
    );
    expect(chosenWrongOption('numeric', { value: 1 }, { value: 2 })).toBeNull();
    expect(countBlanks('Những giọt nước ___ đọng trên ____ cải.')).toBe(2);
  });
});

describe('learning path', () => {
  const skill = (skillId: string, over: Partial<PathSkill> = {}): PathSkill => ({
    skillId,
    topicId: 't',
    order: 0,
    state: 'NOT_LEARNED',
    masteryScore: 0,
    dueAt: null,
    prerequisites: [],
    ...over,
  });

  it('due reviews, then skills in progress (weakest first), then ready new skills', () => {
    const path = buildLearningPath(
      [
        skill('new2', { order: 5 }),
        skill('new1', { order: 4 }),
        skill('blocked', { order: 1, prerequisites: ['learning'] }),
        skill('open', { order: 6, prerequisites: ['known'] }),
        skill('learning', { state: 'LEARNING', masteryScore: 40 }),
        skill('intro', { state: 'INTRODUCED', masteryScore: 5 }),
        skill('known', { state: 'PROFICIENT', masteryScore: 70, dueAt: T0 + DAY_MS }),
        skill('due', { state: 'MASTERED', masteryScore: 90, dueAt: T0 - DAY_MS }),
        skill('overdue', { state: 'LEARNING', masteryScore: 30, dueAt: T0 - 3 * DAY_MS }),
      ],
      T0,
    );
    expect(path.map((p) => `${p.kind}:${p.skillId}`)).toEqual([
      'REVIEW_DUE:overdue',
      'REVIEW_DUE:due',
      'CONTINUE:intro',
      'CONTINUE:learning',
      'START:new1',
      'START:new2',
      'START:open',
    ]);
    expect(buildLearningPath([skill('a'), skill('b')], T0, 1)).toHaveLength(1);
  });
});
