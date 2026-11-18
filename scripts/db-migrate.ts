// `pnpm db:migrate`: applies the files of supabase/migrations that the database has not recorded
// yet, each in its own transaction. It writes the same table as `supabase db push`
// (supabase_migrations.schema_migrations), so both tools agree on what has run.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const dbUrl = process.env.DB_URL;
if (!dbUrl) throw new Error('DB_URL is not set (run through `pnpm db:migrate`)');
const dir = resolve(import.meta.dirname, '../supabase/migrations');
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
try {
  await sql`create schema if not exists supabase_migrations`;
  await sql`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text)`;
  const rows = await sql<{ version: string }[]>`
    select version from supabase_migrations.schema_migrations`;
  const done = new Set(rows.map((r) => r.version));
  for (const file of readdirSync(dir)
    // Not dotfiles: macOS writes AppleDouble `._*.sql` copies on ExFAT drives.
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort()) {
    const [version = '', ...name] = file.replace(/\.sql$/, '').split('_');
    if (done.has(version)) continue;
    const text = readFileSync(resolve(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values (${version}, ${name.join('_')}, ${[text]})`;
    });
    console.log('applied', file);
  }
  console.log('migrations are up to date');
} finally {
  await sql.end();
}
