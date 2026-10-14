import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic.ts';
import type { ProviderRequest } from '../types.ts';

/** Captures the HTTP request the SDK would send; never reaches the network. */
function capture(responseBody: Record<string, unknown>) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fakeFetch };
}

const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text: '{"ok":true}' }],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 0,
  },
  ...overrides,
});

const baseRequest: ProviderRequest = {
  model: 'claude-sonnet-5-5',
  system: 'stable prefix',
  input: 'item input',
  maxTokens: 1000,
  effort: 'high',
  outputSchema: { type: 'object' },
  refusalFallback: true,
};

describe('AnthropicProvider', () => {
  it('sends cached system prefix, structured output, effort and the refusal fallback', async () => {
    const { calls, fakeFetch } = capture(message());
    const provider = new AnthropicProvider({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
    const response = await provider.complete(baseRequest);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      fallbacks: 'default',
      system: [{ type: 'text', text: 'stable prefix', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'item input' }],
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
    });
    expect(response).toMatchObject({
      stopReason: 'end_turn',
      text: '{"ok":true}',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 0 },
    });
  });

  it('omits effort and fallback for Haiku requests', async () => {
    const { calls, fakeFetch } = capture(message({ model: 'claude-haiku-4-5' }));
    const provider = new AnthropicProvider({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
    await provider.complete({
      ...baseRequest,
      model: 'claude-haiku-4-5',
      effort: null,
      outputSchema: undefined,
      refusalFallback: false,
    });
    const body = calls[0]!.body;
    expect(body.fallbacks).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(calls[0]!.headers.get('anthropic-beta')).toBeNull();
  });

  it('surfaces refusals with their category', async () => {
    const { fakeFetch } = capture(
      message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }),
    );
    const provider = new AnthropicProvider({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
    const response = await provider.complete(baseRequest);
    expect(response).toMatchObject({ stopReason: 'refusal', refusalCategory: 'cyber' });
  });

  it('puts PDF attachments before the text input, in batches too', async () => {
    const { calls, fakeFetch } = capture({
      id: 'msgbatch_1',
      type: 'message_batch',
      processing_status: 'in_progress',
      request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    });
    const provider = new AnthropicProvider({ apiKey: 'test', fetch: fakeFetch, maxRetries: 0 });
    await provider.createBatch([
      {
        customId: 'p1',
        request: {
          ...baseRequest,
          refusalFallback: false,
          attachments: [{ mediaType: 'application/pdf', data: 'JVBERi0=' }],
        },
      },
    ]);
    const params = (calls[0]!.body.requests as { params: Record<string, unknown> }[])[0]!.params;
    expect(params.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
          },
          { type: 'text', text: 'item input' },
        ],
      },
    ]);
  });
});
