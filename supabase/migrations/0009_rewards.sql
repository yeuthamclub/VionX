-- VionX M04 — reward engine (TASK_PACKS/M04.md, Master Spec §14).
-- System caps, versioned reward rules (system defaults + household overrides), append-only XP and
-- Coin ledgers (corrections by reversal entries, anonymised on purge), versioned daily settlement
-- snapshots, the household reward catalog and redemptions. Rules live in @vionx/domain (rewards/);
-- the worker grants XP from task.approved / task.completed and settles each household-local day
-- after it ends (hourly pg_cron request). 0008 is reserved for M05. Migrations are never edited
-- after merge.

-- ---------------------------------------------------------------------------
-- System caps (Master Spec §14.2 safety caps; global, no personal data). Parents can lower these
-- through their reward rules but never raise them. Mirrors SYSTEM_CAPS in @vionx/domain.
-- ---------------------------------------------------------------------------
create table app.system_caps (
  key text primary key check (key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  value integer not null check (value >= 0),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.system_caps is 'Product-level reward safety caps (Master Spec §14.2). Changed only by an administrator-level product decision.';

insert into app.system_caps (key, value, description) values
  ('XP_PER_COIN', 100, '100 rewardable XP convert to 1 Coin'),
  ('COIN_NOMINAL_VND', 1000, 'Nominal value of 1 Coin in VND (display only, never paid out)'),
  ('WEEKDAY_CAP_COINS', 20, 'Monday-Friday: at most 20 Coin per child per local day'),
  ('WEEKEND_TIER0_CAP_COINS', 20, 'Saturday-Sunday Tier 0: normal eligible tasks'),
  ('WEEKEND_TIER1_CAP_COINS', 30, 'Tier 1: all required daily learning tasks completed'),
  ('WEEKEND_TIER2_CAP_COINS', 40, 'Tier 2: Tier 1 + reading goal + physical activity goal'),
  ('WEEKEND_TIER3_CAP_COINS', 50, 'Tier 3: Tier 2 + one approved bonus challenge / family mission'),
  ('WEEKEND_MAX_COINS', 50, 'Absolute weekend maximum per child per local day'),
  ('MAX_GRANTS_PER_RULE_PER_DAY', 30, 'Micro-action cap: XP grants of one rule per child per day'),
  ('LATE_GRANT_DAYS', 2, 'A grant counts toward Coin only up to this many days after its day');

-- ---------------------------------------------------------------------------
-- Reward rules: JSON config (validated by @vionx/contracts RewardRulesConfigSchema and
-- @vionx/domain validateRewardRules). household_id null = the system default. Every change inserts
-- a new version; the latest version is in force.
-- ---------------------------------------------------------------------------
create table app.reward_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references app.households (id) on delete cascade,
  version integer not null check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app.reward_rules is 'Versioned reward rules: system default (household_id null) and household overrides (never above app.system_caps). Rows are never updated; a change inserts the next version.';
create unique index reward_rules_version_uidx
  on app.reward_rules (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

insert into app.reward_rules (household_id, version, config) values (null, 1, '{
  "weekdayCapCoins": 20,
  "weekendTierCaps": [20, 30, 40, 50],
  "weekendGoals": { "readingTasks": 1, "activityTasks": 1 },
  "micro": { "TASK_APPROVED": { "maxGrantsPerDay": 20 } }
}'::jsonb);

-- ---------------------------------------------------------------------------
-- XP ledger (append-only). lifetime_xp_delta drives levels; rewardable_xp_delta is the part that may
-- convert to Coin on reward_day (household-local). Each (source_type, source_id, rule_id) grants
-- once. A correction is a reversal row (source_type 'reversal', source_id = the reversed entry).
-- No foreign key to app.students: ledgers are anonymised, not deleted, on purge (0003).
-- ---------------------------------------------------------------------------
create table app.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  reward_day date not null,
  lifetime_xp_delta integer not null,
  rewardable_xp_delta integer not null,
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  source_id uuid not null,
  rule_id text not null check (rule_id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  rule_version integer,
  capped_reason text check (capped_reason in ('DAILY_XP_CAP', 'MICRO_CAP', 'LATE')),
  event_id uuid,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  reversal_of uuid unique references app.xp_ledger (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id, rule_id),
  check (
    (reversal_of is null and lifetime_xp_delta >= 0
      and rewardable_xp_delta between 0 and lifetime_xp_delta)
    or (reversal_of is not null and source_type = 'reversal' and lifetime_xp_delta <= 0
      and rewardable_xp_delta <= 0 and rewardable_xp_delta >= lifetime_xp_delta)
  )
);
comment on table app.xp_ledger is 'Append-only XP ledger (Master Spec §14.1/§14.3). Unique per (source_type, source_id, rule_id); corrections by reversal rows.';
create index xp_ledger_student_day_idx on app.xp_ledger (household_id, student_id, reward_day);
create index xp_ledger_student_created_idx on app.xp_ledger (household_id, student_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Coin ledger (append-only). DAY_CONVERSION credits a settled day (source: the snapshot version),
-- REDEMPTION_HOLD debits a requested reward, REVERSAL undoes one entry (e.g. a rejected redemption).
-- ---------------------------------------------------------------------------
create table app.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  amount integer not null check (amount <> 0),
  kind text not null check (kind in ('DAY_CONVERSION', 'REDEMPTION_HOLD', 'REVERSAL')),
  reward_day date,
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  source_id uuid not null,
  rule_id text not null check (rule_id ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  event_id uuid,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  reversal_of uuid unique references app.coin_ledger (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id, rule_id),
  check ((kind = 'REVERSAL') = (reversal_of is not null)),
  check (kind <> 'DAY_CONVERSION' or (amount > 0 and reward_day is not null)),
  check (kind <> 'REDEMPTION_HOLD' or amount < 0)
);
comment on table app.coin_ledger is 'Append-only Coin ledger: day conversions, redemption holds and their reversals. Coin is a parent-managed reward unit, never a bank balance.';
create index coin_ledger_student_created_idx on app.coin_ledger (household_id, student_id, created_at desc, id desc);
create index coin_ledger_student_day_idx on app.coin_ledger (household_id, student_id, reward_day)
  where reward_day is not null;

create trigger xp_ledger_append_only before update or delete on app.xp_ledger
  for each row execute function ops.ledger_append_only();
create trigger coin_ledger_append_only before update or delete on app.coin_ledger
  for each row execute function ops.ledger_append_only();

insert into ops.ledger_registry (table_name, student_column, household_column) values
  ('app.xp_ledger', 'student_id', 'household_id'),
  ('app.coin_ledger', 'student_id', 'household_id');

-- ---------------------------------------------------------------------------
-- Daily settlement snapshots: one row per version of a child's settled local day. A re-settlement
-- whose result differs (late approval, weekend tier reached later) inserts the next version; the
-- Coin entry of that version points at it. Rows are never updated.
-- ---------------------------------------------------------------------------
create table app.daily_reward_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  local_day date not null,
  version integer not null check (version >= 1),
  weekend boolean not null,
  tier integer check (tier between 0 and 3),
  cap_coins integer not null check (cap_coins >= 0),
  rewardable_xp integer not null check (rewardable_xp >= 0),
  lifetime_xp integer not null,
  coins_total integer not null check (coins_total >= 0),
  coins_granted integer not null check (coins_granted >= 0),
  xp_forfeited integer not null check (xp_forfeited >= 0),
  facts jsonb not null default '{}'::jsonb,
  rules_version integer not null,
  settled_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, local_day, version),
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check (weekend = (tier is not null))
);
comment on table app.daily_reward_snapshots is 'Settled reward days (facts, weekend tier, cap, coins). Versioned; the highest version is current.';
create index daily_reward_snapshots_student_idx
  on app.daily_reward_snapshots (household_id, student_id, local_day desc, version desc);
create trigger daily_reward_snapshots_immutable before update on app.daily_reward_snapshots
  for each row execute function ops.forbid_mutation();
create trigger reward_rules_immutable before update on app.reward_rules
  for each row execute function ops.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Reward catalog (household) and redemptions
-- ---------------------------------------------------------------------------
create table app.reward_catalog_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  cost_coins integer not null check (cost_coins between 1 and 10000),
  icon text not null default 'gift' check (icon ~ '^[a-z][a-z0-9_]{0,31}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check ((status = 'ARCHIVED') = (archived_at is not null))
);
comment on table app.reward_catalog_items is 'Rewards a household offers for Coin (screen time, outing...). Archived, never deleted, so redemptions keep their item.';
create index reward_catalog_items_household_idx on app.reward_catalog_items (household_id, status, cost_coins);

create table app.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  student_id uuid not null,
  item_id uuid not null,
  client_uuid uuid not null unique,
  title text not null check (char_length(title) between 1 and 80),
  cost_coins integer not null check (cost_coins > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (item_id, household_id) references app.reward_catalog_items (id, household_id) on delete cascade,
  foreign key (student_id, household_id) references app.students (id, household_id) on delete cascade,
  check ((status = 'PENDING') = (decided_at is null))
);
comment on table app.reward_redemptions is 'A child asking for a catalog reward. The cost is held in app.coin_ledger at request time and released by a reversal on reject. Idempotent by client_uuid.';
create index reward_redemptions_household_idx on app.reward_redemptions (household_id, status, requested_at);
create index reward_redemptions_student_idx on app.reward_redemptions (household_id, student_id, requested_at desc);

create trigger system_caps_updated_at before update on app.system_caps
  for each row execute function ops.set_updated_at();
create trigger reward_catalog_items_updated_at before update on app.reward_catalog_items
  for each row execute function ops.set_updated_at();
create trigger reward_redemptions_updated_at before update on app.reward_redemptions
  for each row execute function ops.set_updated_at();

-- ---------------------------------------------------------------------------
-- Day-end settlement (TASK_PACKS/M04): pg_cron writes one outbox event per hour; the worker
-- handler `reward.settlement_requested` settles, for every household, the local days that have
-- ended by `requestedAt` in that household's timezone (idempotent: an unchanged day writes
-- nothing). The conversion rules stay in one place (@vionx/domain).
-- ---------------------------------------------------------------------------
create or replace function ops.request_reward_settlement(p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.domain_events (type, aggregate_type, payload, idempotency_key)
  values ('reward.settlement_requested', 'system',
          jsonb_build_object('requestedAt', p_now),
          'settle:' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24'))
  on conflict do nothing;
$$;

-- Every hour at :05 UTC, so each timezone's midnight is followed by a settlement within the hour
-- (Asia/Ho_Chi_Minh: 00:05 local).
select cron.schedule('vionx-reward-settlement', '5 * * * *', $$select ops.request_reward_settlement()$$);

-- ---------------------------------------------------------------------------
-- RLS on, no client grants (CONTRACT §3)
-- ---------------------------------------------------------------------------
alter table app.system_caps enable row level security;
alter table app.reward_rules enable row level security;
alter table app.xp_ledger enable row level security;
alter table app.coin_ledger enable row level security;
alter table app.daily_reward_snapshots enable row level security;
alter table app.reward_catalog_items enable row level security;
alter table app.reward_redemptions enable row level security;
revoke all on all tables in schema app, ops from public, anon, authenticated;
revoke all on all functions in schema app, ops from public, anon, authenticated;
