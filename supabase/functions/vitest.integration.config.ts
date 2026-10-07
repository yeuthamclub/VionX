import { defineConfig } from 'vitest/config';

// API integration tests against local Supabase (`pnpm db:start && pnpm fn:serve`).
export default defineConfig({
  test: {
    include: ['tests/integration/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
