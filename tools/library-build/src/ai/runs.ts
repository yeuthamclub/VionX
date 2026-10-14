// ai_runs for the build scripts. Every gateway call is appended to `<work dir>/ai_runs.jsonl`
// (the same rows as ops.ai_runs, plus the build step). With VIONX_DB_URL the rows also go to
// ops.ai_runs and the model per task is read from ops.ai_task_config.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';
import {
  AiError,
  type AiRunRecord,
  type AiRunStore,
  type AiTaskConfig,
  type AiTaskName,
  type BatchInfo,
  type TaskConfigSource,
} from '@vionx/ai';

export interface BuildRunRecord extends AiRunRecord {
  step: string;
  at: string;
}

export class FileAiRunStore implements AiRunStore {
  step = 'unknown';
  constructor(
    readonly path: string,
    private readonly mirror?: AiRunStore,
  ) {}

  async log(record: AiRunRecord): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const row: BuildRunRecord = { ...record, step: this.step, at: new Date().toISOString() };
    appendFileSync(this.path, `${JSON.stringify(row)}\n`);
    await this.mirror?.log(record);
  }

  async findBatch(batchId: string): Promise<BatchInfo | null> {
    // Latest match: fake batch ids restart in every process.
    const row = this.records().findLast(
      (r) => r.batchId === batchId && r.status === 'batch_submitted',
    );
    return row ? { task: row.task, promptVersion: row.promptVersion, model: row.model } : null;
  }

  records(): BuildRunRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as BuildRunRecord);
  }
}

type Sql = ReturnType<typeof postgres>;

export class PgAiRunStore implements AiRunStore {
  constructor(private readonly sql: Sql) {}

  async log(r: AiRunRecord): Promise<void> {
    await this.sql`
      insert into ops.ai_runs (
        task, model, prompt_version, mode, status, stop_reason, batch_id, custom_id, student_ref,
        source_refs, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, latency_ms, error
      ) values (
        ${r.task}, ${r.model}, ${r.promptVersion}, ${r.mode}, ${r.status}, ${r.stopReason ?? null},
        ${r.batchId ?? null}, ${r.customId ?? null}, ${null}, ${this.sql.array(r.sourceRefs ?? [])},
        ${r.usage.inputTokens}, ${r.usage.outputTokens}, ${r.usage.cacheReadTokens},
        ${r.usage.cacheCreationTokens}, ${r.costUsd}, ${r.latencyMs}, ${r.error ?? null}
      )`;
  }

  async findBatch(): Promise<BatchInfo | null> {
    return null; // the file store answers; this one only mirrors rows
  }
}

export class PgTaskConfigSource implements TaskConfigSource {
  constructor(private readonly sql: Sql) {}

  async get(task: AiTaskName): Promise<AiTaskConfig> {
    const rows = await this.sql<
      {
        model: string;
        mode: 'realtime' | 'batch';
        effort: AiTaskConfig['effort'];
        max_tokens: number;
        enabled: boolean;
      }[]
    >`select model, mode, effort, max_tokens, enabled from ops.ai_task_config where task = ${task}`;
    const row = rows[0];
    if (!row) throw new AiError('AI_UNKNOWN_TASK', `No ai_task_config row for ${task}`);
    return {
      task,
      model: row.model,
      mode: row.mode,
      effort: row.effort,
      maxTokens: row.max_tokens,
      enabled: row.enabled,
    };
  }
}

export const connectDb = (url: string): Sql => postgres(url, { max: 2, onnotice: () => {} });

/** Cost and tokens per step and task, from the ai_runs log. */
export function costSummary(records: BuildRunRecord[]) {
  const rows = new Map<
    string,
    {
      step: string;
      task: string;
      calls: number;
      input: number;
      output: number;
      cacheRead: number;
      costUsd: number;
    }
  >();
  for (const r of records) {
    if (r.status === 'batch_submitted') continue;
    const key = `${r.step}\t${r.task}`;
    const row = rows.get(key) ?? {
      step: r.step,
      task: r.task,
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      costUsd: 0,
    };
    row.calls++;
    row.input += r.usage.inputTokens;
    row.output += r.usage.outputTokens;
    row.cacheRead += r.usage.cacheReadTokens;
    row.costUsd += r.costUsd;
    rows.set(key, row);
  }
  const list = [...rows.values()];
  return {
    rows: list,
    totalUsd: Number(list.reduce((a, r) => a + r.costUsd, 0).toFixed(4)),
    models: [
      ...new Set(records.filter((r) => r.status === 'succeeded').map((r) => r.model)),
    ].sort(),
  };
}
