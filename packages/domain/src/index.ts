// @vionx/domain — pure business rules shared by Edge Functions (Deno), mobile and admin.
// Rules: no framework imports, no Node built-ins, no I/O. Relative imports carry the `.ts`
// extension so the same files run under Deno, Vite, Metro and Vitest without a build step.
//
// Layout: one folder per module as modules land (identity/, consent/, calendar/, rewards/,
// curriculum/, practice/, mastery/, planner/ ...). M00 ships the shared helpers below.
export * from './identity/index.ts';
export * from './shared/result.ts';
export * from './time/local-day.ts';
