// Reward engine data access (M04). Every child-data query takes a Scope (household filter).
import type { CatalogIcon, CatalogItemStatus, RedemptionStatus } from '@vionx/domain';
import type { Sql, TxSql } from '../../_shared/db.ts';
import type { Scope } from '../../_shared/scope.ts';

type Db = Sql | TxSql;

// --- Students -------------------------------------------------------------------------------------

export interface RewardStudentRow {
  id: string;
  household_id: string;
  display_name: string;
  timezone: string;
}

export async function rewardStudent(
  db: Db,
  scope: Scope,
  id: string,
): Promise<RewardStudentRow | null> {
  const rows = await db<RewardStudentRow[]>`
    select s.id, s.household_id, s.display_name, h.timezone
    from app.students s join app.households h on h.id = s.household_id
    where s.id = ${id} and ${scope.where('s.household_id')}`;
  return rows[0] ?? null;
}

export interface SnapshotRow {
  local_day: string;
  tier: number | null;
  cap_coins: number;
  rewardable_xp: number;
  coins_total: number;
  settled_at: Date;
}

export async function lastSettledDay(
  db: Db,
  scope: Scope,
  studentId: string,
): Promise<SnapshotRow | null> {
  const rows = await db<SnapshotRow[]>`
    select local_day::text as local_day, tier, cap_coins, rewardable_xp, coins_total, settled_at
    from app.daily_reward_snapshots
    where student_id = ${studentId} and ${scope.where()}
    order by local_day desc, version desc limit 1`;
  return rows[0] ?? null;
}

// --- Ledgers --------------------------------------------------------------------------------------

export interface LedgerRow {
  id: string;
  created_at: Date;
  reward_day: string | null;
  entry_kind: string;
  lifetime_xp_delta: number | null;
  rewardable_xp_delta: number | null;
  coin_delta: number | null;
  source_type: string;
  source_id: string;
  rule_id: string;
  capped_reason: 'DAILY_XP_CAP' | 'MICRO_CAP' | 'LATE' | null;
  reversal_of: string | null;
  label: string | null;
}

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export async function xpLedger(
  db: Db,
  scope: Scope,
  studentId: string,
  limit: number,
  cursor: LedgerCursor | null,
): Promise<LedgerRow[]> {
  return db<LedgerRow[]>`
    select l.id, l.created_at, l.reward_day::text as reward_day,
           case when l.reversal_of is null then 'GRANT' else 'REVERSAL' end as entry_kind,
           l.lifetime_xp_delta, l.rewardable_xp_delta, null::int as coin_delta,
           l.source_type, l.source_id, l.rule_id, l.capped_reason, l.reversal_of,
           a.title as label
    from app.xp_ledger l
    left join app.task_completions c on l.source_type = 'task_completion' and c.id = l.source_id
    left join app.task_assignments a on a.id = c.assignment_id
    where l.student_id = ${studentId} and ${scope.where('l.household_id')}
      ${cursor ? db`and (l.created_at, l.id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : db``}
    order by l.created_at desc, l.id desc
    limit ${limit}`;
}

export async function coinLedger(
  db: Db,
  scope: Scope,
  studentId: string,
  limit: number,
  cursor: LedgerCursor | null,
): Promise<LedgerRow[]> {
  return db<LedgerRow[]>`
    select l.id, l.created_at, l.reward_day::text as reward_day, l.kind as entry_kind,
           null::int as lifetime_xp_delta, null::int as rewardable_xp_delta, l.amount as coin_delta,
           l.source_type, l.source_id, l.rule_id, null::text as capped_reason, l.reversal_of,
           r.title as label
    from app.coin_ledger l
    left join app.coin_ledger o on o.id = l.reversal_of
    left join app.reward_redemptions r on r.id = (
      case when l.source_type = 'reward_redemption' then l.source_id
           when o.source_type = 'reward_redemption' then o.source_id end)
    where l.student_id = ${studentId} and ${scope.where('l.household_id')}
      ${cursor ? db`and (l.created_at, l.id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : db``}
    order by l.created_at desc, l.id desc
    limit ${limit}`;
}

// --- Rules ----------------------------------------------------------------------------------------

export async function insertRules(
  tx: TxSql,
  householdId: string,
  config: unknown,
  createdBy: string,
): Promise<number> {
  await tx`select pg_advisory_xact_lock(4005, hashtext(${householdId}::text))`;
  const [row] = await tx<{ version: number }[]>`
    insert into app.reward_rules (household_id, version, config, created_by)
    select ${householdId}, coalesce(max(version), 0) + 1, ${tx.json(config as never)}, ${createdBy}
    from app.reward_rules where household_id = ${householdId}
    returning version`;
  return row!.version;
}

// --- Catalog --------------------------------------------------------------------------------------

export interface CatalogRow {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  cost_coins: number;
  icon: CatalogIcon;
  status: CatalogItemStatus;
  created_at: Date;
  updated_at: Date;
}

const CATALOG_COLUMNS = [
  'id',
  'household_id',
  'title',
  'description',
  'cost_coins',
  'icon',
  'status',
  'created_at',
  'updated_at',
];

export async function catalog(
  db: Db,
  householdId: string,
  includeArchived: boolean,
): Promise<CatalogRow[]> {
  return db<CatalogRow[]>`
    select ${db(CATALOG_COLUMNS)} from app.reward_catalog_items
    where household_id = ${householdId} ${includeArchived ? db`` : db`and status = 'ACTIVE'`}
    order by status, cost_coins, created_at`;
}

export async function catalogItem(
  db: Db,
  scope: Scope,
  id: string,
  forUpdate = false,
): Promise<CatalogRow | null> {
  const rows = await db<CatalogRow[]>`
    select ${db(CATALOG_COLUMNS)} from app.reward_catalog_items
    where id = ${id} and ${scope.where()} ${forUpdate ? db`for update` : db``}`;
  return rows[0] ?? null;
}

export interface CatalogValues {
  title: string;
  description: string | null;
  cost_coins: number;
  icon: CatalogIcon;
}

export async function insertCatalogItem(
  db: Db,
  householdId: string,
  createdBy: string,
  v: CatalogValues,
): Promise<CatalogRow> {
  const [row] = await db<CatalogRow[]>`
    insert into app.reward_catalog_items (household_id, title, description, cost_coins, icon, created_by)
    values (${householdId}, ${v.title}, ${v.description}, ${v.cost_coins}, ${v.icon}, ${createdBy})
    returning ${db(CATALOG_COLUMNS)}`;
  return row!;
}

export async function updateCatalogItem(
  db: Db,
  scope: Scope,
  id: string,
  v: CatalogValues & { status: CatalogItemStatus },
): Promise<CatalogRow | null> {
  const [row] = await db<CatalogRow[]>`
    update app.reward_catalog_items set
      title = ${v.title}, description = ${v.description}, cost_coins = ${v.cost_coins},
      icon = ${v.icon}, status = ${v.status},
      archived_at = case when ${v.status} = 'ARCHIVED' then coalesce(archived_at, now()) else null end
    where id = ${id} and ${scope.where()}
    returning ${db(CATALOG_COLUMNS)}`;
  return row ?? null;
}

// --- Redemptions ----------------------------------------------------------------------------------

export interface RedemptionRow {
  id: string;
  household_id: string;
  student_id: string;
  display_name: string;
  item_id: string;
  client_uuid: string;
  title: string;
  cost_coins: number;
  status: RedemptionStatus;
  requested_at: Date;
  decided_at: Date | null;
  decision_note: string | null;
}

const redemptionSelect = (db: Db) => db`
  select r.id, r.household_id, r.student_id, s.display_name, r.item_id, r.client_uuid, r.title,
         r.cost_coins, r.status, r.requested_at, r.decided_at, r.decision_note
  from app.reward_redemptions r join app.students s on s.id = r.student_id`;

export async function redemptionByClientUuid(
  db: Db,
  clientUuid: string,
): Promise<RedemptionRow | null> {
  const rows = await db<RedemptionRow[]>`
    ${redemptionSelect(db)} where r.client_uuid = ${clientUuid}`;
  return rows[0] ?? null;
}

export async function redemption(
  db: Db,
  scope: Scope,
  id: string,
  forUpdate = false,
): Promise<RedemptionRow | null> {
  const rows = await db<RedemptionRow[]>`
    ${redemptionSelect(db)} where r.id = ${id} and ${scope.where('r.household_id')}
    ${forUpdate ? db`for update of r` : db``}`;
  return rows[0] ?? null;
}

export async function redemptions(
  db: Db,
  scope: Scope,
  filter: { status?: RedemptionStatus | undefined; studentId?: string | undefined },
): Promise<RedemptionRow[]> {
  return db<RedemptionRow[]>`
    ${redemptionSelect(db)}
    where ${scope.where('r.household_id')}
      ${filter.status ? db`and r.status = ${filter.status}` : db``}
      ${filter.studentId ? db`and r.student_id = ${filter.studentId}` : db``}
    order by (r.status = 'PENDING') desc, r.requested_at desc
    limit 100`;
}

export async function pendingRedemptionCount(
  db: Db,
  scope: Scope,
  studentId?: string,
): Promise<number> {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from app.reward_redemptions
    where status = 'PENDING' and ${scope.where()}
      ${studentId ? db`and student_id = ${studentId}` : db``}`;
  return row!.n;
}

export async function insertRedemption(
  tx: TxSql,
  v: {
    householdId: string;
    studentId: string;
    itemId: string;
    clientUuid: string;
    title: string;
    costCoins: number;
  },
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into app.reward_redemptions (household_id, student_id, item_id, client_uuid, title, cost_coins)
    values (${v.householdId}, ${v.studentId}, ${v.itemId}, ${v.clientUuid}, ${v.title}, ${v.costCoins})
    on conflict (client_uuid) do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

export async function decideRedemption(
  tx: TxSql,
  id: string,
  v: { status: 'APPROVED' | 'REJECTED'; by: string; note: string | null },
): Promise<void> {
  await tx`
    update app.reward_redemptions
    set status = ${v.status}, decided_at = now(), decided_by = ${v.by}, decision_note = ${v.note}
    where id = ${id}`;
}

export async function coinBalance(tx: Db, householdId: string, studentId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select coalesce(sum(amount), 0)::int as n from app.coin_ledger
    where household_id = ${householdId} and student_id = ${studentId}`;
  return row!.n;
}

export async function insertCoinEntry(
  tx: TxSql,
  v: {
    householdId: string;
    studentId: string;
    amount: number;
    kind: 'REDEMPTION_HOLD' | 'REVERSAL';
    sourceType: string;
    sourceId: string;
    ruleId: string;
    key: string;
    reversalOf?: string | null;
  },
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into app.coin_ledger (household_id, student_id, amount, kind, source_type, source_id,
      rule_id, idempotency_key, reversal_of)
    values (${v.householdId}, ${v.studentId}, ${v.amount}, ${v.kind}, ${v.sourceType}, ${v.sourceId},
      ${v.ruleId}, ${v.key}, ${v.reversalOf ?? null})
    on conflict do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

export async function redemptionHold(
  tx: TxSql,
  redemptionId: string,
): Promise<{ id: string; amount: number; reversed_by: string | null } | null> {
  const rows = await tx<{ id: string; amount: number; reversed_by: string | null }[]>`
    select l.id, l.amount, r.id as reversed_by
    from app.coin_ledger l left join app.coin_ledger r on r.reversal_of = l.id
    where l.source_type = 'reward_redemption' and l.source_id = ${redemptionId}
      and l.kind = 'REDEMPTION_HOLD'`;
  return rows[0] ?? null;
}
