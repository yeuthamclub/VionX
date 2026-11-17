// Runs a command with the Supabase Cloud environment of `.env.cloud` (ADR-002):
//   pnpm cloud <command> [args...]      e.g. `pnpm cloud pnpm test:api`
// package.json loads the file with `node --env-file=.env.cloud`; this script only adds the names
// the tests, acceptance scripts and the function server expect.
import { spawnSync } from 'node:child_process';

for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_URL']) {
  if (!process.env[name]) {
    console.error(`${name} is not set. Copy .env.example to .env.cloud and fill it in.`);
    process.exit(1);
  }
}
// Not 54321: an old local Supabase stack may still listen there, and tests must never reach it.
const port = process.env.PORT ?? '54331';
const env = {
  // Same value as the Vault entry `vionx_service_secret` written by supabase/seed.sql.
  VIONX_SERVICE_SECRET: 'local-dev-service-secret',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  APP_VERSION: '0.0.0-dev',
  ...process.env,
  PORT: port,
  DB_URL: process.env.SUPABASE_DB_URL,
  FUNCTIONS_URL: process.env.FUNCTIONS_URL ?? `http://127.0.0.1:${port}/functions/v1`,
};
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: pnpm cloud <command> [args...]');
  process.exit(1);
}
process.exit(spawnSync(command, args, { stdio: 'inherit', env }).status ?? 1);
