// M04 reward engine schemas (TASK_PACKS/M04.md, Master Spec §14). Rules live in @vionx/domain.
import { z } from '@hono/zod-openapi';
import {
  CATALOG_ICONS,
  CATALOG_ITEM_STATUSES,
  COIN_ENTRY_KINDS,
  isValidDay,
  MAX_CATALOG_COST_COINS,
  MAX_WEEKEND_GOAL,
  REDEMPTION_STATUSES,
  XP_CAPPED_REASONS,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDay, 'Not a calendar date')
  .openapi({ example: '2026-10-14', description: 'Household-local day (YYYY-MM-DD).' });
const Coins = z.int().min(0);
const TierCaps = z.tuple([Coins, Coins, Coins, Coins]).openapi({
  description: 'Weekend tier caps 0-3 in Coin (Master Spec §14.2).',
  example: [20, 30, 40, 50],
});

export const RedemptionStatusSchema = z.enum(REDEMPTION_STATUSES).openapi('RedemptionStatus');
export const CatalogItemStatusSchema = z.enum(CATALOG_ITEM_STATUSES).openapi('CatalogItemStatus');
export const CatalogIconSchema = z.enum(CATALOG_ICONS).openapi('CatalogIcon');

// --- Rules ----------------------------------------------------------------------------------------
export const SystemCapsSchema = z
  .object({
    xpPerCoin: z.int(),
    coinNominalVnd: z.int(),
    weekdayCapCoins: z.int(),
    weekendTierCaps: TierCaps,
    weekendMaxCoins: z.int(),
    maxGrantsPerRulePerDay: z.int(),
    lateGrantDays: z.int(),
  })
  .openapi('SystemCaps', {
    description: 'Product safety caps. Household rules may be stricter, never looser.',
  });

export const RewardRulesConfigSchema = z
  .object({
    weekdayCapCoins: Coins.openapi({ description: 'Monday-Friday cap (≤ system cap).' }),
    weekendTierCaps: TierCaps,
    weekendGoals: z.object({
      readingTasks: z.int().min(1).max(MAX_WEEKEND_GOAL).openapi({
        description: 'Completed READING tasks needed for weekend Tier 2.',
      }),
      activityTasks: z.int().min(1).max(MAX_WEEKEND_GOAL).openapi({
        description: 'Completed SPORT tasks needed for weekend Tier 2.',
      }),
    }),
    micro: z.object({
      TASK_APPROVED: z.object({
        maxGrantsPerDay: z.int().min(1).openapi({
          description: 'Micro-action cap: approved tasks that give XP per child per day.',
        }),
      }),
    }),
  })
  .openapi('RewardRulesConfig');

export const RewardRulesPatchSchema = z
  .object({
    weekdayCapCoins: Coins.optional(),
    weekendTierCaps: TierCaps.optional(),
    weekendGoals: z
      .object({
        readingTasks: z.int().min(1).max(MAX_WEEKEND_GOAL).optional(),
        activityTasks: z.int().min(1).max(MAX_WEEKEND_GOAL).optional(),
      })
      .optional(),
    micro: z
      .object({ TASK_APPROVED: z.object({ maxGrantsPerDay: z.int().min(1) }).optional() })
      .optional(),
  })
  .openapi('RewardRulesPatch');

export const RewardRulesResponseSchema = z
  .object({
    householdId: Uuid,
    version: z
      .int()
      .openapi({ description: 'Version of the rules in force (0 = system default).' }),
    custom: z.boolean().openapi({ description: 'The household changed the defaults.' }),
    rules: RewardRulesConfigSchema,
    defaults: RewardRulesConfigSchema,
    systemCaps: SystemCapsSchema,
    updatedAt: DateTime.nullable(),
  })
  .openapi('RewardRulesResponse');

// --- Wallet ----------------------------------------------------------------------------------------
export const LevelInfoSchema = z
  .object({
    level: z.int(),
    levelStartXp: z.int(),
    nextLevelXp: z.int(),
    xpIntoLevel: z.int(),
    xpForNextLevel: z.int(),
  })
  .openapi('LevelInfo');

export const CapViewSchema = z
  .object({
    day: Day,
    weekend: z.boolean(),
    tier: z.int().min(0).max(3).nullable().openapi({ description: 'Weekend tier reached so far.' }),
    capCoins: z.int(),
    maxCapCoins: z
      .int()
      .openapi({ description: 'Highest cap the day can reach (top weekend tier).' }),
    rewardableXp: z.int(),
    capXp: z.int(),
    projectedCoins: z.int(),
    reached: z.boolean(),
  })
  .openapi('CapView', { description: 'Today’s cap bar: Coin the day converts to at day end.' });

export const SettledDaySchema = z
  .object({
    day: Day,
    tier: z.int().nullable(),
    capCoins: z.int(),
    rewardableXp: z.int(),
    coinsTotal: z.int(),
    settledAt: DateTime,
  })
  .openapi('SettledDay');

export const WalletSchema = z
  .object({
    studentId: Uuid,
    timezone: z.string(),
    today: Day,
    lifetimeXp: z.int(),
    level: LevelInfoSchema,
    coinBalance: z.int().openapi({ description: 'Coin the child can spend (held Coin excluded).' }),
    coinsHeld: z.int().openapi({ description: 'Coin held by redemptions waiting for a parent.' }),
    nominalVnd: z.int().openapi({ description: 'coinBalance × 1,000 VND, display only.' }),
    xpPerCoin: z.int(),
    todayCap: CapViewSchema,
    lastSettled: SettledDaySchema.nullable(),
  })
  .openapi('Wallet');

// --- Ledger ----------------------------------------------------------------------------------------
export const LedgerQuerySchema = z.object({
  kind: z
    .enum(['coin', 'xp'])
    .default('coin')
    .openapi({ param: { name: 'kind', in: 'query' }, description: 'Which ledger (default coin).' }),
  cursor: z
    .string()
    .max(200)
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      description: '`nextCursor` of the previous page.',
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ param: { name: 'limit', in: 'query' } }),
});

export const LedgerEntrySchema = z
  .object({
    id: Uuid,
    createdAt: DateTime,
    rewardDay: Day.nullable(),
    entryKind: z.string().openapi({
      description: `XP: GRANT or REVERSAL. Coin: ${COIN_ENTRY_KINDS.join(', ')}.`,
    }),
    lifetimeXpDelta: z.int().nullable(),
    rewardableXpDelta: z.int().nullable(),
    coinDelta: z.int().nullable(),
    sourceType: z.string(),
    sourceId: Uuid,
    ruleId: z.string(),
    cappedReason: z.enum(XP_CAPPED_REASONS).nullable(),
    reversalOf: Uuid.nullable(),
    label: z.string().nullable().openapi({ description: 'Task or reward title, when known.' }),
  })
  .openapi('LedgerEntry');

export const LedgerResponseSchema = z
  .object({
    studentId: Uuid,
    kind: z.enum(['coin', 'xp']),
    entries: z.array(LedgerEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .openapi('LedgerResponse');

// --- Catalog ---------------------------------------------------------------------------------------
export const CatalogItemSchema = z
  .object({
    id: Uuid,
    title: z.string(),
    description: z.string().nullable(),
    costCoins: z.int(),
    icon: CatalogIconSchema,
    status: CatalogItemStatusSchema,
    createdAt: DateTime,
    updatedAt: DateTime,
  })
  .openapi('CatalogItem');
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .openapi({ param: { name: 'includeArchived', in: 'query' }, description: 'Parent only.' }),
});

export const CatalogResponseSchema = z
  .object({ items: z.array(CatalogItemSchema), coinNominalVnd: z.int() })
  .openapi('CatalogResponse');

export const CatalogItemCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().optional(),
    costCoins: z.int().min(1).max(MAX_CATALOG_COST_COINS),
    icon: CatalogIconSchema.optional(),
  })
  .openapi('CatalogItemCreate');

export const CatalogItemUpdateSchema = CatalogItemCreateSchema.partial()
  .extend({ archived: z.boolean().optional() })
  .openapi('CatalogItemUpdate');

export const CatalogItemResponseSchema = z
  .object({ item: CatalogItemSchema })
  .openapi('CatalogItemResponse');

export const CatalogItemIdParamSchema = z.object({
  itemId: Uuid.openapi({ param: { name: 'itemId', in: 'path' } }),
});

// --- Redemptions -----------------------------------------------------------------------------------
export const RedemptionSchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    studentName: z.string(),
    itemId: Uuid,
    title: z.string(),
    costCoins: z.int(),
    status: RedemptionStatusSchema,
    requestedAt: DateTime,
    decidedAt: DateTime.nullable(),
    decisionNote: z.string().nullable(),
  })
  .openapi('Redemption');

export const RedemptionCreateSchema = z
  .object({
    clientUuid: Uuid.openapi({
      description: 'Generated by the app per request; a retry with the same value is a no-op.',
    }),
    itemId: Uuid,
  })
  .openapi('RedemptionCreate');

export const RedemptionCreateResponseSchema = z
  .object({ redemption: RedemptionSchema, replayed: z.boolean(), coinBalance: z.int() })
  .openapi('RedemptionCreateResponse');

export const RedemptionDecisionSchema = z
  .object({ note: z.string().trim().max(300).optional() })
  .openapi('RedemptionDecision');

export const RedemptionResponseSchema = z
  .object({ redemption: RedemptionSchema })
  .openapi('RedemptionResponse');

export const RedemptionsQuerySchema = z.object({
  status: RedemptionStatusSchema.optional().openapi({ param: { name: 'status', in: 'query' } }),
  studentId: Uuid.optional().openapi({ param: { name: 'studentId', in: 'query' } }),
});

export const RedemptionsResponseSchema = z
  .object({
    pendingCount: z.int().openapi({ description: 'Redemptions waiting for a parent (badge).' }),
    items: z.array(RedemptionSchema),
  })
  .openapi('RedemptionsResponse');

export const RedemptionIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' } }),
});
