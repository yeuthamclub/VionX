// Item counts per library on the configured database: pnpm cloud npx tsx scripts/library-counts.ts
import { connectDb } from './acceptance/lib.ts';

const sql = connectDb();
const rows = await sql`
  select grade, subject, status, count(*)::int as n, count(*) filter (where kind = 'TEMPLATE')::int as templates
  from library.items group by 1, 2, 3 order by 1, 2, 3`;
for (const r of rows)
  console.log(`${r.grade}-${r.subject} ${r.status} ${r.n} (template ${r.templates})`);
await sql.end();
