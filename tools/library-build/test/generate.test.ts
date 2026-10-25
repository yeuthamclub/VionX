import { describe, expect, it } from 'vitest';
import type { PackageItem } from '@vionx/domain';
import type { ItemRecord } from '../src/items.ts';
import type { PlanSlot } from '../src/lib/plan.ts';
import { pendingSlots } from '../src/steps/generate.ts';

const slot = (id: string): PlanSlot => ({
  id,
  skill: 'MATH.6.S',
  level: 'L2',
  difficulty: 2,
  kind: 'STATIC',
  type: 'numeric',
  svg: false,
});

const record = (id: string, attempt: number, status: PackageItem['status']): ItemRecord => ({
  slot: id,
  attempt,
  item: { code: id, status } as PackageItem,
  rejectedFor: status === 'REJECTED' ? ['ngram: copied'] : undefined,
});

const store = (records: ItemRecord[]) => {
  const byId = new Map(records.map((r) => [r.slot, r]));
  return { get: (id: string) => byId.get(id) };
};

describe('pendingSlots', () => {
  const slots = ['NEW', 'OK', 'REJ1', 'REJ2'].map(slot);
  const items = store([
    record('OK', 1, 'APPROVED'),
    record('REJ1', 1, 'REJECTED'),
    record('REJ2', 2, 'REJECTED'),
  ]);
  const ids = (p: ReturnType<typeof pendingSlots>) => p.map((x) => `${x.slot.id}@${x.attempt}`);

  it('skips slots rejected at the last attempt by default', () => {
    expect(ids(pendingSlots(slots, items))).toEqual(['NEW@1', 'REJ1@2']);
  });

  it('reopens them with --retry-rejected, carrying the rejection reasons', () => {
    const pending = pendingSlots(slots, items, true);
    expect(ids(pending)).toEqual(['NEW@1', 'REJ1@2', 'REJ2@3']);
    expect(pending.find((p) => p.slot.id === 'REJ2')!.problems).toEqual(['ngram: copied']);
  });
});
