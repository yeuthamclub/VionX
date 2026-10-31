import { describe, expect, it } from 'vitest';
import type { PackageItem } from '@vionx/domain';
import type { ItemRecord } from '../src/items.ts';
import type { PlanSlot } from '../src/lib/plan.ts';
import { pendingSlots, skillReferences } from '../src/steps/generate.ts';
import type { LessonMap } from '../src/steps/structure.ts';

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

describe('skillReferences', () => {
  const lessons = {
    sgk: { kind: 'SGK', lessons: [{ skills: ['S'], pageStart: 9, pageEnd: 11 }] },
  } as unknown as LessonMap;
  const pages = [
    { book: 'sgk', page: 9, text: 'Phân số bằng nhau.\nBÀI TẬP\n6.1. Hoàn thành bảng sau.' },
    { book: 'sgk', page: 10, text: '**BÀI TẬP CUỐI CHƯƠNG**\n6.8. Rút gọn.' },
    { book: 'sgk', page: 11, text: 'Luyện tập 1\nSo sánh hai phân số. '.repeat(10) },
    { book: 'other', page: 9, text: 'Không thuộc bài.' },
  ];

  it('drops exercise sections and pages that are only exercises', () => {
    const refs = skillReferences('S', lessons, pages);
    expect(refs.map((r) => [r.page, r.text.slice(0, 18)])).toEqual([
      [9, 'Phân số bằng nhau.'],
      [11, 'Luyện tập 1\nSo sán'],
    ]);
  });

  it('stops at the character budget', () => {
    const refs = skillReferences('S', lessons, pages, 30);
    expect(refs.reduce((n, r) => n + r.text.length, 0)).toBe(30);
  });
});
