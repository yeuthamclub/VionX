import { describe, expect, it } from 'vitest';
import type { ItemTemplate, PackageGroup, PackageItem } from '@vionx/domain';
import { checkGroup, checkItem, type ItemCheckContext } from '../src/lib/checks.ts';
import type { PlanSlot } from '../src/lib/plan.ts';
import { NgramIndex } from '../src/lib/text.ts';

const SOURCE =
  'Chu vi của hình chữ nhật bằng hai lần tổng của chiều dài và chiều rộng của hình chữ nhật đó.';

const hints = (n = 4) => Array.from({ length: n }, (_, i) => ({ md: `Gợi ý ${i + 1}.` }));

function base(over: Partial<PackageItem> = {}): PackageItem {
  return {
    code: 'MATH.6.G.T.S.Q01',
    kind: 'STATIC',
    skills: ['MATH.6.G.T.S'],
    difficulty: 2,
    cognitiveLevel: 'L2',
    type: 'single_choice',
    stemMd: 'Tính $\\frac{1}{2} + \\frac{1}{4}$.',
    media: [],
    options: [
      { id: 'a', text: '$\\frac{3}{4}$' },
      { id: 'b', text: '$\\frac{2}{6}$' },
      { id: 'c', text: '$\\frac{1}{8}$' },
    ],
    answer: { optionId: 'a' },
    explanationMd: 'Quy đồng mẫu số rồi cộng tử.',
    hints: hints(),
    workedSolutionMd: '$\\frac{1}{2} = \\frac{2}{4}$, nên tổng là $\\frac{3}{4}$.',
    distractorFeedback: {
      b: { md: 'Không cộng tử với tử, mẫu với mẫu.', misconception: 'ADD_ACROSS' },
    },
    misconceptionTags: ['ADD_ACROSS'],
    sourceRefs: [],
    provenance: { answerCheckExpr: '1/2 + 1/4' },
    status: 'AI_GENERATED',
    ...over,
  };
}

const slotFor = (item: PackageItem, over: Partial<PlanSlot> = {}): PlanSlot => ({
  id: item.code,
  skill: item.skills[0]!,
  level: item.cognitiveLevel,
  difficulty: item.difficulty,
  kind: item.kind,
  type: item.type,
  svg: false,
  ...over,
});

function ctx(item: PackageItem, over: Partial<ItemCheckContext> = {}): ItemCheckContext {
  const ngram = new NgramIndex(10);
  ngram.add(SOURCE);
  return {
    slot: slotFor(item),
    ngram,
    seen: new Map(),
    media: new Map(),
    readAloud: false,
    templateSeeds: 1000,
    ...over,
  };
}

const failing = (item: PackageItem, over: Partial<ItemCheckContext> = {}) =>
  checkItem(item, ctx(item, over))
    .filter((c) => !c.ok)
    .map((c) => `${c.check}: ${c.message}`);

const template: ItemTemplate = {
  item: 'MATH.6.G.T.S.Q02',
  params: [
    { name: 'a', type: 'int', min: 5, max: 20 },
    { name: 'b', type: 'int', min: 2, max: 12 },
  ],
  constraints: ['a > b'],
  answerExpr: 'a * b',
  distractorExprs: ['2 * (a + b)', 'a + b'],
  render: {
    stem: 'Hình chữ nhật dài {{a}} cm, rộng {{b}} cm. Diện tích là bao nhiêu $\\text{cm}^2$?',
  },
};
const templateItem = base({
  code: 'MATH.6.G.T.S.Q02',
  kind: 'TEMPLATE',
  stemMd: 'Diện tích hình chữ nhật (đề sinh từ mẫu).',
  options: [],
  answer: null,
  distractorFeedback: { d1: { md: 'Đó là chu vi.' } },
  provenance: {},
});

describe('checkItem', () => {
  it('passes a well-formed item and a well-formed template', () => {
    expect(failing(base())).toEqual([]);
    expect(failing(templateItem, { template })).toEqual([]);
  });

  it('slot: kind, type, skill and planned figure must match the approved plan', () => {
    const item = base();
    expect(failing(item, { slot: slotFor(item, { type: 'numeric' }) })[0]).toMatch(
      /^slot: type single_choice ≠ numeric/,
    );
    expect(failing(item, { slot: slotFor(item, { svg: true }) })[0]).toMatch(
      /planned figure missing/,
    );
    expect(
      checkItem(item, { ...ctx(item), slot: undefined }).find((c) => c.check === 'slot')?.ok,
    ).toBe(false);
  });

  it('schema: 4 hints, answer shape, feedback keys, template present', () => {
    expect(failing(base({ hints: hints(3) }))).toEqual(['schema: needs exactly 4 hints (has 3)']);
    expect(failing(base({ answer: { optionId: 'z' } }))).toEqual([
      'schema: answer.optionId must name an option',
    ]);
    expect(failing(base({ distractorFeedback: { z: { md: 'x' } } }))).toEqual([
      'schema: feedback for unknown options z',
    ]);
    expect(failing(templateItem)).toEqual(['schema: TEMPLATE item without a template']);
  });

  it('one_correct: no two options alike, no feedback on the key', () => {
    const twin = base({
      options: [
        { id: 'a', text: '$\\frac{3}{4}$' },
        { id: 'b', text: '$\\frac{3}{4}$' },
      ],
      distractorFeedback: {},
    });
    expect(failing(twin, { slot: slotFor(twin) })[0]).toMatch(/^one_correct: two options read/);
    expect(failing(base({ distractorFeedback: { a: { md: 'x' } } }))).toContain(
      'one_correct: the correct option a has distractor feedback',
    );
  });

  it('recompute: math.js recomputes the key (choice, numeric, fill_blank, true_false)', () => {
    expect(failing(base({ answer: { optionId: 'b' }, distractorFeedback: {} }))[0]).toMatch(
      /^recompute: option a equals 1\/2 \+ 1\/4 = 0.75, key is b/,
    );
    const numeric = base({
      type: 'numeric',
      options: [],
      answer: { value: 0.7 },
      distractorFeedback: {},
    });
    expect(failing(numeric, { slot: slotFor(numeric) })).toEqual([
      'recompute: key 0.7 ≠ 1/2 + 1/4 = 0.75',
    ]);
    const noExpr = { ...numeric, answer: { value: 0.75 }, provenance: {} };
    expect(failing(noExpr, { slot: slotFor(noExpr) })).toEqual([
      'recompute: numeric items need answerCheckExpr',
    ]);
    const blank = base({
      type: 'fill_blank',
      stemMd: 'Tổng là ___.',
      options: [],
      answer: { blanks: [['0,75', '3/4']] },
      distractorFeedback: {},
    });
    expect(failing(blank, { slot: slotFor(blank) })).toEqual([]);
    const tf = base({
      type: 'true_false',
      stemMd: '$\\frac{1}{2} > \\frac{1}{3}$ đúng hay sai?',
      options: [],
      answer: { value: false },
      distractorFeedback: {},
      provenance: { answerCheckExpr: '1/2 > 1/3' },
    });
    expect(failing(tf, { slot: slotFor(tf) })).toEqual(['recompute: key false ≠ 1/2 > 1/3 = true']);
  });

  it('katex: every math span parses, template variants too', () => {
    expect(failing(base({ workedSolutionMd: 'Ta có $\\frac{1}{2$.' }))[0]).toMatch(/^katex: KaTeX/);
    expect(failing(base({ explanationMd: 'Giá $5 nghìn.' }))[0]).toMatch(/^katex: unbalanced \$/);
    const bad = { ...template, render: { stem: 'Tính $\\fracc{{{a}}}{{{b}}}$.' } };
    expect(failing(templateItem, { template: bad })[0]).toMatch(/^katex: variant seed 0: KaTeX/);
  });

  it('template_seeds: constraints hold over 1,000 seeds', () => {
    const impossible = { ...template, constraints: ['a > b', 'a > 100'] };
    expect(failing(templateItem, { template: impossible })[0]).toMatch(
      /^template_seeds: seed 0: no parameters satisfied/,
    );
  });

  it('ngram: refuses 10+ words copied from the source books', () => {
    const copied = base({ workedSolutionMd: `${SOURCE} Do đó chu vi là $22$ cm.` });
    expect(failing(copied)[0]).toMatch(
      /^ngram: \d+ 10-grams copied from the source books \(longest run 21 words\)/,
    );
  });

  it('duplicate: same normalised stem and options as an earlier item', () => {
    const seen = new Map<string, string>();
    expect(failing(base(), { seen })).toEqual([]);
    const again = base({
      code: 'MATH.6.G.T.S.Q09',
      stemMd: 'Tính  $\\frac{1}{2}$ + $\\frac{1}{4}$ !',
    });
    expect(failing(again, { seen, slot: slotFor(again) })).toEqual([
      'duplicate: same text as MATH.6.G.T.S.Q01',
    ]);
  });

  it('tts: required for stem, options and hints when the profile reads aloud', () => {
    expect(failing(base(), { readAloud: true })).toEqual([
      'tts: tts text missing: stem, options, hints',
    ]);
    const spoken = base({
      ttsText: 'Tính một phần hai cộng một phần tư.',
      options: base().options.map((o) => ({ ...o, ttsText: 'x' })),
      hints: hints().map((h) => ({ ...h, ttsText: h.md })),
    });
    expect(failing(spoken, { readAloud: true })).toEqual([]);
  });

  it('svg: figures must exist, sanitise cleanly and render', () => {
    const item = base({ media: ['FIG1'] });
    expect(failing(item)).toEqual(['svg: media FIG1 is not in media.jsonl']);
    const media = new Map([
      ['FIG1', { code: 'FIG1', ok: false, message: 'sanitiser removed <script>' }],
    ]);
    expect(failing(item, { media })).toEqual(['svg: media FIG1: sanitiser removed <script>']);
    expect(failing(item, { media: new Map([['FIG1', { code: 'FIG1', ok: true }]]) })).toEqual([]);
  });
});

describe('checkGroup (passages)', () => {
  const group: PackageGroup = {
    code: 'G1',
    stimulusKind: 'PASSAGE',
    title: 'Khu vườn',
    bodyMd: 'Nhà bà có một khu vườn nhỏ. Mùa xuân, hoa cải nở vàng cả góc vườn.',
    media: [],
    sourceKind: 'ORIGINAL_AI',
    status: 'AI_GENERATED',
  };
  const ngram = new NgramIndex(10);
  ngram.add(SOURCE);

  it('checks word count and sentence length within the profile range', () => {
    expect(
      checkGroup(group, ngram, { minWords: 10, maxWords: 40, maxSentenceWords: 12 }).every(
        (c) => c.ok,
      ),
    ).toBe(true);
    const r = checkGroup(group, ngram, { minWords: 80, maxWords: 150, maxSentenceWords: 8 }).find(
      (c) => !c.ok,
    );
    expect(r?.message).toBe('16 words (range 80-150); a sentence of 9 words (max 8)');
  });

  it('refuses passages copied from the books', () => {
    expect(checkGroup({ ...group, bodyMd: SOURCE }, ngram)[0]!.ok).toBe(false);
  });
});
