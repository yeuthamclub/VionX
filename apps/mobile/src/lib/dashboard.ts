// Parent dashboard & gradebook helpers (M08): labels, the grade entry form and the points of the
// trend chart. Pure functions, tested in Vitest.
import type {
  ChildOverview,
  DashboardSchoolSubject,
  DataSufficiency,
  SchoolAssessment,
  UpcomingExam,
} from '@vionx/contracts/client';
import { isValidDay, schoolTermOf, SCHOOL_SUBJECTS } from '@vionx/domain';
import { t, type MessageKey } from '../i18n/index.ts';

export const sufficiencyLabel = (s: DataSufficiency) => t(`sufficiency.${s}` as MessageKey);

export const subjectName = (code: string) =>
  SCHOOL_SUBJECTS.find((s) => s.code === code)?.nameVi ?? code;

/** 0-1 as a whole percent; "–" when there is nothing to divide. */
export const percentText = (rate: number | null) =>
  rate === null ? '–' : `${Math.round(rate * 100)}%`;

/** A score the way a Vietnamese report card shows it: 8, 7.5, 18/20. */
export function scoreText(a: Pick<SchoolAssessment, 'score' | 'maxScore'>): string {
  const n = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
  return a.maxScore === 10 ? n(a.score) : `${n(a.score)}/${n(a.maxScore)}`;
}

export function trendText(s: Pick<DashboardSchoolSubject, 'direction' | 'deltaPercent'>): string {
  if (s.direction === 'FLAT') return t('grades.trend.FLAT');
  return t(`grades.trend.${s.direction}` as MessageKey, { n: Math.abs(s.deltaPercent) });
}

export function examText(e: Pick<UpcomingExam, 'title' | 'daysUntil'>): string {
  return e.daysUntil === 0
    ? t('dashboard.examToday', { title: e.title })
    : t('dashboard.examIn', { title: e.title, n: e.daysUntil });
}

/** The lines of a child's card on the parent home. */
export function overviewLines(card: ChildOverview): { key: string; text: string }[] {
  const lines = [
    {
      key: 'today',
      text: t('overview.today', { done: card.today.itemsDone, total: card.today.itemsTotal }),
    },
    { key: 'streak', text: t('overview.streak', { n: card.streak.days }) },
    { key: 'coins', text: t('overview.coins', { today: card.coinsToday, week: card.coinsWeek }) },
  ];
  // Counts read from too little data would mislead: say so instead.
  lines.push({
    key: 'skills',
    text:
      card.skillsSufficiency === 'INSUFFICIENT'
        ? t('overview.skillsInsufficient')
        : t('overview.skills', { up: card.skillsImproving, risk: card.skillsAtRisk }),
  });
  const exam = card.upcomingExams[0];
  if (exam) lines.push({ key: 'exam', text: examText(exam) });
  return lines;
}

/** Chart coordinates of grade points (oldest left, 100% at the top) inside width × height. */
export function chartPoints(
  points: readonly { percent: number }[],
  width: number,
  height: number,
  pad = 8,
): { x: number; y: number }[] {
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  return points.map((p, i) => ({
    x: Math.round((pad + (points.length === 1 ? w / 2 : (w * i) / (points.length - 1))) * 10) / 10,
    y: Math.round((pad + h * (1 - Math.min(100, Math.max(0, p.percent)) / 100)) * 10) / 10,
  }));
}

export interface GradeForm {
  subjectCode: string;
  type: SchoolAssessment['type'];
  assessedOn: string;
  score: string;
  maxScore: string;
  teacherComment: string;
}

const number = (text: string): number | null => {
  const s = text.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
};

/** The request body of a grade, or the field that is wrong. Decimal comma accepted. */
export function gradeFormBody(form: GradeForm):
  | {
      ok: true;
      body: {
        subjectCode: string;
        type: SchoolAssessment['type'];
        assessedOn: string;
        score: number;
        maxScore: number;
        teacherComment: string | null;
      };
    }
  | { ok: false; field: 'assessedOn' | 'score' | 'maxScore' } {
  if (!isValidDay(form.assessedOn)) return { ok: false, field: 'assessedOn' };
  const maxScore = number(form.maxScore);
  if (maxScore === null || maxScore <= 0 || maxScore > 1000)
    return { ok: false, field: 'maxScore' };
  const score = number(form.score);
  if (score === null || score > maxScore) return { ok: false, field: 'score' };
  return {
    ok: true,
    body: {
      subjectCode: form.subjectCode,
      type: form.type,
      assessedOn: form.assessedOn,
      score,
      maxScore,
      teacherComment: form.teacherComment.trim() || null,
    },
  };
}

export const termText = (day: string) => {
  const term = schoolTermOf(day);
  return `${t(`grades.semester.${term.semester}` as MessageKey)} · ${term.schoolYear}`;
};
