// Today planner helpers (M07): titles, the reason lines a parent sees, the sections of the list and
// the route parameters of a learning item. Pure functions, tested in Vitest.
import type {
  KnowledgeMapResponse,
  TodayItem,
  TodayReason,
  TodayResponse,
} from '@vionx/contracts/client';
import { LIBRARY_SUBJECT_OF, subjectsForGrade } from '@vionx/domain';
import { t, type MessageKey } from '../i18n/index.ts';

/** What the card says: the task or skill, or "review N skills" for a review item. */
export function itemTitle(item: Pick<TodayItem, 'kind' | 'title' | 'detail'>): string {
  if (item.kind === 'DUE_REVIEW') return t('today.reviewTitle', { n: Number(item.detail.count) });
  return item.title;
}

export const kindLabel = (kind: TodayItem['kind']) => t(`today.kind.${kind}` as MessageKey);
export const statusLabel = (status: TodayItem['status']) =>
  t(`today.status.${status}` as MessageKey);

/** One §11 term in words, with its points (parent view). */
export function reasonText(reason: TodayReason): string {
  const p = reason.params ?? {};
  const points = `${reason.points > 0 ? '+' : ''}${reason.points}`;
  let text: string;
  switch (reason.code) {
    case 'DUE_TODAY':
      text = t(p.required === false ? 'today.reason.DUE_TODAY_OPTIONAL' : 'today.reason.DUE_TODAY');
      break;
    case 'EXAM_SOON':
      text =
        Number(p.days) === 0
          ? t('today.reason.EXAM_TODAY', { title: String(p.examTitle) })
          : t('today.reason.EXAM_SOON', { title: String(p.examTitle), n: Number(p.days) });
      break;
    case 'PARENT_PRIORITY':
      text = t(`today.reason.PRIORITY_${String(p.level ?? 'NORMAL')}` as MessageKey);
      break;
    case 'PREREQUISITE_GAP':
      text = t('today.reason.PREREQUISITE_GAP', { n: Number(p.dependents ?? 1) });
      break;
    case 'REVIEW_DUE':
      text = t('today.reason.REVIEW_DUE', { n: Number(p.count ?? 1) });
      break;
    default:
      text = t(`today.reason.${reason.code}` as MessageKey);
  }
  return `${text} (${points})`;
}

export interface TodaySections {
  /** Open and inside today's time budget. */
  now: TodayItem[];
  /** Open but beyond the budget, or skipped: "if there is time". */
  later: TodayItem[];
  /** Done, or waiting for the parent. */
  done: TodayItem[];
  /** Removed by the parent (the child's response never contains these). */
  removed: TodayItem[];
}

export function todaySections(today: Pick<TodayResponse, 'items'>): TodaySections {
  const out: TodaySections = { now: [], later: [], done: [], removed: [] };
  for (const item of today.items) {
    if (item.status === 'REMOVED') out.removed.push(item);
    else if (item.status === 'DONE' || item.status === 'PENDING_APPROVAL') out.done.push(item);
    else if (item.status === 'SKIPPED' || !item.inBudget) out.later.push(item);
    else out.now.push(item);
  }
  return out;
}

/** Fraction and caption of the day's time bar. */
export function timeBar(today: Pick<TodayResponse, 'doneMinutes' | 'budgetMinutes'>): {
  fraction: number;
  caption: string;
} {
  const { doneMinutes: done, budgetMinutes: budget } = today;
  return {
    fraction: budget > 0 ? Math.min(1, done / budget) : done > 0 ? 1 : 0,
    caption: t('today.time', { done, budget }),
  };
}

/** Route parameters of the practice screen for a learning item; null for a task item. */
export function practiceParams(
  link: TodayItem['link'],
): { mode?: 'REVIEW'; subject: string; skillIds?: string } | null {
  if (link.type !== 'SESSION') return null;
  return link.mode === 'REVIEW'
    ? { mode: 'REVIEW', subject: link.subject }
    : { subject: link.subject, skillIds: link.skillIds.join(',') };
}

export interface ExamSubject {
  /** Library subject (`math`). */
  subject: string;
  /** School subject code sent with the event (`TOAN`), when the library subject has one. */
  subjectCode: string | null;
  title: string;
  /** Curriculum nodes that hold skills directly. */
  topics: { id: string; title: string; skillIds: string[] }[];
}

/** What an exam can cover, from the child's knowledge map (event form). */
export function examSubjects(map: Pick<KnowledgeMapResponse, 'subjects' | 'grade'>): ExamSubject[] {
  const taught = new Set(subjectsForGrade(map.grade).map((s) => s.code));
  return map.subjects.map((s) => {
    const topics = new Map<string, ExamSubject['topics'][number]>();
    for (const n of s.nodes) {
      if (n.level !== 'SKILL') topics.set(n.id, { id: n.id, title: n.title, skillIds: [] });
    }
    for (const n of s.nodes) {
      if (n.level === 'SKILL' && n.parentId) topics.get(n.parentId)?.skillIds.push(n.id);
    }
    return {
      subject: s.subject,
      subjectCode:
        Object.entries(LIBRARY_SUBJECT_OF).find(
          ([code, lib]) => lib === s.subject && taught.has(code),
        )?.[0] ?? null,
      title: s.title,
      topics: [...topics.values()].filter((topic) => topic.skillIds.length > 0),
    };
  });
}

/** Skills of the chosen topics (the API takes at most 50). */
export const examSkillIds = (subject: ExamSubject | undefined, topicIds: readonly string[]) =>
  (subject?.topics ?? [])
    .filter((topic) => topicIds.includes(topic.id))
    .flatMap((topic) => topic.skillIds)
    .slice(0, 50);

/** The parent's "minutes a day" field: empty = default (null), otherwise 10-480. */
export function parseDailyMinutes(
  text: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  return /^\d+$/.test(trimmed) && n >= 10 && n <= 480 ? { ok: true, value: n } : { ok: false };
}

/** What the child can do with a card. */
export function childActions(item: TodayItem): {
  start: boolean;
  complete: boolean;
  needsPhoto: boolean;
  skip: boolean;
} {
  const open = item.status === 'PLANNED' || item.status === 'STARTED';
  const reopen = open || item.status === 'SKIPPED';
  const task = item.link.type === 'TASK';
  const handDone =
    task && item.link.type === 'TASK' && item.link.verificationMode !== 'SYSTEM_VERIFIED';
  return {
    start: !task && reopen,
    complete: handDone && reopen,
    needsPhoto: item.link.type === 'TASK' && item.link.verificationMode === 'PHOTO_PROOF',
    skip: open && !item.required,
  };
}
