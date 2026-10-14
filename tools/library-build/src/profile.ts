// Build profiles: the subject profile of the domain (CONTENT_PLAN §3, seeded in
// library.subject_profiles) plus what the build scripts need for one library run.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { subjectProfile, type CognitiveLevel, type SubjectProfile } from '@vionx/domain';

export interface BuildProfile {
  /** CLI id and code prefix of every curriculum node: `<SUBJ>.<grade>`. */
  id: string;
  grade: number;
  /** Package subject (lower case), e.g. `math` → package folder `6-math`. */
  subject: string;
  subjectTitle: string;
  curriculum: { code: string; title: string; academicYear: string; source: string };
  /** GDPT program text: the grade section between two headings, searched from `afterLine`. */
  gdpt: { file: string; afterLine: number; from: string; to: string };
  /** The SGK series the package maps lessons to. */
  bookSeries: { code: string; title: string; publisher: string; academicYear: string };
  /** Share of items per cognitive level (the planner's target mix). */
  levelMix: Partial<Record<CognitiveLevel, number>>;
  /** Share of all items that get an SVG figure (STATIC items of `visual` skills only). */
  svgShare: number;
  /** n-gram length for the copy check against the source books. */
  ngram: number;
  /** Passage limits (only for profiles with item groups). */
  readingLevel?: { minWords: number; maxWords: number; maxSentenceWords: number };
  /** Subject notes appended to every generation prompt (stable, cached). */
  notesFile: string;
  library: SubjectProfile;
}

const PROFILES_DIR = resolve(import.meta.dirname, '../profiles');

function library(grade: number, subject: string): SubjectProfile {
  const profile = subjectProfile(grade, subject);
  if (!profile) throw new Error(`No subject profile for ${grade}-${subject}`);
  return profile;
}

const GDPT2018 = {
  code: 'gdpt2018',
  title: 'Chương trình GDPT 2018',
  academicYear: '2026-2027',
  source: 'Thông tư 32/2018/TT-BGDĐT',
};

export const BUILD_PROFILES: Record<string, BuildProfile> = {
  'MATH.6': {
    id: 'MATH.6',
    grade: 6,
    subject: 'math',
    subjectTitle: 'Toán 6',
    curriculum: GDPT2018,
    gdpt: {
      file: 'TT-32-2018_CT-GDPT_phan-1_NguVan-Toan-TNXH-KHTN.txt',
      afterLine: 11700,
      from: 'LỚP 6',
      to: 'LỚP 7',
    },
    bookSeries: {
      code: 'KNTT-TOAN6-2026',
      title: 'Toán 6 – Kết nối tri thức với cuộc sống',
      publisher: 'NXB Giáo dục Việt Nam',
      academicYear: '2026-2027',
    },
    levelMix: { L1: 0.2, L2: 0.35, L3: 0.3, L4: 0.15 },
    svgShare: 0.08,
    ngram: 10,
    notesFile: 'MATH.6.md',
    library: library(6, 'math'),
  },
};

export function buildProfile(id: string): BuildProfile {
  const profile = BUILD_PROFILES[id.toUpperCase()];
  if (!profile) {
    throw new Error(
      `Unknown grade-subject ${id}. Known: ${Object.keys(BUILD_PROFILES).join(', ')} (later runs add theirs)`,
    );
  }
  return profile;
}

export const profileNotes = (profile: BuildProfile): string =>
  readFileSync(resolve(PROFILES_DIR, profile.notesFile), 'utf8');

/** `library/<curriculumVersion>/<grade>-<subject>` (M05 package format). */
export const packageFolder = (profile: BuildProfile) => `${profile.grade}-${profile.subject}`;
