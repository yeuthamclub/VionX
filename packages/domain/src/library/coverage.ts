// Coverage report per grade-subject (TASK_PACKS/M05.md "Rules"; ARCHITECTURE §3 allocation rule).
import {
  COGNITIVE_LEVELS,
  isServable,
  MIN_APPROVED_ITEMS_PER_SKILL,
  TARGET_ITEMS_PER_LIBRARY,
  type CognitiveLevel,
  type ContentStatus,
  type ItemKind,
  type ItemType,
} from './types.ts';

export interface CoverageItem {
  skills: string[];
  kind: ItemKind;
  type: ItemType;
  cognitiveLevel: CognitiveLevel;
  status: ContentStatus;
  inGroup: boolean;
  hasTts: boolean;
}

export interface CoverageSkill {
  code: string;
  title: string;
}

export interface CoverageProfile {
  templateShare: number;
  groupShare: number;
  writtenShare: number;
  readAloudDefault: boolean;
  targetItems?: number;
}

export interface SkillCoverage {
  code: string;
  title: string;
  items: number;
  approved: number;
  byLevel: Record<CognitiveLevel, number>;
  /** ≥ MIN_APPROVED_ITEMS_PER_SKILL approved items. */
  active: boolean;
  /** At least one L1-L2 and one L3+ item (allocation rule 1). */
  levelSpread: boolean;
}

export interface CoverageReport {
  totalItems: number;
  approvedItems: number;
  targetItems: number;
  perSkill: SkillCoverage[];
  perLevel: Record<CognitiveLevel, number>;
  perType: Partial<Record<ItemType, number>>;
  templateShare: number;
  groupShare: number;
  writtenShare: number;
  readAloudShare: number;
  inactiveSkills: string[];
  /** Readable findings (profile drift beyond ±5 points, coverage gaps). */
  flags: string[];
}

const SHARE_TOLERANCE = 0.05;

const emptyLevels = (): Record<CognitiveLevel, number> =>
  Object.fromEntries(COGNITIVE_LEVELS.map((l) => [l, 0])) as Record<CognitiveLevel, number>;

const share = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000;

/** Archived and rejected items do not count. */
export function coverageReport(
  skills: CoverageSkill[],
  allItems: CoverageItem[],
  profile?: CoverageProfile,
): CoverageReport {
  const items = allItems.filter((i) => i.status !== 'ARCHIVED' && i.status !== 'REJECTED');
  const perLevel = emptyLevels();
  const perType: Partial<Record<ItemType, number>> = {};
  for (const item of items) {
    perLevel[item.cognitiveLevel]++;
    perType[item.type] = (perType[item.type] ?? 0) + 1;
  }

  const perSkill: SkillCoverage[] = skills.map((skill) => {
    const mine = items.filter((i) => i.skills.includes(skill.code));
    const byLevel = emptyLevels();
    for (const item of mine) byLevel[item.cognitiveLevel]++;
    const approved = mine.filter((i) => isServable(i.status)).length;
    return {
      code: skill.code,
      title: skill.title,
      items: mine.length,
      approved,
      byLevel,
      active: approved >= MIN_APPROVED_ITEMS_PER_SKILL,
      levelSpread: byLevel.L1 + byLevel.L2 > 0 && byLevel.L3 + byLevel.L4 + byLevel.L5 > 0,
    };
  });

  const total = items.length;
  const report: CoverageReport = {
    totalItems: total,
    approvedItems: items.filter((i) => isServable(i.status)).length,
    targetItems: profile?.targetItems ?? TARGET_ITEMS_PER_LIBRARY,
    perSkill,
    perLevel,
    perType,
    templateShare: share(items.filter((i) => i.kind === 'TEMPLATE').length, total),
    groupShare: share(items.filter((i) => i.inGroup).length, total),
    writtenShare: share(perType.written ?? 0, total),
    readAloudShare: share(items.filter((i) => i.hasTts).length, total),
    inactiveSkills: perSkill.filter((s) => !s.active).map((s) => s.code),
    flags: [],
  };

  const flags = report.flags;
  if (total < report.targetItems) flags.push(`${total} of ${report.targetItems} items`);
  if (2 * skills.length > report.targetItems) {
    flags.push(
      `${skills.length} skills need ${2 * skills.length} items; coverage wins over the target`,
    );
  }
  const noSpread = perSkill.filter((s) => s.items > 0 && !s.levelSpread).length;
  if (noSpread > 0) flags.push(`${noSpread} skills lack an L1-L2 or an L3+ item`);
  if (profile) {
    const drift = (name: string, actual: number, expected: number) => {
      if (Math.abs(actual - expected) > SHARE_TOLERANCE + 1e-9) {
        flags.push(`${name} share ${pct(actual)} vs profile ${pct(expected)}`);
      }
    };
    drift('TEMPLATE', report.templateShare, profile.templateShare);
    drift('group', report.groupShare, profile.groupShare);
    drift('written', report.writtenShare, profile.writtenShare);
    if (profile.readAloudDefault && report.readAloudShare < 1) {
      flags.push(
        `read-aloud profile: ${total - items.filter((i) => i.hasTts).length} items lack tts text`,
      );
    }
  }
  return report;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
