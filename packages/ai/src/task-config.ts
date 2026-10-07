import { AiError } from './errors.ts';
import type { AiTaskConfig, AiTaskName, TaskConfigSource } from './types.ts';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-5-5';
const OPUS = 'claude-opus-5-5';

/**
 * Defaults from ARCHITECTURE §4. The database (`ops.ai_task_config`) is the source of truth at
 * runtime; migration 0001 seeds the same rows (a unit test keeps the two in sync).
 */
export const DEFAULT_TASK_CONFIG: Record<AiTaskName, AiTaskConfig> = {
  page_extraction: cfg('page_extraction', HAIKU, 'batch', null, 16000),
  page_reread: cfg('page_reread', SONNET, 'batch', 'high', 16000),
  structure_mapping: cfg('structure_mapping', SONNET, 'batch', 'high', 16000),
  item_generation: cfg('item_generation', SONNET, 'batch', 'high', 16000),
  item_verification: cfg('item_verification', HAIKU, 'batch', null, 8000),
  item_dispute: cfg('item_dispute', OPUS, 'batch', 'high', 16000),
  tutor_t2: cfg('tutor_t2', HAIKU, 'realtime', null, 4000),
  tutor_t3: cfg('tutor_t3', SONNET, 'realtime', 'medium', 8000),
  writing_feedback_g1_9: cfg('writing_feedback_g1_9', HAIKU, 'realtime', null, 4000),
  writing_feedback_g10_12: cfg('writing_feedback_g10_12', SONNET, 'realtime', 'medium', 8000),
  passage_generation: cfg('passage_generation', SONNET, 'batch', 'medium', 16000),
  svg_illustration: cfg('svg_illustration', SONNET, 'batch', 'medium', 16000),
  parent_weekly_summary: cfg('parent_weekly_summary', HAIKU, 'batch', null, 4000),
  ai_check: cfg('ai_check', HAIKU, 'realtime', null, 64),
};

function cfg(
  task: AiTaskName,
  model: string,
  mode: AiTaskConfig['mode'],
  effort: AiTaskConfig['effort'],
  maxTokens: number,
): AiTaskConfig {
  return { task, model, mode, effort, maxTokens, enabled: true };
}

/** In-memory config source (tests, `ai:check`, local scripts). */
export class StaticTaskConfigSource implements TaskConfigSource {
  constructor(
    private readonly overrides: Partial<Record<AiTaskName, Partial<AiTaskConfig>>> = {},
  ) {}

  async get(task: AiTaskName): Promise<AiTaskConfig> {
    const base = DEFAULT_TASK_CONFIG[task];
    if (!base) throw new AiError('AI_UNKNOWN_TASK', `Unknown AI task ${task}`);
    return { ...base, ...this.overrides[task], task };
  }
}

/** Sonnet/Opus 5.5 accept the server-side refusal fallback (`fallbacks: "default"`). */
export function supportsRefusalFallback(model: string): boolean {
  return /^claude-(sonnet|opus)-5-5\b/.test(model);
}
