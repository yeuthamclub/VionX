import { estimateCostUsd } from './cost.ts';
import { AiError } from './errors.ts';
import { supportsRefusalFallback } from './task-config.ts';
import type {
  AiProvider,
  AiRunStore,
  AiTaskConfig,
  AiTaskName,
  AiUsage,
  BatchCounts,
  ProviderRequest,
  ProviderResponse,
  TaskConfigSource,
} from './types.ts';

export interface RunParams {
  task: AiTaskName;
  promptVersion: string;
  /** Stable prefix (system prompt, schema notes, style guide). Cached by the provider. */
  system?: string;
  /** Item-specific input, sent last. Objects are serialised as JSON. */
  input: string | Record<string, unknown>;
  /** JSON Schema for structured output; the result is parsed into `output`. */
  outputSchema?: Record<string, unknown>;
  /** Pseudonymous student reference (never a name). */
  studentRef?: string;
  sourceRefs?: string[];
}

export interface RunResult<T = unknown> {
  model: string;
  text: string;
  output: T | undefined;
  usage: AiUsage;
  costUsd: number;
  latencyMs: number;
}

export interface BatchItem {
  /** Caller id, `^[a-zA-Z0-9_-]{1,64}$`. Results come back keyed by it, in any order. */
  customId: string;
  system?: string;
  input: string | Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sourceRefs?: string[];
}

export interface SubmitBatchResult {
  batchId: string;
  model: string;
  count: number;
}

export interface CollectedItem<T = unknown> {
  customId: string;
  ok: boolean;
  output?: T;
  text?: string;
  error?: string;
}

export type CollectBatchResult<T = unknown> =
  | { status: 'in_progress' | 'canceling'; counts: BatchCounts }
  | { status: 'ended'; counts: BatchCounts; items: CollectedItem<T>[] };

export interface AiGatewayDeps {
  provider: AiProvider;
  config: TaskConfigSource;
  runs: AiRunStore;
  now?: () => number;
}

const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * The only path to a model (CONTRACT §6). Model, effort and max tokens come from the task
 * config; every call is logged to ops.ai_runs; stop_reason is checked before parsing.
 */
export class AiGateway {
  private readonly now: () => number;

  constructor(private readonly deps: AiGatewayDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async run<T = unknown>(params: RunParams): Promise<RunResult<T>> {
    const config = await this.loadConfig(params.task);
    const request = buildRequest(config, params, 'realtime');
    const started = this.now();
    let response: ProviderResponse;
    try {
      response = await this.deps.provider.complete(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.runs.log({
        task: params.task,
        model: config.model,
        promptVersion: params.promptVersion,
        mode: 'realtime',
        status: 'failed',
        studentRef: params.studentRef ?? null,
        sourceRefs: params.sourceRefs ?? [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        costUsd: 0,
        latencyMs: this.now() - started,
        error: message,
      });
      throw new AiError('AI_PROVIDER_ERROR', message);
    }
    const latencyMs = this.now() - started;
    const costUsd = estimateCostUsd(response.model, response.usage);
    const checked = checkResponse<T>(response, params.outputSchema !== undefined);

    await this.deps.runs.log({
      task: params.task,
      model: response.model,
      promptVersion: params.promptVersion,
      mode: 'realtime',
      status: checked.status,
      stopReason: response.stopReason,
      studentRef: params.studentRef ?? null,
      sourceRefs: params.sourceRefs ?? [],
      usage: response.usage,
      costUsd,
      latencyMs,
      error: checked.error ?? null,
    });

    if (checked.status !== 'succeeded') {
      throw new AiError(checked.code, checked.error, { stopReason: response.stopReason });
    }
    return {
      model: response.model,
      text: response.text,
      output: checked.output,
      usage: response.usage,
      costUsd,
      latencyMs,
    };
  }

  async submitBatch(
    task: AiTaskName,
    promptVersion: string,
    items: BatchItem[],
  ): Promise<SubmitBatchResult> {
    if (items.length === 0) throw new AiError('AI_INVALID_OUTPUT', 'Batch has no items');
    const ids = new Set<string>();
    for (const item of items) {
      if (!CUSTOM_ID.test(item.customId) || ids.has(item.customId)) {
        throw new AiError('AI_INVALID_OUTPUT', `Invalid or duplicate customId ${item.customId}`);
      }
      ids.add(item.customId);
    }
    const config = await this.loadConfig(task);
    const requests = items.map((item) => ({
      customId: item.customId,
      request: buildRequest(config, item, 'batch'),
    }));
    const { batchId } = await this.deps.provider.createBatch(requests);
    await this.deps.runs.log({
      task,
      model: config.model,
      promptVersion,
      mode: 'batch',
      status: 'batch_submitted',
      batchId,
      sourceRefs: [...new Set(items.flatMap((i) => i.sourceRefs ?? []))],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      costUsd: 0,
      latencyMs: null,
    });
    return { batchId, model: config.model, count: items.length };
  }

  /**
   * Polls a batch. When it has ended, returns every item and logs one ai_runs row per item.
   * `outputSchemaUsed` tells the gateway to parse JSON (defaults to true: content batches use
   * structured output).
   */
  async collectBatch<T = unknown>(
    batchId: string,
    options: { structured?: boolean } = {},
  ): Promise<CollectBatchResult<T>> {
    const info = await this.deps.runs.findBatch(batchId);
    if (!info) throw new AiError('AI_UNKNOWN_BATCH', `No ai_runs row for batch ${batchId}`);
    const { status, counts } = await this.deps.provider.getBatch(batchId);
    if (status !== 'ended') return { status, counts };

    const structured = options.structured ?? true;
    const items: CollectedItem<T>[] = [];
    for await (const result of this.deps.provider.batchResults(batchId)) {
      const base = {
        task: info.task,
        promptVersion: info.promptVersion,
        mode: 'batch' as const,
        batchId,
        customId: result.customId,
        latencyMs: null,
      };
      if (!result.response) {
        const expired = result.error?.type === 'expired';
        await this.deps.runs.log({
          ...base,
          model: info.model,
          status: expired ? 'batch_expired' : 'batch_errored',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
          costUsd: 0,
          error: result.error?.message ?? result.error?.type ?? 'unknown',
        });
        items.push({
          customId: result.customId,
          ok: false,
          error: result.error?.type ?? 'errored',
        });
        continue;
      }
      const response = result.response;
      const checked = checkResponse<T>(response, structured);
      await this.deps.runs.log({
        ...base,
        model: response.model,
        status: checked.status,
        stopReason: response.stopReason,
        usage: response.usage,
        costUsd: estimateCostUsd(response.model, response.usage, true),
        error: checked.error ?? null,
      });
      items.push(
        checked.status === 'succeeded'
          ? { customId: result.customId, ok: true, output: checked.output, text: response.text }
          : { customId: result.customId, ok: false, error: checked.code, text: response.text },
      );
    }
    return { status, counts, items };
  }

  private async loadConfig(task: AiTaskName): Promise<AiTaskConfig> {
    const config = await this.deps.config.get(task);
    if (!config.enabled) throw new AiError('AI_TASK_DISABLED', `AI task ${task} is disabled`);
    return config;
  }
}

function buildRequest(
  config: AiTaskConfig,
  params: Pick<RunParams, 'system' | 'input' | 'outputSchema'>,
  mode: 'realtime' | 'batch',
): ProviderRequest {
  const request: ProviderRequest = {
    model: config.model,
    system: params.system ?? '',
    input: typeof params.input === 'string' ? params.input : JSON.stringify(params.input),
    maxTokens: config.maxTokens,
    effort: config.effort,
    // The Batches API rejects `fallbacks`; realtime Sonnet/Opus 5.5 calls always opt in.
    refusalFallback: mode === 'realtime' && supportsRefusalFallback(config.model),
  };
  if (params.outputSchema) request.outputSchema = params.outputSchema;
  return request;
}

type Checked<T> =
  | { status: 'succeeded'; output: T | undefined; error?: undefined }
  | {
      status: 'refused' | 'truncated' | 'invalid_output';
      code: 'AI_REFUSED' | 'AI_MAX_TOKENS' | 'AI_INVALID_OUTPUT';
      error: string;
    };

/** Checks stop_reason before touching content (CONTRACT §6). */
function checkResponse<T>(response: ProviderResponse, structured: boolean): Checked<T> {
  if (response.stopReason === 'refusal') {
    const category = response.refusalCategory ? ` (${response.refusalCategory})` : '';
    return {
      status: 'refused',
      code: 'AI_REFUSED',
      error: `Model declined the request${category}`,
    };
  }
  if (response.stopReason === 'max_tokens') {
    return { status: 'truncated', code: 'AI_MAX_TOKENS', error: 'Output hit max_tokens' };
  }
  if (!structured) return { status: 'succeeded', output: undefined };
  try {
    return { status: 'succeeded', output: JSON.parse(response.text) as T };
  } catch {
    return {
      status: 'invalid_output',
      code: 'AI_INVALID_OUTPUT',
      error: 'Output is not valid JSON',
    };
  }
}
