import { defineConfig } from 'vitest/config';

// API integration tests: `pnpm cloud pnpm test:api` against the development project (ADR-002, with
// `pnpm fn:serve` running), or CI's local Supabase. A remote database costs about 0.2 s per query,
// so the limits are wider there.
const remote = !/127\.0\.0\.1|localhost/.test(process.env.DB_URL ?? '127.0.0.1');
export default defineConfig({
  test: {
    include: ['tests/integration/*.test.ts'],
    testTimeout: remote ? 600_000 : 90_000,
    hookTimeout: remote ? 300_000 : 30_000,
    fileParallelism: false,
  },
});
