import type { ChildOverview } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import {
  chartPoints,
  examText,
  gradeFormBody,
  overviewLines,
  percentText,
  scoreText,
  subjectName,
  sufficiencyLabel,
  termText,
  trendText,
  type GradeForm,
} from './dashboard.ts';

const card = (over: Partial<ChildOverview> = {}): ChildOverview => ({
  studentId: 's1',
  displayName: 'Minh',
  grade: 6,
  avatar: 'fox',
  today: {
    itemsTotal: 5,
    itemsDone: 2,
    plannedMinutes: 40,
    doneMinutes: 35,
    budgetMinutes: 75,
    completion: 0.4,
  },
  streak: { days: 3, activeDays: 4, sufficiency: 'LOW' },
  coinBalance: 12,
  coinsToday: 1,
  coinsWeek: 6,
  skillsImproving: 2,
  skillsAtRisk: 1,
  skillsSufficiency: 'OK',
  upcomingExams: [],
  ...over,
});

const form = (over: Partial<GradeForm> = {}): GradeForm => ({
  subjectCode: 'TOAN',
  type: 'SHORT_QUIZ',
  assessedOn: '2026-11-17',
  score: '7,5',
  maxScore: '10',
  teacherComment: '',
  ...over,
});

describe('dashboard helpers', () => {
  it('labels', () => {
    expect(sufficiencyLabel('INSUFFICIENT')).toBe('Chưa đủ dữ liệu');
    expect(sufficiencyLabel('OK')).toBe('Đủ dữ liệu');
    expect(subjectName('TOAN')).toBe('Toán');
    expect(subjectName('XYZ')).toBe('XYZ');
    expect(percentText(0.333)).toBe('33%');
    expect(percentText(null)).toBe('–');
    expect(scoreText({ score: 7.5, maxScore: 10 })).toBe('7,5');
    expect(scoreText({ score: 18, maxScore: 20 })).toBe('18/20');
    expect(trendText({ direction: 'UP', deltaPercent: 10 })).toBe('tăng 10 điểm phần trăm');
    expect(trendText({ direction: 'DOWN', deltaPercent: -7.5 })).toBe('giảm 7.5 điểm phần trăm');
    expect(trendText({ direction: 'FLAT', deltaPercent: 2 })).toBe('giữ mức');
    expect(examText({ title: 'Kiểm tra Toán', daysUntil: 0 })).toBe('Kiểm tra Toán: hôm nay');
    expect(examText({ title: 'Kiểm tra Toán', daysUntil: 2 })).toBe('Kiểm tra Toán: còn 2 ngày');
    expect(termText('2026-11-17')).toBe('Học kì 1 · 2026-2027');
  });

  it('the child card: Today, streak, Coin, skills, the next exam', () => {
    expect(overviewLines(card()).map((l) => l.text)).toEqual([
      'Hôm nay: xong 2/5 việc',
      'Chuỗi ngày liên tiếp: 3',
      'Coin hôm nay: 1 · 7 ngày qua: 6',
      'Kỹ năng đang tiến bộ: 2 · cần chú ý: 1',
    ]);
    const lines = overviewLines(
      card({
        skillsSufficiency: 'INSUFFICIENT',
        skillsImproving: 0,
        skillsAtRisk: 0,
        upcomingExams: [
          { eventId: 'e1', title: 'Giữa kì', subjectCode: 'TOAN', startsAt: '', daysUntil: 3 },
          { eventId: 'e2', title: 'Cuối kì', subjectCode: 'TOAN', startsAt: '', daysUntil: 9 },
        ],
      }),
    );
    // No counts read from too little data.
    expect(lines.find((l) => l.key === 'skills')!.text).toBe(
      'Kỹ năng: chưa đủ dữ liệu để nhận xét',
    );
    expect(lines.at(-1)).toEqual({ key: 'exam', text: 'Giữa kì: còn 3 ngày' });
  });

  it('chart points: oldest left, 100% at the top, inside the padding', () => {
    expect(chartPoints([], 300, 120)).toEqual([]);
    expect(chartPoints([{ percent: 50 }], 300, 120)).toEqual([{ x: 150, y: 60 }]);
    expect(chartPoints([{ percent: 0 }, { percent: 100 }, { percent: 150 }], 300, 120)).toEqual([
      { x: 8, y: 112 },
      { x: 150, y: 8 },
      { x: 292, y: 8 },
    ]);
  });

  it('grade form: decimal comma, score within the maximum, a real date', () => {
    expect(gradeFormBody(form())).toEqual({
      ok: true,
      body: {
        subjectCode: 'TOAN',
        type: 'SHORT_QUIZ',
        assessedOn: '2026-11-17',
        score: 7.5,
        maxScore: 10,
        teacherComment: null,
      },
    });
    expect(
      gradeFormBody(form({ score: '18', maxScore: '20', teacherComment: ' Tốt ' })),
    ).toMatchObject({ ok: true, body: { score: 18, maxScore: 20, teacherComment: 'Tốt' } });
    expect(gradeFormBody(form({ score: '11' }))).toEqual({ ok: false, field: 'score' });
    expect(gradeFormBody(form({ score: '' }))).toEqual({ ok: false, field: 'score' });
    expect(gradeFormBody(form({ score: '7.555' }))).toEqual({ ok: false, field: 'score' });
    expect(gradeFormBody(form({ score: '-1' }))).toEqual({ ok: false, field: 'score' });
    expect(gradeFormBody(form({ maxScore: '0' }))).toEqual({ ok: false, field: 'maxScore' });
    expect(gradeFormBody(form({ maxScore: 'mười' }))).toEqual({ ok: false, field: 'maxScore' });
    expect(gradeFormBody(form({ assessedOn: '2026-02-30' }))).toEqual({
      ok: false,
      field: 'assessedOn',
    });
  });
});
