// Subject profiles of the 8 launch libraries (CONTENT_PLAN_vi.md §3). Seeded into
// library.subject_profiles by migration 0008; a unit test keeps the two in sync.
import type { ItemType, TtsLang } from './types.ts';

export interface SubjectProfile {
  grade: number;
  subject: string;
  titleVi: string;
  templateShare: number;
  groupShare: number;
  writtenShare: number;
  readAloudDefault: boolean;
  ttsLang: TtsLang;
  imageLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  itemTypeMix: Partial<Record<ItemType, number>>;
  targetItems: number;
}

const p = (
  grade: number,
  subject: string,
  titleVi: string,
  templateShare: number,
  groupShare: number,
  writtenShare: number,
  readAloudDefault: boolean,
  ttsLang: TtsLang,
  imageLevel: SubjectProfile['imageLevel'],
  itemTypeMix: SubjectProfile['itemTypeMix'],
): SubjectProfile => ({
  grade,
  subject,
  titleVi,
  templateShare,
  groupShare,
  writtenShare,
  readAloudDefault,
  ttsLang,
  imageLevel,
  itemTypeMix,
  targetItems: 500,
});

export const SUBJECT_PROFILES: readonly SubjectProfile[] = [
  p(6, 'math', 'Toán 6', 0.4, 0, 0, false, 'vi', 'LOW', {
    single_choice: 0.35,
    numeric: 0.35,
    fill_blank: 0.1,
    multi_choice: 0.05,
    true_false: 0.05,
    ordering: 0.05,
    matching: 0.05,
  }),
  p(2, 'math', 'Toán 2', 0.5, 0, 0, true, 'vi', 'HIGH', {
    single_choice: 0.3,
    numeric: 0.3,
    picture_choice: 0.2,
    true_false: 0.05,
    ordering: 0.1,
    matching: 0.05,
  }),
  p(2, 'viet', 'Tiếng Việt 2', 0.1, 0.4, 0.05, true, 'vi', 'MEDIUM', {
    single_choice: 0.3,
    spelling_choice: 0.15,
    picture_choice: 0.15,
    word_bank: 0.1,
    fill_blank: 0.1,
    ordering: 0.05,
    matching: 0.05,
    true_false: 0.05,
    written: 0.05,
  }),
  p(6, 'lit', 'Ngữ văn 6', 0, 0.6, 0.1, false, 'vi', 'LOW', {
    single_choice: 0.5,
    multi_choice: 0.1,
    true_false: 0.1,
    matching: 0.05,
    ordering: 0.05,
    fill_blank: 0.1,
    written: 0.1,
  }),
  p(2, 'eng', 'Tiếng Anh 2', 0.1, 0.2, 0, true, 'en', 'HIGH', {
    picture_choice: 0.4,
    single_choice: 0.25,
    matching: 0.15,
    word_bank: 0.1,
    true_false: 0.1,
  }),
  p(6, 'eng', 'Tiếng Anh 6', 0.1, 0.35, 0.05, false, 'en', 'MEDIUM', {
    single_choice: 0.4,
    fill_blank: 0.15,
    word_bank: 0.1,
    matching: 0.1,
    ordering: 0.1,
    true_false: 0.1,
    written: 0.05,
  }),
  p(6, 'sci', 'Khoa học tự nhiên 6', 0.25, 0.15, 0, false, 'vi', 'MEDIUM', {
    single_choice: 0.45,
    numeric: 0.2,
    multi_choice: 0.1,
    true_false: 0.1,
    matching: 0.1,
    ordering: 0.05,
  }),
  p(2, 'natsoc', 'Tự nhiên và Xã hội 2', 0, 0.15, 0, true, 'vi', 'HIGH', {
    picture_choice: 0.35,
    single_choice: 0.3,
    true_false: 0.15,
    matching: 0.1,
    ordering: 0.1,
  }),
];

export const subjectProfile = (grade: number, subject: string): SubjectProfile | undefined =>
  SUBJECT_PROFILES.find((profile) => profile.grade === grade && profile.subject === subject);
