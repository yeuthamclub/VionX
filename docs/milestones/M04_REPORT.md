# M04 Report

## Summary
Approved task days now earn XP, and XP becomes Coin at each household's local midnight under the
Master Spec §14 caps: 100 XP = 1 Coin, at most 20 Coin on a weekday, and on the weekend 20/30/40/50
Coin by tier, where the tier is decided from completed tasks. Parents can lower the caps (never raise
them), set the weekend goals and keep a catalog of rewards. A child redeems a reward with Coin, which
is held at once; the parent approves (spent) or rejects (returned by a reversal entry). Unused room
under a cap does not roll over. Every grant is unique per `(source_type, source_id, rule_id)`, the
ledgers are append-only, and replaying every event changes nothing.

## Changed
- Migration `0009_rewards.sql`. This is the only M04 migration (0008 is untouched, reserved for M05).
  - `app.system_caps`: XP_PER_COIN 100, COIN_NOMINAL_VND 1000, WEEKDAY_CAP_COINS 20,
    WEEKEND_TIER0..3 20/30/40/50, WEEKEND_MAX 50, MAX_GRANTS_PER_RULE_PER_DAY 30,
    LATE_GRANT_DAYS 2.
  - `app.reward_rules`: versioned household rules (full config per version, never updated) plus the
    system default row (`household_id` null, version 1).
  - `app.xp_ledger`: unique on `(source_type, source_id, rule_id)` and on `idempotency_key`;
    reversals point at the reversed row (unique); `capped_reason` is DAILY_XP_CAP, MICRO_CAP or LATE.
  - `app.coin_ledger`: DAY_CONVERSION, REDEMPTION_HOLD and REVERSAL entries, same uniqueness.
  - `app.daily_reward_snapshots`: one version per re-settlement of a day (never updated).
  - `app.reward_catalog_items` and `app.reward_redemptions` (`client_uuid` unique; PENDING,
    APPROVED or REJECTED).
  - Both ledgers are in `ops.ledger_registry` with the `ops.ledger_append_only()` trigger, have no
    foreign key to students and are anonymised by the M02 purge.
  - `ops.request_reward_settlement(now)` writes one `reward.settlement_requested` outbox event per
    UTC hour (key `settle:YYYY-MM-DDTHH`); pg_cron `vionx-reward-settlement` runs it at minute 5.
  - RLS is on and there are no client grants.
- Domain (`packages/domain/src/rewards`): system caps (stored rows may only be stricter), rules
  validation (`ABOVE_SYSTEM_CAP`, `TIERS_NOT_ASCENDING`, …), merge and clamp, day facts and weekend
  tier, `planXpGrant` (micro cap → late → daily XP cap), `convertDay`/`settleDay` (top-up only),
  settlement window, cap view, levels (level L starts at 50·L·(L−1) XP), reversals and redemption
  rules. 31 tests including fast-check properties (cap never exceeded, no rollover, replay-stable,
  lowering rules never raises Coin) and timezone tests.
- Contracts: `packages/contracts/src/rewards.ts`, types exported from `@vionx/contracts/client`.
- Shared: `_shared/rewards.ts` (`grantTaskXp`, `settleStudentDay`, `settleDueDays`, balances). Every
  write for a student runs in one transaction under `pg_advisory_xact_lock(4004, hashtext(student))`.
- API routes (`supabase/functions/api/rewards`):
  - `GET /v1/students/{id}/rewards/wallet` and `GET /v1/students/{id}/rewards/ledger` (parent, or
    the child for their own id).
  - `GET|PATCH /v1/household/reward-rules` (parent only; audited; a new version per PATCH; values
    above the system caps answer 400 with `details.violations`).
  - `GET|POST /v1/household/reward-catalog`, `PATCH|DELETE /v1/household/reward-catalog/{itemId}`
    (parent only, audited; DELETE archives; children see active items only).
  - `GET /v1/reward-redemptions`, `POST /v1/reward-redemptions` (child only; replay by
    `clientUuid`; 409 `INSUFFICIENT_COINS` or `ITEM_ARCHIVED`), and
    `POST /v1/reward-redemptions/{id}/approve|reject` (parent only).
- Worker: consumers for `task.approved` and `task.completed` (APPROVED only) grant XP;
  `reward.settlement_requested` settles every due day per household timezone. Events emitted:
  `xp.granted` (XpGranted), `coin.granted` (CoinGranted), `reward.redeemed` (RewardRedeemed), plus
  `notification.push_requested` kind `reward.redemption_requested`. The privacy export gains
  `reward_rules`, `xp_ledger`, `coin_ledger`, `reward_days`, `reward_catalog` and
  `reward_redemptions` (.json).
- Mobile screens: parent per-child rewards (wallet, cap bar, ledger; `open-rewards`), rules editor
  (validated on the device with the same domain rule), catalog editor, redemptions inbox with a badge
  (`open-redemptions`); child wallet (`open-child-wallet`) and rewards catalog with redeem. Loading,
  empty, error and offline states; vi/en strings; reward error reasons and rule violations map to
  messages.
- CI runs `pnpm acceptance m04`.

## Evidence
All checks ran against local Supabase with the functions served.
- `pnpm lint`, `pnpm typecheck` (including `deno check`) and `pnpm openapi:check`: green.
- `pnpm test`: all passed.

  | Package | Tests (M03 → M04) |
  |---|---|
  | domain | 78 → 109 |
  | functions | 77 → 88 |
  | ai | 20 |
  | admin | 8 |
  | mobile (Vitest) | 28 → 34 |
  | mobile (Jest) | 12 → 15 |
  | tokens | 2 |
  | contracts | 1 |

- `pnpm test:api`: 107/107 passed (90 before, plus 17 new in `tests/integration/rewards.test.ts`):
  system caps, append-only ledgers and grant uniqueness, SELF_CHECK granted once across both task
  events, approval vs rejection, late-grant window, Wednesday 3,500 XP → 20 Coin, timezone boundary,
  Saturday Tier 2 ≤ 40 then Tier 3, full event replay, lower-never-raise rules, catalog permissions,
  redemption hold/approve/reject, parents cannot redeem, cross-household 404 on every child route,
  no client privileges, purge anonymisation.
- Acceptance `pnpm acceptance m04`: 7 passed, 0 failed, 1 skipped (Maestro). Checks: Wednesday with
  3,500 XP → exactly 20 Coin; Saturday at Tier 2 → at most 40 Coin; settlement at each household's
  local midnight (Ho Chi Minh City vs UTC); replaying all events changes nothing; live path (child
  completes, wallet, redeem, parent approves); child 403 on rules/catalog/approve and other household
  404.
- Re-runs: `m03` 7 passed, 1 skipped; `m02` 11 passed, 1 skipped.
- Build: `expo export --platform android` passes (5.1 MB Hermes bundle).
- Maestro: `apps/mobile/.maestro/m04-rewards.yaml` (new) was not run (no emulator here). It covers
  the rules editor (25 refused, 15 saved), a catalog item, a SELF_CHECK task completed by the child,
  the wallet (lifetime XP, cap bar) and the catalog "needs 5 more Coin" state.
- AI cost: US$0.

## Decisions (spec forks)
- **Reward day** is the task date (`payload.date`), not the approval day.
- **Late grants.** A task day approved within LATE_GRANT_DAYS (2) of its date counts toward Coin and
  re-settles that closed day at once with a top-up. Older days give lifetime XP only (no backlog
  farming).
- **Event time drives everything**: the grant day uses the event's `occurredAt` and settlement uses
  the request's `requestedAt`, so replays are deterministic.
- **Grant-time cap.** Rewardable XP for a day is capped at that day's highest possible cap; the rest
  is lifetime XP only (`DAILY_XP_CAP`). Micro cap: 20 grants per rule per day by default (system max
  30).
- **Both task events** are consumed; ledger uniqueness on the completion id makes one grant.
- **Weekend tiers from facts**: Tier 1 = at least one required learning task completed; Tier 2 = also
  READING ≥ goal and SPORT ≥ goal (default 1 each); Tier 3 = also an optional parent-verified
  (PARENT_APPROVAL/PHOTO_PROOF) task.
- **No clawback.** Re-settlement only tops up; lowering rules never removes Coin already granted.
- **Redemption** holds Coin as a debit at request time; reject writes a REVERSAL entry; approve emits
  `reward.redeemed`. Parents cannot redeem for a child.
- **Levels**: level L starts at 50·L·(L−1) lifetime XP (display only).
- **Settlement cadence**: hourly pg_cron outbox request; the worker settles each household at its
  own local midnight.
- **Rules versioning**: each PATCH stores the full config as a new version (audit-friendly).
- **Routes beyond the task pack**: `GET /v1/reward-redemptions` (parent inbox and child history).
- **Tests and acceptance** insert synthetic approved completions and events with chosen times, to
  reach fixed weekdays and 3,500 XP without the clock.

## Privacy & security impact
- New personal data: XP/Coin ledgers, daily snapshots, catalog and redemptions. All household-scoped
  through `scoped(ctx)`; none of it is in library tables. Ledgers are anonymised, not deleted, on
  purge; idempotency keys never contain student ids.
- Rules, catalog and redemption decisions are audited. No consent type is needed (no AI, microphone,
  health or competition feature).

## Owner actions
- None required. Optionally run the Maestro flow on an emulator.

## Known issues / follow-ups
- Maestro flow not verified (no emulator). It cannot redeem on the same day, because Coin is credited
  at day end.
- The seed has no reward catalog; parents create items in the app.
- No admin screens for rewards (not in the M04 pack).
- Push for redemption requests is the outbox stub until the push module.

## What the next module can rely on
- Consume `xp.granted` (`studentId`, `entryId`, `rewardDay`, `lifetimeXp`, `rewardableXp`,
  `cappedReason`, `sourceType`, `sourceId`, `ruleId`) and `coin.granted` (`studentId`, `entryId`,
  `rewardDay`, `coins`, `coinsTotal`, `capCoins`, `tier`, `snapshotVersion`). The idempotency key of
  each event is its ledger entry id.
- To grant XP from a new source (e.g. M06 practice sessions), add a rule id to `XP_RULE_IDS` and a
  source type to `LEDGER_SOURCE_TYPES`, and call the same plan/insert path under the student lock;
  uniqueness on `(source_type, source_id, rule_id)` keeps it idempotent.
