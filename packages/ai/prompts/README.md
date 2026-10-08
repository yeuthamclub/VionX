# Prompts

One Markdown file per prompt version: `<task>.v<N>.md` (for example `item_generation.v1.md`).
The file holds the stable, cacheable prefix (system prompt, style guide, output rules); the
item-specific input is appended last by the caller. `promptVersion` passed to `AiGateway.run`
and `submitBatch` must match the file name stem and is logged in `ops.ai_runs`.

Prompts are never edited in place once used for a library build: add a new version.
M00 ships only `ai_check.v1.md`; content prompts arrive with X01 and M10-M15.
