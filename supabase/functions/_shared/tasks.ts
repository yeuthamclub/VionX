// Task occurrence materialisation, shared by the api (at create/edit) and the worker (daily job).
// Idempotent: occurrences are unique per (task, day) and inserted with `on conflict do nothing`.
import { daysToMaterialise, householdToday } from '@vionx/domain';
import type { Sql, TxSql } from './db.ts';

type Db = Sql | TxSql;

export interface MaterialisableTask {
  id: string;
  household_id: string;
  assigned_student_id: string;
  starts_on: string;
  rrule: string | null;
}

/** Inserts the task's days (one-off: its day; recurring: the next 14 days). Returns new rows. */
export async function materialiseTask(db: Db, task: MaterialisableTask, today: string) {
  const days = daysToMaterialise({ startsOn: task.starts_on, rrule: task.rrule }, today);
  if (days.length === 0) return 0;
  const rows = await db`
    insert into app.task_occurrences (household_id, student_id, assignment_id, occurs_on)
    select ${task.household_id}, ${task.assigned_student_id}, ${task.id}, d::date
    from unnest(${days}::text[]) as d
    on conflict (assignment_id, occurs_on) do nothing
    returning id`;
  return rows.length;
}

/**
 * Daily job (`task.materialise_requested`): every active recurring task of every household, with
 * each household's own "today". Returns the number of occurrences created.
 */
export async function materialiseAll(
  db: Db,
  now: Date,
): Promise<{ tasks: number; created: number }> {
  const tasks = await db<(MaterialisableTask & { timezone: string })[]>`
    select a.id, a.household_id, a.assigned_student_id, a.starts_on::text as starts_on, a.rrule,
           h.timezone
    from app.task_assignments a
    join app.households h on h.id = a.household_id
    join app.students s on s.id = a.assigned_student_id
    where a.status = 'ACTIVE' and a.rrule is not null
      and h.deletion_requested_at is null and s.disabled_at is null
    order by a.household_id, a.id`;
  let created = 0;
  for (const task of tasks) {
    created += await materialiseTask(db, task, householdToday(now, task.timezone));
  }
  return { tasks: tasks.length, created };
}
