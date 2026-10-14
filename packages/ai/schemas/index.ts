// JSON Schemas for structured model output (CONTRACT §6). One export per task/prompt family.
// Content-building schemas (page extraction, items, verification) land with X01/M10-M14.

/** Output of the `ai_check` smoke prompt when run in structured mode. */
export const aiCheckOutputSchema = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['OK'] } },
  required: ['status'],
  additionalProperties: false,
} as const satisfies Record<string, unknown>;

// --- Library build (TASK_PACKS/X01.md, tools/library-build) ---------------------------------------
// The structured-output subset: every object closes with `additionalProperties: false` and lists
// all its properties as required (optional values are nullable); no numeric or length constraints.
// The build scripts re-validate every output in code.

type Schema = Record<string, unknown>;
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
const bool = { type: 'boolean' } as const;
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const arr = (items: Schema): Schema => ({ type: 'array', items });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const PAGE_BLOCK_TYPES = [
  'heading',
  'paragraph',
  'definition',
  'example',
  'exercise',
  'table',
  'formula',
  'figure_caption',
  'other',
] as const;

/** `page_extraction.v1` / `page_reread.v1`: one PDF chunk (≤10 pages) → blocks per page. */
export const pageExtractionOutputSchema = obj({
  pages: arr(
    obj({
      page: int,
      blocks: arr(
        obj({
          type: { type: 'string', enum: [...PAGE_BLOCK_TYPES] },
          text: str,
          latex: nullable(str),
        }),
      ),
    }),
  ),
});

/** `skill_backbone.v1`: GDPT "yêu cầu cần đạt" → DOMAIN / TOPIC / SKILL tree. */
export const skillBackboneOutputSchema = obj({
  domains: arr(
    obj({
      code: str,
      title: str,
      topics: arr(
        obj({
          code: str,
          title: str,
          skills: arr(
            obj({
              code: str,
              title: str,
              gdptRef: str,
              weight: num,
              templatable: bool,
              visual: bool,
            }),
          ),
        }),
      ),
    }),
  ),
});

/** `lesson_mapping.v1`: table-of-contents pages + backbone → lessons with skills. */
export const lessonMappingOutputSchema = obj({
  lessons: arr(
    obj({
      lessonRef: str,
      title: str,
      pageStart: int,
      pageEnd: nullable(int),
      skills: arr(str),
    }),
  ),
});

/** `prerequisite_edges.v1`: backbone → edges with reasons. */
export const prerequisiteEdgesOutputSchema = obj({
  edges: arr(
    obj({
      from: str,
      to: str,
      type: { type: 'string', enum: ['PREREQUISITE_OF', 'RELATED_TO'] },
      reason: str,
    }),
  ),
});

/** `svg_illustration.v1`: one figure for one planned item slot. */
export const svgIllustrationOutputSchema = obj({
  brief: str,
  alt: str,
  svg: str,
});

const templateParam = obj({
  name: str,
  type: { type: 'string', enum: ['int', 'decimal', 'choice'] },
  min: nullable(num),
  max: nullable(num),
  step: nullable(num),
  values: nullable(arr(str)),
});

/** `item_generation.v1`: the planned slots of one skill. `answerJson` is JSON text per item type. */
export const itemGenerationOutputSchema = obj({
  items: arr(
    obj({
      slotId: str,
      stemMd: str,
      options: arr(
        obj({ id: str, text: str, side: nullable({ type: 'string', enum: ['left', 'right'] }) }),
      ),
      answerJson: nullable(str),
      answerCheckExpr: nullable(str),
      explanationMd: str,
      workedSolutionMd: str,
      hints: arr(str),
      distractorFeedback: arr(obj({ optionId: str, md: str, misconception: nullable(str) })),
      misconceptionTags: arr(str),
      template: nullable(
        obj({
          params: arr(templateParam),
          constraints: arr(str),
          answerExpr: str,
          distractorExprs: arr(str),
          stem: str,
          explanation: nullable(str),
        }),
      ),
      sourceRefs: arr(obj({ kind: str, ref: str, page: nullable(int) })),
    }),
  ),
});

/** `item_verification.v1`: blind solve plus review flags. */
export const itemVerificationOutputSchema = obj({
  answerJson: nullable(str),
  solvable: bool,
  hintsOk: bool,
  ageAppropriate: bool,
  issues: arr(str),
  note: str,
});

/** `item_dispute.v1`: the answer key against the verifier's answer. */
export const itemDisputeOutputSchema = obj({
  verdict: { type: 'string', enum: ['KEY_CORRECT', 'KEY_WRONG', 'AMBIGUOUS'] },
  correctAnswerJson: nullable(str),
  note: str,
});
