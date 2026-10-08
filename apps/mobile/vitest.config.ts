import { defineConfig } from 'vitest/config';

// Pure TS units only (i18n, helpers). Component tests use Jest (jest-expo) from later modules.
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
