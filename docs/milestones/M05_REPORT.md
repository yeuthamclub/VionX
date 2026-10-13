# M05 Report

## Summary
The content team can now load a whole grade-subject library (curriculum tree, prerequisite edges,
book mappings, media, items, item groups and variant templates) from one zip package. They
dry-run it first to see what would change, apply it, and re-import the same package with no
effect. An invalid package is refused with a readable reason, for example the exact path of a
prerequisite cycle. In the admin they can browse the curriculum tree with per-skill coverage,
filter and edit items (KaTeX preview, SVG preview, read-aloud preview, re-roll a template variant
by seed) and edit passage groups. Children and parents see nothing new yet: child-facing practice
comes in M06.

## Changed
- Migrations: `0008_library_core.sql`. It creates the `library` schema: curriculum versions and
  nodes, knowledge edges, book series and lesson mappings, subject profiles (the 8 launch
  libraries are seeded), media assets, item groups, items, item templates, item stats, item
  reports, tutor answers and import runs. It also adds the `skill_item_counts` view. RLS is on
  every table and client grants are revoked.
- Domain (`packages/domain/src/library/`):
  - seeded template variants (`renderVariant`, `probeTemplate`), using math.js in a sandbox;
  - an allowlist SVG sanitiser;
  - package validation (`validateLibraryPackage`, which includes cycle detection with the cycle's
    path);
  - the coverage report, entity diff and subject profiles.
- Contracts:
  - Zod schemas for every package file (`library-package.ts`), with checksum checks;
  - JSON Schemas generated into `packages/contracts/library/`;
  - the admin API schemas (`library.ts`);
  - a new error code, `PACKAGE_INVALID` (422).
- API routes (all under `/v1/admin/library`):
  - `POST /import?mode=dry-run|apply`: zip body, 20 MB max, one advisory lock per grade-subject.
  - `GET /`, `/imports`, `/curriculum`, `/coverage`, `/items`, `/items/{id}`, `/groups` and
    `/groups/{id}`.
  - `GET /items/{id}/variant?seed=`: flags the template and answers 409 when it cannot satisfy
    its constraints.
  - `PATCH /items/{id}` and `/groups/{id}`: optimistic `version`, domain rule checks, audited.
- Worker / cron jobs: none.
- Mobile screens: none.
- Admin screens:
  - Library Packages: upload, dry-run diff, apply, import history.
  - Curriculum Tree, with the coverage report.
  - Questions: list, plus an editor with preview, media, TTS and variant re-roll.
  - Groups: list and editor.
  - Read access: CONTENT_ADMIN, CURRICULUM_EDITOR, CONTENT_REVIEWER, LIBRARIAN. Edit access:
    CONTENT_ADMIN, CONTENT_REVIEWER. Import: CONTENT_ADMIN only.
- Config / env vars / ai_task_config: none.
- Tooling:
  - `pnpm library:validate <dir> [--seeds N] [--write-manifest] [--json]`;
  - admin dependency `katex@0.18.9`;
  - root dev dependency `fflate@0.8.2`.

## Evidence
- `pnpm check`: green after merging main (M03). Lint, typecheck (including deno), unit tests,
  106/106 API integration tests and the openapi diff all pass.
- Acceptance (`pnpm acceptance m05`): 8 passed, 0 failed.
  ```
  Toán 6        nodes +13, edges +3, series +1, mappings +3, media +1, items +10, templates +3; re-import no-op
  Toán 2        nodes +9, edges +2, media +3, items +6, templates +2; re-import no-op; read-aloud 100%
  Tiếng Việt 2  nodes +13, edges +2, media +3, groups +2, items +7, templates +1; re-import no-op
  Cycle package → 422 "PREREQUISITE_OF edges form a cycle: MATH.6.NUM.FRAC.ADD → MATH.6.NUM.NAT.GCD → MATH.6.NUM.FRAC.SIMP → MATH.6.NUM.FRAC.ADD"
  library:validate exits 0 on the three fixtures and 1 on the cycle
  6 fixture templates × 10,000 seeds hold their constraints
  ```
- Regression acceptance after the merge: m00 7/7, m01 9/9, m02 11/11, m03 7/7 (skips unchanged).
- Maestro flow: not applicable; M05 ships no mobile screen.
- Build link: none.
- AI cost: 0. No model calls; the fixtures are hand-written test packages.

## Decisions
- The migration is numbered 0008. M03 took 0007 and M04 uses 0009, as agreed between the module
  threads.
- Placeholders are matched by `/\{\{([^{}]+)\}\}/g` so KaTeX braces such as `\frac{{{a}}}{{{n}}}`
  render correctly. Numbers use a decimal comma by default.
- A package can only remove content by archiving it, never by deleting it. A code owned by another
  grade-subject is refused (`CODE_TAKEN`). Shared GRADE nodes are never archived by a subject
  package.
- An admin edit sets `content_hash` to `admin:<sha>`. A later import whose package still carries
  the old line shows up as an update in the dry-run, so a reviewer sees it before overwriting.
- Nullable references to shared OpenAPI components use `z.union([X, z.null()])`. `.nullable()` on a
  named schema had made the shared component itself nullable in the generated client types.

## Privacy & security impact
- Library tables hold no personal data: content, curriculum and aggregate counters only.
- `import_runs` records the admin user id, as other admin audit rows do.
- Uploaded SVG is sanitised against an allowlist. Scripts, event handlers, DOCTYPE/ENTITY and
  external references are refused, and the admin shows SVG only through `<img src="data:…">`.
- KaTeX renders with `trust: false`.
- Audit events: `library.import_applied`, `library.item_updated`, `library.group_updated`. Domain
  event: `library.imported`.
- No consent is needed: nothing here is child-facing or personalised.

## Known issues / follow-ups
- The variant endpoint renders the saved template, so a template edit must be saved before it can
  be re-rolled. The editor says so.
- openapi-fetch widens the matching-answer `pairs` tuple to `string[][]`. The admin casts the item
  responses to `ItemDetail`.
- The admin bundle grew from 1.21 MB to 1.51 MB (436 kB gzipped) with KaTeX. The size warning was
  already there before this module; code splitting could come later.
- The 409 stale-version path is covered by the API integration tests and admin unit tests, but was
  not exercised live in the browser.

## What the next module can rely on
- Tables:
  - `library.curriculum_nodes` and `library.knowledge_edges` (PREREQUISITE_OF and the other
    §8.2 types);
  - `library.items`, with `skill_ids uuid[]` (GIN index) and status per §32.4;
  - `library.item_templates`, `library.item_groups` and `library.media_assets`;
  - `library.item_stats` (empty, to be filled by the stats job);
  - `library.skill_item_counts.is_active`, true for a skill with at least 2 approved items.
- Domain:
  - `renderVariant(template, seed)`, deterministic per seed, with option feedback keys;
  - `validateLibraryPackage` and `coverageReport`;
  - `SUBJECT_PROFILES`.
- Package format: `library/<version>/<grade>-<subject>/`, validated by `pnpm library:validate`
  and imported through `POST /v1/admin/library/import` (X01 and later build into this).
- Event: `library.imported` (aggregate id = import run id; payload: curriculumVersion, grade, subject, diff summary).
