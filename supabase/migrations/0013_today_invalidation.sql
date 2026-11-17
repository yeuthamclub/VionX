-- VionX M07 — a deleted calendar event or timetable entry makes today's plan stale at once.
-- The api regenerates a plan on read when a source row changed after `generated_at`
-- (planIsStale); a deleted row leaves nothing to compare, so the delete itself marks the plan.

create or replace function app.invalidate_today_plans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 'epoch' is older than any maxAgeMinutes: the next read regenerates. Two days cover every
  -- timezone's "today".
  update app.today_plans
  set generated_at = 'epoch'
  where student_id = old.student_id and local_date >= (now() - interval '2 days')::date;
  return old;
end;
$$;

create trigger calendar_events_invalidate_today after delete on app.calendar_events
  for each row execute function app.invalidate_today_plans();
create trigger school_timetable_entries_invalidate_today after delete on app.school_timetable_entries
  for each row execute function app.invalidate_today_plans();

revoke all on all functions in schema app, ops from public, anon, authenticated;
