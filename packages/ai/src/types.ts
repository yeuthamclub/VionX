// Core AI types. Runtime-neutral: no Node built-ins, no Deno globals.

/** Tasks with a row in `ops.ai_task_config` (ARCHITECTURE §4) plus the `ai_check` smoke task. */
export const AI_TASKS = [
  'page_extraction',
  'page_reread',
  'structure_mapping',
  'item_generation',
  'item_verification',
  'item_dispute',
  'tutor_t2',
  'tutor_t3',
  'writing_feedback_g1_9',
  'writing_feedback_g10_12',
  'passage_generation',
  'svg_illustration',
  'parent_weekly_summary',
  'ai_check',
] as const;
export type AiTaskName = (typeof AI_TASKS)[number];

export type AiMode = 'realtime' | 'batch';
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AiTaskConfig {
  task: AiTaskName;
  model: string;
  mode: AiMode;
  /** `null` for models that do not accept `effort` (Haiku 4.5). */
  effort: AiEffort | null;
  maxTokens: number;
  enabled: boolean;
}

export interface TaskConfigSource {
  get(task: AiTaskName): Promise<AiTaskConfig>;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type AiStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'refusal'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | (string & {});

/** Provider-neutral request. `system` is the stable, cacheable prefix; `input` goes last. */
export interface ProviderRequest {
  model: string;
  system: string;
  input: string;
  maxTokens: number;
  effort: AiEffort | null;
  /** JSON Schema for structured output, or undefined for plain text. */
  outputSchema?: Record<string, unknown>;
  /** Realtime Sonnet/Opus 5.5 requests opt into the server-side refusal fallback. */
  refusalFallback: boolean;
}

export interface ProviderResponse {
  /** The model that produced the message (may differ after a refusal fallback). */
  model: string;
  stopReason: AiStopReason;
  text: string;
  usage: AiUsage;
  refusalCategory?: string | null;
}

export type BatchStatus = 'in_progress' | 'canceling' | 'ended';

export interface BatchCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

export interface ProviderBatchResult {
  customId: string;
  response?: ProviderResponse;
  error?: { type: string; message: string };
}

export interface AiProvider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
  createBatch(
    requests: { customId: string; request: ProviderRequest }[],
  ): Promise<{ batchId: string }>;
  getBatch(batchId: string): Promise<{ status: BatchStatus; counts: BatchCounts }>;
  batchResults(batchId: string): AsyncIterable<ProviderBatchResult>;
}

export type AiRunStatus =
  | 'succeeded'
  | 'refused'
  | 'truncated'
  | 'invalid_output'
  | 'failed'
  | 'batch_submitted'
  | 'batch_errored'
  | 'batch_expired';

/** One row of `ops.ai_runs`. */
export interface AiRunRecord {
  task: AiTaskName;
  model: string;
  promptVersion: string;
  mode: AiMode;
  status: AiRunStatus;
  stopReason?: string | null;
  batchId?: string | null;
  customId?: string | null;
  studentRef?: string | null;
  sourceRefs?: string[];
  usage: AiUsage;
  costUsd: number;
  latencyMs: number | null;
  error?: string | null;
}

export interface BatchInfo {
  task: AiTaskName;
  promptVersion: string;
  model: string;
}

/** Persists ai_runs rows; also finds which task a batch belongs to when collecting it. */
export interface AiRunStore {
  log(record: AiRunRecord): Promise<void>;
  findBatch(batchId: string): Promise<BatchInfo | null>;
}

export const ZERO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};
