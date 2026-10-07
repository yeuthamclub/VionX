// `pnpm acceptance <module>`: runs scripts/acceptance/<module>.ts.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runScenario, type Scenario } from './lib.ts';

const moduleId = process.argv[2]?.toLowerCase();
if (!moduleId || !/^[mx]\d{2}$/.test(moduleId)) {
  console.error('Usage: pnpm acceptance <module>   e.g. pnpm acceptance m00');
  process.exit(2);
}
const file = resolve(import.meta.dirname, `${moduleId}.ts`);
if (!existsSync(file)) {
  console.error(`No acceptance scenario for ${moduleId} (${file})`);
  process.exit(2);
}
const { scenario } = (await import(file)) as { scenario: Scenario };
process.exit((await runScenario(scenario)) ? 0 : 1);
