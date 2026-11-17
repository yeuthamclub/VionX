// M07 Today planner (TASK_PACKS/M07.md, Master Spec §11). The plan is derived data: every route
// answers from one regeneration (regenerate.ts), so pins, skips and facts never drift apart.
import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import type { ErrorCode } from '@vionx/contracts';
import {
  canCompleteItem,
  canSkip,
  canStart,
  householdToday,
  isTaskKind,
  type PlanActionError,
  type PlanItemStatus,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import type { TxSql } from '../../_shared/db.ts';
import { ApiError } from '../../_shared/errors.ts';
import { scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { writeAudit } from '../identity/repo.ts';
import { learningStudent } from '../learning/repo.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import {
  loadPlannerConfig,
  planIsStale,
  regenerateToday,
  storedPlan,
  type ItemRow,
  type StoredPlan,
} from './regenerate.ts';
import {
  TodayItemCompleteSchema,
  TodayItemIdParamSchema,
  TodayItemPinSchema,
  TodayItemRemoveSchema,
  TodayItemResponseSchema,
  TodayResponseSchema,
  TodaySettingsSchema,
  TodayStudentIdParamSchema,
} from './schemas.ts';

const PARENT_OR_CHILD = [...PARENT, ...CHILD];
const READ_ERRORS = errorResponses(
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
);
const ITEM_ERRORS = errorResponses(
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
);

const todayRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/today',
  tags: ['planner'],
  summary: 'Today plan of a child',
  description:
    'Parent: any child of the household (sees removed items too); child: only their own id (others 404). Items are ordered: pinned first, then by priority (§11: urgency + prerequisite gap + forgetting risk + curriculum importance + exam relevance + parent priority − recent workload), each with `reasons[]`. The plan is written at day start and regenerated when a task, an exam, the timetable, a finished session or a skill state changed since, so a finished session shows without a manual recalculation.',
  security: PARENT_OR_CHILD,
  request: { params: TodayStudentIdParamSchema },
  responses: { 200: json(TodayResponseSchema, 'Today'), ...READ_ERRORS },
});

const recalculateRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/today/recalculate',
  tags: ['planner'],
  summary: 'Regenerate the Today plan now',
  description:
    'Parent or the child themself. Pins, removals and skips of the day are kept. `version` grows only when the plan changed.',
  security: PARENT_OR_CHILD,
  request: { params: TodayStudentIdParamSchema },
  responses: { 200: json(TodayResponseSchema, 'Today'), ...READ_ERRORS },
});

const settingsRoute = createRoute({
  method: 'put',
  path: '/v1/students/{id}/today/settings',
  tags: ['planner'],
  summary: 'Minutes a day for Today',
  description:
    'Parent only. `dailyMinutes: null` returns to the default of the grade (3 sessions). The budget is never above the free time left by school and calendar events. Audited.',
  security: PARENT,
  request: { params: TodayStudentIdParamSchema, ...body(TodaySettingsSchema) },
  responses: { 200: json(TodayResponseSchema, 'Today with the new budget'), ...READ_ERRORS },
});

const itemRoute = (action: 'start' | 'skip', summary: string, description: string) =>
  createRoute({
    method: 'post',
    path: `/v1/today-items/{id}/${action}`,
    tags: ['planner'],
    summary,
    description,
    security: CHILD,
    request: { params: TodayItemIdParamSchema },
    responses: { 200: json(TodayItemResponseSchema, 'Item and the plan'), ...ITEM_ERRORS },
  });

const startRoute = itemRoute(
  'start',
  'Start a Today item',
  'Child actor, own items of today. Marks the item STARTED. A learning item is then opened with POST /v1/learning/sessions using `link` (`mode`, `skillIds`, `subject`); it becomes DONE when a session covering it finishes (SYSTEM_VERIFIED).',
);
const skipRoute = itemRoute(
  'skip',
  'Skip a Today item for today',
  'Child actor, own open items of today. Required tasks cannot be skipped (409 REQUIRED_ITEM). The item stays in the plan as SKIPPED and can still be started.',
);

const completeRoute = createRoute({
  method: 'post',
  path: '/v1/today-items/{id}/complete',
  tags: ['planner'],
  summary: 'Complete a task item of Today',
  description:
    'Child actor. For task items this is POST /v1/tasks/{id}/complete for today (same rules, same idempotency by `clientUuid`, same errors). Learning items are completed by the system when a session finishes: 409 SYSTEM_VERIFIED_ONLY.',
  security: CHILD,
  request: { params: TodayItemIdParamSchema, ...body(TodayItemCompleteSchema) },
  responses: { 200: json(TodayItemResponseSchema, 'Item and the plan'), ...ITEM_ERRORS },
});

const pinRoute = createRoute({
  method: 'post',
  path: '/v1/today-items/{id}/pin',
  tags: ['planner'],
  summary: 'Pin (or unpin) a Today item',
  description:
    'Parent only. A pinned item is listed first and always fits the budget. `pinned: false` unpins. Audited.',
  security: PARENT,
  request: { params: TodayItemIdParamSchema, ...body(TodayItemPinSchema, false) },
  responses: { 200: json(TodayItemResponseSchema, 'Item and the plan'), ...ITEM_ERRORS },
});

const removeRoute = createRoute({
  method: 'post',
  path: '/v1/today-items/{id}/remove',
  tags: ['planner'],
  summary: 'Remove an item from Today (or put it back)',
  description:
    'Parent only. The item is hidden from the child for the rest of the day; the task or skill itself is untouched. `removed: false` puts it back. Audited.',
  security: PARENT,
  request: { params: TodayItemIdParamSchema, ...body(TodayItemRemoveSchema, false) },
  responses: { 200: json(TodayItemResponseSchema, 'Item and the plan'), ...ITEM_ERRORS },
});

const ACTION_MESSAGES: Record<PlanActionError, string> = {
  NOT_OPEN: 'This item is not open',
  SYSTEM_VERIFIED_ONLY: 'Learning items are completed by finishing a session',
  REQUIRED_ITEM: 'A required task cannot be skipped',
  REMOVED_ITEM: 'This item was removed from Today',
};
const actionError = (reason: PlanActionError) =>
  new ApiError('CONFLICT', ACTION_MESSAGES[reason], { reason });

function toItem(r: ItemRow): z.infer<typeof TodayResponseSchema>['items'][number] {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    subject: r.subject,
    minutes: r.minutes,
    priority: Number(r.priority),
    reasons: r.reasons,
    status: r.status,
    pinned: r.pinned,
    required: r.required,
    inBudget: r.in_budget,
    rewardXp: r.reward_xp,
    link: r.link,
    detail: r.detail,
  };
}

function toToday(
  { plan, items }: StoredPlan,
  viewer: Actor['kind'],
): z.infer<typeof TodayResponseSchema> {
  // A child never sees what the parent removed.
  const visible = viewer === 'child' ? items.filter((i) => i.status !== 'REMOVED') : items;
  const sum = (rows: ItemRow[]) => rows.reduce((n, i) => n + i.minutes, 0);
  return {
    studentId: plan.student_id,
    localDate: plan.local_date,
    version: plan.version,
    generatedAt: iso(plan.generated_at)!,
    budgetMinutes: plan.budget_minutes,
    freeMinutes: plan.free_minutes,
    sessionMinutes: plan.session_minutes,
    dailyMinutes: plan.daily_minutes,
    plannedMinutes: sum(
      items.filter((i) => (i.status === 'PLANNED' || i.status === 'STARTED') && i.in_budget),
    ),
    doneMinutes: sum(items.filter((i) => i.status === 'DONE' || i.status === 'PENDING_APPROVAL')),
    items: visible.map(toItem),
  };
}

export function registerPlannerRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
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
    const student = await learningStudent(sql, scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return student;
  }

  const regenerate = async (householdId: string, studentId: string, at: Date) =>
    (await sql.begin((tx) => regenerateToday(tx, householdId, studentId, at)))!;

  app.openapi(todayRoute, async (c) => {
    const { id } = c.req.valid('param');
    const actor = c.get('actor');
    const student = await studentOr404(await readScope(actor, id), id);
    const at = now();
    const today = householdToday(at, student.timezone);
    let stored = await storedPlan(sql, student.household_id, id, today);
    if (!stored || (await planIsStale(sql, stored.plan, await loadPlannerConfig(sql), at))) {
      stored = await regenerate(student.household_id, id, at);
    }
    return c.json(toToday(stored, actor.kind), 200);
  });

  app.openapi(recalculateRoute, async (c) => {
    const { id } = c.req.valid('param');
    const actor = c.get('actor');
    const student = await studentOr404(await readScope(actor, id), id);
    return c.json(toToday(await regenerate(student.household_id, id, now()), actor.kind), 200);
  });

  app.openapi(settingsRoute, async (c) => {
    const parent = requireActor(c.get('actor'), 'parent');
    const { id } = c.req.valid('param');
    const { dailyMinutes } = c.req.valid('json');
    const student = await studentOr404(await scopeFor(sql, parent), id);
    const requestId = c.get('requestId');
    const stored = await sql.begin(async (tx) => {
      await tx`
        insert into app.planner_settings (student_id, household_id, daily_minutes)
        values (${id}, ${student.household_id}, ${dailyMinutes})
        on conflict (student_id) do update set daily_minutes = excluded.daily_minutes`;
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'planner.settings_updated',
        targetType: 'student',
        targetId: id,
        householdId: student.household_id,
        requestId,
        details: { dailyMinutes },
      });
      return (await regenerateToday(tx, student.household_id, id, now()))!;
    });
    return c.json(toToday(stored, 'parent'), 200);
  });

  /**
   * One item action: the item must be in the actor's scope and belong to today's plan. `change`
   * returns the new stored status/pin; the plan is then regenerated in the same transaction.
   */
  async function act(
    actor: Extract<Actor, { kind: 'parent' | 'child' }>,
    itemId: string,
    change: (item: ItemRow, tx: TxSql) => Promise<{ status?: PlanItemStatus; pinned?: boolean }>,
  ): Promise<z.infer<typeof TodayItemResponseSchema>> {
    const scope = await scopeFor(sql, actor);
    const at = now();
    return sql.begin(async (tx) => {
      const [item] = await tx<(ItemRow & { local_date: string; timezone: string })[]>`
        select i.*, p.local_date::text as local_date, h.timezone
        from app.today_plan_items i
        join app.today_plans p on p.id = i.plan_id
        join app.households h on h.id = i.household_id
        where i.id = ${itemId} and ${scope.where('i.household_id')}
        for update of i`;
      if (!item || (actor.kind === 'child' && item.student_id !== actor.childId)) {
        throw new ApiError('NOT_FOUND', 'Today item not found');
      }
      if (item.local_date !== householdToday(at, item.timezone)) {
        throw new ApiError('CONFLICT', 'This item belongs to another day', { reason: 'NOT_TODAY' });
      }
      const next = await change(item, tx);
      await tx`
        update app.today_plan_items
        set status = ${next.status ?? item.status}, pinned = ${next.pinned ?? item.pinned}
        where id = ${item.id}`;
      const stored = (await regenerateToday(tx, item.household_id, item.student_id, at))!;
      const after = stored.items.find((i) => i.id === item.id);
      if (!after) throw new ApiError('NOT_FOUND', 'Today item not found');
      return { item: toItem(after), today: toToday(stored, actor.kind) };
    });
  }

  app.openapi(startRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const out = await act(child, c.req.valid('param').id, async (item) => {
      const error = canStart(item);
      if (error) throw actionError(error);
      return { status: 'STARTED' };
    });
    return c.json(out, 200);
  });

  app.openapi(skipRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const out = await act(child, c.req.valid('param').id, async (item) => {
      const error = canSkip(item);
      if (error) throw actionError(error);
      return { status: 'SKIPPED' };
    });
    return c.json(out, 200);
  });

  app.openapi(completeRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const [item] = await sql<ItemRow[]>`
      select * from app.today_plan_items
      where id = ${id} and household_id = ${child.householdId} and student_id = ${child.childId}`;
    if (!item) throw new ApiError('NOT_FOUND', 'Today item not found');
    const error = canCompleteItem(item);
    // A replayed clientUuid is answered by the task route even when the item is already done.
    if (error && !(error === 'NOT_OPEN' && isTaskKind(item.kind))) throw actionError(error);
    if (item.link.type !== 'TASK') throw actionError('SYSTEM_VERIFIED_ONLY');

    // The task route owns completion (proof checks, idempotency, events, notifications).
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(
      /\/v1\/today-items\/.*$/,
      `/v1/tasks/${item.link.taskId}/complete`,
    );
    const res = await app.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vionx-child-session': c.req.header('x-vionx-child-session') ?? '',
      },
      body: JSON.stringify(input),
    });
    if (res.status !== 200) {
      const failed = (await res.json()) as { code: ErrorCode; message: string; details?: unknown };
      throw new ApiError(failed.code, failed.message, failed.details);
    }
    // Reads the new task status into the plan (no stored change of its own).
    const out = await act(child, id, async () => ({}));
    return c.json(out, 200);
  });

  /** Parent decisions: audited, kept for the day. */
  async function decide(
    ctx: { actor: Actor; requestId: string },
    itemId: string,
    action: string,
    change: (item: ItemRow) => { status?: PlanItemStatus; pinned?: boolean },
  ) {
    const parent = requireActor(ctx.actor, 'parent');
    return act(parent, itemId, async (item, tx) => {
      const next = change(item);
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action,
        targetType: 'today_item',
        targetId: item.id,
        householdId: item.household_id,
        requestId: ctx.requestId,
        details: { studentId: item.student_id, kind: item.kind, refKey: item.ref_key, ...next },
      });
      return next;
    });
  }

  app.openapi(pinRoute, async (c) => {
    const pinned = c.req.valid('json').pinned ?? true;
    const ctx = { actor: c.get('actor'), requestId: c.get('requestId') };
    const out = await decide(ctx, c.req.valid('param').id, 'planner.item_pinned', () => ({
      pinned,
    }));
    return c.json(out, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const removed = c.req.valid('json').removed ?? true;
    const ctx = { actor: c.get('actor'), requestId: c.get('requestId') };
    const out = await decide(ctx, c.req.valid('param').id, 'planner.item_removed', (item) => {
      if (removed) return { status: 'REMOVED' };
      // Putting back: open again; facts (done, waiting) are read by the regeneration.
      return item.status === 'REMOVED' ? { status: 'PLANNED' } : {};
    });
    return c.json(out, 200);
  });
}
