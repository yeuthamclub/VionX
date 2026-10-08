-- VionX M01 — identity & household: parent profiles, households, students, child credentials and
-- sessions, admin permissions, rate-limit helper. Migrations are never edited after merge.

-- ---------------------------------------------------------------------------
-- Parents (Supabase Auth users) and households
-- ---------------------------------------------------------------------------
create table app.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.profiles is 'One row per parent account (auth.users). Created on first API use.';

create table app.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.households is 'Root of all family data. timezone drives the reward local day.';

create table app.household_memberships (
  household_id uuid not null references app.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('OWNER', 'GUARDIAN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_memberships_user_idx on app.household_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Children: profile, credentials (login id + argon2id PIN hash), sessions (opaque tokens)
-- ---------------------------------------------------------------------------
create table app.students (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birth_year integer not null check (birth_year between 1990 and 2100),
  grade integer not null check (grade between 1 and 12),
  avatar text not null default 'owl' check (avatar ~ '^[a-z][a-z0-9_]{0,31}$'),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index students_household_idx on app.students (household_id, created_at);

create table app.child_credentials (
  student_id uuid primary key,
  household_id uuid not null,
  child_login_id text not null unique check (child_login_id ~ '^vx-[23456789abcdefghjkmnpqrstuvwxyz]{6}$'),
  pin_hash text not null check (pin_hash like '$argon2id$%'),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  pin_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.child_credentials is 'Child login: vx- id + PIN (argon2id hash only). 5 failures lock for 15 minutes.';
create index child_credentials_household_idx on app.child_credentials (household_id);

create table app.child_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  household_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  device_id text not null check (char_length(device_id) between 1 and 128),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade
);
comment on table app.child_sessions is 'Opaque child tokens (32 random bytes), stored as sha-256. 30-day sliding expiry, revocable.';
create index child_sessions_student_active_idx on app.child_sessions (student_id) where revoked_at is null;
create index child_sessions_household_idx on app.child_sessions (household_id);

-- ---------------------------------------------------------------------------
-- Admin permissions (CONTRACT D11): admin = parent account + permission rows
-- ---------------------------------------------------------------------------
create table ops.admin_permissions (
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null check (permission in (
    'SUPER_ADMIN', 'CONTENT_ADMIN', 'CURRICULUM_EDITOR', 'CONTENT_REVIEWER', 'LIBRARIAN', 'SUPPORT', 'ANALYST'
  )),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission)
);

-- updated_at triggers
create trigger profiles_updated_at before update on app.profiles
  for each row execute function ops.set_updated_at();
create trigger households_updated_at before update on app.households
  for each row execute function ops.set_updated_at();
create trigger household_memberships_updated_at before update on app.household_memberships
  for each row execute function ops.set_updated_at();
create trigger students_updated_at before update on app.students
  for each row execute function ops.set_updated_at();
create trigger child_credentials_updated_at before update on app.child_credentials
  for each row execute function ops.set_updated_at();
create trigger child_sessions_updated_at before update on app.child_sessions
  for each row execute function ops.set_updated_at();
create trigger admin_permissions_updated_at before update on ops.admin_permissions
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rate limits: fixed-window counter on ops.rate_limits. Returns the count after this hit.
-- ---------------------------------------------------------------------------
create or replace function ops.rate_limit_hit(p_bucket text, p_window_seconds integer)
returns integer
language sql
set search_path = ''
as $$
  insert into ops.rate_limits as r (bucket, window_start, count)
  values (
    p_bucket,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1
  )
  on conflict on constraint rate_limits_pkey do update set count = r.count + 1
  returning r.count;
$$;

-- Daily housekeeping: old rate-limit windows and sessions that ended more than 30 days ago.
create or replace function ops.cleanup_identity() returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from ops.rate_limits where window_start < now() - interval '2 days';
  delete from app.child_sessions
    where coalesce(revoked_at, expires_at) < now() - interval '30 days';
end;
$$;

select cron.schedule('vionx-identity-cleanup', '17 20 * * *', $$select ops.cleanup_identity()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.profiles enable row level security;
alter table app.households enable row level security;
alter table app.household_memberships enable row level security;
alter table app.students enable row level security;
alter table app.child_credentials enable row level security;
alter table app.child_sessions enable row level security;
alter table ops.admin_permissions enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema ops from public, anon, authenticated;
