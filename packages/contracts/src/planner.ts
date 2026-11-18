// M07 Today planner schemas (TASK_PACKS/M07.md, Master Spec §11). Rules live in @vionx/domain
// (planner/).
import { z } from '@hono/zod-openapi';
import {
  PLAN_ITEM_KINDS,
  PLAN_ITEM_STATUSES,
  PLAN_REASON_CODES,
  VERIFICATION_MODES,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Params = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const PlanItemKindSchema = z.enum(PLAN_ITEM_KINDS).openapi('TodayItemKind');
export const PlanItemStatusSchema = z.enum(PLAN_ITEM_STATUSES).openapi('TodayItemStatus');

export const TodayStudentIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Student id.' }),
});
export const TodayItemIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Today item id.' }),
});

export const TodayReasonSchema = z
  .object({
    code: z.enum(PLAN_REASON_CODES),
    points: z.number().openapi({
      description: 'Points this term of the §11 formula adds to the priority (negative: takes).',
    }),
    params: Params.optional(),
  })
  .openapi('TodayReason');

export const TodayLinkSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('TASK'),
      taskId: Uuid,
      occurrenceId: Uuid,
      verificationMode: z.enum(VERIFICATION_MODES),
    }),
    z.object({
      type: z.literal('SESSION'),
      mode: z.enum(['PRACTICE', 'REVIEW']),
      skillIds: z.array(Uuid),
      subject: z.string(),
    }),
  ])
  .openapi('TodayLink', {
    description:
      'Where the item leads: a task to complete, or the body of POST /v1/learning/sessions.',
  });

export const TodayItemSchema = z
  .object({
    id: Uuid,
    kind: PlanItemKindSchema,
    title: z.string().openapi({ description: 'Task or skill title; empty for DUE_REVIEW.' }),
    subject: z.string().nullable().openapi({ description: 'Library subject, e.g. `math`.' }),
    minutes: z.int(),
    priority: z.number(),
    reasons: z.array(TodayReasonSchema).min(1),
    status: PlanItemStatusSchema,
    pinned: z.boolean(),
    required: z.boolean(),
    inBudget: z.boolean().openapi({ description: 'Fits in the minutes left today.' }),
    rewardXp: z.int().openapi({ description: 'Reward hint: XP this item can give at most.' }),
    link: TodayLinkSchema,
    detail: Params,
  })
  .openapi('TodayItem');
export type TodayItem = z.infer<typeof TodayItemSchema>;

export const TodayResponseSchema = z
  .object({
    studentId: Uuid,
    localDate: z.string().openapi({ example: '2026-11-17' }),
    version: z.int().openapi({ description: 'Grows by one each time the plan changes.' }),
    generatedAt: DateTime,
    budgetMinutes: z.int(),
    freeMinutes: z.int(),
    sessionMinutes: z.int().openapi({ description: 'Length of one learning item at this grade.' }),
    dailyMinutes: z.int().nullable().openapi({ description: 'Parent setting; null = default.' }),
    plannedMinutes: z.int().openapi({ description: 'Open items that fit in the budget.' }),
    doneMinutes: z.int(),
    items: z.array(TodayItemSchema),
  })
  .openapi('TodayResponse');
export type TodayResponse = z.infer<typeof TodayResponseSchema>;

export const TodayItemResponseSchema = z
  .object({ item: TodayItemSchema, today: TodayResponseSchema })
  .openapi('TodayItemResponse');

export const TodayItemCompleteSchema = z
  .object({
    clientUuid: Uuid,
    proofPath: z.string().max(300).optional(),
  })
  .openapi('TodayItemComplete', {
    description: 'Same body as POST /v1/tasks/{id}/complete (without `date`: always today).',
  });

export const TodayItemPinSchema = z
  .object({ pinned: z.boolean().optional() })
  .openapi('TodayItemPin');
export const TodayItemRemoveSchema = z
  .object({ removed: z.boolean().optional() })
  .openapi('TodayItemRemove');

export const TodaySettingsSchema = z
  .object({ dailyMinutes: z.int().min(10).max(480).nullable() })
  .openapi('TodaySettings');
