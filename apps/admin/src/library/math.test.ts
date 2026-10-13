import { describe, expect, it } from 'vitest';
import { splitMath } from './math.ts';

describe('splitMath', () => {
  it('returns plain text as one segment', () => {
    expect(splitMath('Bé có 3 quả táo.')).toEqual([{ kind: 'text', text: 'Bé có 3 quả táo.' }]);
  });

  it('splits inline and display math', () => {
    expect(splitMath('Tính $3 + 4$ và $$\\frac{1}{2}$$ nhé')).toEqual([
      { kind: 'text', text: 'Tính ' },
      { kind: 'math', tex: '3 + 4', display: false },
      { kind: 'text', text: ' và ' },
      { kind: 'math', tex: '\\frac{1}{2}', display: true },
      { kind: 'text', text: ' nhé' },
    ]);
  });

  it('keeps escaped dollars and unclosed delimiters as text', () => {
    expect(splitMath('Giá \\$5')).toEqual([{ kind: 'text', text: 'Giá $5' }]);
    expect(splitMath('a $x + 1')).toEqual([{ kind: 'text', text: 'a $x + 1' }]);
    expect(splitMath('$$x')).toEqual([{ kind: 'text', text: '$$x' }]);
  });

  it('ignores empty formulas and escaped dollars inside math', () => {
    expect(splitMath('$$')).toEqual([{ kind: 'text', text: '$$' }]);
    expect(splitMath('$a\\$b$')).toEqual([{ kind: 'math', tex: 'a\\$b', display: false }]);
  });
});
