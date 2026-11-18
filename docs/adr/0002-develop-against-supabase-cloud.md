# ADR-002: Develop against Supabase Cloud, not local Docker

- Status: Accepted
- Date: 2026-11-17
- Deciders: Leo (product owner), Claude (lead engineer)

(ADR-001, the Toán 5 library, is on the unmerged branch `x02-math5-profile`.)

## Context

Until M05, development used `supabase start`: Postgres, Auth, Storage and the Edge Runtime in Docker on the Mac mini (16 GB).
On 2026-11-16 the Docker engine stopped answering during M06 and did not come back.
The local database also held the only imported copy of 2,010 reviewed items.
The owner decided on 2026-11-17 to stop using Docker for development.

## Decision

- Development and manual testing use one **Supabase Cloud project in Singapore** (Free plan for now), called the development project.
  Its URL and keys live in the git-ignored file `.env.cloud` (template: `.env.example`).
- The Edge Functions under development run on the Mac with Deno, against that project: `pnpm fn:serve` (`supabase/functions/serve.ts`, the three functions on port 54331, same paths as hosted).
- `pnpm cloud <command>` runs any command with that environment, for example `pnpm cloud pnpm test:api` or `pnpm cloud pnpm acceptance m06`.
- `pnpm db:migrate` applies new migration files and records them in `supabase_migrations.schema_migrations`, the table `supabase db push` uses.
- `pnpm db:start`, `db:stop` and `db:reset` are removed. Nothing in the repository resets a database any more.
- Tests may not delete reviewed content: `resetLibraryScope` refuses a grade-subject with more than 50 items (fixtures have at most 10).
- CI is unchanged: GitHub runners start a throwaway local Supabase for each run.

## Consequences

- No Docker memory on the Mac mini; the database survives a broken machine.
- Every query crosses the network (about 0.2 s from the Mac). The API integration suite and the acceptance scenarios take minutes, not seconds. Deployed functions next to the database do not have this cost.
- The integration test `library.test.ts` and `pnpm acceptance m05` import fixtures into Toán 6, Toán 2 and Tiếng Việt 2. They cannot run on a database that holds those reviewed libraries; the guard stops them. A full `pnpm check` therefore needs a second project that holds fixtures only (the Free plan allows two), or CI.
- Phone test OTPs of `supabase/config.toml` do not exist on a cloud project. Tests that sign in by phone need "Test phone numbers" set in the dashboard (Authentication → Phone) or run in CI only.
- `supabase/seed.sql` creates accounts and a service secret whose values are in this repository. They are acceptable only while the development project holds no real family. Before any real user: new service secret, delete the seed accounts, turn email confirmation on.
- Free plan limits: 500 MB database, the project pauses after about a week without activity (resume in the dashboard), no backups. Production needs the Pro plan (README, "Accounts to create").
- pg_cron reaches the worker only where the worker is deployed (`vionx_worker_url` in Vault). With functions served on the Mac, the tests call the worker themselves.
