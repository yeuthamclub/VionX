// M06 practice sessions, mastery, T0 help (TASK_PACKS/M06.md). No AI calls: hints, wrong-option
// feedback and worked solutions are the pre-generated help stored with each library item.
import { createRoute, type OpenAPIHono, type z } from '@hono/zod-openapi';
import type { PRACTICE_ITEM_TYPES } from '@vionx/domain';
import {
  buildLearningPath,
  chosenWrongOption,
  countBlanks,
  diagnosticLength,
  displayState,
  forgettingRisk,
  HINT_LADDER_LENGTH,
  judgeAnswer,
  LEARNING_EVENT_NAMES,
  LEARNING_EVENT_TYPES,
  LEARNING_LOCK_CLASS,
  meanScore,
  newSeed,
  newSkillState,
  nextDifficulty,
  pickItem,
  pickSkill,
  placeDiagnostic,
  recencyWeight,
  recordAttempt,
  renderVariant,
  reviewQuality,
  scheduleReview,
  sessionShape,
  sessionXp,
  slotKind,
  slotRandom,
  WeightedMasteryStrategy,
  withMilestones,
  type ItemAnswer,
  type ItemTemplate,
  type ItemType,
  type MasteryConfig,
  type MasteryState,
  type SessionMode,
  type SkillState,
} from '@vionx/domain';
import { requireActor, type Actor } from '../../_shared/actor.ts';
import { evaluateStudentConsent } from '../../_shared/consent.ts';
import type { Sql, TxSql } from '../../_shared/db.ts';
import { ApiError } from '../../_shared/errors.ts';
import { scoped, scopeFor, type Scope } from '../../_shared/scope.ts';
import type { AppEnv } from '../app.ts';
import type { ApiDeps } from '../deps.ts';
import { writeEvent } from '../identity/repo.ts';
import { mediaByIdsOrCodes, profile, type MediaRow } from '../library/repo.ts';
import { body, CHILD, errorResponses, iso, json, PARENT } from '../route-helpers.ts';
import * as repo from './repo.ts';
import {
  AnswerCreateSchema,
  AnswerResponseSchema,
  HintResponseSchema,
  ItemIdParamSchema,
  ItemReportCreateSchema,
  ItemReportResponseSchema,
  KnowledgeMapResponseSchema,
  KnowledgeQuerySchema,
  LearningPathResponseSchema,
  LearningStudentIdParamSchema,
  NextItemResponseSchema,
  SessionCreateResponseSchema,
  SessionCreateSchema,
  SessionFinishResponseSchema,
  SessionIdParamSchema,
} from './schemas.ts';

type Db = Sql | TxSql;
const PARENT_OR_CHILD = [...PARENT, ...CHILD];
const SESSION_ERRORS = errorResponses(
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
);

// --- Route definitions ----------------------------------------------------------------------------

const createSessionRoute = createRoute({
  method: 'post',
  path: '/v1/learning/sessions',
  tags: ['learning'],
  summary: 'Start a practice, review or diagnostic session',
  description:
    'Child actor. Covers the practicable skills of `nodeId` (or `skillIds`) of the child’s grade. Without `mode` the first session on a topic is a DIAGNOSTIC (8-12 adaptive items), later ones PRACTICE (70% current skills, 30% due reviews). REVIEW serves the skills whose review is due (409 when none). Idempotent by `clientUuid`. Without EDUCATION_ANALYTICS consent the session works and only aggregates are stored (`analytics: false`).',
  security: CHILD,
  request: body(SessionCreateSchema),
  responses: { 200: json(SessionCreateResponseSchema, 'Started (or replayed)'), ...SESSION_ERRORS },
});

const nextRoute = createRoute({
  method: 'get',
  path: '/v1/learning/sessions/{id}/next',
  tags: ['learning'],
  summary: 'The item to answer now',
  description:
    'Child actor. Returns the same item until it is answered. Selection: target difficulty ±1, unseen items first, a new seed for TEMPLATE items, the rest of a passage group after its first item. The answer is never included. `done` when the target, the time limit or the item pool is reached.',
  security: CHILD,
  request: { params: SessionIdParamSchema },
  responses: { 200: json(NextItemResponseSchema, 'Next item'), ...SESSION_ERRORS },
});

const answerRoute = createRoute({
  method: 'post',
  path: '/v1/learning/sessions/{id}/answers',
  tags: ['learning'],
  summary: 'Answer the current item',
  description:
    'Child actor. Judged against the stored item, or the variant of the stored seed for a TEMPLATE item. Updates the skill’s mastery (hints and rushed answers count less) and its review schedule. A wrong option returns its pre-written feedback. Idempotent by `clientUuid`; 409 when `itemId` is not the current item.',
  security: CHILD,
  request: { params: SessionIdParamSchema, ...body(AnswerCreateSchema) },
  responses: { 200: json(AnswerResponseSchema, 'Judged (or replayed)'), ...SESSION_ERRORS },
});

const hintRoute = createRoute({
  method: 'post',
  path: '/v1/learning/sessions/{id}/hint',
  tags: ['learning'],
  summary: 'Next hint of the current item (tutor tier T0)',
  description:
    'Child actor. Returns the next of the 4 pre-generated hints; the last level also returns the worked solution. Each hint lowers the weight of the answer. No AI call.',
  security: CHILD,
  request: { params: SessionIdParamSchema },
  responses: { 200: json(HintResponseSchema, 'Hint'), ...SESSION_ERRORS },
});

const finishRoute = createRoute({
  method: 'post',
  path: '/v1/learning/sessions/{id}/finish',
  tags: ['learning'],
  summary: 'Finish the session',
  description:
    'Child actor. Places the skills of a diagnostic, returns the summary with the worked solutions of wrong answers and emits `learning.session_finished` (LearningSessionFinished); the worker grants XP once per session (rule LEARNING_CORRECT_ANSWER). Calling it again returns the stored summary.',
  security: CHILD,
  request: { params: SessionIdParamSchema },
  responses: {
    200: json(SessionFinishResponseSchema, 'Finished (or replayed)'),
    ...SESSION_ERRORS,
  },
});

const knowledgeMapRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/knowledge-map',
  tags: ['learning'],
  summary: 'Knowledge map: curriculum of the child’s grade with mastery states',
  description:
    'Parent: any child of the household; child: only their own id (others 404). Nodes come parents first; a skill carries its state (Master Spec §10.2), a higher node the mean of its skills.',
  security: PARENT_OR_CHILD,
  request: { params: LearningStudentIdParamSchema, query: KnowledgeQuerySchema },
  responses: {
    200: json(KnowledgeMapResponseSchema, 'Knowledge map'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const learningPathRoute = createRoute({
  method: 'get',
  path: '/v1/students/{id}/learning-path',
  tags: ['learning'],
  summary: 'What to practise next',
  description:
    'Due reviews first, then skills in progress (weakest first), then new skills whose prerequisites are at least Proficient. Parent or the child themself; others 404.',
  security: PARENT_OR_CHILD,
  request: { params: LearningStudentIdParamSchema, query: KnowledgeQuerySchema },
  responses: {
    200: json(LearningPathResponseSchema, 'Learning path'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

const reportRoute = createRoute({
  method: 'post',
  path: '/v1/items/{id}/report',
  tags: ['learning'],
  summary: 'Report a problem with a question',
  description:
    'Parent or child. Stores the reason and, for a TEMPLATE item, the seed. Never stores who reported.',
  security: PARENT_OR_CHILD,
  request: { params: ItemIdParamSchema, ...body(ItemReportCreateSchema) },
  responses: {
    201: json(ItemReportResponseSchema, 'Reported'),
    ...errorResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'NOT_FOUND'),
  },
});

// --- Rendering ------------------------------------------------------------------------------------

interface Rendered {
  item: repo.FullItemRow;
  seed: number | null;
  stemMd: string;
  ttsText: string | null;
  options: repo.FullItemRow['options'];
  answer: ItemAnswer;
  explanationMd: string;
  /** Option id → key in `distractor_feedback`. */
  feedbackKeys: Record<string, string>;
}

/** The item as stored, or the variant of `seed` for a TEMPLATE item. Null when it cannot render. */
function render(item: repo.FullItemRow, seed: number | null): Rendered | null {
  if (item.kind === 'STATIC') {
    if (!item.answer) return null;
    return {
      item,
      seed: null,
      stemMd: item.stem_md,
      ttsText: item.tts_text,
      options: item.options,
      answer: item.answer as ItemAnswer,
      explanationMd: item.explanation_md,
      feedbackKeys: {},
    };
  }
  if (!item.template || seed === null) return null;
  const variant = renderVariant(
    {
      item: item.id,
      type: item.type as ItemType,
      params: item.template.params as ItemTemplate['params'],
      constraints: item.template.constraints,
      answerExpr: item.template.answer_expr,
      render: item.template.render as unknown as ItemTemplate['render'],
      distractorExprs: item.template.distractor_exprs,
    },
    seed,
  );
  if (!variant.ok) return null;
  const v = variant.value;
  return {
    item,
    seed,
    stemMd: v.stemMd,
    ttsText: v.ttsText ?? item.tts_text,
    options: v.options.map((o) => ({
      id: o.id,
      ...(o.text === undefined ? {} : { text: o.text }),
    })),
    answer: v.answer,
    explanationMd: v.explanationMd ?? item.explanation_md,
    feedbackKeys: v.optionFeedbackKeys,
  };
}

const workedSolution = (r: Rendered) => r.item.worked_solution_md || r.explanationMd;

const toMedia = (m: MediaRow) => ({
  id: m.id,
  kind: m.kind,
  svg: m.inline_svg,
  storagePath: m.storage_path,
  alt: m.alt_vi,
});

async function loadMedia(db: Db, ids: string[], codes: string[]) {
  if (ids.length + codes.length === 0) return [];
  const rows = await mediaByIdsOrCodes(db, ids, codes);
  return rows.filter((m) => m.review_status !== 'REJECTED' && m.review_status !== 'ARCHIVED');
}

async function present(
  db: Db,
  r: Rendered,
  current: repo.CurrentItem,
  ttsLang: 'vi' | 'en',
): Promise<z.infer<typeof NextItemResponseSchema>['item']> {
  const codes = r.options.flatMap((o) => (typeof o.media === 'string' ? [o.media] : []));
  const media = await loadMedia(db, r.item.media_ids, codes);
  const byCode = new Map(media.map((m) => [m.code, m]));
  return {
    id: r.item.id,
    type: r.item.type as (typeof PRACTICE_ITEM_TYPES)[number],
    kind: r.item.kind,
    skillId: current.skillId,
    slotKind: current.slotKind,
    difficulty: r.item.difficulty,
    stemMd: r.stemMd,
    media: media.filter((m) => r.item.media_ids.includes(m.id)).map(toMedia),
    options: r.options.map((o) => {
      const m = typeof o.media === 'string' ? byCode.get(o.media) : undefined;
      return {
        id: o.id,
        text: o.text ?? null,
        media: m ? toMedia(m) : null,
        ttsText: o.ttsText ?? null,
        side: o.side === 'left' || o.side === 'right' ? o.side : null,
      };
    }),
    blanks:
      r.item.type === 'word_bank'
        ? ((r.answer as { blankOptionIds?: string[] }).blankOptionIds?.length ?? 0)
        : r.item.type === 'fill_blank'
          ? ((r.answer as { blanks?: unknown[] }).blanks?.length ?? countBlanks(r.stemMd))
          : 0,
    ttsText: r.ttsText,
    ttsLang: r.item.tts_lang ?? ttsLang,
    seed: r.seed,
    hintsTotal: r.item.hints.length,
    hints: r.item.hints
      .slice(0, current.hintsUsed)
      .map((h) => ({ md: h.md, ttsText: h.ttsText ?? null })),
  };
}

// --- Handlers --------------------------------------------------------------------------------------

export function registerLearningRoutes(app: OpenAPIHono<AppEnv>, deps: ApiDeps): void {
  const sql = deps.sql;
  const now = () => deps.now?.() ?? new Date();

  /** Parent → their households; child → their own household, only for their own id. */
  async function readScope(actor: Actor, studentId: string): Promise<Scope> {
    const who = requireActor(actor, 'parent', 'child');
    if (who.kind === 'child') {
      if (who.childId !== studentId) throw new ApiError('NOT_FOUND', 'Student not found');
      return scoped(sql, [who.householdId]);
    }
    return scopeFor(sql, who);
  }

  async function studentOr404(db: Db, scope: Scope, id: string) {
    const student = await repo.learningStudent(db, scope, id);
    if (!student) throw new ApiError('NOT_FOUND', 'Student not found');
    return student;
  }

  /** The child's own session, locked for the transaction. Others answer 404. */
  async function ownSession(tx: TxSql, child: Extract<Actor, { kind: 'child' }>, id: string) {
    const scope = scoped(sql, [child.householdId]);
    await repo.lockStudent(tx, LEARNING_LOCK_CLASS, child.childId);
    const session = await repo.sessionById(tx, scope, id, true);
    if (!session || session.student_id !== child.childId) {
      throw new ApiError('NOT_FOUND', 'Session not found');
    }
    return { child, scope, session };
  }

  async function toSession(db: Db, s: repo.SessionRow, config: MasteryConfig) {
    const p = await profile(db, s.grade, s.subject);
    const young = s.grade <= config.session.youngMaxGrade;
    return {
      id: s.id,
      studentId: s.student_id,
      mode: s.mode,
      status: s.status,
      grade: s.grade,
      subject: s.subject,
      nodeId: s.topic_node_id,
      skillIds: s.skill_ids,
      targetItems: s.target_items,
      maxMinutes: s.max_minutes,
      answeredCount: s.answered_count,
      correctCount: s.correct_count,
      hintsCount: s.hints_count,
      youngMode: young,
      readAloud: young || (p?.read_aloud_default ?? false),
      ttsLang: p?.tts_lang ?? ('vi' as const),
      analytics: s.analytics,
      startedAt: iso(s.started_at)!,
      finishedAt: iso(s.finished_at),
    };
  }

  const progressOf = (s: repo.SessionRow) => ({
    answered: s.answered_count,
    correct: s.correct_count,
    target: s.target_items,
  });

  async function skillProgress(
    db: Db,
    config: MasteryConfig,
    entries: { skillId: string; state: SkillState }[],
  ) {
    const titles = await repo.nodeTitles(
      db,
      entries.map((e) => e.skillId),
    );
    return entries.map((e) => ({
      skillId: e.skillId,
      title: titles.get(e.skillId) ?? '',
      state: displayState(config, e.state),
      masteryScore: e.state.masteryScore,
    }));
  }

  // Sessions --------------------------------------------------------------------------------------

  app.openapi(createSessionRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const input = c.req.valid('json');
    const scope = scoped(sql, [child.householdId]);
    const student = await studentOr404(sql, scope, child.childId);
    const config = await repo.loadConfig(sql);
    const at = now();

    const existing = await repo.sessionByClientUuid(sql, scope, input.clientUuid);
    if (existing) {
      if (existing.student_id !== student.id) throw new ApiError('CONFLICT', 'clientUuid in use');
      return c.json({ session: await toSession(sql, existing, config), replayed: true }, 200);
    }

    let mode: SessionMode | undefined = input.mode;
    let skills: repo.SkillRow[];
    const roots = input.skillIds ?? (input.nodeId ? [input.nodeId] : []);
    if (roots.length > 0) {
      skills = await repo.skillsUnder(sql, roots, student.grade);
      if (skills.length === 0) throw new ApiError('NOT_FOUND', 'No practicable skill there');
      if (new Set(skills.map((s) => s.subject)).size > 1) {
        throw new ApiError('VALIDATION_FAILED', 'A session covers one subject');
      }
    } else if (mode === 'REVIEW') {
      skills = [];
    } else {
      throw new ApiError('VALIDATION_FAILED', 'nodeId or skillIds is required');
    }

    let skillIds = skills.map((s) => s.id);
    let subject = skills[0]?.subject ?? input.subject;
    if (mode === 'REVIEW') {
      const due = await repo.dueSkills(sql, scope, student.id, student.grade, subject, at);
      const wanted = skillIds.length > 0 ? due.filter((d) => skillIds.includes(d.skill_id)) : due;
      subject ??= wanted[0]?.subject;
      skillIds = wanted.filter((d) => d.subject === subject).map((d) => d.skill_id);
      if (skillIds.length === 0 || !subject) {
        throw new ApiError('CONFLICT', 'No review is due', { reason: 'NOTHING_DUE' });
      }
    }
    if (!mode) {
      const known = await repo.states(sql, scope, student.id, skillIds);
      // A topic (not a single skill) nobody has touched yet starts with a diagnostic.
      mode =
        known.length === 0 && roots.length === 1 && skills.length > 1 ? 'DIAGNOSTIC' : 'PRACTICE';
    }

    const shape = sessionShape(config, student.grade, input.targetItems);
    const analytics = (
      await evaluateStudentConsent(sql, scope, student.id, 'EDUCATION_ANALYTICS', at)
    ).evaluation.effective;
    const inserted = await sql.begin((tx) =>
      repo.insertSession(tx, {
        householdId: student.household_id,
        studentId: student.id,
        clientUuid: input.clientUuid,
        mode: mode!,
        skillIds,
        nodeId: input.nodeId ?? null,
        grade: student.grade,
        subject: subject!,
        analytics,
        targetItems:
          mode === 'DIAGNOSTIC' ? diagnosticLength(config, input.targetItems) : shape.targetItems,
        maxMinutes: shape.maxMinutes,
        startedAt: at,
      }),
    );
    // Lost a race on client_uuid (or the UUID belongs to another household): read through the scope.
    const session = inserted ?? (await repo.sessionByClientUuid(sql, scope, input.clientUuid));
    if (!session) throw new ApiError('CONFLICT', 'clientUuid in use');
    return c.json({ session: await toSession(sql, session, config), replayed: !inserted }, 200);
  });

  /** Chooses and stores the item of the next slot. Null when the pool is exhausted. */
  async function chooseItem(
    tx: TxSql,
    scope: Scope,
    s: repo.SessionRow,
    config: MasteryConfig,
    at: Date,
  ): Promise<{ current: repo.CurrentItem; rendered: Rendered } | null> {
    const slot = s.answered_count;
    const rand = slotRandom(s.id, slot);
    const served = new Set(s.served.map((x) => x.itemId));
    const make = (
      itemId: string,
      skillId: string,
      seed: number | null,
      kind: 'CURRENT' | 'REVIEW',
    ) =>
      ({
        itemId,
        skillId,
        seed,
        slot,
        slotKind: kind,
        hintsUsed: 0,
        servedAt: at.toISOString(),
      }) satisfies repo.CurrentItem;

    // The rest of a passage group follows its first item, in order.
    const last = s.served.at(-1);
    if (last) {
      const follow = await repo.nextInGroup(tx, last.itemId, [...served]);
      const item = follow ? await repo.fullItem(tx, follow.id) : null;
      const rendered = item ? render(item, null) : null;
      if (item && rendered) {
        const skillId = item.skill_ids.find((id) => s.skill_ids.includes(id)) ?? last.skillId;
        return { current: make(item.id, skillId, null, 'CURRENT'), rendered };
      }
    }

    const due = (await repo.dueSkills(tx, scope, s.student_id, s.grade, s.subject, at)).map(
      (d) => d.skill_id,
    );
    const kind = slotKind(config, s.mode, slot, due.length > 0);
    const stateRows = await repo.states(tx, scope, s.student_id, [...s.skill_ids, ...due]);
    const stateOf = new Map(stateRows.map((r) => [r.skill_id, repo.toState(r)]));
    const servedPerSkill = (id: string) => s.served.filter((x) => x.skillId === id).length;

    // Skills to try, best first: the due review of this slot, then the session's own skills.
    const order: { skillId: string; kind: 'CURRENT' | 'REVIEW' }[] = [];
    if (kind === 'REVIEW' && due.length > 0) {
      const reviewIndex = s.mode === 'REVIEW' ? slot : Math.floor(slot * config.reviewShare);
      for (let i = 0; i < due.length; i++) {
        order.push({ skillId: due[(reviewIndex + i) % due.length]!, kind: 'REVIEW' });
      }
    }
    let rest = s.skill_ids.map((skillId) => ({
      skillId,
      masteryScore: stateOf.get(skillId)?.masteryScore ?? 0,
      servedInSession: servedPerSkill(skillId),
    }));
    while (rest.length > 0) {
      const skillId = pickSkill(s.mode, rest)!;
      order.push({ skillId, kind: s.mode === 'REVIEW' ? 'REVIEW' : 'CURRENT' });
      rest = rest.filter((x) => x.skillId !== skillId);
    }

    const diagnosticDifficulty = s.diagnostic_answers.reduce(
      (d, a) => nextDifficulty(d, a.correct, a.hintsUsed),
      config.startDifficulty,
    );
    // Second pass, when every item was served: a TEMPLATE item may come back with a new seed.
    for (const repeatTemplates of [false, true]) {
      for (const { skillId, kind: slotKindOf } of order) {
        const target =
          s.mode === 'DIAGNOSTIC'
            ? diagnosticDifficulty
            : (stateOf.get(skillId)?.currentDifficulty ?? config.startDifficulty);
        const rows = await repo.candidates(tx, scope, s.student_id, skillId);
        const excluded = new Set(
          repeatTemplates
            ? rows.filter((r) => r.kind === 'STATIC' && served.has(r.id)).map((r) => r.id)
            : served,
        );
        for (let tries = 0; tries < 5; tries++) {
          const picked = pickItem(
            rows.map((r) => ({
              itemId: r.id,
              kind: r.kind,
              difficulty: r.difficulty,
              seenCount: r.seen_count,
              lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).getTime() : null,
            })),
            target,
            excluded,
            rand,
          );
          if (!picked) break;
          const row = rows.find((r) => r.id === picked.itemId)!;
          let item = await repo.fullItem(tx, picked.itemId);
          // A passage group is read from its first question, whichever of its items was picked.
          const head = item?.group_id
            ? await repo.nextInGroup(tx, picked.itemId, [...served])
            : null;
          if (head && head.id !== picked.itemId) {
            item = await repo.fullItem(tx, head.id);
            const rendered = item ? render(item, null) : null;
            if (item && rendered) {
              return { current: make(item.id, skillId, null, slotKindOf), rendered };
            }
            item = await repo.fullItem(tx, picked.itemId);
          }
          const usedSeeds = [
            ...row.seeds.map(Number),
            ...s.served.flatMap((x) => (x.itemId === row.id && x.seed != null ? [x.seed] : [])),
          ];
          const seed = row.kind === 'TEMPLATE' ? newSeed(usedSeeds, rand) : null;
          const rendered = item ? render(item, seed) : null;
          if (rendered)
            return { current: make(picked.itemId, skillId, seed, slotKindOf), rendered };
          excluded.add(picked.itemId);
        }
      }
    }
    return null;
  }

  app.openapi(nextRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const at = now();
    const out = await sql.begin(async (tx) => {
      const { scope, session: s } = await ownSession(tx, child, id);
      const done = (reason: 'TARGET_REACHED' | 'TIME_UP' | 'NO_ITEMS' | 'FINISHED') => ({
        done: true,
        reason,
        progress: progressOf(s),
        item: null,
        group: null,
      });
      if (s.status === 'FINISHED') return done('FINISHED');
      const config = await repo.loadConfig(tx);
      const ttsLang = (await profile(tx, s.grade, s.subject))?.tts_lang ?? 'vi';

      let current = s.current_item;
      let rendered: Rendered | null = null;
      if (current) {
        const item = await repo.fullItem(tx, current.itemId);
        rendered = item ? render(item, current.seed) : null;
      }
      if (!rendered) {
        if (s.answered_count >= s.target_items) return done('TARGET_REACHED');
        if (at.getTime() - new Date(s.started_at).getTime() >= s.max_minutes * 60_000) {
          return done('TIME_UP');
        }
        const chosen = await chooseItem(tx, scope, s, config, at);
        if (!chosen) return done('NO_ITEMS');
        ({ current, rendered } = chosen);
        await tx`
          update app.learning_sessions
          set current_item = ${tx.json(current as never)},
              served = served || ${tx.json([{ itemId: current.itemId, skillId: current.skillId, seed: current.seed }] as never)}
          where id = ${s.id}`;
      }
      const group = rendered.item.group_id
        ? await repo.groupFor(tx, rendered.item.group_id, rendered.item.id)
        : null;
      return {
        done: false,
        reason: null,
        progress: progressOf(s),
        item: await present(tx, rendered, current!, ttsLang),
        group: group && {
          id: group.id,
          stimulusKind: group.stimulus_kind as 'PASSAGE',
          title: group.title,
          bodyMd: group.body_md,
          ttsText: group.tts_text,
          ttsLang: group.tts_lang ?? ttsLang,
          media: (await loadMedia(tx, group.media_ids, [])).map(toMedia),
          position: group.position,
          total: group.total,
        },
      };
    });
    return c.json(out, 200);
  });

  app.openapi(answerRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const at = now();
    const out = await sql.begin(async (tx) => {
      const { scope, session: s } = await ownSession(tx, child, id);
      if (s.last_answer?.clientUuid === input.clientUuid) {
        return { ...s.last_answer.result, replayed: true } as z.infer<typeof AnswerResponseSchema>;
      }
      const current = s.current_item;
      if (s.status !== 'ACTIVE' || !current || current.itemId !== input.itemId) {
        throw new ApiError('CONFLICT', 'Not the current item', { reason: 'NOT_CURRENT_ITEM' });
      }
      const item = await repo.fullItem(tx, current.itemId);
      const rendered = item ? render(item, current.seed) : null;
      if (!item || !rendered) throw new ApiError('CONFLICT', 'Item is no longer available');
      const type = item.type as ItemType;
      const isCorrect = judgeAnswer(type, rendered.answer, input.response);
      if (isCorrect === null) {
        throw new ApiError('VALIDATION_FAILED', `Response does not fit a ${type} item`, {
          field: 'response',
        });
      }

      const config = await repo.loadConfig(tx);
      const [row] = await repo.states(tx, scope, s.student_id, [current.skillId]);
      const before = row ? repo.toState(row) : newSkillState(config);
      const evidence = {
        correct: isCorrect,
        difficulty: item.difficulty,
        hintsUsed: current.hintsUsed,
        responseMs: input.responseMs ?? null,
        at: at.getTime(),
      };
      let state: SkillState;
      let delta = 0;
      let review = row ? repo.toReview(row) : null;
      let diagnosticAnswers = s.diagnostic_answers;
      if (s.mode === 'DIAGNOSTIC') {
        // Placement happens at finish; an answer only moves the counters.
        state = recordAttempt(config, before, evidence);
        diagnosticAnswers = [
          ...diagnosticAnswers,
          {
            skillId: current.skillId,
            correct: isCorrect,
            difficulty: item.difficulty,
            hintsUsed: current.hintsUsed,
            recency: recencyWeight(config, before.lastAttemptAt, evidence.at),
          },
        ];
      } else {
        ({ state, delta } = new WeightedMasteryStrategy(config).apply(before, evidence));
        review = scheduleReview(
          config,
          review,
          reviewQuality(isCorrect, current.hintsUsed),
          evidence.at,
        );
      }
      const key = {
        householdId: s.household_id,
        studentId: s.student_id,
        skillId: current.skillId,
      };
      await repo.upsertState(tx, key, state, review);

      const wrongOption = isCorrect
        ? null
        : chosenWrongOption(type, rendered.answer, input.response);
      const feedback = wrongOption
        ? (item.distractor_feedback[rendered.feedbackKeys[wrongOption] ?? wrongOption] ?? null)
        : null;
      if (s.analytics) {
        await repo.recordAttempt(tx, {
          ...key,
          sessionId: s.id,
          itemId: item.id,
          seed: current.seed,
          response: input.response,
          isCorrect,
          hintsUsed: current.hintsUsed,
          responseMs: input.responseMs ?? null,
          difficulty: item.difficulty,
          masteryDelta: delta,
          clientUuid: input.clientUuid,
          at,
          misconception: feedback?.misconception ?? null,
        });
      }

      const counted = {
        ...s,
        answered_count: s.answered_count + 1,
        correct_count: s.correct_count + (isCorrect ? 1 : 0),
      };
      const [skill] = await skillProgress(tx, config, [{ skillId: current.skillId, state }]);
      const result = {
        isCorrect,
        correctAnswer: rendered.answer as Record<string, unknown>,
        feedback: feedback
          ? { md: feedback.md, misconception: feedback.misconception ?? null }
          : null,
        explanationMd: rendered.explanationMd,
        workedSolutionMd:
          current.hintsUsed >= Math.min(HINT_LADDER_LENGTH, item.hints.length) &&
          item.hints.length > 0
            ? workedSolution(rendered)
            : null,
        masteryDelta: delta,
        skill: skill!,
        progress: progressOf(counted),
      };
      const wrongItems = isCorrect
        ? s.wrong_items
        : [...s.wrong_items, { itemId: item.id, seed: current.seed }].slice(-20);
      await tx`
        update app.learning_sessions
        set answered_count = ${counted.answered_count}, correct_count = ${counted.correct_count},
            current_item = null,
            last_answer = ${tx.json({ clientUuid: input.clientUuid, result } as never)},
            wrong_items = ${tx.json(wrongItems as never)},
            diagnostic_answers = ${tx.json(diagnosticAnswers as never)}
        where id = ${s.id}`;
      return { ...result, replayed: false };
    });
    return c.json(out, 200);
  });

  app.openapi(hintRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const out = await sql.begin(async (tx) => {
      const { session: s } = await ownSession(tx, child, id);
      const current = s.current_item;
      if (s.status !== 'ACTIVE' || !current) {
        throw new ApiError('CONFLICT', 'No item is being answered', { reason: 'NO_CURRENT_ITEM' });
      }
      const item = await repo.fullItem(tx, current.itemId);
      const rendered = item ? render(item, current.seed) : null;
      if (!item || !rendered || item.hints.length === 0) {
        throw new ApiError('NOT_FOUND', 'This item has no hints');
      }
      const total = Math.min(HINT_LADDER_LENGTH, item.hints.length);
      const level = Math.min(total, current.hintsUsed + 1);
      if (level > current.hintsUsed) {
        await tx`
          update app.learning_sessions
          set current_item = ${tx.json({ ...current, hintsUsed: level } as never)},
              hints_count = hints_count + 1
          where id = ${s.id}`;
      }
      const hint = item.hints[level - 1]!;
      return {
        level,
        total,
        hint: { md: hint.md, ttsText: hint.ttsText ?? null },
        workedSolutionMd: level >= total ? workedSolution(rendered) : null,
      };
    });
    return c.json(out, 200);
  });

  app.openapi(finishRoute, async (c) => {
    const child = requireActor(c.get('actor'), 'child');
    const { id } = c.req.valid('param');
    const at = now();
    const out = await sql.begin(async (tx) => {
      const { scope, session: s } = await ownSession(tx, child, id);
      const config = await repo.loadConfig(tx);
      if (s.status === 'FINISHED') {
        return {
          session: await toSession(tx, s, config),
          summary: s.summary as z.infer<typeof SessionFinishResponseSchema>['summary'],
          replayed: true,
        };
      }

      const rows = await repo.states(tx, scope, s.student_id, s.skill_ids);
      const stateOf = new Map(rows.map((r) => [r.skill_id, repo.toState(r)]));
      if (s.mode === 'DIAGNOSTIC' && s.diagnostic_answers.length > 0) {
        const placed = placeDiagnostic(config, s.skill_ids, s.diagnostic_answers);
        for (const skillId of s.skill_ids) {
          const before = stateOf.get(skillId) ?? newSkillState(config);
          const masteryScore = Math.max(before.masteryScore, placed.get(skillId) ?? 0);
          const state = withMilestones(
            config,
            { ...before, masteryScore },
            { correct: false, at: at.getTime() },
          );
          stateOf.set(skillId, state);
          const row = rows.find((r) => r.skill_id === skillId);
          await repo.upsertState(
            tx,
            { householdId: s.household_id, studentId: s.student_id, skillId },
            state,
            row ? repo.toReview(row) : null,
          );
        }
      }

      const solutions: z.infer<typeof SessionFinishResponseSchema>['summary']['solutions'] = [];
      for (const w of s.wrong_items) {
        const item = await repo.fullItem(tx, w.itemId);
        const rendered = item ? render(item, w.seed) : null;
        if (!rendered) continue;
        solutions.push({
          itemId: w.itemId,
          stemMd: rendered.stemMd,
          workedSolutionMd: workedSolution(rendered),
          correctAnswer: rendered.answer as Record<string, unknown>,
        });
      }
      const touched = s.skill_ids.filter((skillId) => stateOf.has(skillId));
      const summary = {
        answered: s.answered_count,
        correct: s.correct_count,
        accuracy:
          s.answered_count === 0
            ? 0
            : Math.round((s.correct_count / s.answered_count) * 1000) / 1000,
        hintsUsed: s.hints_count,
        durationSec: Math.max(
          0,
          Math.round((at.getTime() - new Date(s.started_at).getTime()) / 1000),
        ),
        xp: sessionXp(config, s.correct_count),
        skills: await skillProgress(
          tx,
          config,
          touched.map((skillId) => ({ skillId, state: stateOf.get(skillId)! })),
        ),
        solutions,
      };
      const [finished] = await tx<repo.SessionRow[]>`
        update app.learning_sessions
        set status = 'FINISHED', finished_at = ${at}, summary = ${tx.json(summary as never)},
            current_item = null, served = '[]'::jsonb, wrong_items = '[]'::jsonb,
            diagnostic_answers = '[]'::jsonb
        where id = ${s.id}
        returning *`;
      await writeEvent(tx, {
        type: LEARNING_EVENT_TYPES.sessionFinished,
        householdId: s.household_id,
        aggregateType: 'learning_session',
        aggregateId: s.id,
        payload: {
          eventName: LEARNING_EVENT_NAMES['learning.session_finished'],
          studentId: s.student_id,
          sessionId: s.id,
          mode: s.mode,
          subject: s.subject,
          answeredCount: s.answered_count,
          correctCount: s.correct_count,
          hintsCount: s.hints_count,
          xp: summary.xp,
          finishedAt: at.toISOString(),
        },
        idempotencyKey: s.id,
      });
      return { session: await toSession(tx, finished!, config), summary, replayed: false };
    });
    return c.json(out, 200);
  });

  // Knowledge map & learning path ----------------------------------------------------------------

  interface MapNode {
    row: repo.TreeRow;
    skills: string[];
  }

  /** Curriculum nodes that have practicable skills, parents first, with the skills below each. */
  async function practicableTree(grade: number, subject?: string): Promise<MapNode[]> {
    const rows = await repo.curriculumTree(sql, grade, subject);
    const ids = new Set(rows.map((r) => r.id));
    const children = new Map<string | null, repo.TreeRow[]>();
    for (const r of rows) {
      const parent = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
      children.set(parent, [...(children.get(parent) ?? []), r]);
    }
    const out: MapNode[] = [];
    const walk = (row: repo.TreeRow): string[] => {
      const node: MapNode = { row, skills: row.practicable ? [row.id] : [] };
      const at = out.push(node) - 1;
      for (const child of children.get(row.id) ?? []) node.skills.push(...walk(child));
      if (node.skills.length === 0) out.splice(at, 1);
      return node.skills;
    };
    for (const root of children.get(null) ?? []) walk(root);
    return out;
  }

  app.openapi(knowledgeMapRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { subject } = c.req.valid('query');
    const scope = await readScope(c.get('actor'), id);
    const student = await studentOr404(sql, scope, id);
    const at = now().getTime();
    const [config, tree, stateRows] = await Promise.all([
      repo.loadConfig(sql),
      practicableTree(student.grade, subject),
      repo.states(sql, scope, id),
    ]);
    const rowOf = new Map(stateRows.map((r) => [r.skill_id, r]));
    const scoreOf = (skillId: string) => Number(rowOf.get(skillId)?.mastery_score ?? 0);
    const kept = new Set(tree.map((n) => n.row.id));

    const subjects = new Map<string, z.infer<typeof KnowledgeMapResponseSchema>['subjects'][0]>();
    for (const { row, skills } of tree) {
      if (!subjects.has(row.subject)) {
        const p = await profile(sql, student.grade, row.subject);
        subjects.set(row.subject, {
          subject: row.subject,
          title: p?.title_vi ?? row.subject,
          readAloud:
            student.grade <= config.session.youngMaxGrade || (p?.read_aloud_default ?? false),
          ttsLang: p?.tts_lang ?? 'vi',
          nodes: [],
        });
      }
      const own = row.level === 'SKILL' ? rowOf.get(row.id) : undefined;
      const rows = skills.flatMap((s) => rowOf.get(s) ?? []);
      const masteryScore = meanScore(skills.map(scoreOf));
      let state: MasteryState;
      if (row.level === 'SKILL') {
        state = displayState(config, own ? repo.toState(own) : newSkillState(config));
      } else {
        // A topic is Retained only when every skill below is; otherwise its mean score decides.
        const all = skills.map((s) => rowOf.get(s));
        const retained = all.every(
          (r) => r && displayState(config, repo.toState(r)) === 'RETAINED',
        );
        state = displayState(config, {
          ...newSkillState(config),
          masteryScore,
          attemptCount: rows.reduce((n, r) => n + r.attempt_count, 0),
          retainedAt: retained ? at : null,
        });
      }
      const review = own ? repo.toReview(own) : null;
      subjects.get(row.subject)!.nodes.push({
        id: row.id,
        parentId: row.parent_id && kept.has(row.parent_id) ? row.parent_id : null,
        level: row.level,
        title: row.title_vi,
        sortOrder: row.sort_order,
        skillCount: skills.length,
        state,
        masteryScore,
        confidenceScore: own ? Number(own.confidence_score) : null,
        attemptCount: rows.reduce((n, r) => n + r.attempt_count, 0),
        recentAccuracy: own ? Number(own.recent_accuracy) : null,
        lastAttemptAt: iso(own?.last_attempt_at ?? null),
        nextReviewAt: iso(own?.due_at ?? null),
        forgettingRisk: own
          ? forgettingRisk(
              own.last_attempt_at ? new Date(own.last_attempt_at).getTime() : null,
              review?.intervalDays ?? null,
              at,
            )
          : null,
      });
    }
    return c.json({ studentId: id, grade: student.grade, subjects: [...subjects.values()] }, 200);
  });

  app.openapi(learningPathRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { subject } = c.req.valid('query');
    const scope = await readScope(c.get('actor'), id);
    const student = await studentOr404(sql, scope, id);
    const at = now().getTime();
    const [config, tree, stateRows] = await Promise.all([
      repo.loadConfig(sql),
      practicableTree(student.grade, subject),
      repo.states(sql, scope, id),
    ]);
    const rowOf = new Map(stateRows.map((r) => [r.skill_id, r]));
    const nodeOf = new Map(tree.map((n) => [n.row.id, n.row]));
    const skills = tree.filter((n) => n.row.level === 'SKILL');
    const edges = await repo.prerequisiteEdges(
      sql,
      skills.map((n) => n.row.id),
    );
    const entries = skills.map(({ row }, order) => {
      const own = rowOf.get(row.id);
      const state = own ? repo.toState(own) : newSkillState(config);
      return {
        skillId: row.id,
        topicId: row.parent_id ?? row.id,
        order,
        state: displayState(config, state),
        masteryScore: state.masteryScore,
        dueAt: own?.due_at ? new Date(own.due_at).getTime() : null,
        prerequisites: edges.filter((e) => e.to_node_id === row.id).map((e) => e.from_node_id),
      };
    });
    const entryOf = new Map(entries.map((e) => [e.skillId, e]));
    const steps = buildLearningPath(entries, at).map((step) => {
      const e = entryOf.get(step.skillId)!;
      const row = nodeOf.get(step.skillId)!;
      return {
        kind: step.kind,
        subject: row.subject,
        skillId: step.skillId,
        skillTitle: row.title_vi,
        topicId: step.topicId,
        topicTitle: nodeOf.get(step.topicId)?.title_vi ?? row.title_vi,
        state: e.state,
        masteryScore: e.masteryScore,
        dueAt: e.dueAt === null ? null : new Date(e.dueAt).toISOString(),
      };
    });
    return c.json({ studentId: id, steps }, 200);
  });

  // Item reports ----------------------------------------------------------------------------------

  app.openapi(reportRoute, async (c) => {
    requireActor(c.get('actor'), 'parent', 'child');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const reported = await repo.insertItemReport(sql, id, input.reason, input.variantSeed ?? null);
    if (!reported) throw new ApiError('NOT_FOUND', 'Item not found');
    return c.json({ reported: true as const }, 201);
  });
}
