# M04 Plan — Reward engine

Branch: `m04-rewards` from `main` (M00–M03 merged).
Scope: `TASK_PACKS/M04.md`. Refs: Master Spec §14 (currency §14.1, caps §14.2, anti-gaming §14.3),
§25 (events XpGranted / CoinGranted / RewardRedeemed); CONTRACT §3 (ledgers, local day), §4.
Migration number: **0009** (0008 is reserved for M05, built in parallel).

## Model
- **System caps** (`app.system_caps`, key → integer, global, no personal data): `XP_PER_COIN` 100,
  `COIN_NOMINAL_VND` 1000, `WEEKDAY_CAP_COINS` 20, `WEEKEND_TIER0..3_CAP_COINS` 20/30/40/50,
  `WEEKEND_MAX_COINS` 50, `MAX_GRANTS_PER_RULE_PER_DAY` 30, `LATE_GRANT_DAYS` 2. Mirrors
  `SYSTEM_CAPS` in `@vionx/domain` (an integration test keeps them equal).
- **Reward rules** (`app.reward_rules`): JSON config validated by Zod (contracts) and by the domain
  (`validateRewardRules`). A system default row (`household_id` null) and household overrides; every
  PATCH inserts a new version (history kept). Config: weekday cap, four weekend tier caps, weekend
  goals (reading tasks, activity tasks), and per-rule micro caps (`TASK_APPROVED.maxGrantsPerDay`).
  Parents may lower caps / raise goals, never raise a cap above the system cap.
- **XP ledger** (`app.xp_ledger`, append-only): `lifetime_xp_delta`, `rewardable_xp_delta`,
  `reward_day` (household-local day the XP belongs to), `source_type`, `source_id`, `rule_id`,
  `rule_version`, `capped_reason` (`DAILY_XP_CAP`, `MICRO_CAP`, `LATE`), `idempotency_key`,
  `reversal_of`. Unique `(source_type, source_id, rule_id)` and `idempotency_key`; one reversal per
  entry.
- **Coin ledger** (`app.coin_ledger`, append-only): `amount` (+ conversion, − redemption hold, +
  reversal), `kind`, `reward_day`, source refs, `idempotency_key`, `reversal_of`.
- Both ledgers register in `ops.ledger_registry` (anonymised, not deleted, on purge; no FK to
  students) and use `ops.ledger_append_only()`. Idempotency keys never contain student ids.
- **Daily snapshots** (`app.daily_reward_snapshots`): one row per settlement *version* of a child's
  day (facts, tier, cap, rewardable XP, coins total). A re-settlement that changes the result
  inserts the next version; the coin entry points at that version.
- **Catalog** (`app.reward_catalog_items`): household rewards with a Coin cost, archived (not
  deleted) so redemptions keep their item.
- **Redemptions** (`app.reward_redemptions`): `PENDING → APPROVED | REJECTED`, idempotent by
  `client_uuid`. The Coin cost is held at request time (debit) and released by a reversal entry on
  reject.

## Rules (`packages/domain/src/rewards`)
- 100 rewardable XP = 1 Coin; 1 Coin = 1,000 VND nominal (display only).
- Reward day = the task day (`date` of the TaskApproved payload). A grant counts toward Coin only
  when it happens (event time, household timezone) at most `LATE_GRANT_DAYS` after that day;
  later grants are lifetime XP only (`LATE`). This lets a parent approve yesterday's homework but
  stops backlog farming of old self-check days.
- Weekday cap 20 Coin. Weekend (Sat/Sun, household-local) tiers 20/30/40/50 from facts:
  Tier 1 = at least one required learning task that day and all of them completed; Tier 2 = Tier 1
  + reading goal (completed READING tasks ≥ goal) + activity goal (completed SPORT tasks ≥ goal);
  Tier 3 = Tier 2 + one parent-approved optional task (bonus/family mission). Facts come from
  completed task days until M16/M18 provide reading/activity facts.
- At grant time rewardable XP is capped at the day's highest possible cap × 100 (weekday cap, or the
  top weekend tier); the rest is lifetime only (`DAILY_XP_CAP`). Micro cap: after
  `maxGrantsPerDay` grants of one rule on one day, further grants give 0 XP (`MICRO_CAP`).
- Day conversion: coins = min(floor(rewardable XP / 100), cap of the day's tier). No rollover: a
  day's leftover XP is never converted later. Coins already granted are never taken back by a
  re-settlement; a late grant (or a higher weekend tier) tops the day up by the difference.
- Ledgers are append-only; corrections are reversal entries (negated deltas, `reversal_of`).
- Levels from lifetime XP: level L starts at 50·L·(L−1) XP (1: 0, 2: 100, 3: 300, 4: 600 …).
- Property tests (fast-check): caps never exceeded, conversion formula, replaying a grant set is a
  no-op, validated household rules never exceed system caps, tiers monotonic, reversals sum to 0,
  levels monotonic.

## Steps (CLAUDE.md working-loop order)
1. **Migration** `0009_rewards.sql`: tables above, system default rules, ledger triggers and
   registry, `ops.request_reward_settlement(now)` + pg_cron `vionx-reward-settlement` hourly at :05
   (an outbox event; the worker settles every household whose local day has ended), RLS on, no
   client grants.
2. **Domain** `packages/domain/src/rewards`: constants, rules validation/merge, weekend tier, caps,
   grant planning, day conversion, settlement delta, levels, redemption checks, events.
3. **API** `supabase/functions/api/rewards` (+ Zod in `packages/contracts/src/rewards.ts`):
   - `GET /v1/students/{id}/rewards/wallet` (XP, level, Coin, held Coin, today's cap bar).
   - `GET /v1/students/{id}/rewards/ledger?kind=coin|xp&cursor&limit`.
   - `GET|PATCH /v1/household/reward-rules` (parent; effective rules, system caps, defaults).
   - `GET|POST /v1/household/reward-catalog`, `PATCH|DELETE /v1/household/reward-catalog/{itemId}`.
   - `GET /v1/reward-redemptions` (parent inbox / child's own), `POST /v1/reward-redemptions`
     (child, `clientUuid`), `POST /v1/reward-redemptions/{id}/approve|reject` (parent).
   - Child: read own wallet/ledger/catalog, request redemptions; every other write is parent-only.
     Cross-household 404 on every child route.
4. **Worker**: `task.approved` and `task.completed` (status APPROVED) → XP grant (same uniqueness key,
   so only one grants), per-student advisory lock, idempotent by event id and by ledger keys;
   `reward.settlement_requested` → settle due days per household timezone. Events `xp.granted`,
   `coin.granted`, `reward.redeemed` (Master Spec names in `eventName`). Export gains reward
   sections.
5. **Mobile**: parent rewards screen per child (wallet + ledger), rules editor (system caps shown),
   catalog editor, redemption approvals (badge); child wallet (XP, level, Coin, today's cap bar),
   catalog with redemption request. Loading/empty/error/offline states, vi/en.
6. **Seed**: a small catalog for the demo household.
7. **Acceptance** `scripts/acceptance/m04.ts`; Maestro `apps/mobile/.maestro/m04-rewards.yaml`;
   CI runs `pnpm acceptance m04`.
8. Checks: lint, typecheck, unit tests, `pnpm test:api`, openapi check, acceptance m04 (+ m03, m02).
   REPORT, ROADMAP, push.

## Remaining steps
None. All steps are done (see M04_REPORT).
