import { describe, expect, it } from 'vitest';
import { libraryChoices } from './choices.ts';

const profile = (grade: number, subject: string, titleVi: string) => ({
  grade,
  subject,
  titleVi,
  templateShare: 0.3,
  groupShare: 0,
  writtenShare: 0,
  readAloudDefault: false,
  ttsLang: 'vi' as const,
  imageLevel: 'LOW' as const,
  itemTypeMix: {},
  targetItems: 500,
});

describe('libraryChoices', () => {
  it('lists imported libraries and launch profiles once, by grade', () => {
    const choices = libraryChoices({
      versions: [
        { id: 'v', code: 'gdpt2018', title: 'GDPT 2018', academicYear: null, status: 'ACTIVE' },
      ],
      libraries: [
        {
          curriculumVersion: 'gdpt2018',
          grade: 6,
          subject: 'math',
          titleVi: 'Toán 6',
          skills: 10,
          activeSkills: 4,
          items: 42,
          approvedItems: 30,
          lastImportAt: null,
        },
      ],
      profiles: [profile(6, 'math', 'Toán 6'), profile(2, 'viet', 'Tiếng Việt 2')],
    });
    expect(choices.map((c) => [c.key, c.label])).toEqual([
      ['2-viet', 'Lớp 2 · Tiếng Việt 2 (not imported)'],
      ['6-math', 'Lớp 6 · Toán 6 (42 items)'],
    ]);
    expect(choices[0]!.curriculumVersion).toBe('gdpt2018');
  });

  it('is empty without an overview', () => {
    expect(libraryChoices(undefined)).toEqual([]);
  });
});
