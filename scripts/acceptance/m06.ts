// M06 acceptance (TASK_PACKS/M06.md). Requires `pnpm db:start && pnpm fn:serve` and the Toán 6,
// Toán 2 and Tiếng Việt 2 libraries (real ones, or the M05 fixtures left by `pnpm acceptance m05`).
// Local only: signs up throwaway email parents; it never changes library content.
//   pnpm acceptance m06
// Criteria:
//   1. diagnostic on "Phân số" → 10 correct answers → Proficient;
//   2. with hints, the mastery delta is smaller;
//   3. a TEMPLATE item shows different numbers on retry and is judged against that seed;
//   4. a due review appears the next day;
//   5. XP is granted once per session;
//   6. a Grade 2 child completes a Toán 2 session using only taps, every item readable aloud in
//      Vietnamese;
//   7. a passage group shows its passage and 3 linked items.
// Time is moved the M04 way: the scenario shifts the stored timestamps of its own throwaway
// students into the past (one minute between answers, one day for the review) instead of waiting.
import { randomUUID } from 'node:crypto';
import { ageLearning, findTopic, solve, type Solved } from '../lib/learning-solver.ts';
import { signUpWithEmail, type AuthSession } from '../lib/local-supabase.ts';
import { assert, connectDb, env, SkipStep, type Scenario } from './lib.ts';

const API = `${env.functionsUrl}/api/v1`;
const sql = connectDb();

interface Res {
  status: number;
  body: Record<string, unknown> & { code?: string };
}
type Auth = { parent?: AuthSession; child?: string };

async function call(method: string, path: string, auth?: Auth, body?: unknown): Promise<Res> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth?.parent ? { authorization: `Bearer ${auth.parent.accessToken}` } : {}),
        ...(auth?.child ? { 'x-vionx-child-session': auth.child } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const parsed = (text ? JSON.parse(text) : {}) as Res['body'];
    // The local Edge Runtime answers a request sent to a retiring isolate itself (no requestId).
    if (attempt === 1 && res.status === 500 && !('requestId' in parsed)) continue;
    return { status: res.status, body: parsed };
  }
}

async function ok(method: string, path: string, auth?: Auth, body?: unknown, status = 200) {
  const res = await call(method, path, auth, body);
  assert(res.status === status, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function drain(eventIds: string[]): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${env.functionsUrl}/worker`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vionx-service-secret': env.serviceSecret },
      body: '{}',
    });
    assert(res.ok, `worker responded ${res.status}`);
    await res.body?.cancel();
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ops.processed_events
      where consumer = 'worker' and event_id = any(${eventIds}::uuid[])`;
    if (row!.n === eventIds.length) return;
    assert(Date.now() < deadline, `events not processed: ${row!.n}/${eventIds.length}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

interface Family {
  parent: AuthSession;
  householdId: string;
  studentId: string;
  child: string;
}

const users: string[] = [];
const eventIds: string[] = [];

async function newFamily(label: string, grade: number): Promise<Family> {
  const parent = await signUpWithEmail(
    `acceptance-m06-${label}-${randomUUID()}@vionx.test`,
    `pw-${randomUUID()}`,
  );
  users.push(parent.userId);
  const household = await ok('POST', '/household', { parent }, { name: `Gia đình ${label}` }, 201);
  const student = await ok(
    'POST',
    '/students',
    { parent },
    { displayName: `Con ${label}`, grade, birthYear: 2026 - 6 - grade },
    201,
  );
  const studentId = (student.student as { id: string }).id;
  const policies = await ok('GET', '/policies/current');
  const version = (policies.policies as { type: string; version: number }[]).find(
    (p) => p.type === 'PRIVACY_POLICY',
  )!.version;
  for (const type of ['CORE_SERVICE', 'CROSS_BORDER_TRANSFER', 'EDUCATION_ANALYTICS']) {
    await ok(
      'POST',
      `/students/${studentId}/consents/${type}/grant`,
      { parent },
      { policyVersion: version },
    );
  }
  const login = await ok('POST', '/auth/child/login', undefined, {
    ...(student.credentials as object),
    deviceId: `acceptance-${randomUUID()}`,
  });
  return {
    parent,
    householdId: (household.household as { id: string }).id,
    studentId,
    child: login.token as string,
  };
}

// --- Session helpers ------------------------------------------------------------------------------

interface Item {
  id: string;
  type: string;
  kind: string;
  skillId: string;
  slotKind: string;
  stemMd: string;
  seed: number | null;
  ttsText: string | null;
  ttsLang: string;
  hintsTotal: number;
  options: {
    id: string;
    text: string | null;
    ttsText: string | null;
    media: { alt: string } | null;
  }[];
}
interface Group {
  id: string;
  title: string;
  bodyMd: string;
  position: number;
  total: number;
}
interface Next {
  done: boolean;
  reason: string | null;
  item: Item | null;
  group: Group | null;
}
interface Session {
  id: string;
  mode: string;
  targetItems: number;
  maxMinutes: number;
  youngMode: boolean;
  readAloud: boolean;
  ttsLang: string;
  analytics: boolean;
}
interface Answer {
  isCorrect: boolean;
  masteryDelta: number;
  correctAnswer: Record<string, unknown>;
  workedSolutionMd: string | null;
  skill: { state: string; masteryScore: number };
}

async function start(f: Family, body: Record<string, unknown>): Promise<Session> {
  const res = await ok(
    'POST',
    '/learning/sessions',
    { child: f.child },
    { clientUuid: randomUUID(), ...body },
  );
  return res.session as Session;
}
const next = async (f: Family, id: string) =>
  (await ok('GET', `/learning/sessions/${id}/next`, { child: f.child })) as unknown as Next;
const answer = async (f: Family, id: string, item: Item, response: Record<string, unknown>) =>
  (await ok(
    'POST',
    `/learning/sessions/${id}/answers`,
    { child: f.child },
    { clientUuid: randomUUID(), itemId: item.id, response, responseMs: 4000 },
  )) as unknown as Answer;
const finish = (f: Family, id: string) =>
  ok('POST', `/learning/sessions/${id}/finish`, { child: f.child });

/** Answers every item of a session correctly, one minute apart. Returns what was served. */
async function playAll(f: Family, id: string, each?: (n: Next, s: Solved) => void | Promise<void>) {
  const served: { next: Next; answer: Answer }[] = [];
  for (let guard = 0; guard < 60; guard++) {
    const n = await next(f, id);
    if (n.done) return served;
    const solved = await solve(sql, n.item!.id, n.item!.seed);
    await each?.(n, solved);
    const a = await answer(f, id, n.item!, solved.correct);
    assert(a.isCorrect, `correct response judged wrong for item ${n.item!.id} (${n.item!.type})`);
    served.push({ next: n, answer: a });
    await ageLearning(sql, f.studentId, '1 minute');
  }
  throw new Error('session did not end');
}

/** Marks items as already seen by a throwaway student, so selection prefers the others. */
async function markSeen(f: Family, itemIds: string[]) {
  if (itemIds.length === 0) return;
  await sql`
    insert into app.student_item_history (student_id, item_id, household_id, last_seen_at)
    select ${f.studentId}, id, ${f.householdId}, now() - interval '30 days'
    from library.items where id = any(${itemIds}::uuid[])
    on conflict do nothing`;
}

async function setTargetDifficulty(f: Family, skillId: string, difficulty: number) {
  await sql`
    insert into app.student_skill_states (student_id, skill_id, household_id, current_difficulty)
    values (${f.studentId}, ${skillId}, ${f.householdId}, ${difficulty})
    on conflict (student_id, skill_id) do update set current_difficulty = excluded.current_difficulty`;
}

const state: {
  a?: Family;
  b?: Family;
  c?: Family;
  g2?: Family;
  fractions?: { topicId: string; topicTitle: string; skillIds: string[] };
  reviewSession?: string;
} = {};
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export const scenario: Scenario = {
  name: 'M06 — Practice sessions, mastery, T0 hints, template variants, Grade 1-3 mode',
  steps: [
    {
      name: 'Libraries are present; three Grade 6 children and one Grade 2 child sign in',
      run: async () => {
        const counts = await sql<{ grade: number; subject: string; n: number }[]>`
          select grade, subject, count(*)::int as n from library.items
          where status in ('APPROVED', 'PUBLISHED') and type <> 'written'
            and (grade, subject) in ((6, 'math'), (2, 'math'), (2, 'viet'))
          group by grade, subject order by grade, subject`;
        assert(
          counts.length === 3,
          `needs approved Toán 6, Toán 2 and Tiếng Việt 2 items; found ${JSON.stringify(counts)}`,
        );
        state.fractions = (await findTopic(sql, 6, 'math', '%phân số%')) ?? undefined;
        assert(
          state.fractions,
          'no Toán 6 topic titled "Phân số" with at least 2 practicable skills',
        );
        state.a = await newFamily('A', 6);
        state.b = await newFamily('B', 6);
        state.c = await newFamily('C', 6);
        state.g2 = await newFamily('G2', 2);
        return counts.map((c) => `${c.subject} ${c.grade}: ${c.n} items`).join(', ');
      },
    },
    {
      name: 'Diagnostic on "Phân số" → 10 correct answers → Proficient',
      run: async () => {
        const a = state.a!;
        const topic = state.fractions!;
        const session = await start(a, { nodeId: topic.topicId });
        assert(session.mode === 'DIAGNOSTIC', `first session on a topic is ${session.mode}`);
        assert(session.targetItems === 10, `diagnostic has ${session.targetItems} items`);
        const served = await playAll(a, session.id);
        assert(served.length === 10, `answered ${served.length} items`);
        assert(
          served.every((s) => s.answer.masteryDelta === 0),
          'a diagnostic answer moved the score before placement',
        );
        const done = await finish(a, session.id);
        const map = await ok('GET', `/students/${a.studentId}/knowledge-map?subject=math`, {
          child: a.child,
        });
        const nodes = (
          map.subjects as { nodes: { id: string; state: string; masteryScore: number }[] }[]
        )[0]!.nodes;
        const node = nodes.find((n) => n.id === topic.topicId)!;
        assert(node.state === 'PROFICIENT', `topic is ${node.state} (${node.masteryScore})`);
        const skills = nodes.filter((n) => topic.skillIds.includes(n.id));
        assert(
          skills.every((n) => n.state === 'PROFICIENT'),
          `skill states: ${skills.map((n) => n.state).join(',')}`,
        );
        const again = await start(a, { nodeId: topic.topicId });
        assert(again.mode === 'PRACTICE', `second session on the topic is ${again.mode}`);
        return `"${topic.topicTitle}" (${topic.skillIds.length} skills): 10/10 → ${node.state}, score ${node.masteryScore}; xp ${(done.summary as { xp: number }).xp}; next session is PRACTICE`;
      },
    },
    {
      name: 'With hints, the mastery delta is smaller',
      run: async () => {
        const skillId = state.fractions!.skillIds[0]!;
        const plain = await start(state.b!, { skillIds: [skillId], mode: 'PRACTICE' });
        const n1 = await next(state.b!, plain.id);
        const a1 = await answer(
          state.b!,
          plain.id,
          n1.item!,
          (await solve(sql, n1.item!.id, n1.item!.seed)).correct,
        );

        const c = state.c!;
        const hinted = await start(c, { skillIds: [skillId], mode: 'PRACTICE' });
        const n2 = await next(c, hinted.id);
        assert(n2.item!.hintsTotal === 4, `item has ${n2.item!.hintsTotal} hints`);
        const levels: number[] = [];
        let solution: unknown = null;
        for (let i = 0; i < 5; i++) {
          const h = await ok('POST', `/learning/sessions/${hinted.id}/hint`, { child: c.child });
          levels.push(h.level as number);
          assert(typeof (h.hint as { md: string }).md === 'string', 'hint has no text');
          if (i < 3) assert(h.workedSolutionMd === null, `solution shown at level ${i + 1}`);
          solution = h.workedSolutionMd;
        }
        assert(same(levels, [1, 2, 3, 4, 4]), `hint levels ${levels.join(',')}`);
        assert(typeof solution === 'string', 'no worked solution after hint level 4');
        const a2 = await answer(
          c,
          hinted.id,
          n2.item!,
          (await solve(sql, n2.item!.id, n2.item!.seed)).correct,
        );
        assert(a1.isCorrect && a2.isCorrect, 'answers judged wrong');
        assert(
          a1.masteryDelta > 0 && a2.masteryDelta > 0,
          `deltas ${a1.masteryDelta}, ${a2.masteryDelta}`,
        );
        assert(
          a2.masteryDelta < a1.masteryDelta,
          `hinted ${a2.masteryDelta} ≥ plain ${a1.masteryDelta}`,
        );
        assert(a2.workedSolutionMd !== null, 'answer after 4 hints has no worked solution');
        // A wrong option returns its pre-written feedback (no AI call).
        const [ai] = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.ai_runs where created_at > now() - interval '10 minutes'`;
        state.reviewSession = hinted.id;
        return `no hint +${a1.masteryDelta}, 4 hints +${a2.masteryDelta}; worked solution only at level 4; AI runs in the last 10 min: ${ai!.n}`;
      },
    },
    {
      name: 'A TEMPLATE item shows different numbers on retry and is judged against that seed',
      run: async () => {
        const b = state.b!;
        const [tpl] = await sql<{ id: string; skill_id: string; difficulty: number }[]>`
          select i.id, i.skill_ids[1] as skill_id, i.difficulty
          from library.items i join library.item_templates t on t.item_id = i.id
          where i.grade = 6 and i.subject = 'math' and i.kind = 'TEMPLATE'
            and i.status in ('APPROVED', 'PUBLISHED') and t.flagged_at is null
            and i.type in ('numeric', 'single_choice')
          order by i.code limit 1`;
        assert(tpl, 'no TEMPLATE item in Toán 6');
        const all = await sql<{ id: string }[]>`
          select id from library.items where skill_ids @> array[${tpl.skill_id}]::uuid[]`;
        await markSeen(
          b,
          all.map((r) => r.id),
        );
        const seen = new Map<string, { seed: number; solved: Solved }>();
        for (let round = 0; round < 40; round++) {
          await setTargetDifficulty(b, tpl.skill_id, tpl.difficulty);
          const session = await start(b, {
            skillIds: [tpl.skill_id],
            mode: 'PRACTICE',
            targetItems: 1,
          });
          const n = await next(b, session.id);
          const item = n.item!;
          assert(item.kind === 'TEMPLATE' && item.seed !== null, `served a ${item.kind} item`);
          const solved = await solve(sql, item.id, item.seed);
          assert(
            solved.stemMd === item.stemMd,
            'served stem is not the variant of the stored seed',
          );
          const first = seen.get(item.id);
          if (!first || first.solved.stemMd === solved.stemMd) {
            const a = await answer(b, session.id, item, solved.correct);
            assert(a.isCorrect, 'correct answer of the seed judged wrong');
            if (!first) seen.set(item.id, { seed: item.seed, solved });
            await finish(b, session.id);
            await ageLearning(sql, b.studentId, '1 minute');
            continue;
          }
          assert(first.seed !== item.seed, 'retry reused the seed');
          // The answer of the earlier variant is wrong now (when the two answers differ).
          const stale = !same(first.solved.answer, solved.answer);
          const a = await answer(
            b,
            session.id,
            item,
            stale ? first.solved.correct : solved.correct,
          );
          assert(
            a.isCorrect === !stale,
            `answer of seed ${first.seed} judged ${a.isCorrect} on seed ${item.seed}`,
          );
          assert(
            same(a.correctAnswer, solved.answer),
            'correctAnswer is not the answer of the served seed',
          );
          const [attempt] = await sql<{ variant_seed: string }[]>`
            select variant_seed from app.answer_attempts
            where student_id = ${b.studentId} and item_id = ${item.id} order by answered_at desc limit 1`;
          assert(Number(attempt!.variant_seed) === item.seed, 'attempt does not store the seed');
          return `seed ${first.seed}: "${first.solved.stemMd.slice(0, 50)}" → seed ${item.seed}: "${solved.stemMd.slice(0, 50)}"; ${stale ? 'the old answer is judged wrong, ' : ''}correctAnswer follows the new seed`;
        }
        throw new Error('no template repeated with different numbers in 40 sessions');
      },
    },
    {
      name: 'A due review appears the next day',
      run: async () => {
        const c = state.c!;
        const [reviewSkill, otherSkill] = state.fractions!.skillIds;
        const path = async () =>
          (
            await ok('GET', `/students/${c.studentId}/learning-path?subject=math`, {
              child: c.child,
            })
          ).steps as { kind: string; skillId: string }[];
        assert(
          (await path()).every((s) => s.kind !== 'REVIEW_DUE'),
          'a review is due on the day of practice',
        );
        const [schedule] = await sql<{ days: number }[]>`
          select round(extract(epoch from due_at - last_reviewed_at) / 86400)::int as days
          from app.review_schedule where student_id = ${c.studentId} and skill_id = ${reviewSkill!}`;
        assert(schedule?.days === 1, `first review interval is ${schedule?.days} days`);
        await ageLearning(sql, c.studentId, '1 day');
        const steps = await path();
        assert(
          steps[0]?.kind === 'REVIEW_DUE' && steps[0].skillId === reviewSkill,
          `path starts with ${steps[0]?.kind}`,
        );
        // A practice session on another skill gives 30% of its slots to the due review.
        const session = await start(c, {
          skillIds: [otherSkill!],
          mode: 'PRACTICE',
          targetItems: 10,
        });
        const served = await playAll(c, session.id);
        const reviews = served.filter((s) => s.next.item!.slotKind === 'REVIEW');
        assert(served[3]?.next.item!.slotKind === 'REVIEW', 'slot 4 is not a review');
        assert(served[3]!.next.item!.skillId === reviewSkill, 'the review is for another skill');
        assert(
          (await path()).every((s) => s.kind !== 'REVIEW_DUE'),
          'review still due after it was answered',
        );
        state.reviewSession = session.id;
        return `interval 1 day; after one day the path starts with REVIEW_DUE and item 4 of 10 was the review (${reviews.length} review slot used, then none due)`;
      },
    },
    {
      name: 'XP is granted once per session',
      run: async () => {
        const c = state.c!;
        const id = state.reviewSession!;
        const done = await finish(c, id);
        const summary = done.summary as { xp: number; correct: number };
        assert(summary.xp === summary.correct * 5 && summary.xp > 0, `summary xp ${summary.xp}`);
        const grants = async () =>
          sql<{ lifetime_xp_delta: number; rule_id: string }[]>`
            select lifetime_xp_delta, rule_id from app.xp_ledger
            where source_type = 'learning_session' and source_id = ${id}`;
        const [event] = await sql<{ id: string; payload: Record<string, unknown> }[]>`
          select id, payload from ops.domain_events
          where type = 'learning.session_finished' and aggregate_id = ${id}`;
        assert(event, 'LearningSessionFinished was not emitted');
        assert(event.payload.eventName === 'LearningSessionFinished', 'event name');
        eventIds.push(event.id);
        await drain([event.id]);
        const first = await grants();
        assert(first.length === 1, `${first.length} XP rows after the event`);
        assert(
          first[0]!.lifetime_xp_delta === summary.xp,
          `granted ${first[0]!.lifetime_xp_delta}`,
        );
        assert(first[0]!.rule_id === 'LEARNING_CORRECT_ANSWER', first[0]!.rule_id);
        // Finishing again and replaying the event grant nothing more.
        const again = await finish(c, id);
        assert(again.replayed === true, 'second finish is not a replay');
        const [replay] = await sql<{ id: string }[]>`
          insert into ops.domain_events (type, household_id, aggregate_type, aggregate_id, payload, idempotency_key)
          values ('learning.session_finished', ${c.householdId}, 'learning_session', ${id},
                  ${sql.json(event.payload as never)}, ${`acceptance-m06:${randomUUID()}`})
          returning id`;
        eventIds.push(replay!.id);
        await drain([replay!.id]);
        const [events] = await sql<{ n: number }[]>`
          select count(*)::int as n from ops.domain_events
          where type = 'learning.session_finished' and aggregate_id = ${id}
            and idempotency_key = ${id}`;
        assert((await grants()).length === 1 && events!.n === 1, 'XP granted twice');
        const wallet = await ok('GET', `/students/${c.studentId}/rewards/wallet`, {
          child: c.child,
        });
        return `${summary.correct} correct → ${summary.xp} XP in one ledger row; second finish and a replayed event add nothing; wallet lifetime XP ${wallet.lifetimeXp as number}`;
      },
    },
    {
      name: 'A Grade 2 child completes a Toán 2 session using only taps; every item can be read aloud in Vietnamese',
      run: async () => {
        const g = state.g2!;
        const topic = await findTopic(sql, 2, 'math', null);
        assert(topic, 'no Toán 2 topic with practicable skills');
        const session = await start(g, { nodeId: topic.topicId, mode: 'PRACTICE' });
        assert(
          session.youngMode && session.readAloud,
          'Grade 2 session is not in young / read-aloud mode',
        );
        assert(session.ttsLang === 'vi', `tts language ${session.ttsLang}`);
        assert(
          session.maxMinutes === 15 && session.targetItems === 10,
          `${session.targetItems} items / ${session.maxMinutes} min`,
        );
        const types = new Map<string, number>();
        const served = await playAll(g, session.id, (n) => {
          const item = n.item!;
          types.set(item.type, (types.get(item.type) ?? 0) + 1);
          // Typing is only needed by fill_blank; every other type is answered by tapping.
          assert(item.type !== 'fill_blank', `item ${item.id} needs typing`);
          assert(item.ttsLang === 'vi', `item ${item.id} is read in ${item.ttsLang}`);
          assert(
            (item.ttsText ?? item.stemMd).trim() !== '',
            `item ${item.id} has nothing to read`,
          );
          for (const o of item.options) {
            assert(
              (o.ttsText ?? o.text ?? o.media?.alt ?? '').trim() !== '',
              `option ${o.id} of ${item.id} has nothing to read`,
            );
          }
        });
        assert(served.length === 10, `answered ${served.length} items`);
        const done = await finish(g, session.id);
        const summary = done.summary as { answered: number; correct: number };
        assert(summary.answered === 10 && summary.correct === 10, JSON.stringify(summary));
        return `"${topic.topicTitle}": 10/10 by taps (${[...types].map(([t, n]) => `${t}×${n}`).join(', ')}); stem and options of every item have Vietnamese read-aloud text. The voice itself needs a device (see the skipped step).`;
      },
    },
    {
      name: 'A passage group shows its passage and 3 linked items',
      run: async () => {
        const g = state.g2!;
        const [group] = await sql<
          {
            id: string;
            title: string;
            body_md: string;
            items: string[];
            skill_id: string;
            difficulty: number;
          }[]
        >`
          select g.id, g.title, g.body_md,
                 array_agg(i.id order by i.group_order) as items,
                 (array_agg(i.skill_ids[1] order by i.group_order))[1] as skill_id,
                 (array_agg(i.difficulty order by i.group_order))[1] as difficulty
          from library.item_groups g join library.items i on i.group_id = g.id
          where g.grade = 2 and g.subject = 'viet' and i.status in ('APPROVED', 'PUBLISHED')
            and i.type <> 'written' and i.kind = 'STATIC'
          group by g.id having count(*) >= 3
          order by g.code limit 1`;
        assert(group, 'no Tiếng Việt 2 group with 3 servable items');
        const others = await sql<{ id: string }[]>`
          select id from library.items
          where skill_ids @> array[${group.skill_id}]::uuid[] and not (id = any(${group.items}::uuid[]))`;
        await markSeen(
          g,
          others.map((r) => r.id),
        );
        await setTargetDifficulty(g, group.skill_id, group.difficulty);
        const session = await start(g, {
          skillIds: [group.skill_id],
          mode: 'PRACTICE',
          targetItems: group.items.length,
        });
        const served = await playAll(g, session.id);
        const linked = served.filter((s) => s.next.group?.id === group.id);
        assert(linked.length >= 3, `${linked.length} items of the group were served`);
        assert(
          same(
            linked.map((s) => s.next.item!.id),
            served.slice(0, linked.length).map((s) => s.next.item!.id),
          ),
          'the group items were not served one after another',
        );
        for (const s of linked) {
          assert(
            s.next.group!.bodyMd === group.body_md && group.body_md.trim() !== '',
            'passage missing',
          );
          assert(s.next.group!.total >= 3, `group total ${s.next.group!.total}`);
        }
        assert(
          same(
            linked.map((s) => s.next.group!.position),
            linked.map((_, i) => i + 1),
          ),
          `positions ${linked.map((s) => s.next.group!.position).join(',')}`,
        );
        return `"${group.title}" (${group.body_md.length} characters): ${linked.length} linked items served consecutively, each with the passage (positions ${linked.map((s) => s.next.group!.position).join(', ')} of ${linked[0]!.next.group!.total})`;
      },
    },
    {
      name: 'Read-aloud voice on a device (expo-speech, Vietnamese TTS)',
      run: async () => {
        throw new SkipStep(
          'needs an Android device or emulator with a Vietnamese TTS voice (not available here)',
        );
      },
    },
    {
      name: 'Maestro flow apps/mobile/.maestro/m06-practice.yaml',
      run: async () => {
        throw new SkipStep(
          'needs an Android emulator with the development build (not available here)',
        );
      },
    },
  ],
  cleanup: async () => {
    for (const id of users) {
      await sql`
        delete from app.households where id in (
          select household_id from app.household_memberships where user_id = ${id})`;
      await sql`delete from auth.users where id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  },
};
