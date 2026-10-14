// Prompt files live in packages/ai/prompts/<version>.md (packages/ai/prompts/README.md). The
// system prompt is the prompt file plus the subject notes: both stable, so they are cached.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PROMPTS_DIR = resolve(import.meta.dirname, '../../../../packages/ai/prompts');

export const PROMPT_VERSIONS = {
  textlayer: 'page_extraction.v1',
  reread: 'page_reread.v1',
  backbone: 'skill_backbone.v1',
  map: 'lesson_mapping.v1',
  edges: 'prerequisite_edges.v1',
  media: 'svg_illustration.v1',
  generate: 'item_generation.v1',
  verify: 'item_verification.v1',
  dispute: 'item_dispute.v1',
} as const;

export function systemPrompt(version: string, notes?: string): string {
  const prompt = readFileSync(resolve(PROMPTS_DIR, `${version}.md`), 'utf8').trim();
  return notes ? `${prompt}\n\n${notes.trim()}\n` : `${prompt}\n`;
}

/** The prompt id on the first line (`<!-- prompt: x.v1 -->`); the fake provider dispatches on it. */
export const promptId = (system: string): string | undefined =>
  /<!-- prompt: ([\w.]+) -->/.exec(system)?.[1];
