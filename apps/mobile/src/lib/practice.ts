// Practice session helpers (M06): the answer a child is building for each item type, what the
// read-aloud button says, and labels for mastery states. Pure functions, tested in Vitest.
import type {
  KnowledgeNode,
  MasteryState,
  PracticeItem,
  PracticeOption,
} from '@vionx/contracts/client';
import type { MessageKey } from '../i18n/index.ts';

/** The answer in progress; one shape for every item type. */
export interface Draft {
  /** single / picture / spelling choice: one id; multi_choice: several. */
  optionIds: string[];
  /** true_false. */
  bool: boolean | null;
  /** numeric: keypad text. */
  text: string;
  /** fill_blank: typed text per gap. */
  blanks: string[];
  /** word_bank: option per gap (null = empty); ordering: chosen order. */
  slots: (string | null)[];
  /** matching: [left, right] pairs. */
  pairs: [string, string][];
  /** matching: the left option waiting for its partner. */
  pendingLeft: string | null;
}

export function emptyDraft(item: Pick<PracticeItem, 'type' | 'blanks'>): Draft {
  return {
    optionIds: [],
    bool: null,
    text: '',
    blanks: item.type === 'fill_blank' ? Array.from({ length: item.blanks }, () => '') : [],
    slots: item.type === 'word_bank' ? Array.from({ length: item.blanks }, () => null) : [],
    pairs: [],
    pendingLeft: null,
  };
}

const lefts = (item: Pick<PracticeItem, 'options'>) =>
  item.options.filter((o) => o.side === 'left');

/** Whether the draft can be submitted. */
export function isComplete(item: Pick<PracticeItem, 'type' | 'options'>, d: Draft): boolean {
  switch (item.type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return d.optionIds.length === 1;
    case 'multi_choice':
      return d.optionIds.length >= 1;
    case 'true_false':
      return d.bool !== null;
    case 'numeric':
      return /^-?\d+([.,]\d+)?$/.test(d.text.trim());
    case 'fill_blank':
      return d.blanks.length > 0 && d.blanks.every((b) => b.trim() !== '');
    case 'word_bank':
      return d.slots.length > 0 && d.slots.every((s) => s !== null);
    case 'ordering':
      return d.slots.length === item.options.length;
    case 'matching':
      return d.pairs.length === lefts(item).length && d.pairs.length > 0;
  }
}

/** The `response` body of POST …/answers for the draft. */
export function toResponse(item: Pick<PracticeItem, 'type'>, d: Draft): Record<string, unknown> {
  switch (item.type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return { optionId: d.optionIds[0] };
    case 'multi_choice':
      return { optionIds: d.optionIds };
    case 'true_false':
      return { value: d.bool };
    case 'numeric':
      return { value: d.text.trim() };
    case 'fill_blank':
      return { blanks: d.blanks.map((b) => b.trim()) };
    case 'word_bank':
      return { blankOptionIds: d.slots };
    case 'ordering':
      return { order: d.slots };
    case 'matching':
      return { pairs: d.pairs };
  }
}

/** Tap on an option: select (choice), toggle (multi), place in the next gap or take back. */
export function tapOption(
  item: Pick<PracticeItem, 'type' | 'options'>,
  d: Draft,
  id: string,
): Draft {
  switch (item.type) {
    case 'single_choice':
    case 'picture_choice':
    case 'spelling_choice':
      return { ...d, optionIds: [id] };
    case 'multi_choice':
      return {
        ...d,
        optionIds: d.optionIds.includes(id)
          ? d.optionIds.filter((x) => x !== id)
          : [...d.optionIds, id],
      };
    case 'word_bank': {
      if (d.slots.includes(id)) return { ...d, slots: d.slots.map((s) => (s === id ? null : s)) };
      const gap = d.slots.indexOf(null);
      return gap === -1 ? d : { ...d, slots: d.slots.map((s, i) => (i === gap ? id : s)) };
    }
    case 'ordering':
      return {
        ...d,
        slots: d.slots.includes(id) ? d.slots.filter((s) => s !== id) : [...d.slots, id],
      };
    case 'matching': {
      const option = item.options.find((o) => o.id === id);
      if (!option) return d;
      const paired = d.pairs.find((p) => p.includes(id));
      if (paired) return { ...d, pairs: d.pairs.filter((p) => p !== paired), pendingLeft: null };
      if (option.side === 'left') return { ...d, pendingLeft: d.pendingLeft === id ? null : id };
      if (d.pendingLeft === null) return d;
      return { ...d, pairs: [...d.pairs, [d.pendingLeft, id]], pendingLeft: null };
    }
    default:
      return d;
  }
}

/** Keypad press for numeric items: digits, one decimal comma, a leading minus, backspace. */
export function pressKey(text: string, key: string): string {
  if (key === '⌫') return text.slice(0, -1);
  if (key === '−') return text.startsWith('-') ? text.slice(1) : `-${text}`;
  if (key === ',') return text.includes(',') || text === '' || text === '-' ? text : `${text},`;
  return text.length >= 12 ? text : text + key;
}
export const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;

/** Strips Markdown and TeX markers so the text can be spoken. */
export const plainText = (md: string) =>
  md
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\\(?:frac|dfrac)\{([^{}]+)\}\{([^{}]+)\}/g, '$1 phần $2')
    .replace(/\\(times|cdot)/g, ' nhân ')
    .replace(/\\div/g, ' chia ')
    .replace(/_{3,}/g, ' … ')
    .replace(/[*_`#>\\{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const optionSpeech = (o: PracticeOption) => o.ttsText ?? o.text ?? o.media?.alt ?? '';

/** What the speaker button of an item reads: the stem, then every option. */
export function speechFor(item: Pick<PracticeItem, 'ttsText' | 'stemMd' | 'options'>): string {
  const parts = [item.ttsText ?? plainText(item.stemMd), ...item.options.map(optionSpeech)];
  return parts
    .map((p) => plainText(p))
    .filter(Boolean)
    .join('. ');
}

/** expo-speech language tag for a library `tts_lang`. */
export const speechLocale = (lang: 'vi' | 'en') => (lang === 'en' ? 'en-US' : 'vi-VN');

export const STATE_LABEL: Record<MasteryState, MessageKey> = {
  NOT_LEARNED: 'mastery.NOT_LEARNED',
  INTRODUCED: 'mastery.INTRODUCED',
  LEARNING: 'mastery.LEARNING',
  PROFICIENT: 'mastery.PROFICIENT',
  MASTERED: 'mastery.MASTERED',
  RETAINED: 'mastery.RETAINED',
};

/** Topics of the map: the nodes directly above skills, in curriculum order. */
export function topicsOf(nodes: readonly KnowledgeNode[]): KnowledgeNode[] {
  const parents = new Set(nodes.filter((n) => n.level === 'SKILL').map((n) => n.parentId));
  return nodes.filter((n) => parents.has(n.id));
}

/** Encouraging line after an answer (young learners never see a bare "wrong"). */
export function feedbackKey(isCorrect: boolean, young: boolean): MessageKey {
  if (isCorrect) return young ? 'practice.correctYoung' : 'practice.correct';
  return young ? 'practice.wrongYoung' : 'practice.wrong';
}

/** Splits text into plain and TeX parts (`$…$` or `$$…$$`). */
export function splitMath(source: string): { math: boolean; text: string }[] {
  const out: { math: boolean; text: string }[] = [];
  const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
  let last = 0;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m.index > last) out.push({ math: false, text: source.slice(last, m.index) });
    out.push({ math: true, text: (m[1] ?? m[2])! });
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ math: false, text: source.slice(last) });
  return out;
}

export const hasMath = (source: string) => splitMath(source).some((p) => p.math);
