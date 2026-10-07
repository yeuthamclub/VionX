import { describe, expect, it } from 'vitest';
import {
  AiError,
  AiGateway,
  FakeAiProvider,
  MemoryAiRunStore,
  StaticTaskConfigSource,
  estimateCostUsd,
} from './index.ts';

function setup(overrides?: ConstructorParameters<typeof StaticTaskConfigSource>[0]) {
  const provider = new FakeAiProvider();
  const runs = new MemoryAiRunStore();
  let t = 1000;
  const gateway = new AiGateway({
    provider,
    runs,
    config: new StaticTaskConfigSource(overrides),
    now: () => (t += 25),
  });
  return { provider, runs, gateway };
}

describe('AiGateway.run', () => {
  it('uses the task config model and logs an ai_runs row', async () => {
    const { gateway, provider, runs } = setup();
    const result = await gateway.run({
      task: 'tutor_t2',
      promptVersion: 'tutor_t2.v1',
      system: 'stable prefix',
      input: { question: '2+2?' },
      studentRef: 'stu_abc',
      sourceRefs: ['page:1'],
    });
    expect(result.text).toBe('OK');
    expect(provider.requests[0]).toMatchObject({
      model: 'claude-haiku-4-5',
      system: 'stable prefix',
      input: '{"question":"2+2?"}',
      effort: null,
      refusalFallback: false,
    });
    expect(runs.records).toHaveLength(1);
    expect(runs.records[0]).toMatchObject({
      task: 'tutor_t2',
      status: 'succeeded',
      mode: 'realtime',
      studentRef: 'stu_abc',
      sourceRefs: ['page:1'],
      latencyMs: 25,
    });
  });

  it('opts realtime Sonnet/Opus 5.5 calls into the refusal fallback', async () => {
    const { gateway, provider } = setup();
    await gateway.run({ task: 'tutor_t3', promptVersion: 'v1', input: 'hi' });
    expect(provider.requests[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      refusalFallback: true,
    });
  });

  it('parses structured output', async () => {
    const { gateway, provider } = setup();
    provider.respondWith(() => ({ text: '{"status":"OK"}' }));
    const result = await gateway.run<{ status: string }>({
      task: 'ai_check',
      promptVersion: 'v1',
      input: 'x',
      outputSchema: { type: 'object' },
    });
    expect(result.output).toEqual({ status: 'OK' });
  });

  it.each([
    ['refusal', 'AI_REFUSED', 'refused'],
    ['max_tokens', 'AI_MAX_TOKENS', 'truncated'],
  ] as const)('checks stop_reason %s before parsing', async (stopReason, code, status) => {
    const { gateway, provider, runs } = setup();
    provider.respondWith(() => ({ stopReason, text: '{"partial":' }));
    await expect(
      gateway.run({ task: 'ai_check', promptVersion: 'v1', input: 'x', outputSchema: {} }),
    ).rejects.toMatchObject({ code });
    expect(runs.records[0]?.status).toBe(status);
  });

  it('rejects invalid JSON output', async () => {
    const { gateway, provider } = setup();
    provider.respondWith(() => ({ text: 'not json' }));
    await expect(
      gateway.run({ task: 'ai_check', promptVersion: 'v1', input: 'x', outputSchema: {} }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it('refuses disabled tasks without calling the provider', async () => {
    const { gateway, provider } = setup({ tutor_t2: { enabled: false } });
    await expect(
      gateway.run({ task: 'tutor_t2', promptVersion: 'v1', input: 'x' }),
    ).rejects.toMatchObject({ code: 'AI_TASK_DISABLED' });
    expect(provider.requests).toHaveLength(0);
  });

  it('logs provider failures', async () => {
    const { gateway, provider, runs } = setup();
    provider.respondWith(() => {
      throw new Error('boom');
    });
    await expect(
      gateway.run({ task: 'ai_check', promptVersion: 'v1', input: 'x' }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(runs.records[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('AiGateway batches', () => {
  it('submits, polls and collects a batch, logging one row per item', async () => {
    const { gateway, provider, runs } = setup();
    provider.respondWith((req) => ({ text: JSON.stringify({ echo: req.input }) }));
    const submitted = await gateway.submitBatch('item_generation', 'item_generation.v1', [
      { customId: 'a1', input: 'one', sourceRefs: ['p1'] },
      { customId: 'a2', input: 'two', sourceRefs: ['p1', 'p2'] },
    ]);
    expect(submitted).toMatchObject({ model: 'claude-sonnet-5-5', count: 2 });
    // Batch requests never carry the realtime refusal fallback.
    expect(provider.requests.every((r) => !r.refusalFallback)).toBe(true);
    expect(runs.records[0]).toMatchObject({ status: 'batch_submitted', sourceRefs: ['p1', 'p2'] });

    expect(await gateway.collectBatch(submitted.batchId)).toMatchObject({ status: 'in_progress' });

    provider.endBatch(submitted.batchId);
    const collected = await gateway.collectBatch<{ echo: string }>(submitted.batchId);
    expect(collected.status).toBe('ended');
    if (collected.status !== 'ended') return;
    expect(collected.items.map((i) => [i.customId, i.output?.echo])).toEqual([
      ['a1', 'one'],
      ['a2', 'two'],
    ]);
    expect(runs.records.filter((r) => r.batchId === submitted.batchId)).toHaveLength(3);
  });

  it('rejects invalid or duplicate custom ids', async () => {
    const { gateway } = setup();
    await expect(
      gateway.submitBatch('item_generation', 'v1', [
        { customId: 'x', input: '1' },
        { customId: 'x', input: '2' },
      ]),
    ).rejects.toBeInstanceOf(AiError);
    await expect(
      gateway.submitBatch('item_generation', 'v1', [{ customId: 'bad id!', input: '1' }]),
    ).rejects.toBeInstanceOf(AiError);
  });

  it('rejects unknown batches', async () => {
    const { gateway } = setup();
    await expect(gateway.collectBatch('nope')).rejects.toMatchObject({ code: 'AI_UNKNOWN_BATCH' });
  });
});

describe('estimateCostUsd', () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  it('prices per model and halves batch requests', () => {
    expect(estimateCostUsd('claude-haiku-4-5', usage)).toBe(6);
    expect(estimateCostUsd('claude-sonnet-5-5', usage, true)).toBe(6);
    expect(estimateCostUsd('unknown-model', usage)).toBe(0);
  });
});
