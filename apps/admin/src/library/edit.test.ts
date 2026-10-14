import { describe, expect, it } from 'vitest';
import {
  apiErrorText,
  changedFields,
  nullIfBlank,
  parseItemFilters,
  parseJsonField,
  randomSeed,
  sameJson,
  speechLang,
} from './edit.ts';

describe('item editor helpers', () => {
  it('parses JSON fields and reports syntax errors', () => {
    expect(parseJsonField('{"optionId":"a"}')).toEqual({ ok: true, value: { optionId: 'a' } });
    const bad = parseJsonField('{"optionId":');
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error).not.toBe('');
  });

  it('compares JSON ignoring key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson(null, null)).toBe(true);
  });

  it('keeps only changed fields for the PATCH', () => {
    const original = {
      stemMd: 'Tính $2+3$',
      difficulty: 2,
      options: [{ id: 'a', text: '5' }],
      ttsText: null as string | null,
      answer: { optionId: 'a' },
    };
    expect(
      changedFields(original, {
        stemMd: 'Tính $2+3$',
        difficulty: 3,
        options: [{ text: '5', id: 'a' }],
        ttsText: 'Hai cộng ba',
        answer: { optionId: 'a' },
      }),
    ).toEqual({ difficulty: 3, ttsText: 'Hai cộng ba' });
    expect(changedFields(original, {})).toEqual({});
  });

  it('turns blank text into null', () => {
    expect(nullIfBlank('  ')).toBeNull();
    expect(nullIfBlank('x')).toBe('x');
  });

  it('formats API errors', () => {
    expect(
      apiErrorText(
        { code: 'CONFLICT', message: 'The item changed since you loaded it; reload and try again' },
        409,
      ),
    ).toMatch(/newer version/);
    expect(
      apiErrorText(
        {
          code: 'VALIDATION_FAILED',
          message: 'exactly 4 hints are required',
          details: { problems: ['exactly 4 hints are required', 'written items need a rubric'] },
        },
        400,
      ),
    ).toBe('exactly 4 hints are required Also: written items need a rubric.');
    expect(apiErrorText(undefined, 403)).toMatch(/permission/);
    expect(apiErrorText(undefined, 500)).toBe('API responded 500');
  });

  it('maps TTS language and draws seeds in range', () => {
    expect(speechLang('en')).toBe('en-US');
    expect(speechLang(null)).toBe('vi-VN');
    expect(randomSeed(() => 0)).toBe(0);
    expect(randomSeed(() => 0.999999999999)).toBeLessThanOrEqual(0xffff_ffff);
  });

  it('parses item list filters from search params', () => {
    expect(
      parseItemFilters({
        grade: '6',
        subject: 'math',
        skill: ' MATH.6.NUM.FRAC.ADD ',
        status: 'APPROVED',
        kind: 'BOGUS',
        level: 'L2',
        q: '',
      }),
    ).toEqual({
      grade: 6,
      subject: 'math',
      skill: 'MATH.6.NUM.FRAC.ADD',
      status: 'APPROVED',
      level: 'L2',
    });
    expect(parseItemFilters({ grade: 13, type: 'numeric' })).toEqual({ type: 'numeric' });
  });
});
