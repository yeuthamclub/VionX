import { describe, expect, it } from 'vitest';
import { AiGateway, FakeAiProvider, MemoryAiRunStore, StaticTaskConfigSource } from '@vionx/ai';
import { createAiBatchHandler } from '../ai-batch/app.ts';

function setup() {
  const provider = new FakeAiProvider();
  const runs = new MemoryAiRunStore();
  const gateway = new AiGateway({ provider, runs, config: new StaticTaskConfigSource() });
  const handler = createAiBatchHandler({ serviceSecret: 's', gateway });
  const call = (body: unknown, secret = 's') =>
    handler(
      new Request('http://local/ai-batch', {
        method: 'POST',
        headers: { 'x-vionx-service-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  return { provider, runs, call };
}

describe('ai-batch function', () => {
  it('submits and collects through the AiGateway (FakeAiProvider)', async () => {
    const { provider, runs, call } = setup();
    const submitted = await call({
      action: 'submit',
      task: 'item_verification',
      promptVersion: 'item_verification.v1',
      outputSchema: { type: 'object' },
      items: [{ customId: 'i1', input: { item: 1 } }],
    });
    expect(submitted.status).toBe(200);
    const { batchId, model } = (await submitted.json()) as { batchId: string; model: string };
    expect(model).toBe('claude-haiku-4-5');

    provider.endBatch(batchId);
    const collected = await call({ action: 'collect', batchId });
    expect(await collected.json()).toMatchObject({
      status: 'ended',
      items: [{ customId: 'i1', ok: true, output: { ok: true } }],
    });
    expect(runs.records.map((r) => r.status)).toEqual(['batch_submitted', 'succeeded']);
  });

  it('validates input and the service secret', async () => {
    const { call } = setup();
    expect((await call({ action: 'submit', task: 'nope' })).status).toBe(400);
    expect((await call({ action: 'collect', batchId: 'x' }, 'wrong')).status).toBe(401);
    expect((await call({ action: 'collect', batchId: 'missing' })).status).toBe(404);
  });
});
