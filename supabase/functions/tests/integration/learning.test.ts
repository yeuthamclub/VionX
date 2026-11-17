// M06 practice sessions (`pnpm cloud pnpm test:api`, or CI's local Supabase). Uses whatever approved
// Toán 6 items the library holds and never changes them; an empty library gets the M05 fixture.
// Session lifecycle, T0 hints, idempotency, consent (EDUCATION_ANALYTICS), the nightly aggregate,
// session XP through the worker, and cross-household denial (404) on every child-data route.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnswerResponseSchema,
  HintResponseSchema,
  KnowledgeMapResponseSchema,
  LearningPathResponseSchema,
  NextItemResponseSchema,
  PoliciesResponseSchema,
  SessionCreateResponseSchema,
  SessionFinishResponseSchema,
  StudentCreateResponseSchema,
} from '@vionx/contracts';
import { DEFAULT_MASTERY_CONFIG, forgettingRisk } from '@vionx/domain';
import { ageLearning, findTopic, solve } from '../../../../scripts/lib/learning-solver.ts';
import { zipPackageDir } from '../../../../scripts/lib/library-files.ts';
import { signUpWithEmail, type AuthSession } from '../../../../scripts/lib/local-supabase.ts';

const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
  /\/+$/,
  '',
);
const API = `${FUNCTIONS_URL}/api/v1`;
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SERVICE_SECRET = process.env.VIONX_SERVICE_SECRET ?? 'local-dev-service-secret';
const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });

type Auth = { parent?: AuthSession; child?: string };

async function api(method: string, path: string, auth: Auth = {}, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.parent) headers.authorization = `Bearer ${auth.parent.accessToken}`;
  if (auth.child) headers['x-vionx-child-session'] = auth.child;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    // The local Edge Runtime answers a request sent to a retiring isolate itself (no requestId).
    if (attempt === 1 && res.status === 500 && parsed && !('requestId' in parsed)) continue;
    return { status: res.status, body: parsed };
  }
}

async function drain(eventIds: string[]) {
  // Since M07 every task and session event also regenerates a Today plan (about 3 s per event
  // on a remote database), and the queue may hold events of the files that ran before.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${FUNCTIONS_URL}/worker`, {
      method: 'POST',
      headers: { 'x-vionx-service-secret': SERVICE_SECRET, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events
      where consumer = 'worker' and event_id = any(${eventIds}::uuid[])`;
    if (row!.n === eventIds.length) return;
    if (Date.now() > deadline) throw new Error(`events not processed: ${row!.n}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let policyVersion = 1;
const createdUsers: string[] = [];

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

async function newFamily(grade: number, analytics: boolean): Promise<Family> {
  const parent = await signUpWithEmail(`it-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  createdUsers.push(parent.userId);
  const household = await api('POST', '/household', { parent }, { name: 'Gia đình học' });
  expect(household.status).toBe(201);
  const created = await api(
    'POST',
    '/students',
    { parent },
    { displayName: 'Con', birthYear: 2026 - 6 - grade, grade, pin: '4826' },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const body = StudentCreateResponseSchema.parse(created.body);
  const consents = [
    'CORE_SERVICE',
    'CROSS_BORDER_TRANSFER',
    ...(analytics ? ['EDUCATION_ANALYTICS'] : []),
  ];
  for (const type of consents) {
    const g = await api(
      'POST',
      `/students/${body.student.id}/consents/${type}/grant`,
      { parent },
      { policyVersion },
    );
    expect(g.status, JSON.stringify(g.body)).toBe(200);
  }
  const login = await api(
    'POST',
    '/auth/child/login',
    {},
    { ...body.credentials, deviceId: `it-${randomUUID()}` },
  );
  expect(login.status).toBe(200);
  return {
    parent,
    householdId: household.body.household.id,
    studentId: body.student.id,
    child: login.body.token as string,
  };
}

const start = async (f: Family, body: Record<string, unknown>) => {
  const res = await api(
    'POST',
    '/learning/sessions',
    { child: f.child },
    { clientUuid: randomUUID(), ...body },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return SessionCreateResponseSchema.parse(res.body).session;
};
const next = async (f: Family, id: string) => {
  const res = await api('GET', `/learning/sessions/${id}/next`, { child: f.child });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return NextItemResponseSchema.parse(res.body);
};
const answer = (f: Family, id: string, body: Record<string, unknown>) =>
  api('POST', `/learning/sessions/${id}/answers`, { child: f.child }, body);

async function importMath6Fixture() {
  const admin = await signUpWithEmail(`m06-lib-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
  try {
    await sql`insert into ops.admin_permissions (user_id, permission) values (${admin.userId}, 'CONTENT_ADMIN')`;
    const zip = zipPackageDir(
      resolve(import.meta.dirname, '../../../../scripts/acceptance/fixtures/m05/gdpt2018/6-math'),
    );
    const res = await fetch(`${API}/admin/library/import?mode=apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': 'application/zip',
      },
      body: zip as Uint8Array<ArrayBuffer>,
    });
    expect(res.status).toBe(200);
  } finally {
    await sql`delete from ops.admin_permissions where user_id = ${admin.userId}`;
    await sql`delete from auth.users where id = ${admin.userId}`;
  }
}

let a: Family; // Grade 6, EDUCATION_ANALYTICS granted
let b: Family; // Grade 6, another household, no analytics consent
let topic: { topicId: string; skillIds: string[] };
let skillId: string;

beforeAll(async () => {
  const policies = PoliciesResponseSchema.parse((await api('GET', '/policies/current')).body);
  policyVersion = policies.policies.find((p) => p.type === 'PRIVACY_POLICY')!.version;
  let found = await findTopic(sql, 6, 'math', null, 1);
  if (!found) {
    // A fresh database (CI): this file runs before library.test.ts, so bring the fixture in.
    await importMath6Fixture();
    found = await findTopic(sql, 6, 'math', null, 1);
  }
  if (!found) throw new Error('No approved Toán 6 items after importing the M05 fixture');
  topic = found;
  skillId = topic.skillIds[0]!;
  a = await newFamily(6, true);
  b = await newFamily(6, false);
}, 180_000);

afterAll(async () => {
  if (createdUsers.length > 0) {
    await sql`
      delete from app.households where id in (
        select household_id from app.household_memberships where user_id = any(${createdUsers}::uuid[]))`;
    await sql`delete from auth.users where id = any(${createdUsers}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

const TABLES = [
  'mastery_config',
  'learning_sessions',
  'answer_attempts',
  'student_skill_states',
  'review_schedule',
  'mistake_patterns',
  'student_item_history',
];

describe('schema', () => {
  it('stores the mastery config of @vionx/domain', async () => {
    const [row] = await sql<{ config: unknown }[]>`
      select config from app.mastery_config order by version desc limit 1`;
    expect(row!.config).toEqual(DEFAULT_MASTERY_CONFIG);
  });

  it('has RLS on every learning table and no privilege for client roles', async () => {
    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = any(${TABLES})`;
    expect(rls).toHaveLength(TABLES.length);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    const grants = await sql`
      select table_name, grantee from information_schema.role_table_grants
      where table_schema = 'app' and table_name = any(${TABLES})
        and grantee in ('anon', 'authenticated', 'PUBLIC')`;
    expect(grants).toHaveLength(0);
  });

  it('keeps student and household ids out of the library schema', async () => {
    const columns = await sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'library' and column_name ~ '(student|household|session|user)_id'`;
    expect(columns.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([]);
  });
});

describe('practice session', () => {
  let sessionId: string;
  let itemId: string;

  it('starts idempotently by clientUuid and serves one item until it is answered', async () => {
    const clientUuid = randomUUID();
    const body = { clientUuid, skillIds: [skillId], mode: 'PRACTICE', targetItems: 3 };
    const first = await api('POST', '/learning/sessions', { child: a.child }, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const created = SessionCreateResponseSchema.parse(first.body);
    expect(created).toMatchObject({ replayed: false });
    expect(created.session).toMatchObject({
      mode: 'PRACTICE',
      status: 'ACTIVE',
      grade: 6,
      subject: 'math',
      skillIds: [skillId],
      targetItems: 3,
      maxMinutes: 25,
      youngMode: false,
      analytics: true,
    });
    const again = SessionCreateResponseSchema.parse(
      (await api('POST', '/learning/sessions', { child: a.child }, body)).body,
    );
    expect(again).toMatchObject({ replayed: true, session: { id: created.session.id } });
    // Another household cannot take over the same clientUuid.
    expect((await api('POST', '/learning/sessions', { child: b.child }, body)).status).toBe(409);
    sessionId = created.session.id;

    const one = await next(a, sessionId);
    const two = await next(a, sessionId);
    expect(one.done).toBe(false);
    expect(two.item).toEqual(one.item);
    expect(one.progress).toEqual({ answered: 0, correct: 0, target: 3 });
    itemId = one.item!.id;
    // The served item carries no answer, feedback or solution.
    const raw = JSON.stringify(
      (await api('GET', `/learning/sessions/${sessionId}/next`, { child: a.child })).body,
    );
    expect(raw).not.toMatch(
      /"(answer|correctAnswer|explanationMd|workedSolutionMd|distractorFeedback)"/,
    );
  });

  it('gives the hint ladder in order and the worked solution only with the last hint', async () => {
    const levels = [];
    for (let i = 0; i < 5; i++) {
      const res = await api('POST', `/learning/sessions/${sessionId}/hint`, { child: a.child });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const hint = HintResponseSchema.parse(res.body);
      levels.push(hint.level);
      expect(hint.hint.md).not.toBe('');
      expect(hint.workedSolutionMd === null).toBe(hint.level < hint.total);
    }
    expect(levels).toEqual([1, 2, 3, 4, 4]);
    const shown = await next(a, sessionId);
    expect(shown.item!.hints).toHaveLength(4);
    const [row] = await sql<{ hints_count: number }[]>`
      select hints_count from app.learning_sessions where id = ${sessionId}`;
    expect(row!.hints_count).toBe(4);
  });

  it('rejects an answer for another item or of the wrong shape', async () => {
    const wrongItem = await answer(a, sessionId, {
      clientUuid: randomUUID(),
      itemId: randomUUID(),
      response: { optionId: 'a' },
    });
    expect(wrongItem.status).toBe(409);
    expect(wrongItem.body.details).toMatchObject({ reason: 'NOT_CURRENT_ITEM' });
    const badShape = await answer(a, sessionId, {
      clientUuid: randomUUID(),
      itemId,
      response: { nonsense: true },
    });
    expect(badShape.status).toBe(400);
  });

  it('judges a wrong answer, stores the attempt once and replays by clientUuid', async () => {
    const item = (await next(a, sessionId)).item!;
    const solved = await solve(sql, item.id, item.seed);
    const body = {
      clientUuid: randomUUID(),
      itemId: item.id,
      response: solved.wrong,
      responseMs: 5000,
    };
    const res = await answer(a, sessionId, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const judged = AnswerResponseSchema.parse(res.body);
    expect(judged).toMatchObject({
      isCorrect: false,
      replayed: false,
      correctAnswer: solved.answer,
      progress: { answered: 1, correct: 0, target: 3 },
    });
    // Level 4 was reached, so the worked solution comes with the result.
    expect(judged.workedSolutionMd).not.toBeNull();
    expect(judged.masteryDelta).toBeLessThanOrEqual(0);
    const replay = AnswerResponseSchema.parse((await answer(a, sessionId, body)).body);
    expect(replay).toEqual({ ...judged, replayed: true });
    const attempts = await sql`
      select is_correct, hints_used, response_ms, variant_seed from app.answer_attempts
      where session_id = ${sessionId}`;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ is_correct: false, hints_used: 4, response_ms: 5000 });
    const [history] = await sql<{ seen_count: number; last_correct: boolean }[]>`
      select seen_count, last_correct from app.student_item_history
      where student_id = ${a.studentId} and item_id = ${item.id}`;
    expect(history).toMatchObject({ seen_count: 1, last_correct: false });
    // The item is answered: a hint has nothing to attach to until the next item is served.
    expect(
      (await api('POST', `/learning/sessions/${sessionId}/hint`, { child: a.child })).status,
    ).toBe(409);
  });

  it('a correct answer raises mastery, schedules a review and never repeats the item', async () => {
    await ageLearning(sql, a.studentId, '1 minute');
    const item = (await next(a, sessionId)).item!;
    expect(item.id).not.toBe(itemId);
    const solved = await solve(sql, item.id, item.seed);
    const judged = AnswerResponseSchema.parse(
      (
        await answer(a, sessionId, {
          clientUuid: randomUUID(),
          itemId: item.id,
          response: solved.correct,
        })
      ).body,
    );
    expect(judged.isCorrect).toBe(true);
    expect(judged.masteryDelta).toBeGreaterThan(0);
    expect(judged.workedSolutionMd).toBeNull();
    expect(judged.skill.skillId).toBe(skillId);
    const [state] = await sql<Record<string, unknown>[]>`
      select s.attempt_count, s.correct_count, s.mastery_score, s.next_review_at, r.interval_days, r.due_at
      from app.student_skill_states s
      join app.review_schedule r on r.student_id = s.student_id and r.skill_id = s.skill_id
      where s.student_id = ${a.studentId} and s.skill_id = ${skillId}`;
    expect(state).toMatchObject({ attempt_count: 2, correct_count: 1 });
    expect(Number(state!.mastery_score)).toBe(judged.skill.masteryScore);
    expect(Number(state!.interval_days)).toBe(1);
    expect(state!.next_review_at).toEqual(state!.due_at);
  });

  it('finishes once: summary with solutions, one event, XP through the worker once', async () => {
    const res = await api('POST', `/learning/sessions/${sessionId}/finish`, { child: a.child });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = SessionFinishResponseSchema.parse(res.body);
    expect(done).toMatchObject({
      replayed: false,
      session: { status: 'FINISHED' },
      summary: { answered: 2, correct: 1, accuracy: 0.5, hintsUsed: 4, xp: 5 },
    });
    expect(done.summary.solutions).toHaveLength(1);
    expect(done.summary.skills[0]).toMatchObject({ skillId });
    const again = SessionFinishResponseSchema.parse(
      (await api('POST', `/learning/sessions/${sessionId}/finish`, { child: a.child })).body,
    );
    expect(again).toMatchObject({ replayed: true, summary: done.summary });
    expect((await next(a, sessionId)).reason).toBe('FINISHED');
    expect(
      (
        await answer(a, sessionId, {
          clientUuid: randomUUID(),
          itemId,
          response: { optionId: 'a' },
        })
      ).status,
    ).toBe(409);

    const events = await sql<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload from ops.domain_events
      where type = 'learning.session_finished' and aggregate_id = ${sessionId}`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      eventName: 'LearningSessionFinished',
      studentId: a.studentId,
      correctCount: 1,
      xp: 5,
    });
    await drain([events[0]!.id]);
    const [replay] = await sql<{ id: string }[]>`
      insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
      values ('learning.session_finished', ${a.householdId}, 'learning_session', ${sessionId},
              ${sql.json(events[0]!.payload as never)}, ${`it:${randomUUID()}`})
      returning id`;
    await drain([replay!.id]);
    const ledger = await sql`
      select lifetime_xp_delta, rule_id, source_type from app.xp_ledger where source_id = ${sessionId}`;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      lifetime_xp_delta: 5,
      rule_id: 'LEARNING_CORRECT_ANSWER',
      source_type: 'learning_session',
    });
  });

  it('shows the state in the knowledge map and the path, to the child and the parent', async () => {
    for (const auth of [{ child: a.child }, { parent: a.parent }]) {
      const res = await api('GET', `/students/${a.studentId}/knowledge-map?subject=math`, auth);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const map = KnowledgeMapResponseSchema.parse(res.body);
      expect(map.subjects.map((s) => s.subject)).toEqual(['math']);
      const nodes = map.subjects[0]!.nodes;
      const skill = nodes.find((n) => n.id === skillId)!;
      expect(skill).toMatchObject({ level: 'SKILL', attemptCount: 2, skillCount: 1 });
      expect(skill.state).not.toBe('NOT_LEARNED');
      expect(skill.forgettingRisk).toBeGreaterThanOrEqual(0);
      // Parents come before their children; every parent id is in the list.
      const seen = new Set<string>();
      for (const n of nodes) {
        if (n.parentId) expect(seen.has(n.parentId)).toBe(true);
        seen.add(n.id);
      }
    }
    const path = LearningPathResponseSchema.parse(
      (await api('GET', `/students/${a.studentId}/learning-path`, { parent: a.parent })).body,
    );
    expect(path.steps.find((s) => s.skillId === skillId)).toMatchObject({ kind: 'CONTINUE' });
    await ageLearning(sql, a.studentId, '2 days');
    const later = LearningPathResponseSchema.parse(
      (await api('GET', `/students/${a.studentId}/learning-path`, { child: a.child })).body,
    );
    expect(later.steps[0]).toMatchObject({ kind: 'REVIEW_DUE', skillId });
    const review = await start(a, { mode: 'REVIEW', subject: 'math' });
    expect(review).toMatchObject({ mode: 'REVIEW', skillIds: [skillId] });
    expect((await next(a, review.id)).item).toMatchObject({ slotKind: 'REVIEW', skillId });
  });
});

describe('rules of access', () => {
  it('refuses parents and unknown or foreign-grade nodes', async () => {
    const body = { clientUuid: randomUUID(), skillIds: [skillId] };
    expect((await api('POST', '/learning/sessions', { parent: a.parent }, body)).status).toBe(403);
    expect((await api('POST', '/learning/sessions', {}, body)).status).toBe(401);
    expect(
      (
        await api(
          'POST',
          '/learning/sessions',
          { child: a.child },
          { clientUuid: randomUUID(), nodeId: randomUUID() },
        )
      ).status,
    ).toBe(404);
    expect(
      (await api('POST', '/learning/sessions', { child: a.child }, { clientUuid: randomUUID() }))
        .status,
    ).toBe(400);
    const grade2 = await newFamily(2, false);
    expect(
      (
        await api(
          'POST',
          '/learning/sessions',
          { child: grade2.child },
          { clientUuid: randomUUID(), skillIds: [skillId] },
        )
      ).status,
    ).toBe(404);
    const nothingDue = await api(
      'POST',
      '/learning/sessions',
      { child: b.child },
      { clientUuid: randomUUID(), mode: 'REVIEW', subject: 'math' },
    );
    expect(nothingDue.status).toBe(409);
    expect(nothingDue.body.details).toMatchObject({ reason: 'NOTHING_DUE' });
  });

  it('answers 404 for another household on every child-data route', async () => {
    const session = await start(a, { skillIds: [skillId], mode: 'PRACTICE' });
    const item = (await next(a, session.id)).item!;
    const body = { clientUuid: randomUUID(), itemId: item.id, response: { optionId: 'a' } };
    const denied = [
      await api('GET', `/learning/sessions/${session.id}/next`, { child: b.child }),
      await api('POST', `/learning/sessions/${session.id}/answers`, { child: b.child }, body),
      await api('POST', `/learning/sessions/${session.id}/hint`, { child: b.child }),
      await api('POST', `/learning/sessions/${session.id}/finish`, { child: b.child }),
      await api('GET', `/students/${a.studentId}/knowledge-map`, { child: b.child }),
      await api('GET', `/students/${a.studentId}/knowledge-map`, { parent: b.parent }),
      await api('GET', `/students/${a.studentId}/learning-path`, { child: b.child }),
      await api('GET', `/students/${a.studentId}/learning-path`, { parent: b.parent }),
    ];
    expect(denied.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    // Parents read, they do not play their child's session.
    expect(
      (await api('GET', `/learning/sessions/${session.id}/next`, { parent: a.parent })).status,
    ).toBe(403);
    // Nothing moved: the session still waits for the same item.
    expect((await next(a, session.id)).item!.id).toBe(item.id);
    const [row] = await sql<{ answered_count: number; hints_count: number; status: string }[]>`
      select answered_count, hints_count, status from app.learning_sessions where id = ${session.id}`;
    expect(row).toEqual({ answered_count: 0, hints_count: 0, status: 'ACTIVE' });
  });

  it('without EDUCATION_ANALYTICS the session works and only aggregates are stored', async () => {
    const session = await start(b, { skillIds: [skillId], mode: 'PRACTICE', targetItems: 2 });
    expect(session.analytics).toBe(false);
    for (let i = 0; i < 2; i++) {
      const item = (await next(b, session.id)).item!;
      const solved = await solve(sql, item.id, item.seed);
      const res = await answer(b, session.id, {
        clientUuid: randomUUID(),
        itemId: item.id,
        response: i === 0 ? solved.wrong : solved.correct,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await ageLearning(sql, b.studentId, '1 minute');
    }
    expect((await next(b, session.id)).reason).toBe('TARGET_REACHED');
    const done = SessionFinishResponseSchema.parse(
      (await api('POST', `/learning/sessions/${session.id}/finish`, { child: b.child })).body,
    );
    expect(done.summary).toMatchObject({ answered: 2, correct: 1 });
    const [rows] = await sql<Record<string, number>[]>`
      select
        (select count(*)::int from app.answer_attempts where student_id = ${b.studentId}) as attempts,
        (select count(*)::int from app.student_item_history where student_id = ${b.studentId}) as history,
        (select count(*)::int from app.mistake_patterns where student_id = ${b.studentId}) as mistakes,
        (select count(*)::int from app.student_skill_states where student_id = ${b.studentId}) as states,
        (select count(*)::int from app.review_schedule where student_id = ${b.studentId}) as reviews`;
    expect(rows).toEqual({ attempts: 0, history: 0, mistakes: 0, states: 1, reviews: 1 });
    const [stored] = await sql<
      { served: unknown[]; wrong_items: unknown[]; last_answer: unknown }[]
    >`
      select served, wrong_items, last_answer from app.learning_sessions where id = ${session.id}`;
    expect(stored).toMatchObject({ served: [], wrong_items: [] });
  });

  it('reports a question without storing who reported', async () => {
    const [item] = await sql<{ id: string }[]>`
      select id from library.items where skill_ids @> array[${skillId}]::uuid[]
        and status in ('APPROVED', 'PUBLISHED') limit 1`;
    const before = await sql`select id from library.item_reports where item_id = ${item!.id}`;
    const res = await api(
      'POST',
      `/items/${item!.id}/report`,
      { child: a.child },
      { reason: 'UNCLEAR', variantSeed: 7 },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(
      (await api('POST', `/items/${item!.id}/report`, { parent: a.parent }, { reason: 'TYPO' }))
        .status,
    ).toBe(201);
    expect(
      (await api('POST', `/items/${randomUUID()}/report`, { child: a.child }, { reason: 'TYPO' }))
        .status,
    ).toBe(404);
    const after = await sql`
      select reason, variant_seed from library.item_reports where item_id = ${item!.id} order by created_at`;
    expect(after.length).toBe(before.length + 2);
    // Clean up the two test reports (library content itself is untouched).
    await sql`
      delete from library.item_reports where item_id = ${item!.id}
        and not (id = any(${before.map((r) => r.id as string)}::uuid[]))`;
  });
});

describe('nightly aggregate', () => {
  it('writes attempts into library.item_stats as counts only and refreshes forgetting risk', async () => {
    const attempted = await sql<{ item_id: string; n: number; correct: number }[]>`
      select item_id, count(*)::int as n, sum(is_correct::int)::int as correct
      from app.answer_attempts where student_id = ${a.studentId} group by item_id`;
    expect(attempted.length).toBeGreaterThan(0);
    const before = await sql<{ item_id: string; attempts: number }[]>`
      select item_id, attempts from library.item_stats
      where item_id = any(${attempted.map((r) => r.item_id)}::uuid[])`;
    await sql`select ops.learning_nightly()`;
    const stats = await sql<
      { item_id: string; attempts: number; p_correct: string; hint_rate: string }[]
    >`
      select item_id, attempts, p_correct, hint_rate from library.item_stats
      where item_id = any(${attempted.map((r) => r.item_id)}::uuid[])`;
    expect(stats).toHaveLength(attempted.length);
    for (const s of stats) {
      const mine = attempted.find((r) => r.item_id === s.item_id)!;
      const earlier = before.find((r) => r.item_id === s.item_id)?.attempts ?? 0;
      // Other test families may have answered the same item; ours are counted.
      expect(s.attempts).toBeGreaterThanOrEqual(Math.max(mine.n, earlier));
      expect(Number(s.p_correct)).toBeGreaterThanOrEqual(0);
      expect(Number(s.p_correct)).toBeLessThanOrEqual(1);
    }
    const [state] = await sql<
      { forgetting_risk: string; last_attempt_at: Date; interval_days: string }[]
    >`
      select s.forgetting_risk, s.last_attempt_at, r.interval_days
      from app.student_skill_states s
      join app.review_schedule r on r.student_id = s.student_id and r.skill_id = s.skill_id
      where s.student_id = ${a.studentId} and s.skill_id = ${skillId}`;
    const expected = forgettingRisk(
      new Date(state!.last_attempt_at).getTime(),
      Number(state!.interval_days),
      Date.now(),
    );
    expect(Number(state!.forgetting_risk)).toBeCloseTo(expected, 2);
    expect(Number(state!.forgetting_risk)).toBeGreaterThan(0.5);
  });
});
