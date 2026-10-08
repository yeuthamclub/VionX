import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  AiUsage,
  BatchCounts,
  BatchStatus,
  ProviderBatchResult,
  ProviderRequest,
  ProviderResponse,
} from '../types.ts';

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Override for tests or a proxy. */
  baseURL?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Claude API provider using the official SDK (`npm:@anthropic-ai/sdk` under Deno). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeoutMs ?? 120_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const params = toParams(request);
    if (request.refusalFallback) {
      const message = await this.client.beta.messages.create({
        ...params,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
      return fromMessage(message);
    }
    const message = await this.client.messages.create(params);
    return fromMessage(message);
  }

  async createBatch(
    requests: { customId: string; request: ProviderRequest }[],
  ): Promise<{ batchId: string }> {
    const batch = await this.client.messages.batches.create({
      requests: requests.map(({ customId, request }) => ({
        custom_id: customId,
        params: toParams(request),
      })),
    });
    return { batchId: batch.id };
  }

  async getBatch(batchId: string): Promise<{ status: BatchStatus; counts: BatchCounts }> {
    const batch = await this.client.messages.batches.retrieve(batchId);
    return {
      status: batch.processing_status,
      counts: { ...batch.request_counts },
    };
  }

  async *batchResults(batchId: string): AsyncIterable<ProviderBatchResult> {
    // Results arrive in any order; callers key by customId.
    for await (const entry of await this.client.messages.batches.results(batchId)) {
      const result = entry.result;
      switch (result.type) {
        case 'succeeded':
          yield { customId: entry.custom_id, response: fromMessage(result.message) };
          break;
        case 'errored':
          yield {
            customId: entry.custom_id,
            error: { type: result.error.error.type, message: result.error.error.message },
          };
          break;
        default:
          yield { customId: entry.custom_id, error: { type: result.type, message: result.type } };
      }
    }
  }
}

function toParams(request: ProviderRequest): Anthropic.MessageCreateParamsNonStreaming {
  const outputConfig: Anthropic.OutputConfig = {};
  if (request.effort) outputConfig.effort = request.effort;
  if (request.outputSchema) {
    outputConfig.format = { type: 'json_schema', schema: request.outputSchema };
  }
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.maxTokens,
    // Stable prefix first and cached; item-specific input last (CONTRACT §6).
    ...(request.system
      ? {
          system: [
            { type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' } },
          ],
        }
      : {}),
    messages: [{ role: 'user', content: request.input }],
  };
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;
  return params;
}

interface MessageLike {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: ReadonlyArray<{ type: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

function fromMessage(message: MessageLike): ProviderResponse {
  const text = message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const usage: AiUsage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
  return {
    model: message.model,
    stopReason: message.stop_reason ?? 'end_turn',
    text,
    usage,
    refusalCategory: message.stop_details?.category ?? null,
  };
}
