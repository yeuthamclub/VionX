// M05 admin library routes (TASK_PACKS/M05.md "API / tools"): package import (dry-run → apply),
// curriculum tree, item list/detail/edit, variant re-roll, groups, coverage. Admin only (CONTRACT
// D11); child-facing reads arrive with M06 and serve only APPROVED/PUBLISHED content.
import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import {
  ContentStatusSchema,
  CoverageResponseSchema,
  CurriculumResponseSchema,
  GroupDetailSchema,
  GroupListQuerySchema,
  GroupListResponseSchema,
  GroupPatchSchema,
  IdParamSchema,
  ImportQuerySchema,
  ImportResultSchema,
  ImportRunsResponseSchema,
  ItemDetailSchema,
  ItemListQuerySchema,
  ItemListResponseSchema,
  ItemPatchSchema,
  LibraryOverviewSchema,
  ScopeQuerySchema,
  sha256Hex,
  VariantQuerySchema,
  VariantResponseSchema,
  type GroupPatch,
  type ItemDetail,
  type ItemPatch,
} from '@vionx/contracts';
import {
  answerProblem,
  canonicalJson,
  coverageReport,
  HINT_LADDER_LENGTH,
  isTemplateItemType,
  probeTemplate,
  renderVariant,
  VALIDATION_SEEDS,
  type AdminPermission,
  type CognitiveLevel,
  type ContentStatus,
  type EdgeType,
  type ItemAnswer,
  type ItemKind,
  type ItemType,
  type NodeLevel,
  type PackageItem,
  type SourceKind,
  type StimulusKind,
  type VariantTemplate,
} from '@vionx/domain';
import { unzipSync } from 'fflate';
import { requireAnyPermission } from '../../_shared/actor.ts';
import { ApiError } from '../../_shared/errors.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { writeAudit, writeEvent } from '../identity/repo.ts';
import { body, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import { applyImport, planImport, prepareImport } from './import.ts';
import * as repo from './repo.ts';

/** Who may do what (CONTRACT D11). SUPER_ADMIN implies all. */
export const LIBRARY_READ: readonly AdminPermission[] = [
  'CONTENT_ADMIN',
  'CURRICULUM_EDITOR',
  'CONTENT_REVIEWER',
  'LIBRARIAN',
];
export const LIBRARY_EDIT: readonly AdminPermission[] = ['CONTENT_ADMIN', 'CONTENT_REVIEWER'];
export const LIBRARY_IMPORT: readonly AdminPermission[] = ['CONTENT_ADMIN'];

/** Upload limit for a package zip (500 items with SVGs is well under 5 MB). */
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

const TAGS = ['library'];
const READ_ERRORS = errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN');

// --- Route definitions ----------------------------------------------------------------------------

const importRoute = createRoute({
  method: 'post',
  path: '/v1/admin/library/import',
  tags: TAGS,
  summary: 'Import a library package (zip): dry-run diff or apply',
  description:
    'CONTENT_ADMIN. Body: the package zip (`library/<version>/<grade>-<subject>/`). Validates schema, checksums and the library rules, then diffs against the library. `mode=apply` writes everything in one transaction; re-importing the same package is a no-op. Entities the package no longer lists are archived, never deleted. An invalid package answers 422 PACKAGE_INVALID with `details.errors`.',
  security: PARENT,
  request: {
    query: ImportQuerySchema,
    body: {
      content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
      required: true,
    },
  },
  responses: {
    200: json(ImportResultSchema, 'Validation, diff and coverage (applied when mode=apply)'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'PACKAGE_INVALID'),
  },
});

const importRunsRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/imports',
  tags: TAGS,
  summary: 'Recent package imports',
  security: PARENT,
  responses: { 200: json(ImportRunsResponseSchema, 'Newest first, at most 50'), ...READ_ERRORS },
});

const overviewRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library',
  tags: TAGS,
  summary: 'Curriculum versions, imported libraries and subject profiles',
  security: PARENT,
  responses: { 200: json(LibraryOverviewSchema, 'Library overview'), ...READ_ERRORS },
});

const curriculumRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/curriculum',
  tags: TAGS,
  summary: 'Curriculum tree of one grade-subject',
  description:
    'Flat node list (build the tree from parentId) with item counts per skill, plus active edges.',
  security: PARENT,
  request: { query: ScopeQuerySchema },
  responses: {
    200: json(CurriculumResponseSchema, 'Nodes and edges'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const coverageRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/coverage',
  tags: TAGS,
  summary: 'Coverage report of one grade-subject',
  description:
    'Items per skill, level and type, TEMPLATE/group/written/read-aloud shares against the subject profile, total vs target 500, inactive skills (< 2 approved items).',
  security: PARENT,
  request: { query: ScopeQuerySchema },
  responses: {
    200: json(CoverageResponseSchema, 'Coverage'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const itemsRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/items',
  tags: TAGS,
  summary: 'List items',
  description:
    'Filter by grade, subject, skill code, status, kind, type, level, group or text; cursor pagination by code.',
  security: PARENT,
  request: { query: ItemListQuerySchema },
  responses: { 200: json(ItemListResponseSchema, 'A page of items'), ...READ_ERRORS },
});

const itemRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/items/{id}',
  tags: TAGS,
  summary: 'Item detail (with template, group and media)',
  security: PARENT,
  request: { params: IdParamSchema },
  responses: {
    200: json(ItemDetailSchema, 'Item'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const itemPatchRoute = createRoute({
  method: 'patch',
  path: '/v1/admin/library/items/{id}',
  tags: TAGS,
  summary: 'Edit an item (content fields, status, template)',
  description:
    'CONTENT_ADMIN or CONTENT_REVIEWER. `version` must be the one loaded (409 otherwise). The same rules as import apply (answer shape, 4 hints, rubric for written items, template renders). Audited; version + 1.',
  security: PARENT,
  request: { params: IdParamSchema, ...body(ItemPatchSchema) },
  responses: {
    200: json(ItemDetailSchema, 'Updated item'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const variantRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/items/{id}/variant',
  tags: TAGS,
  summary: 'Render a TEMPLATE item variant for a seed',
  description:
    'Deterministic: the same seed gives the same variant (renderVariant). A template that cannot satisfy its constraints within 50 draws is flagged and answers 409.',
  security: PARENT,
  request: { params: IdParamSchema, query: VariantQuerySchema },
  responses: {
    200: json(VariantResponseSchema, 'Variant'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

const groupsRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/groups',
  tags: TAGS,
  summary: 'List item groups (passages, poems, dialogues, picture scenes, experiments)',
  security: PARENT,
  request: { query: GroupListQuerySchema },
  responses: { 200: json(GroupListResponseSchema, 'Groups'), ...READ_ERRORS },
});

const groupRoute = createRoute({
  method: 'get',
  path: '/v1/admin/library/groups/{id}',
  tags: TAGS,
  summary: 'Group detail with its items',
  security: PARENT,
  request: { params: IdParamSchema },
  responses: {
    200: json(GroupDetailSchema, 'Group'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'),
  },
});

const groupPatchRoute = createRoute({
  method: 'patch',
  path: '/v1/admin/library/groups/{id}',
  tags: TAGS,
  summary: 'Edit a group',
  description:
    'CONTENT_ADMIN or CONTENT_REVIEWER. PUBLIC_DOMAIN and LICENSED groups need a source note. `version` must match (409 otherwise). Audited.',
  security: PARENT,
  request: { params: IdParamSchema, ...body(GroupPatchSchema) },
  responses: {
    200: json(GroupDetailSchema, 'Updated group'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'),
  },
});

// --- Mapping --------------------------------------------------------------------------------------

type ItemSummary = z.infer<typeof ItemListResponseSchema>['items'][number];

function toSummary(row: repo.ItemRow): ItemSummary {
  return {
    id: row.id,
    code: row.code,
    grade: row.grade,
    subject: row.subject,
    kind: row.kind,
    type: row.type as ItemType,
    cognitiveLevel: row.cognitive_level as CognitiveLevel,
    difficulty: row.difficulty,
    status: row.status as ContentStatus,
    stemMd: row.stem_md,
    skills: row.skills,
    groupId: row.group_id,
    version: row.version,
    templateFlagged: row.template_flagged,
    updatedAt: iso(row.updated_at)!,
  };
}

function toMedia(row: repo.MediaRow) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    inlineSvg: row.inline_svg,
    storagePath: row.storage_path,
    alt: row.alt_vi,
    license: row.license,
    attribution: row.attribution,
    reviewStatus: row.review_status,
  };
}

function toGroup(row: repo.GroupRow) {
  return {
    id: row.id,
    code: row.code,
    grade: row.grade,
    subject: row.subject,
    stimulusKind: row.stimulus_kind as StimulusKind,
    title: row.title,
    bodyMd: row.body_md,
    ttsText: row.tts_text,
    ttsLang: row.tts_lang,
    mediaIds: row.media_ids,
    wordCount: row.word_count,
    genre: row.genre,
    sourceKind: row.source_kind as SourceKind,
    sourceNote: row.source_note,
    status: row.status as ContentStatus,
    version: row.version,
    itemCount: row.item_count,
    updatedAt: iso(row.updated_at)!,
  };
}

function toTemplate(row: repo.TemplateRow) {
  return {
    params: row.params as never,
    constraints: row.constraints,
    answerExpr: row.answer_expr,
    render: row.render as never,
    distractorExprs: row.distractor_exprs,
    flaggedAt: iso(row.flagged_at),
    flagReason: row.flag_reason,
  };
}

const optionMediaCodes = (options: unknown[]) =>
  options.flatMap((o) => {
    const media = (o as { media?: unknown }).media;
    return typeof media === 'string' ? [media] : [];
  });

// --- Handlers -------------------------------------------------------------------------------------

export function registerLibraryRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const guard = (
    c: { get(key: 'actor'): AppEnv['Variables']['actor'] },
    perms: readonly AdminPermission[],
  ) => requireAnyPermission(c.get('actor'), deps.admins, perms);

  async function loadItemDetail(id: string): Promise<ItemDetail> {
    const row = await repo.itemDetail(sql, id);
    if (!row) throw new ApiError('NOT_FOUND', 'Item not found');
    const [tpl, groups] = await Promise.all([
      row.kind === 'TEMPLATE' ? repo.template(sql, id) : Promise.resolve(null),
      row.group_id ? repo.listGroups(sql, { id: row.group_id }) : Promise.resolve([]),
    ]);
    const group = groups[0] ?? null;
    const media = await repo.mediaByIdsOrCodes(
      sql,
      [...row.media_ids, ...(group?.media_ids ?? [])],
      optionMediaCodes(row.options),
    );
    return {
      ...toSummary(row),
      difficulty: row.difficulty,
      stemMd: row.stem_md,
      options: row.options as never,
      answer: row.answer as never,
      explanationMd: row.explanation_md,
      hints: row.hints as never,
      workedSolutionMd: row.worked_solution_md,
      distractorFeedback: row.distractor_feedback as never,
      misconceptionTags: row.misconception_tags,
      rubric: row.rubric as never,
      ttsText: row.tts_text,
      ttsLang: row.tts_lang,
      mediaIds: row.media_ids,
      groupOrder: row.group_order,
      sourceRefs: row.source_refs,
      provenance: row.provenance,
      template: tpl ? toTemplate(tpl) : null,
      group: group ? toGroup(group) : null,
      media: media.map(toMedia),
    };
  }

  async function loadGroupDetail(id: string) {
    const [group] = await repo.listGroups(sql, { id });
    if (!group) throw new ApiError('NOT_FOUND', 'Group not found');
    const items = await repo.listItems(sql, { groupId: id, limit: 100 });
    const media = await repo.mediaByIdsOrCodes(sql, group.media_ids, []);
    return {
      ...toGroup(group),
      items: items
        .slice(0, 100)
        .sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0))
        .map((r) => ({ ...toSummary(r), groupOrder: r.group_order })),
      media: media.map(toMedia),
    };
  }

  app.openapi(importRoute, async (c) => {
    const admin = await guard(c, LIBRARY_IMPORT);
    const { mode } = c.req.valid('query');
    const length = Number(c.req.header('content-length') ?? '0');
    if (length > MAX_PACKAGE_BYTES) {
      throw new ApiError('VALIDATION_FAILED', `Package is larger than ${MAX_PACKAGE_BYTES} bytes`);
    }
    const buffer = new Uint8Array(await c.req.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PACKAGE_BYTES) {
      throw new ApiError('VALIDATION_FAILED', 'Upload the package as a zip body (at most 20 MB)');
    }
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(buffer);
    } catch {
      throw new ApiError('VALIDATION_FAILED', 'Body is not a zip file');
    }
    const requestId = c.get('requestId');
    const runMode = mode === 'apply' ? 'APPLY' : 'DRY_RUN';

    const prepared = await prepareImport(files);
    const invalid = async (
      errors: { code: string; message: string; ref?: string | undefined }[],
      warnings: unknown[],
      manifest?: { curriculumVersion: string; grade: number; subject: string },
    ) => {
      if (manifest) {
        await repo.insertImportRun(sql, {
          mode: runMode,
          curriculumVersion: manifest.curriculumVersion,
          grade: manifest.grade,
          subject: manifest.subject,
          sha256: await sha256Hex(buffer),
          manifest,
          valid: false,
          errors,
          diff: {},
          createdBy: admin.userId,
        });
      }
      throw new ApiError(
        'PACKAGE_INVALID',
        `Package is invalid: ${errors[0]?.message ?? 'unknown error'}`,
        {
          errors,
          warnings,
        },
      );
    };
    if (!prepared.ok) return invalid(prepared.errors, prepared.warnings, prepared.manifest);
    const p = prepared.prepared;
    const { manifest } = p.pkg;

    const result = await sql.begin(async (tx) => {
      // One import per grade-subject at a time.
      await tx`select pg_advisory_xact_lock(hashtext(${`library-import:${manifest.curriculumVersion}:${manifest.grade}-${manifest.subject}`}))`;
      const plan = await planImport(tx, p);
      if (plan.errors.length > 0) return { errors: plan.errors } as const;
      const noop = Object.values(plan.diff).every(
        (d) => d.added.length + d.updated.length + d.archived.length === 0,
      );
      const apply = runMode === 'APPLY' && !noop;
      if (apply) await applyImport(tx, p, plan.diff);
      const importId = await repo.insertImportRun(tx, {
        mode: runMode,
        curriculumVersion: manifest.curriculumVersion,
        grade: manifest.grade,
        subject: manifest.subject,
        sha256: p.sha256,
        manifest,
        valid: true,
        errors: [],
        diff: plan.diff,
        createdBy: admin.userId,
      });
      if (runMode === 'APPLY') {
        const summary = Object.fromEntries(
          Object.entries(plan.diff).map(([k, d]) => [
            k,
            { added: d.added.length, updated: d.updated.length, archived: d.archived.length },
          ]),
        );
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: admin.userId,
          action: 'library.import_applied',
          targetType: 'library_import',
          targetId: importId,
          householdId: null,
          requestId,
          details: {
            curriculumVersion: manifest.curriculumVersion,
            grade: manifest.grade,
            subject: manifest.subject,
            sha256: p.sha256,
            noop,
            diff: summary,
          },
        });
        if (apply) {
          await writeEvent(tx, {
            type: 'library.imported',
            householdId: null,
            aggregateType: 'library_import',
            aggregateId: importId,
            payload: {
              curriculumVersion: manifest.curriculumVersion,
              grade: manifest.grade,
              subject: manifest.subject,
              diff: summary,
            },
          });
        }
      }
      return { importId, diff: plan.diff, noop, applied: apply } as const;
    });
    if ('errors' in result) return invalid(result.errors ?? [], p.warnings, manifest);

    const coverage = await coverageFor(
      manifest.curriculumVersion,
      manifest.grade,
      manifest.subject,
      result.applied || result.noop ? undefined : p,
    );
    return c.json(
      {
        importId: result.importId,
        mode: runMode,
        applied: result.applied,
        package: {
          curriculumVersion: manifest.curriculumVersion,
          grade: manifest.grade,
          subject: manifest.subject,
          title: manifest.title,
          sha256: p.sha256,
        },
        warnings: p.warnings,
        diff: result.diff,
        noop: result.noop,
        coverage: coverage.coverage,
      },
      200,
    );
  });

  /**
   * Coverage from the database, or (dry-run of changes) from the package itself so the admin sees
   * what the library would look like after apply.
   */
  async function coverageFor(
    versionCode: string,
    grade: number,
    subject: string,
    fromPackage?: Awaited<ReturnType<typeof prepareImport>> extends infer R
      ? R extends { ok: true; prepared: infer P }
        ? P
        : never
      : never,
  ) {
    const profileRow = await repo.profile(sql, grade, subject);
    const profile = profileRow
      ? {
          templateShare: Number(profileRow.template_share),
          groupShare: Number(profileRow.group_share),
          writtenShare: Number(profileRow.written_share),
          readAloudDefault: profileRow.read_aloud_default,
          targetItems: profileRow.target_items,
        }
      : undefined;
    if (fromPackage) {
      const { pkg } = fromPackage;
      return {
        profileRow,
        coverage: coverageReport(
          pkg.curriculum.nodes
            .filter((n) => n.level === 'SKILL')
            .map((n) => ({ code: n.code, title: n.title })),
          pkg.items.map((i) => ({
            skills: i.skills,
            kind: i.kind,
            type: i.type,
            cognitiveLevel: i.cognitiveLevel,
            status: i.status,
            inGroup: i.group !== undefined,
            hasTts: Boolean(i.ttsText?.trim()),
          })),
          profile,
        ),
      };
    }
    const version = await repo.versionId(sql, versionCode);
    const nodes = version ? await repo.curriculumNodes(sql, version, grade, subject) : [];
    const items = await repo.coverageItems(sql, grade, subject);
    return {
      profileRow,
      coverage: coverageReport(
        nodes
          .filter((n) => n.level === 'SKILL' && n.status !== 'ARCHIVED')
          .map((n) => ({ code: n.code, title: n.title_vi })),
        items.map((i) => ({
          skills: i.skill_codes,
          kind: i.kind as ItemKind,
          type: i.type as ItemType,
          cognitiveLevel: i.cognitive_level as CognitiveLevel,
          status: i.status as ContentStatus,
          inGroup: i.in_group,
          hasTts: i.has_tts,
        })),
        profile,
      ),
    };
  }

  const toProfile = (p: repo.ProfileRow) => ({
    grade: p.grade,
    subject: p.subject,
    titleVi: p.title_vi,
    templateShare: Number(p.template_share),
    groupShare: Number(p.group_share),
    writtenShare: Number(p.written_share),
    readAloudDefault: p.read_aloud_default,
    ttsLang: p.tts_lang,
    imageLevel: p.image_level,
    itemTypeMix: p.item_type_mix,
    targetItems: p.target_items,
  });

  app.openapi(importRunsRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const runs = await repo.importRuns(sql, 50);
    return c.json(
      {
        runs: runs.map((r) => ({
          id: r.id,
          mode: r.mode,
          curriculumVersion: r.curriculum_version,
          grade: r.grade,
          subject: r.subject,
          packageSha256: r.package_sha256,
          title: r.manifest.title ?? '',
          valid: r.valid,
          errorCount: Array.isArray(r.errors) ? r.errors.length : 0,
          diff: r.diff,
          createdBy: r.created_by,
          createdAt: iso(r.created_at)!,
        })),
      },
      200,
    );
  });

  app.openapi(overviewRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const [versions, libraries, profiles] = await Promise.all([
      repo.versions(sql),
      repo.libraries(sql),
      repo.profiles(sql),
    ]);
    return c.json(
      {
        versions: versions.map((v) => ({
          id: v.id,
          code: v.code,
          title: v.title,
          academicYear: v.academic_year,
          status: v.status,
        })),
        libraries: libraries.map((l) => ({
          curriculumVersion: l.curriculum_version,
          grade: l.grade,
          subject: l.subject,
          titleVi: l.title_vi,
          skills: l.skills,
          activeSkills: l.active_skills,
          items: l.items,
          approvedItems: l.approved_items,
          lastImportAt: iso(l.last_import_at),
        })),
        profiles: profiles.map(toProfile),
      },
      200,
    );
  });

  app.openapi(curriculumRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const q = c.req.valid('query');
    const version = await repo.versionId(sql, q.version);
    if (!version) throw new ApiError('NOT_FOUND', `Curriculum version ${q.version} not found`);
    const [nodes, edges] = await Promise.all([
      repo.curriculumNodes(sql, version, q.grade, q.subject),
      repo.curriculumEdges(sql, version, q.grade, q.subject),
    ]);
    return c.json(
      {
        nodes: nodes.map((n) => ({
          id: n.id,
          parentId: n.parent_id,
          level: n.level as NodeLevel,
          code: n.code,
          title: n.title_vi,
          description: n.description,
          gdptRef: n.gdpt_requirement_ref,
          weight: Number(n.weight),
          sortOrder: n.sort_order,
          status: n.status,
          items: n.items,
          approvedItems: n.approved_items,
          active: n.level === 'SKILL' && n.status === 'ACTIVE' && n.approved_items >= 2,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          fromId: e.from_node_id,
          toId: e.to_node_id,
          type: e.type as EdgeType,
          reason: e.reason,
        })),
      },
      200,
    );
  });

  app.openapi(coverageRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const q = c.req.valid('query');
    if (!(await repo.versionId(sql, q.version))) {
      throw new ApiError('NOT_FOUND', `Curriculum version ${q.version} not found`);
    }
    const { profileRow, coverage } = await coverageFor(q.version, q.grade, q.subject);
    return c.json({ profile: profileRow ? toProfile(profileRow) : null, coverage }, 200);
  });

  app.openapi(itemsRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const q = c.req.valid('query');
    let skillId: string | undefined;
    if (q.skill) {
      const version = await repo.versionId(sql, q.version);
      skillId = (version && (await repo.skillByCode(sql, version, q.skill))) || undefined;
      if (!skillId) return c.json({ items: [], nextCursor: null }, 200);
    }
    let after: string | undefined;
    if (q.cursor) {
      try {
        after = atob(q.cursor);
      } catch {
        throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
      }
    }
    const rows = await repo.listItems(sql, {
      grade: q.grade,
      subject: q.subject,
      skillId,
      status: q.status,
      kind: q.kind,
      type: q.type,
      level: q.level,
      groupId: q.groupId,
      q: q.q,
      after,
      limit: q.limit,
    });
    const page = rows.slice(0, q.limit);
    const nextCursor = rows.length > q.limit ? btoa(page[page.length - 1]!.code) : null;
    return c.json({ items: page.map(toSummary), nextCursor }, 200);
  });

  app.openapi(itemRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    return c.json(await loadItemDetail(c.req.valid('param').id), 200);
  });

  app.openapi(itemPatchRoute, async (c) => {
    const admin = await guard(c, LIBRARY_EDIT);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json') as ItemPatch;
    const current = await loadItemDetail(id);
    if (current.version !== patch.version) {
      throw new ApiError('CONFLICT', 'The item changed since you loaded it; reload and try again', {
        currentVersion: current.version,
      });
    }
    const { version: _v, template: templatePatch, ...fields } = patch;
    const merged = { ...current, ...fields };

    const problems: string[] = [];
    if (merged.hints.length !== HINT_LADDER_LENGTH)
      problems.push(`exactly ${HINT_LADDER_LENGTH} hints are required`);
    if ((merged.type === 'written') !== (merged.rubric !== null)) {
      problems.push('written items need a rubric; other items have none');
    }
    if (current.kind === 'STATIC') {
      const answerIssue = answerProblem({
        type: merged.type,
        options: merged.options,
        answer: merged.answer as ItemAnswer | null,
      } as Pick<PackageItem, 'type' | 'options' | 'answer'>);
      if (answerIssue) problems.push(answerIssue);
      const ids = new Set(merged.options.map((o) => o.id));
      for (const key of Object.keys(merged.distractorFeedback)) {
        if (!ids.has(key)) problems.push(`distractor feedback for unknown option ${key}`);
      }
    } else if (templatePatch) {
      if (!isTemplateItemType(current.type))
        problems.push(`type ${current.type} cannot be a TEMPLATE item`);
      else {
        const probe = probeTemplate(
          { item: current.code, type: current.type, ...templatePatch },
          VALIDATION_SEEDS,
        );
        if (!probe.ok)
          problems.push(`template (seed ${probe.seed}): ${probe.message ?? probe.error}`);
      }
    }
    if (templatePatch && current.kind !== 'TEMPLATE')
      problems.push('only TEMPLATE items have a template');
    if (problems.length > 0) throw new ApiError('VALIDATION_FAILED', problems[0]!, { problems });

    const changed = [...Object.keys(fields), ...(templatePatch ? ['template'] : [])];
    const editedHash = `admin:${await sha256Hex(canonicalJson({ ...fields, template: templatePatch }))}`;
    await sql.begin(async (tx) => {
      const updated = await tx`
        update library.items set
          difficulty = ${merged.difficulty}, cognitive_level = ${merged.cognitiveLevel}, stem_md = ${merged.stemMd},
          options = ${tx.json(merged.options as never)},
          answer = ${merged.answer === null ? null : tx.json(merged.answer as never)},
          explanation_md = ${merged.explanationMd}, hints = ${tx.json(merged.hints as never)},
          worked_solution_md = ${merged.workedSolutionMd},
          distractor_feedback = ${tx.json(merged.distractorFeedback as never)},
          misconception_tags = ${merged.misconceptionTags}::text[],
          rubric = ${merged.rubric === null ? null : tx.json(merged.rubric as never)},
          tts_text = ${merged.ttsText}, tts_lang = ${merged.ttsLang}, status = ${merged.status},
          content_hash = ${editedHash}, version = version + 1
        where id = ${id} and version = ${patch.version}`;
      if (updated.count === 0)
        throw new ApiError(
          'CONFLICT',
          'The item changed since you loaded it; reload and try again',
        );
      if (templatePatch) {
        await tx`
          update library.item_templates set
            params = ${tx.json(templatePatch.params as never)}, constraints = ${tx.json(templatePatch.constraints as never)},
            answer_expr = ${templatePatch.answerExpr}, render = ${tx.json(templatePatch.render as never)},
            distractor_exprs = ${tx.json(templatePatch.distractorExprs as never)},
            content_hash = ${editedHash}, flagged_at = null, flag_reason = null
          where item_id = ${id}`;
      }
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: admin.userId,
        action: 'library.item_updated',
        targetType: 'library_item',
        targetId: id,
        householdId: null,
        requestId: c.get('requestId'),
        details: {
          code: current.code,
          fields: changed,
          fromVersion: current.version,
          status: merged.status,
        },
      });
    });
    return c.json(await loadItemDetail(id), 200);
  });

  app.openapi(variantRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const { id } = c.req.valid('param');
    const { seed } = c.req.valid('query');
    const item = await repo.itemDetail(sql, id);
    if (!item) throw new ApiError('NOT_FOUND', 'Item not found');
    const tpl = item.kind === 'TEMPLATE' ? await repo.template(sql, id) : null;
    if (!tpl || !isTemplateItemType(item.type as ItemType)) {
      throw new ApiError('CONFLICT', 'Only TEMPLATE items have variants');
    }
    const template: VariantTemplate = {
      item: item.code,
      type: item.type as ItemType,
      params: tpl.params as never,
      constraints: tpl.constraints,
      answerExpr: tpl.answer_expr,
      render: tpl.render as never,
      distractorExprs: tpl.distractor_exprs,
    };
    const result = renderVariant(template, seed);
    if (!result.ok) {
      await sql`
        update library.item_templates set flagged_at = now(), flag_reason = ${`${result.error}: ${result.message ?? ''}`}
        where item_id = ${id} and flagged_at is null`;
      throw new ApiError('CONFLICT', result.message ?? result.error, {
        reason: result.error,
        seed,
      });
    }
    const v = result.value;
    return c.json(
      {
        seed: v.seed,
        params: v.params,
        stemMd: v.stemMd,
        ttsText: v.ttsText ?? null,
        explanationMd: v.explanationMd ?? null,
        options: v.options,
        optionFeedbackKeys: v.optionFeedbackKeys,
        answer: v.answer,
        distractors: v.distractors,
      },
      200,
    );
  });

  app.openapi(groupsRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    const q = c.req.valid('query');
    const rows = await repo.listGroups(sql, {
      grade: q.grade,
      subject: q.subject,
      status: q.status,
    });
    return c.json({ groups: rows.map(toGroup) }, 200);
  });

  app.openapi(groupRoute, async (c) => {
    await guard(c, LIBRARY_READ);
    return c.json(await loadGroupDetail(c.req.valid('param').id), 200);
  });

  app.openapi(groupPatchRoute, async (c) => {
    const admin = await guard(c, LIBRARY_EDIT);
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json') as GroupPatch;
    const current = await loadGroupDetail(id);
    if (current.version !== patch.version) {
      throw new ApiError(
        'CONFLICT',
        'The group changed since you loaded it; reload and try again',
        {
          currentVersion: current.version,
        },
      );
    }
    const { version: _v, ...fields } = patch;
    const merged = { ...current, ...fields };
    if (merged.sourceKind !== 'ORIGINAL_AI' && !merged.sourceNote?.trim()) {
      throw new ApiError('VALIDATION_FAILED', `${merged.sourceKind} groups need a source note`);
    }
    const editedHash = `admin:${await sha256Hex(canonicalJson(fields))}`;
    await sql.begin(async (tx) => {
      const updated = await tx`
        update library.item_groups set
          stimulus_kind = ${merged.stimulusKind}, title = ${merged.title}, body_md = ${merged.bodyMd},
          tts_text = ${merged.ttsText}, tts_lang = ${merged.ttsLang}, word_count = ${merged.wordCount},
          genre = ${merged.genre}, source_kind = ${merged.sourceKind}, source_note = ${merged.sourceNote},
          status = ${merged.status}, content_hash = ${editedHash}, version = version + 1
        where id = ${id} and version = ${patch.version}`;
      if (updated.count === 0)
        throw new ApiError(
          'CONFLICT',
          'The group changed since you loaded it; reload and try again',
        );
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: admin.userId,
        action: 'library.group_updated',
        targetType: 'library_group',
        targetId: id,
        householdId: null,
        requestId: c.get('requestId'),
        details: {
          code: current.code,
          fields: Object.keys(fields),
          fromVersion: current.version,
          status: merged.status,
        },
      });
    });
    return c.json(await loadGroupDetail(id), 200);
  });
}

/** Statuses an item may be set to from the editor. */
export const EDITOR_STATUSES = ContentStatusSchema.options;
