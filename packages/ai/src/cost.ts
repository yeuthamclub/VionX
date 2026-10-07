import type { AiUsage } from './types.ts';

/** USD per million tokens. Cache writes (5-minute TTL) bill at 1.25x input. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

const PRICES: Record<string, Price> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

/** Batch API requests are billed at 50%. Unknown models estimate as 0 (logged, never guessed). */
export function estimateCostUsd(model: string, usage: AiUsage, batch = false): number {
  const price = PRICES[model];
  if (!price) return 0;
  const usd =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.input * 1.25) /
    1_000_000;
  return Number((batch ? usd / 2 : usd).toFixed(6));
}
