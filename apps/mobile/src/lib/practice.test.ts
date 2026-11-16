import type { KnowledgeNode, PracticeItem, PracticeOption } from '@vionx/contracts/client';
import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  feedbackKey,
  hasMath,
  isComplete,
  plainText,
  pressKey,
  speechFor,
  speechLocale,
  splitMath,
  tapOption,
  topicsOf,
  toResponse,
} from './practice.ts';

const opt = (id: string, over: Partial<PracticeOption> = {}): PracticeOption => ({
  id,
  text: id.toUpperCase(),
  media: null,
  ttsText: null,
  side: null,
  ...over,
});
const item = (type: PracticeItem['type'], over: Partial<PracticeItem> = {}) =>
  ({ type, blanks: 0, options: [opt('a'), opt('b'), opt('c')], ...over }) as PracticeItem;

describe('drafts per item type', () => {
  it('single / picture / spelling choice keep one option', () => {
    for (const type of ['single_choice', 'picture_choice', 'spelling_choice'] as const) {
      const it_ = item(type);
      let d = emptyDraft(it_);
      expect(isComplete(it_, d)).toBe(false);
      d = tapOption(it_, tapOption(it_, d, 'a'), 'b');
      expect(isComplete(it_, d)).toBe(true);
      expect(toResponse(it_, d)).toEqual({ optionId: 'b' });
    }
  });

  it('multi choice toggles', () => {
    const it_ = item('multi_choice');
    let d = ['a', 'c', 'a', 'b'].reduce((acc, id) => tapOption(it_, acc, id), emptyDraft(it_));
    expect(toResponse(it_, d)).toEqual({ optionIds: ['c', 'b'] });
    d = tapOption(it_, tapOption(it_, d, 'c'), 'b');
    expect(isComplete(it_, d)).toBe(false);
  });

  it('true/false and numeric keypad', () => {
    const tf = item('true_false');
    expect(isComplete(tf, emptyDraft(tf))).toBe(false);
    expect(toResponse(tf, { ...emptyDraft(tf), bool: false })).toEqual({ value: false });
    const num = item('numeric');
    const text = ['1', '2', ',', ',', '5', '⌫', '7', '−'].reduce(pressKey, '');
    expect(text).toBe('-12,7');
    expect(pressKey('', ',')).toBe('');
    expect(pressKey('-3', '−')).toBe('3');
    expect(pressKey('123456789012', '3')).toBe('123456789012');
    expect(isComplete(num, { ...emptyDraft(num), text })).toBe(true);
    expect(isComplete(num, { ...emptyDraft(num), text: '12,' })).toBe(false);
    expect(toResponse(num, { ...emptyDraft(num), text: ' 45 ' })).toEqual({ value: '45' });
  });

  it('fill blank needs every gap', () => {
    const it_ = item('fill_blank', { blanks: 2 });
    const d = emptyDraft(it_);
    expect(d.blanks).toEqual(['', '']);
    expect(isComplete(it_, { ...d, blanks: ['Hà Nội', ' '] })).toBe(false);
    expect(toResponse(it_, { ...d, blanks: [' Hà Nội ', '5'] })).toEqual({
      blanks: ['Hà Nội', '5'],
    });
  });

  it('word bank fills the next gap and takes a word back', () => {
    const it_ = item('word_bank', { blanks: 2 });
    let d = tapOption(it_, tapOption(it_, emptyDraft(it_), 'b'), 'a');
    expect(d.slots).toEqual(['b', 'a']);
    expect(tapOption(it_, d, 'c').slots).toEqual(['b', 'a']); // full
    d = tapOption(it_, d, 'b');
    expect(d.slots).toEqual([null, 'a']);
    expect(isComplete(it_, d)).toBe(false);
    d = tapOption(it_, d, 'c');
    expect(toResponse(it_, d)).toEqual({ blankOptionIds: ['c', 'a'] });
  });

  it('ordering by tapping in sequence', () => {
    const it_ = item('ordering');
    let d = ['c', 'a', 'b'].reduce((acc, id) => tapOption(it_, acc, id), emptyDraft(it_));
    expect(isComplete(it_, d)).toBe(true);
    expect(toResponse(it_, d)).toEqual({ order: ['c', 'a', 'b'] });
    d = tapOption(it_, d, 'a');
    expect(d.slots).toEqual(['c', 'b']);
    expect(isComplete(it_, d)).toBe(false);
  });

  it('matching pairs a left with a right and unpairs on tap', () => {
    const options = [
      opt('l1', { side: 'left' }),
      opt('l2', { side: 'left' }),
      opt('r1', { side: 'right' }),
      opt('r2', { side: 'right' }),
    ];
    const it_ = item('matching', { options });
    let d = tapOption(it_, emptyDraft(it_), 'r1'); // a right first does nothing
    expect(d.pairs).toEqual([]);
    d = ['l1', 'r2', 'l2', 'r1'].reduce((acc, id) => tapOption(it_, acc, id), d);
    expect(isComplete(it_, d)).toBe(true);
    expect(toResponse(it_, d)).toEqual({
      pairs: [
        ['l1', 'r2'],
        ['l2', 'r1'],
      ],
    });
    d = tapOption(it_, d, 'r2');
    expect(d.pairs).toEqual([['l2', 'r1']]);
    expect(isComplete(it_, d)).toBe(false);
  });
});

describe('read aloud and text', () => {
  it('reads the stem and every option, preferring the TTS text', () => {
    expect(
      speechFor({
        ttsText: 'Chọn số lớn nhất',
        stemMd: 'Chọn số **lớn nhất**',
        options: [opt('a', { text: '35', ttsText: 'ba mươi lăm' }), opt('b', { text: '53' })],
      }),
    ).toBe('Chọn số lớn nhất. ba mươi lăm. 53');
    expect(speechFor({ ttsText: null, stemMd: 'Tính $\\frac{1}{2} \\times 4$', options: [] })).toBe(
      'Tính 1 phần 2 nhân 4',
    );
    expect(plainText('Điền: giọt nước ___ trên lá')).toBe('Điền: giọt nước … trên lá');
    expect([speechLocale('vi'), speechLocale('en')]).toEqual(['vi-VN', 'en-US']);
  });

  it('splits TeX from text', () => {
    expect(splitMath('Tính $a+b$ rồi $$c$$.')).toEqual([
      { math: false, text: 'Tính ' },
      { math: true, text: 'a+b' },
      { math: false, text: ' rồi ' },
      { math: true, text: 'c' },
      { math: false, text: '.' },
    ]);
    expect(hasMath('Giá 5$ một cái')).toBe(false);
    expect(hasMath('$x$')).toBe(true);
  });

  it('young learners get encouraging feedback', () => {
    expect(feedbackKey(false, true)).toBe('practice.wrongYoung');
    expect(feedbackKey(false, false)).toBe('practice.wrong');
    expect(feedbackKey(true, true)).toBe('practice.correctYoung');
  });

  it('topics are the parents of skills', () => {
    const node = (id: string, level: string, parentId: string | null) =>
      ({ id, level, parentId }) as KnowledgeNode;
    const nodes = [
      node('subj', 'SUBJECT', null),
      node('t1', 'TOPIC', 'subj'),
      node('s1', 'SKILL', 't1'),
      node('t2', 'LESSON', 'subj'),
      node('s2', 'SKILL', 't2'),
    ];
    expect(topicsOf(nodes).map((n) => n.id)).toEqual(['t1', 't2']);
  });
});
