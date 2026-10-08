import {
  AiError,
  AiGateway,
  FakeAiProvider,
  type AiProvider,
  type AiRunRecord,
  type AiRunStore,
  type AiTaskConfig,
  type AiTaskName,
  type BatchInfo,
  type TaskConfigSource,
} from '@vionx/ai';
import { AnthropicProvider } from '@vionx/ai/anthropic';
import type { Sql } from './db.ts';

interface TaskConfigRow {
  model: string;
  mode: 'realtime' | 'batch';
  effort: AiTaskConfig['effort'];
  max_tokens: number;
  enabled: boolean;
}

/** Reads `ops.ai_task_config` with a short in-memory cache (changes apply within a minute). */
export class PostgresTaskConfigSource implements TaskConfigSource {
  private cache = new Map<string, { at: number; config: AiTaskConfig }>();
  constructor(
    private readonly sql: Sql,
    private readonly ttlMs = 60_000,
  ) {}

  async get(task: AiTaskName): Promise<AiTaskConfig> {
    const hit = this.cache.get(task);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.config;
    const rows = await this.sql<TaskConfigRow[]>`
      select model, mode, effort, max_tokens, enabled from ops.ai_task_config where task = ${task}`;
    const row = rows[0];
    if (!row) throw new AiError('AI_UNKNOWN_TASK', `No ai_task_config row for ${task}`);
    const config: AiTaskConfig = {
      task,
      model: row.model,
      mode: row.mode,
      effort: row.effort,
      maxTokens: row.max_tokens,
      enabled: row.enabled,
    };
    this.cache.set(task, { at: Date.now(), config });
    return config;
  }
}

/** Writes `ops.ai_runs`. */
export class PostgresAiRunStore implements AiRunStore {
  constructor(private readonly sql: Sql) {}

  async log(r: AiRunRecord): Promise<void> {
    await this.sql`
      insert into ops.ai_runs (
        task, model, prompt_version, mode, status, stop_reason, batch_id, custom_id, student_ref,
        source_refs, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, latency_ms, error
      ) values (
        ${r.task}, ${r.model}, ${r.promptVersion}, ${r.mode}, ${r.status}, ${r.stopReason ?? null},
        ${r.batchId ?? null}, ${r.customId ?? null}, ${r.studentRef ?? null},
        ${this.sql.array(r.sourceRefs ?? [])},
        ${r.usage.inputTokens}, ${r.usage.outputTokens}, ${r.usage.cacheReadTokens},
        ${r.usage.cacheCreationTokens}, ${r.costUsd}, ${r.latencyMs}, ${r.error ?? null}
      )`;
  }

  async findBatch(batchId: string): Promise<BatchInfo | null> {
    const rows = await this.sql<{ task: AiTaskName; prompt_version: string; model: string }[]>`
      select task, prompt_version, model from ops.ai_runs
      where batch_id = ${batchId} and status = 'batch_submitted'
      order by created_at limit 1`;
    const row = rows[0];
    return row ? { task: row.task, promptVersion: row.prompt_version, model: row.model } : null;
  }
}

/**
 * Builds the gateway for Edge Functions. Without ANTHROPIC_API_KEY it uses the FakeAiProvider,
 * so local development never spends money by accident.
 */
export function createGateway(sql: Sql, apiKey: string | undefined): AiGateway {
  const provider: AiProvider = apiKey ? new AnthropicProvider({ apiKey }) : new FakeAiProvider();
  return new AiGateway({
    provider,
    config: new PostgresTaskConfigSource(sql),
    runs: new PostgresAiRunStore(sql),
  });
}
