// `pnpm ai:check`: one tiny real Claude call through the AiGateway (task `ai_check`).
// Spends a fraction of a cent. Exits 2 when ANTHROPIC_API_KEY is missing.
import { AiError, AiGateway, MemoryAiRunStore, StaticTaskConfigSource } from '../src/index.ts';
import { AnthropicProvider } from '../src/providers/anthropic.ts';

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      [
        'ai:check skipped: ANTHROPIC_API_KEY is not set.',
        'Create a key in the Anthropic Console (set a workspace spend limit), then run:',
        '  ANTHROPIC_API_KEY=sk-ant-... pnpm ai:check',
      ].join('\n'),
    );
    return 2;
  }

  const runs = new MemoryAiRunStore();
  const gateway = new AiGateway({
    provider: new AnthropicProvider({ apiKey, maxRetries: 1, timeoutMs: 60_000 }),
    config: new StaticTaskConfigSource(),
    runs,
  });

  try {
    const result = await gateway.run({
      task: 'ai_check',
      promptVersion: 'ai_check.v1',
      system: 'You are a health check. Reply with exactly the word OK.',
      input: 'Health check.',
    });
    const okText = /\bOK\b/i.test(result.text);
    console.log(
      JSON.stringify(
        {
          ok: okText,
          model: result.model,
          text: result.text,
          usage: result.usage,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
        },
        null,
        2,
      ),
    );
    return okText ? 0 : 1;
  } catch (error) {
    if (error instanceof AiError) {
      console.error(`ai:check failed: ${error.code}: ${error.message}`);
    } else {
      console.error('ai:check failed:', error instanceof Error ? error.message : error);
    }
    return 1;
  }
}

process.exitCode = await main();
