// `pnpm library:validate <path> [--write-manifest] [--seeds N] [--json]`
// Validates a library package (directory or .zip): schema + checksums, domain rules (references,
// cycles, orphan skills, source notes, answers, SVG sanitising), every template over N seeds
// (default 1,000), and prints the coverage report against the subject profile.
// --write-manifest refreshes manifest.json counts and checksums of a package directory first.
// --acceptance [--min-approved N] also checks the launch-library acceptance criteria
// (TASK_PACKS/X01.md): ≥480 approved items, ≥2 approved items per active skill, profile shares
// within ±5 points. It fails the run when they are not met.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  packageInventory,
  parseLibraryPackage,
  PACKAGE_FILES,
} from '../packages/contracts/src/library-package.ts';
import {
  coverageReport,
  libraryAcceptance,
  subjectProfile,
  validateLibraryPackage,
} from '../packages/domain/src/index.ts';
import { readPackage } from './lib/library-files.ts';

const args = process.argv.slice(2);
const seedsArg = args[args.indexOf('--seeds') + 1];
const seeds = args.includes('--seeds') ? Number(seedsArg) : 1000;
const minApproved = args.includes('--min-approved')
  ? Number(args[args.indexOf('--min-approved') + 1])
  : undefined;
const VALUED = ['--seeds', '--min-approved'];
const path = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1] ?? ''));
if (!path || !Number.isInteger(seeds) || seeds < 1) {
  console.error(
    'Usage: pnpm library:validate <package dir or .zip> [--write-manifest] [--seeds N] [--json] [--acceptance [--min-approved N]]',
  );
  process.exit(2);
}
const target = resolve(process.env.INIT_CWD ?? process.cwd(), path);

if (args.includes('--write-manifest')) {
  if (!statSync(target).isDirectory()) {
    console.error('--write-manifest needs a package directory');
    process.exit(2);
  }
  const manifestPath = join(target, PACKAGE_FILES.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const files = readPackage(target);
  const lines = (name: string) =>
    files[name]
      ? Buffer.from(files[name]!)
          .toString('utf8')
          .split('\n')
          .filter((l) => l.trim()).length
      : 0;
  const curriculum = files[PACKAGE_FILES.curriculum]
    ? (JSON.parse(Buffer.from(files[PACKAGE_FILES.curriculum]!).toString('utf8')) as {
        nodes: unknown[];
      })
    : { nodes: [] };
  const edges = files[PACKAGE_FILES.edges]
    ? (JSON.parse(Buffer.from(files[PACKAGE_FILES.edges]!).toString('utf8')) as unknown[])
    : [];
  manifest.counts = {
    nodes: curriculum.nodes.length,
    edges: edges.length,
    groups: lines(PACKAGE_FILES.groups),
    items: lines(PACKAGE_FILES.items),
    templates: lines(PACKAGE_FILES.templates),
    media: lines(PACKAGE_FILES.media),
  };
  manifest.checksums = (await packageInventory(files)).checksums;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const parsed = await parseLibraryPackage(readPackage(target));
const json = args.includes('--json');
if (!parsed.ok) {
  if (json) console.log(JSON.stringify({ valid: false, errors: parsed.errors }, null, 2));
  else for (const e of parsed.errors) console.error(`✗ ${e.code} ${e.message}`);
  process.exit(1);
}

const { pkg } = parsed;
const validation = validateLibraryPackage(pkg, { templateSeeds: seeds });
const profile = subjectProfile(pkg.manifest.grade, pkg.manifest.subject);
const coverage = coverageReport(
  pkg.curriculum.nodes
    .filter((n) => n.level === 'SKILL')
    .map((n) => ({ code: n.code, title: n.title })),
  pkg.items.map((i) => ({
    skills: i.skills,
    kind: i.kind,
    type: i.type,
    cognitiveLevel: i.cognitiveLevel,
    status: i.status,
    inGroup: i.group !== undefined,
    hasTts: Boolean(i.ttsText),
  })),
  profile,
);
const warnings = [...parsed.warnings, ...validation.warnings];
const acceptance =
  args.includes('--acceptance') && profile
    ? libraryAcceptance(coverage, profile, {
        ...(minApproved === undefined ? {} : { minApproved }),
        activeSkills: pkg.curriculum.nodes
          .filter((n) => n.level === 'SKILL' && n.status !== 'INACTIVE')
          .map((n) => n.code),
      })
    : undefined;
if (args.includes('--acceptance') && !profile) {
  console.error(`No subject profile for ${pkg.manifest.grade}-${pkg.manifest.subject}`);
  process.exit(2);
}
const valid = validation.errors.length === 0 && (acceptance?.ok ?? true);

if (json) {
  console.log(
    JSON.stringify({ valid, errors: validation.errors, warnings, coverage, acceptance }, null, 2),
  );
} else {
  const m = pkg.manifest;
  console.log(
    `${m.title} (${m.curriculumVersion}/${m.grade}-${m.subject}), ${pkg.items.length} items, ${seeds} seeds per template`,
  );
  for (const e of validation.errors) console.error(`✗ ${e.code} ${e.message}`);
  for (const w of warnings) console.warn(`! ${w.code} ${w.message}`);
  console.log(
    `Coverage: ${coverage.totalItems}/${coverage.targetItems} items (${coverage.approvedItems} approved), ` +
      `TEMPLATE ${Math.round(coverage.templateShare * 100)}%, groups ${Math.round(coverage.groupShare * 100)}%, ` +
      `written ${Math.round(coverage.writtenShare * 100)}%, read-aloud ${Math.round(coverage.readAloudShare * 100)}%`,
  );
  for (const s of coverage.perSkill) {
    const levels = Object.entries(s.byLevel)
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${l}:${n}`)
      .join(' ');
    console.log(
      `  ${s.active ? '✓' : '·'} ${s.code} ${s.items} items (${s.approved} approved) ${levels}`,
    );
  }
  for (const f of coverage.flags) console.log(`  flag: ${f}`);
  if (acceptance) {
    console.log('Acceptance (TASK_PACKS/X01.md):');
    for (const line of acceptance.lines) console.log(`  ${line}`);
  }
  console.log(
    validation.errors.length > 0
      ? `Package is invalid (${validation.errors.length} errors).`
      : acceptance && !acceptance.ok
        ? `Package is valid but does not meet the acceptance criteria (${acceptance.problems.length}).`
        : 'Package is valid.',
  );
}
process.exit(valid ? 0 : 1);
