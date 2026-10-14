import { describe, expect, it } from 'vitest';
import { answersAgree } from '../src/lib/answers.ts';
import { katexProblem } from '../src/lib/katex-check.ts';
import { parseNumberText } from '../src/lib/math.ts';
import {
  classifyPage,
  NgramIndex,
  readingLevel,
  vietnameseScore,
  wordJaccard,
} from '../src/lib/text.ts';
import {
  normaliseEdges,
  normaliseLessons,
  requirementBullets,
  gdptSection,
} from '../src/steps/structure.ts';
import { bookKind, readingProblems } from '../src/steps/textlayer.ts';

const VI =
  'Bài 20. Chu vi và diện tích của một số tứ giác đã học. Hình chữ nhật có chiều dài và chiều rộng.';

describe('page quality (textlayer)', () => {
  it('keeps good Vietnamese text layers and routes everything else to the vision model', () => {
    expect(classifyPage({ text: VI, hasImage: false })).toBe('good');
    expect(classifyPage({ text: '', hasImage: true })).toBe('scanned');
    expect(classifyPage({ text: 'Trang 12', hasImage: true })).toBe('scanned');
    // TCVN3 (ABC) bytes read as Latin-1, and VNI tone codes.
    expect(
      classifyPage({
        text: 'Bµi 20. Chu vi vµ diÖn tÝch cña mét sè tø gi¸c ®· häc trong ch­¬ng nµy',
        hasImage: false,
      }),
    ).toBe('legacy-encoding');
    expect(
      classifyPage({
        text: 'Baøi 20. Chu vi vaø dieän tích cuûa moät soá töù giaùc ñaõ hoïc trong chöông',
        hasImage: false,
      }),
    ).toBe('legacy-encoding');
    expect(
      classifyPage({
        text: 'Bai 20. Chu vi va dien tich cua mot so tu giac da hoc trong chuong nay',
        hasImage: false,
      }),
    ).toBe('legacy-encoding');
    expect(
      classifyPage({
        text: 'Tính giá trị biểu thức: (3 + 4) × 5 = ? và 12 : 4 + 2^3 = ? rồi (5 − 2) × (7 + 1) = ?',
        hasImage: false,
      }),
    ).toBe('formula-heavy');
  });

  it('measures Vietnamese well-formedness and word overlap', () => {
    expect(vietnameseScore(VI).validRatio).toBe(1);
    expect(vietnameseScore('Hello world this is English').diacriticRatio).toBe(0);
    expect(wordJaccard('chu vi hình chữ nhật', 'Chu vi hình chữ nhật!')).toBe(1);
  });

  it('validates a model reading: KaTeX, diacritics, agreement with a partial text layer', () => {
    const blocks = [{ type: 'paragraph', text: VI, latex: null }];
    expect(readingProblems(blocks, '')).toEqual([]);
    expect(readingProblems([{ type: 'formula', text: 'C', latex: '\\frac{1}{' }], '')[0]).toMatch(
      /KaTeX/,
    );
    const ascii = [
      {
        type: 'paragraph',
        text: 'Bai 20 chu vi va dien tich cua mot so tu giac da hoc hinh chu nhat co chieu dai va chieu rong',
        latex: null,
      },
    ];
    expect(readingProblems(ascii, '')[0]).toMatch(/Vietnamese text check failed/);
    expect(
      readingProblems(blocks, 'Phân số và số thập phân trong đời sống hằng ngày của chúng ta')[0],
    ).toMatch(/differs from the partial text layer/);
  });

  it('classifies book kinds from file names', () => {
    expect(bookKind('Toan 6 - SGV tap 1.pdf')).toBe('SGV');
    expect(bookKind('SBT-Toan2.pdf')).toBe('SBT');
    expect(bookKind('Toan 6 tap 2.pdf')).toBe('SGK');
  });
});

describe('n-grams and reading level', () => {
  it('finds copied runs regardless of case and punctuation', () => {
    const index = new NgramIndex(5);
    index.add('Muốn cộng hai phân số cùng mẫu, ta cộng các tử và giữ nguyên mẫu.');
    expect(index.overlap('Ta CỘNG các tử, và giữ nguyên mẫu số').longestRun).toBe(8);
    expect(index.overlap('Cộng các tử số lại với nhau').shared).toBe(0);
  });

  it('counts words and the longest sentence', () => {
    expect(readingLevel('Một hai ba. Bốn năm sáu bảy!\nTám.')).toEqual({
      words: 8,
      maxSentenceWords: 4,
    });
  });
});

describe('numbers, KaTeX and answer comparison', () => {
  it('reads Vietnamese number formats', () => {
    expect(parseNumberText('2,5')).toBe(2.5);
    expect(parseNumberText('1.000.000')).toBe(1_000_000);
    expect(parseNumberText('$1\\;250$')).toBe(1250);
    expect(parseNumberText('$-\\dfrac{3}{4}$')).toBe(-0.75);
    expect(parseNumberText('$2\\frac{1}{2}$')).toBe(2.5);
    expect(parseNumberText('3/4')).toBe(0.75);
    expect(parseNumberText('25%')).toBe(0.25);
    expect(parseNumberText('Hình vuông')).toBeNull();
  });

  it('parses KaTeX spans', () => {
    expect(katexProblem(['$\\frac{1}{2}$ và $$x^2$$'])).toBeNull();
    expect(katexProblem(['$\\frac{1}{2$'])).toMatch(/KaTeX/);
  });

  it('compares the key with a blind answer per item type', () => {
    expect(answersAgree('single_choice', { optionId: 'b' }, { optionId: 'b' })).toBe(true);
    expect(answersAgree('single_choice', { optionId: 'b' }, { optionId: 'c' })).toBe(false);
    expect(answersAgree('multi_choice', { optionIds: ['a', 'c'] }, { optionIds: ['c', 'a'] })).toBe(
      true,
    );
    expect(answersAgree('numeric', { value: 0.75 }, { value: 0.75000000001 })).toBe(true);
    expect(answersAgree('numeric', { value: 2.5, tolerance: 0.1 }, { value: 2.45 })).toBe(true);
    expect(answersAgree('fill_blank', { blanks: [['3/4', '0,75']] }, { blanks: [['0.75']] })).toBe(
      true,
    );
    expect(answersAgree('fill_blank', { blanks: [['bốn']] }, { blanks: [['Bốn']] })).toBe(true);
    expect(answersAgree('true_false', { value: true }, { value: false })).toBe(false);
    expect(answersAgree('ordering', { order: ['b', 'a'] }, { order: ['a', 'b'] })).toBe(false);
    expect(
      answersAgree(
        'matching',
        {
          pairs: [
            ['l1', 'r2'],
            ['l2', 'r1'],
          ],
        },
        {
          pairs: [
            ['l2', 'r1'],
            ['l1', 'r2'],
          ],
        },
      ),
    ).toBe(true);
    expect(answersAgree('numeric', { value: 1 }, null)).toBe(false);
  });
});

describe('structure outputs', () => {
  it('cuts the grade section of the program text and its requirement bullets', () => {
    const text =
      'x\nLỚP 6\nNội dung\n– Nhận biết được số nguyên tố, hợp số.\n– Xác định được ước chung lớn nhất.\nLỚP 7\n– Không lấy dòng này nữa đâu.';
    const section = gdptSection(text, { file: '', afterLine: 0, from: 'LỚP 6', to: 'LỚP 7' });
    expect(requirementBullets(section)).toEqual([
      'Nhận biết được số nguyên tố, hợp số.',
      'Xác định được ước chung lớn nhất.',
    ]);
  });

  it('checks lesson page ranges and drops unknown skills', () => {
    const known = new Set(['A', 'B']);
    const ok = normaliseLessons(
      [
        { lessonRef: 'Bài 1', title: 't', pageStart: 5, pageEnd: null, skills: ['A', 'X'] },
        { lessonRef: 'Bài 2', title: 't', pageStart: 9, pageEnd: 12, skills: ['B'] },
      ],
      known,
      40,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.lessons[0]).toMatchObject({ pageEnd: 8, skills: ['A'] });
    expect(ok.warnings[0]).toMatch(/unknown skills dropped \(X\)/);
    const bad = normaliseLessons(
      [{ lessonRef: 'Bài 1', title: 't', pageStart: 9, pageEnd: 3, skills: [] }],
      known,
      40,
    );
    expect(bad.errors[0]).toMatch(/pageEnd 3 before pageStart 9/);
  });

  it('drops unknown and self edges and breaks prerequisite cycles', () => {
    const known = new Set(['A', 'B', 'C']);
    const { edges, warnings } = normaliseEdges(
      [
        { from: 'A', to: 'B', type: 'PREREQUISITE_OF' },
        { from: 'B', to: 'C', type: 'PREREQUISITE_OF' },
        { from: 'C', to: 'A', type: 'PREREQUISITE_OF' },
        { from: 'A', to: 'A', type: 'RELATED_TO' },
        { from: 'A', to: 'Z', type: 'RELATED_TO' },
      ],
      known,
    );
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C']);
    expect(warnings).toHaveLength(3);
  });
});
