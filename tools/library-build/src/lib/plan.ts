// Plan allocation (TASK_PACKS/X01.md step 5, ARCHITECTURE §3 allocation rule + subject profile):
// 1. every skill gets 2 slots, one L1-L2 and one L3+ (coverage wins over the target, flagged);
// 2. the remainder follows skill weights (largest remainder);
// 3. levels, TEMPLATE share, item-type mix and figures follow the profile.
// Deterministic: the same skills and profile always give the same plan.
import {
  COGNITIVE_LEVELS,
  TEMPLATE_ITEM_TYPES,
  type CognitiveLevel,
  type ItemKind,
  type ItemType,
} from '@vionx/domain';

export interface PlanSkill {
  code: string;
  title: string;
  weight: number;
  /** Computation skill whose numbers can vary (TEMPLATE candidate). */
  templatable: boolean;
  /** Items need a figure. */
  visual: boolean;
}

export interface PlanProfile {
  targetItems: number;
  templateShare: number;
  itemTypeMix: Partial<Record<ItemType, number>>;
  levelMix: Partial<Record<CognitiveLevel, number>>;
  svgShare: number;
}

export interface PlanSlot {
  /** Slot id = the item code it will produce: `<skill>.Q<nn>`. */
  id: string;
  skill: string;
  level: CognitiveLevel;
  difficulty: number;
  kind: ItemKind;
  type: ItemType;
  svg: boolean;
}

export interface Plan {
  slots: PlanSlot[];
  flags: string[];
}

const LOW: CognitiveLevel[] = ['L1', 'L2'];
const isLow = (l: CognitiveLevel) => LOW.includes(l);

/** Splits `total` by `weights` with the largest-remainder method (ties: earlier index first). */
export function largestRemainder(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k]!.i]!++;
  return counts;
}

/** Picks the key with the largest remaining count among `allowed` (ties: listing order). */
function takeLargest<K extends string>(remaining: Map<K, number>, allowed: readonly K[]): K | null {
  let best: K | null = null;
  for (const key of allowed) {
    const n = remaining.get(key) ?? 0;
    if (n > 0 && (best === null || n > remaining.get(best)!)) best = key;
  }
  if (best !== null) remaining.set(best, remaining.get(best)! - 1);
  return best;
}

/** Round-robin over skills: the order slots are visited when spreading a share across skills. */
function roundRobin(slots: PlanSlot[]): PlanSlot[] {
  const bySkill = new Map<string, PlanSlot[]>();
  for (const s of slots) bySkill.set(s.skill, [...(bySkill.get(s.skill) ?? []), s]);
  const queues = [...bySkill.values()];
  const out: PlanSlot[] = [];
  for (let i = 0; out.length < slots.length; i++) {
    for (const q of queues) if (q[i]) out.push(q[i]!);
  }
  return out;
}

export function allocatePlan(skills: PlanSkill[], profile: PlanProfile): Plan {
  const flags: string[] = [];
  if (skills.length === 0) return { slots: [], flags: ['no skills to plan'] };
  const minimum = 2 * skills.length;
  let total = profile.targetItems;
  if (minimum > total) {
    flags.push(
      `${skills.length} skills need ${minimum} items; coverage wins over the target of ${total}`,
    );
    total = minimum;
  }
  const extra = largestRemainder(
    total - minimum,
    skills.map((s) => Math.max(s.weight, 0.01)),
  );

  // 1-2. Slots per skill; the first two carry the coverage levels.
  const slots: PlanSlot[] = [];
  skills.forEach((skill, i) => {
    const count = 2 + extra[i]!;
    for (let n = 1; n <= count; n++) {
      slots.push({
        id: `${skill.code}.Q${String(n).padStart(2, '0')}`,
        skill: skill.code,
        level: n === 1 ? (i % 2 === 0 ? 'L1' : 'L2') : 'L3',
        difficulty: 0,
        kind: 'STATIC',
        type: 'single_choice',
        svg: false,
      });
    }
  });

  // 3a. Levels of the remaining slots follow the level mix.
  const levels = COGNITIVE_LEVELS.filter((l) => (profile.levelMix[l] ?? 0) > 0);
  const wanted = largestRemainder(
    total,
    levels.map((l) => profile.levelMix[l]!),
  );
  const remainingLevels = new Map<CognitiveLevel, number>(levels.map((l, i) => [l, wanted[i]!]));
  const coverage = slots.filter((s) => s.id.endsWith('.Q01') || s.id.endsWith('.Q02'));
  for (const s of coverage) remainingLevels.set(s.level, (remainingLevels.get(s.level) ?? 0) - 1);
  for (const s of roundRobin(slots.filter((s) => !coverage.includes(s)))) {
    s.level = takeLargest(remainingLevels, levels) ?? 'L2';
  }
  for (const s of slots) s.difficulty = COGNITIVE_LEVELS.indexOf(s.level) + 1;

  // 3b. TEMPLATE share: computation skills, mid levels first, spread across skills.
  const templateTarget = Math.ceil(profile.templateShare * total);
  const templatable = new Set(skills.filter((s) => s.templatable).map((s) => s.code));
  const candidates = roundRobin(slots.filter((s) => templatable.has(s.skill))).sort(
    (a, b) =>
      Number(a.level === 'L1' || a.level === 'L4') - Number(b.level === 'L1' || b.level === 'L4'),
  );
  for (const s of candidates.slice(0, templateTarget)) s.kind = 'TEMPLATE';
  if (candidates.length < templateTarget) {
    flags.push(
      `TEMPLATE target ${templateTarget} but only ${candidates.length} slots belong to templatable skills`,
    );
  }

  // 3c. Item types: the profile mix over all slots; TEMPLATE slots take template-capable types.
  const types = Object.keys(profile.itemTypeMix) as ItemType[];
  const typeCounts = largestRemainder(
    total,
    types.map((t) => profile.itemTypeMix[t]!),
  );
  const remainingTypes = new Map<ItemType, number>(types.map((t, i) => [t, typeCounts[i]!]));
  const templateTypes = types.filter((t) => (TEMPLATE_ITEM_TYPES as readonly string[]).includes(t));
  for (const s of roundRobin(slots.filter((s) => s.kind === 'TEMPLATE'))) {
    s.type = takeLargest(remainingTypes, templateTypes) ?? templateTypes[0] ?? 'numeric';
  }
  for (const s of roundRobin(slots.filter((s) => s.kind === 'STATIC'))) {
    s.type = takeLargest(remainingTypes, types) ?? 'single_choice';
  }

  // 3d. Figures: STATIC slots of visual skills.
  const svgTarget = Math.round(profile.svgShare * total);
  const visual = new Set(skills.filter((s) => s.visual).map((s) => s.code));
  const svgCandidates = roundRobin(
    slots.filter((s) => s.kind === 'STATIC' && visual.has(s.skill) && s.type !== 'ordering'),
  );
  for (const s of svgCandidates.slice(0, svgTarget)) s.svg = true;
  if (svgCandidates.length < svgTarget) {
    flags.push(`figure target ${svgTarget} but only ${svgCandidates.length} visual STATIC slots`);
  }

  for (const skill of skills) {
    const mine = slots.filter((s) => s.skill === skill.code);
    if (!mine.some((s) => isLow(s.level)) || !mine.some((s) => !isLow(s.level))) {
      flags.push(`${skill.code} lacks an L1-L2 or an L3+ slot`);
    }
  }
  return { slots, flags };
}

export interface PlanSummary {
  total: number;
  skills: number;
  templateShare: number;
  svgShare: number;
  perType: Partial<Record<ItemType, number>>;
  perLevel: Partial<Record<CognitiveLevel, number>>;
}

export function summarisePlan(slots: PlanSlot[]): PlanSummary {
  const perType: Partial<Record<ItemType, number>> = {};
  const perLevel: Partial<Record<CognitiveLevel, number>> = {};
  for (const s of slots) {
    perType[s.type] = (perType[s.type] ?? 0) + 1;
    perLevel[s.level] = (perLevel[s.level] ?? 0) + 1;
  }
  const n = slots.length || 1;
  return {
    total: slots.length,
    skills: new Set(slots.map((s) => s.skill)).size,
    templateShare: slots.filter((s) => s.kind === 'TEMPLATE').length / n,
    svgShare: slots.filter((s) => s.svg).length / n,
    perType,
    perLevel,
  };
}
