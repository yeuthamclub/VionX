// Step 5 `plan [--target N]`: allocates the library over the skills (lib/plan.ts) and writes
// plan.csv for the owner. The owner may edit level/kind/type/figure cells, delete or add rows,
// then runs `plan --approve [--by NAME]`, which re-reads plan.csv. `generate` needs an approved plan.
import { readFileSync } from 'node:fs';
import {
  COGNITIVE_LEVELS,
  ITEM_KINDS,
  ITEM_TYPES,
  isTemplateItemType,
  type CognitiveLevel,
  type ItemKind,
  type ItemType,
} from '@vionx/domain';
import type { BuildContext } from '../context.ts';
import { parseCsv, toCsv } from '../lib/csv.ts';
import { readJsonIf, writeFileAtomic, writeJson } from '../lib/jsonl.ts';
import { allocatePlan, summarisePlan, type PlanSlot } from '../lib/plan.ts';
import { backboneSkills, loadBackbone } from './structure.ts';

export interface PlanFile {
  approved: boolean;
  approvedAt?: string;
  approvedBy?: string;
  target: number;
  flags: string[];
  slots: PlanSlot[];
}

const HEADER = [
  'slot',
  'skill',
  'skill_title',
  'topic',
  'level',
  'difficulty',
  'kind',
  'type',
  'figure',
  'note',
];

export function loadPlan(ctx: BuildContext, { approved = true } = {}): PlanFile {
  const plan = readJsonIf<PlanFile>(ctx.path('plan.json'));
  if (!plan) throw new Error(`no plan: run \`pnpm library:build ${ctx.profile.id} plan\` first`);
  if (approved && !plan.approved)
    throw new Error(
      `plan.csv is not approved: review it, then run \`pnpm library:build ${ctx.profile.id} plan --approve\``,
    );
  return plan;
}

/** Reads an edited plan.csv back into slots; throws with every problem found. */
export function planFromCsv(
  text: string,
  skillCodes: Set<string>,
  writtenAllowed: boolean,
): PlanSlot[] {
  const { rows } = parseCsv(text);
  const problems: string[] = [];
  const ids = new Set<string>();
  const slots: PlanSlot[] = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const id = row.slot?.trim() ?? '';
    const skill = row.skill?.trim() ?? '';
    const level = row.level?.trim() as CognitiveLevel;
    const kind = row.kind?.trim().toUpperCase() as ItemKind;
    const type = row.type?.trim() as ItemType;
    const err = (m: string) => problems.push(`plan.csv:${line} ${m}`);
    if (!skillCodes.has(skill)) err(`unknown skill ${skill}`);
    if (!new RegExp(`^${skill.replace(/\./g, '\\.')}\\.Q\\d{2,3}$`).test(id))
      err(`slot id ${id} must be <skill>.Q<nn>`);
    if (ids.has(id)) err(`slot ${id} repeats`);
    ids.add(id);
    if (!COGNITIVE_LEVELS.includes(level)) err(`level ${level}`);
    if (!ITEM_KINDS.includes(kind)) err(`kind ${row.kind}`);
    if (!ITEM_TYPES.includes(type) || (type === 'written' && !writtenAllowed)) err(`type ${type}`);
    if (kind === 'TEMPLATE' && !isTemplateItemType(type)) err(`${type} cannot be a TEMPLATE`);
    const figure = (row.figure ?? '').trim().toLowerCase();
    if (!['yes', 'no', ''].includes(figure)) err(`figure must be yes or no`);
    const difficulty = Number(row.difficulty || COGNITIVE_LEVELS.indexOf(level) + 1);
    if (!(difficulty >= 1 && difficulty <= 5)) err(`difficulty ${row.difficulty}`);
    slots.push({ id, skill, level, difficulty, kind, type, svg: figure === 'yes' });
  });
  if (problems.length) throw new Error(problems.join('\n'));
  return slots;
}

function printSummary(ctx: BuildContext, slots: PlanSlot[], flags: string[]) {
  const s = summarisePlan(slots);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  ctx.log(
    `  ${s.total} items over ${s.skills} skills; TEMPLATE ${pct(s.templateShare)} (profile ≥${pct(ctx.profile.library.templateShare)}), figures ${pct(s.svgShare)}`,
  );
  ctx.log(
    `  types: ${Object.entries(s.perType)
      .map(([t, n]) => `${t} ${n}`)
      .join(', ')}`,
  );
  ctx.log(
    `  levels: ${Object.entries(s.perLevel)
      .map(([l, n]) => `${l} ${n}`)
      .join(', ')}`,
  );
  for (const f of flags) ctx.log(`  flag: ${f}`);
}

export async function plan(ctx: BuildContext): Promise<void> {
  ctx.requireStep('backbone');
  const { profile } = ctx;
  if (profile.library.groupShare > 0)
    throw new Error(
      `${profile.id} plans passage groups; group slots arrive with the first profile that needs them (X03)`,
    );
  const tree = loadBackbone(ctx);
  const skills = backboneSkills(tree);
  const existing = readJsonIf<PlanFile>(ctx.path('plan.json'));

  if (ctx.flag('approve')) {
    if (!existing) throw new Error('run `plan` first, review plan.csv, then approve');
    const slots = planFromCsv(
      readFileSync(ctx.path('plan.csv'), 'utf8'),
      new Set(skills.map((s) => s.code)),
      profile.library.writtenShare > 0,
    );
    const by = ctx.arg('by') ?? process.env.USER ?? 'owner';
    writeJson(ctx.path('plan.json'), {
      ...existing,
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedBy: by,
      slots,
    });
    ctx.markStep('plan', 'done', { slots: slots.length, approvedBy: by });
    ctx.log(`plan: approved ${slots.length} slots from plan.csv (by ${by})`);
    printSummary(ctx, slots, existing.flags);
    return;
  }

  if (existing?.approved && !ctx.opts.force)
    throw new Error(
      'plan.json is approved; re-plan with --force (generated items keep their slot ids)',
    );
  const target = Number(ctx.arg('target') ?? profile.library.targetItems);
  if (!Number.isInteger(target) || target < 1)
    throw new Error(`--target must be a positive integer`);
  const result = allocatePlan(skills, {
    targetItems: target,
    templateShare: profile.library.templateShare,
    itemTypeMix: profile.library.itemTypeMix,
    levelMix: profile.levelMix,
    svgShare: profile.svgShare,
  });
  const bySkill = new Map(skills.map((s) => [s.code, s]));
  writeFileAtomic(
    ctx.path('plan.csv'),
    toCsv(
      HEADER,
      result.slots.map((s) => ({
        slot: s.id,
        skill: s.skill,
        skill_title: bySkill.get(s.skill)!.title,
        topic: bySkill.get(s.skill)!.topic,
        level: s.level,
        difficulty: String(s.difficulty),
        kind: s.kind,
        type: s.type,
        figure: s.svg ? 'yes' : 'no',
        note: '',
      })),
    ),
  );
  writeJson(ctx.path('plan.json'), {
    approved: false,
    target,
    flags: result.flags,
    slots: result.slots,
  } satisfies PlanFile);
  ctx.markStep('plan', 'pending', { slots: result.slots.length });
  ctx.log(`plan: ${result.slots.length} slots → plan.csv (review it, then \`plan --approve\`)`);
  printSummary(ctx, result.slots, result.flags);
}
