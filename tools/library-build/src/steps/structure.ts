// Steps 2-4: `backbone` (GDPT program text → DOMAIN/TOPIC/SKILL tree), `map` (table-of-contents
// pages + backbone → lesson → skill mappings), `edges` (prerequisite edges with reasons). All on
// the structure_mapping task (Batch). Outputs are plain JSON the owner may edit by hand; a step
// keeps an existing output unless run with --force.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  lessonMappingOutputSchema,
  prerequisiteEdgesOutputSchema,
  skillBackboneOutputSchema,
} from '@vionx/ai/schemas';
import { findPrerequisiteCycle, type PackageEdge, type PackageNode } from '@vionx/domain';
import { runBatch } from '../ai/batch.ts';
import { PROMPT_VERSIONS, systemPrompt } from '../ai/prompts.ts';
import type { BuildContext } from '../context.ts';
import { readJson, writeJson } from '../lib/jsonl.ts';
import { words } from '../lib/text.ts';
import type { BuildProfile } from '../profile.ts';
import { loadPages, type SourceBook } from './textlayer.ts';

// --- backbone ---------------------------------------------------------------------------------------

export interface BackboneSkill {
  code: string;
  title: string;
  gdptRef: string;
  weight: number;
  templatable: boolean;
  visual: boolean;
}
export interface Backbone {
  domains: {
    code: string;
    title: string;
    topics: { code: string; title: string; skills: BackboneSkill[] }[];
  }[];
}

const SEGMENT = /^[A-Z][A-Z0-9]{1,11}$/;
const DEFAULT_GDPT_DIR = '/mnt/project-files/sources/gdpt';

/** The grade section of the program text: from the `from` heading to the `to` heading. */
export function gdptSection(text: string, gdpt: BuildProfile['gdpt']): string {
  const lines = text.split('\n');
  const find = (heading: string, start: number) =>
    lines.findIndex((l, i) => i >= start && l.trim() === heading);
  let from = find(gdpt.from, gdpt.afterLine);
  if (from < 0) from = find(gdpt.from, 0);
  if (from < 0) throw new Error(`heading "${gdpt.from}" not found in the program text`);
  const to = find(gdpt.to, from + 1);
  return lines.slice(from, to < 0 ? undefined : to).join('\n');
}

/** "Yêu cầu cần đạt" bullets (each starts with an en dash). */
export const requirementBullets = (section: string): string[] =>
  section
    .split('–')
    .slice(1)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter((b) => words(b).length >= 4);

/** Normalises segment codes to full codes and checks the tree. */
export function normaliseBackbone(
  raw: Backbone,
  prefix: string,
): { backbone: Backbone; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seg = (code: string) => code.trim().toUpperCase().split('.').pop()!;
  const seen = new Set<string>();
  const unique = (full: string) => {
    if (seen.has(full)) errors.push(`duplicate code ${full}`);
    seen.add(full);
  };
  const backbone: Backbone = {
    domains: raw.domains.map((d) => {
      const dc = `${prefix}.${seg(d.code)}`;
      if (!SEGMENT.test(seg(d.code))) errors.push(`bad domain code ${d.code}`);
      unique(dc);
      return {
        code: dc,
        title: d.title.trim(),
        topics: d.topics.map((t) => {
          const tc = `${dc}.${seg(t.code)}`;
          if (!SEGMENT.test(seg(t.code))) errors.push(`bad topic code ${t.code}`);
          unique(tc);
          if (t.skills.length === 0) warnings.push(`topic ${tc} has no skills`);
          return {
            code: tc,
            title: t.title.trim(),
            skills: t.skills.map((s) => {
              const sc = `${tc}.${seg(s.code)}`;
              if (!SEGMENT.test(seg(s.code))) errors.push(`bad skill code ${s.code}`);
              unique(sc);
              let weight = Number(s.weight);
              if (!(weight >= 0.5 && weight <= 3)) {
                warnings.push(`${sc}: weight ${s.weight} clamped to 0.5-3`);
                weight = Math.min(3, Math.max(0.5, Number.isFinite(weight) ? weight : 1));
              }
              return { ...s, code: sc, title: s.title.trim(), gdptRef: s.gdptRef.trim(), weight };
            }),
          };
        }),
      };
    }),
  };
  return { backbone, errors, warnings };
}

export const backboneSkills = (
  b: Backbone,
): (BackboneSkill & { topic: string; domain: string })[] =>
  b.domains.flatMap((d) =>
    d.topics.flatMap((t) => t.skills.map((s) => ({ ...s, topic: t.code, domain: d.code }))),
  );

/** Curriculum nodes for the package (GRADE, SUBJECT, DOMAIN, TOPIC, SKILL). */
export function backboneNodes(b: Backbone, profile: BuildProfile): PackageNode[] {
  const nodes: PackageNode[] = [
    { code: `GRADE.${profile.grade}`, parent: null, level: 'GRADE', title: `Lớp ${profile.grade}` },
    {
      code: profile.id,
      parent: `GRADE.${profile.grade}`,
      level: 'SUBJECT',
      title: profile.subjectTitle,
    },
  ];
  b.domains.forEach((d, i) => {
    nodes.push({
      code: d.code,
      parent: profile.id,
      level: 'DOMAIN',
      title: d.title,
      sortOrder: i + 1,
    });
    d.topics.forEach((t, j) => {
      nodes.push({
        code: t.code,
        parent: d.code,
        level: 'TOPIC',
        title: t.title,
        sortOrder: j + 1,
      });
      t.skills.forEach((s, k) =>
        nodes.push({
          code: s.code,
          parent: t.code,
          level: 'SKILL',
          title: s.title,
          gdptRef: s.gdptRef,
          weight: s.weight,
          sortOrder: k + 1,
        }),
      );
    });
  });
  return nodes;
}

export const loadBackbone = (ctx: BuildContext): Backbone =>
  readJson<Backbone>(ctx.path('backbone.json'));

function gdptFile(ctx: BuildContext): string {
  const arg = ctx.arg('gdpt');
  const base = arg
    ? resolve(process.env.INIT_CWD ?? process.cwd(), arg)
    : (process.env.VIONX_GDPT_DIR ?? DEFAULT_GDPT_DIR);
  const file = base.endsWith('.txt') ? base : resolve(base, ctx.profile.gdpt.file);
  if (!existsSync(file))
    throw new Error(`GDPT program text not found at ${file} (use --gdpt <file or dir>)`);
  return file;
}

export async function backbone(ctx: BuildContext): Promise<void> {
  if (ctx.has('backbone.json') && !ctx.opts.force) {
    ctx.log('backbone: backbone.json exists (edit it by hand, or --force to rebuild)');
    ctx.markStep('backbone', 'done');
    return;
  }
  const file = gdptFile(ctx);
  const section = gdptSection(readFileSync(file, 'utf8'), ctx.profile.gdpt);
  const bullets = requirementBullets(section);
  const { profile } = ctx;
  const outcome = await runBatch<Backbone>(
    ctx,
    'backbone',
    'structure_mapping',
    PROMPT_VERSIONS.backbone,
    [
      {
        key: 'backbone',
        item: {
          system: systemPrompt(PROMPT_VERSIONS.backbone),
          input: {
            subject: profile.id,
            subjectTitle: profile.subjectTitle,
            grade: profile.grade,
            programText: section,
          },
          outputSchema: skillBackboneOutputSchema,
          sourceRefs: [`GDPT:${profile.gdpt.file}:${profile.gdpt.from}`],
        },
      },
    ],
  );
  if (!outcome.complete) return ctx.markStep('backbone', 'pending');
  const {
    backbone: tree,
    errors,
    warnings,
  } = normaliseBackbone(outcome.results.get('backbone')!.output!, profile.id);
  for (const w of warnings) ctx.log(`  ! ${w}`);
  if (errors.length)
    throw new Error(`backbone output is invalid:\n  ${errors.join('\n  ')}\nRe-run with --force.`);
  const skills = backboneSkills(tree);
  // A bullet is covered when some skill quotes it: ≥80% of the skill's gdptRef words are in it.
  const refs = skills.map((s) => words(s.gdptRef)).filter((r) => r.length > 0);
  const uncovered = bullets.filter((b) => {
    const w = new Set(words(b));
    return !refs.some((r) => r.filter((x) => w.has(x)).length / r.length >= 0.8);
  });
  writeJson(ctx.path('backbone.json'), tree);
  writeJson(ctx.path('backbone-coverage.json'), { bullets: bullets.length, uncovered });
  ctx.markStep('backbone', 'done', {
    skills: skills.length,
    uncoveredRequirements: uncovered.length,
  });
  ctx.log(
    `backbone: ${tree.domains.length} domains, ${tree.domains.reduce((a, d) => a + d.topics.length, 0)} topics, ${skills.length} skills → backbone.json`,
  );
  for (const u of uncovered)
    ctx.log(`  ! requirement not quoted by any skill: "${u.slice(0, 90)}"`);
}

// --- map --------------------------------------------------------------------------------------------

export interface Lesson {
  lessonRef: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  skills: string[];
}
export type LessonMap = Record<string, { kind: SourceBook['kind']; lessons: Lesson[] }>;

/** Checks a book's lessons: known skills, ascending pages, filled page ends. */
export function normaliseLessons(
  raw: {
    lessonRef: string;
    title: string;
    pageStart: number;
    pageEnd: number | null;
    skills: string[];
  }[],
  knownSkills: Set<string>,
  pageCount: number,
): { lessons: Lesson[]; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lessons = raw.map((l, i) => {
    const next = raw[i + 1];
    const pageEnd = l.pageEnd ?? (next ? Math.max(l.pageStart, next.pageStart - 1) : pageCount);
    const unknown = l.skills.filter((s) => !knownSkills.has(s));
    if (unknown.length)
      warnings.push(`${l.lessonRef}: unknown skills dropped (${unknown.join(', ')})`);
    if (pageEnd < l.pageStart)
      errors.push(`${l.lessonRef}: pageEnd ${pageEnd} before pageStart ${l.pageStart}`);
    if (next && next.pageStart < l.pageStart)
      errors.push(`${next.lessonRef} starts before ${l.lessonRef}`);
    if (next && next.pageStart > pageEnd + 1)
      warnings.push(`pages ${pageEnd + 1}-${next.pageStart - 1} belong to no lesson`);
    if (pageEnd > pageCount)
      warnings.push(
        `${l.lessonRef}: page ${pageEnd} beyond the ${pageCount} PDF pages (printed numbering?)`,
      );
    return {
      lessonRef: l.lessonRef,
      title: l.title,
      pageStart: l.pageStart,
      pageEnd,
      skills: l.skills.filter((s) => knownSkills.has(s)),
    };
  });
  return { lessons, errors, warnings };
}

const TOC = /m[ụu]c\s*l[ụu]c/i;

export async function map(ctx: BuildContext): Promise<void> {
  ctx.requireStep('textlayer');
  ctx.requireStep('backbone');
  if (ctx.has('map.json') && !ctx.opts.force) {
    ctx.log('map: map.json exists (edit it by hand, or --force to rebuild)');
    ctx.markStep('map', 'done');
    return;
  }
  const books = readJson<SourceBook[]>(ctx.path('sources.json'));
  const pages = loadPages(ctx);
  const skills = backboneSkills(loadBackbone(ctx));
  // The backbone is the same for every book: it goes in the cached system prompt.
  const system = `${systemPrompt(PROMPT_VERSIONS.map)}\n## Skill backbone\n${skills.map((s) => `- ${s.code}: ${s.title} (${s.gdptRef})`).join('\n')}\n`;
  const jobs = books.map((book) => {
    const own = pages.filter((p) => p.book === book.id);
    let toc = own.filter((p) => TOC.test(p.text));
    if (toc.length === 0) toc = [...own.slice(0, 4), ...own.slice(-4)];
    return {
      key: book.id,
      item: {
        system,
        input: {
          book: book.id,
          kind: book.kind,
          pageCount: book.pages,
          tocPages: toc.map((p) => ({ page: p.page, text: p.text })),
        },
        outputSchema: lessonMappingOutputSchema,
        sourceRefs: toc.map((p) => `${book.kind}:${book.id}:${p.page}`),
      },
    };
  });
  const outcome = await runBatch<{ lessons: Parameters<typeof normaliseLessons>[0] }>(
    ctx,
    'map',
    'structure_mapping',
    PROMPT_VERSIONS.map,
    jobs,
  );
  if (!outcome.complete) return ctx.markStep('map', 'pending');
  const known = new Set(skills.map((s) => s.code));
  const result: LessonMap = {};
  const errors: string[] = [];
  for (const book of books) {
    const n = normaliseLessons(outcome.results.get(book.id)!.output!.lessons, known, book.pages);
    for (const w of n.warnings) ctx.log(`  ! ${book.id}: ${w}`);
    errors.push(...n.errors.map((e) => `${book.id}: ${e}`));
    result[book.id] = { kind: book.kind, lessons: n.lessons };
  }
  if (errors.length)
    throw new Error(
      `lesson map is invalid:\n  ${errors.join('\n  ')}\nRe-run with --force or fix map.json.`,
    );
  const mapped = new Set(Object.values(result).flatMap((b) => b.lessons.flatMap((l) => l.skills)));
  const unmapped = skills.filter((s) => !mapped.has(s.code)).map((s) => s.code);
  writeJson(ctx.path('map.json'), result);
  ctx.markStep('map', 'done', {
    lessons: Object.values(result).reduce((a, b) => a + b.lessons.length, 0),
    unmappedSkills: unmapped.length,
  });
  ctx.log(
    `map: ${Object.values(result).reduce((a, b) => a + b.lessons.length, 0)} lessons in ${books.length} book(s) → map.json`,
  );
  if (unmapped.length)
    ctx.log(
      `  ! ${unmapped.length} skills have no lesson: ${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? ', …' : ''}`,
    );
}

// --- edges ------------------------------------------------------------------------------------------

/** Drops unknown, self and duplicate edges, and breaks PREREQUISITE_OF cycles (last edge of each). */
export function normaliseEdges(
  raw: PackageEdge[],
  known: Set<string>,
): { edges: PackageEdge[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const edges: PackageEdge[] = [];
  for (const e of raw) {
    const key = `${e.from}>${e.to}>${e.type}`;
    if (!known.has(e.from) || !known.has(e.to))
      warnings.push(`unknown code in ${e.from} → ${e.to}`);
    else if (e.from === e.to) warnings.push(`self edge ${e.from}`);
    else if (seen.has(key)) continue;
    else {
      seen.add(key);
      edges.push(e);
    }
  }
  for (;;) {
    const cycle = findPrerequisiteCycle(edges.filter((e) => e.type === 'PREREQUISITE_OF'));
    if (!cycle) break;
    const [from, to] = [cycle[cycle.length - 2]!, cycle[cycle.length - 1]!];
    warnings.push(`cycle ${cycle.join(' → ')}: dropped ${from} → ${to}`);
    edges.splice(
      edges.findIndex((e) => e.type === 'PREREQUISITE_OF' && e.from === from && e.to === to),
      1,
    );
  }
  return { edges, warnings };
}

export async function edges(ctx: BuildContext): Promise<void> {
  ctx.requireStep('backbone');
  if (ctx.has('edges.json') && !ctx.opts.force) {
    ctx.log('edges: edges.json exists (edit it by hand, or --force to rebuild)');
    ctx.markStep('edges', 'done');
    return;
  }
  const tree = loadBackbone(ctx);
  const skills = backboneSkills(tree);
  const outcome = await runBatch<{ edges: PackageEdge[] }>(
    ctx,
    'edges',
    'structure_mapping',
    PROMPT_VERSIONS.edges,
    [
      {
        key: 'edges',
        item: {
          system: systemPrompt(PROMPT_VERSIONS.edges),
          input: {
            subject: ctx.profile.id,
            skills: skills.map((s) => ({
              code: s.code,
              title: s.title,
              topic: s.topic,
              gdptRef: s.gdptRef,
            })),
          },
          outputSchema: prerequisiteEdgesOutputSchema,
        },
      },
    ],
  );
  if (!outcome.complete) return ctx.markStep('edges', 'pending');
  const known = new Set([
    ...skills.map((s) => s.code),
    ...tree.domains.flatMap((d) => d.topics.map((t) => t.code)),
  ]);
  const { edges: list, warnings } = normaliseEdges(
    outcome.results.get('edges')!.output!.edges,
    known,
  );
  for (const w of warnings) ctx.log(`  ! ${w}`);
  writeJson(ctx.path('edges.json'), list);
  ctx.markStep('edges', 'done', { edges: list.length });
  ctx.log(
    `edges: ${list.filter((e) => e.type === 'PREREQUISITE_OF').length} prerequisite and ${list.filter((e) => e.type !== 'PREREQUISITE_OF').length} related edges → edges.json`,
  );
}
