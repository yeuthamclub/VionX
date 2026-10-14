# X01 Plan: Toán 6 library build scripts

Branch: `x01-math6-library` from `main` (M00–M05 merged).
Scope: `TASK_PACKS/X01.md` (scripts plus the MATH.6 run).
Refs: CONTENT_PLAN_vi.md, BOOK_PIPELINE_vi.md §4–7, COST_OPTIONS_vi.md, ARCHITECTURE §3–4, M05_REPORT.

This session builds and tests the scripts. The live 500-item run needs the scanned source PDFs, an
Anthropic API key and a human reviewer, and none of these are available here. That run follows the
runbook in `X01_REPORT.md`. X01 stays IN_PROGRESS until the run's package passes
`library:validate --acceptance`.

## Shape
- `tools/library-build/` (workspace package `@vionx/library-build`), run as
  `pnpm library:build <ID> <step>[,<step>…] [--topic CODE] [--fake]`.
- Each run keeps its state in `.library-build/<ID>/` (gitignored). `--fake` runs use
  `.library-build/<ID>-fake/`.
  - `state.json` holds the step states.
  - `batches/<name>.json` holds the batch ids and `<name>.results.jsonl` the collected results.
  - `ai_runs.jsonl` logs every model call. With `VIONX_DB_URL` set, it is mirrored to `ops.ai_runs`.
- Steps are idempotent:
  - Finished outputs are kept unless you pass `--force`.
  - A step whose batch is still running exits 75. Re-running the same command polls that batch,
    and requests that failed are resubmitted.
- Model calls go only through `AiGateway`, in Batch mode. The model for each task comes from
  `ai_task_config`: `ops.ai_task_config` when `VIONX_DB_URL` is set, otherwise
  `DEFAULT_TASK_CONFIG`. Claude is called only with `AI_LIVE=1` and `ANTHROPIC_API_KEY` set. `--fake`
  answers from the recorded fixtures.

## Steps
1. `packages/ai`:
   - PDF and image attachments on requests and batch items, needed by the vision reading;
   - structured-output schemas for the nine build prompts;
   - the prompt files (`*.v1.md`).
2. `packages/domain`: `libraryAcceptance()` checks the X01 acceptance numbers (≥480 approved,
   ≥2 per active skill, profile shares within ±5 points). `pnpm library:validate --acceptance`
   reports them.
3. `tools/library-build`, one module per step:
   1. textlayer
   2. backbone
   3. map
   4. edges
   5. plan
   6. passages (a no-op for MATH.6)
   7. media
   8. generate
   9. check
   10. verify/dispute
   11. review-export / review-import
   12. package

   It also gets the MATH.6 profile and its prompt notes (`profiles/MATH.6.md`).
4. Fixtures:
   - a synthetic two-page PDF: one page with a text layer, one image-only page;
   - a GDPT excerpt;
   - recorded model answers for one topic (`MATH.6.GEO.SHAPE`, 9 items). These include an item that
     copies SGK text, a verifier disagreement settled by a dispute, and an item the reviewer edits.
5. Tests:
   - unit tests: plan allocation, every check, the CSV review round-trip, text/number helpers and
     textlayer routing;
   - a fake end-to-end run;
   - `pnpm acceptance x01`.
6. Docs: `X01_REPORT.md` with the live-run runbook. ROADMAP X01 → IN_PROGRESS.

## Remaining (live run, outside this session)
Follow the runbook in `X01_REPORT.md`:
1. Upload the source PDFs and set the key.
2. Run one topic end to end, then the rest.
3. Review in Google Sheets.
4. Package, then import through the admin.

After that:
- Update `docs/COST_OPTIONS_vi.md` with the measured numbers.
- Set X01 to DONE.
