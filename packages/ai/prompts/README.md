# Prompts

One Markdown file per prompt version: `<task>.v<N>.md` (for example `item_generation.v1.md`).
The file holds the stable, cacheable prefix (system prompt, style guide, output rules); the
item-specific input is appended last by the caller. `promptVersion` passed to `AiGateway.run`
and `submitBatch` must match the file name stem and is logged in `ops.ai_runs`.

Prompts are never edited in place once used for a library build: add a new version.
Each file starts with `<!-- prompt: <stem> -->`; the library-build fake provider answers by it.

| File | `ai_task_config` task | Used by |
|---|---|---|
| `ai_check.v1.md` | `ai_check` | `pnpm ai:check` (M00) |
| `page_extraction.v1.md` | `page_extraction` | `library:build … textlayer` (X01) |
| `page_reread.v1.md` | `page_reread` | `library:build … textlayer`, re-read of failed pages |
| `skill_backbone.v1.md` | `structure_mapping` | `library:build … backbone` |
| `lesson_mapping.v1.md` | `structure_mapping` | `library:build … map` |
| `prerequisite_edges.v1.md` | `structure_mapping` | `library:build … edges` |
| `svg_illustration.v1.md` | `svg_illustration` | `library:build … media` |
| `item_generation.v1.md` | `item_generation` | superseded by v2 |
| `item_generation.v2.md` | `item_generation` | `library:build … generate` |
| `item_verification.v1.md` | `item_verification` | `library:build … verify` |
| `item_dispute.v1.md` | `item_dispute` | `library:build … verify` (disagreements) |
