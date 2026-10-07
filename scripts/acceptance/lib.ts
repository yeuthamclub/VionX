// Shared helpers for acceptance scenarios (Node, run with tsx). Defaults target local Supabase.
import postgres from 'postgres';

export const env = {
  functionsUrl: (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
    /\/+$/,
    '',
  ),
  dbUrl: process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  serviceSecret: process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret',
};

export type Outcome = 'PASS' | 'FAIL' | 'SKIP';

export interface StepResult {
  name: string;
  outcome: Outcome;
  detail: string;
}

export class SkipStep extends Error {}

export interface Scenario {
  name: string;
  steps: { name: string; run: () => Promise<string> }[];
  cleanup?: () => Promise<void>;
}

export function connectDb() {
  return postgres(env.dbUrl, { max: 2, onnotice: () => {} });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function runScenario(scenario: Scenario): Promise<boolean> {
  const results: StepResult[] = [];
  console.log(`Acceptance ${scenario.name}\n`);
  for (const step of scenario.steps) {
    const started = Date.now();
    let result: StepResult;
    try {
      result = { name: step.name, outcome: 'PASS', detail: await step.run() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        name: step.name,
        outcome: error instanceof SkipStep ? 'SKIP' : 'FAIL',
        detail: message,
      };
    }
    results.push(result);
    console.log(
      `${result.outcome.padEnd(4)}  ${step.name} (${Date.now() - started} ms)\n      ${result.detail}`,
    );
  }
  await scenario.cleanup?.();
  const failed = results.filter((r) => r.outcome === 'FAIL').length;
  const skipped = results.filter((r) => r.outcome === 'SKIP').length;
  console.log(
    `\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`,
  );
  return failed === 0;
}
