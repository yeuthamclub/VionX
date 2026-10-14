# M05 Plan — Curriculum & shared content library core

Branch: `m05-content-library` from `main` (M02 merged). Runs in parallel with M03 (other thread);
no M03 files are touched. Migration number `0008` (M03 takes `0007`).
Scope: `TASK_PACKS/M05.md`. Refs: Master Spec §8, §31.4, §32; ARCHITECTURE §3; CONTRACT D5, D6.

## Model (schema `library`, no personal data, no client grants)
- `curriculum_versions` (code e.g. `gdpt2018`), `curriculum_nodes` (level GRADE…SKILL, `code` unique
  per version, `parent_id`, `grade`, `subject`, status ACTIVE|INACTIVE|ARCHIVED, `content_hash`),
  `knowledge_edges` (§8.2 types), `book_series`, `book_lesson_mappings`.
- `subject_profiles`, seeded for the 8 launch libraries from CONTENT_PLAN §3.
- `media_assets`, `item_groups`, `items` (+ `skill_ids uuid[]`), `item_templates` (1:1 with TEMPLATE
  items), `item_stats`, `item_reports`, `tutor_answers` (table only; M15 fills it).
- `import_runs`: every dry-run and apply with its diff, errors and the admin who ran it.
- Every package entity has a stable `code`; `content_hash` (sha256 of the canonical package line)
  makes re-import a no-op. Changed lines bump `version`. Entities of the package's grade-subject that
  are missing from a new package are ARCHIVED, never deleted.

## Package format (`library/<curriculumVersion>/<grade>-<subject>/`)
`manifest.json`, `curriculum.json`, `edges.json`, `mappings.json`, `groups.jsonl`, `items.jsonl`,
`templates.jsonl`, `media/media.jsonl` + `media/*.svg`. Zod schemas in
`packages/contracts/src/library.ts`; JSON Schemas written to `packages/contracts/library/` by
`pnpm openapi` (checked by `openapi:check`). Subject codes: `math`, `viet`, `lit`, `eng`, `sci`,
`natsoc`; node codes `<SUBJ>.<grade>.<DOMAIN>.<TOPIC>.<SKILL>`.

## Steps (CLAUDE.md working-loop order)
1. **Migration** `0008_library_core.sql`: tables above, checks, indexes, RLS on, subject profile seed.
2. **Domain** `packages/domain/src/library`:
   - `variants.ts`: seeded PRNG, `renderVariant(template, seed)` with math.js (numeric) and word
     lists (language); 50 failed tries → `CONSTRAINTS_UNSATISFIABLE`.
   - `validate.ts`: references resolve, no PREREQUISITE_OF cycles (readable path in the error), no
     orphan skills, groups with PUBLIC_DOMAIN/LICENSED need `source_note`, hint ladder of 4,
     answers match the item type, templates 1:1 with TEMPLATE items, written items need a rubric.
   - `svg.ts`: allowlist sanitiser (no scripts, event handlers, external refs, foreignObject).
   - `coverage.ts`: per grade-subject items per skill/level/type, TEMPLATE share, group share,
     total vs 500, skills with <2 approved items (inactive).
   - `diff.ts`: plan an import (added / updated / archived / unchanged per entity).
   - Property tests: fixture templates over 10,000 seeds.
3. **Contracts + CLI**: Zod package schemas, `parseLibraryPackage(files)` (schema + checksums),
   `pnpm library:validate <path>` (directory or zip).
4. **API** `supabase/functions/api/library` (admin, CONTRACT D11):
   - `POST /v1/admin/library/import?mode=dry-run|apply` (zip body): validate → diff → apply in one
     transaction; audited; outbox `library.imported`. CONTENT_ADMIN.
   - Reads (CONTENT_ADMIN, CURRICULUM_EDITOR, CONTENT_REVIEWER, LIBRARIAN): versions, curriculum
     tree, items (filter skill/status/kind/type/level, cursor), item detail, groups, media, coverage,
     import runs, variant render for a template item and seed.
   - Edits (CONTENT_ADMIN, CONTENT_REVIEWER): `PATCH` item and group (content fields, status);
     audited, version bump.
   - No child-facing reads (M06).
5. **Admin**: package import page (upload → dry-run diff → apply), curriculum tree browser, item list
   with filters, item editor (live KaTeX, media preview, TTS preview via speechSynthesis, variant
   re-roll), group editor.
6. **Fixtures + acceptance**: `scripts/acceptance/fixtures/m05/` Toán 6 (templates), Toán 2 (SVG
   counting, read-aloud), Tiếng Việt 2 (passage group, spelling template, picture choice) and a
   cycle fixture. `pnpm acceptance m05`: dry-run → apply → re-import no-op; cycle rejected with a
   readable error; 10,000-seed template run.
7. Checks: lint, typecheck, unit, `pnpm test:api`, `pnpm openapi:check`, admin build,
   `pnpm acceptance m05`. REPORT, ROADMAP, PR.

## Not in M05
Child-facing item reads, attempts and mastery (M06); stats computation job (M06/M09); tutor answers
content (M15); book import (M10); the 500-item libraries themselves (X01+). No mobile screen ships,
so there is no Maestro flow for this module.
