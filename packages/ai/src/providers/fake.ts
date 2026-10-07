import type {
  AiProvider,
  BatchCounts,
  BatchStatus,
  ProviderBatchResult,
  ProviderRequest,
  ProviderResponse,
} from '../types.ts';

export type FakeResponder = (request: ProviderRequest) => Partial<ProviderResponse>;

/**
 * Deterministic provider for tests (CONTRACT §6: tests never hit paid APIs).
 * By default it answers `{"ok":true}` for structured requests and `OK` otherwise.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly requests: ProviderRequest[] = [];
  private readonly batches = new Map<
    string,
    { status: BatchStatus; items: { customId: string; request: ProviderRequest }[] }
  >();
  private batchSeq = 0;

  constructor(private responder: FakeResponder = () => ({})) {}

  respondWith(responder: FakeResponder): void {
    this.responder = responder;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(request);
    return this.answer(request);
  }

  async createBatch(
    requests: { customId: string; request: ProviderRequest }[],
  ): Promise<{ batchId: string }> {
    this.requests.push(...requests.map((r) => r.request));
    const batchId = `fakebatch_${++this.batchSeq}`;
    this.batches.set(batchId, { status: 'in_progress', items: requests });
    return { batchId };
  }

  /** Test helper: mark a batch as finished. */
  endBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) batch.status = 'ended';
  }

  async getBatch(batchId: string): Promise<{ status: BatchStatus; counts: BatchCounts }> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Unknown batch ${batchId}`);
    const n = batch.items.length;
    const done = batch.status === 'ended';
    return {
      status: batch.status,
      counts: {
        processing: done ? 0 : n,
        succeeded: done ? n : 0,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
    };
  }

  async *batchResults(batchId: string): AsyncIterable<ProviderBatchResult> {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Unknown batch ${batchId}`);
    for (const item of batch.items) {
      yield { customId: item.customId, response: this.answer(item.request) };
    }
  }

  private answer(request: ProviderRequest): ProviderResponse {
    const partial = this.responder(request);
    const text = partial.text ?? (request.outputSchema ? '{"ok":true}' : 'OK');
    return {
      model: partial.model ?? request.model,
      stopReason: partial.stopReason ?? 'end_turn',
      text,
      usage: partial.usage ?? {
        inputTokens: Math.ceil((request.system.length + request.input.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      refusalCategory: partial.refusalCategory ?? null,
    };
  }
}
