// `pnpm db:seed`: applies supabase/seed.sql to the local database without a full reset.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

const dbUrl = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(await readFile(resolve(import.meta.dirname, '../supabase/seed.sql'), 'utf8'));
  console.log('seed.sql applied');
} finally {
  await sql.end();
}
