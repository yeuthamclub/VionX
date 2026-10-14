// Step 12 `package [--upload [--bucket library-packages]]`: builds the M05 library package from
// the approved items (library/<version>/<grade>-<subject>/ + a zip), validates it with the same
// rules as `pnpm library:validate` (1,000 seeds per template), writes report.json with the numbers
// the X01 report needs, and prints the AI cost from the ai_runs log. Upload only with --upload.
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { zipSync } from 'fflate';
import {
  coverageReport,
  libraryAcceptance,
  validateLibraryPackage,
  type PackageEdge,
  type PackageMapping,
  type PackageMedia,
} from '@vionx/domain';
import {
  packageInventory,
  parseLibraryPackage,
  PACKAGE_FILES,
  type PackageFiles,
} from '@vionx/contracts';
import { costSummary } from '../ai/runs.ts';
import type { BuildContext } from '../context.ts';
import { readJson, writeFileAtomic, writeJson } from '../lib/jsonl.ts';
import { uploadObject } from '../lib/storage.ts';
import { ItemStore } from '../items.ts';
import { packageFolder } from '../profile.ts';
import { loadMedia, MEDIA_LICENSE } from './media.ts';
import { loadPlan } from './plan.ts';
import { backboneNodes, loadBackbone, type LessonMap } from './structure.ts';

const enc = new TextEncoder();
const jsonFile = (v: unknown) => enc.encode(`${JSON.stringify(v, null, 2)}\n`);
const jsonlFile = (rows: unknown[]) =>
  enc.encode(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

export async function packageStep(ctx: BuildContext): Promise<void> {
  for (const step of ['backbone', 'edges', 'map']) ctx.requireStep(step);
  const plan = loadPlan(ctx);
  const { profile } = ctx;
  const store = new ItemStore(ctx);
  const approved = store.list((r) => r.item.status === 'APPROVED');
  const reviewer = (ctx.state().steps['review-import']?.reviewer as string | undefined) ?? null;
  if (approved.length === 0)
    ctx.log('  ! no approved items yet: the package holds the curriculum only');

  // Curriculum, edges, lesson mappings (SGK books only).
  const nodes = backboneNodes(loadBackbone(ctx), profile);
  const edges = readJson<PackageEdge[]>(ctx.path('edges.json'));
  const lessonMap = readJson<LessonMap>(ctx.path('map.json'));
  const mappings = new Map<string, PackageMapping>();
  for (const book of Object.values(lessonMap).filter((b) => b.kind === 'SGK')) {
    for (const l of book.lessons) {
      for (const node of l.skills) {
        mappings.set(`${l.lessonRef}>${node}`, {
          series: profile.bookSeries.code,
          lessonRef: l.lessonRef,
          title: l.title,
          pageStart: l.pageStart,
          pageEnd: l.pageEnd,
          node,
        });
      }
    }
  }

  // Media used by approved items; approving the item approves its figure.
  const mediaRecords = new Map(loadMedia(ctx).map((m) => [m.code, m]));
  const usedMedia = [...new Set(approved.flatMap((r) => r.item.media))].sort();
  const files: PackageFiles = {};
  const media: PackageMedia[] = usedMedia.map((code) => {
    const m = mediaRecords.get(code);
    if (!m)
      throw new Error(`media ${code} is used by an approved item but missing from media.jsonl`);
    files[`media/${m.file}`] = readFileSync(ctx.path('media', m.file));
    return {
      code,
      kind: 'SVG',
      file: m.file,
      alt: m.alt,
      license: MEDIA_LICENSE,
      reviewStatus: 'APPROVED',
    };
  });

  const items = approved.map((r) => r.item);
  const templates = approved.flatMap((r) => (r.template ? [r.template] : []));
  const runs = costSummary(ctx.runs.records());
  Object.assign(files, {
    [PACKAGE_FILES.curriculum]: jsonFile({ version: profile.curriculum, nodes }),
    [PACKAGE_FILES.edges]: jsonFile(edges),
    [PACKAGE_FILES.mappings]: jsonFile({
      series: [profile.bookSeries],
      mappings: [...mappings.values()],
    }),
    [PACKAGE_FILES.groups]: jsonlFile([]),
    [PACKAGE_FILES.items]: jsonlFile(items),
    [PACKAGE_FILES.templates]: jsonlFile(templates),
    [PACKAGE_FILES.media]: jsonlFile(media),
  });
  const manifest = {
    format: 1,
    curriculumVersion: profile.curriculum.code,
    grade: profile.grade,
    subject: profile.subject,
    title: profile.subjectTitle,
    bookSeries: profile.bookSeries.code,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      groups: 0,
      items: items.length,
      templates: templates.length,
      media: media.length,
    },
    checksums: (await packageInventory(files)).checksums,
    models: runs.models,
    reviewer,
    createdAt: new Date().toISOString(),
  };
  files[PACKAGE_FILES.manifest] = jsonFile(manifest);

  // Validate exactly what will ship.
  const parsed = await parseLibraryPackage(files);
  if (!parsed.ok)
    throw new Error(
      `package does not parse:\n  ${parsed.errors.map((e) => `${e.code} ${e.message}`).join('\n  ')}`,
    );
  const validation = validateLibraryPackage(parsed.pkg, { templateSeeds: 1000 });
  const skillNodes = nodes.filter((n) => n.level === 'SKILL');
  const coverage = coverageReport(
    skillNodes.map((n) => ({ code: n.code, title: n.title })),
    items.map((i) => ({
      skills: i.skills,
      kind: i.kind,
      type: i.type,
      cognitiveLevel: i.cognitiveLevel,
      status: i.status,
      inGroup: false,
      hasTts: Boolean(i.ttsText),
    })),
    profile.library,
  );
  const acceptance = libraryAcceptance(coverage, profile.library, {
    activeSkills: skillNodes.map((n) => n.code),
  });

  const folder = `library/${profile.curriculum.code}/${packageFolder(profile)}`;
  rmSync(ctx.path('package'), { recursive: true, force: true });
  for (const [name, bytes] of Object.entries(files))
    writeFileAtomic(ctx.path('package', folder, name), bytes);
  const zip = zipSync(
    Object.fromEntries(Object.entries(files).map(([n, b]) => [n, new Uint8Array(b)])),
  );
  const zipPath = ctx.path('package', `${packageFolder(profile)}.zip`);
  writeFileAtomic(zipPath, zip);
  const zipSha = createHash('sha256').update(zip).digest('hex');

  // Report numbers (TASK_PACKS/X01.md "Acceptance": per-skill counts, type mix, TEMPLATE share,
  // verifier disagreement rate, rejection rate, AI cost, review hours).
  const all = [...store.list(), ...store.history()];
  const verified = all.filter((r) => r.verify);
  const reviewed = all.filter((r) => r.review);
  const report = {
    profile: profile.id,
    fake: ctx.opts.fake,
    package: {
      dir: ctx.path('package', folder),
      zip: zipPath,
      sha256: zipSha,
      valid: validation.errors.length === 0,
    },
    plan: { slots: plan.slots.length, approvedBy: plan.approvedBy ?? null },
    items: {
      approved: items.length,
      inReview: store.list((r) => r.item.status === 'NEEDS_REVIEW').length,
      rejectedFinal: store.list((r) => r.item.status === 'REJECTED').length,
    },
    coverage: {
      perSkill: coverage.perSkill.map((s) => ({
        code: s.code,
        approved: s.approved,
        byLevel: s.byLevel,
      })),
      perType: coverage.perType,
      templateShare: coverage.templateShare,
      flags: coverage.flags,
    },
    rates: {
      attempts: all.length,
      checkRejectionRate: ratio(
        all.filter((r) => r.rejectedFor?.some((x) => !x.startsWith('review:'))).length,
        all.length,
      ),
      verifierDisagreementRate: ratio(
        verified.filter((r) => !r.verify!.agree).length,
        verified.length,
      ),
      reviewRejectionRate: ratio(
        reviewed.filter((r) => r.review!.verdict === 'REJECTED').length,
        reviewed.length,
      ),
      reviewEditRate: ratio(
        reviewed.filter((r) => r.review!.verdict === 'EDITED').length,
        reviewed.length,
      ),
      copyCheckFailures: all.filter((r) => r.checks?.some((c) => c.check === 'ngram' && !c.ok))
        .length,
    },
    ai: runs,
    review: { reviewer, hours: Number(ctx.state().steps['review-import']?.hours ?? 0) },
    acceptance,
    validation: { errors: validation.errors, warnings: validation.warnings.length },
  };
  writeJson(ctx.path('report.json'), report);

  if (ctx.flag('upload')) {
    const bucket = ctx.arg('bucket') ?? 'library-packages';
    const object = `${profile.curriculum.code}/${packageFolder(profile)}/${zipSha}.zip`;
    await uploadObject(bucket, object, zip, 'application/zip');
    ctx.log(`  uploaded ${bucket}/${object}`);
  }

  const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);
  for (const e of validation.errors) ctx.log(`  ✗ ${e.code} ${e.message}`);
  ctx.log(
    `package: ${items.length} approved items, ${templates.length} templates, ${media.length} figures, ${nodes.length} nodes, ${edges.length} edges → ${zipPath}`,
  );
  ctx.log(
    `  TEMPLATE ${pct(coverage.templateShare)}, verifier disagreement ${pct(report.rates.verifierDisagreementRate)}, review rejection ${pct(report.rates.reviewRejectionRate)}, review hours ${report.review.hours}`,
  );
  ctx.log(
    `  AI cost from ai_runs: US$${runs.totalUsd.toFixed(2)}${ctx.opts.fake ? ' (fake run)' : ''}`,
  );
  for (const r of runs.rows)
    ctx.log(
      `    ${r.step.padEnd(14)} ${r.task.padEnd(18)} ${String(r.calls).padStart(5)} calls  in ${r.input}  out ${r.output}  cache ${r.cacheRead}  US$${r.costUsd.toFixed(4)}`,
    );
  ctx.log('  acceptance (TASK_PACKS/X01.md):');
  for (const line of acceptance.lines) ctx.log(`    ${line}`);
  if (validation.errors.length > 0)
    throw new Error(`the package is invalid (${validation.errors.length} errors)`);
  ctx.markStep('package', 'done', { items: items.length, sha256: zipSha });
}

const ratio = (part: number, whole: number) =>
  whole === 0 ? null : Number((part / whole).toFixed(3));
