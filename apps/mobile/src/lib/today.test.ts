import type { TodayItem } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import {
  childActions,
  examSkillIds,
  examSubjects,
  itemTitle,
  parseDailyMinutes,
  practiceParams,
  reasonText,
  timeBar,
  todaySections,
} from './today.ts';

const item = (over: Partial<TodayItem> = {}): TodayItem => ({
  id: 'i1',
  kind: 'PARENT_TASK',
  title: 'Dọn bàn học',
  subject: null,
  minutes: 10,
  priority: 40,
  reasons: [{ code: 'DUE_TODAY', points: 30, params: { required: true } }],
  status: 'PLANNED',
  pinned: false,
  required: true,
  inBudget: true,
  rewardXp: 10,
  link: { type: 'TASK', taskId: 't1', occurrenceId: 'o1', verificationMode: 'SELF_CHECK' },
  detail: {},
  ...over,
});
const learning = (over: Partial<TodayItem> = {}) =>
  item({
    id: 'l1',
    kind: 'EXAM_PREP',
    title: 'Cộng phân số',
    subject: 'math',
    required: false,
    link: { type: 'SESSION', mode: 'PRACTICE', skillIds: ['s1'], subject: 'math' },
    ...over,
  });

describe('today helpers', () => {
  it('titles: the task or skill, or the number of skills to review', () => {
    expect(itemTitle(item())).toBe('Dọn bàn học');
    expect(itemTitle(item({ kind: 'DUE_REVIEW', title: '', detail: { count: 3 } }))).toBe(
      'Ôn lại 3 kỹ năng tới hạn',
    );
  });

  it('reasons read as sentences with their points', () => {
    expect(reasonText({ code: 'DUE_TODAY', points: 30, params: { required: true } })).toBe(
      'Việc bắt buộc của hôm nay (+30)',
    );
    expect(reasonText({ code: 'DUE_TODAY', points: 12, params: { required: false } })).toBe(
      'Việc tùy chọn của hôm nay (+12)',
    );
    expect(
      reasonText({ code: 'EXAM_SOON', points: 24, params: { examTitle: 'Giữa kì', days: 3 } }),
    ).toBe('Còn 3 ngày nữa là "Giữa kì" (+24)');
    expect(
      reasonText({ code: 'EXAM_SOON', points: 30, params: { examTitle: 'Giữa kì', days: 0 } }),
    ).toBe('"Giữa kì" diễn ra hôm nay (+30)');
    expect(reasonText({ code: 'PARENT_PRIORITY', points: 20, params: { level: 'HIGH' } })).toBe(
      'Bố mẹ đặt ưu tiên cao (+20)',
    );
    expect(reasonText({ code: 'REVIEW_DUE', points: 14, params: { count: 2 } })).toContain(
      '2 kỹ năng tới hạn ôn',
    );
    expect(reasonText({ code: 'WORKLOAD_TODAY', points: -7.5 })).toBe(
      'Hôm nay con đã học khá nhiều (-7.5)',
    );
    expect(reasonText({ code: 'NEXT_IN_CURRICULUM', points: 10 })).toBe(
      'Bước tiếp theo trong chương trình (+10)',
    );
  });

  it('sections: now, if there is time, done, removed', () => {
    const s = todaySections({
      items: [
        item({ id: 'a' }),
        item({ id: 'b', inBudget: false }),
        item({ id: 'c', status: 'SKIPPED' }),
        item({ id: 'd', status: 'DONE' }),
        item({ id: 'e', status: 'PENDING_APPROVAL' }),
        item({ id: 'f', status: 'REMOVED' }),
        item({ id: 'g', status: 'STARTED' }),
      ],
    });
    expect(s.now.map((i) => i.id)).toEqual(['a', 'g']);
    expect(s.later.map((i) => i.id)).toEqual(['b', 'c']);
    expect(s.done.map((i) => i.id)).toEqual(['d', 'e']);
    expect(s.removed.map((i) => i.id)).toEqual(['f']);
  });

  it('time bar: done minutes over the budget, never above full', () => {
    expect(timeBar({ doneMinutes: 25, budgetMinutes: 75 })).toEqual({
      fraction: 1 / 3,
      caption: 'Đã làm 25/75 phút hôm nay',
    });
    expect(timeBar({ doneMinutes: 90, budgetMinutes: 75 }).fraction).toBe(1);
    expect(timeBar({ doneMinutes: 0, budgetMinutes: 0 }).fraction).toBe(0);
  });

  it('a learning item opens the practice screen with its skills or as a review', () => {
    expect(practiceParams(learning().link)).toEqual({ subject: 'math', skillIds: 's1' });
    expect(
      practiceParams({ type: 'SESSION', mode: 'REVIEW', skillIds: [], subject: 'viet' }),
    ).toEqual({ mode: 'REVIEW', subject: 'viet' });
    expect(practiceParams(item().link)).toBeNull();
  });

  it('child actions: tasks are completed by hand, learning items are started', () => {
    expect(childActions(item())).toEqual({
      start: false,
      complete: true,
      needsPhoto: false,
      skip: false,
    });
    expect(
      childActions(
        item({
          required: false,
          link: { type: 'TASK', taskId: 't', occurrenceId: 'o', verificationMode: 'PHOTO_PROOF' },
        }),
      ),
    ).toEqual({ start: false, complete: true, needsPhoto: true, skip: true });
    expect(childActions(learning())).toEqual({
      start: true,
      complete: false,
      needsPhoto: false,
      skip: true,
    });
    expect(childActions(learning({ status: 'SKIPPED' }))).toMatchObject({
      start: true,
      skip: false,
    });
    expect(childActions(learning({ status: 'DONE' }))).toMatchObject({ start: false, skip: false });
    expect(
      childActions(
        item({
          link: {
            type: 'TASK',
            taskId: 't',
            occurrenceId: 'o',
            verificationMode: 'SYSTEM_VERIFIED',
          },
        }),
      ).complete,
    ).toBe(false);
  });

  it('minutes a day: empty is the default, otherwise 10 to 480', () => {
    expect(parseDailyMinutes(' ')).toEqual({ ok: true, value: null });
    expect(parseDailyMinutes('60')).toEqual({ ok: true, value: 60 });
    expect(parseDailyMinutes('5')).toEqual({ ok: false });
    expect(parseDailyMinutes('481')).toEqual({ ok: false });
    expect(parseDailyMinutes('1e2')).toEqual({ ok: false });
  });

  it('exam content: topics of a subject with their skills, and the school subject code', () => {
    const node = (id: string, level: string, parentId: string | null) =>
      ({ id, level, parentId, title: `N ${id}` }) as never;
    const subjects = examSubjects({
      grade: 6,
      subjects: [
        {
          subject: 'math',
          title: 'Toán 6',
          readAloud: false,
          ttsLang: 'vi',
          nodes: [
            node('ch', 'CHAPTER', null),
            node('t1', 'TOPIC', 'ch'),
            node('s1', 'SKILL', 't1'),
            node('s2', 'SKILL', 't1'),
            node('t2', 'TOPIC', 'ch'),
            node('s3', 'SKILL', 't2'),
          ],
        },
      ],
    });
    expect(subjects).toEqual([
      {
        subject: 'math',
        subjectCode: 'TOAN',
        title: 'Toán 6',
        topics: [
          { id: 't1', title: 'N t1', skillIds: ['s1', 's2'] },
          { id: 't2', title: 'N t2', skillIds: ['s3'] },
        ],
      },
    ]);
    expect(examSkillIds(subjects[0], ['t2'])).toEqual(['s3']);
    expect(examSkillIds(subjects[0], [])).toEqual([]);
    expect(examSkillIds(undefined, ['t1'])).toEqual([]);
  });
});
