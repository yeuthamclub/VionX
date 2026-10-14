// Shared content library (TASK_PACKS/M05.md, ARCHITECTURE §3). Package entities are addressed by a
// stable `code`; the database adds ids. Field names follow the package format (camelCase).

export const NODE_LEVELS = [
  'GRADE',
  'SUBJECT',
  'DOMAIN',
  'TOPIC',
  'LESSON',
  'OBJECTIVE',
  'CONCEPT',
  'SKILL',
] as const;
export type NodeLevel = (typeof NODE_LEVELS)[number];

/** Knowledge graph edge types (Master Spec §8.2). */
export const EDGE_TYPES = [
  'PREREQUISITE_OF',
  'PART_OF',
  'RELATED_TO',
  'NEXT_RECOMMENDED',
  'EQUIVALENT_OR_OVERLAP',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const ITEM_TYPES = [
  'single_choice',
  'multi_choice',
  'numeric',
  'fill_blank',
  'word_bank',
  'picture_choice',
  'ordering',
  'matching',
  'true_false',
  'spelling_choice',
  'written',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Item types a TEMPLATE item can render (answer + distractors from expressions). */
export const TEMPLATE_ITEM_TYPES = [
  'single_choice',
  'spelling_choice',
  'numeric',
  'fill_blank',
] as const satisfies readonly ItemType[];
export type TemplateItemType = (typeof TEMPLATE_ITEM_TYPES)[number];

export const ITEM_KINDS = ['STATIC', 'TEMPLATE'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Content publishing states (Master Spec §32.4). */
export const CONTENT_STATUSES = [
  'DRAFT',
  'AI_GENERATED',
  'VALIDATING',
  'NEEDS_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Statuses a child endpoint may serve (M06 onwards). */
export const SERVABLE_STATUSES = ['APPROVED', 'PUBLISHED'] as const satisfies ContentStatus[];

export const isServable = (status: ContentStatus): boolean =>
  (SERVABLE_STATUSES as readonly string[]).includes(status);

/** Cognitive levels (Master Spec §32.2). */
export const COGNITIVE_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type CognitiveLevel = (typeof COGNITIVE_LEVELS)[number];

export const STIMULUS_KINDS = [
  'PASSAGE',
  'POEM',
  'DIALOGUE',
  'PICTURE_SCENE',
  'EXPERIMENT',
] as const;
export type StimulusKind = (typeof STIMULUS_KINDS)[number];

export const SOURCE_KINDS = ['ORIGINAL_AI', 'PUBLIC_DOMAIN', 'LICENSED'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const MEDIA_KINDS = ['ICON', 'SVG', 'IMAGE'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_REVIEW_STATUSES = ['NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED'] as const;
export type MediaReviewStatus = (typeof MEDIA_REVIEW_STATUSES)[number];

export const TTS_LANGS = ['vi', 'en'] as const;
export type TtsLang = (typeof TTS_LANGS)[number];

/** Launch subjects (CONTENT_PLAN_vi.md §1); package folders are `<grade>-<subject>`. */
export const SUBJECT_CODES = ['math', 'viet', 'lit', 'eng', 'sci', 'natsoc'] as const;
export type SubjectCode = (typeof SUBJECT_CODES)[number];

/** Initial library size per grade-subject (CONTRACT D6). */
export const TARGET_ITEMS_PER_LIBRARY = 500;
/** A skill is active only with at least this many approved items. */
export const MIN_APPROVED_ITEMS_PER_SKILL = 2;
/** Every item ships a 4-step hint ladder (tutor tier T0). */
export const HINT_LADDER_LENGTH = 4;

// --- Package records --------------------------------------------------------------------------

export interface PackageManifest {
  format: 1;
  curriculumVersion: string;
  grade: number;
  subject: string;
  title: string;
  bookSeries?: string | undefined;
  counts: Record<string, number>;
  /** sha256 (hex) per package file, path relative to the package root. */
  checksums: Record<string, string>;
  models: string[];
  reviewer: string | null;
  createdAt: string;
}

export interface PackageCurriculumVersion {
  code: string;
  title: string;
  academicYear?: string | undefined;
  source?: string | undefined;
}

export interface PackageNode {
  code: string;
  parent: string | null;
  level: NodeLevel;
  title: string;
  description?: string | undefined;
  gdptRef?: string | undefined;
  weight?: number | undefined;
  sortOrder?: number | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

export interface PackageEdge {
  from: string;
  to: string;
  type: EdgeType;
  reason?: string | undefined;
}

export interface PackageSeries {
  code: string;
  title: string;
  publisher?: string | undefined;
  academicYear?: string | undefined;
}

export interface PackageMapping {
  series: string;
  lessonRef: string;
  title?: string | undefined;
  pageStart?: number | undefined;
  pageEnd?: number | undefined;
  node: string;
}

export interface PackageMedia {
  code: string;
  kind: MediaKind;
  /** SVG file under `media/` (kind SVG). */
  file?: string | undefined;
  /** Storage object path (ICON, IMAGE). */
  storagePath?: string | undefined;
  alt: string;
  license: string;
  attribution?: string | undefined;
  reviewStatus: MediaReviewStatus;
}

export interface PackageGroup {
  code: string;
  stimulusKind: StimulusKind;
  title: string;
  bodyMd: string;
  ttsText?: string | undefined;
  ttsLang?: TtsLang | undefined;
  media: string[];
  wordCount?: number | undefined;
  genre?: string | undefined;
  sourceKind: SourceKind;
  sourceNote?: string | undefined;
  status: ContentStatus;
}

export interface ItemOption {
  id: string;
  text?: string | undefined;
  media?: string | undefined;
  ttsText?: string | undefined;
  /** matching only: which column the option sits in. */
  side?: 'left' | 'right' | undefined;
}

export interface Hint {
  md: string;
  ttsText?: string | undefined;
}

export interface DistractorFeedback {
  md: string;
  misconception?: string | undefined;
}

/**
 * Answer shapes per item type:
 * - single_choice, picture_choice, spelling_choice: `{ optionId }`
 * - multi_choice: `{ optionIds }`
 * - numeric: `{ value, tolerance? }`
 * - fill_blank: `{ blanks: string[][] }` (accepted spellings per blank)
 * - word_bank: `{ blankOptionIds: string[] }`
 * - ordering: `{ order: string[] }`
 * - matching: `{ pairs: [left, right][] }`
 * - true_false: `{ value: boolean }`
 * - written: no answer (rubric)
 */
export type ItemAnswer =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: number; tolerance?: number | undefined }
  | { blanks: string[][] }
  | { blankOptionIds: string[] }
  | { order: string[] }
  | { pairs: [string, string][] }
  | { value: boolean };

export interface RubricCriterion {
  name: string;
  description: string;
  maxPoints: number;
}

export interface Rubric {
  criteria: RubricCriterion[];
  guidanceMd?: string | undefined;
}

export interface SourceRef {
  kind: string;
  ref: string;
  page?: number | undefined;
}

export interface PackageItem {
  code: string;
  kind: ItemKind;
  skills: string[];
  difficulty: number;
  cognitiveLevel: CognitiveLevel;
  type: ItemType;
  stemMd: string;
  /** Media codes shown with the stem. */
  media: string[];
  options: ItemOption[];
  answer: ItemAnswer | null;
  explanationMd: string;
  hints: Hint[];
  workedSolutionMd: string;
  distractorFeedback: Record<string, DistractorFeedback>;
  misconceptionTags: string[];
  rubric?: Rubric | null | undefined;
  ttsText?: string | undefined;
  ttsLang?: TtsLang | undefined;
  group?: string | undefined;
  groupOrder?: number | undefined;
  sourceRefs: SourceRef[];
  provenance: Record<string, unknown>;
  status: ContentStatus;
}

export type TemplateParam =
  | { name: string; type: 'int'; min: number; max: number; step?: number | undefined }
  | { name: string; type: 'decimal'; min: number; max: number; step: number }
  | { name: string; type: 'choice'; values: (number | string)[] }
  | { name: string; type: 'words'; list: Record<string, unknown>[] };

export interface TemplateRender {
  /** Placeholders `{{expr}}` are math.js expressions over the params and `answer`. */
  stem: string;
  ttsText?: string | undefined;
  explanation?: string | undefined;
  /** Decimal separator for rendered numbers (Vietnamese uses a comma). */
  decimal?: 'comma' | 'point' | undefined;
}

export interface ItemTemplate {
  /** Code of the TEMPLATE item (1:1). */
  item: string;
  params: TemplateParam[];
  /** math.js boolean expressions that must all hold. */
  constraints: string[];
  answerExpr: string;
  render: TemplateRender;
  /** math.js expressions for wrong answers, each tied to a misconception. */
  distractorExprs: string[];
}

export interface LibraryPackage {
  manifest: PackageManifest;
  curriculum: { version: PackageCurriculumVersion; nodes: PackageNode[] };
  edges: PackageEdge[];
  mappings: { series: PackageSeries[]; mappings: PackageMapping[] };
  groups: PackageGroup[];
  items: PackageItem[];
  templates: ItemTemplate[];
  media: PackageMedia[];
  /** SVG sources by media file name (`media/<file>`). */
  svgFiles: Record<string, string>;
}

export interface PackageIssue {
  code: string;
  message: string;
  /** Entity code or file the issue is about. */
  ref?: string | undefined;
}
