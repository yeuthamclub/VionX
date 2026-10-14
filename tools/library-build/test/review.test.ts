import { describe, expect, it } from 'vitest';
import type { ItemTemplate, PackageItem } from '@vionx/domain';
import { parseCsv, parseCsvRows, toCsv } from '../src/lib/csv.ts';
import { readReview, reviewCsv } from '../src/lib/review.ts';

const item = (code: string, over: Partial<PackageItem> = {}): PackageItem => ({
  code,
  kind: 'STATIC',
  skills: ['MATH.6.G.T.S'],
  difficulty: 2,
  cognitiveLevel: 'L2',
  type: 'single_choice',
  stemMd: 'Chọn số "lớn nhất", rồi giải thích:\nvì sao?',
  media: [],
  options: [
    { id: 'a', text: '2,5' },
    { id: 'b', text: '3' },
  ],
  answer: { optionId: 'b' },
  explanationMd: '3 > 2,5.',
  hints: [{ md: 'Một' }, { md: 'Hai, ba' }, { md: 'Ba' }, { md: 'Bốn' }],
  workedSolutionMd: 'So sánh phần nguyên.',
  distractorFeedback: { a: { md: '2,5 < 3.', misconception: 'DECIMAL_LONGER' } },
  misconceptionTags: ['DECIMAL_LONGER'],
  sourceRefs: [],
  provenance: {},
  status: 'NEEDS_REVIEW',
  ...over,
});

const template: ItemTemplate = {
  item: 'T2',
  params: [
    { name: 'a', type: 'int', min: 2, max: 9 },
    { name: 'b', type: 'int', min: 2, max: 9 },
  ],
  constraints: ['a != b'],
  answerExpr: 'a + b',
  distractorExprs: ['a * b'],
  render: { stem: 'Tính {{a}} + {{b}}.' },
};

describe('CSV', () => {
  it('round-trips commas, quotes, line breaks, leading spaces and Vietnamese with a BOM', () => {
    const rows = [
      { a: 'x, y', b: 'say "hi"', c: 'line 1\nline 2' },
      { a: ' lead', b: 'Tiếng Việt', c: '' },
    ];
    const text = toCsv(['a', 'b', 'c'], rows);
    expect(text.startsWith('﻿')).toBe(true);
    expect(parseCsv(text)).toEqual({ header: ['a', 'b', 'c'], rows });
  });

  it('reads CRLF and LF files and skips blank lines', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n\r\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(() => parseCsvRows('a,"b')).toThrow(/quoted cell/);
  });
});

describe('review.csv round trip', () => {
  const items = [
    item('T1'),
    item('T2', {
      kind: 'TEMPLATE',
      type: 'numeric',
      options: [],
      answer: null,
      distractorFeedback: { d1: { md: 'Cộng, không nhân.' } },
    }),
    item('T3'),
  ];
  const current = new Map(
    items.map((i) => [i.code, { item: i, ...(i.code === 'T2' ? { template } : {}) }]),
  );
  const exported = reviewCsv(
    items.map((i) => ({
      item: i,
      ...(i.code === 'T2' ? { template } : {}),
      autoVerdict: 'PASS',
      flags: [],
    })),
  );

  const withVerdicts = (edit: (row: Record<string, string>) => void) => {
    const { header, rows } = parseCsv(exported);
    rows.forEach(edit);
    return toCsv(header, rows);
  };

  it('exports one row per item with template samples, and imports nothing without verdicts', () => {
    const { rows } = parseCsv(exported);
    expect(rows.map((r) => r.code)).toEqual(['T1', 'T2', 'T3']);
    expect(rows[1]!.sample_variants).toMatch(/^seed 1: Tính \d \+ \d\. → \d+/);
    expect(readReview(exported, current)).toEqual([]);
  });

  it('applies APPROVED, REJECTED and EDITED; unchanged edits rebuild the same item', () => {
    const text = withVerdicts((r) => {
      if (r.code === 'T1') r.verdict = 'approved';
      if (r.code === 'T2') {
        r.verdict = 'EDITED';
        r.template_json = r.template_json!.replace(
          'Tính {{a}} + {{b}}.',
          'Tính nhẩm {{a}} + {{b}}.',
        );
      }
      if (r.code === 'T3') {
        r.verdict = 'REJECTED';
        r.reviewer_note = 'Quá dễ.';
      }
    });
    const decisions = readReview(text, current);
    expect(decisions.map((d) => [d.code, d.verdict, d.note])).toEqual([
      ['T1', 'APPROVED', ''],
      ['T2', 'EDITED', ''],
      ['T3', 'REJECTED', 'Quá dễ.'],
    ]);
    expect(decisions[1]!.template!.render.stem).toBe('Tính nhẩm {{a}} + {{b}}.');
    expect(decisions[1]!.item).toEqual(items[1]);
    const t1 = readReview(
      withVerdicts((r) => (r.verdict = r.code === 'T1' ? 'EDITED' : '')),
      current,
    );
    expect(t1[0]!.item).toEqual(items[0]);
  });

  it('applies edited stems, options, answers and hints', () => {
    const text = withVerdicts((r) => {
      if (r.code !== 'T1') return;
      r.verdict = 'EDITED';
      r.stem_md = 'Số nào lớn hơn?';
      r.options_json = JSON.stringify([
        { id: 'a', text: '2,5' },
        { id: 'b', text: '2,05' },
      ]);
      r.answer_json = '{"optionId":"a"}';
      r.hint_2 = 'So sánh hàng phần mười.';
      r.distractor_feedback_json = '{"b":{"md":"0 < 5 ở hàng phần mười."}}';
    });
    const [d] = readReview(text, current);
    expect(d!.item).toMatchObject({
      stemMd: 'Số nào lớn hơn?',
      answer: { optionId: 'a' },
      distractorFeedback: { b: { md: '0 < 5 ở hàng phần mười.' } },
    });
    expect(d!.item!.hints[1]!.md).toBe('So sánh hàng phần mười.');
  });

  it('refuses unknown codes, bad verdicts and broken JSON, all at once', () => {
    const text = withVerdicts((r) => {
      if (r.code === 'T1') r.verdict = 'MAYBE';
      if (r.code === 'T2') r.code = 'NOPE';
      if (r.code === 'NOPE') r.verdict = 'APPROVED';
      if (r.code === 'T3') {
        r.verdict = 'EDITED';
        r.answer_json = '{"optionId":';
      }
    });
    expect(() => readReview(text, current)).toThrow(
      /line 2: verdict must be[\s\S]*line 3: unknown item NOPE[\s\S]*line 4 \(T3\): edited JSON does not parse/,
    );
  });
});
