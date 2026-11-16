// M06 practice sessions and mastery schemas (TASK_PACKS/M06.md, Master Spec §10). Rules live in
// @vionx/domain (mastery/).
import { z } from '@hono/zod-openapi';
import {
  MASTERY_STATES,
  MEDIA_KINDS,
  PRACTICE_ITEM_TYPES,
  SESSION_MODES,
  STIMULUS_KINDS,
  TTS_LANGS,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Json = z.record(z.string(), z.unknown());

export const SessionModeSchema = z.enum(SESSION_MODES).openapi('SessionMode');
export const MasteryStateSchema = z.enum(MASTERY_STATES).openapi('MasteryState', {
  description: 'Display state of a skill or topic (Master Spec §10.2). XP is not mastery.',
});
export const TtsLangSchema = z.enum(TTS_LANGS);
export const ITEM_REPORT_REASONS = [
  'WRONG_ANSWER',
  'UNCLEAR',
  'TYPO',
  'BAD_MEDIA',
  'BAD_AUDIO',
  'TOO_HARD',
  'OTHER',
] as const;

export const LearningStudentIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Student id.' }),
});
export const SessionIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Learning session id.' }),
});
export const ItemIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Library item id.' }),
});

// --- Sessions --------------------------------------------------------------------------------------
export const SessionCreateSchema = z
  .object({
    clientUuid: Uuid.openapi({ description: 'Client-generated id; a retry returns the session.' }),
    mode: SessionModeSchema.optional().openapi({
      description:
        'Omitted: DIAGNOSTIC for the first session on a topic, otherwise PRACTICE. REVIEW serves the skills whose review is due.',
    }),
    nodeId: Uuid.optional().openapi({
      description: 'Curriculum node (topic, lesson… or one skill): the session covers its skills.',
    }),
    skillIds: z.array(Uuid).min(1).max(30).optional(),
    subject: z
      .string()
      .regex(/^[a-z]+$/)
      .optional()
      .openapi({ description: 'REVIEW without a node: the subject to review.' }),
    targetItems: z.int().min(1).max(50).optional().openapi({
      description: 'Number of items; a diagnostic is clamped to 8-12 (default 10).',
    }),
  })
  .openapi('LearningSessionCreate');

export const LearningSessionSchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    mode: SessionModeSchema,
    status: z.enum(['ACTIVE', 'FINISHED']),
    grade: z.int(),
    subject: z.string(),
    nodeId: Uuid.nullable(),
    skillIds: z.array(Uuid),
    targetItems: z.int(),
    maxMinutes: z
      .int()
      .openapi({ description: 'The session ends after this long (~15 for Grade 1-3).' }),
    answeredCount: z.int(),
    correctCount: z.int(),
    hintsCount: z.int(),
    youngMode: z.boolean().openapi({
      description: 'Grade 1-3 mode: large touch targets, minimal typing, encouraging feedback.',
    }),
    readAloud: z.boolean().openapi({
      description: 'Read stems, options and hints aloud by default (subject profile or Grade ≤ 3).',
    }),
    ttsLang: TtsLangSchema,
    analytics: z.boolean().openapi({
      description:
        'EDUCATION_ANALYTICS was in force at start. When false only aggregates are stored (no per-answer rows).',
    }),
    startedAt: DateTime,
    finishedAt: DateTime.nullable(),
  })
  .openapi('LearningSession');

export const SessionCreateResponseSchema = z
  .object({ session: LearningSessionSchema, replayed: z.boolean() })
  .openapi('LearningSessionCreateResponse');

// --- Items as a child sees them (never with the answer) ------------------------------------------
export const PracticeMediaSchema = z
  .object({
    id: Uuid,
    kind: z.enum(MEDIA_KINDS),
    svg: z.string().nullable().openapi({ description: 'Sanitised inline SVG (kind SVG).' }),
    storagePath: z.string().nullable(),
    alt: z.string(),
  })
  .openapi('PracticeMedia');

export const PracticeOptionSchema = z
  .object({
    id: z.string(),
    text: z.string().nullable(),
    media: z.union([PracticeMediaSchema, z.null()]),
    ttsText: z.string().nullable(),
    side: z.enum(['left', 'right']).nullable().openapi({ description: 'matching: column.' }),
  })
  .openapi('PracticeOption');

export const PracticeHintSchema = z
  .object({ md: z.string(), ttsText: z.string().nullable() })
  .openapi('PracticeHint');

export const PracticeItemSchema = z
  .object({
    id: Uuid,
    type: z.enum(PRACTICE_ITEM_TYPES),
    kind: z.enum(['STATIC', 'TEMPLATE']),
    skillId: Uuid,
    slotKind: z.enum(['CURRENT', 'REVIEW']),
    difficulty: z.int(),
    stemMd: z.string(),
    media: z.array(PracticeMediaSchema),
    options: z.array(PracticeOptionSchema),
    blanks: z.int().openapi({ description: 'fill_blank / word_bank: number of gaps to fill.' }),
    ttsText: z.string().nullable(),
    ttsLang: TtsLangSchema,
    seed: z.int().nullable().openapi({
      description: 'TEMPLATE: seed of the variant shown; the answer is judged against it.',
    }),
    hintsTotal: z.int(),
    hints: z.array(PracticeHintSchema).openapi({ description: 'Hints already taken.' }),
  })
  .openapi('PracticeItem');

export const PracticeGroupSchema = z
  .object({
    id: Uuid,
    stimulusKind: z.enum(STIMULUS_KINDS),
    title: z.string(),
    bodyMd: z.string(),
    ttsText: z.string().nullable(),
    ttsLang: TtsLangSchema,
    media: z.array(PracticeMediaSchema),
    position: z.int().openapi({ description: '1-based place of the item in its group.' }),
    total: z.int(),
  })
  .openapi('PracticeGroup', {
    description:
      'Shared stimulus (passage, poem…) that stays visible while its items are answered.',
  });

export const SessionProgressSchema = z
  .object({ answered: z.int(), correct: z.int(), target: z.int() })
  .openapi('LearningSessionProgress');

export const NextItemResponseSchema = z
  .object({
    done: z.boolean(),
    reason: z.enum(['TARGET_REACHED', 'TIME_UP', 'NO_ITEMS', 'FINISHED']).nullable(),
    progress: SessionProgressSchema,
    item: z.union([PracticeItemSchema, z.null()]),
    group: z.union([PracticeGroupSchema, z.null()]),
  })
  .openapi('NextItemResponse');

// --- Answers, hints, finish ------------------------------------------------------------------------
export const AnswerCreateSchema = z
  .object({
    clientUuid: Uuid.openapi({
      description: 'A retry with the same id returns the stored result.',
    }),
    itemId: Uuid,
    response: Json.openapi({
      description:
        'By item type: {optionId} | {optionIds} | {value} | {blanks} | {blankOptionIds} | {order} | {pairs}.',
      example: { optionId: 'b' },
    }),
    responseMs: z.int().min(0).max(3_600_000).optional(),
  })
  .openapi('AnswerCreate');

export const SkillProgressSchema = z
  .object({
    skillId: Uuid,
    title: z.string(),
    state: MasteryStateSchema,
    masteryScore: z.number(),
  })
  .openapi('SkillProgress');

export const AnswerResponseSchema = z
  .object({
    isCorrect: z.boolean(),
    replayed: z.boolean(),
    correctAnswer: Json,
    feedback: z
      .object({ md: z.string(), misconception: z.string().nullable() })
      .nullable()
      .openapi({
        description: 'Pre-written feedback for the wrong option chosen (tutor tier T0).',
      }),
    explanationMd: z.string(),
    workedSolutionMd: z.string().nullable().openapi({
      description: 'Only after hint level 4; otherwise at session end.',
    }),
    masteryDelta: z.number().openapi({
      description: 'Change of the skill score (0 in a diagnostic: placement happens at finish).',
    }),
    skill: SkillProgressSchema,
    progress: SessionProgressSchema,
  })
  .openapi('AnswerResponse');

export const HintResponseSchema = z
  .object({
    level: z.int(),
    total: z.int(),
    hint: PracticeHintSchema,
    workedSolutionMd: z.string().nullable().openapi({ description: 'Shown with the last hint.' }),
  })
  .openapi('HintResponse');

export const SessionSolutionSchema = z
  .object({ itemId: Uuid, stemMd: z.string(), workedSolutionMd: z.string(), correctAnswer: Json })
  .openapi('SessionSolution');

export const SessionSummarySchema = z
  .object({
    answered: z.int(),
    correct: z.int(),
    accuracy: z.number(),
    hintsUsed: z.int(),
    durationSec: z.int(),
    xp: z.int().openapi({ description: 'XP the session is worth (granted once by the worker).' }),
    skills: z.array(SkillProgressSchema),
    solutions: z.array(SessionSolutionSchema).openapi({
      description: 'Worked solutions of the items answered wrong.',
    }),
  })
  .openapi('LearningSessionSummary');

export const SessionFinishResponseSchema = z
  .object({ session: LearningSessionSchema, summary: SessionSummarySchema, replayed: z.boolean() })
  .openapi('LearningSessionFinishResponse');

// --- Knowledge map & learning path ----------------------------------------------------------------
export const KnowledgeQuerySchema = z.object({
  subject: z
    .string()
    .regex(/^[a-z]+$/)
    .optional()
    .openapi({ param: { name: 'subject', in: 'query' }, description: 'One subject (e.g. math).' }),
});

export const KnowledgeNodeSchema = z
  .object({
    id: Uuid,
    parentId: Uuid.nullable(),
    level: z.string(),
    title: z.string(),
    sortOrder: z.int(),
    skillCount: z
      .int()
      .openapi({ description: 'Practicable skills under the node (1 for a skill).' }),
    state: MasteryStateSchema,
    masteryScore: z
      .number()
      .openapi({ description: 'Skill score, or the mean of the skills below.' }),
    confidenceScore: z.number().nullable(),
    attemptCount: z.int(),
    recentAccuracy: z.number().nullable(),
    lastAttemptAt: DateTime.nullable(),
    nextReviewAt: DateTime.nullable(),
    forgettingRisk: z.number().nullable(),
  })
  .openapi('KnowledgeNode');

export const KnowledgeSubjectSchema = z
  .object({
    subject: z.string(),
    title: z.string(),
    readAloud: z.boolean(),
    ttsLang: TtsLangSchema,
    nodes: z.array(KnowledgeNodeSchema),
  })
  .openapi('KnowledgeSubject');

export const KnowledgeMapResponseSchema = z
  .object({ studentId: Uuid, grade: z.int(), subjects: z.array(KnowledgeSubjectSchema) })
  .openapi('KnowledgeMapResponse');

export const LearningPathStepSchema = z
  .object({
    kind: z.enum(['REVIEW_DUE', 'CONTINUE', 'START']),
    subject: z.string(),
    skillId: Uuid,
    skillTitle: z.string(),
    topicId: Uuid,
    topicTitle: z.string(),
    state: MasteryStateSchema,
    masteryScore: z.number(),
    dueAt: DateTime.nullable(),
  })
  .openapi('LearningPathStep');

export const LearningPathResponseSchema = z
  .object({ studentId: Uuid, steps: z.array(LearningPathStepSchema) })
  .openapi('LearningPathResponse');

// --- Item reports ---------------------------------------------------------------------------------
export const ItemReportCreateSchema = z
  .object({
    reason: z.enum(ITEM_REPORT_REASONS),
    variantSeed: z.int().min(0).max(4294967295).optional(),
  })
  .openapi('ItemReportCreate');

export const ItemReportResponseSchema = z
  .object({ reported: z.literal(true) })
  .openapi('ItemReportResponse');
