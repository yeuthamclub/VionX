# X01 Report: Toán 6 library build scripts

## Status: scripts done, live run pending
**The 500-item Toán 6 library is NOT built yet.**

This session built and tested the build scripts: all 12 steps, run as `pnpm library:build MATH.6 …`.
They have only been run on recorded fixtures (`--fake`), which give one topic and 9 items. Nothing
here has called Claude, read the real SGK/SGV scans or had a human review. Those need:
- the image-only source PDFs, which are not in this environment;
- an Anthropic API key, which is not here;
- the product owner as reviewer.

The run goes by the runbook below. X01 stays IN_PROGRESS in the ROADMAP until a real package
passes `pnpm library:validate --acceptance`.

## Summary
One script set builds a reviewed library package for a grade-subject:
1. It reads the textbook pages, routing pages with no usable text layer to the vision model.
2. It builds the GDPT skill tree, maps lessons to skills and adds prerequisite edges.
3. It plans 500 item slots for the owner to approve.
4. It generates items, SVG figures, hints, worked solutions and distractor feedback in Batch.
5. Code checks and a blind verifier solve check them, and a dispute model settles disagreements.
6. A spreadsheet round-trip takes the human review.
7. It packages the result in the M05 format and validates it, printing the AI cost from `ai_runs`.

The X01 acceptance numbers are computed and reported, never assumed.

## Changed
- Migrations: none.
- Config / `ai_task_config`: no new keys. The existing tasks are reused:

  | Task | Steps |
  |---|---|
  | `page_extraction`, `page_reread` | textlayer |
  | `structure_mapping` | backbone, map, edges |
  | `svg_illustration` | media |
  | `item_generation` | generate |
  | `item_verification`, `item_dispute` | verify |

- `packages/ai`:
  - `attachments` (PDF/PNG/JPEG, base64) on `run` and on batch items; `AnthropicProvider` sends
    them as document/image blocks ahead of the text input, in batches too.
  - Structured-output schemas for the nine build prompts. They use the API's schema subset: every
    property required, with nullables instead of optional fields.
  - The prompt files `page_extraction`, `page_reread`, `skill_backbone`, `lesson_mapping`,
    `prerequisite_edges`, `svg_illustration`, `item_generation`, `item_verification` and
    `item_dispute` (all `.v1.md`). The README lists which task each one uses.
- `packages/domain`: `libraryAcceptance(report, profile)` checks the X01 numbers:
  - ≥480 approved items;
  - ≥2 approved items for every skill;
  - TEMPLATE, group, read-aloud and written shares within ±5 points of the profile.
- `pnpm library:validate <dir|zip> --acceptance [--min-approved N]` prints those lines. It exits 1
  when the package is valid but misses the criteria. `--json` includes them.
- `tools/library-build/` (new workspace package) and `pnpm library:build`:
  - the MATH.6 build profile and prompt notes;
  - recorded fixtures;
  - 44 unit/e2e tests.
- `scripts/acceptance/x01.ts`: `pnpm acceptance x01`, a fake run with no Supabase and no network.
- `.gitignore`: `.library-build/` (per-run work dirs).
- CI runs `pnpm acceptance x01` after m05.

### Steps (`pnpm library:build MATH.6 <step>[,<step>…] [--topic CODE] [--fake]`)

| # | Step | What it does | AI |
|---|---|---|---|
| 1 | `textlayer --source DIR\|bucket:B/P` | pdf.js text layer per page, classified good / legacy-encoding / scanned / formula-heavy. Hard pages go to the vision model as 10-page PDFs. A reading is validated: blank, KaTeX, Vietnamese ratio, similarity to any partial text layer. Pages that fail are re-read one by one; pages still failing are flagged `needsHuman`. Cached per file sha256. → `pages.jsonl` | page_extraction, page_reread (Batch) |
| 2 | `backbone [--gdpt FILE\|DIR]` | Slices the Lớp 6 section out of TT 32/2018 (checked on the real file: 84 requirement bullets). The model builds DOMAIN/TOPIC/SKILL with codes `MATH.6.<D>.<T>.<S>`, weights and GDPT refs. Codes are normalised and de-duplicated; requirement bullets no skill covers are reported. → `backbone.json`, `backbone-coverage.json` | structure_mapping (Batch) |
| 3 | `map` | Finds the table-of-contents pages per book. Model output: lessons → skills (unknown skills dropped) plus the page ranges used as references later. → `map.json` | structure_mapping |
| 4 | `edges` | Prerequisite and related edges with reasons. Unknown codes and self edges are dropped, and cycles are broken (logged). → `edges.json` | structure_mapping |
| 5 | `plan [--target N]`, `plan --approve --by NAME` | ARCHITECTURE §3 rule: ≥2 slots per skill (one L1–L2, one L3+), the rest by weight (largest remainder), then the profile's TEMPLATE share (templatable skills only), type mix, level mix and SVG share. Flags when 2 × skills > target. → `plan.csv` for the owner. An edited `plan.csv` is read back on approval. Generation refuses an unapproved plan. | none |
| 6 | `passages` | No-op for MATH.6 (group share 0). It refuses to run for profiles with groups; X03 adds passages. | none |
| 7 | `media` | One SVG per figure slot. It is sanitised by the M05 allowlist (anything removed is a failure), rendered to PNG locally (resvg) for the reviewer and the verifier, and retried once. → `media.jsonl`, `media/*.svg|png` | svg_illustration (Batch) |
| 8 | `generate` | One request per skill and attempt: the planned slots, the skill's SGK/SGV pages as reference only (12k characters), the profile notes and lessons learned from review. Items carry hints[4], a worked solution, distractor feedback with misconception tags, `answerCheckExpr`, and for TEMPLATE slots a math.js template. Rejected slots are regenerated once (2 attempts). | item_generation (Batch) |
| 9 | `check` | The code checks below. Failures → REJECTED (regenerated by the next `generate`). Passes → VALIDATING. → `checks.json` | none |
| 10 | `verify` (alias `dispute`) | Blind solve: the verifier sees the stem, options and figure PNG, never the key. It also grades hints and age-appropriateness. A disagreement or an unsolvable item goes to dispute. Auto-verdict is PASS, CHECK, KEY_WRONG or AMBIGUOUS. | item_verification, item_dispute (Batch) |
| 11 | `review-export [--media-base-url U]`, `review-import --reviewer NAME [--file F] [--hours H]` | CSV (UTF-8 BOM, CRLF) for Google Sheets: one row per item, with auto-verdict, flags, every editable field, template JSON, 3 sample variants, figure link, verifier and dispute notes. Import accepts APPROVED / REJECTED / EDITED, reporting every problem at once. EDITED rows are re-run through every check before approval. REJECTED notes go to `lessons.md` (fed to later generation) and the slot is regenerated once. | none |
| 12 | `package [--upload [--bucket B]]` | Builds the M05 package (`library/gdpt2018/6-math/` + `6-math.zip`, checksummed manifest naming the series, models from ai_runs and the reviewer). It validates exactly what ships (1,000 seeds per template) and writes `report.json`: per-skill counts, type/level mix, TEMPLATE share, check/verifier/review rates, AI cost and review hours. Prints the cost table and the acceptance lines. Upload to Storage only with `--upload`; the import is still done in the admin. | none |
| – | `status` | Step states and AI cost so far. | none |

Check (step 9) runs 10 item checks plus 2 for groups:
1. `slot`: kind/type/level match the plan.
2. `schema`: package item schema.
3. `one_correct`: exactly one correct option, except multi_choice.
4. `recompute`: math.js re-evaluates `answerCheckExpr` against the key. Numeric items without it fail.
5. `katex`: every `$…$` parses.
6. `template_seeds`: 1,000 seeds hold the constraints.
7. `ngram`: no 10-word run shared with any SGK/SGV page.
8. `duplicate`: by normalised text.
9. `tts`: required when the profile reads aloud.
10. `svg`: the figure rendered and was sanitised cleanly.

For groups: `ngram`, and `reading_level` (word count and sentence length).

## Evidence
- Unit and e2e tests (`tools/library-build`, 44 tests):
  - plan allocation: 9, including the 2 × skills > target flag;
  - every check: 13;
  - CSV parser and review round-trip: 6;
  - text/number/KaTeX helpers: 12;
  - textlayer: 3. A text-layer page is read locally. The image-only page goes to the vision model as
    a single PDF attachment. An empty reading is re-read and then flagged for a human. A re-run
    makes no model call.
  - fake e2e: 1.

  Elsewhere: `packages/ai` has 21 tests (1 new: attachments in batches) and `packages/domain` has 137
  (3 new: acceptance).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm openapi:check`: green.
- `pnpm acceptance x01`: 7 passed, 0 failed.
  ```
  live guard: without --fake → "This step calls Claude. Run it with AI_LIVE=1 and ANTHROPIC_API_KEY set, or add --fake"
  2 pages (1 text layer, 1 vision); plan 28 slots, TEMPLATE 43%, 2 figures → plan.csv
  generate refused before `plan --approve`
  PERIM.Q03 attempt 1 rejected (ngram: 12 10-grams copied from the source books (longest run 21 words));
    9 items pass every check; re-run made 0 new model calls
  1 dispute (KEY_CORRECT); 9 rows reviewed (8 approved, 1 edited and re-checked)
  library:validate on 6-math.zip (1000 seeds per template): exit 0
  library:validate --acceptance: exit 1, "✗ 9 approved items (need ≥480)" (not faked)
  ```
- `pnpm acceptance m05`: 8 passed (regression, against local Supabase).
- The fake package also imports through the local API (`POST /v1/admin/library/import`): dry-run
  200 (nodes +21, edges +4, series +1, mappings +5, media +2, items +9, templates +1), then apply,
  then a re-import that was a no-op.
- AI cost: 0. No model was called; fake runs log `fake:<model>` with zero usage.

## Live run runbook
Run this on the owner's machine or in a session that has the PDFs and the key.

Each step logs its spend to `.library-build/MATH.6/ai_runs.jsonl`. Run `pnpm library:build MATH.6
status` at any time to see the states and cost so far.

A batch step may exit with code **75**, which means the batch is still running. Re-run the same
command later; it polls and continues without paying twice.

Expected costs are Batch prices at about 500 SGK + SGV pages and 500 items, consistent with
ARCHITECTURE §4 and COST_OPTIONS.

```sh
# 0. Setup (once)
git checkout x01-math6-library && pnpm install
export AI_LIVE=1 ANTHROPIC_API_KEY=...            # use a workspace with a spend limit (~US$20)
export VIONX_DB_URL=postgresql://...              # optional: models from ops.ai_task_config + mirror to ops.ai_runs
# Sources: a local folder of the Toán 6 SGK (+SGV) PDFs, or the private bucket
#   --source "/Volumes/ViTu/VionX/Sach giao khoa/<Toán 6 folder>"
#   --source bucket:sources/6-math                (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
# GDPT text: /mnt/project-files/sources/gdpt/ by default (or --gdpt FILE, or VIONX_GDPT_DIR)

# 1. Pages                                         ~US$1.5–3 (page_extraction; page_reread only for failures)
pnpm library:build MATH.6 textlayer --source <SOURCE>
#    Check the "needs a human" lines; fix those pages in .library-build/MATH.6/pages.jsonl if they matter.

# 2–4. Structure                                    ~US$0.5–1.5 together (structure_mapping)
pnpm library:build MATH.6 backbone                 # read backbone-coverage.json: uncovered GDPT bullets
pnpm library:build MATH.6 map
pnpm library:build MATH.6 edges

# 5. Plan (no AI)
pnpm library:build MATH.6 plan                     # → .library-build/MATH.6/plan.csv
#    The owner reviews plan.csv (edit counts or kinds in place if needed), then:
pnpm library:build MATH.6 plan --approve --by "<owner name>"

# 6–10. One topic end to end first (pick one from backbone.json)
T=MATH.6.GEO.SHAPE
pnpm library:build MATH.6 passages,media,generate,check --topic $T   # media ~US$0.1, generate ~US$0.5
pnpm library:build MATH.6 generate,check --topic $T                  # regenerate check rejections once
pnpm library:build MATH.6 verify --topic $T                          # ~US$0.1 (+ disputes)
pnpm library:build MATH.6 review-export --topic $T
#    Import review/review.csv into Google Sheets; set verdict (APPROVED/REJECTED/EDITED) and edit cells;
#    download as CSV, then:
pnpm library:build MATH.6 review-import --file <downloaded.csv> --reviewer "<name>" --hours <h>
pnpm library:build MATH.6 generate,check,verify --topic $T           # regenerate reviewer rejections once
#    Look at the first topic's rates (pnpm library:build MATH.6 status) before spending on the rest.

# 6–11. The remaining topics (or omit --topic to do everything left)
pnpm library:build MATH.6 media,generate,check     # media ~US$0.3, generate ~US$5–6 for 500 items
pnpm library:build MATH.6 generate,check           # one regeneration round for check rejections
pnpm library:build MATH.6 verify                   # verification ~US$0.5–1; disputes (≤5%) ~US$0.3–0.5
pnpm library:build MATH.6 review-export            # ~8–12 hours of review for 500 items
pnpm library:build MATH.6 review-import --file <csv> --reviewer "<name>" --hours <h>
pnpm library:build MATH.6 generate,check,verify,review-export   # regenerated slots, review again

# 12. Package (no AI)
pnpm library:build MATH.6 package                  # prints the cost table and the acceptance lines
pnpm library:validate .library-build/MATH.6/package/6-math.zip --acceptance   # must exit 0 for X01 DONE
pnpm library:build MATH.6 package --upload         # optional: Storage bucket library-packages
#    Import the zip in the admin (Library Packages: dry-run, then apply).
```

Expected total for Toán 6: about **US$8–12** in AI, plus 8–12 review hours.

After the run:
1. Put the real numbers from `report.json` into `docs/COST_OPTIONS_vi.md`: cost per step,
   rejection and disagreement rates, review hours.
2. Set X01 to DONE.

If `--acceptance` fails:
- Under 480 approved: run another `generate,check,verify,review-export` round. `plan --target`
  above 500 adds slots.
- Shares outside the profile: adjust `plan.csv` and re-approve.

## Decisions
- **No new ai_task_config keys and no migration.** The structure steps share `structure_mapping`
  with three prompt files, and dispute uses the existing `item_dispute` task. The model per task
  comes from `ops.ai_task_config` when `VIONX_DB_URL` is set, otherwise from `DEFAULT_TASK_CONFIG`.
  Code holds no model names.
- **Vision input as attachments on the gateway.** This is a small addition to `packages/ai`:
  attachments are never written to `ai_runs`, which logs usage and source refs only.
- **Pages go to the model in 10-page PDFs.** A failed page is re-read alone, once. A page that
  still fails is flagged rather than retried further. An empty reading counts as a failure; a test
  found this gap.
- **The structured-output subset** is used for every schema: all properties required, nullables
  instead of optional fields, no min/max. The answer travels as a JSON string (`answerJson`) and
  is parsed and checked in code.
- **Recompute needs an expression.** Every numeric/fill item must carry `answerCheckExpr`, which
  math.js re-evaluates against the key. Items without one fail `recompute` rather than being
  trusted.
- **The n-gram check is strict.** Any shared 10-word run with any SGK/SGV page rejects the item
  (profile `ngram: 10`). The page text is reference only, and prompts forbid copying.
- **Each slot gets 2 attempts.** A slot is regenerated once after a check, verify or review
  rejection; after that it is left for the reviewer. The rejection reasons are appended to
  `lessons.md`, which later generation and the next library's notes read.
- **Plan TEMPLATE slots go only to templatable skills.** When that cannot reach the profile share,
  the plan flags it.
- **Passages are deferred.** Profiles with item groups are refused by `plan` and `passages` until
  X03.
- **Acceptance is computed, never asserted.**
  - `libraryAcceptance` lives in `packages/domain`, so `library:validate`, `package` and later
    runs share one rule.
  - The fake acceptance run checks that the criteria fail on the 9-item package.
  - "Every active skill has ≥2 items" is checked against every SKILL node of the package, because
    the plan gives every skill at least 2 slots.
- **Upload sits behind `--upload`.** The import into the database stays an admin action (M05
  dry-run, then apply), so a person sees the diff.
- **The backbone emits DOMAIN/TOPIC/SKILL only.** OBJECTIVE nodes are allowed by the M05 schema but
  not generated: GDPT "yêu cầu cần đạt" bullets map to skills through `gdptRef`, and an extra level
  would not change the 5-part skill codes.
- **Legacy-encoding detection** ignores `×` and `÷`, which were otherwise counted as TCVN3 bytes.

## Privacy & security impact
- Library content only. No household, child or user data is read or written.
- The reviewer's name goes into `manifest.reviewer`, as M05 requires.
- No secrets in code. The key, DB URL and service-role key come from the environment.
- Tests and acceptance strip `AI_LIVE`/`ANTHROPIC_API_KEY`/`VIONX_DB_URL` and use recorded fixtures.
- Generated SVG goes through the M05 allowlist sanitiser. Any removal is a failure, not a silent
  fix.
- Source PDFs and page text stay in the gitignored work dir. Only original items ship; the n-gram
  check guards against copying.

## Known issues / follow-ups
- **Real 500-item run not done.** See the runbook. Until then the real check, verify and review
  rates are unknown, and so are the TEMPLATE share achieved and the cost.
- **Prompt quality is untested against Claude.** The prompts are v1 and only checked against
  fixtures. Expect the first topic to need prompt notes (`profiles/MATH.6.md`) or a v2 prompt.
- **Pages flagged `needsHuman`** are listed but there is no editing tool; fix them in
  `pages.jsonl` by hand.
- **Batch chunking (10k requests / 150 MB per batch)** is unit-level only; the fake provider ends
  batches immediately.
- **`--upload`** to Storage was not exercised: it needs a deployed bucket.
- **Review hours are entered by hand** (`--hours`).

## What the next run (X02) can rely on
- `pnpm library:build <ID> …` with a new entry in `BUILD_PROFILES` and a `profiles/<ID>.md` notes
  file. Read-aloud, TTS checks and SVG are already supported.
- `libraryAcceptance` and `library:validate --acceptance`.
- `fixtures/simulate-review.ts` and the fake-provider pattern for that run's fixtures.
