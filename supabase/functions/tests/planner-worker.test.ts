// M07 worker handlers: which events regenerate a child's Today plan, and the day-start job. The
// regeneration itself (database) is covered by tests/integration/planner.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxSql } from '../_shared/db.ts';
import type { DomainEvent } from '../_shared/queue.ts';

const planner = vi.hoisted(() => ({
  regenerateToday: vi.fn(async () => null),
  generateMissingPlans: vi.fn(async () => 0),
}));
const rewards = vi.hoisted(() => ({
  grantTaskXp: vi.fn(async () => ({ granted: false })),
  grantSessionXp: vi.fn(async () => ({ granted: false })),
  settleDueDays: vi.fn(async () => ({ settled: 0 })),
}));
const dashboard = vi.hoisted(() => ({ refreshDaySummaries: vi.fn(async () => {}) }));
vi.mock('../api/planner/regenerate.ts', () => planner);
vi.mock('../api/dashboard/build.ts', () => dashboard);
vi.mock('../_shared/rewards.ts', () => rewards);

const { createHandlers } = await import('../worker/handlers.ts');

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-17T03:00:00Z');

/** Records the statements a handler runs on its transaction. */
function fakeTx() {
  const statements: string[] = [];
  const tx = ((strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    return Promise.resolve([{ timezone: 'Asia/Ho_Chi_Minh' }]);
  }) as unknown as TxSql;
  (tx as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  return { tx, statements };
}

const event = (type: string, over: Partial<DomainEvent> = {}): DomainEvent => ({
  id: '33333333-3333-4333-8333-333333333333',
  type,
  householdId: HOUSEHOLD,
  aggregateType: null,
  aggregateId: null,
  payload: { studentId: STUDENT },
  occurredAt: '2026-11-17T02:00:00.000Z',
  ...over,
});

const handlers = createHandlers({ now: () => NOW } as Parameters<typeof createHandlers>[0]);

beforeEach(() => vi.clearAllMocks());

describe('Today regeneration on events', () => {
  it.each([
    'task.assigned',
    'task.completed',
    'task.approved',
    'task.rejected',
    'learning.session_finished',
  ])('%s regenerates the plan of the child in the event', async (type) => {
    const { tx } = fakeTx();
    await handlers[type]!(event(type), tx);
    expect(planner.regenerateToday).toHaveBeenCalledTimes(1);
    expect(planner.regenerateToday).toHaveBeenCalledWith(tx, HOUSEHOLD, STUDENT, NOW);
  });

  it('M08: also rebuilds the daily summary of today and of the task day', async () => {
    planner.regenerateToday.mockResolvedValue({ plan: { local_date: '2026-11-17' } } as never);
    const { tx } = fakeTx();
    await handlers['task.approved']!(
      event('task.approved', { payload: { studentId: STUDENT, date: '2026-11-16' } }),
      tx,
    );
    await handlers['learning.session_finished']!(event('learning.session_finished'), tx);
    const student = { id: STUDENT, household_id: HOUSEHOLD, timezone: 'Asia/Ho_Chi_Minh' };
    expect(dashboard.refreshDaySummaries.mock.calls).toEqual([
      [tx, student, ['2026-11-17', '2026-11-16']],
      [tx, student, ['2026-11-17']],
    ]);
    planner.regenerateToday.mockResolvedValue(null);
  });

  it('M08: writes no summary for a child that no longer exists', async () => {
    const { tx, statements } = fakeTx();
    await handlers['task.completed']!(event('task.completed'), tx);
    expect(dashboard.refreshDaySummaries).not.toHaveBeenCalled();
    expect(statements).toHaveLength(0);
  });

  it('keeps granting XP for approved tasks and finished sessions', async () => {
    const { tx } = fakeTx();
    await handlers['task.approved']!(event('task.approved'), tx);
    await handlers['task.completed']!(
      event('task.completed', { payload: { studentId: STUDENT, status: 'APPROVED' } }),
      tx,
    );
    await handlers['task.completed']!(
      event('task.completed', { payload: { studentId: STUDENT, status: 'PENDING_APPROVAL' } }),
      tx,
    );
    await handlers['learning.session_finished']!(event('learning.session_finished'), tx);
    expect(rewards.grantTaskXp).toHaveBeenCalledTimes(2);
    expect(rewards.grantSessionXp).toHaveBeenCalledTimes(1);
    expect(planner.regenerateToday).toHaveBeenCalledTimes(4);
  });

  it('ignores an event without a household or with a malformed student id', async () => {
    const { tx } = fakeTx();
    await handlers['task.assigned']!(event('task.assigned', { householdId: null }), tx);
    await handlers['task.assigned']!(
      event('task.assigned', { payload: { studentId: "x'; drop table" } }),
      tx,
    );
    await handlers['task.rejected']!(event('task.rejected', { payload: {} }), tx);
    expect(planner.regenerateToday).not.toHaveBeenCalled();
  });
});

describe('day start', () => {
  const type = 'planner.day_start_requested';

  it('generates the missing plans at the requested time and audits the count', async () => {
    planner.generateMissingPlans.mockResolvedValueOnce(3);
    const { tx, statements } = fakeTx();
    await handlers[type]!(event(type, { payload: { requestedAt: '2026-11-17T17:10:00Z' } }), tx);
    expect(planner.generateMissingPlans).toHaveBeenCalledWith(tx, new Date('2026-11-17T17:10:00Z'));
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('planner.day_started');
  });

  it('writes no audit row when every child already has a plan', async () => {
    const { tx, statements } = fakeTx();
    await handlers[type]!(event(type, { payload: { requestedAt: '2026-11-17T17:10:00Z' } }), tx);
    expect(statements).toHaveLength(0);
  });

  it('falls back to the event time when requestedAt is missing or invalid', async () => {
    const { tx } = fakeTx();
    await handlers[type]!(event(type, { payload: { requestedAt: 'not a date' } }), tx);
    await handlers[type]!(event(type, { payload: {} }), tx);
    expect(planner.generateMissingPlans.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      new Date('2026-11-17T02:00:00.000Z'),
      new Date('2026-11-17T02:00:00.000Z'),
    ]);
  });
});
