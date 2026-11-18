# Libraries report: X01–X08 and Toán 5

Date: 2026-11-18. All 8 launch libraries and Toán 5 exist as reviewed packages and are imported into the
Supabase Cloud development project (ADR-002). Only Toán 6 (X01) went through the `library:build`
scripts. The others were drafted by Codex, or by Claude in the case of part of Toán 5. Claude checked
each one with code, the product owner reviewed it (`manifest.reviewer = "Leo"`), and then it was
imported through `POST /v1/admin/library/import` (dry-run, then apply).

## Status

| ID | Library | Items (TEMPLATE) | `--acceptance` | Imported |
|---|---|---|---|---|
| X01 | Toán 6 | 500 (200) | pass | 2026-11-17 |
| X02 | Toán 2 | 510 (231) | pass | 2026-11-17 |
| X03 | Tiếng Việt 2 | 500 (50) | pass | 2026-11-17 |
| X04 | Ngữ văn 6 | 500 (0) | pass | 2026-11-18 |
| X05 | Tiếng Anh 6 | 500 (50) | **fail**: read-aloud 100%, profile 0% | 2026-11-18 |
| X06 | Tiếng Anh 2 | 500 (50) | **fail**: 50 skills with one item | 2026-11-18 |
| X07 | Khoa học tự nhiên 6 | 500 (125) | pass | 2026-11-18 |
| X08 | Tự nhiên và Xã hội 2 | 500 (0) | pass | 2026-11-18 |
| – | Toán 5 (outside launch scope) | 500 (225) | pass | 2026-11-17 |

All items are APPROVED: 4,510 in total, counted with SQL on the development project
(`pnpm cloud npx tsx scripts/library-counts.ts`).

`--acceptance` was run on 2026-11-18 with `pnpm library:validate <package> --acceptance --json --seeds 200`.
The package sources are outside the repo, in the owner's Codex outputs folder
(`…/outputs/<CODE>_500_<date>/`). Toán 6 is in `.library-build/MATH.6/package/6-math.zip`.

## Checks every package went through
1. `library:validate`: schema, checksums, library rules, 1,000 seeds per template.
2. `kiem_template.mts` against the slot plan. It flags repeated stem skeletons, templates that vary only
   in their numbers, hints reused more than 3 times, and degenerate lines such as `X = X`.
3. Answer cross-check with code:
   - maths: every `a op b = c` is recomputed with mathjs;
   - the other subjects: the answer must be among the options and the options must be distinct.
4. 10-word n-gram overlap with the OCR of that subject's SGK, SGV and workbook: 0 overlaps.
5. Guessability measures, added after review rounds 16–18/11:
   - the right answer is the longest option in at most 40% of single_choice items (actual: 23–35%);
   - no more than about 10 distractors use absolute words ("luôn", "mọi", "tất cả"…);
   - multi_choice has 1, 2 or 3 right answers, about a third each;
   - the answer position is spread over a/b/c.
6. A read-through of 10–20 sample items per round by Claude, then the owner's review.

## Open issues
- **X05 Tiếng Anh 6**: every item carries `ttsText`, but the profile says read-aloud 0%. Either strip the
  item-level `ttsText` or change the profile; then re-import.
- **X06 Tiếng Anh 2**: the 50 grammar and phonics skills from the 2026-11-13 frame each hold one TEMPLATE
  item. The acceptance rule wants at least 2 approved items per active skill. Either merge them into
  their unit skills or add a second item each.
- **Language reviewer**: the plan asks for one for the language libraries (X03–X06). So far only the
  owner has reviewed them.
- **Smaller notes for the next revision**: see `KIEM_TRA_<CODE>_500.md` in the outputs folder. Examples:
  three Tiếng Anh 2 templates (LOOKAT, SQUARES, CANYES); Tiếng Anh 6 U11.GREEN.USE.Q243 has a
  single distractor.

## Import notes
- Series codes are global: Toán 5 already uses `KNTT`, so Ngữ văn 6 uses `KNTT-LIT6` and Tiếng Anh 2
  uses `GLOBAL-SUCCESS-ENG2`.
- Large packages take longer than fetch's 300 s headers timeout on the cloud database.
  `scripts/import-reviewed.ts` uses `node:http` instead. One run lost the database connection
  (`CONNECTION_CLOSED`) and was re-run; a second dry-run showing `noop=true` confirmed it was complete.
