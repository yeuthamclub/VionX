import { describe, expect, it } from 'vitest';
import { coverageReport, libraryAcceptance, type CoverageItem } from './coverage.ts';
import { subjectProfile } from './profiles.ts';

const math6 = subjectProfile(6, 'math')!;
const skills = Array.from({ length: 50 }, (_, i) => ({ code: `MATH.6.D.T.S${i}`, title: `s${i}` }));

function items(n: number, templateEvery: number): CoverageItem[] {
  return Array.from({ length: n }, (_, i) => ({
    skills: [skills[i % skills.length]!.code],
    kind: i % templateEvery === 0 ? 'TEMPLATE' : 'STATIC',
    type: 'numeric',
    cognitiveLevel: i % 2 ? 'L1' : 'L3',
    status: 'APPROVED',
    inGroup: false,
    hasTts: false,
  }));
}

describe('libraryAcceptance (X01 acceptance)', () => {
  it('passes a 500-item library with 40% templates and every skill covered', () => {
    const list = items(500, 1).map(
      (it, i) => ({ ...it, kind: i % 5 < 2 ? 'TEMPLATE' : 'STATIC' }) as CoverageItem,
    );
    const result = libraryAcceptance(coverageReport(skills, list, math6), math6);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails below 480 approved, with a thin skill, and with TEMPLATE drift beyond ±5 points', () => {
    const list = items(300, 10); // 10% TEMPLATE
    const result = libraryAcceptance(
      coverageReport([...skills, { code: 'MATH.6.D.T.EMPTY', title: 'x' }], list, math6),
      math6,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/300 approved items/);
    expect(result.problems.join('\n')).toMatch(/MATH\.6\.D\.T\.EMPTY/);
    expect(result.problems.join('\n')).toMatch(/TEMPLATE share 10%/);
  });

  it('ignores skills outside the active list', () => {
    const list = items(500, 1).map(
      (it, i) => ({ ...it, kind: i % 5 < 2 ? 'TEMPLATE' : 'STATIC' }) as CoverageItem,
    );
    const all = [...skills, { code: 'MATH.6.D.T.OFF', title: 'inactive' }];
    const result = libraryAcceptance(coverageReport(all, list, math6), math6, {
      activeSkills: skills.map((s) => s.code),
    });
    expect(result.ok).toBe(true);
  });
});
