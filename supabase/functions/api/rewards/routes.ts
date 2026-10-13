import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  canDecideRedemption,
  canRequestRedemption,
  capView,
  COIN_RULE_IDS,
  householdToday,
  LEDGER_SOURCE_TYPES,
  ledgerKey,
  levelFor,
  mergeRewardRules,
  nominalVnd,
  REWARD_EVENT_NAMES,
  REWARD_EVENT_TYPES,
  reverseCoins,
  validateRewardRules,
  type CatalogIcon,
  type RedemptionRequestError,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import { ApiError } from '../../_shared/errors.ts';
import { OutboxPushNotifier } from '../../_shared/notify.ts';
import {
  balances,
  loadDayFacts,
  loadRules,
  loadSystemCaps,
  lockStudentRewards,
  rewardableXpOn,
} from '../../_shared/rewards.ts';
import { parentHouseholds, scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { householdParents } from '../calendar/repo.ts';
import { writeAudit, writeEvent } from '../identity/repo.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import * as repo from './repo.ts';
import {
  CatalogItemCreateSchema,
  CatalogItemIdParamSchema,
  CatalogItemResponseSchema,
  CatalogItemUpdateSchema,
  CatalogQuerySchema,
  CatalogResponseSchema,
  LedgerQuerySchema,
  LedgerResponseSchema,
  RedemptionCreateResponseSchema,
  RedemptionCreateSchema,
  RedemptionDecisionSchema,
  RedemptionIdParamSchema,
  RedemptionResponseSchema,
  RedemptionsQuerySchema,
  RedemptionsResponseSchema,
  RewardRulesPatchSchema,
  RewardRulesResponseSchema,
  StudentIdParamSchema,
  WalletSchema,
  type CatalogItem,
} from './schemas.ts';

const PARENT_OR_CHILD = [...PARENT, ...CHILD];
const notifier = new OutboxPushNotifier();

// --- Route definitions ----------------------------------------------------------------------------

const walletRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/rewards/wallet',
  tags: ['rewards'],
  summary: 'A child’s wallet: XP, level, Coin and today’s cap bar',
  description:
    'Lifetime XP and level, spendable Coin (held Coin of pending redemptions excluded) with its nominal VND value (display only), and today’s cap bar: rewardable XP of the household-local day, the cap of the weekday or of the weekend tier reached so far, and the Coin the day would convert to at day end. Parent: any child of the household; child: only their own id. Other ids answer 404.',
  security: PARENT_OR_CHILD,
  request: { params: StudentIdParamSchema },
  responses: {
    200: json(WalletSchema, 'Wallet'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const ledgerRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/rewards/ledger',
  tags: ['rewards'],
  summary: 'A child’s XP or Coin ledger, newest first',
  description:
    'Append-only entries: XP grants (with `cappedReason` when part of it counts toward lifetime XP only) and reversals; Coin day conversions, redemption holds and reversals. Cursor pagination. Parent or the child themself; others 404.',
  security: PARENT_OR_CHILD,
  request: { params: StudentIdParamSchema, query: LedgerQuerySchema },
  responses: {
    200: json(LedgerResponseSchema, 'Ledger page'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const rulesRoute = createRoute({
  method: 'get',
  path: '/v1/household/reward-rules',
  tags: ['rewards'],
  summary: 'Reward rules in force, with the system caps',
  description:
    'The household’s rules (or the system default), the defaults and the product safety caps (Master Spec §14.2). Parent only.',
  security: PARENT,
  responses: {
    200: json(RewardRulesResponseSchema, 'Rules'),
    ...errorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const rulesPatchRoute = createRoute({
  method: 'patch',
  path: '/v1/household/reward-rules',
  tags: ['rewards'],
  summary: 'Change the reward rules (stricter only)',
  description:
    'Parent only. Caps may be lowered, never raised above the system caps (400 with `details.violations`, e.g. ABOVE_SYSTEM_CAP); weekend tier caps must not decrease from tier to tier. Each change stores a new version; settled days keep their Coin. Audited.',
  security: PARENT,
  request: body(RewardRulesPatchSchema),
  responses: {
    200: json(RewardRulesResponseSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const catalogRoute = createRoute({
  method: 'get',
  path: '/v1/household/reward-catalog',
  tags: ['rewards'],
  summary: 'The household’s reward catalog',
  description:
    'Parent: every item (`includeArchived=true` adds archived ones); child: the active items of their household.',
  security: PARENT_OR_CHILD,
  request: { query: CatalogQuerySchema },
  responses: {
    200: json(CatalogResponseSchema, 'Catalog'),
    ...errorResponses('UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const catalogCreateRoute = createRoute({
  method: 'post',
  path: '/v1/household/reward-catalog',
  tags: ['rewards'],
  summary: 'Add a catalog reward',
  security: PARENT,
  request: body(CatalogItemCreateSchema),
  responses: {
    201: json(CatalogItemResponseSchema, 'Created'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const catalogUpdateRoute = createRoute({
  method: 'patch',
  path: '/v1/household/reward-catalog/{itemId}',
  tags: ['rewards'],
  summary: 'Change or archive a catalog reward',
  description: 'Parent only. Pending redemptions keep the title and cost they were asked with.',
  security: PARENT,
  request: { params: CatalogItemIdParamSchema, ...body(CatalogItemUpdateSchema) },
  responses: {
    200: json(CatalogItemResponseSchema, 'Updated'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const catalogDeleteRoute = createRoute({
  method: 'delete',
  path: '/v1/household/reward-catalog/{itemId}',
  tags: ['rewards'],
  summary: 'Remove a catalog reward (archived, so its redemptions stay)',
  security: PARENT,
  request: { params: CatalogItemIdParamSchema },
  responses: {
    204: { description: 'Archived' },
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const redemptionsRoute = createRoute({
  method: 'get',
  path: '/v1/reward-redemptions',
  tags: ['rewards'],
  summary: 'Redemptions: the parent inbox, or the child’s own',
  description:
    'Parent: the household’s redemptions, pending first (up to 100), `pendingCount` drives the badge; child: their own.',
  security: PARENT_OR_CHILD,
  request: { query: RedemptionsQuerySchema },
  responses: {
    200: json(RedemptionsResponseSchema, 'Redemptions'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED'),
  },
});

const redeemRoute = createRoute({
  method: 'post',
  path: '/v1/reward-redemptions',
  tags: ['rewards'],
  summary: 'The child asks for a catalog reward',
  description:
    'Child actor. Idempotent by `clientUuid` (a retry returns the stored request with `replayed: true`; 409 if the UUID was used for another item). The cost is held from the Coin balance at once (409 `INSUFFICIENT_COINS` or `ITEM_ARCHIVED`); the parents get a push request.',
  security: CHILD,
  request: body(RedemptionCreateSchema),
  responses: {
    200: json(RedemptionCreateResponseSchema, 'Requested (or replayed)'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const approveRedemptionRoute = createRoute({
  method: 'post',
  path: '/v1/reward-redemptions/{id}/approve',
  tags: ['rewards'],
  summary: 'Approve a redemption',
  description:
    'Parent only; 409 unless pending. The held Coin is spent. Emits `reward.redeemed` (RewardRedeemed). Audited.',
  security: PARENT,
  request: { params: RedemptionIdParamSchema, ...body(RedemptionDecisionSchema, false) },
  responses: {
    200: json(RedemptionResponseSchema, 'Approved'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const rejectRedemptionRoute = createRoute({
  method: 'post',
  path: '/v1/reward-redemptions/{id}/reject',
  tags: ['rewards'],
  summary: 'Reject a redemption',
  description:
    'Parent only, with an optional note; 409 unless pending. The held Coin returns to the child through a reversal entry. Audited.',
  security: PARENT,
  request: { params: RedemptionIdParamSchema, ...body(RedemptionDecisionSchema, false) },
  responses: {
    200: json(RedemptionResponseSchema, 'Rejected'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

// --- Mapping ----------------------------------------------------------------------------------------

function toItem(row: repo.CatalogRow): CatalogItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    costCoins: row.cost_coins,
    icon: row.icon,
    status: row.status,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function toRedemption(row: repo.RedemptionRow) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.display_name,
    itemId: row.item_id,
    title: row.title,
    costCoins: row.cost_coins,
    status: row.status,
    requestedAt: iso(row.requested_at)!,
    decidedAt: iso(row.decided_at),
    decisionNote: row.decision_note,
  };
}

function encodeCursor(row: repo.LedgerRow): string {
  return btoa(`${new Date(row.created_at).toISOString()}|${row.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeCursor(value: string): repo.LedgerCursor {
  try {
    const [at, id] = atob(value.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    const createdAt = new Date(at ?? '');
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new Error();
    return { createdAt, id: id! };
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Invalid cursor', { field: 'cursor' });
  }
}

const REDEMPTION_MESSAGES: Record<RedemptionRequestError, string> = {
  ITEM_ARCHIVED: 'This reward is no longer offered',
  INSUFFICIENT_COINS: 'Not enough Coin yet',
};

// --- Handlers --------------------------------------------------------------------------------------

export function registerRewardRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  /** Parent → their households; child → their own household, only for their own id. */
  async function readScope(actor: Actor, studentId: string): Promise<Scope> {
    const who = requireActor(actor, 'parent', 'child');
    if (who.kind === 'child') {
      if (who.childId !== studentId) throw new ApiError('NOT_FOUND', 'Student not found');
      return scoped(sql, [who.householdId]);
    }
    return scopeFor(sql, who);
  }

  async function studentOr404(scope: Scope, id: string) {
    const student = await repo.rewardStudent(sql, scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return student;
  }

  /** The parent's household (OWNER first), as GET /v1/household. */
  async function parentHousehold(actor: Actor) {
    const parent = requireActor(actor, 'parent');
    const [household] = await parentHouseholds(sql, parent.userId);
    if (!household) throw new ApiError('NOT_FOUND', 'No household yet');
    return {
      parent,
      householdId: household.householdId,
      scope: scoped(sql, [household.householdId]),
    };
  }

  async function rulesBody(
    householdId: string,
  ): Promise<z.infer<typeof RewardRulesResponseSchema>> {
    const caps = await loadSystemCaps(sql);
    const inForce = await loadRules(sql, householdId, caps);
    return {
      householdId,
      version: inForce.version,
      custom: inForce.version > 0,
      rules: inForce.rules,
      defaults: inForce.defaults,
      systemCaps: { ...caps, weekendTierCaps: [...caps.weekendTierCaps] },
      updatedAt: iso(inForce.updatedAt),
    };
  }

  // Wallet & ledger -------------------------------------------------------------------------------

  app.openapi(walletRoute, async (c) => {
    const { id } = c.req.valid('param');
    const scope = await readScope(c.get('actor'), id);
    const student = await studentOr404(scope, id);
    const today = householdToday(now(), student.timezone);
    const caps = await loadSystemCaps(sql);
    const [inForce, totals, todayXp, facts, last] = await Promise.all([
      loadRules(sql, student.household_id, caps),
      balances(sql, student.household_id, id),
      rewardableXpOn(sql, student.household_id, id, today),
      loadDayFacts(sql, student.household_id, id, today),
      repo.lastSettledDay(sql, scope, id),
    ]);
    return c.json(
      {
        studentId: id,
        timezone: student.timezone,
        today,
        lifetimeXp: totals.lifetimeXp,
        level: levelFor(totals.lifetimeXp),
        coinBalance: totals.coinBalance,
        coinsHeld: totals.coinsHeld,
        nominalVnd: nominalVnd(totals.coinBalance, caps),
        xpPerCoin: caps.xpPerCoin,
        todayCap: capView({
          day: today,
          facts,
          rules: inForce.rules,
          caps,
          rewardableXp: todayXp.rewardable,
        }),
        lastSettled: last
          ? {
              day: last.local_day,
              tier: last.tier,
              capCoins: last.cap_coins,
              rewardableXp: last.rewardable_xp,
              coinsTotal: last.coins_total,
              settledAt: iso(last.settled_at)!,
            }
          : null,
      },
      200,
    );
  });

  app.openapi(ledgerRoute, async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const scope = await readScope(c.get('actor'), id);
    await studentOr404(scope, id);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const read = query.kind === 'xp' ? repo.xpLedger : repo.coinLedger;
    const rows = await read(sql, scope, id, query.limit + 1, cursor);
    const page = rows.slice(0, query.limit);
    return c.json(
      {
        studentId: id,
        kind: query.kind,
        entries: page.map((r) => ({
          id: r.id,
          createdAt: iso(r.created_at)!,
          rewardDay: r.reward_day,
          entryKind: r.entry_kind,
          lifetimeXpDelta: r.lifetime_xp_delta,
          rewardableXpDelta: r.rewardable_xp_delta,
          coinDelta: r.coin_delta,
          sourceType: r.source_type,
          sourceId: r.source_id,
          ruleId: r.rule_id,
          cappedReason: r.capped_reason,
          reversalOf: r.reversal_of,
          label: r.label,
        })),
        nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
      },
      200,
    );
  });

  // Rules -----------------------------------------------------------------------------------------

  app.openapi(rulesRoute, async (c) => {
    const { householdId } = await parentHousehold(c.get('actor'));
    return c.json(await rulesBody(householdId), 200);
  });

  app.openapi(rulesPatchRoute, async (c) => {
    const { parent, householdId } = await parentHousehold(c.get('actor'));
    const patch = c.req.valid('json');
    const caps = await loadSystemCaps(sql);
    const current = await loadRules(sql, householdId, caps);
    const next = mergeRewardRules(current.rules, patch);
    const violations = validateRewardRules(next, caps);
    if (violations.length > 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Rules may be stricter than the system caps, never looser',
        {
          violations,
        },
      );
    }
    const requestId = c.get('requestId');
    await sql.begin(async (tx) => {
      const version = await repo.insertRules(tx, householdId, next, parent.userId);
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'reward.rules_updated',
        targetType: 'household',
        targetId: householdId,
        householdId,
        requestId,
        details: { version, fields: Object.keys(patch), rules: next },
      });
    });
    return c.json(await rulesBody(householdId), 200);
  });

  // Catalog ---------------------------------------------------------------------------------------

  app.openapi(catalogRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent', 'child');
    const query = c.req.valid('query');
    const householdId =
      actor.kind === 'child' ? actor.householdId : (await parentHousehold(actor)).householdId;
    const includeArchived = actor.kind === 'parent' && query.includeArchived === 'true';
    const [rows, caps] = await Promise.all([
      repo.catalog(sql, householdId, includeArchived),
      loadSystemCaps(sql),
    ]);
    return c.json({ items: rows.map(toItem), coinNominalVnd: caps.coinNominalVnd }, 200);
  });

  app.openapi(catalogCreateRoute, async (c) => {
    const { parent, householdId } = await parentHousehold(c.get('actor'));
    const input = c.req.valid('json');
    const requestId = c.get('requestId');
    const row = (await sql.begin(async (tx) => {
      const created = await repo.insertCatalogItem(tx, householdId, parent.userId, {
        title: input.title,
        description: input.description || null,
        cost_coins: input.costCoins,
        icon: (input.icon ?? 'gift') as CatalogIcon,
      });
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'reward.catalog_created',
        targetType: 'reward_catalog_item',
        targetId: created.id,
        householdId,
        requestId,
        details: { costCoins: created.cost_coins },
      });
      return created;
    })) as repo.CatalogRow;
    return c.json({ item: toItem(row) }, 201);
  });

  async function changeItem(
    actor: Actor,
    itemId: string,
    input: z.infer<typeof CatalogItemUpdateSchema>,
    requestId: string,
  ) {
    const { parent, householdId, scope } = await parentHousehold(actor);
    return (await sql.begin(async (tx) => {
      const current = await repo.catalogItem(tx, scope, itemId, true);
      if (!current) throw new ApiError('NOT_FOUND', 'Reward not found');
      const status =
        input.archived === undefined ? current.status : input.archived ? 'ARCHIVED' : 'ACTIVE';
      const row = (await repo.updateCatalogItem(tx, scope, itemId, {
        title: input.title ?? current.title,
        description:
          input.description === undefined ? current.description : input.description || null,
        cost_coins: input.costCoins ?? current.cost_coins,
        icon: (input.icon ?? current.icon) as CatalogIcon,
        status,
      }))!;
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action:
          status === 'ARCHIVED' && current.status !== 'ARCHIVED'
            ? 'reward.catalog_archived'
            : 'reward.catalog_updated',
        targetType: 'reward_catalog_item',
        targetId: itemId,
        householdId,
        requestId,
        details: { fields: Object.keys(input) },
      });
      return row;
    })) as repo.CatalogRow;
  }

  app.openapi(catalogUpdateRoute, async (c) => {
    const { itemId } = c.req.valid('param');
    const row = await changeItem(c.get('actor'), itemId, c.req.valid('json'), c.get('requestId'));
    return c.json({ item: toItem(row) }, 200);
  });

  app.openapi(catalogDeleteRoute, async (c) => {
    const { itemId } = c.req.valid('param');
    await changeItem(c.get('actor'), itemId, { archived: true }, c.get('requestId'));
    return c.body(null, 204);
  });

  // Redemptions -----------------------------------------------------------------------------------

  app.openapi(redemptionsRoute, async (c) => {
    const actor = requireActor(c.get('actor'), 'parent', 'child');
    const query = c.req.valid('query');
    const scope =
      actor.kind === 'child' ? scoped(sql, [actor.householdId]) : await scopeFor(sql, actor);
    const studentId = actor.kind === 'child' ? actor.childId : query.studentId;
    const [rows, pendingCount] = await Promise.all([
      repo.redemptions(sql, scope, { status: query.status, studentId }),
      repo.pendingRedemptionCount(sql, scope, studentId),
    ]);
    return c.json({ pendingCount, items: rows.map(toRedemption) }, 200);
  });

  app.openapi(redeemRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const input = c.req.valid('json');
    const scope = scoped(sql, [child.householdId]);

    const replay = async () => {
      const existing = await repo.redemptionByClientUuid(sql, input.clientUuid);
      if (!existing) return null;
      if (
        existing.household_id !== child.householdId ||
        existing.student_id !== child.childId ||
        existing.item_id !== input.itemId
      ) {
        throw new ApiError('CONFLICT', 'This clientUuid was used for another request', {
          reason: 'CLIENT_UUID_REUSED',
        });
      }
      return {
        redemption: toRedemption(existing),
        replayed: true,
        coinBalance: await repo.coinBalance(sql, child.householdId, child.childId),
      };
    };

    const replayed = await replay();
    if (replayed) return c.json(replayed, 200);
    const item = await repo.catalogItem(sql, scope, input.itemId);
    if (!item) throw new ApiError('NOT_FOUND', 'Reward not found');

    const outcome = (await sql.begin(async (tx) => {
      await lockStudentRewards(tx, child.childId);
      if (await repo.redemptionByClientUuid(tx, input.clientUuid)) return { replay: true as const };
      const balance = await repo.coinBalance(tx, child.householdId, child.childId);
      const check = canRequestRedemption({
        itemStatus: item.status,
        costCoins: item.cost_coins,
        balance,
      });
      if (!check.ok) {
        throw new ApiError('CONFLICT', REDEMPTION_MESSAGES[check.error], {
          reason: check.error,
          balance,
          costCoins: item.cost_coins,
        });
      }
      const redemptionId = await repo.insertRedemption(tx, {
        householdId: child.householdId,
        studentId: child.childId,
        itemId: item.id,
        clientUuid: input.clientUuid,
        title: item.title,
        costCoins: item.cost_coins,
      });
      if (!redemptionId) return { replay: true as const };
      const sourceType = LEDGER_SOURCE_TYPES.redemption;
      await repo.insertCoinEntry(tx, {
        householdId: child.householdId,
        studentId: child.childId,
        amount: -item.cost_coins,
        kind: 'REDEMPTION_HOLD',
        sourceType,
        sourceId: redemptionId,
        ruleId: COIN_RULE_IDS.redemption,
        key: ledgerKey(sourceType, redemptionId, COIN_RULE_IDS.redemption),
      });
      for (const userId of await householdParents(tx, child.householdId)) {
        await notifier.notify(tx, {
          userId,
          householdId: child.householdId,
          kind: 'reward.redemption_requested',
          data: { redemptionId, studentId: child.childId },
          idempotencyKey: `redemption:${redemptionId}:${userId}`,
        });
      }
      return { replay: false as const, redemptionId, balance: balance - item.cost_coins };
    })) as { replay: true } | { replay: false; redemptionId: string; balance: number };

    if (outcome.replay) return c.json((await replay())!, 200);
    const row = await repo.redemption(sql, scope, outcome.redemptionId);
    return c.json(
      { redemption: toRedemption(row!), replayed: false, coinBalance: outcome.balance },
      200,
    );
  });

  async function decideRedemption(
    actor: Actor,
    id: string,
    note: string | undefined,
    decision: 'APPROVED' | 'REJECTED',
    requestId: string,
  ) {
    const parent = requireActor(actor, 'parent');
    const scope = await scopeFor(sql, parent);
    const current = await repo.redemption(sql, scope, id);
    if (!current) throw new ApiError('NOT_FOUND', 'Redemption not found');
    await sql.begin(async (tx) => {
      await lockStudentRewards(tx, current.student_id);
      const row = (await repo.redemption(tx, scope, id, true))!;
      const check = canDecideRedemption(row.status);
      if (!check.ok) {
        throw new ApiError('CONFLICT', 'This request was already decided', {
          reason: check.error,
          status: row.status,
        });
      }
      await repo.decideRedemption(tx, id, {
        status: decision,
        by: parent.userId,
        note: note?.trim() || null,
      });
      if (decision === 'REJECTED') {
        // The held Coin comes back through a reversal entry (ledgers are append-only).
        const hold = await repo.redemptionHold(tx, id);
        if (hold && !hold.reversed_by) {
          const sourceType = LEDGER_SOURCE_TYPES.reversal;
          await repo.insertCoinEntry(tx, {
            householdId: row.household_id,
            studentId: row.student_id,
            amount: reverseCoins(hold.amount),
            kind: 'REVERSAL',
            sourceType,
            sourceId: hold.id,
            ruleId: COIN_RULE_IDS.reversal,
            key: ledgerKey(sourceType, hold.id, COIN_RULE_IDS.reversal),
            reversalOf: hold.id,
          });
        }
      } else {
        await writeEvent(tx, {
          type: REWARD_EVENT_TYPES.redeemed,
          householdId: row.household_id,
          aggregateType: 'reward_redemption',
          aggregateId: id,
          payload: {
            eventName: REWARD_EVENT_NAMES['reward.redeemed'],
            actorType: 'parent',
            actorId: parent.userId,
            studentId: row.student_id,
            redemptionId: id,
            itemId: row.item_id,
            costCoins: row.cost_coins,
          },
          idempotencyKey: id,
        });
      }
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action:
          decision === 'APPROVED' ? 'reward.redemption_approved' : 'reward.redemption_rejected',
        targetType: 'reward_redemption',
        targetId: id,
        householdId: row.household_id,
        requestId,
        details: { studentId: row.student_id, costCoins: row.cost_coins },
      });
    });
    const row = await repo.redemption(sql, scope, id);
    return { redemption: toRedemption(row!) };
  }

  app.openapi(approveRedemptionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await decideRedemption(c.get('actor'), id, input?.note, 'APPROVED', c.get('requestId')),
      200,
    );
  });

  app.openapi(rejectRedemptionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    return c.json(
      await decideRedemption(c.get('actor'), id, input?.note, 'REJECTED', c.get('requestId')),
      200,
    );
  });
}
