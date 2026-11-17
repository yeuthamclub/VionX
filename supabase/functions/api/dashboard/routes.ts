// M08 parent dashboard & school gradebook (TASK_PACKS/M08.md, Master Spec §7, §12). Parent only:
// grades are entered and edited by a parent and every edit is audited.
import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  ASSESSMENT_FILE_URL_TTL_SECONDS,
  assessmentFileBelongsTo,
  assessmentFilePath,
  gradePercent,
  MAX_ASSESSMENT_FILE_BYTES,
  PROOF_UPLOAD_URL_TTL_SECONDS,
  schoolTermOf,
  type AssessmentType,
  type Avatar,
  type Semester,
} from '@vionx/domain';
import { requireActor } from '../../_shared/actor.ts';
import type { Sql, TxSql } from '../../_shared/db.ts';
import { ApiError } from '../../_shared/errors.ts';
import { scopeFor, type Scope } from '../../_shared/scope.ts';
import { ASSESSMENT_FILE_BUCKET } from '../../_shared/storage.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { proofObjectExists } from '../calendar/repo.ts';
import { writeAudit } from '../identity/repo.ts';
import { body, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import { buildDashboard, type DashboardStudent } from './build.ts';
import {
  AssessmentIdParamSchema,
  AssessmentUploadSignResponseSchema,
  AssessmentUploadSignSchema,
  DashboardQuerySchema,
  DashboardResponseSchema,
  DashboardStudentIdParamSchema,
  HouseholdOverviewResponseSchema,
  SchoolAssessmentCreateSchema,
  SchoolAssessmentListQuerySchema,
  SchoolAssessmentListResponseSchema,
  SchoolAssessmentResponseSchema,
  SchoolAssessmentUpdateSchema,
} from './schemas.ts';

type Db = Sql | TxSql;
const ERRORS = errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND');

const listRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/school-assessments',
  tags: ['gradebook'],
  summary: 'School grades of a child',
  description:
    'Parent only. Newest first; filter by subject, school year or semester. `attachmentUrl` is a signed link valid for 15 minutes.',
  security: PARENT,
  request: { params: DashboardStudentIdParamSchema, query: SchoolAssessmentListQuerySchema },
  responses: { 200: json(SchoolAssessmentListResponseSchema, 'Grades'), ...ERRORS },
});

const createAssessmentRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/school-assessments',
  tags: ['gradebook'],
  summary: 'Enter a school grade',
  description:
    'Parent only. `maxScore` defaults to 10; school year and semester default from `assessedOn` (year from September, HK1 to mid January, HK2 to May). `skillIds` map the assessment to curriculum skills. Audited. The grade is shown beside app mastery and never changes it.',
  security: PARENT,
  request: { params: DashboardStudentIdParamSchema, ...body(SchoolAssessmentCreateSchema) },
  responses: { 201: json(SchoolAssessmentResponseSchema, 'Saved'), ...ERRORS },
});

const updateAssessmentRoute = createRoute({
  method: 'patch',
  path: '/v1/school-assessments/{id}',
  tags: ['gradebook'],
  summary: 'Correct a school grade',
  description: 'Parent only. Audited with the names of the changed fields.',
  security: PARENT,
  request: { params: AssessmentIdParamSchema, ...body(SchoolAssessmentUpdateSchema) },
  responses: { 200: json(SchoolAssessmentResponseSchema, 'Saved'), ...ERRORS },
});

const deleteAssessmentRoute = createRoute({
  method: 'delete',
  path: '/v1/school-assessments/{id}',
  tags: ['gradebook'],
  summary: 'Delete a school grade',
  description: 'Parent only. Removes the grade, its skill mappings and its attachment. Audited.',
  security: PARENT,
  request: { params: AssessmentIdParamSchema },
  responses: { 204: { description: 'Deleted' }, ...ERRORS },
});

const uploadSignRoute = createRoute({
  method: 'post',
  path: '/v1/students/{id}/school-assessments/upload-sign',
  tags: ['gradebook'],
  summary: 'Signed upload for a photo or PDF of a school test',
  description:
    'Parent only. PUT the file to `uploadUrl` (valid 2 hours, max 10 MB, JPEG/PNG/WebP/PDF) into a private bucket, then send `path` as `attachmentPath`. No OCR: the file is only stored.',
  security: PARENT,
  request: { params: DashboardStudentIdParamSchema, ...body(AssessmentUploadSignSchema) },
  responses: {
    200: json(AssessmentUploadSignResponseSchema, 'Upload target'),
    ...errorResponses(
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'SERVICE_UNAVAILABLE',
    ),
  },
});

const dashboardRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/dashboard',
  tags: ['dashboard'],
  summary: 'Dashboard of one child',
  description:
    'Parent only. Today, streak, Coin and XP, tasks and practice of the range (`7d`, `30d`, `90d`), skills improving or at risk, mastery per subject, school grades of the current school year with their trend, and upcoming exams. Every interpretive figure carries a `sufficiency` label. School grades and app mastery are listed side by side and never merged.',
  security: PARENT,
  request: { params: DashboardStudentIdParamSchema, query: DashboardQuerySchema },
  responses: { 200: json(DashboardResponseSchema, 'Dashboard'), ...ERRORS },
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/v1/household/overview',
  tags: ['dashboard'],
  summary: 'One card per child for the parent home',
  description:
    'Parent only. Per child: Today completion, streak, Coin today and this week, number of skills improving and at risk (last 7 days), upcoming exams.',
  security: PARENT,
  responses: {
    200: json(HouseholdOverviewResponseSchema, 'Overview'),
    ...errorResponses('UNAUTHENTICATED', 'FORBIDDEN'),
  },
});

interface AssessmentRow {
  id: string;
  household_id: string;
  student_id: string;
  subject_code: string;
  assessed_on: string;
  type: AssessmentType;
  score: string;
  max_score: string;
  school_year: string;
  semester: Semester;
  topic_tags: string[];
  note: string | null;
  teacher_comment: string | null;
  attachment_path: string | null;
  skill_ids: string[];
  created_at: Date;
  updated_at: Date;
}

const assessmentSelect = (db: Db) => db`
  select a.id, a.household_id, a.student_id, a.subject_code, a.assessed_on::text as assessed_on,
         a.type, a.score, a.max_score, a.school_year, a.semester, a.topic_tags, a.note,
         a.teacher_comment, a.attachment_path, a.created_at, a.updated_at,
         coalesce((select array_agg(m.skill_id order by m.skill_id)
                   from app.school_assessment_skill_mappings m where m.assessment_id = a.id),
                  '{}') as skill_ids
  from app.school_assessments a`;

async function assessmentById(db: Db, scope: Scope, id: string, lock = false) {
  const rows = await db<AssessmentRow[]>`
    ${assessmentSelect(db)} where a.id = ${id} and ${scope.where('a.household_id')}
    ${lock ? db`for update of a` : db``}`;
  return rows[0] ?? null;
}

const invalid = (message: string, details?: Record<string, unknown>) =>
  new ApiError('VALIDATION_FAILED', message, details);

export function registerDashboardRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  async function students(scope: Scope, id?: string) {
    return sql<(DashboardStudent & { avatar: Avatar })[]>`
      select s.id, s.household_id, s.display_name, s.grade, s.avatar, h.timezone
      from app.students s join app.households h on h.id = s.household_id
      where ${scope.where('s.household_id')} ${id === undefined ? sql`` : sql`and s.id = ${id}`}
      order by s.created_at, s.id`;
  }

  async function parentAndStudent(
    c: { get(key: 'actor'): AppEnv['Variables']['actor'] },
    id: string,
  ) {
    const parent = requireActor(c.get('actor'), 'parent');
    const scope = await scopeFor(sql, parent);
    const [student] = await students(scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return { parent, scope, student };
  }

  async function toAssessment(
    r: AssessmentRow,
  ): Promise<z.infer<typeof SchoolAssessmentResponseSchema>['assessment']> {
    const score = Number(r.score);
    const maxScore = Number(r.max_score);
    return {
      id: r.id,
      studentId: r.student_id,
      subjectCode: r.subject_code,
      assessedOn: r.assessed_on,
      type: r.type,
      score,
      maxScore,
      percent: gradePercent(score, maxScore),
      schoolYear: r.school_year,
      semester: r.semester,
      topicTags: r.topic_tags,
      note: r.note,
      teacherComment: r.teacher_comment,
      skillIds: r.skill_ids,
      attachmentUrl:
        r.attachment_path && deps.storage
          ? await deps.storage.createSignedUrl(
              ASSESSMENT_FILE_BUCKET,
              r.attachment_path,
              ASSESSMENT_FILE_URL_TTL_SECONDS,
            )
          : null,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  /** Skill ids must be curriculum skills; the attachment must be a file we signed and received. */
  async function checkLinks(
    student: DashboardStudent,
    skillIds: string[] | undefined,
    attachmentPath: string | null | undefined,
  ) {
    if (skillIds && skillIds.length > 0) {
      const found = await sql`
        select id from library.curriculum_nodes
        where id = any(${skillIds}::uuid[]) and level = 'SKILL'`;
      if (found.length !== new Set(skillIds).size) {
        throw invalid('Unknown skill', { field: 'skillIds' });
      }
    }
    if (attachmentPath) {
      const ids = { householdId: student.household_id, studentId: student.id };
      if (!assessmentFileBelongsTo(attachmentPath, ids)) {
        throw invalid('attachmentPath was not issued for this child', {
          reason: 'ATTACHMENT_INVALID',
        });
      }
      if (!(await proofObjectExists(sql, ASSESSMENT_FILE_BUCKET, attachmentPath))) {
        throw invalid('The file has not been uploaded', { reason: 'ATTACHMENT_NOT_UPLOADED' });
      }
    }
  }

  async function setSkills(tx: TxSql, assessmentId: string, householdId: string, ids: string[]) {
    await tx`delete from app.school_assessment_skill_mappings where assessment_id = ${assessmentId}`;
    if (ids.length > 0) {
      await tx`
        insert into app.school_assessment_skill_mappings (assessment_id, skill_id, household_id)
        select ${assessmentId}, s::uuid, ${householdId}
        from unnest(${[...new Set(ids)]}::text[]) as s`;
    }
  }

  // Gradebook --------------------------------------------------------------------------------------

  app.openapi(listRoute, async (c) => {
    const { id } = c.req.valid('param');
    const q = c.req.valid('query');
    const { scope } = await parentAndStudent(c, id);
    const [cursorDay, cursorId] = q.cursor?.split('_') ?? [];
    if (q.cursor && !(cursorDay && cursorId && /^\d{4}-\d{2}-\d{2}$/.test(cursorDay))) {
      throw invalid('Invalid cursor', { field: 'cursor' });
    }
    const rows = await sql<AssessmentRow[]>`
      ${assessmentSelect(sql)}
      where a.student_id = ${id} and ${scope.where('a.household_id')}
        ${q.subjectCode ? sql`and a.subject_code = ${q.subjectCode}` : sql``}
        ${q.schoolYear ? sql`and a.school_year = ${q.schoolYear}` : sql``}
        ${q.semester ? sql`and a.semester = ${q.semester}` : sql``}
        ${q.cursor ? sql`and (a.assessed_on, a.id::text) < (${cursorDay!}::date, ${cursorId!})` : sql``}
      order by a.assessed_on desc, a.id::text desc
      limit ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return c.json(
      {
        studentId: id,
        assessments: await Promise.all(page.map(toAssessment)),
        nextCursor: rows.length > q.limit && last ? `${last.assessed_on}_${last.id}` : null,
      },
      200,
    );
  });

  app.openapi(createAssessmentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const { parent, scope, student } = await parentAndStudent(c, id);
    const maxScore = input.maxScore ?? 10;
    if (input.score > maxScore) throw invalid('score is above maxScore', { field: 'score' });
    await checkLinks(student, input.skillIds, input.attachmentPath);
    const term = schoolTermOf(input.assessedOn);
    const requestId = c.get('requestId');
    const created = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into app.school_assessments (household_id, student_id, subject_code, assessed_on,
          type, score, max_score, school_year, semester, topic_tags, note, teacher_comment,
          attachment_path, created_by)
        values (${student.household_id}, ${id}, ${input.subjectCode}, ${input.assessedOn}::date,
          ${input.type}, ${input.score}, ${maxScore}, ${input.schoolYear ?? term.schoolYear},
          ${input.semester ?? term.semester}, ${input.topicTags ?? []}::text[],
          ${input.note || null}, ${input.teacherComment || null}, ${input.attachmentPath ?? null},
          ${parent.userId})
        returning id`;
      await setSkills(tx, row!.id, student.household_id, input.skillIds ?? []);
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'school_assessment.created',
        targetType: 'school_assessment',
        targetId: row!.id,
        householdId: student.household_id,
        requestId,
        details: { studentId: id, subjectCode: input.subjectCode, type: input.type },
      });
      return (await assessmentById(tx, scope, row!.id))!;
    });
    return c.json({ assessment: await toAssessment(created) }, 201);
  });

  app.openapi(updateAssessmentRoute, async (c) => {
    const parent = requireActor(c.get('actor'), 'parent');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const scope = await scopeFor(sql, parent);
    const current = await assessmentById(sql, scope, id);
    if (!current) throw new ApiError('NOT_FOUND', 'Assessment not found');
    const [student] = await students(scope, current.student_id);
    const score = input.score ?? Number(current.score);
    const maxScore = input.maxScore ?? Number(current.max_score);
    if (score > maxScore) throw invalid('score is above maxScore', { field: 'score' });
    const attachment =
      input.attachmentPath === undefined ? current.attachment_path : input.attachmentPath;
    await checkLinks(
      student!,
      input.skillIds,
      attachment === current.attachment_path ? null : attachment,
    );
    const requestId = c.get('requestId');
    const saved = await sql.begin(async (tx) => {
      await tx`
        update app.school_assessments set
          subject_code = ${input.subjectCode ?? current.subject_code},
          assessed_on = ${input.assessedOn ?? current.assessed_on}::date,
          type = ${input.type ?? current.type},
          score = ${score}, max_score = ${maxScore},
          school_year = ${input.schoolYear ?? current.school_year},
          semester = ${input.semester ?? current.semester},
          topic_tags = ${input.topicTags ?? current.topic_tags}::text[],
          note = ${input.note === undefined ? current.note : input.note || null},
          teacher_comment = ${
            input.teacherComment === undefined
              ? current.teacher_comment
              : input.teacherComment || null
          },
          attachment_path = ${attachment}
        where id = ${id} and ${scope.where()}`;
      if (input.skillIds) await setSkills(tx, id, current.household_id, input.skillIds);
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'school_assessment.updated',
        targetType: 'school_assessment',
        targetId: id,
        householdId: current.household_id,
        requestId,
        details: { studentId: current.student_id, fields: Object.keys(input) },
      });
      return (await assessmentById(tx, scope, id))!;
    });
    // The replaced file is no longer referenced.
    if (current.attachment_path && current.attachment_path !== attachment) {
      await deps.storage?.remove(ASSESSMENT_FILE_BUCKET, [current.attachment_path]);
    }
    return c.json({ assessment: await toAssessment(saved) }, 200);
  });

  app.openapi(deleteAssessmentRoute, async (c) => {
    const parent = requireActor(c.get('actor'), 'parent');
    const { id } = c.req.valid('param');
    const scope = await scopeFor(sql, parent);
    const requestId = c.get('requestId');
    const removed = await sql.begin(async (tx) => {
      const current = await assessmentById(tx, scope, id, true);
      if (!current) throw new ApiError('NOT_FOUND', 'Assessment not found');
      await tx`delete from app.school_assessments where id = ${id} and ${scope.where()}`;
      await writeAudit(tx, {
        actorType: 'parent',
        actorId: parent.userId,
        action: 'school_assessment.deleted',
        targetType: 'school_assessment',
        targetId: id,
        householdId: current.household_id,
        requestId,
        details: {
          studentId: current.student_id,
          subjectCode: current.subject_code,
          assessedOn: current.assessed_on,
        },
      });
      return current;
    });
    if (removed.attachment_path) {
      await deps.storage?.remove(ASSESSMENT_FILE_BUCKET, [removed.attachment_path]);
    }
    return c.body(null, 204);
  });

  app.openapi(uploadSignRoute, async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const { student } = await parentAndStudent(c, id);
    if (!deps.storage) throw new ApiError('SERVICE_UNAVAILABLE', 'Storage is not configured');
    const path = assessmentFilePath(
      { householdId: student.household_id, studentId: id, fileId: crypto.randomUUID() },
      input.contentType,
    );
    return c.json(
      {
        path,
        uploadUrl: await deps.storage.createSignedUploadUrl(ASSESSMENT_FILE_BUCKET, path),
        expiresAt: new Date(now().getTime() + PROOF_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        maxBytes: MAX_ASSESSMENT_FILE_BYTES,
      },
      200,
    );
  });

  // Dashboard --------------------------------------------------------------------------------------

  app.openapi(dashboardRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { range } = c.req.valid('query');
    const { student } = await parentAndStudent(c, id);
    return c.json(await buildDashboard(sql, student, range, now()), 200);
  });

  app.openapi(overviewRoute, async (c) => {
    const parent = requireActor(c.get('actor'), 'parent');
    const scope = await scopeFor(sql, parent);
    const at = now();
    const children = [];
    // One child after the other: each dashboard already runs its queries side by side.
    for (const student of await students(scope)) {
      const d = await buildDashboard(sql, student, '7d', at);
      const signals = [...d.learning.improving, ...d.learning.atRisk];
      children.push({
        studentId: student.id,
        displayName: student.display_name,
        grade: student.grade,
        avatar: student.avatar,
        today: d.today,
        streak: d.streak,
        coinBalance: d.rewards.coinBalance,
        coinsToday: d.rewards.coinsToday,
        coinsWeek: d.rewards.coinsWeek,
        skillsImproving: d.learning.improving.length,
        skillsAtRisk: d.learning.atRisk.length,
        // The weakest label among the listed skills; INSUFFICIENT when there is none to list.
        skillsSufficiency:
          signals.length === 0
            ? ('INSUFFICIENT' as const)
            : signals.some((s) => s.sufficiency === 'LOW')
              ? ('LOW' as const)
              : ('OK' as const),
        upcomingExams: d.upcomingExams,
      });
    }
    return c.json({ children }, 200);
  });
}
