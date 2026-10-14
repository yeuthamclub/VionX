import { describe, expect, it } from 'vitest';
import {
  PackageGroupSchema,
  PackageItemSchema,
  PackageMediaSchema,
  TemplateParamSchema,
} from './library-package.ts';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

const ARCHIVED = 'ARCHIVED cannot be imported: leave the row out of the package to archive it';

describe('package schemas', () => {
  it('refuse ARCHIVED on items, groups and media with a readable error', () => {
    const item = {
      code: 'I1',
      kind: 'STATIC',
      skills: ['S.A'],
      difficulty: 1,
      cognitiveLevel: 'L1',
      type: 'true_false',
      stemMd: '1 + 1 = 2',
      answer: { value: true },
      hints: [],
      status: 'ARCHIVED',
    };
    const group = {
      code: 'G1',
      stimulusKind: 'PASSAGE',
      title: 't',
      bodyMd: 'b',
      sourceKind: 'ORIGINAL_AI',
      status: 'ARCHIVED',
    };
    const media = { code: 'M1', kind: 'ICON', alt: 'a', license: 'CC0-1.0' };
    expect(messages(PackageItemSchema.safeParse(item))).toEqual([ARCHIVED]);
    expect(messages(PackageGroupSchema.safeParse(group))).toEqual([ARCHIVED]);
    expect(messages(PackageMediaSchema.safeParse({ ...media, reviewStatus: 'ARCHIVED' }))).toEqual([
      ARCHIVED,
    ]);
    expect(PackageItemSchema.safeParse({ ...item, status: 'APPROVED' }).success).toBe(true);
    expect(PackageGroupSchema.safeParse({ ...group, status: 'DRAFT' }).success).toBe(true);
    expect(PackageMediaSchema.safeParse({ ...media, reviewStatus: 'APPROVED' }).success).toBe(true);
  });

  it('refuse a numeric template param whose min is above its max', () => {
    const int = { name: 'a', type: 'int', min: 9, max: 2 };
    expect(messages(TemplateParamSchema.safeParse(int))).toEqual([
      'min (9) must not be greater than max (2)',
    ]);
    expect(messages(TemplateParamSchema.safeParse({ ...int, type: 'decimal', step: 0.5 }))).toEqual(
      ['min (9) must not be greater than max (2)'],
    );
    expect(TemplateParamSchema.safeParse({ ...int, max: 9 }).success).toBe(true);
  });
});
