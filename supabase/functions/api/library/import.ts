// Library package import (TASK_PACKS/M05.md): parse → validate → diff against the database →
// apply in one transaction. Idempotent by code + content hash; entities of the package's
// curriculum version and grade-subject that the package no longer lists are archived, never deleted.
import {
  canonicalJson,
  diffEntities,
  isNoopDiff,
  NODE_LEVELS,
  validateLibraryPackage,
  type EntityDiff,
  type ExistingEntity,
  type LibraryPackage,
  type PackageIssue,
} from '@vionx/domain';
import {
  parseLibraryPackage,
  sha256Hex,
  type ImportEntity,
  type PackageFiles,
} from '@vionx/contracts';
import type { Sql, TxSql } from '../../_shared/db.ts';

type Db = Sql | TxSql;

export type ImportDiff = Record<ImportEntity, EntityDiff>;

/** Hashes of every package line, keyed per entity by its import key. */
type Incoming = Record<ImportEntity, Map<string, string>>;

export interface PreparedImport {
  pkg: LibraryPackage;
  sha256: string;
  warnings: PackageIssue[];
  sanitisedSvg: Record<string, string>;
  incoming: Incoming;
}

export type PrepareResult =
  | { ok: true; prepared: PreparedImport }
  | {
      ok: false;
      errors: PackageIssue[];
      warnings: PackageIssue[];
      manifest?: LibraryPackage['manifest'];
    };

const hash = (value: unknown) => sha256Hex(canonicalJson(value));
const edgeKey = (e: { from: string; to: string; type: string }) => `${e.from}|${e.to}|${e.type}`;
const mappingKey = (m: { series: string; lessonRef: string; node: string }) =>
  `${m.series}|${m.lessonRef}|${m.node}`;

/** Parse + domain validation + per-line hashes. No database access. */
export async function prepareImport(files: PackageFiles): Promise<PrepareResult> {
  const parsed = await parseLibraryPackage(files);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: [] };
  const { pkg } = parsed;
  const validation = validateLibraryPackage(pkg);
  const errors = [...validation.errors];
  const grades = pkg.curriculum.nodes.filter((n) => n.level === 'GRADE');
  if (grades.length !== 1) {
    errors.push({
      code: 'GRADE_NODE',
      message: `a package has exactly one GRADE node (found ${grades.length})`,
    });
  }
  const subject = pkg.curriculum.nodes.find((n) => n.level === 'SUBJECT');
  if (subject && grades[0] && subject.parent !== grades[0].code) {
    errors.push({
      code: 'SUBJECT_PARENT',
      message: `SUBJECT node ${subject.code} must sit under the GRADE node`,
      ref: subject.code,
    });
  }
  const warnings = [...parsed.warnings, ...validation.warnings];
  if (errors.length > 0) return { ok: false, errors, warnings, manifest: pkg.manifest };

  const map = async <T>(
    rows: T[],
    key: (row: T) => string,
    value: (row: T) => unknown = (r) => r,
  ) => new Map(await Promise.all(rows.map(async (r) => [key(r), await hash(value(r))] as const)));
  const svg = validation.sanitisedSvg;
  const incoming: Incoming = {
    nodes: await map(pkg.curriculum.nodes, (n) => n.code),
    edges: await map(pkg.edges, edgeKey),
    series: await map(pkg.mappings.series, (s) => s.code),
    mappings: await map(pkg.mappings.mappings, mappingKey),
    // The sanitised markup is part of a media line's content.
    media: await map(
      pkg.media,
      (m) => m.code,
      (m) => ({ ...m, svg: svg[m.code] }),
    ),
    groups: await map(pkg.groups, (g) => g.code),
    items: await map(pkg.items, (i) => i.code),
    templates: await map(pkg.templates, (t) => t.item),
  };
  return {
    ok: true,
    prepared: { pkg, sha256: parsed.sha256, warnings, sanitisedSvg: svg, incoming },
  };
}

interface Scope {
  versionId: string | null;
  grade: number;
  subject: string;
}

type ExistingRow = {
  key: string;
  hash: string;
  archived: boolean;
  grade: number | null;
  subject: string | null;
  /** Curriculum version code, for entities whose codes are global (series, media, groups, items). */
  version?: string;
};

async function existingRows(
  db: Db,
  entity: ImportEntity,
  scope: Scope,
  codes: string[],
): Promise<ExistingRow[]> {
  const { grade, subject, versionId } = scope;
  switch (entity) {
    case 'nodes':
      if (!versionId) return [];
      // The scope's own nodes plus any incoming code (to catch codes owned by another package).
      return db<ExistingRow[]>`
        select code as key, content_hash as hash, status = 'ARCHIVED' as archived, grade, subject
        from library.curriculum_nodes
        where version_id = ${versionId}
          and ((grade = ${grade} and subject = ${subject}) or code = any(${codes}))`;
    case 'edges':
      if (!versionId) return [];
      return db<ExistingRow[]>`
        select f.code || '|' || t.code || '|' || e.type as key, e.content_hash as hash,
               e.status = 'ARCHIVED' as archived, f.grade, f.subject
        from library.knowledge_edges e
        join library.curriculum_nodes f on f.id = e.from_node_id
        join library.curriculum_nodes t on t.id = e.to_node_id
        where e.version_id = ${versionId} and f.grade = ${grade} and f.subject = ${subject}`;
    case 'series':
      return db<ExistingRow[]>`
        select code as key, content_hash as hash, status = 'ARCHIVED' as archived, grade, subject,
               (select code from library.curriculum_versions v where v.id = x.version_id) as version
        from library.book_series x
        where (grade = ${grade} and subject = ${subject} and version_id = ${versionId}) or code = any(${codes})`;
    case 'mappings':
      return db<ExistingRow[]>`
        select s.code || '|' || m.lesson_ref || '|' || n.code as key, m.content_hash as hash,
               m.status = 'ARCHIVED' as archived, s.grade, s.subject
        from library.book_lesson_mappings m
        join library.book_series s on s.id = m.series_id
        join library.curriculum_nodes n on n.id = m.node_id
        where s.grade = ${grade} and s.subject = ${subject} and s.version_id = ${versionId}`;
    case 'media':
      return db<ExistingRow[]>`
        select code as key, content_hash as hash, review_status = 'ARCHIVED' as archived, grade, subject,
               (select code from library.curriculum_versions v where v.id = x.version_id) as version
        from library.media_assets x
        where (grade = ${grade} and subject = ${subject} and version_id = ${versionId}) or code = any(${codes})`;
    case 'groups':
      return db<ExistingRow[]>`
        select code as key, content_hash as hash, status = 'ARCHIVED' as archived, grade, subject,
               (select code from library.curriculum_versions v where v.id = x.version_id) as version
        from library.item_groups x
        where (grade = ${grade} and subject = ${subject} and version_id = ${versionId}) or code = any(${codes})`;
    case 'items':
      return db<ExistingRow[]>`
        select code as key, content_hash as hash, status = 'ARCHIVED' as archived, grade, subject,
               (select code from library.curriculum_versions v where v.id = x.version_id) as version
        from library.items x
        where (grade = ${grade} and subject = ${subject} and version_id = ${versionId}) or code = any(${codes})`;
    case 'templates':
      return db<ExistingRow[]>`
        select i.code as key, t.content_hash as hash, i.status = 'ARCHIVED' as archived, i.grade, i.subject
        from library.item_templates t join library.items i on i.id = t.item_id
        where i.grade = ${grade} and i.subject = ${subject} and i.version_id = ${versionId}`;
  }
}

const ENTITIES: ImportEntity[] = [
  'nodes',
  'edges',
  'series',
  'mappings',
  'media',
  'groups',
  'items',
  'templates',
];

/** Compares the package with the library. Codes owned by another grade-subject are errors. */
export async function planImport(
  db: Db,
  prepared: PreparedImport,
): Promise<{ diff: ImportDiff; errors: PackageIssue[] }> {
  const { manifest } = prepared.pkg;
  const versions = await db<{ id: string }[]>`
    select id from library.curriculum_versions where code = ${manifest.curriculumVersion}`;
  const scope: Scope = {
    versionId: versions[0]?.id ?? null,
    grade: manifest.grade,
    subject: manifest.subject,
  };
  const errors: PackageIssue[] = [];
  const diff = {} as ImportDiff;
  for (const entity of ENTITIES) {
    const incoming = prepared.incoming[entity];
    const rows = await existingRows(db, entity, scope, [...incoming.keys()]);
    const existing = new Map<string, ExistingEntity>();
    for (const row of rows) {
      const shared = entity === 'nodes' && row.subject === null; // GRADE nodes
      const owned = shared
        ? row.grade === scope.grade
        : row.grade === scope.grade && row.subject === scope.subject;
      const otherVersion = row.version !== undefined && row.version !== manifest.curriculumVersion;
      if (!owned || otherVersion) {
        errors.push({
          code: 'CODE_TAKEN',
          message: `${entity} code ${row.key} already belongs to ${row.grade}-${row.subject ?? '(grade)'}${otherVersion ? ` (${row.version})` : ''}`,
          ref: row.key,
        });
        continue;
      }
      // Shared GRADE nodes are never archived by a subject package.
      if (shared && !incoming.has(row.key)) continue;
      existing.set(row.key, { hash: row.hash, archived: row.archived });
    }
    diff[entity] = diffEntities(existing, incoming);
  }
  return { diff, errors };
}

export const noop = (diff: ImportDiff) => isNoopDiff(diff);

// --- Apply ----------------------------------------------------------------------------------------

const levelIndex = (level: string) => (NODE_LEVELS as readonly string[]).indexOf(level);

/** Writes the package. Runs inside the caller's transaction after planImport found no errors. */
export async function applyImport(
  tx: TxSql,
  prepared: PreparedImport,
  diff: ImportDiff,
): Promise<void> {
  const { pkg, incoming, sanitisedSvg } = prepared;
  const { manifest } = pkg;
  const { grade, subject } = manifest;
  const v = pkg.curriculum.version;
  const touched = (entity: ImportEntity) =>
    new Set([...diff[entity].added, ...diff[entity].updated]);

  const [version] = await tx<{ id: string }[]>`
    insert into library.curriculum_versions (code, title, academic_year, source)
    values (${v.code}, ${v.title}, ${v.academicYear ?? null}, ${v.source ?? null})
    on conflict (code) do update set
      title = excluded.title, academic_year = excluded.academic_year, source = excluded.source
    returning id`;
  const versionId = version!.id;

  // Nodes, parents first.
  const nodeIds = new Map(
    (
      await tx<{ code: string; id: string }[]>`
        select code, id from library.curriculum_nodes where version_id = ${versionId}`
    ).map((r) => [r.code, r.id]),
  );
  const changedNodes = touched('nodes');
  const nodes = [...pkg.curriculum.nodes].sort((a, b) => levelIndex(a.level) - levelIndex(b.level));
  for (const n of nodes) {
    if (!changedNodes.has(n.code)) continue;
    const parentId = n.parent === null ? null : nodeIds.get(n.parent)!;
    const [row] = await tx<{ id: string }[]>`
      insert into library.curriculum_nodes (
        version_id, parent_id, level, code, grade, subject, title_vi, description, gdpt_requirement_ref,
        weight, sort_order, status, content_hash)
      values (
        ${versionId}, ${parentId}, ${n.level}, ${n.code}, ${grade}, ${n.level === 'GRADE' ? null : subject},
        ${n.title}, ${n.description ?? null}, ${n.gdptRef ?? null}, ${n.weight ?? 1}, ${n.sortOrder ?? 0},
        ${n.status ?? 'ACTIVE'}, ${incoming.nodes.get(n.code)!})
      on conflict (version_id, code) do update set
        parent_id = excluded.parent_id, level = excluded.level, title_vi = excluded.title_vi,
        description = excluded.description, gdpt_requirement_ref = excluded.gdpt_requirement_ref,
        weight = excluded.weight, sort_order = excluded.sort_order, status = excluded.status,
        content_hash = excluded.content_hash
      returning id`;
    nodeIds.set(n.code, row!.id);
  }
  if (diff.nodes.archived.length > 0) {
    await tx`
      update library.curriculum_nodes set status = 'ARCHIVED'
      where version_id = ${versionId} and code = any(${diff.nodes.archived})`;
  }

  // Edges.
  const changedEdges = touched('edges');
  for (const e of pkg.edges) {
    const key = edgeKey(e);
    if (!changedEdges.has(key)) continue;
    await tx`
      insert into library.knowledge_edges (version_id, from_node_id, to_node_id, type, reason, status, content_hash)
      values (${versionId}, ${nodeIds.get(e.from)!}, ${nodeIds.get(e.to)!}, ${e.type}, ${e.reason ?? null},
              'ACTIVE', ${incoming.edges.get(key)!})
      on conflict (from_node_id, to_node_id, type) do update set
        reason = excluded.reason, status = 'ACTIVE', content_hash = excluded.content_hash`;
  }
  for (const key of diff.edges.archived) {
    const [from, to, type] = key.split('|');
    await tx`
      update library.knowledge_edges set status = 'ARCHIVED'
      where version_id = ${versionId} and type = ${type!}
        and from_node_id = ${nodeIds.get(from!)!} and to_node_id = ${nodeIds.get(to!)!}`;
  }

  // Book series and lesson mappings.
  const changedSeries = touched('series');
  for (const s of pkg.mappings.series) {
    if (!changedSeries.has(s.code)) continue;
    await tx`
      insert into library.book_series (code, version_id, title, publisher, grade, subject, academic_year, status, content_hash)
      values (${s.code}, ${versionId}, ${s.title}, ${s.publisher ?? null}, ${grade}, ${subject}, ${s.academicYear ?? null},
              'ACTIVE', ${incoming.series.get(s.code)!})
      on conflict (code) do update set
        title = excluded.title, publisher = excluded.publisher, academic_year = excluded.academic_year,
        status = 'ACTIVE', content_hash = excluded.content_hash`;
  }
  if (diff.series.archived.length > 0) {
    await tx`update library.book_series set status = 'ARCHIVED' where code = any(${diff.series.archived})`;
  }
  const seriesIds = new Map(
    (
      await tx<{ code: string; id: string }[]>`
        select code, id from library.book_series where grade = ${grade} and subject = ${subject}`
    ).map((r) => [r.code, r.id]),
  );
  const changedMappings = touched('mappings');
  for (const m of pkg.mappings.mappings) {
    const key = mappingKey(m);
    if (!changedMappings.has(key)) continue;
    await tx`
      insert into library.book_lesson_mappings (series_id, lesson_ref, title, page_start, page_end, node_id, status, content_hash)
      values (${seriesIds.get(m.series)!}, ${m.lessonRef}, ${m.title ?? null}, ${m.pageStart ?? null},
              ${m.pageEnd ?? null}, ${nodeIds.get(m.node)!}, 'ACTIVE', ${incoming.mappings.get(key)!})
      on conflict (series_id, lesson_ref, node_id) do update set
        title = excluded.title, page_start = excluded.page_start, page_end = excluded.page_end,
        status = 'ACTIVE', content_hash = excluded.content_hash`;
  }
  for (const key of diff.mappings.archived) {
    const [series, lessonRef, node] = key.split('|');
    await tx`
      update library.book_lesson_mappings set status = 'ARCHIVED'
      where series_id = ${seriesIds.get(series!)!} and lesson_ref = ${lessonRef!} and node_id = ${nodeIds.get(node!)!}`;
  }

  // Media.
  const changedMedia = touched('media');
  for (const m of pkg.media) {
    if (!changedMedia.has(m.code)) continue;
    const svg = m.kind === 'SVG' ? sanitisedSvg[m.code]! : null;
    await tx`
      insert into library.media_assets (code, version_id, grade, subject, kind, storage_path, inline_svg, alt_vi,
                                        license, attribution, review_status, content_hash)
      values (${m.code}, ${versionId}, ${grade}, ${subject}, ${m.kind}, ${svg === null ? (m.storagePath ?? null) : null}, ${svg},
              ${m.alt}, ${m.license}, ${m.attribution ?? null}, ${m.reviewStatus}, ${incoming.media.get(m.code)!})
      on conflict (code) do update set
        kind = excluded.kind, storage_path = excluded.storage_path, inline_svg = excluded.inline_svg,
        alt_vi = excluded.alt_vi, license = excluded.license, attribution = excluded.attribution,
        review_status = excluded.review_status, content_hash = excluded.content_hash`;
  }
  if (diff.media.archived.length > 0) {
    await tx`update library.media_assets set review_status = 'ARCHIVED' where code = any(${diff.media.archived})`;
  }
  const mediaIds = new Map(
    (
      await tx<{ code: string; id: string }[]>`
        select code, id from library.media_assets where grade = ${grade} and subject = ${subject}`
    ).map((r) => [r.code, r.id]),
  );

  // Groups.
  const changedGroups = touched('groups');
  for (const g of pkg.groups) {
    if (!changedGroups.has(g.code)) continue;
    await tx`
      insert into library.item_groups (code, version_id, grade, subject, stimulus_kind, title, body_md, tts_text,
                                       tts_lang, media_ids, word_count, genre, source_kind, source_note, status,
                                       content_hash)
      values (${g.code}, ${versionId}, ${grade}, ${subject}, ${g.stimulusKind}, ${g.title}, ${g.bodyMd}, ${g.ttsText ?? null},
              ${g.ttsLang ?? null}, ${g.media.map((c) => mediaIds.get(c)!)}::uuid[], ${g.wordCount ?? null},
              ${g.genre ?? null}, ${g.sourceKind}, ${g.sourceNote ?? null}, ${g.status},
              ${incoming.groups.get(g.code)!})
      on conflict (code) do update set
        stimulus_kind = excluded.stimulus_kind, title = excluded.title, body_md = excluded.body_md,
        tts_text = excluded.tts_text, tts_lang = excluded.tts_lang, media_ids = excluded.media_ids,
        word_count = excluded.word_count, genre = excluded.genre, source_kind = excluded.source_kind,
        source_note = excluded.source_note, status = excluded.status, content_hash = excluded.content_hash,
        version = library.item_groups.version + 1`;
  }
  if (diff.groups.archived.length > 0) {
    await tx`update library.item_groups set status = 'ARCHIVED' where code = any(${diff.groups.archived})`;
  }
  const groupIds = new Map(
    (
      await tx<{ code: string; id: string }[]>`
        select code, id from library.item_groups where grade = ${grade} and subject = ${subject}`
    ).map((r) => [r.code, r.id]),
  );

  // Items.
  const changedItems = touched('items');
  const itemIds = new Map<string, string>();
  for (const i of pkg.items) {
    if (!changedItems.has(i.code)) continue;
    const [row] = await tx<{ id: string }[]>`
      insert into library.items (
        code, version_id, grade, subject, kind, skill_ids, difficulty, cognitive_level, type, stem_md, media_ids, options,
        answer, explanation_md, hints, worked_solution_md, distractor_feedback, misconception_tags, rubric,
        tts_text, tts_lang, group_id, group_order, source_refs, provenance, status, content_hash)
      values (
        ${i.code}, ${versionId}, ${grade}, ${subject}, ${i.kind}, ${i.skills.map((c) => nodeIds.get(c)!)}::uuid[],
        ${i.difficulty}, ${i.cognitiveLevel}, ${i.type}, ${i.stemMd},
        ${i.media.map((c) => mediaIds.get(c)!)}::uuid[], ${tx.json(i.options as never)},
        ${i.answer === null ? null : tx.json(i.answer as never)}, ${i.explanationMd}, ${tx.json(i.hints as never)},
        ${i.workedSolutionMd}, ${tx.json(i.distractorFeedback as never)}, ${i.misconceptionTags}::text[],
        ${i.rubric ? tx.json(i.rubric as never) : null}, ${i.ttsText ?? null}, ${i.ttsLang ?? null},
        ${i.group === undefined ? null : groupIds.get(i.group)!}, ${i.groupOrder ?? null},
        ${tx.json(i.sourceRefs as never)}, ${tx.json(i.provenance as never)}, ${i.status},
        ${incoming.items.get(i.code)!})
      on conflict (code) do update set
        kind = excluded.kind, skill_ids = excluded.skill_ids, difficulty = excluded.difficulty,
        cognitive_level = excluded.cognitive_level, type = excluded.type, stem_md = excluded.stem_md,
        media_ids = excluded.media_ids, options = excluded.options, answer = excluded.answer,
        explanation_md = excluded.explanation_md, hints = excluded.hints,
        worked_solution_md = excluded.worked_solution_md, distractor_feedback = excluded.distractor_feedback,
        misconception_tags = excluded.misconception_tags, rubric = excluded.rubric, tts_text = excluded.tts_text,
        tts_lang = excluded.tts_lang, group_id = excluded.group_id, group_order = excluded.group_order,
        source_refs = excluded.source_refs, provenance = excluded.provenance, status = excluded.status,
        content_hash = excluded.content_hash, version = library.items.version + 1
      returning id`;
    itemIds.set(i.code, row!.id);
  }
  if (diff.items.archived.length > 0) {
    await tx`update library.items set status = 'ARCHIVED' where code = any(${diff.items.archived})`;
  }

  // Templates (1:1 with TEMPLATE items).
  const changedTemplates = touched('templates');
  for (const t of pkg.templates) {
    if (!changedTemplates.has(t.item)) continue;
    let itemId = itemIds.get(t.item);
    if (!itemId) {
      const [row] = await tx<{ id: string }[]>`select id from library.items where code = ${t.item}`;
      itemId = row!.id;
    }
    await tx`
      insert into library.item_templates (item_id, params, constraints, answer_expr, render, distractor_exprs, content_hash)
      values (${itemId}, ${tx.json(t.params as never)}, ${tx.json(t.constraints as never)}, ${t.answerExpr},
              ${tx.json(t.render as never)}, ${tx.json(t.distractorExprs as never)}, ${incoming.templates.get(t.item)!})
      on conflict (item_id) do update set
        params = excluded.params, constraints = excluded.constraints, answer_expr = excluded.answer_expr,
        render = excluded.render, distractor_exprs = excluded.distractor_exprs,
        content_hash = excluded.content_hash, flagged_at = null, flag_reason = null`;
  }
  // An item that turned STATIC loses its template row (archived items keep theirs).
  if (diff.templates.archived.length > 0) {
    await tx`
      delete from library.item_templates t using library.items i
      where i.id = t.item_id and i.kind = 'STATIC' and i.code = any(${diff.templates.archived})`;
  }
}
