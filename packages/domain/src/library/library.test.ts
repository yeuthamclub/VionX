import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coverageReport, type CoverageItem } from './coverage.ts';
import { canonicalJson, diffEntities, isNoopDiff } from './diff.ts';
import { sanitizeSvg } from './svg.ts';
import type { LibraryPackage, PackageItem } from './types.ts';
import { answerProblem, findPrerequisiteCycle, validateLibraryPackage } from './validate.ts';
import {
  MAX_VARIANT_TRIES,
  probeTemplate,
  renderVariant,
  seededRandom,
  type VariantTemplate,
} from './variants.ts';

const ADD_CARRY: VariantTemplate = {
  item: 'T2-ADD-CARRY',
  type: 'single_choice',
  params: [
    { name: 'a', type: 'int', min: 10, max: 89 },
    { name: 'b', type: 'int', min: 2, max: 9 },
  ],
  constraints: ['mod(a, 10) + b >= 10', 'a + b < 100'],
  answerExpr: 'a + b',
  distractorExprs: ['a + b - 10', 'a + b + 1', 'a + b - 1'],
  render: { stem: '${{a}} + {{b}} = ?$', ttsText: '{{a}} cộng {{b}} bằng bao nhiêu?' },
};

const FRACTION_ADD: VariantTemplate = {
  item: 'T6-FRAC-ADD',
  type: 'single_choice',
  params: [
    { name: 'n', type: 'int', min: 5, max: 15 },
    { name: 'a', type: 'int', min: 1, max: 9 },
    { name: 'b', type: 'int', min: 2, max: 9 },
  ],
  constraints: ['a + b < n', 'gcd(a + b, n) == 1', 'a * b != a + b'],
  answerExpr: 'concat("$\\\\frac{", string(a + b), "}{", string(n), "}$")',
  distractorExprs: [
    'concat("$\\\\frac{", string(a + b), "}{", string(2 * n), "}$")',
    'concat("$\\\\frac{", string(a * b), "}{", string(n), "}$")',
  ],
  render: { stem: 'Tính $\\frac{{{a}}}{{{n}}} + \\frac{{{b}}}{{{n}}}$' },
};

const SPELLING: VariantTemplate = {
  item: 'TV2-SX',
  type: 'spelling_choice',
  params: [
    {
      name: 'w',
      type: 'words',
      list: [
        { word: '…ân trường', answer: 's', wrong: 'x' },
        { word: '…e đạp', answer: 'x', wrong: 's' },
        { word: 'hoa …en', answer: 's', wrong: 'x' },
      ],
    },
  ],
  constraints: [],
  answerExpr: 'w.answer',
  distractorExprs: ['w.wrong'],
  render: { stem: 'Điền **s** hay **x**: {{w.word}}', ttsText: 'Điền s hay x' },
};

const DECIMAL: VariantTemplate = {
  item: 'T6-DEC',
  type: 'numeric',
  params: [{ name: 'x', type: 'decimal', min: 0.1, max: 3, step: 0.1 }],
  constraints: [],
  answerExpr: 'x * 3',
  distractorExprs: [],
  render: { stem: '${{x}} \\times 3 = ?$' },
};

describe('renderVariant', () => {
  it('is deterministic per seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        for (const t of [ADD_CARRY, FRACTION_ADD, SPELLING, DECIMAL]) {
          expect(renderVariant(t, seed)).toEqual(renderVariant(t, seed));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('holds the constraints, keeps the answer out of the distractors and marks it (10,000 seeds)', () => {
    for (const t of [ADD_CARRY, FRACTION_ADD, SPELLING]) {
      for (let seed = 0; seed < 10_000; seed++) {
        const r = renderVariant(t, seed);
        if (!r.ok) throw new Error(`${t.item} seed ${seed}: ${r.message}`);
        const v = r.value;
        if (t === ADD_CARRY) {
          const a = v.params.a as number;
          const b = v.params.b as number;
          expect((a % 10) + b).toBeGreaterThanOrEqual(10);
          expect(v.answerValue).toBe(a + b);
        }
        const texts = v.options.map((o) => o.text);
        expect(new Set(texts).size).toBe(texts.length);
        const correct = v.options.find((o) => 'optionId' in v.answer && o.id === v.answer.optionId);
        expect(correct?.text).toBe(String(v.answerValue));
        expect(v.distractors).not.toContain(String(v.answerValue));
        expect(Object.keys(v.optionFeedbackKeys)).toHaveLength(t.distractorExprs.length);
      }
    }
  }, 60_000);

  it('renders placeholders, KaTeX and Vietnamese decimal commas', () => {
    const v = renderVariant(FRACTION_ADD, 42);
    expect(v.ok && v.value.stemMd).toMatch(
      /^Tính \$\\frac\{\d+\}\{\d+\} \+ \\frac\{\d+\}\{\d+\}\$$/,
    );
    expect(v.ok && v.value.options.every((o) => /^\$\\frac\{\d+\}\{\d+\}\$$/.test(o.text!))).toBe(
      true,
    );
    const d = renderVariant(DECIMAL, 3);
    expect(d.ok && d.value).toMatchObject({ answer: { value: expect.any(Number) } });
    expect(d.ok && d.value.stemMd).toMatch(/^\$\d,\d \\times 3 = \?\$$|^\$\d \\times 3 = \?\$$/);
    // No floating noise: 0.1 * 3 is 0.3.
    for (let seed = 0; seed < 500; seed++) {
      const r = renderVariant(DECIMAL, seed);
      expect(r.ok && String(r.value.answerValue)).toMatch(/^\d+(\.\d)?$/);
    }
  });

  it('flags a template whose constraints cannot hold after MAX_VARIANT_TRIES', () => {
    const r = renderVariant({ ...ADD_CARRY, constraints: ['a > 1000'] }, 1);
    expect(r).toMatchObject({ ok: false, error: 'CONSTRAINTS_UNSATISFIABLE' });
    expect(MAX_VARIANT_TRIES).toBe(50);
  });

  it('treats distractors equal to the answer as a failed draw', () => {
    const r = renderVariant({ ...ADD_CARRY, distractorExprs: ['b + a'] }, 1);
    expect(r).toMatchObject({ ok: false, error: 'CONSTRAINTS_UNSATISFIABLE' });
  });

  it('refuses unsafe math.js functions and impossible template types', () => {
    for (const expr of ['import({x: 1})', 'evaluate("1+1")', 'createUnit("foo")', 'parse("1")']) {
      expect(renderVariant({ ...ADD_CARRY, answerExpr: expr }, 1)).toMatchObject({
        ok: false,
        error: 'INVALID_TEMPLATE',
      });
    }
    expect(renderVariant({ ...ADD_CARRY, type: 'matching' }, 1)).toMatchObject({
      ok: false,
      error: 'INVALID_TEMPLATE',
    });
    expect(renderVariant({ ...ADD_CARRY, distractorExprs: [] }, 1)).toMatchObject({
      ok: false,
      error: 'INVALID_TEMPLATE',
    });
  });

  it('probeTemplate reports the first failing seed', () => {
    expect(probeTemplate(ADD_CARRY, 100)).toEqual({ ok: true });
    expect(probeTemplate({ ...ADD_CARRY, constraints: ['a < 0'] }, 10, 5)).toMatchObject({
      ok: false,
      seed: 5,
    });
  });

  it('seededRandom stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (seed) => {
        const r = seededRandom(seed);
        for (let i = 0; i < 20; i++) {
          const x = r();
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      }),
    );
  });
});

describe('sanitizeSvg', () => {
  it('keeps clean drawings unchanged', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="5" cy="5" r="4" fill="#e33"/><use href="#a"/></svg>';
    expect(sanitizeSvg(svg)).toEqual({ ok: true, value: { svg, removed: [] } });
  });

  it('removes scripts, handlers, external references and foreign content', () => {
    const r = sanitizeSvg(
      '<svg onload="x()"><script>alert(1)</script><image href="https://evil/x.png"/><use xlink:href="http://e/x#a"/><rect fill="url(https://e/p)" stroke="url(#ok)"/><foreignObject><div/></foreignObject><a href="javascript:x()"><rect/></a></svg>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.svg).toBe('<svg><use/><rect stroke="url(#ok)"/></svg>');
    expect(r.value.svg).not.toMatch(/script|onload|http|javascript|foreign/i);
    expect(r.value.removed).toEqual(
      expect.arrayContaining([
        'svg@onload',
        '<script>',
        '<image>',
        'use@xlink:href',
        'rect@fill',
        '<foreignObject>',
        '<a>',
      ]),
    );
  });

  it('sees through character references and CSS escapes that hide external references', () => {
    const r = sanitizeSvg(
      '<svg><rect fill="u&#114;l(http://evil/x)"/><rect fill="u&#x72;l(#ok)"/><circle stroke="u\\72l(http://evil/y)"/><use href="&#35;a"/><path d="M0 0" fill="&#106;avascript:x"/></svg>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.svg).toBe(
      '<svg><rect/><rect fill="u&#x72;l(#ok)"/><circle/><use href="&#35;a"/><path d="M0 0"/></svg>',
    );
    expect(r.value.svg).not.toMatch(/evil|javascript|&#106;/i);
    expect(sanitizeSvg('<svg><rect fill="&#99999999;"/></svg>').ok).toBe(true);
  });

  it('rejects DOCTYPE/ENTITY, non-svg roots and broken markup', () => {
    for (const bad of [
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
      '<html><svg/></html>',
      '<svg><g></svg>',
      '<svg></svg><svg></svg>',
      'plain text',
    ]) {
      expect(sanitizeSvg(bad).ok).toBe(false);
    }
  });
});

// --- Package validation -------------------------------------------------------------------------

const hints = [1, 2, 3, 4].map((n) => ({ md: `Gợi ý ${n}` }));

function item(over: Partial<PackageItem> = {}): PackageItem {
  return {
    code: 'I1',
    kind: 'STATIC',
    skills: ['S.A'],
    difficulty: 1,
    cognitiveLevel: 'L1',
    type: 'single_choice',
    stemMd: '1 + 1 = ?',
    media: [],
    options: [
      { id: 'a', text: '2' },
      { id: 'b', text: '3' },
    ],
    answer: { optionId: 'a' },
    explanationMd: '',
    hints,
    workedSolutionMd: '',
    distractorFeedback: { b: { md: 'Đếm lại nhé', misconception: 'COUNT_ON' } },
    misconceptionTags: ['COUNT_ON'],
    sourceRefs: [],
    provenance: {},
    status: 'APPROVED',
    ...over,
  };
}

function pkg(over: Partial<LibraryPackage> = {}): LibraryPackage {
  return {
    manifest: {
      format: 1,
      curriculumVersion: 'v',
      grade: 2,
      subject: 'math',
      title: 'Toán 2',
      counts: {},
      checksums: {},
      models: [],
      reviewer: null,
      createdAt: '2026-10-13T00:00:00Z',
    },
    curriculum: {
      version: { code: 'v', title: 'GDPT 2018' },
      nodes: [
        { code: 'G2', parent: null, level: 'GRADE', title: 'Lớp 2' },
        { code: 'S', parent: 'G2', level: 'SUBJECT', title: 'Toán' },
        { code: 'S.D', parent: 'S', level: 'DOMAIN', title: 'Số' },
        { code: 'S.A', parent: 'S.D', level: 'SKILL', title: 'Cộng' },
        { code: 'S.B', parent: 'S.D', level: 'SKILL', title: 'Trừ' },
      ],
    },
    edges: [{ from: 'S.A', to: 'S.B', type: 'PREREQUISITE_OF' }],
    mappings: { series: [], mappings: [] },
    groups: [],
    items: [item(), item({ code: 'I2', skills: ['S.B'] })],
    templates: [],
    media: [],
    svgFiles: {},
    ...over,
  };
}

const codes = (p: LibraryPackage) => validateLibraryPackage(p).errors.map((e) => e.code);

describe('validateLibraryPackage', () => {
  it('accepts a consistent package', () => {
    expect(validateLibraryPackage(pkg()).errors).toEqual([]);
  });

  it('rejects PREREQUISITE_OF cycles with a readable path', () => {
    const p = pkg({
      edges: [
        { from: 'S.A', to: 'S.B', type: 'PREREQUISITE_OF' },
        { from: 'S.B', to: 'S.A', type: 'PREREQUISITE_OF' },
        { from: 'S.A', to: 'S.B', type: 'RELATED_TO' },
      ],
    });
    const errors = validateLibraryPackage(p).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'PREREQUISITE_CYCLE' });
    expect(errors[0]!.message).toBe('PREREQUISITE_OF edges form a cycle: S.A → S.B → S.A');
  });

  it('finds cycles of any length and ignores DAGs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), (n) => {
        const chain = Array.from({ length: n - 1 }, (_, i) => ({ from: `N${i}`, to: `N${i + 1}` }));
        expect(findPrerequisiteCycle(chain)).toBeNull();
        const cycle = findPrerequisiteCycle([...chain, { from: `N${n - 1}`, to: 'N0' }]);
        expect(cycle).toHaveLength(n + 1);
        expect(cycle![0]).toBe(cycle![n]);
      }),
    );
  });

  it('rejects orphan skills and broken references', () => {
    const p = pkg();
    p.curriculum.nodes.push({ code: 'X.Y', parent: 'NOPE', level: 'SKILL', title: 'Lạc' });
    p.items.push(item({ code: 'I3', skills: ['S.D'], group: 'G?', groupOrder: 1 }));
    p.edges.push({ from: 'S.A', to: 'ZZ', type: 'RELATED_TO' });
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        'UNKNOWN_PARENT',
        'ORPHAN_SKILL',
        'NOT_A_SKILL',
        'UNKNOWN_GROUP',
        'UNKNOWN_NODE',
      ]),
    );
  });

  it('requires a source note on PUBLIC_DOMAIN and LICENSED groups', () => {
    const group = {
      code: 'G1',
      stimulusKind: 'POEM' as const,
      title: 'Ca dao',
      bodyMd: 'Công cha như núi Thái Sơn',
      media: [],
      sourceKind: 'PUBLIC_DOMAIN' as const,
      status: 'APPROVED' as const,
    };
    expect(codes(pkg({ groups: [group] }))).toContain('SOURCE_NOTE_REQUIRED');
    expect(codes(pkg({ groups: [{ ...group, sourceNote: 'Ca dao Việt Nam' }] }))).not.toContain(
      'SOURCE_NOTE_REQUIRED',
    );
    expect(codes(pkg({ groups: [{ ...group, sourceKind: 'ORIGINAL_AI' }] }))).not.toContain(
      'SOURCE_NOTE_REQUIRED',
    );
  });

  it('checks hint ladders, rubrics and template pairing', () => {
    expect(codes(pkg({ items: [item({ hints: hints.slice(0, 3) })] }))).toContain('HINT_LADDER');
    expect(codes(pkg({ items: [item({ type: 'written', answer: null })] }))).toContain(
      'RUBRIC_REQUIRED',
    );
    expect(codes(pkg({ items: [item({ kind: 'TEMPLATE' })] }))).toContain('MISSING_TEMPLATE');
    expect(codes(pkg({ items: [item({ kind: 'TEMPLATE', type: 'matching' })] }))).toContain(
      'TEMPLATE_TYPE',
    );
    const template = { ...ADD_CARRY, item: 'I1' };
    expect(
      codes(pkg({ items: [item({ kind: 'TEMPLATE', answer: null })], templates: [template] })),
    ).toEqual([]);
    expect(
      codes(
        pkg({
          items: [item({ kind: 'TEMPLATE', answer: null })],
          templates: [{ ...template, constraints: ['a < 0'] }],
        }),
      ),
    ).toContain('TEMPLATE_UNSATISFIABLE');
  });

  it('sanitises SVG media and reports missing files', () => {
    const media = [
      {
        code: 'M1',
        kind: 'SVG' as const,
        file: 'm1.svg',
        alt: 'táo',
        license: 'CC0',
        reviewStatus: 'APPROVED' as const,
      },
      {
        code: 'M2',
        kind: 'SVG' as const,
        file: 'm2.svg',
        alt: 'lê',
        license: 'CC0',
        reviewStatus: 'APPROVED' as const,
      },
    ];
    const v = validateLibraryPackage(
      pkg({ media, svgFiles: { 'm1.svg': '<svg><script>x</script><circle r="1"/></svg>' } }),
    );
    expect(v.sanitisedSvg.M1).toBe('<svg><circle r="1"/></svg>');
    expect(v.warnings.map((w) => w.code)).toContain('SVG_SANITISED');
    expect(v.errors.map((e) => e.code)).toEqual(['MISSING_MEDIA_FILE']);
  });
});

describe('answerProblem', () => {
  const opts = (...ids: string[]) => ids.map((id) => ({ id, text: id }));
  it('accepts each item type with its answer shape', () => {
    const ok: Pick<PackageItem, 'type' | 'options' | 'answer'>[] = [
      { type: 'single_choice', options: opts('a', 'b'), answer: { optionId: 'b' } },
      { type: 'multi_choice', options: opts('a', 'b', 'c'), answer: { optionIds: ['a', 'c'] } },
      { type: 'numeric', options: [], answer: { value: 12.5 } },
      { type: 'true_false', options: [], answer: { value: false } },
      { type: 'fill_blank', options: [], answer: { blanks: [['xe', 'xe đạp']] } },
      { type: 'word_bank', options: opts('a', 'b'), answer: { blankOptionIds: ['b', 'a'] } },
      { type: 'ordering', options: opts('a', 'b', 'c'), answer: { order: ['c', 'a', 'b'] } },
      {
        type: 'matching',
        options: [
          { id: 'l1', side: 'left' },
          { id: 'r1', side: 'right' },
        ],
        answer: { pairs: [['l1', 'r1']] },
      },
      { type: 'written', options: [], answer: null },
    ];
    for (const i of ok) expect(answerProblem(i)).toBeNull();
  });

  it('rejects mismatched shapes', () => {
    expect(
      answerProblem({ type: 'single_choice', options: opts('a'), answer: { optionId: 'z' } }),
    ).not.toBeNull();
    expect(
      answerProblem({ type: 'ordering', options: opts('a', 'b'), answer: { order: ['a'] } }),
    ).not.toBeNull();
    expect(answerProblem({ type: 'numeric', options: [], answer: { value: true } })).not.toBeNull();
    expect(answerProblem({ type: 'written', options: [], answer: { value: 1 } })).not.toBeNull();
    // Every left option is paired once: a repeated left leaves another one unpaired.
    expect(
      answerProblem({
        type: 'matching',
        options: [
          { id: 'l1', side: 'left' },
          { id: 'l2', side: 'left' },
          { id: 'r1', side: 'right' },
          { id: 'r2', side: 'right' },
        ],
        answer: {
          pairs: [
            ['l1', 'r1'],
            ['l1', 'r2'],
          ],
        },
      }),
    ).not.toBeNull();
  });
});

describe('coverageReport', () => {
  const cov = (over: Partial<CoverageItem>): CoverageItem => ({
    skills: ['A'],
    kind: 'STATIC',
    type: 'single_choice',
    cognitiveLevel: 'L1',
    status: 'APPROVED',
    inGroup: false,
    hasTts: true,
    ...over,
  });
  it('counts per skill and flags inactive skills and profile drift', () => {
    const report = coverageReport(
      [
        { code: 'A', title: 'A' },
        { code: 'B', title: 'B' },
      ],
      [
        cov({}),
        cov({ cognitiveLevel: 'L3', kind: 'TEMPLATE' }),
        cov({ skills: ['B'], status: 'NEEDS_REVIEW' }),
        cov({ skills: ['B'], status: 'ARCHIVED' }),
      ],
      { templateShare: 0.5, groupShare: 0, writtenShare: 0, readAloudDefault: true },
    );
    expect(report.totalItems).toBe(3);
    expect(report.approvedItems).toBe(2);
    expect(report.perSkill[0]).toMatchObject({
      code: 'A',
      items: 2,
      approved: 2,
      active: true,
      levelSpread: true,
    });
    expect(report.inactiveSkills).toEqual(['B']);
    expect(report.templateShare).toBe(0.333);
    expect(report.flags).toEqual(
      expect.arrayContaining(['3 of 500 items', 'TEMPLATE share 33% vs profile 50%']),
    );
  });
});

describe('import diff', () => {
  it('canonical JSON ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: 'x' }] })).toBe(
      '{"a":[1,{"c":"x"}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('adds, updates, archives, restores and recognises a no-op', () => {
    const existing = new Map([
      ['A', { hash: '1', archived: false }],
      ['B', { hash: '2', archived: false }],
      ['C', { hash: '3', archived: false }],
      ['D', { hash: '4', archived: true }],
    ]);
    const diff = diffEntities(
      existing,
      new Map([
        ['A', '1'],
        ['B', '2b'],
        ['D', '4'],
        ['E', '5'],
      ]),
    );
    expect(diff).toEqual({
      added: ['E'],
      updated: ['B', 'D'],
      archived: ['C'],
      restored: ['D'],
      unchanged: 1,
    });
    expect(isNoopDiff({ items: diff })).toBe(false);
    const same = diffEntities(
      existing,
      new Map([
        ['A', '1'],
        ['B', '2'],
        ['C', '3'],
      ]),
    );
    expect(isNoopDiff({ items: same })).toBe(true);
  });
});
