// Shared flat config for the whole monorepo. Packages run `eslint .` and resolve this file upward.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/generated/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['scripts/**', '**/scripts/**', '**/*.config.{ts,mjs,js}', '**/tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/metro.config.js', '**/babel.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/**/*.tsx', 'apps/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['apps/admin/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['supabase/functions/**'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
  prettier,
);
