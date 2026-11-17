// M08 parent dashboard & school gradebook schemas (TASK_PACKS/M08.md, Master Spec §7, §12).
// Rules live in @vionx/domain (dashboard/).
import { z } from '@hono/zod-openapi';
import {
  ASSESSMENT_CONTENT_TYPES,
  ASSESSMENT_TYPES,
  DASHBOARD_RANGES,
  DATA_SUFFICIENCY,
  isSubjectCode,
  isValidDay,
  MASTERY_STATES,
  SEMESTERS,
} from '@vionx/domain';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidDay, 'Not a calendar date')
  .openapi({ example: '2026-11-17', description: 'Household-local day (YYYY-MM-DD).' });
const SubjectCode = z
  .string()
  .refine(isSubjectCode, 'Unknown subject code')
  .openapi({ example: 'TOAN', description: 'GDPT 2018 subject code (GET /v1/subjects).' });
const SchoolYear = z
  .string()
  .regex(/^\d{4}-\d{4}$/)
  .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, 'Two consecutive years')
  .openapi({ example: '2026-2027' });
const Score = z.number().min(0).max(1000).multipleOf(0.01);

export const DataSufficiencySchema = z.enum(DATA_SUFFICIENCY).openapi('DataSufficiency', {
  description:
    'How much data an interpretive figure stands on (Master Spec §7): INSUFFICIENT = do not read anything into it, LOW = a first indication, OK = enough.',
});
export const AssessmentTypeSchema = z.enum(ASSESSMENT_TYPES).openapi('AssessmentType');
export const SemesterSchema = z.enum(SEMESTERS).openapi('Semester');
export const TrendDirectionSchema = z.enum(['UP', 'DOWN', 'FLAT']).openapi('TrendDirection');

export const DashboardStudentIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'Student id.' }),
});
export const AssessmentIdParamSchema = z.object({
  id: Uuid.openapi({ param: { name: 'id', in: 'path' }, description: 'School assessment id.' }),
});

// --- School assessments ------------------------------------------------------------------------------
export const SchoolAssessmentSchema = z
  .object({
    id: Uuid,
    studentId: Uuid,
    subjectCode: z.string(),
    assessedOn: Day,
    type: AssessmentTypeSchema,
    score: z.number(),
    maxScore: z.number(),
    percent: z.number().openapi({ description: 'score ÷ maxScore, 0-100 with one decimal.' }),
    schoolYear: z.string(),
    semester: SemesterSchema,
    topicTags: z.array(z.string()),
    note: z.string().nullable(),
    teacherComment: z.string().nullable(),
    skillIds: z.array(Uuid).openapi({ description: 'Curriculum skills the assessment covered.' }),
    attachmentUrl: z.string().nullable().openapi({
      description: 'Signed link to the attached photo or PDF (15 minutes), or null.',
    }),
    createdAt: DateTime,
    updatedAt: DateTime,
  })
  .openapi('SchoolAssessment');
export type SchoolAssessment = z.infer<typeof SchoolAssessmentSchema>;

const Tag = z.string().trim().min(1).max(40);
const Text500 = z.string().trim().max(500);

export const SchoolAssessmentCreateSchema = z
  .object({
    subjectCode: SubjectCode,
    assessedOn: Day,
    type: AssessmentTypeSchema,
    score: Score,
    maxScore: Score.refine((v) => v > 0, 'Must be above 0')
      .optional()
      .openapi({ description: 'Default 10.' }),
    schoolYear: SchoolYear.optional().openapi({ description: 'Default: from assessedOn.' }),
    semester: SemesterSchema.optional().openapi({ description: 'Default: from assessedOn.' }),
    topicTags: z.array(Tag).max(10).optional(),
    note: Text500.nullable().optional(),
    teacherComment: Text500.nullable().optional(),
    skillIds: z.array(Uuid).max(20).optional(),
    attachmentPath: z.string().max(300).nullable().optional().openapi({
      description: '`path` from POST /v1/students/{id}/school-assessments/upload-sign.',
    }),
  })
  .openapi('SchoolAssessmentCreate');

export const SchoolAssessmentUpdateSchema =
  SchoolAssessmentCreateSchema.partial().openapi('SchoolAssessmentUpdate');

export const SchoolAssessmentListQuerySchema = z.object({
  subjectCode: SubjectCode.optional().openapi({ param: { name: 'subjectCode', in: 'query' } }),
  schoolYear: SchoolYear.optional().openapi({ param: { name: 'schoolYear', in: 'query' } }),
  semester: SemesterSchema.optional().openapi({ param: { name: 'semester', in: 'query' } }),
  cursor: z
    .string()
    .max(60)
    .optional()
    .openapi({
      param: { name: 'cursor', in: 'query' },
      description: '`nextCursor` of the previous page.',
    }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ param: { name: 'limit', in: 'query' } }),
});

export const SchoolAssessmentListResponseSchema = z
  .object({
    studentId: Uuid,
    assessments: z.array(SchoolAssessmentSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi('SchoolAssessmentListResponse');

export const SchoolAssessmentResponseSchema = z
  .object({ assessment: SchoolAssessmentSchema })
  .openapi('SchoolAssessmentResponse');

export const AssessmentUploadSignSchema = z
  .object({ contentType: z.enum(ASSESSMENT_CONTENT_TYPES) })
  .openapi('AssessmentUploadSign');

export const AssessmentUploadSignResponseSchema = z
  .object({
    path: z.string().openapi({ description: 'Pass as `attachmentPath` when saving the grade.' }),
    uploadUrl: z.string(),
    expiresAt: DateTime,
    maxBytes: z.int(),
  })
  .openapi('AssessmentUploadSignResponse');

// --- Dashboard ----------------------------------------------------------------------------------------
export const DashboardQuerySchema = z.object({
  range: z
    .enum(DASHBOARD_RANGES)
    .default('7d')
    .openapi({ param: { name: 'range', in: 'query' }, description: 'Days up to today.' }),
});

export const SkillInsightSchema = z
  .object({
    skillId: Uuid,
    subject: z.string(),
    title: z.string(),
    state: z.enum(MASTERY_STATES),
    masteryScore: z.number(),
    signal: z.enum(['IMPROVING', 'AT_RISK']),
    reason: z.enum(['RECENT_ABOVE_AVERAGE', 'RECENT_BELOW_AVERAGE', 'FORGETTING']),
    sufficiency: DataSufficiencySchema,
  })
  .openapi('SkillInsight');

export const UpcomingExamSchema = z
  .object({
    eventId: Uuid,
    title: z.string(),
    subjectCode: z.string().nullable(),
    startsAt: DateTime,
    daysUntil: z.int(),
  })
  .openapi('UpcomingExam');

const TodaySummarySchema = z
  .object({
    itemsTotal: z.int(),
    itemsDone: z.int(),
    plannedMinutes: z.int(),
    doneMinutes: z.int(),
    budgetMinutes: z.int(),
    completion: z.number().nullable().openapi({ description: 'itemsDone ÷ itemsTotal, 0-1.' }),
  })
  .openapi('DashboardToday');

const StreakSchema = z
  .object({
    days: z.int().openapi({
      description: 'Consecutive days with a finished task or practice session, ending today.',
    }),
    activeDays: z.int().openapi({ description: 'Active days in the last 30 days.' }),
    sufficiency: DataSufficiencySchema,
  })
  .openapi('DashboardStreak');

const RewardSummarySchema = z
  .object({
    coinBalance: z.int(),
    coinsToday: z.int().openapi({ description: 'Coin today converts to at day end (projected).' }),
    capCoinsToday: z.int(),
    coinsWeek: z.int().openapi({ description: 'Coin granted for the last 7 settled days.' }),
    coinsInRange: z.int(),
    xpInRange: z.int(),
    lifetimeXp: z.int(),
    level: z.int(),
  })
  .openapi('DashboardRewards');

const DaySummarySchema = z
  .object({
    day: Day,
    tasksTotal: z.int(),
    tasksDone: z.int(),
    sessions: z.int(),
    learningMinutes: z.int(),
    xpEarned: z.int(),
  })
  .openapi('DashboardDay');

const SubjectMasterySchema = z
  .object({
    subject: z.string().openapi({ description: 'Library subject, e.g. `math`.' }),
    title: z.string(),
    skills: z.int(),
    practised: z.int(),
    proficient: z.int(),
    meanScore: z.number().nullable(),
    attempts: z.int(),
    sufficiency: DataSufficiencySchema,
  })
  .openapi('DashboardSubjectMastery');

const SchoolSubjectTrendSchema = z
  .object({
    subjectCode: z.string(),
    count: z.int(),
    averagePercent: z.number().nullable(),
    direction: TrendDirectionSchema,
    deltaPercent: z.number(),
    sufficiency: DataSufficiencySchema,
    points: z.array(z.object({ day: Day, percent: z.number(), type: AssessmentTypeSchema })),
  })
  .openapi('DashboardSchoolSubject');

export const DashboardResponseSchema = z
  .object({
    studentId: Uuid,
    displayName: z.string(),
    grade: z.int(),
    range: z.enum(DASHBOARD_RANGES),
    from: Day,
    to: Day,
    today: TodaySummarySchema,
    streak: StreakSchema,
    rewards: RewardSummarySchema,
    tasks: z.object({
      total: z.int(),
      done: z.int(),
      requiredTotal: z.int(),
      requiredDone: z.int(),
      completion: z.number().nullable(),
      sufficiency: DataSufficiencySchema,
    }),
    days: z.array(DaySummarySchema).openapi({ description: 'One entry per day of the range.' }),
    learning: z.object({
      sessions: z.int(),
      minutes: z.int(),
      answers: z.int(),
      accuracy: z.number().nullable(),
      sufficiency: DataSufficiencySchema,
      improving: z.array(SkillInsightSchema),
      atRisk: z.array(SkillInsightSchema),
      subjects: z.array(SubjectMasterySchema),
    }),
    school: z.object({
      schoolYear: z.string(),
      subjects: z.array(SchoolSubjectTrendSchema),
    }),
    sideBySide: z
      .array(
        z.object({
          subjectCode: z.string(),
          librarySubject: z.string().nullable(),
          school: z.object({
            averagePercent: z.number().nullable(),
            count: z.int(),
            sufficiency: DataSufficiencySchema,
          }),
          mastery: z
            .object({
              meanScore: z.number().nullable(),
              practised: z.int(),
              skills: z.int(),
              sufficiency: DataSufficiencySchema,
            })
            .nullable(),
        }),
      )
      .openapi({
        description:
          'School grades and app mastery of the same subject, side by side. They are different measures and are never combined into one number.',
      }),
    upcomingExams: z.array(UpcomingExamSchema),
  })
  .openapi('DashboardResponse');
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const ChildOverviewSchema = z
  .object({
    studentId: Uuid,
    displayName: z.string(),
    grade: z.int(),
    avatar: z.string(),
    today: TodaySummarySchema,
    streak: StreakSchema,
    coinBalance: z.int(),
    coinsToday: z.int(),
    coinsWeek: z.int(),
    skillsImproving: z.int(),
    skillsAtRisk: z.int(),
    skillsSufficiency: DataSufficiencySchema,
    upcomingExams: z.array(UpcomingExamSchema),
  })
  .openapi('ChildOverview');
export type ChildOverview = z.infer<typeof ChildOverviewSchema>;

export const HouseholdOverviewResponseSchema = z
  .object({ children: z.array(ChildOverviewSchema) })
  .openapi('HouseholdOverviewResponse');
