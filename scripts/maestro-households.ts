// The Maestro flows sign in with the test phone numbers 09000000xx and add children on every run.
// Lists those households; `--delete <phone>` removes that one (the auth user stays, so the next run
// starts from "create household"). Seed households (ids 00000000-…) are never deleted.
//   pnpm cloud npx tsx scripts/maestro-households.ts [--delete 84900000003]
import { connectDb } from './acceptance/lib.ts';

const sql = connectDb();
const rows = await sql<{ id: string; name: string; phone: string; students: number }[]>`
  select h.id, h.name, u.phone, (select count(*)::int from app.students s where s.household_id = h.id) as students
  from app.households h
  join app.household_memberships m on m.household_id = h.id
  join auth.users u on u.id = m.user_id
  where u.phone ~ '^849000000[0-9]{2}$'
  order by u.phone`;
for (const r of rows) console.log(`${r.phone} "${r.name}" ${r.students} students ${r.id}`);
const at = process.argv.indexOf('--delete');
if (at >= 0) {
  const phone = process.argv[at + 1];
  const hit = rows.filter((r) => r.phone === phone && !r.id.startsWith('00000000-'));
  for (const r of hit) await sql`delete from app.households where id = ${r.id}`;
  console.log(`deleted ${hit.length} household(s) of ${phone}`);
}
await sql.end();
