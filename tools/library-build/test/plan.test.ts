import { describe, expect, it } from 'vitest';
import { TEMPLATE_ITEM_TYPES } from '@vionx/domain';
import {
  allocatePlan,
  largestRemainder,
  summarisePlan,
  type PlanProfile,
  type PlanSkill,
} from '../src/lib/plan.ts';
import { BUILD_PROFILES } from '../src/profile.ts';

const math6 = BUILD_PROFILES['MATH.6']!;
const profile: PlanProfile = {
  targetItems: 500,
  templateShare: math6.library.templateShare,
  itemTypeMix: math6.library.itemTypeMix,
  levelMix: math6.levelMix,
  svgShare: math6.svgShare,
};

function skills(n: number): PlanSkill[] {
  return Array.from({ length: n }, (_, i) => ({
    code: `MATH.6.D${i % 3}.T${i % 7}.S${i}`,
    title: `skill ${i}`,
    weight: 0.5 + (i % 5) * 0.5,
    templatable: i % 3 !== 2,
    visual: i % 6 === 2,
  }));
}

describe('largestRemainder', () => {
  it('sums to the total and follows the weights', () => {
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(7, [3, 1])).toEqual([5, 2]);
    expect(largestRemainder(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('allocatePlan (ARCHITECTURE §3 + MATH.6 profile)', () => {
  const list = skills(120);
  const plan = allocatePlan(list, profile);
  const summary = summarisePlan(plan.slots);

  it('allocates exactly the target and gives every skill ≥2 slots with an L1-L2 and an L3+', () => {
    expect(plan.slots).toHaveLength(500);
    for (const s of list) {
      const mine = plan.slots.filter((x) => x.skill === s.code);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(mine.some((x) => x.level === 'L1' || x.level === 'L2')).toBe(true);
      expect(mine.some((x) => !['L1', 'L2'].includes(x.level))).toBe(true);
    }
    expect(plan.flags).toEqual([]);
  });

  it('spreads the remainder by weight', () => {
    const count = (code: string) => plan.slots.filter((x) => x.skill === code).length;
    const heavy = list.filter((s) => s.weight === 2.5);
    const light = list.filter((s) => s.weight === 0.5);
    expect(Math.min(...heavy.map((s) => count(s.code)))).toBeGreaterThan(
      Math.max(...light.map((s) => count(s.code))),
    );
  });

  it('meets the TEMPLATE share with template-capable types on templatable skills only', () => {
    expect(summary.templateShare).toBeGreaterThanOrEqual(0.4);
    expect(summary.templateShare).toBeLessThan(0.45);
    const templatable = new Set(list.filter((s) => s.templatable).map((s) => s.code));
    for (const s of plan.slots.filter((x) => x.kind === 'TEMPLATE')) {
      expect(templatable.has(s.skill)).toBe(true);
      expect(TEMPLATE_ITEM_TYPES).toContain(s.type);
    }
  });

  it('follows the item-type mix and the level mix', () => {
    expect(summary.perType).toEqual({
      single_choice: 175,
      numeric: 175,
      fill_blank: 50,
      multi_choice: 25,
      true_false: 25,
      ordering: 25,
      matching: 25,
    });
    expect(summary.perLevel.L2).toBeGreaterThan(summary.perLevel.L4!);
    expect(Object.keys(summary.perLevel).sort()).toEqual(['L1', 'L2', 'L3', 'L4']);
    for (const s of plan.slots) expect(s.difficulty).toBe(Number(s.level.slice(1)));
  });

  it('puts figures only on STATIC slots of visual skills, at the profile share', () => {
    const visual = new Set(list.filter((s) => s.visual).map((s) => s.code));
    const figures = plan.slots.filter((s) => s.svg);
    expect(figures).toHaveLength(40);
    for (const s of figures) {
      expect(s.kind).toBe('STATIC');
      expect(visual.has(s.skill)).toBe(true);
    }
  });

  it('is deterministic and uses <skill>.Q<nn> slot ids', () => {
    expect(allocatePlan(list, profile)).toEqual(plan);
    expect(new Set(plan.slots.map((s) => s.id)).size).toBe(500);
    expect(plan.slots[0]!.id).toBe(`${list[0]!.code}.Q01`);
  });

  it('lets coverage win when 2 × skills exceeds the target, and flags it', () => {
    const p = allocatePlan(skills(300), profile);
    expect(p.slots).toHaveLength(600);
    expect(p.flags[0]).toMatch(/300 skills need 600 items; coverage wins/);
  });

  it('flags a TEMPLATE share it cannot reach', () => {
    const p = allocatePlan(
      skills(50).map((s) => ({ ...s, templatable: false })),
      profile,
    );
    expect(p.slots.every((s) => s.kind === 'STATIC')).toBe(true);
    expect(p.flags.join('\n')).toMatch(/TEMPLATE target 200 but only 0 slots/);
  });
});
