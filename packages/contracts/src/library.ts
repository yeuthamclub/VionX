// M05 admin library API schemas (TASK_PACKS/M05.md "API / tools"). Rules live in @vionx/domain;
// the package file format is in library-package.ts.
import { z } from '@hono/zod-openapi';
import {
  COGNITIVE_LEVELS,
  CONTENT_STATUSES,
  EDGE_TYPES,
  ITEM_KINDS,
  ITEM_TYPES,
  MEDIA_KINDS,
  MEDIA_REVIEW_STATUSES,
  NODE_LEVELS,
  SOURCE_KINDS,
  STIMULUS_KINDS,
  TTS_LANGS,
} from '@vionx/domain';
import {
  HintSchema,
  ItemAnswerSchema,
  ItemOptionSchema,
  RubricSchema,
  TemplateParamSchema,
} from './library-package.ts';

const Uuid = z.uuid().openapi({ example: '3f9a5b2c-1d4e-4f6a-8b7c-9d0e1f2a3b4c' });
const DateTime = z.iso.datetime({ offset: true });
const Grade = z.coerce.number().int().min(1).max(12);
const Subject = z
  .string()
  .regex(/^[a-z]+$/)
  .openapi({ example: 'math' });

export const ContentStatusSchema = z.enum(CONTENT_STATUSES).openapi('ContentStatus');
export const ItemTypeSchema = z.enum(ITEM_TYPES).openapi('ItemType');
export const ItemKindSchema = z.enum(ITEM_KINDS).openapi('ItemKind');
export const CognitiveLevelSchema = z.enum(COGNITIVE_LEVELS).openapi('CognitiveLevel');
export const NodeLevelSchema = z.enum(NODE_LEVELS).openapi('NodeLevel');

export const PackageIssueSchema = z
  .object({ code: z.string(), message: z.string(), ref: z.string().optional() })
  .openapi('PackageIssue');

export const EntityDiffSchema = z
  .object({
    added: z.array(z.string()),
    updated: z.array(z.string()),
    archived: z.array(z.string()),
    restored: z.array(z.string()),
    unchanged: z.int().nonnegative(),
  })
  .openapi('EntityDiff');

export const IMPORT_ENTITIES = [
  'nodes',
  'edges',
  'series',
  'mappings',
  'media',
  'groups',
  'items',
  'templates',
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const ImportDiffSchema = z
  .object(
    Object.fromEntries(IMPORT_ENTITIES.map((e) => [e, EntityDiffSchema])) as Record<
      ImportEntity,
      typeof EntityDiffSchema
    >,
  )
  .openapi('ImportDiff');

const PerLevel = z.object(
  Object.fromEntries(COGNITIVE_LEVELS.map((l) => [l, z.int().nonnegative()])) as Record<
    (typeof COGNITIVE_LEVELS)[number],
    z.ZodInt
  >,
);

export const CoverageReportSchema = z
  .object({
    totalItems: z.int(),
    approvedItems: z.int(),
    targetItems: z.int(),
    perSkill: z.array(
      z.object({
        code: z.string(),
        title: z.string(),
        items: z.int(),
        approved: z.int(),
        byLevel: PerLevel,
        active: z.boolean(),
        levelSpread: z.boolean(),
      }),
    ),
    perLevel: PerLevel,
    perType: z.record(z.string(), z.int()),
    templateShare: z.number(),
    groupShare: z.number(),
    writtenShare: z.number(),
    readAloudShare: z.number(),
    inactiveSkills: z.array(z.string()),
    flags: z.array(z.string()),
  })
  .openapi('CoverageReport');

// --- Import ---------------------------------------------------------------------------------------

export const ImportQuerySchema = z.object({
  mode: z.enum(['dry-run', 'apply']).default('dry-run').openapi({
    description: '`dry-run` validates and diffs only; `apply` writes in one transaction.',
  }),
});

export const ImportResultSchema = z
  .object({
    importId: Uuid,
    mode: z.enum(['DRY_RUN', 'APPLY']),
    applied: z.boolean(),
    package: z.object({
      curriculumVersion: z.string(),
      grade: z.int(),
      subject: z.string(),
      title: z.string(),
      sha256: z.string(),
    }),
    warnings: z.array(PackageIssueSchema),
    diff: ImportDiffSchema,
    /** True when the package matches the library exactly (re-import). */
    noop: z.boolean(),
    coverage: CoverageReportSchema,
  })
  .openapi('LibraryImportResult');
export type ImportResult = z.infer<typeof ImportResultSchema>;

export const ImportRunSchema = z
  .object({
    id: Uuid,
    mode: z.enum(['DRY_RUN', 'APPLY']),
    curriculumVersion: z.string(),
    grade: z.int(),
    subject: z.string(),
    packageSha256: z.string(),
    title: z.string(),
    valid: z.boolean(),
    errorCount: z.int(),
    diff: z.unknown(),
    createdBy: Uuid,
    createdAt: DateTime,
  })
  .openapi('LibraryImportRun');

export const ImportRunsResponseSchema = z
  .object({ runs: z.array(ImportRunSchema) })
  .openapi('LibraryImportRunsResponse');

// --- Curriculum -----------------------------------------------------------------------------------

export const SubjectProfileSchema = z
  .object({
    grade: z.int(),
    subject: z.string(),
    titleVi: z.string(),
    templateShare: z.number(),
    groupShare: z.number(),
    writtenShare: z.number(),
    readAloudDefault: z.boolean(),
    ttsLang: z.enum(TTS_LANGS),
    imageLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    itemTypeMix: z.record(z.string(), z.number()),
    targetItems: z.int(),
  })
  .openapi('SubjectProfile');

export const LibraryOverviewSchema = z
  .object({
    versions: z.array(
      z.object({
        id: Uuid,
        code: z.string(),
        title: z.string(),
        academicYear: z.string().nullable(),
        status: z.enum(['ACTIVE', 'INACTIVE']),
      }),
    ),
    libraries: z.array(
      z.object({
        curriculumVersion: z.string(),
        grade: z.int(),
        subject: z.string(),
        titleVi: z.string().nullable(),
        skills: z.int(),
        activeSkills: z.int(),
        items: z.int(),
        approvedItems: z.int(),
        lastImportAt: DateTime.nullable(),
      }),
    ),
    profiles: z.array(SubjectProfileSchema),
  })
  .openapi('LibraryOverview');

export const ScopeQuerySchema = z.object({
  version: z.string().default('gdpt2018'),
  grade: Grade,
  subject: Subject,
});

export const CurriculumNodeSchema = z
  .object({
    id: Uuid,
    parentId: Uuid.nullable(),
    level: NodeLevelSchema,
    code: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    gdptRef: z.string().nullable(),
    weight: z.number(),
    sortOrder: z.int(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
    items: z.int().openapi({ description: 'Non-archived items on this skill (SKILL only).' }),
    approvedItems: z.int(),
    active: z.boolean().openapi({ description: 'SKILL with ≥ 2 approved items.' }),
  })
  .openapi('CurriculumNode');

export const KnowledgeEdgeSchema = z
  .object({
    id: Uuid,
    fromId: Uuid,
    toId: Uuid,
    type: z.enum(EDGE_TYPES),
    reason: z.string().nullable(),
  })
  .openapi('KnowledgeEdge');

export const CurriculumResponseSchema = z
  .object({ nodes: z.array(CurriculumNodeSchema), edges: z.array(KnowledgeEdgeSchema) })
  .openapi('CurriculumResponse');

export const CoverageResponseSchema = z
  .object({ profile: z.union([SubjectProfileSchema, z.null()]), coverage: CoverageReportSchema })
  .openapi('CoverageResponse');

// --- Media, groups, items -------------------------------------------------------------------------

export const MediaAssetSchema = z
  .object({
    id: Uuid,
    code: z.string(),
    kind: z.enum(MEDIA_KINDS),
    inlineSvg: z.string().nullable().openapi({ description: 'Sanitised SVG markup.' }),
    storagePath: z.string().nullable(),
    alt: z.string(),
    license: z.string(),
    attribution: z.string().nullable(),
    reviewStatus: z.enum(MEDIA_REVIEW_STATUSES),
  })
  .openapi('MediaAsset');

const GroupFields = {
  stimulusKind: z.enum(STIMULUS_KINDS),
  title: z.string().min(1),
  bodyMd: z.string().min(1),
  ttsText: z.string().nullable(),
  ttsLang: z.enum(TTS_LANGS).nullable(),
  wordCount: z.int().nonnegative().nullable(),
  genre: z.string().nullable(),
  sourceKind: z.enum(SOURCE_KINDS),
  sourceNote: z.string().nullable(),
  status: ContentStatusSchema,
};

export const ItemGroupSchema = z
  .object({
    id: Uuid,
    code: z.string(),
    grade: z.int(),
    subject: z.string(),
    ...GroupFields,
    mediaIds: z.array(Uuid),
    version: z.int(),
    itemCount: z.int(),
    updatedAt: DateTime,
  })
  .openapi('ItemGroup');

export const ItemSummarySchema = z
  .object({
    id: Uuid,
    code: z.string(),
    grade: z.int(),
    subject: z.string(),
    kind: ItemKindSchema,
    type: ItemTypeSchema,
    cognitiveLevel: CognitiveLevelSchema,
    difficulty: z.int(),
    status: ContentStatusSchema,
    stemMd: z.string(),
    skills: z.array(z.object({ id: Uuid, code: z.string(), title: z.string() })),
    groupId: Uuid.nullable(),
    version: z.int(),
    templateFlagged: z.boolean(),
    updatedAt: DateTime,
  })
  .openapi('ItemSummary');

export const ItemTemplateSchemaApi = z
  .object({
    params: z.array(TemplateParamSchema),
    constraints: z.array(z.string()),
    answerExpr: z.string().min(1),
    render: z.object({
      stem: z.string().min(1),
      ttsText: z.string().optional(),
      explanation: z.string().optional(),
      decimal: z.enum(['comma', 'point']).optional(),
    }),
    distractorExprs: z.array(z.string()),
  })
  .openapi('ItemTemplate');

const EditableItemFields = {
  difficulty: z.int().min(1).max(5),
  cognitiveLevel: CognitiveLevelSchema,
  stemMd: z.string().min(1),
  options: z.array(ItemOptionSchema),
  answer: ItemAnswerSchema.nullable(),
  explanationMd: z.string(),
  hints: z.array(HintSchema),
  workedSolutionMd: z.string(),
  distractorFeedback: z.record(
    z.string(),
    z.object({ md: z.string().min(1), misconception: z.string().optional() }),
  ),
  misconceptionTags: z.array(z.string()),
  rubric: RubricSchema.nullable(),
  ttsText: z.string().nullable(),
  ttsLang: z.enum(TTS_LANGS).nullable(),
  status: ContentStatusSchema,
};

export const ItemDetailSchema = ItemSummarySchema.extend({
  ...EditableItemFields,
  mediaIds: z.array(Uuid),
  groupOrder: z.int().nullable(),
  sourceRefs: z.unknown(),
  provenance: z.unknown(),
  // z.union, not .nullable(): .nullable() on a named schema makes the shared component nullable.
  template: z.union([
    ItemTemplateSchemaApi.extend({
      flaggedAt: DateTime.nullable(),
      flagReason: z.string().nullable(),
    }).openapi('ItemTemplateDetail'),
    z.null(),
  ]),
  group: z.union([ItemGroupSchema, z.null()]),
  /** Every media asset the stem, options and group use, keyed by id and code. */
  media: z.array(MediaAssetSchema),
}).openapi('ItemDetail');
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export const ItemListQuerySchema = z.object({
  version: z.string().default('gdpt2018'),
  grade: Grade.optional(),
  subject: Subject.optional(),
  skill: z
    .string()
    .optional()
    .openapi({ description: 'Skill code; includes items of that skill only.' }),
  status: ContentStatusSchema.optional(),
  kind: ItemKindSchema.optional(),
  type: ItemTypeSchema.optional(),
  level: CognitiveLevelSchema.optional(),
  groupId: Uuid.optional(),
  q: z.string().max(200).optional().openapi({ description: 'Code or stem text contains.' }),
  cursor: z.string().optional().openapi({ description: 'Opaque; from the previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ItemListResponseSchema = z
  .object({ items: z.array(ItemSummarySchema), nextCursor: z.string().nullable() })
  .openapi('ItemListResponse');

export const ItemPatchSchema = z
  .object({
    /** Optimistic concurrency: the version the editor loaded. */
    version: z.int().positive(),
    ...Object.fromEntries(Object.entries(EditableItemFields).map(([k, v]) => [k, v.optional()])),
    template: ItemTemplateSchemaApi.optional(),
  })
  .openapi('ItemPatch') as z.ZodType<ItemPatch>;
export type ItemPatch = { version: number; template?: z.infer<typeof ItemTemplateSchemaApi> } & {
  [K in keyof typeof EditableItemFields]?: z.infer<(typeof EditableItemFields)[K]>;
};

export const VariantQuerySchema = z.object({
  seed: z.coerce.number().int().min(0).max(4294967295),
});

export const VariantResponseSchema = z
  .object({
    seed: z.int(),
    params: z.record(z.string(), z.unknown()),
    stemMd: z.string(),
    ttsText: z.string().nullable(),
    explanationMd: z.string().nullable(),
    options: z.array(ItemOptionSchema),
    optionFeedbackKeys: z.record(z.string(), z.string()),
    answer: ItemAnswerSchema,
    distractors: z.array(z.string()),
  })
  .openapi('ItemVariant');

export const GroupListQuerySchema = z.object({
  version: z.string().default('gdpt2018'),
  grade: Grade.optional(),
  subject: Subject.optional(),
  status: ContentStatusSchema.optional(),
});

export const GroupListResponseSchema = z
  .object({ groups: z.array(ItemGroupSchema) })
  .openapi('ItemGroupListResponse');

export const GroupDetailSchema = ItemGroupSchema.extend({
  items: z.array(ItemSummarySchema.extend({ groupOrder: z.int().nullable() })),
  media: z.array(MediaAssetSchema),
}).openapi('ItemGroupDetail');

export const GroupPatchSchema = z
  .object({
    version: z.int().positive(),
    ...Object.fromEntries(Object.entries(GroupFields).map(([k, v]) => [k, v.optional()])),
  })
  .openapi('ItemGroupPatch') as z.ZodType<GroupPatch>;
export type GroupPatch = { version: number } & {
  [K in keyof typeof GroupFields]?: z.infer<(typeof GroupFields)[K]>;
};

export const IdParamSchema = z.object({ id: Uuid });
